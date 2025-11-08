import "server-only";

import { createStagehand } from "~/lib/integrations/browserbase";
import { db } from "~/server/db";
import { agentRun, order } from "~/server/db/schema";
import { env } from "~/env";

/**
 * Get merchant credentials from environment
 * TODO: Add your company's merchant account credentials to .env
 * 
 * For security: Use Vercel's encrypted environment variables
 * Never commit credentials to git
 */
function getMerchantCredentials(merchant: string): { email: string; password: string } | null {
  const merchantLower = merchant.toLowerCase();

  if (merchantLower.includes("amazon")) {
    if (env.AMAZON_EMAIL && env.AMAZON_PASSWORD) {
      return { email: env.AMAZON_EMAIL, password: env.AMAZON_PASSWORD };
    }
  } else if (merchantLower.includes("target")) {
    if (env.TARGET_EMAIL && env.TARGET_PASSWORD) {
      return { email: env.TARGET_EMAIL, password: env.TARGET_PASSWORD };
    }
  } else if (merchantLower.includes("walmart")) {
    if (env.WALMART_EMAIL && env.WALMART_PASSWORD) {
      return { email: env.WALMART_EMAIL, password: env.WALMART_PASSWORD };
    }
  } else if (merchantLower.includes("best buy") || merchantLower.includes("bestbuy")) {
    if (env.BESTBUY_EMAIL && env.BESTBUY_PASSWORD) {
      return { email: env.BESTBUY_EMAIL, password: env.BESTBUY_PASSWORD };
    }
  }

  console.warn(`⚠️ No credentials configured for merchant: ${merchant}`);
  console.warn(`TODO: Add ${merchantLower.toUpperCase().replace(/\s+/g, "_")}_EMAIL and ${merchantLower.toUpperCase().replace(/\s+/g, "_")}_PASSWORD to .env`);
  return null;
}

/**
 * Checkout Result
 */
export interface CheckoutResult {
  success: boolean;
  orderId?: string;
  orderDetails?: {
    merchant: string;
    productName: string;
    priceCents: number;
    orderNumber?: string;
    estimatedDelivery?: string;
  };
  sessionId?: string;
  error?: string;
  requiresManualIntervention?: boolean;
  interventionReason?: string;
}

/**
 * Checkout Agent
 * 
 * Handles autonomous checkout flows using Browserbase/Stagehand.
 * Two modes:
 * 1. Native Subscription: Uses merchant's Subscribe & Save
 * 2. Manual Purchase: Places one-time order (for scheduled repurchase)
 * 
 * This is where the magic happens - automated purchasing on behalf of users.
 */
export async function executeCheckout({
  productUrl,
  subscriptionIntentId,
  address,
  paymentMethod,
  useNativeSubscription = false,
  agentRunId: providedAgentRunId,
}: {
  productUrl: string;
  subscriptionIntentId: string;
  address: {
    street1: string;
    street2?: string;
    city: string;
    state: string;
    zipCode: string;
  };
  paymentMethod: {
    type: "stripe_saved" | "merchant_account";
    details: any;
  };
  useNativeSubscription?: boolean;
  agentRunId?: string; // Optional: if provided, don't create a new agent run
}): Promise<CheckoutResult> {
  const stagehand = createStagehand();
  let browserbaseSessionId: string | undefined;
  let agentRunId: string | undefined = providedAgentRunId;

  try {
    await stagehand.init();
    browserbaseSessionId = stagehand.browserbaseSessionId;

    // Only create agent run if not provided (for backward compatibility)
    if (!agentRunId) {
      const [agentRunRecord] = await db
        .insert(agentRun)
        .values({
          intentId: subscriptionIntentId, // Use intentId, not subscriptionId (subscription table doesn't exist yet)
          phase: "checkout",
          input: {
            productUrl,
            address,
            useNativeSubscription,
          },
          browserbaseSessionId: browserbaseSessionId || null,
          createdAt: new Date(),
        })
        .returning();

      agentRunId = agentRunRecord?.id;
    } else {
      // Update existing agent run with browserbase session ID
      const { eq } = await import("drizzle-orm");
      await db
        .update(agentRun)
        .set({
          browserbaseSessionId: browserbaseSessionId || null,
        })
        .where(eq(agentRun.id, agentRunId));
    }

    console.log(`🛒 Starting checkout for ${productUrl}`);

    if (useNativeSubscription) {
      // Native subscription flow (e.g., Amazon Subscribe & Save)
      return await nativeSubscriptionCheckout({
        stagehand,
        productUrl,
        address,
        agentRunId,
        subscriptionIntentId,
      });
    } else {
      // Manual one-time purchase
      return await manualPurchaseCheckout({
        stagehand,
        productUrl,
        address,
        agentRunId,
        subscriptionIntentId,
      });
    }
  } catch (error) {
    console.error("Checkout failed:", error);

    // Update agent run with error
    if (agentRunId) {
      const { eq } = await import("drizzle-orm");
      await db
        .update(agentRun)
        .set({
          phase: "failed",
          error: error instanceof Error ? error.message : "Unknown error",
          endedAt: new Date(),
        })
        .where(eq(agentRun.id, agentRunId));
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : "Checkout failed",
    };
  } finally {
    try {
      await stagehand.close();
    } catch {}
  }
}

