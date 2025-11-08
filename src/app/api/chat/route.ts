import { auth, currentUser } from "@clerk/nextjs/server";
import { streamText, convertToModelMessages, stepCountIs, tool } from "ai";
import type { UIMessage } from "ai";
import { z } from "zod";
import { claudeModel } from "~/lib/ai";
import { db } from "~/server/db";
import { message as messageTable, usStates } from "~/server/db/schema";
import {
  getOrCreateUserByClerkId,
  createSubscriptionIntent,
  getSubscriptionIntentsByUserId,
  updateSubscriptionIntent,
  deleteSubscriptionIntent,
  getOrCreateProduct,
  createSubscription,
  getSubscriptionsByUserId,
  getSubscriptionById,
  updateSubscriptionStatus,
  updateSubscription,
  deleteSubscription,
  createUserAddress,
  getUserAddresses,
  getPrimaryAddress,
} from "~/server/db/queries";
import { searchProduct, getProductDetails } from "~/lib/integrations/browserbase";

export const maxDuration = 60;

/**
 * Chat API route - Streaming with Claude 3.7 Sonnet
 * Single persistent conversation per user (no chatId)
 * Uses AI SDK v5 with UIMessage format
 */
export async function POST(req: Request) {
  const { userId: clerkUserId } = await auth();

  if (!clerkUserId) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    // Get current user info from Clerk
    const clerkUser = await currentUser();
    const email = clerkUser?.emailAddresses[0]?.emailAddress || "unknown@example.com";

    // Map Clerk user to our database user (get or create)
    const dbUser = await getOrCreateUserByClerkId({
      clerkId: clerkUserId,
      email,
    });

    const { messages }: { messages: UIMessage[] } = await req.json();

    // Save user message to database (if it's a new message)
    if (messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      if (lastMessage && lastMessage.role === "user") {
        // Extract text from parts
        const textParts = lastMessage.parts?.filter((p: any) => p.type === "text") || [];
        const content = textParts.map((p: any) => p.text).join("");
        
        if (content) {
          await db.insert(messageTable).values({
            userId: dbUser.id,
            role: "user",
            content: { text: content },
            createdAt: new Date(),
          });
        }
      }
    }

    // Stream response from Claude with tool calling
    const result = streamText({
      model: claudeModel,
      system: `You are Charm, an intelligent subscription management assistant with autonomous product discovery capabilities.

🌟 KEY FEATURE: You can search for and find ANY product without needing a URL from the user.

Your primary role is to help users:
- Subscribe to ANY product using just natural language (e.g., "dish soap", "dog food")
- Find products autonomously using web browsing (searchProduct tool)
- Manage existing subscriptions (update, pause, cancel)
- Track deliveries and pricing changes
- Handle renewal schedules

WORKFLOW when user wants to subscribe to something:

1. **Product Discovery** (if no URL provided):
   - Use searchProduct tool to find the product
   - Present top results to user
   - Let them choose or refine search
   - Get detailed info with getProductInfo if needed

2. **Subscription Creation**:
   - Confirm delivery frequency (in days, e.g., 30 for monthly)
   - Get delivery address (use getMyAddresses first, or createAddress if needed)
   - Extract any constraints (color, size, brand preferences)
   - Create the subscription intent with createSubscriptionIntent

3. **Confirmation**: Always confirm subscription details before finalizing

For subscription management:
- Use pauseSubscription to temporarily stop deliveries
- Use resumeSubscription to restart paused subscriptions  
- Use cancelSubscription to permanently end subscriptions
- Use updateSubscriptionIntent to modify delivery frequency or constraints

IMPORTANT: 
- When user says "subscribe me to X", immediately use searchProduct to find it
- Don't ask for URLs - find products yourself (this is our key feature!)
- Present options when multiple products match
- Be proactive and autonomous in product discovery
- Don't retry searches immediately if rate limited

Be helpful, concise, and friendly.`,
      messages: convertToModelMessages(messages),
      stopWhen: stepCountIs(5), // Allow multi-step tool calls
      tools: {
        // Product Discovery (Browserbase/Stagehand)
        searchProduct: tool({
          description: `Search for products using natural language WITHOUT requiring a URL. 
            This is the PRIMARY tool to use when user wants to subscribe to something but doesn't provide a URL.
            Uses autonomous web browsing to find products on Amazon, Target, Walmart, etc.
            Examples: "dish soap", "paper towels", "dog food", "coffee beans"`,
          inputSchema: z.object({
            query: z.string().describe("Natural language product search query (e.g., 'organic dish soap')"),
            merchant: z.enum(["amazon", "target", "walmart", "any"]).default("amazon").describe("Which retailer to search"),
          }),
          execute: async ({ query, merchant }) => {
            try {
              console.log(`🔍 Searching for "${query}" on ${merchant}...`);
              const results = await searchProduct({ query, merchant });
              
              return {
                success: true,
                count: results.length,
                products: results.slice(0, 3), // Return top 3 results (reduced from 5 to save tokens)
                message: `Found ${results.length} products matching "${query}" on ${merchant}`,
              };
            } catch (error: any) {
              console.error("Product search failed:", error);
              
              // Check for various rate limits
              if (error?.message?.includes("rate limit") || error?.message?.includes("concurrent sessions") || error?.message?.includes("429")) {
                // Check if it's Claude API rate limit
                if (error?.message?.includes("20,000 input tokens")) {
                  return {
                    success: false,
                    error: "Claude API rate limit reached (20k tokens/min). Please wait 2-3 minutes or provide a direct product URL like",
                    rateLimited: true,
                    suggestDirectUrl: true,
                  };
                }
                
                return {
                  success: false,
                  error: "Browserbase rate limit reached. Please wait 60 seconds and try again, or provide a direct product URL.",
                  rateLimited: true,
                };
              }
              
              return {
                success: false,
                error: "Failed to search for products. You can provide a direct URL instead.",
              };
            }
          },
        }),

        getProductInfo: tool({
          description: "Get detailed information about a product from its URL, including pricing and subscription options",
          inputSchema: z.object({
            productUrl: z.string().url().describe("URL of the product page"),
          }),
          execute: async ({ productUrl }) => {
            try {
              console.log(`📦 Getting details for ${productUrl}...`);
              const details = await getProductDetails(productUrl);
              
              return {
                success: true,
                product: details,
                message: `Retrieved details for ${details.name}`,
              };
            } catch (error: any) {
              console.error("Failed to get product details:", error);
              
              // Check for rate limit
              if (error?.message?.includes("rate limit") || error?.message?.includes("concurrent sessions")) {
                return {
                  success: false,
                  error: "Browserbase rate limit reached. Please wait 60 seconds and try again.",
                  rateLimited: true,
                };
              }
              
              return {
                success: false,
                error: "Failed to retrieve product details",
              };
            }
          },
        }),

        // Subscription Intent Management
        createSubscriptionIntent: tool({
          description: "Create a new subscription intent from natural language. This is the first step when user wants to subscribe to a product.",
          inputSchema: z.object({
            title: z.string().describe("User-friendly name for the subscription (e.g., 'Monthly dish soap')"),
            productUrl: z.string().url().describe("URL of the product to subscribe to"),
            cadenceDays: z.number().int().positive().describe("How often to deliver in days (e.g., 30 for monthly)"),
            maxPriceCents: z.number().int().optional().describe("Maximum price in cents user is willing to pay"),
            constraints: z.record(z.string()).optional().describe("Additional constraints like color, size, brand, etc."),
          }),
          execute: async ({ title, productUrl, cadenceDays, maxPriceCents, constraints }) => {
            try {
              const intent = await createSubscriptionIntent({
                userId: dbUser.id,
                title,
                productUrl,
                cadenceDays,
                maxPriceCents,
                constraints,
              });
              return {
                success: true,
                intentId: intent?.id,
                message: `Subscription intent created for "${title}" with ${cadenceDays}-day delivery frequency.`,
              };
            } catch (error) {
              console.error("Failed to create subscription intent:", error);
              return { success: false, error: "Failed to create subscription intent" };
            }
          },
        }),

        getMySubscriptions: tool({
          description: "Get all subscriptions for the current user",
          inputSchema: z.object({}),
          execute: async () => {
            try {
              const intents = await getSubscriptionIntentsByUserId(dbUser.id);
              const subscriptions = await getSubscriptionsByUserId(dbUser.id);
              return {
                intents,
                subscriptions,
                count: intents.length,
              };
            } catch (error) {
              console.error("Failed to get subscriptions:", error);
              return { error: "Failed to retrieve subscriptions" };
            }
          },
        }),

        updateSubscriptionIntent: tool({
          description: "Update an existing subscription intent (delivery frequency, price cap, constraints, etc.)",
          inputSchema: z.object({
            intentId: z.string().uuid().describe("ID of the subscription intent to update"),
            title: z.string().optional(),
            cadenceDays: z.number().int().positive().optional().describe("New delivery frequency in days"),
            maxPriceCents: z.number().int().optional(),
            constraints: z.record(z.string()).optional(),
          }),
          execute: async ({ intentId, title, cadenceDays, maxPriceCents, constraints }) => {
            try {
              const updates: any = {};
              if (title) updates.title = title;
              if (cadenceDays) updates.cadenceDays = cadenceDays;
              if (maxPriceCents !== undefined) updates.maxPriceCents = maxPriceCents;
              if (constraints) updates.constraints = constraints;

              await updateSubscriptionIntent({ id: intentId, updates });
              return { success: true, message: "Subscription intent updated successfully" };
            } catch (error) {
              console.error("Failed to update subscription intent:", error);
              return { success: false, error: "Failed to update subscription intent" };
            }
          },
        }),

        pauseSubscription: tool({
          description: "Pause a subscription temporarily (deliveries will stop until resumed)",
          inputSchema: z.object({
            intentId: z.string().uuid().describe("ID of the subscription intent to pause"),
          }),
          execute: async ({ intentId }) => {
            try {
              await updateSubscriptionIntent({
                id: intentId,
                updates: { status: "paused" },
              });
              return { success: true, message: "Subscription paused successfully" };
            } catch (error) {
              console.error("Failed to pause subscription:", error);
              return { success: false, error: "Failed to pause subscription" };
            }
          },
        }),

        resumeSubscription: tool({
          description: "Resume a paused subscription",
          inputSchema: z.object({
            intentId: z.string().uuid().describe("ID of the subscription intent to resume"),
          }),
          execute: async ({ intentId }) => {
            try {
              await updateSubscriptionIntent({
                id: intentId,
                updates: { status: "active" },
              });
              return { success: true, message: "Subscription resumed successfully" };
            } catch (error) {
              console.error("Failed to resume subscription:", error);
              return { success: false, error: "Failed to resume subscription" };
            }
          },
        }),

        cancelSubscription: tool({
          description: "Permanently cancel a subscription (this action cannot be undone)",
          inputSchema: z.object({
            intentId: z.string().uuid().describe("ID of the subscription intent to cancel"),
          }),
          execute: async ({ intentId }) => {
            try {
              await deleteSubscriptionIntent(intentId);
              return { success: true, message: "Subscription canceled successfully" };
            } catch (error) {
              console.error("Failed to cancel subscription:", error);
              return { success: false, error: "Failed to cancel subscription" };
            }
          },
        }),

        // Address Management
        createAddress: tool({
          description: "Create a new delivery address for the user",
          inputSchema: z.object({
            street1: z.string().describe("Street address line 1"),
            street2: z.string().optional().describe("Street address line 2 (apartment, suite, etc.)"),
            city: z.string().describe("City"),
            state: z.enum(usStates).describe("Two-letter US state code"),
            zipCode: z.string().describe("ZIP code"),
            isPrimary: z.boolean().optional().describe("Set as primary address"),
          }),
          execute: async ({ street1, street2, city, state, zipCode, isPrimary }) => {
            try {
              const newAddress = await createUserAddress({
                userId: dbUser.id,
                street1,
                street2,
                city,
                state,
                zipCode,
                isPrimary: isPrimary ?? false,
              });
              return {
                success: true,
                addressId: newAddress?.id,
                message: "Address created successfully",
              };
            } catch (error) {
              console.error("Failed to create address:", error);
              return { success: false, error: "Failed to create address" };
            }
          },
        }),

        getMyAddresses: tool({
          description: "Get all saved delivery addresses for the current user",
          inputSchema: z.object({}),
          execute: async () => {
            try {
              const addresses = await getUserAddresses(dbUser.id);
              return {
                addresses,
                count: addresses.length,
              };
            } catch (error) {
              console.error("Failed to get addresses:", error);
              return { error: "Failed to retrieve addresses" };
            }
          },
        }),
      },
      onFinish: async ({ text }) => {
        // Save assistant message to database
        try {
          await db.insert(messageTable).values({
            userId: dbUser.id,
            role: "assistant",
            content: { text },
            createdAt: new Date(),
          });
        } catch (error) {
          console.error("Failed to save assistant message:", error);
        }
      },
    });

    return result.toUIMessageStreamResponse();
  } catch (error) {
    console.error("Chat API error:", error);
    return new Response("Internal server error", { status: 500 });
  }
}

