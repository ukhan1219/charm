import "server-only";

import Stripe from "stripe";
import { env } from "~/env";
import {
  getOrCreateStripeCustomer,
  getStripeCustomerByUserId,
  createPayment,
  getPaymentByStripeInvoiceId,
} from "~/server/db/queries";
import { db } from "~/server/db";
import { stripeFee } from "~/server/db/schema";
import { eq } from "drizzle-orm";

/**
 * Initialize Stripe client
 */
if (!env.STRIPE_SECRET_KEY) {
  throw new Error("STRIPE_SECRET_KEY is not configured");
}

export const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
  apiVersion: "2025-10-29.clover",
  typescript: true,
});

/**
 * Stripe Service Fee
 * Base subscription that provides invoice infrastructure
 * NOTE: Price ID should be set in environment variables (already created in Stripe Dashboard)
 */
export const SERVICE_FEE_CENTS = 100; // $1.00/month
export const SERVICE_FEE_NAME = "Charm Subscription Management Service";
export const SERVICE_FEE_DESCRIPTION = "Monthly service fee for subscription management";

// Use existing price from Stripe Dashboard
// Set this in your .env file: STRIPE_SERVICE_FEE_PRICE_ID=price_xxxxx
const SERVICE_FEE_PRICE_ID = env.STRIPE_SERVICE_FEE_PRICE_ID || null;

/**
 * Create or get Stripe Customer for user
 * Called during onboarding or first subscription
 */
export async function createStripeCustomerForUser({
  userId,
  email,
  name,
}: {
  userId: string;
  email: string;
  name?: string;
}) {
  // Check if customer already exists
  const existing = await getStripeCustomerByUserId(userId);
  if (existing) {
    return {
      customerId: existing.stripeCustomerId,
      isNew: false,
    };
  }

  // Create new Stripe customer
  const customer = await stripe.customers.create({
    email,
    name,
    metadata: {
      userId,
    },
  });

  // Save to database
  await getOrCreateStripeCustomer({
    userId,
    stripeCustomerId: customer.id,
  });

  return {
    customerId: customer.id,
    isNew: true,
  };
}

/**
 * Create SetupIntent for saving payment method
 * Used during onboarding to save card for future off-session charges
 */
export async function createPaymentMethodSetup(customerId: string) {
  const setupIntent = await stripe.setupIntents.create({
    customer: customerId,
    payment_method_types: ["card"],
    usage: "off_session", // For future charges without user present
  });

  return {
    clientSecret: setupIntent.client_secret,
    setupIntentId: setupIntent.id,
  };
}

/**
 * Create base $1/month service subscription
 * This provides the invoice infrastructure for appending product costs
 * Uses existing price ID from Stripe Dashboard
 */
export async function createBaseServiceSubscription({
  userId,
  customerId,
  paymentMethodId,
}: {
  userId: string;
  customerId: string;
  paymentMethodId: string;
}) {
  if (!SERVICE_FEE_PRICE_ID) {
    throw new Error(
      "STRIPE_SERVICE_FEE_PRICE_ID not configured. Please set the price ID from your Stripe Dashboard."
    );
  }

  // Create subscription using existing price
  const subscription = await stripe.subscriptions.create({
    customer: customerId,
    items: [{ price: SERVICE_FEE_PRICE_ID }],
    default_payment_method: paymentMethodId,
    metadata: {
      userId,
      type: "service_fee",
    },
  });

  // Save to database
  await db.insert(stripeFee).values({
    userId,
    stripeSubscriptionId: subscription.id,
    amount: SERVICE_FEE_CENTS.toString(),
    status: "active",
    createdAt: new Date(),
  });

  return {
    subscriptionId: subscription.id,
    status: subscription.status,
  };
}

/**
 * Calculate prorated charge for subscription based on cadence
 * 
 * Monthly invoice cycle (30 days) vs subscription cadence
 * - 30 days cadence → charge 1x per month
 * - 15 days cadence → charge 2x per month
 * - 21 days cadence → charge ~1.43x per month (30/21)
 * - 45 days cadence → charge 0.67x per month (30/45)
 */
