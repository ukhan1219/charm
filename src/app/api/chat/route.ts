// import { auth, currentUser } from "@clerk/nextjs/server";
// import { streamText, convertToModelMessages, stepCountIs, tool } from "ai";
// import type { UIMessage } from "ai";
// import { z } from "zod";
// import { claudeModel } from "~/lib/ai";
// import { db } from "~/server/db";
// import { message as messageTable, usStates } from "~/server/db/schema";
// import {
//   getOrCreateUserByClerkId,
//   createSubscriptionIntent,
//   getSubscriptionIntentsByUserId,
//   updateSubscriptionIntent,
//   deleteSubscriptionIntent,
//   getOrCreateProduct,
//   createSubscription,
//   getSubscriptionsByUserId,
//   getSubscriptionById,
//   updateSubscriptionStatus,
//   updateSubscription,
//   deleteSubscription,
//   createUserAddress,
//   getUserAddresses,
//   getPrimaryAddress,
// } from "~/server/db/queries";
// import {
//   searchProduct,
//   getProductDetails,
// } from "~/lib/integrations/browserbase";

// export const maxDuration = 60;

// /**
//  * Chat API route - Streaming with Claude 4.5 Haiku
//  * Single persistent conversation per user (no chatId)
//  * Uses AI SDK v5 with UIMessage format
//  */
// export async function POST(req: Request) {
//   const { userId: clerkUserId } = await auth();

//   if (!clerkUserId) {
//     return new Response("Unauthorized", { status: 401 });
//   }

//   try {
//     // Get current user info from Clerk
//     const clerkUser = await currentUser();
//     const email =
//       clerkUser?.emailAddresses[0]?.emailAddress || "unknown@example.com";

//     // Map Clerk user to our database user (get or create)
//     const dbUser = await getOrCreateUserByClerkId({
//       clerkId: clerkUserId,
//       email,
//     });

//     const { messages }: { messages: UIMessage[] } = await req.json();

//     // Save user message to database (if it's a new message)
//     if (messages.length > 0) {
//       const lastMessage = messages[messages.length - 1];
//       if (lastMessage && lastMessage.role === "user") {
//         // Extract text from parts
//         const textParts =
//           lastMessage.parts?.filter((p: any) => p.type === "text") || [];
//         const content = textParts.map((p: any) => p.text).join("");

//         if (content) {
//           await db.insert(messageTable).values({
//             userId: dbUser.id,
//             role: "user",
//             content: { text: content },
//             createdAt: new Date(),
//           });
//         }
//       }
//     }

//     // Stream response from Claude with tool calling
//     const result = streamText({
//       model: claudeModel,
//       system: `Charm: Subscription assistant. Find products without URLs. Create/manage subscriptions.

// Workflow:
// 1. User wants subscription → searchProduct (if no URL)
// 2. Gather: frequency, address (verify), preferences
// 3. Confirm: product, merchant, frequency, address, cost ($1/mo fee)
// 4. Create subscription only after explicit "yes"

// Rules:
// - Always verify address before creating
// - Always show final confirmation with costs
// - Support Amazon/Target/Walmart
// - Use pause/resume/cancel for management`,
//       messages: convertToModelMessages(messages.slice(-5)), // Limit to last 10 messages (~85% token reduction)
//       stopWhen: stepCountIs(5), // Allow multi-step tool calls
//       tools: {
//         // Product Discovery (Browserbase/Stagehand)
//         searchProduct: tool({
//           description: `Search products without URL. Use when user wants subscription but no URL provided. Works: Amazon, Target, Walmart.`,
//           inputSchema: z.object({
//             query: z
//               .string()
//               .describe(
//                 "Natural language product search query (e.g., 'organic dish soap')",
//               ),
//             merchant: z
//               .enum(["amazon", "target", "walmart", "any"])
//               .default("amazon")
//               .describe(
//                 "Which retailer to search - Amazon, Target, or Walmart",
//               ),
//           }),
//           execute: async ({ query, merchant }) => {
//             try {
//               console.log(`🔍 Searching for "${query}" on ${merchant}...`);
//               const results = await searchProduct({ query, merchant });

