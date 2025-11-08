import { headers } from "next/headers";
import Stripe from "stripe";
import { stripe } from "~/lib/integrations/stripe";
import { env } from "~/env";
import {
  getPaymentByStripeInvoiceId,
  updatePaymentStatus,
  getStripeCustomerByUserId,
  updateSubscriptionStatus,
  createOrder,
} from "~/server/db/queries";
import { db } from "~/server/db";
import { stripeFee, subscription as subscriptionTable, subscriptionIntent as subscriptionIntentTable } from "~/server/db/schema";
import { eq, and } from "drizzle-orm";

// Disable body parsing - Stripe needs raw body for signature verification
export const runtime = "nodejs";

/**
 * Stripe Webhook Handler
 * 
 * Handles all Stripe events:
 * - invoice.payment_succeeded → Mark payment as successful, schedule next renewal
 * - invoice.payment_failed → Pause subscription, notify user
 * - customer.subscription.deleted → Cancel all product subscriptions
 * - customer.subscription.updated → Handle status changes
 * 
 * Local dev setup:
 *   stripe listen --forward-to localhost:3000/api/webhooks/stripe
 *   # Copy the whsec_... key to .env as STRIPE_WEBHOOK_SECRET
 * 
 * Production setup:
 *   1. Deploy app
 *   2. Add webhook endpoint in Stripe Dashboard: https://yourdomain.com/api/webhooks/stripe
 *   3. Select events: invoice.*, customer.subscription.*
 *   4. Copy signing secret to Vercel env vars
 */
export async function POST(req: Request) {
  const body = await req.text();
  const headersList = await headers();
  const signature = headersList.get("stripe-signature");

  if (!signature) {
    console.error("❌ Missing Stripe signature");
    return Response.json({ error: "Missing signature" }, { status: 400 });
  }

  if (!env.STRIPE_WEBHOOK_SECRET) {
    console.error("❌ STRIPE_WEBHOOK_SECRET not configured");
    return Response.json({ error: "Webhook secret not configured" }, { status: 500 });
  }

  let event: Stripe.Event;

  try {
    // Verify webhook signature
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err: any) {
    console.error(`❌ Webhook signature verification failed: ${err.message}`);
    return Response.json({ error: `Webhook Error: ${err.message}` }, { status: 400 });
  }

  console.log(`✅ Webhook received: ${event.type}`);

  // Handle different event types
  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutSessionCompleted(event.data.object as Stripe.Checkout.Session);
        break;

      case "customer.subscription.created":
        await handleSubscriptionCreated(event.data.object as Stripe.Subscription);
        break;

      case "invoice.payment_succeeded":
        await handleInvoicePaymentSucceeded(event.data.object as Stripe.Invoice);
        break;

      case "invoice.payment_failed":
        await handleInvoicePaymentFailed(event.data.object as Stripe.Invoice);
        break;

      case "invoice.created":
        await handleInvoiceCreated(event.data.object as Stripe.Invoice);
        break;

      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;

      case "customer.subscription.updated":
        await handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
        break;

      case "payment_intent.succeeded":
        await handlePaymentIntentSucceeded(event.data.object as Stripe.PaymentIntent);
        break;

      case "payment_intent.payment_failed":
        await handlePaymentIntentFailed(event.data.object as Stripe.PaymentIntent);
        break;

      default:
        console.log(`ℹ️ Unhandled event type: ${event.type}`);
    }

    return Response.json({ received: true });
  } catch (error) {
    console.error(`❌ Error handling webhook: ${error}`);
    return Response.json(
      { error: "Webhook handler failed" },
      { status: 500 }
    );
  }
}

/**
 * Handle checkout.session.completed
 * Checkout Session completed → check if base subscription was created
 * If so, look for pending subscription intents and append invoice items
 */
