import "server-only";

import { generateObject } from "ai";
import { z } from "zod";
import { claudeModel } from "~/lib/ai";
import { getProductDetails } from "~/lib/integrations/browserbase";

/**
 * Product Intelligence Schema
 * Classifies product subscription capability
 */
export const productIntelligenceSchema = z.object({
  hasNativeSubscription: z.boolean().describe("Whether the product page offers native subscribe & save"),
  subscriptionProvider: z
    .enum(["amazon_subscribe_save", "target_restock", "walmart_auto_delivery", "shopify_subscriptions", "custom", "none"])
    .describe("Which subscription system the merchant uses"),
  canSubscribe: z.boolean().describe("Whether we can create a subscription for this product"),
  subscriptionMethod: z
    .enum(["native", "manual_repurchase", "not_possible"])
    .describe("How we should handle the subscription"),
  pricingInfo: z.object({
    currentPrice: z.string().describe("Current product price"),
    subscriptionDiscount: z.string().optional().describe("Discount if subscribing"),
    currency: z.string().default("USD"),
  }),
  availability: z.enum(["in_stock", "out_of_stock", "preorder", "unknown"]),
  shippingRequired: z.boolean().describe("Whether physical shipping is needed"),
  analysisNotes: z.string().optional().describe("Additional notes about subscription feasibility"),
});

export type ProductIntelligence = z.infer<typeof productIntelligenceSchema>;

/**
 * Product Intelligence Agent
 * 
 * Analyzes a product page to determine:
 * 1. Whether it has native subscription options (Amazon Subscribe & Save, etc.)
 * 2. Current pricing and availability
 * 3. Best subscription strategy (native vs manual repurchase)
 * 
 * This informs whether we:
 * - Use the merchant's native subscription flow (ideal)
 * - Set up our own scheduled repurchase system (fallback)
 */
export async function analyzeProductSubscriptionCapability(
  productUrl: string
): Promise<{
  success: boolean;
  intelligence?: ProductIntelligence;
  error?: string;
}> {
  try {
    console.log(`🧠 Analyzing product subscription capability: ${productUrl}`);

    // Step 1: Use Browserbase to get product page data
    const productData = await getProductDetails(productUrl);

    // Step 2: Use Claude to analyze the data
    const result = await generateObject({
      model: claudeModel,
      schema: productIntelligenceSchema,
      prompt: `Analyze this product for subscription capability:

Product URL: ${productUrl}
Product Name: ${productData.name}
Price: ${productData.price}
Merchant: ${productData.merchant}
Has Subscription Option: ${productData.hasSubscriptionOption}
Availability: ${productData.availability}
Description: ${productData.description}

Determine:
1. Does this product have a NATIVE subscription option (Subscribe & Save, Auto-delivery, etc.)?
2. What subscription provider/system does the merchant use?
3. Can we create a subscription for this product?
4. What's the best method: use native subscription OR set up manual repurchase?

Classification rules:
- If hasSubscriptionOption=true AND merchant is Amazon/Target/Walmart → "native"
- If no native option but product is regularly purchasable → "manual_repurchase"
- If product is unavailable or not suitable for subscription → "not_possible"

Return detailed analysis.`,
    });

    const intelligence = result.object;

    console.log(`✅ Product intelligence:`, intelligence);

    return {
      success: true,
      intelligence,
    };
  } catch (error) {
    console.error("Product intelligence analysis failed:", error);
    return {
      success: false,
      error: "Failed to analyze product subscription capability",
    };
  }
}

/**
 * Quick classification helper
 * For when we just need to know: native vs manual
 */
export async function classifySubscriptionType(productUrl: string): Promise<"native" | "manual_repurchase" | "not_possible"> {
  const result = await analyzeProductSubscriptionCapability(productUrl);
  
  if (!result.success || !result.intelligence) {
    return "not_possible";
  }

  return result.intelligence.subscriptionMethod;
}

/**
 * Check if a product is currently available for purchase
 */
export async function checkProductAvailability(productUrl: string): Promise<{
  available: boolean;
  price?: string;
  message: string;
}> {
  try {
    const productData = await getProductDetails(productUrl);

    const available = 
      productData.availability?.toLowerCase().includes("in stock") ||
      productData.availability?.toLowerCase().includes("available") ||
      !productData.availability;

    return {
      available,
      price: productData.price,
      message: available
        ? `Product is available at ${productData.price}`
        : `Product is currently ${productData.availability || "unavailable"}`,
    };
  } catch (error) {
    console.error("Availability check failed:", error);
    return {
      available: false,
      message: "Could not check product availability",
    };
  }
}