//               return {
//                 success: true,
//                 count: results.length,
//                 products: results.slice(0, 3), // Return top 3 results (reduced from 5 to save tokens)
//                 message: `Found ${results.length} products matching "${query}" on ${merchant}`,
//               };
//             } catch (error: any) {
//               console.error("Product search failed:", error);

//               // Check for various rate limits
//               if (
//                 error?.message?.includes("rate limit") ||
//                 error?.message?.includes("concurrent sessions") ||
//                 error?.message?.includes("429")
//               ) {
//                 // Check if it's Claude API rate limit
//                 if (error?.message?.includes("20,000 input tokens")) {
//                   return {
//                     success: false,
//                     error:
//                       "Claude API rate limit reached (20k tokens/min). Please wait 2-3 minutes or provide a direct product URL like",
//                     rateLimited: true,
//                     suggestDirectUrl: true,
//                   };
//                 }

//                 return {
//                   success: false,
//                   error:
//                     "Browserbase rate limit reached. Please wait 60 seconds and try again, or provide a direct product URL.",
//                   rateLimited: true,
//                 };
//               }

//               return {
//                 success: false,
//                 error:
//                   "Failed to search for products. You can provide a direct URL instead.",
//               };
//             }
//           },
//         }),

//         getProductInfo: tool({
//           description:
//             "Get product details from URL (price, subscription options)",
//           inputSchema: z.object({
//             productUrl: z.string().url().describe("URL of the product page"),
//           }),
//           execute: async ({ productUrl }) => {
//             try {
//               console.log(`📦 Getting details for ${productUrl}...`);
//               const details = await getProductDetails(productUrl);

//               return {
//                 success: true,
//                 product: details,
//                 message: `Retrieved details for ${details.name}`,
//               };
//             } catch (error: any) {
//               console.error("Failed to get product details:", error);

//               // Check for rate limit
//               if (
//                 error?.message?.includes("rate limit") ||
//                 error?.message?.includes("concurrent sessions")
//               ) {
//                 return {
//                   success: false,
//                   error:
//                     "Browserbase rate limit reached. Please wait 60 seconds and try again.",
//                   rateLimited: true,
//                 };
//               }

//               return {
//                 success: false,
//                 error: "Failed to retrieve product details",
//               };
//             }
//           },
//         }),

//         // Subscription Intent Management
//         createSubscriptionIntent: tool({
//           description:
//             "Create subscription. Only after user confirms all details.",
//           inputSchema: z.object({
//             title: z
//               .string()
//               .describe(
//                 "User-friendly name for the subscription (e.g., 'Monthly dish soap')",
//               ),
//             productUrl: z
//               .string()
//               .url()
//               .describe("URL of the product to subscribe to"),
//             cadenceDays: z
//               .number()
//               .int()
//               .positive()
//               .describe("How often to deliver in days (e.g., 30 for monthly)"),
//             maxPriceCents: z
//               .number()
//               .int()
//               .optional()
//               .describe("Maximum price in cents user is willing to pay"),
//             constraints: z
//               .record(z.string())
//               .optional()
//               .describe("Additional constraints like color, size, brand, etc."),
//           }),
//           execute: async ({
//             title,
//             productUrl,
//             cadenceDays,
//             maxPriceCents,
//             constraints,
//           }) => {
//             try {
//               const intent = await createSubscriptionIntent({
//                 userId: dbUser.id,
//                 title,
//                 productUrl,
//                 cadenceDays,
//                 maxPriceCents,
//                 constraints,
//               });
//               return {
//                 success: true,
//                 intentId: intent?.id,
//                 message: `Subscription intent created for "${title}" with ${cadenceDays}-day delivery frequency.`,
//               };
//             } catch (error) {
//               console.error("Failed to create subscription intent:", error);
//               return {
//                 success: false,
//                 error: "Failed to create subscription intent",
//               };
//             }
//           },
//         }),