async function handleCheckoutSessionCompleted(session: Stripe.Checkout.Session) {
  console.log(`✅ Checkout Session completed: ${session.id}`);

  // Only handle subscription mode checkouts
  if (session.mode !== "subscription") {
    console.log("Checkout Session is not for subscription, skipping");
    return;
  }

  // Extract userId from metadata
  const userId = session.metadata?.userId;
  if (!userId) {
    console.log("No userId in session metadata, skipping");
    return;
  }

  console.log(`Processing subscription setup for user ${userId}`);

  // Get the subscription created by this checkout
  const subscriptionId = session.subscription as string;
  if (!subscriptionId) {
    console.log("No subscription ID in session, skipping");
    return;
  }

  // Check if subscription already exists (avoid duplicates)
  const existing = await db.query.stripeFee.findFirst({
    where: eq(stripeFee.stripeSubscriptionId, subscriptionId),
  });

  if (existing) {
    console.log(`Subscription ${subscriptionId} already exists in database, skipping`);
    return;
  }

  // Save to stripeFee table
  await db.insert(stripeFee).values({
    userId,
    stripeSubscriptionId: subscriptionId,
    amount: "100", // $1.00
    status: "active",
    createdAt: new Date(),
  });

  console.log(`✅ Base subscription ${subscriptionId} saved for user ${userId}`);

  // TODO: Check for pending subscription intents that need invoice items
  // This will be handled by the subscription.created webhook
}

/**
 * Handle customer.subscription.created
 * Base subscription created → look for pending checkouts and append invoice items
 */
async function handleSubscriptionCreated(subscription: Stripe.Subscription) {
  console.log(`✅ Subscription created: ${subscription.id}`);

  // Only handle service fee subscriptions
  const subscriptionType = subscription.metadata?.type;
  if (subscriptionType !== "service_fee") {
    console.log("Subscription is not service fee type, skipping");
    return;
  }

  const userId = subscription.metadata?.userId;
  if (!userId) {
    console.log("No userId in subscription metadata, skipping");
    return;
  }

  console.log(`Processing pending subscription intents for user ${userId}`);

  // Get all active subscription intents for this user that don't have subscriptions yet
  const { subscriptionIntent: subscriptionIntentTable, subscription: subscriptionTable, agentRun: agentRunTable } = await import("~/server/db/schema");
  
  const pendingIntents = await db.query.subscriptionIntent.findMany({
    where: and(
      eq(subscriptionIntentTable.userId, userId),
      eq(subscriptionIntentTable.status, "active")
    ),
  });

  console.log(`Found ${pendingIntents.length} pending intents for user ${userId}`);

  // For each intent, check if there's a successful agent run (checkout completed)
  // but no subscription record yet (meaning invoice item wasn't appended)
  for (const intent of pendingIntents) {
    // Check if this intent has a successful checkout
    const successfulCheckout = await db.query.agentRun.findFirst({
      where: and(
        eq(agentRunTable.intentId, intent.id),
        eq(agentRunTable.phase, "done")
      ),
      orderBy: (agentRun, { desc }) => [desc(agentRun.createdAt)],
    });

    if (!successfulCheckout) {
      console.log(`No successful checkout for intent ${intent.id}, skipping`);
      continue;
    }

    // Check if invoice item already exists by looking at subscription records
    const existingSubscription = await db.query.subscription.findFirst({
      where: eq(subscriptionTable.intentId, intent.id),
    });

    if (existingSubscription) {
      console.log(`Subscription already exists for intent ${intent.id}, skipping`);
      continue;
    }

    // Append invoice item for this intent
    console.log(`📦 Appending invoice item for intent ${intent.id}: ${intent.title}`);
    
    try {
      const { appendInvoiceItemForSubscription } = await import("~/lib/integrations/stripe");
      
      // Use maxPriceCents from intent as product price
      const productPriceCents = intent.maxPriceCents || 0;
      
      if (productPriceCents === 0) {
        console.warn(`Warning: Product price is 0 for intent ${intent.id}`);
        continue;
      }

      await appendInvoiceItemForSubscription({
        userId,
        subscriptionIntentId: intent.id,
        productName: intent.title,
        productPriceCents,
        cadenceDays: intent.cadenceDays,
      });

      console.log(`✅ Invoice item appended for intent ${intent.id}`);
    } catch (error) {
      console.error(`Failed to append invoice item for intent ${intent.id}:`, error);
    }
  }
}

/**
 * Handle invoice.payment_succeeded
 * Payment successful → update records, schedule next renewal
 */