export function calculateMonthlyProratedAmount({
  productPriceCents,
  cadenceDays,
}: {
  productPriceCents: number;
  cadenceDays: number;
}): {
  totalCents: number;
  occurrences: number;
  description: string;
} {
  const BILLING_CYCLE_DAYS = 30;

  // Calculate how many times the subscription occurs in a 30-day period
  const occurrences = BILLING_CYCLE_DAYS / cadenceDays;

  // Calculate prorated amount
  const totalCents = Math.round(productPriceCents * occurrences);

  // Generate description
  let description: string;
  if (cadenceDays === 30) {
    description = "Monthly delivery";
  } else if (cadenceDays < 30) {
    const fullOccurrences = Math.floor(occurrences);
    const partialPercent = Math.round((occurrences - fullOccurrences) * 100);
    
    if (partialPercent === 0) {
      description = `${fullOccurrences}x per month (every ${cadenceDays} days)`;
    } else {
      description = `~${occurrences.toFixed(2)}x per month (every ${cadenceDays} days)`;
    }
  } else {
    description = `Partial monthly charge (every ${cadenceDays} days, ${occurrences.toFixed(2)}x per 30 days)`;
  }

  return {
    totalCents,
    occurrences,
    description,
  };
}

/**
 * Append product cost to user's monthly service subscription invoice
 * This is called after agent completes checkout
 */
export async function appendInvoiceItemForSubscription({
  userId,
  subscriptionIntentId,
  productName,
  productPriceCents,
  cadenceDays,
  orderId,
}: {
  userId: string;
  subscriptionIntentId: string;
  productName: string;
  productPriceCents: number;
  cadenceDays: number;
  orderId?: string;
}) {
  // Get user's Stripe customer
  const stripeCustomer = await getStripeCustomerByUserId(userId);
  if (!stripeCustomer) {
    throw new Error("Stripe customer not found for user");
  }

  // Calculate prorated amount for monthly billing cycle
  const { totalCents, description } = calculateMonthlyProratedAmount({
    productPriceCents,
    cadenceDays,
  });

  // Create invoice item (will be added to next subscription invoice)
  const invoiceItem = await stripe.invoiceItems.create({
    customer: stripeCustomer.stripeCustomerId,
    amount: totalCents,
    currency: "usd",
    description: `${productName} - ${description}`,
    metadata: {
      userId,
      subscriptionIntentId,
      orderId: orderId || "",
      productPriceCents: productPriceCents.toString(),
      cadenceDays: cadenceDays.toString(),
      billingMonth: new Date().toISOString().slice(0, 7), // YYYY-MM
    },
  });

  return {
    invoiceItemId: invoiceItem.id,
    amount: totalCents,
    description,
  };
}

/**
 * Charge immediately by creating and finalizing a draft invoice
 * Use this when you need to charge right after checkout instead of waiting for monthly cycle
 */
export async function chargeImmediatelyForOrder({
  userId,
  subscriptionIntentId,
  productName,
  productPriceCents,
  cadenceDays,
  orderId,
}: {
  userId: string;
  subscriptionIntentId: string;
  productName: string;
  productPriceCents: number;
  cadenceDays: number;
  orderId?: string;
}) {
  // Get user's Stripe customer
  const stripeCustomer = await getStripeCustomerByUserId(userId);
  if (!stripeCustomer) {
    throw new Error("Stripe customer not found for user");
  }

  // Calculate amount (just the product cost, no proration for immediate charge)
  const totalCents = productPriceCents;

  // Create draft invoice
  const invoice = await stripe.invoices.create({
    customer: stripeCustomer.stripeCustomerId,
    collection_method: "charge_automatically",
    auto_advance: true,
    metadata: {
      userId,
      subscriptionIntentId,
      orderId: orderId || "",
      chargeType: "immediate",
    },
  });

  // Add product cost
  await stripe.invoiceItems.create({
    customer: stripeCustomer.stripeCustomerId,
    invoice: invoice.id,
    amount: totalCents,
    currency: "usd",
    description: `${productName} - One-time charge`,
    metadata: {
      subscriptionIntentId,
      orderId: orderId || "",
    },
  });

  // Finalize and charge
  const finalizedInvoice = await stripe.invoices.finalizeInvoice(invoice.id);

  // Create payment record in database
  await createPayment({
    subscriptionId: subscriptionIntentId,
    stripeInvoiceId: finalizedInvoice.id,
    amount: totalCents.toString(),
    productCost: productPriceCents.toString(),
    serviceFee: "0", // No service fee on immediate charges
    status: finalizedInvoice.status === "paid" ? "succeeded" : "pending",
  });

  return {
    invoiceId: finalizedInvoice.id,
    status: finalizedInvoice.status,
    amountPaid: finalizedInvoice.amount_paid,
    hostedInvoiceUrl: finalizedInvoice.hosted_invoice_url,
  };
}