//         getMySubscriptions: tool({
//           description: "Get user's subscriptions",
//           inputSchema: z.object({}),
//           execute: async () => {
//             try {
//               const intents = await getSubscriptionIntentsByUserId(dbUser.id);
//               const subscriptions = await getSubscriptionsByUserId(dbUser.id);
//               return {
//                 intents,
//                 subscriptions,
//                 count: intents.length,
//               };
//             } catch (error) {
//               console.error("Failed to get subscriptions:", error);
//               return { error: "Failed to retrieve subscriptions" };
//             }
//           },
//         }),

//         updateSubscriptionIntent: tool({
//           description: "Update subscription (frequency, price, constraints)",
//           inputSchema: z.object({
//             intentId: z
//               .string()
//               .uuid()
//               .describe("ID of the subscription intent to update"),
//             title: z.string().optional(),
//             cadenceDays: z
//               .number()
//               .int()
//               .positive()
//               .optional()
//               .describe("New delivery frequency in days"),
//             maxPriceCents: z.number().int().optional(),
//             constraints: z.record(z.string()).optional(),
//           }),
//           execute: async ({
//             intentId,
//             title,
//             cadenceDays,
//             maxPriceCents,
//             constraints,
//           }) => {
//             try {
//               const updates: any = {};
//               if (title) updates.title = title;
//               if (cadenceDays) updates.cadenceDays = cadenceDays;
//               if (maxPriceCents !== undefined)
//                 updates.maxPriceCents = maxPriceCents;
//               if (constraints) updates.constraints = constraints;

//               await updateSubscriptionIntent({ id: intentId, updates });
//               return {
//                 success: true,
//                 message: "Subscription intent updated successfully",
//               };
//             } catch (error) {
//               console.error("Failed to update subscription intent:", error);
//               return {
//                 success: false,
//                 error: "Failed to update subscription intent",
//               };
//             }
//           },
//         }),

//         pauseSubscription: tool({
//           description: "Pause subscription temporarily",
//           inputSchema: z.object({
//             intentId: z
//               .string()
//               .uuid()
//               .describe("ID of the subscription intent to pause"),
//           }),
//           execute: async ({ intentId }) => {
//             try {
//               await updateSubscriptionIntent({
//                 id: intentId,
//                 updates: { status: "paused" },
//               });
//               return {
//                 success: true,
//                 message: "Subscription paused successfully",
//               };
//             } catch (error) {
//               console.error("Failed to pause subscription:", error);
//               return { success: false, error: "Failed to pause subscription" };
//             }
//           },
//         }),

//         resumeSubscription: tool({
//           description: "Resume paused subscription",
//           inputSchema: z.object({
//             intentId: z
//               .string()
//               .uuid()
//               .describe("ID of the subscription intent to resume"),
//           }),
//           execute: async ({ intentId }) => {
//             try {
//               await updateSubscriptionIntent({
//                 id: intentId,
//                 updates: { status: "active" },
//               });
//               return {
//                 success: true,
//                 message: "Subscription resumed successfully",
//               };
//             } catch (error) {
//               console.error("Failed to resume subscription:", error);
//               return { success: false, error: "Failed to resume subscription" };
//             }
//           },
//         }),

//         cancelSubscription: tool({
//           description: "Cancel subscription permanently",
//           inputSchema: z.object({
//             intentId: z
//               .string()
//               .uuid()
//               .describe("ID of the subscription intent to cancel"),
//           }),
//           execute: async ({ intentId }) => {
//             try {
//               await deleteSubscriptionIntent(intentId);
//               return {
//                 success: true,
//                 message: "Subscription canceled successfully",
//               };
//             } catch (error) {
//               console.error("Failed to cancel subscription:", error);
//               return { success: false, error: "Failed to cancel subscription" };
//             }
//           },
//         }),