async function handleInvoicePaymentSucceeded(invoice: Stripe.Invoice) {
  console.log(`✅ Payment succeeded for invoice: ${invoice.id}`);

  // Update payment status in database
  const payment = await getPaymentByStripeInvoiceId(invoice.id);
  if (payment) {
    await updatePaymentStatus({
      id: payment.id,
      status: "succeeded",
    });

    console.log(`Updated payment record ${payment.id} to succeeded`);
  }

  // If this was for a subscription renewal, create order record
  if (invoice.metadata && invoice.metadata.subscriptionIntentId) {
    await createOrder({
      subscriptionId: invoice.metadata.subscriptionIntentId,
      merchant: invoice.metadata.merchant || "Unknown",
      productUrl: invoice.metadata.productUrl || undefined,
      orderId: invoice.metadata.orderId || undefined,
      priceCents: invoice.amount_paid,
      status: "succeeded",
      receipt: {
        invoiceId: invoice.id,
        invoiceNumber: invoice.number,
        paidAt: invoice.status_transitions?.paid_at 
          ? new Date(invoice.status_transitions.paid_at * 1000)
          : new Date(),
      },
    });

    console.log(`Created order record for subscription ${invoice.metadata.subscriptionIntentId}`);
  }

  // TODO: Send confirmation email
  // TODO: Schedule next renewal
}

/**
 * Handle invoice.payment_failed
 * Payment failed → pause subscriptions, notify user, schedule retry
 */
async function handleInvoicePaymentFailed(invoice: Stripe.Invoice) {
  console.log(`❌ Payment failed for invoice: ${invoice.id}`);

  // Update payment status
  const payment = await getPaymentByStripeInvoiceId(invoice.id);
  if (payment) {
    await updatePaymentStatus({
      id: payment.id,
      status: "failed",
    });
  }

  // Pause affected subscription
  if (invoice.metadata && invoice.metadata.subscriptionIntentId) {
    const intentId = invoice.metadata.subscriptionIntentId;
    
    // Update subscription intent to error status
    const { updateSubscriptionIntent } = await import("~/server/db/queries");
    await updateSubscriptionIntent({
      id: intentId,
      updates: { status: "error" },
    });

    console.log(`Paused subscription intent ${intentId} due to payment failure`);
  }

  // Stripe will automatically retry failed payments based on dashboard settings
  // TODO: Send payment failed email with retry link
  // TODO: Log payment failure for analytics
}

/**
 * Handle invoice.created
 * New invoice generated → add active subscriptions with prorated pricing
 * 
 * When Stripe generates the monthly recurring invoice, this handler:
 * 1. Identifies the user from the customer ID
 * 2. Gets all their active subscriptions
 * 3. Adds invoice items for each subscription with prorated pricing
 */
async function handleInvoiceCreated(invoice: Stripe.Invoice) {
  console.log(`📝 Invoice created: ${invoice.id}`);

  // Only process subscription invoices (recurring monthly cycle)
  const subscriptionId = typeof (invoice as any).subscription === 'string' 
    ? (invoice as any).subscription 
    : (invoice as any).subscription?.id;
    
  if (!subscriptionId) {
    console.log("Not a subscription invoice, skipping");
    return;
  }

  // Get customer ID
  const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
  if (!customerId) {
    console.log("No customer ID found on invoice");
    return;
  }

  try {
    // Find the user by Stripe customer ID via stripeFee table
    const serviceFeeRecord = await db.query.stripeFee.findFirst({
      where: eq(stripeFee.stripeSubscriptionId, subscriptionId),
    });

    if (!serviceFeeRecord) {
      console.log(`No service fee record found for subscription ${subscriptionId}`);
      return;
    }

    const userId = serviceFeeRecord.userId;
    console.log(`Processing invoice for user ${userId}`);

    // Get all active subscriptions for this user
    const activeSubscriptions = await db.query.subscription.findMany({
      where: and(
        eq(subscriptionTable.userId, userId),
        eq(subscriptionTable.status, "active")
      ),
    });

    console.log(`Found ${activeSubscriptions.length} active subscriptions`);

    // For each active subscription, add an invoice item
    for (const sub of activeSubscriptions) {
      // Skip if no price information
      if (!sub.lastPriceCents || sub.lastPriceCents === 0) {
        console.log(`Subscription ${sub.id} has no price, skipping`);
        continue;
      }

      // Get subscription intent for product details
      const intent = await db.query.subscriptionIntent.findFirst({
        where: eq(subscriptionIntentTable.id, sub.intentId || ""),
      });

      if (!intent) {
        console.log(`No intent found for subscription ${sub.id}, skipping`);
        continue;
      }

      // Calculate prorated monthly amount
      const { calculateMonthlyProratedAmount } = await import("~/lib/integrations/stripe");
      const { totalCents, description } = calculateMonthlyProratedAmount({
        productPriceCents: sub.lastPriceCents,
        cadenceDays: sub.renewalFrequencyDays,
      });

      // Create invoice item
      console.log(`💰 Adding invoice item: ${intent.title} - $${totalCents / 100} (${description})`);
      
      await stripe.invoiceItems.create({
        customer: customerId,
        invoice: invoice.id,
        amount: totalCents,
        currency: "usd",
        description: `${intent.title} - ${description}`,
        metadata: {
          userId,
          subscriptionId: sub.id,
          subscriptionIntentId: intent.id,
          productPriceCents: sub.lastPriceCents.toString(),
          cadenceDays: sub.renewalFrequencyDays.toString(),
          billingMonth: new Date().toISOString().slice(0, 7), // YYYY-MM
        },
      });

      console.log(`✅ Invoice item added for subscription ${sub.id}`);
    }

    console.log(`✅ Invoice ${invoice.id} populated with ${activeSubscriptions.length} subscription items`);
  } catch (error) {
    console.error(`Failed to process invoice ${invoice.id}:`, error);
    // Don't throw - let the invoice proceed even if we couldn't add items
  }
}