/**
 * Get or attach default payment method to customer
 */
export async function getCustomerDefaultPaymentMethod(customerId: string) {
  const customer = await stripe.customers.retrieve(customerId);
  
  if (customer.deleted) {
    throw new Error("Customer deleted");
  }

  const defaultPaymentMethodId = customer.invoice_settings?.default_payment_method;
  
  if (!defaultPaymentMethodId) {
    return null;
  }

  const paymentMethod = await stripe.paymentMethods.retrieve(
    defaultPaymentMethodId as string
  );

  return paymentMethod;
}

/**
 * List user's payment methods
 */
export async function listCustomerPaymentMethods(customerId: string) {
  const paymentMethods = await stripe.paymentMethods.list({
    customer: customerId,
    type: "card",
  });

  return paymentMethods.data;
}

/**
 * Set default payment method for customer
 */
export async function setDefaultPaymentMethod({
  customerId,
  paymentMethodId,
}: {
  customerId: string;
  paymentMethodId: string;
}) {
  // Attach payment method to customer if not already attached
  await stripe.paymentMethods.attach(paymentMethodId, {
    customer: customerId,
  });

  // Set as default
  await stripe.customers.update(customerId, {
    invoice_settings: {
      default_payment_method: paymentMethodId,
    },
  });

  return { success: true };
}

/**
 * Cancel service subscription (when user leaves)
 */
export async function cancelServiceSubscription(userId: string) {
  const serviceFeeRecord = await db.query.stripeFee.findFirst({
    where: eq(stripeFee.userId, userId),
  });

  if (!serviceFeeRecord) {
    throw new Error("Service subscription not found");
  }

  // Cancel Stripe subscription
  await stripe.subscriptions.cancel(serviceFeeRecord.stripeSubscriptionId);

  // Update database
  await db
    .update(stripeFee)
    .set({
      status: "canceled",
      canceledAt: new Date(),
    })
    .where(eq(stripeFee.id, serviceFeeRecord.id));

  return { success: true };
}

/**
 * Get upcoming invoice preview
 * Shows what user will be charged on next billing cycle
 */
export async function getUpcomingInvoicePreview(customerId: string) {
  try {
    // List upcoming invoices for customer
    const invoices = await stripe.invoices.list({
      customer: customerId,
      status: "draft",
      limit: 1,
    });

    if (invoices.data.length === 0) {
      return null;
    }

    const upcomingInvoice = invoices.data[0]!;

    return {
      total: upcomingInvoice.total,
      subtotal: upcomingInvoice.subtotal,
      amountDue: upcomingInvoice.amount_due,
      currency: upcomingInvoice.currency,
      periodStart: new Date(upcomingInvoice.period_start * 1000),
      periodEnd: new Date(upcomingInvoice.period_end * 1000),
      lines: upcomingInvoice.lines.data.map((line) => ({
        description: line.description,
        amount: line.amount,
        quantity: line.quantity,
      })),
    };
  } catch (error) {
    console.error("Failed to retrieve upcoming invoice:", error);
    return null;
  }
}

/**
 * Calculate next billing date for subscription based on cadence
 */
export function calculateNextBillingDate(cadenceDays: number): Date {
  const next = new Date();
  next.setDate(next.getDate() + cadenceDays);
  return next;
}