//         // Address Management
//         createAddress: tool({
//           description: "Create delivery address",
//           inputSchema: z.object({
//             street1: z.string().describe("Street address line 1"),
//             street2: z
//               .string()
//               .optional()
//               .describe("Street address line 2 (apartment, suite, etc.)"),
//             city: z.string().describe("City"),
//             state: z.enum(usStates).describe("Two-letter US state code"),
//             zipCode: z.string().describe("ZIP code"),
//             isPrimary: z
//               .boolean()
//               .optional()
//               .describe("Set as primary address"),
//           }),
//           execute: async ({
//             street1,
//             street2,
//             city,
//             state,
//             zipCode,
//             isPrimary,
//           }) => {
//             try {
//               const newAddress = await createUserAddress({
//                 userId: dbUser.id,
//                 street1,
//                 street2,
//                 city,
//                 state,
//                 zipCode,
//                 isPrimary: isPrimary ?? false,
//               });
//               return {
//                 success: true,
//                 addressId: newAddress?.id,
//                 message: "Address created successfully",
//               };
//             } catch (error) {
//               console.error("Failed to create address:", error);
//               return { success: false, error: "Failed to create address" };
//             }
//           },
//         }),

//         getMyAddresses: tool({
//           description: "Get user's saved addresses",
//           inputSchema: z.object({}),
//           execute: async () => {
//             try {
//               const addresses = await getUserAddresses(dbUser.id);
//               return {
//                 addresses,
//                 count: addresses.length,
//               };
//             } catch (error) {
//               console.error("Failed to get addresses:", error);
//               return { error: "Failed to retrieve addresses" };
//             }
//           },
//         }),

//         // Agent Job Management
//         analyzeProduct: tool({
//           description: "Analyze product for subscription options",
//           inputSchema: z.object({
//             productUrl: z
//               .string()
//               .url()
//               .describe("URL of the product to analyze"),
//           }),
//           execute: async ({ productUrl }) => {
//             try {
//               // Import agents
//               const { analyzeProductSubscriptionCapability } = await import(
//                 "~/server/agents"
//               );

//               console.log(`🧠 Analyzing product: ${productUrl}`);
//               const analysis =
//                 await analyzeProductSubscriptionCapability(productUrl);

//               if (!analysis.success) {
//                 return {
//                   success: false,
//                   error: analysis.error || "Failed to analyze product",
//                 };
//               }

//               return {
//                 success: true,
//                 intelligence: analysis.intelligence,
//                 message: `Product analyzed: ${analysis.intelligence?.subscriptionMethod} subscription method`,
//               };
//             } catch (error) {
//               console.error("Product analysis failed:", error);
//               return {
//                 success: false,
//                 error: "Failed to analyze product",
//               };
//             }
//           },
//         }),

//         startCheckout: tool({
//           description:
//             "Start automated checkout. Only after user confirms all details.",
//           inputSchema: z.object({
//             subscriptionIntentId: z
//               .string()
//               .uuid()
//               .describe("ID of the subscription intent to checkout"),
//             productUrl: z.string().url().describe("Product URL to purchase"),
//             addressId: z.string().uuid().describe("Delivery address ID"),
//             useNativeSubscription: z
//               .boolean()
//               .optional()
//               .describe("Whether to use native Subscribe & Save"),
//           }),
//           execute: async ({
//             subscriptionIntentId,
//             productUrl,
//             addressId,
//             useNativeSubscription,
//           }) => {
//             try {
//               // Start checkout agent job in background
//               const runId = crypto.randomUUID();

//               // Import executeCheckout
//               const { executeCheckout: startCheckout } = await import(
//                 "~/server/agents"
//               );

//               // Get address details
//               const addressData = await db.query.address.findFirst({
//                 where: (address, { eq }) => eq(address.id, addressId),
//               });

//               if (!addressData) {
//                 return {
//                   success: false,
//                   error: "Address not found",
//                 };
//               }

//               console.log(`🛒 Starting checkout job ${runId}`);

//               // Execute checkout (this will run with maxDuration timeout)
//               // In production, use Vercel Queue for true background processing
//               const checkoutResult = await startCheckout({
//                 productUrl,
//                 subscriptionId: subscriptionIntentId,
//                 address: {
//                   street1: addressData.street1,
//                   street2: addressData.street2 || undefined,
//                   city: addressData.city,
//                   state: addressData.state,
//                   zipCode: addressData.zipCode,
//                 },
//                 paymentMethod: {
//                   type: "stripe_saved",
//                   details: {}, // TODO: Get from Stripe
//                 },
//                 useNativeSubscription,
//               });

