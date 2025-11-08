import "server-only";

import { generateObject } from "ai";
import { z } from "zod";
import { claudeModel } from "~/lib/ai";
import { searchProduct } from "~/lib/integrations/browserbase";

/**
 * Subscription Intent Schema
 * Extracted from natural language
 */
export const subscriptionIntentSchema = z.object({
  title: z.string().describe("User-friendly name for the subscription"),
  productQuery: z.string().describe("Product search query if no URL provided"),
  productUrl: z.string().url().optional().describe("Product URL if provided by user"),
  cadenceDays: z.number().int().positive().describe("Delivery frequency in days"),
  maxPriceCents: z.number().int().optional().describe("Maximum acceptable price in cents"),
  constraints: z
    .object({
      color: z.string().optional(),
      size: z.string().optional(),
      brand: z.string().optional(),
      quantity: z.number().int().optional(),
      merchantPreference: z.array(z.string()).optional(),
    })
    .optional()
    .describe("Product constraints and preferences"),
  requiresAddress: z.boolean().describe("Whether delivery address is needed"),
  notes: z.string().optional().describe("Additional notes or special instructions"),
});

export type SubscriptionIntentData = z.infer<typeof subscriptionIntentSchema>;

/**
 * Plan Agent: Extract SubscriptionIntent from natural language
 * 
 * This agent uses Claude to parse user requests and extract structured subscription data
 * without requiring the user to provide structured input.
 * 
 * Examples:
 * - "Subscribe me to dish soap every month" 
 * - "I want coffee beans delivered every 2 weeks"
 * - "Send me organic dog food from Amazon quarterly"
 */
export async function extractSubscriptionIntent({
  userMessage,
  conversationHistory = [],
}: {
  userMessage: string;
  conversationHistory?: Array<{ role: "user" | "assistant"; content: string }>;
}): Promise<{
  success: boolean;
  intent?: SubscriptionIntentData;
  missingInfo?: string[];
  error?: string;
}> {
  try {
    // Build context from conversation
    const contextMessages = conversationHistory
      .map((msg) => `${msg.role}: ${msg.content}`)
      .join("\n");

    const fullContext = contextMessages
      ? `Previous conversation:\n${contextMessages}\n\nCurrent request: ${userMessage}`
      : userMessage;

    // Use Claude to extract structured intent
    const result = await generateObject({
      model: claudeModel,
      schema: z.object({
        canProceed: z.boolean().describe("Whether enough information is available to create subscription"),
        intent: subscriptionIntentSchema.optional(),
        missingInfo: z
          .array(z.string())
          .optional()
          .describe("List of missing required information"),
        clarificationQuestion: z.string().optional().describe("Question to ask user if info is missing"),
      }),
      prompt: `Extract subscription intent from this user request. 

User request: ${fullContext}

Extract:
- title: A clear, user-friendly name (e.g., "Monthly dish soap", "Bi-weekly dog food")
- productQuery: What product they want (for searching if no URL)
- productUrl: Direct product URL if they provided one
- cadenceDays: How often they want delivery (convert "monthly"→30, "weekly"→7, "bi-weekly"→14, "quarterly"→90)
- maxPriceCents: Price limit if mentioned (convert dollars to cents)
- constraints: Color, size, brand, quantity preferences
- requiresAddress: true (always require for physical products)

If critical info is missing (product or cadence), set canProceed=false and list what's needed.`,
    });

    const data = result.object;

    if (!data.canProceed || !data.intent) {
      return {
        success: false,
        missingInfo: data.missingInfo || ["product information or delivery frequency"],
        error: data.clarificationQuestion || "Missing required information to create subscription",
      };
    }

    return {
      success: true,
      intent: data.intent,
    };
  } catch (error) {
    console.error("Failed to extract subscription intent:", error);
    return {
      success: false,
      error: "Failed to process your subscription request. Please try again.",
    };
  }
}

/**
 * Enhanced plan agent with autonomous product discovery
 * 
 * If user doesn't provide a URL, this agent will:
 * 1. Extract what they want
 * 2. Use Browserbase to search for it
 * 3. Return product options for user to choose from
 */
export async function planWithProductDiscovery({
  userMessage,
  conversationHistory = [],
}: {
  userMessage: string;
  conversationHistory?: Array<{ role: "user" | "assistant"; content: string }>;
}): Promise<{
  success: boolean;
  intent?: SubscriptionIntentData;
  productOptions?: Array<{
    name: string;
    url: string;
    price?: string;
    merchant: string;
  }>;
  requiresUserSelection?: boolean;
  error?: string;
}> {
  try {
    // Step 1: Extract basic intent
    const intentResult = await extractSubscriptionIntent({
      userMessage,
      conversationHistory,
    });

    if (!intentResult.success) {
      return {
        success: false,
        error: intentResult.error,
      };
    }

    const intent = intentResult.intent!;

    // Step 2: If no product URL, search for it
    if (!intent.productUrl && intent.productQuery) {
      console.log(`🔍 No URL provided, searching for: ${intent.productQuery}`);

      const merchantPref = intent.constraints?.merchantPreference?.[0];
      const merchant = (merchantPref === "amazon" || merchantPref === "target" || merchantPref === "walmart") 
        ? merchantPref 
        : "amazon";
      
      const searchResults = await searchProduct({
        query: intent.productQuery,
        merchant,
      });

      if (searchResults.length === 0) {
        return {
          success: false,
          error: `Could not find products matching "${intent.productQuery}". Please try a different search term or provide a direct product URL.`,
        };
      }

      // Return options for user to select
      return {
        success: true,
        intent,
        productOptions: searchResults,
        requiresUserSelection: true,
      };
    }

    // Step 3: Intent complete with URL
    return {
      success: true,
      intent,
    };
  } catch (error) {
    console.error("Plan agent error:", error);
    return {
      success: false,
      error: "Failed to process subscription request",
    };
  }
}

/**
 * Parse cadence from natural language
 * Helper function for tools that need to convert text to days
 */
export function parseCadence(cadenceText: string): number {
  const text = cadenceText.toLowerCase();

  // Daily
  if (text.includes("day") || text.includes("daily")) {
    const match = text.match(/(\d+)\s*day/);
    return match && match[1] ? parseInt(match[1]) : 1;
  }

  // Weekly
  if (text.includes("week") || text.includes("weekly")) {
    const match = text.match(/(\d+)\s*week/);
    return match && match[1] ? parseInt(match[1]) * 7 : 7;
  }

  // Bi-weekly
  if (text.includes("bi-week") || text.includes("biweekly") || text.includes("every other week")) {
    return 14;
  }

  // Monthly
  if (text.includes("month") || text.includes("monthly")) {
    const match = text.match(/(\d+)\s*month/);
    return match && match[1] ? parseInt(match[1]) * 30 : 30;
  }

  // Quarterly
  if (text.includes("quarter") || text.includes("quarterly")) {
    return 90;
  }

  // Every X days
  const everyMatch = text.match(/every\s+(\d+)\s+days?/);
  if (everyMatch && everyMatch[1]) {
    return parseInt(everyMatch[1]);
  }

  // Default to monthly
  return 30;
}