/**
 * Get invoice items for current billing period
 * Shows all pending charges that will be on next invoice
 */
export async function getPendingInvoiceItems(customerId: string) {
  const invoiceItems = await stripe.invoiceItems.list({
    customer: customerId,
    limit: 100,
  });

  return invoiceItems.data.map((item) => ({
    id: item.id,
    amount: item.amount,
    description: item.description,
    currency: item.currency,
    metadata: item.metadata,
  }));
}

/**
 * Calculate total monthly cost for user based on all active subscriptions
 * Useful for showing "Your estimated monthly bill"
 */
export async function calculateMonthlyBill(userId: string) {
  const { subscription } = await import("~/server/db/schema");
  
  // Get all active subscriptions with last known prices
  const subscriptions = await db.query.subscription.findMany({
    where: eq(subscription.userId, userId) && eq(subscription.status, "active"),
  });

  // Base service fee
  let totalCents = SERVICE_FEE_CENTS;

  // Add prorated product costs
  const subscriptionCosts = subscriptions.map((sub) => {
    if (!sub.lastPriceCents) return { subscription: sub, cost: 0 };

    const { totalCents: proratedCents, description } = calculateMonthlyProratedAmount({
      productPriceCents: sub.lastPriceCents,
      cadenceDays: sub.renewalFrequencyDays,
    });

    totalCents += proratedCents;

    return {
      subscription: sub,
      cost: proratedCents,
      description,
    };
  });

  return {
    serviceFee: SERVICE_FEE_CENTS,
    subscriptionCosts,
    total: totalCents,
    formattedTotal: `$${(totalCents / 100).toFixed(2)}`,
  };
}

/**
 * Charge user after successful checkout
 * Options: append to monthly invoice OR charge immediately
 */
export async function chargeForCheckout({
  userId,
  subscriptionIntentId,
  productName,
  productPriceCents,
  cadenceDays,
  orderId,
  chargeImmediately = false,
}: {
  userId: string;
  subscriptionIntentId: string;
  productName: string;
  productPriceCents: number;
  cadenceDays: number;
  orderId?: string;
  chargeImmediately?: boolean;
}) {
  if (chargeImmediately) {
    // Create and finalize invoice immediately
    return await chargeImmediatelyForOrder({
      userId,
      subscriptionIntentId,
      productName,
      productPriceCents,
      cadenceDays,
      orderId,
    });
  } else {
    // Append to next monthly invoice
    return await appendInvoiceItemForSubscription({
      userId,
      subscriptionIntentId,
      productName,
      productPriceCents,
      cadenceDays,
      orderId,
    });
  }
}

/**
 * Handle failed payment
 * Called from webhook when invoice.payment_failed
 */
export async function handleFailedPayment({
  invoiceId,
  customerId,
}: {
  invoiceId: string;
  customerId: string;
}) {
  // Update payment record
  const payment = await getPaymentByStripeInvoiceId(invoiceId);
  if (payment) {
    const { updatePaymentStatus } = await import("~/server/db/queries");
    await updatePaymentStatus({
      id: payment.id,
      status: "failed",
    });
  }

  // TODO: Pause affected subscriptions
  // TODO: Send notification to user
  // TODO: Schedule retry

  console.log(`Payment failed for invoice ${invoiceId}, customer ${customerId}`);
}

/**
 * Handle successful payment
 * Called from webhook when invoice.payment_succeeded
 */
export async function handleSuccessfulPayment({
  invoiceId,
  customerId,
  amountPaid,
}: {
  invoiceId: string;
  customerId: string;
  amountPaid: number;
}) {
  // Update payment record
  const payment = await getPaymentByStripeInvoiceId(invoiceId);
  if (payment) {
    const { updatePaymentStatus } = await import("~/server/db/queries");
    await updatePaymentStatus({
      id: payment.id,
      status: "succeeded",
    });
  }

  // TODO: Schedule next renewal
  // TODO: Send confirmation email

  console.log(`Payment succeeded for invoice ${invoiceId}: $${amountPaid / 100}`);
}

/**
 * Complete user onboarding with Stripe
 * Sets up customer, payment method, and base service subscription
 */