//               return {
//                 success: checkoutResult.success,
//                 runId,
//                 sessionId: checkoutResult.sessionId,
//                 requiresApproval: checkoutResult.requiresManualIntervention,
//                 message: checkoutResult.requiresManualIntervention
//                   ? "Checkout ready for payment approval"
//                   : "Checkout completed",
//                 error: checkoutResult.error,
//               };
//             } catch (error) {
//               console.error("Failed to start checkout:", error);
//               return {
//                 success: false,
//                 error: "Failed to start checkout process",
//               };
//             }
//           },
//         }),
//       },
//       onFinish: async ({ text }) => {
//         // Save assistant message to database
//         try {
//           await db.insert(messageTable).values({
//             userId: dbUser.id,
//             role: "assistant",
//             content: { text },
//             createdAt: new Date(),
//           });
//         } catch (error) {
//           console.error("Failed to save assistant message:", error);
//         }
//       },
//     });

//     return result.toUIMessageStreamResponse();
//   } catch (error) {
//     console.error("Chat API error:", error);
//     return new Response("Internal server error", { status: 500 });
//   }
// }

// TODO: THIS IS THE PROD VERSION:

import { auth, currentUser } from "@clerk/nextjs/server";
import { streamText, convertToModelMessages, stepCountIs, tool } from "ai";
import type { UIMessage } from "ai";
import { z } from "zod";
import { claudeModel } from "~/lib/ai";
import { db } from "~/server/db";
import { message as messageTable, usStates, agentRun } from "~/server/db/schema";
import { eq } from "drizzle-orm";
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
 * Chat API route - Streaming with Claude 4.5 Haiku
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
   - Use searchProduct tool to find the product (results include price and priceCents for each product)
   - Present top results to user
   - Let them choose or refine search
   - REMEMBER the priceCents from the selected product - you'll need it for step 2
   - Get detailed info with getProductInfo if needed (but if it fails to extract price, use the search result price)

2. **Subscription Creation**:
   - Confirm delivery frequency (in days, e.g., 30 for monthly)
   - Get delivery address (use getMyAddresses first, or createAddress if needed)
   - Extract any constraints (color, size, brand preferences)
   - CRITICAL: Always capture the product price:
     * If using searchProduct, the search results include the price
     * If using getProductInfo, it returns priceCents
     * You MUST pass maxPriceCents to createSubscriptionIntent
     * Use the price from searchProduct results if getProductInfo fails to extract it
   - Create the subscription intent with createSubscriptionIntent (ALWAYS include maxPriceCents)

3. **Final Confirmation BEFORE Checkout**:
   - After creating the subscription intent, ALWAYS show a summary with:
     * Product name and URL
     * Delivery frequency
     * Delivery address
     * Estimated price
   - WAIT for explicit user confirmation (e.g., "yes", "confirm", "proceed", "go ahead") (let them know you are waiting for confirmation)
   - DO NOT call startCheckout until the user explicitly confirms
   - Only after user confirms, then call startCheckout to begin the checkout process

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
- Support all major retailers: Amazon, Target, Walmart, Best Buy
- Users can specify a preferred retailer, or use "any" to search across all