/**
 * Native subscription checkout
 * Uses merchant's built-in subscription system
 */
async function nativeSubscriptionCheckout({
  stagehand,
  productUrl,
  address,
  agentRunId,
  subscriptionIntentId,
}: {
  stagehand: any;
  productUrl: string;
  address: any;
  agentRunId: string | undefined;
  subscriptionIntentId: string;
}): Promise<CheckoutResult> {
  try {
    // Extract merchant from URL
    const merchant = extractMerchantFromUrl(productUrl);
    const credentials = getMerchantCredentials(merchant);

    // Navigate to product page
    const loginStep = credentials
      ? `- If prompted to sign in, use email: ${credentials.email} and password: ${credentials.password}`
      : `- TODO: Add merchant credentials to .env for ${merchant}`;

    const instruction = `
Navigate to ${productUrl}

Steps:
1. ${loginStep}
2. Find and click the "Subscribe & Save" or subscription option
3. Select delivery frequency if prompted
4. Add to cart or proceed to checkout
5. Fill in shipping address: ${address.street1}, ${address.city}, ${address.state} ${address.zipCode}
6. Select saved payment method (company card on file)
7. STOP before final "Place Order" button - await manual approval

Extract the subscription details and total cost if visible.`;

    const result = await stagehand.act(instruction);

    console.log("Native subscription result:", result);

    // Update agent run
    if (agentRunId) {
      const { eq } = await import("drizzle-orm");
      const { agentRun: agentRunTable } = await import("~/server/db/schema");
      await db
        .update(agentRunTable)
        .set({
          phase: "done",
          output: { result },
          endedAt: new Date(),
        })
        .where(eq(agentRunTable.id, agentRunId));
    }

    return {
      success: true,
      requiresManualIntervention: true,
      interventionReason: "Payment confirmation required",
      sessionId: stagehand.browserbaseSessionId,
    };
  } catch (error) {
    console.error("Native subscription checkout failed:", error);
    throw error;
  }
}

/**
 * Manual one-time purchase
 * For products without native subscriptions
 */
async function manualPurchaseCheckout({
  stagehand,
  productUrl,
  address,
  agentRunId,
  subscriptionIntentId,
}: {
  stagehand: any;
  productUrl: string;
  address: any;
  agentRunId: string | undefined;
  subscriptionIntentId: string;
}): Promise<CheckoutResult> {
  try {
    // Extract merchant from URL
    const merchant = extractMerchantFromUrl(productUrl);
    const credentials = getMerchantCredentials(merchant);

    // Navigate and add to cart
    const loginStep = credentials
      ? `- If prompted to sign in, use email: ${credentials.email} and password: ${credentials.password}`
      : `- TODO: Add merchant credentials to .env for ${merchant}`;

    const instruction = `
Navigate to ${productUrl}

Steps:
1. ${loginStep}
2. Select default options (size, color, quantity: 1)
3. Click "Add to Cart" or "Buy Now"  
4. Proceed to checkout
5. Fill in shipping address: ${address.street1}, ${address.city}, ${address.state} ${address.zipCode}
6. Select saved payment method (company card on file)
7. STOP before final "Place Order" button - await manual approval

Extract the order subtotal, tax, total, and estimated delivery if visible.`;

    const result = await stagehand.act(instruction);

    console.log("Manual purchase result:", result);

    // Update agent run
    if (agentRunId) {
      const { eq } = await import("drizzle-orm");
      const { agentRun: agentRunTable } = await import("~/server/db/schema");
      await db
        .update(agentRunTable)
        .set({
          phase: "done",
          output: { result },
          endedAt: new Date(),
        })
        .where(eq(agentRunTable.id, agentRunId));
    }

    return {
      success: true,
      requiresManualIntervention: true,
      interventionReason: "Payment confirmation required",
      sessionId: stagehand.browserbaseSessionId,
    };
  } catch (error) {
    console.error("Manual purchase checkout failed:", error);
    throw error;
  }
}

/**
 * Resume checkout from a paused session
 * Used when user approves payment
 */
export async function resumeCheckoutWithPayment({
  sessionId,
  agentRunId,
}: {
  sessionId: string;
  agentRunId: string;
}): Promise<CheckoutResult> {
  // TODO: Implement session resume
  // This requires storing session state and resuming Browserbase session
  return {
    success: false,
    error: "Session resume not yet implemented",
  };
}

/**
 * Extract merchant name from URL
 */
function extractMerchantFromUrl(url: string): string {
  try {
    const hostname = new URL(url).hostname;
    if (hostname.includes("amazon")) return "Amazon";
    if (hostname.includes("target")) return "Target";
    if (hostname.includes("walmart")) return "Walmart";
    if (hostname.includes("bestbuy")) return "Best Buy";
    if (hostname.includes("costco")) return "Costco";
    return hostname.replace("www.", "").split(".")[0] || "Unknown";
  } catch {
    return "Unknown";
  }
}

/**
 * Verify checkout completion
 * Checks if order was successfully placed
 */
export async function verifyCheckoutCompletion({
  sessionId,
  expectedTotal,
}: {
  sessionId: string;
  expectedTotal?: number;
}): Promise<{
  completed: boolean;
  orderNumber?: string;
  actualTotal?: number;
}> {
  // TODO: Implement verification
  // Check order confirmation page, extract order number
  return {
    completed: false,
  };
}