export async function completeStripeOnboarding({
  userId,
  email,
  name,
  paymentMethodId,
}: {
  userId: string;
  email: string;
  name?: string;
  paymentMethodId: string;
}) {
  // Step 1: Create Stripe customer
  const { customerId } = await createStripeCustomerForUser({
    userId,
    email,
    name,
  });

  // Step 2: Attach payment method
  await setDefaultPaymentMethod({
    customerId,
    paymentMethodId,
  });

  // Step 3: Create base $1/month service subscription
  const { subscriptionId, status } = await createBaseServiceSubscription({
    userId,
    customerId,
    paymentMethodId,
  });

  return {
    success: true,
    customerId,
    subscriptionId,
    status,
  };
}

/**
 * Check if user has active base Stripe subscription
 * Returns true if user has active $1/month service subscription
 */
export async function checkUserHasActiveSubscription(userId: string): Promise<boolean> {
  console.log(`🔍 Checking subscription for user: ${userId}`);
  
  const serviceFeeRecord = await db.query.stripeFee.findFirst({
    where: eq(stripeFee.userId, userId),
  });

  console.log(`📊 Subscription found:`, serviceFeeRecord ? {
    id: serviceFeeRecord.id,
    stripeSubscriptionId: serviceFeeRecord.stripeSubscriptionId,
    status: serviceFeeRecord.status,
  } : 'None');

  const hasActive = serviceFeeRecord?.status === "active";
  console.log(`✅ Has active subscription: ${hasActive}`);

  return hasActive;
}

/**
 * Create Stripe Checkout Session for base subscription
 * Used when user needs to set up their $1/month service subscription
 */
export async function createSubscriptionCheckoutSession({
  userId,
  email,
  name,
}: {
  userId: string;
  email: string;
  name?: string;
}): Promise<{
  checkoutUrl: string;
  sessionId: string;
}> {
  if (!SERVICE_FEE_PRICE_ID) {
    throw new Error(
      "STRIPE_SERVICE_FEE_PRICE_ID not configured. Please set the price ID from your Stripe Dashboard."
    );
  }

  // Get or create Stripe customer
  const { customerId } = await createStripeCustomerForUser({
    userId,
    email,
    name,
  });

  // Create Checkout Session for subscription
  const appUrl = env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  
  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: "subscription",
    line_items: [
      {
        price: SERVICE_FEE_PRICE_ID,
        quantity: 1,
      },
    ],
    success_url: `${appUrl}/dashboard?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appUrl}/dashboard?checkout=cancel`,
    metadata: {
      userId,
      type: "service_fee_subscription",
    },
    subscription_data: {
      metadata: {
        userId,
        type: "service_fee",
      },
    },
  });

  if (!session.url) {
    throw new Error("Failed to create Checkout Session URL");
  }

  return {
    checkoutUrl: session.url,
    sessionId: session.id,
  };
}

/**
 * EXAMPLES OF PRORATED BILLING
 * 
 * Example 1: 2-week cadence (14 days)
 * - Product price: $20.00
 * - Occurrences per month: 30/14 = 2.14
 * - Monthly charge: $20 * 2.14 = $42.80
 * - Description: "~2.14x per month (every 14 days)"
 * 
 * Example 2: 3-week cadence (21 days)
 * - Product price: $30.00
 * - Occurrences per month: 30/21 = 1.43
 * - Monthly charge: $30 * 1.43 = $42.90
 * - Description: "~1.43x per month (every 21 days)"
 * 
 * Example 3: 6-week cadence (42 days)
 * - Product price: $50.00
 * - Occurrences per month: 30/42 = 0.71
 * - Monthly charge: $50 * 0.71 = $35.50
 * - Description: "Partial monthly charge (every 42 days, 0.71x per 30 days)"
 * 
 * Example 4: Monthly cadence (30 days)
 * - Product price: $25.00
 * - Occurrences per month: 30/30 = 1.00
 * - Monthly charge: $25 * 1.00 = $25.00
 * - Description: "Monthly delivery"
 * 
 * This ensures fair billing regardless of subscription frequency.
 */