/**
 * Handle customer.subscription.deleted
 * Service subscription canceled → cancel all product subscriptions
 */
async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  console.log(`🗑️ Subscription deleted: ${subscription.id}`);

  // Find user by subscription ID
  const serviceFeeRecord = await db.query.stripeFee.findFirst({
    where: eq(stripeFee.stripeSubscriptionId, subscription.id),
  });

  if (!serviceFeeRecord) {
    console.log(`No service fee record found for subscription ${subscription.id}`);
    return;
  }

  // Update stripeFee record
  await db
    .update(stripeFee)
    .set({
      status: "canceled",
      canceledAt: new Date(),
    })
    .where(eq(stripeFee.id, serviceFeeRecord.id));

  // Cancel all product subscriptions for this user
  const userSubscriptions = await db.query.subscription.findMany({
    where: eq(subscriptionTable.userId, serviceFeeRecord.userId),
  });

  for (const sub of userSubscriptions) {
    await updateSubscriptionStatus({
      id: sub.id,
      status: "canceled",
    });
  }

  console.log(`Canceled ${userSubscriptions.length} product subscriptions for user ${serviceFeeRecord.userId}`);
}

/**
 * Handle customer.subscription.updated
 * Subscription status changed → sync with our database
 */
async function handleSubscriptionUpdated(subscription: Stripe.Subscription) {
  console.log(`🔄 Subscription updated: ${subscription.id}, status: ${subscription.status}`);

  // Update stripeFee status if needed
  const serviceFeeRecord = await db.query.stripeFee.findFirst({
    where: eq(stripeFee.stripeSubscriptionId, subscription.id),
  });

  if (serviceFeeRecord) {
    let status = "active";
    if (subscription.status === "canceled") status = "canceled";
    if (subscription.status === "past_due") status = "past_due";

    await db
      .update(stripeFee)
      .set({ status })
      .where(eq(stripeFee.id, serviceFeeRecord.id));
  }
}

/**
 * Handle payment_intent.succeeded
 * Standalone payment succeeded (not via invoice)
 */
async function handlePaymentIntentSucceeded(paymentIntent: Stripe.PaymentIntent) {
  console.log(`✅ PaymentIntent succeeded: ${paymentIntent.id}`);

  // Update payment record if exists
  const { getPaymentByStripePaymentIntentId } = await import("~/server/db/queries");
  const payment = await getPaymentByStripePaymentIntentId(paymentIntent.id);
  
  if (payment) {
    await updatePaymentStatus({
      id: payment.id,
      status: "succeeded",
    });
  }
}

/**
 * Handle payment_intent.payment_failed
 * Standalone payment failed
 */
async function handlePaymentIntentFailed(paymentIntent: Stripe.PaymentIntent) {
  console.log(`❌ PaymentIntent failed: ${paymentIntent.id}`);

  const { getPaymentByStripePaymentIntentId } = await import("~/server/db/queries");
  const payment = await getPaymentByStripePaymentIntentId(paymentIntent.id);
  
  if (payment) {
    await updatePaymentStatus({
      id: payment.id,
      status: "failed",
    });
  }
}

