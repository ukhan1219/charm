import { NextResponse } from "next/server";
import { eq, and, lte } from "drizzle-orm";
import { db } from "~/server/db";
import { subscription, subscriptionIntent, address } from "~/server/db/schema";
import { executeCheckout } from "~/server/agents";
import { chargeForCheckout } from "~/lib/integrations/stripe";
import { getSubscriptionsDueForRenewal, createOrder, updateSubscriptionStatus } from "~/server/db/queries";

/**
 * Renewal Cron Job Endpoint
 * 
 * Finds subscriptions due for renewal and triggers agent checkout
 * 
 * Vercel Cron Configuration (vercel.json) - runs every 6 hours
 * Or use Vercel Dashboard to configure Cron Jobs
 * 
 * Can also be called manually for testing:
 *   curl -X POST http://localhost:3000/api/renewals/due?key=your-secret-key
 */
export async function POST(req: Request) {
  const { searchParams } = new URL(req.url);
  const cronSecret = searchParams.get("key");

  // Basic auth for cron job
  // In production, use Vercel's cron secret or remove this if using Vercel Cron
  if (process.env.NODE_ENV === "production" && cronSecret !== process.env.CRON_SECRET_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  console.log("🔄 Renewal cron job started");

  try {
    // Find subscriptions due for renewal (within next 24 hours)
    const dueSubscriptions = await getSubscriptionsDueForRenewal();

    console.log(`Found ${dueSubscriptions.length} subscriptions due for renewal`);

    const results = {
      total: dueSubscriptions.length,
      processed: 0,
      succeeded: 0,
      failed: 0,
      errors: [] as string[],
    };

    // Process each subscription
    for (const sub of dueSubscriptions) {
      try {
        console.log(`Processing renewal for subscription ${sub.id}`);

        // Get full subscription details with address
        const fullSub = await db.query.subscription.findFirst({
          where: eq(subscription.id, sub.id),
        });

        if (!fullSub || !fullSub.addressId) {
          console.error(`Subscription ${sub.id} missing address`);
          results.errors.push(`Subscription ${sub.id}: missing address`);
          continue;
        }

        // Get address
        const addressData = await db.query.address.findFirst({
          where: eq(address.id, fullSub.addressId),
        });

        if (!addressData) {
          console.error(`Address ${fullSub.addressId} not found`);
          results.errors.push(`Subscription ${sub.id}: address not found`);
          continue;
        }

        // Get product URL from subscription intent
        const intent = await db.query.subscriptionIntent.findFirst({
          where: eq(subscriptionIntent.id, fullSub.intentId || ""),
        });

        if (!intent) {
          console.error(`Intent not found for subscription ${sub.id}`);
          results.errors.push(`Subscription ${sub.id}: intent not found`);
          continue;
        }

        // Execute checkout via agent
        console.log(`🛒 Executing checkout for ${intent.title}`);
        
        const checkoutResult = await executeCheckout({
          productUrl: intent.productUrl,
          subscriptionIntentId: intent.id, // Fixed: use intentId for renewals
          address: {
            street1: addressData.street1,
            street2: addressData.street2 || undefined,
            city: addressData.city,
            state: addressData.state,
            zipCode: addressData.zipCode,
          },
          paymentMethod: {
            type: "stripe_saved",
            details: {},
          },
          useNativeSubscription: false, // For renewals, use manual purchase
          // Don't pass agentRunId - let executeCheckout create its own for renewals
        });

        results.processed++;

        if (checkoutResult.success) {
          // Get product price from checkout result or use last known price
          const productPriceCents = fullSub.lastPriceCents || 0;

          if (productPriceCents > 0) {
            // Append invoice item to user's monthly Stripe invoice
            await chargeForCheckout({
              userId: fullSub.userId,
              subscriptionIntentId: intent.id,
              productName: intent.title,
              productPriceCents,
              cadenceDays: intent.cadenceDays,
              orderId: checkoutResult.orderId,
              chargeImmediately: false, // Append to monthly invoice
            });

            console.log(`💰 Appended ${productPriceCents}¢ invoice item for ${intent.title}`);
          }

          // Update next renewal date
          const nextRenewalAt = new Date();
          nextRenewalAt.setDate(nextRenewalAt.getDate() + fullSub.renewalFrequencyDays);

          await db
            .update(subscription)
            .set({
              nextRenewalAt,
              updatedAt: new Date(),
            })
            .where(eq(subscription.id, sub.id));

          results.succeeded++;
          console.log(`✅ Renewal successful for ${intent.title}, next renewal: ${nextRenewalAt.toISOString()}`);
        } else {
          // Checkout failed
          results.failed++;
          results.errors.push(`Subscription ${sub.id}: ${checkoutResult.error || "checkout failed"}`);

          // Update subscription status to error
          await updateSubscriptionStatus({
            id: sub.id,
            status: "paused",
          });

          console.error(`❌ Checkout failed for ${intent.title}: ${checkoutResult.error}`);
        }
      } catch (error) {
        results.failed++;
        const errorMsg = error instanceof Error ? error.message : "Unknown error";
        results.errors.push(`Subscription ${sub.id}: ${errorMsg}`);
        console.error(`❌ Error processing subscription ${sub.id}:`, error);
      }
    }

    console.log("✅ Renewal cron job completed:", results);

    return NextResponse.json({
      success: true,
      message: "Renewal processing completed",
      results,
    });
  } catch (error) {
    console.error("❌ Renewal cron job failed:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Renewal processing failed",
      },
      { status: 500 }
    );
  }
}

/**
 * GET endpoint for testing
 * Shows subscriptions that would be processed
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const cronSecret = searchParams.get("key");

  // Basic auth
  if (process.env.NODE_ENV === "production" && cronSecret !== process.env.CRON_SECRET_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const dueSubscriptions = await getSubscriptionsDueForRenewal();

    return NextResponse.json({
      count: dueSubscriptions.length,
      subscriptions: dueSubscriptions.map((sub) => ({
        id: sub.id,
        userId: sub.userId,
        renewalFrequencyDays: sub.renewalFrequencyDays,
        nextRenewalAt: sub.nextRenewalAt,
        status: sub.status,
      })),
    });
  } catch (error) {
    console.error("Failed to get due subscriptions:", error);
    return NextResponse.json(
      { error: "Failed to retrieve subscriptions" },
      { status: 500 }
    );
  }
}