Be helpful, concise, and friendly.`,
      messages: convertToModelMessages(messages.slice(-5)),

      stopWhen: stepCountIs(5), // Allow multi-step tool calls
      tools: {
        // Product Discovery (Browserbase/Stagehand)
        searchProduct: tool({
          description: `Search for products using natural language WITHOUT requiring a URL. Supports Amazon, Target, Walmart, and Best Buy.
            This is the PRIMARY tool to use when user wants to subscribe to something but doesn't provide a URL.
            Uses autonomous web browsing to find products across multiple retailers.
            Works with: Amazon, Target, Walmart, and more.
            Examples: "dish soap", "paper towels", "dog food", "coffee beans"`,
          inputSchema: z.object({
            query: z.string().describe("Natural language product search query (e.g., 'organic dish soap')"),
            merchant: z.enum(["amazon", "target", "walmart", "bestbuy", "any"]).default("amazon").describe("Which retailer to search - Amazon, Target, Walmart, or Best Buy"),
          }),
          execute: async ({ query, merchant }) => {
            try {
              console.log(`🔍 Searching for "${query}" on ${merchant}...`);
              const results = await searchProduct({ query, merchant });

              // Helper function to parse price string to cents
              const parsePriceToCents = (priceString?: string): number | undefined => {
                if (!priceString) return undefined;
                const cleaned = priceString.replace(/[$,]/g, '');
                const dollars = parseFloat(cleaned);
                return isNaN(dollars) ? undefined : Math.round(dollars * 100);
              };

              // Add priceCents to each product result
              const productsWithPriceCents = results.map(product => ({
                ...product,
                priceCents: parsePriceToCents(product.price),
              }));

              return {
                success: true,
                count: results.length,
                products: productsWithPriceCents.slice(0, 3), // Return top 3 results (reduced from 5 to save tokens)
                message: `Found ${results.length} product matching "${query}" on ${merchant}`,
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

              // Helper function to parse price string to cents
              const parsePriceToCents = (priceString: string): number | undefined => {
                const cleaned = priceString.replace(/[$,]/g, '');
                const dollars = parseFloat(cleaned);
                return isNaN(dollars) ? undefined : Math.round(dollars * 100);
              };

              const priceCents = parsePriceToCents(details.price);

              return {
                success: true,
                product: {
                  ...details,
                  priceCents, // Add converted price in cents
                },
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
          description: "Create a new subscription intent from natural language. This is the first step when user wants to subscribe to a product. IMPORTANT: You should call getProductInfo first to get the product price, then pass the priceCents value as maxPriceCents to this tool.",
          inputSchema: z.object({
            title: z.string().describe("User-friendly name for the subscription (e.g., 'Monthly dish soap')"),
            productUrl: z.string().url().describe("URL of the product to subscribe to"),
            cadenceDays: z.number().int().positive().describe("How often to deliver in days (e.g., 30 for monthly)"),
            maxPriceCents: z.number().int().optional().describe("Maximum price in cents from the product analysis (use priceCents from getProductInfo result)"),
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
              // Exclude canceled subscriptions by default
              const intents = await getSubscriptionIntentsByUserId(dbUser.id, { includeCanceled: false });
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
        // TODO: IMPLEMENT analyzeProductSubscriptionCapability tool
        // Agent Job Management
        analyzeProduct: tool({
          description: "Analyze a product page to determine subscription capability and pricing. Use this when you need detailed information about whether a product has native subscription options.",
          inputSchema: z.object({
            productUrl: z.string().url().describe("URL of the product to analyze"),
          }),
          execute: async ({ productUrl }) => {
            try {
              // Import agents
              const { analyzeProductSubscriptionCapability } = await import("~/server/agents");

              console.log(`🧠 Analyzing product: ${productUrl}`);
              const analysis = await analyzeProductSubscriptionCapability(productUrl);

              if (!analysis.success) {
                return {
                  success: false,
                  error: analysis.error || "Failed to analyze product",
                };
              }

              return {
                success: true,
                intelligence: analysis.intelligence,
                message: `Product analyzed: ${analysis.intelligence?.subscriptionMethod} subscription method`,
              };
            } catch (error) {
              console.error("Product analysis failed:", error);
              return {
                success: false,
                error: "Failed to analyze product",
              };
            }
          },
        }),

        startCheckout: tool({
          description: "Start an automated checkout process for a subscription. This initiates a Browserbase session to complete the purchase. CRITICAL: Only call this AFTER the user has explicitly confirmed they want to proceed with checkout (e.g., said 'yes', 'confirm', 'proceed', 'go ahead'). Never call this immediately after creating a subscription intent - always wait for explicit confirmation first. IMPORTANT: If the response includes 'needsSubscription: true' and 'checkoutUrl', you MUST display the checkoutUrl as a clickable link to the user so they can complete their subscription setup.",
          inputSchema: z.object({
            subscriptionIntentId: z.string().uuid().describe("ID of the subscription intent to checkout"),
            productUrl: z.string().url().describe("Product URL to purchase"),
            addressId: z.string().uuid().describe("Delivery address ID"),
            useNativeSubscription: z.boolean().optional().describe("Whether to use native Subscribe & Save"),
          }),
          execute: async ({ subscriptionIntentId, productUrl, addressId, useNativeSubscription }) => {
            // Start checkout agent job in background
            const runId = crypto.randomUUID();
            
            try {

              // Get address details first
              const addressData = await db.query.address.findFirst({
                where: (address, { eq }) => eq(address.id, addressId),
              });

              if (!addressData) {
                return {
                  success: false,
                  error: "Address not found",
                };
              }

              // Create agent run record FIRST so UI can poll it
              console.log(`📝 Creating agent run record with ID: ${runId}`);
              await db.insert(agentRun).values({
                id: runId,
                intentId: subscriptionIntentId,
                phase: "checkout",
                input: {
                  productUrl,
                  address: {
                    street1: addressData.street1,
                    street2: addressData.street2 || undefined,
                    city: addressData.city,
                    state: addressData.state,
                    zipCode: addressData.zipCode,
                  },
                  useNativeSubscription,
                },
                createdAt: new Date(),
              });

              console.log(`✅ Agent run record created successfully`);
              
              // Check and update product price before first order
              console.log(`💰 Checking product price before checkout...`);
              const { getSubscriptionIntentById, getProductPriceFromUrl, getOrCreateProduct, updateSubscriptionIntent } = await import("~/server/db/queries");
              
              const intent = await getSubscriptionIntentById(subscriptionIntentId);
              if (!intent) {
                return {
                  success: false,
                  error: "Subscription intent not found",
                };
              }

              // Fetch current product price
              const currentPriceCents = await getProductPriceFromUrl(intent.productUrl);
              
              if (currentPriceCents !== null) {
                console.log(`📊 Current product price: ${currentPriceCents}¢`);
                
                // Create or update product with current price
                const product = await getOrCreateProduct({
                  name: intent.title,
                  url: intent.productUrl,
                  currentPriceCents,
                });
                
                // Update intent with current price if different
                if (intent.maxPriceCents !== currentPriceCents) {
                  await updateSubscriptionIntent({
                    id: subscriptionIntentId,
                    updates: {
                      maxPriceCents: currentPriceCents,
                    },
                  });
                  console.log(`✅ Updated intent price: ${intent.maxPriceCents}¢ → ${currentPriceCents}¢`);
                }
              } else {
                console.warn(`⚠️ Could not fetch current price, using intent price: ${intent.maxPriceCents}¢`);
              }

              console.log(`🛒 Starting checkout job ${runId}`);

              // Import executeCheckout
              const { executeCheckout: startCheckout } = await import("~/server/agents");

              // Execute checkout (this will run with maxDuration timeout)
              // In production, use Vercel Queue for true background processing
              const checkoutResult = await startCheckout({
                productUrl,
                subscriptionIntentId, // Pass as subscriptionIntentId, not subscriptionId
                address: {
                  street1: addressData.street1,
                  street2: addressData.street2 || undefined,
                  city: addressData.city,
                  state: addressData.state,
                  zipCode: addressData.zipCode,
                },
                paymentMethod: {
                  type: "stripe_saved",
                  details: {}, // TODO: Get from Stripe
                },
                useNativeSubscription,
                agentRunId: runId, // Pass the runId we created so executeCheckout updates the same record
              });

              // If checkout succeeded, check subscription and handle invoice
              if (checkoutResult.success) {
                const {
                  checkUserHasActiveSubscription,
                  createSubscriptionCheckoutSession,
                  appendInvoiceItemForSubscription,
                } = await import("~/lib/integrations/stripe");
                
                const { getSubscriptionIntentById } = await import("~/server/db/queries");
                
                // Get subscription intent details
                const intent = await getSubscriptionIntentById(subscriptionIntentId);
                
                if (!intent) {
                  return {
                    success: false,
                    error: "Subscription intent not found",
                  };
                }

                // Check if user has active Stripe subscription
                const hasActiveSubscription = await checkUserHasActiveSubscription(dbUser.id);

                if (!hasActiveSubscription) {
                  // User needs to set up subscription - create Checkout Session
                  console.log(`💳 User ${dbUser.id} needs to set up subscription`);
                  
                  try {
                    console.log(`Creating checkout session for user ${dbUser.id}`);
                    const { checkoutUrl, sessionId: stripeSessionId } = await createSubscriptionCheckoutSession({
                      userId: dbUser.id,
                      email: clerkUser?.emailAddresses[0]?.emailAddress || "unknown@example.com",
                      name: clerkUser?.firstName && clerkUser?.lastName ? `${clerkUser.firstName} ${clerkUser.lastName}` : undefined,
                    });

                    console.log(`✅ Checkout session created: ${checkoutUrl}`);

                    return {
                      success: true,
                      runId,
                      needsSubscription: true,
                      checkoutUrl,
                      stripeSessionId,
                      message: `Checkout completed! Please complete your subscription setup to enable automatic monthly billing then say done to add your invoice. Subscription checkout URL: ${checkoutUrl}`,
                    };
                  } catch (error) {
                    console.error("❌ Failed to create subscription checkout:", error);
                    return {
                      success: false,
                      error: error instanceof Error ? error.message : "Failed to create subscription checkout session",
                    };
                  }
                } else {
                  // User has active subscription - append invoice item
                  console.log(`💰 Appending invoice item for user ${dbUser.id}`);
                  
                  try {
                    // Get product price from checkout result or use maxPriceCents as fallback
                    const productPriceCents = checkoutResult.orderDetails?.priceCents || intent.maxPriceCents || 0;
                    
                    if (productPriceCents === 0) {
                      console.warn("Warning: Product price is 0, may need manual adjustment");
                    }

                    const invoiceResult = await appendInvoiceItemForSubscription({
                      userId: dbUser.id,
                      subscriptionIntentId,
                      productName: intent.title,
                      productPriceCents,
                      cadenceDays: intent.cadenceDays,
                      orderId: checkoutResult.orderId,
                    });

                    console.log(`✅ Invoice item created: $${invoiceResult.amount / 100} - ${invoiceResult.description}`);

                    return {
                      success: true,
                      runId,
                      sessionId: checkoutResult.sessionId,
                      invoiceItemId: invoiceResult.invoiceItemId,
                      invoiceAmount: invoiceResult.amount,
                      invoiceDescription: invoiceResult.description,
                      message: `Checkout completed! ${invoiceResult.description} has been added to your monthly invoice.`,
                    };
                  } catch (error) {
                    console.error("Failed to append invoice item:", error);
                    return {
                      success: true,
                      runId,
                      warning: "Checkout succeeded but failed to add invoice item. Please contact support.",
                      error: error instanceof Error ? error.message : "Unknown error",
                    };
                  }
                }
              }

              const toolResult = {
                success: checkoutResult.success,
                runId,
                sessionId: checkoutResult.sessionId,
                requiresApproval: checkoutResult.requiresManualIntervention,
                message: checkoutResult.requiresManualIntervention
                  ? "Checkout ready for payment approval"
                  : "Checkout completed",
                error: checkoutResult.error,
              };
              
              console.log(`🎯 Returning tool result with runId:`, toolResult);
              return toolResult;
            } catch (error) {
              console.error("Failed to start checkout:", error);
              
              // Update agent run with error if we created it
              try {
                await db.update(agentRun)
                  .set({
                    phase: "failed",
                    error: error instanceof Error ? error.message : "Failed to start checkout process",
                    endedAt: new Date(),
                  })
                  .where(eq(agentRun.id, runId));
              } catch (updateError) {
                console.error("Failed to update agent run with error:", updateError);
              }
              
              return {
                success: false,
                runId, // Return runId so UI can still show the error status
                error: "Failed to start checkout process",
              };
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
