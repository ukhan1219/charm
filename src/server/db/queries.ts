import "server-only";

import { eq, desc, and } from "drizzle-orm";
import { db } from "./index";
import { user } from "./schema";

/**
 * Get or create user by Clerk ID
 * Maps Clerk user IDs to our internal user UUIDs
 */
export async function getOrCreateUserByClerkId({
  clerkId,
  email,
}: {
  clerkId: string;
  email: string;
}): Promise<{ id: string }> {
  // Try to find existing user
  const existingUser = await db.query.user.findFirst({
    where: eq(user.clerkId, clerkId),
  });

  if (existingUser) {
    return existingUser;
  }

  // Create new user
  const [newUser] = await db
    .insert(user)
    .values({
      clerkId,
      email,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();

  if (!newUser) {
    throw new Error("Failed to create user");
  }

  return newUser;
}

/**
 * Get user by internal UUID
 */
export async function getUserById(id: string) {
  return db.query.user.findFirst({
    where: eq(user.id, id),
  });
}

/**
 * Get user by Clerk ID
 */
export async function getUserByClerkId(clerkId: string) {
  return db.query.user.findFirst({
    where: eq(user.clerkId, clerkId),
  });
}

/**
 * Get messages for a user (single persistent conversation)
 */
export async function getMessagesByUserId(userId: string) {
  const { message } = await import("./schema");
  return db.query.message.findMany({
    where: eq(message.userId, userId),
    orderBy: (message, { asc }) => [asc(message.createdAt)],
  });
}

// ============================================================================
// PRODUCT OPERATIONS
// ============================================================================

/**
 * Create or find product by URL
 */
export async function getOrCreateProduct({
  name,
  url,
  description,
  imageUrl,
  merchant,
  currentPriceCents,
}: {
  name: string;
  url: string;
  description?: string;
  imageUrl?: string;
  merchant?: string;
  currentPriceCents?: number;
}) {
  const { product } = await import("./schema");
  
  // Try to find existing product by URL
  const existing = await db.query.product.findFirst({
    where: eq(product.url, url),
  });

  if (existing) {
    // Update price if provided and different
    if (currentPriceCents !== undefined && currentPriceCents !== existing.currentPriceCents) {
      await db
        .update(product)
        .set({
          currentPriceCents,
          lastPriceCheckAt: new Date(),
          priceUpdatedAt: new Date(),
        })
        .where(eq(product.id, existing.id));
      
      return {
        ...existing,
        currentPriceCents,
        lastPriceCheckAt: new Date(),
        priceUpdatedAt: new Date(),
      };
    }
    return existing;
  }

  // Create new product
  const [newProduct] = await db
    .insert(product)
    .values({
      name,
      url,
      description,
      imageUrl,
      merchant,
      currentPriceCents,
      lastPriceCheckAt: currentPriceCents !== undefined ? new Date() : null,
      priceUpdatedAt: currentPriceCents !== undefined ? new Date() : null,
      createdAt: new Date(),
    })
    .returning();

  if (!newProduct) {
    throw new Error("Failed to create product");
  }

  return newProduct;
}

/**
 * Get all products
 */
export async function getAllProducts() {
  return db.query.product.findMany();
}

/**
 * Get product price from URL using Browserbase
 */
export async function getProductPriceFromUrl(productUrl: string): Promise<number | null> {
  try {
    const { getProductDetails } = await import("~/lib/integrations/browserbase");
    
    console.log(`🔍 Fetching current price for: ${productUrl}`);
    const details = await getProductDetails(productUrl);
    
    if (!details.price) {
      console.warn(`No price found for product: ${productUrl}`);
      return null;
    }

    // Parse price string to cents
    const cleaned = details.price.replace(/[$,]/g, '');
    const dollars = parseFloat(cleaned);
    const priceCents = isNaN(dollars) ? null : Math.round(dollars * 100);
    
    console.log(`💰 Current price: ${details.price} (${priceCents}¢)`);
    return priceCents;
  } catch (error) {
    console.error(`Failed to fetch price for ${productUrl}:`, error);
    return null;
  }
}

/**
 * Check and update product price
 * Fetches current price from product URL, compares with stored price, updates if changed
 */
export async function checkAndUpdateProductPrice(productId: string): Promise<{
  success: boolean;
  priceChanged: boolean;
  oldPriceCents?: number;
  newPriceCents?: number;
  error?: string;
}> {
  const { product } = await import("./schema");
  
  try {
    // Get product
    const productData = await db.query.product.findFirst({
      where: eq(product.id, productId),
    });

    if (!productData) {
      return {
        success: false,
        priceChanged: false,
        error: "Product not found",
      };
    }

    // Fetch current price
    const currentPriceCents = await getProductPriceFromUrl(productData.url);
    
    if (currentPriceCents === null) {
      // Failed to fetch price, but update lastPriceCheckAt
      await db
        .update(product)
        .set({
          lastPriceCheckAt: new Date(),
        })
        .where(eq(product.id, productId));
      
      return {
        success: false,
        priceChanged: false,
        error: "Failed to fetch current price",
      };
    }

    const oldPriceCents = productData.currentPriceCents;
    const priceChanged = oldPriceCents !== currentPriceCents;

    // Update product with current price
    await db
      .update(product)
      .set({
        currentPriceCents,
        lastPriceCheckAt: new Date(),
        priceUpdatedAt: priceChanged ? new Date() : productData.priceUpdatedAt,
      })
      .where(eq(product.id, productId));

    if (priceChanged) {
      console.log(`📊 Price changed for product ${productId}: ${oldPriceCents}¢ → ${currentPriceCents}¢`);
      
      // Update all subscriptions using this product
      const { subscription } = await import("./schema");
      await db
        .update(subscription)
        .set({
          lastPriceCents: currentPriceCents,
          updatedAt: new Date(),
        })
        .where(eq(subscription.productId, productId));
    }

    return {
      success: true,
      priceChanged,
      oldPriceCents: oldPriceCents ?? undefined,
      newPriceCents: currentPriceCents,
    };
  } catch (error) {
    console.error(`Error checking price for product ${productId}:`, error);
    return {
      success: false,
      priceChanged: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

// ============================================================================
// SUBSCRIPTION INTENT OPERATIONS
// ============================================================================

/**
 * Create a subscription intent (NL → structured data)
 */
export async function createSubscriptionIntent({
  userId,
  title,
  productUrl,
  cadenceDays,
  maxPriceCents,
  constraints,
}: {
  userId: string;
  title: string;
  productUrl: string;
  cadenceDays: number;
  maxPriceCents?: number;
  constraints?: Record<string, any>;
}) {
  const { subscriptionIntent } = await import("./schema");
  
  const [intent] = await db
    .insert(subscriptionIntent)
    .values({
      userId,
      title,
      productUrl,
      cadenceDays,
      maxPriceCents,
      constraints,
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();

  return intent;
}

/**
 * Get subscription intents for a user
 * By default, excludes canceled intents
 */
export async function getSubscriptionIntentsByUserId(
  userId: string,
  options?: { includeCanceled?: boolean }
) {
  const { subscriptionIntent } = await import("./schema");
  const { and, ne } = await import("drizzle-orm");
  
  const conditions = [eq(subscriptionIntent.userId, userId)];
  
  // Exclude canceled intents unless explicitly requested
  if (!options?.includeCanceled) {
    conditions.push(ne(subscriptionIntent.status, "canceled"));
  }
  
  return db.query.subscriptionIntent.findMany({
    where: and(...conditions),
    orderBy: (subscriptionIntent, { desc }) => [desc(subscriptionIntent.createdAt)],
  });
}

/**
 * Get subscription intent by ID
 */
export async function getSubscriptionIntentById(intentId: string) {
  const { subscriptionIntent } = await import("./schema");
  return db.query.subscriptionIntent.findFirst({
    where: eq(subscriptionIntent.id, intentId),
  });
}

/**
 * Update subscription intent
 */
export async function updateSubscriptionIntent({
  id,
  updates,
}: {
  id: string;
  updates: {
    title?: string;
    cadenceDays?: number;
    maxPriceCents?: number;
    constraints?: Record<string, any>;
    status?: "active" | "paused" | "canceled" | "error";
  };
}) {
  const { subscriptionIntent } = await import("./schema");
  
  return db
    .update(subscriptionIntent)
    .set({
      ...updates,
      updatedAt: new Date(),
    })
    .where(eq(subscriptionIntent.id, id))
    .returning();
}

/**
 * Delete subscription intent (soft delete - marks as canceled)
 */
export async function deleteSubscriptionIntent(id: string) {
  const { subscriptionIntent } = await import("./schema");
  
  // Soft delete: update status to canceled instead of deleting
  await db
    .update(subscriptionIntent)
    .set({
      status: "canceled",
      canceledAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(subscriptionIntent.id, id));
  
  // Also cancel any linked subscriptions
  const { subscription } = await import("./schema");
  await db
    .update(subscription)
    .set({
      status: "canceled",
      canceledAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(subscription.intentId, id));
  
  console.log(`Soft deleted intent ${id} and linked subscriptions`);
}

/**
 * Sync subscription intent changes to linked subscriptions
 * Updates subscription status, frequency, and price when intent changes
 */
export async function syncIntentToSubscriptions(intentId: string) {
  const { subscription, subscriptionIntent } = await import("./schema");
  
  // Get the intent
  const intent = await db.query.subscriptionIntent.findFirst({
    where: eq(subscriptionIntent.id, intentId),
  });

  if (!intent) {
    console.warn(`Intent ${intentId} not found for sync`);
    return;
  }

  // Find all subscriptions linked to this intent
  const linkedSubscriptions = await db.query.subscription.findMany({
    where: eq(subscription.intentId, intentId),
  });

  if (linkedSubscriptions.length === 0) {
    console.log(`No subscriptions linked to intent ${intentId}`);
    return;
  }

  // Update all linked subscriptions with intent changes
  for (const sub of linkedSubscriptions) {
    const updates: {
      status?: "active" | "paused" | "canceled";
      renewalFrequencyDays?: number;
      lastPriceCents?: number;
      updatedAt: Date;
      canceledAt?: Date;
    } = {
      updatedAt: new Date(),
    };

    // Sync status (including canceled)
    if (intent.status === "active" || intent.status === "paused" || intent.status === "canceled") {
      updates.status = intent.status;
      
      // Set canceledAt timestamp if status is canceled
      if (intent.status === "canceled") {
        updates.canceledAt = intent.canceledAt || new Date();
      }
    }

    // Sync frequency if changed
    if (intent.cadenceDays !== sub.renewalFrequencyDays) {
      updates.renewalFrequencyDays = intent.cadenceDays;
    }

    // Sync price if changed
    if (intent.maxPriceCents && intent.maxPriceCents !== sub.lastPriceCents) {
      updates.lastPriceCents = intent.maxPriceCents;
    }

    await db
      .update(subscription)
      .set(updates)
      .where(eq(subscription.id, sub.id));
  }

  console.log(`Synced intent ${intentId} to ${linkedSubscriptions.length} subscription(s)`);
}

// ============================================================================
// SUBSCRIPTION OPERATIONS
// ============================================================================

/**
 * Create a subscription
 */
export async function createSubscription({
  userId,
  productId,
  intentId,
  renewalFrequencyDays,
  addressId,
  lastPriceCents,
}: {
  userId: string;
  productId: string;
  intentId?: string;
  renewalFrequencyDays: number;
  addressId?: string;
  lastPriceCents?: number;
}) {
  const { subscription } = await import("./schema");
  
  const nextRenewalAt = new Date();
  nextRenewalAt.setDate(nextRenewalAt.getDate() + renewalFrequencyDays);

  const [sub] = await db
    .insert(subscription)
    .values({
      userId,
      productId,
      intentId,
      renewalFrequencyDays,
      lastPriceCents,
      addressId,
      status: "active",
      nextRenewalAt,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();

  return sub;
}

/**
 * Get subscriptions for a user
 */
export async function getSubscriptionsByUserId(userId: string) {
  const { subscription, product, address } = await import("./schema");
  return db
    .select()
    .from(subscription)
    .leftJoin(product, eq(subscription.productId, product.id))
    .leftJoin(address, eq(subscription.addressId, address.id))
    .where(eq(subscription.userId, userId));
}

/**
 * Get subscription by ID
 */
export async function getSubscriptionById(id: string) {
  const { subscription, product, address } = await import("./schema");
  const result = await db
    .select()
    .from(subscription)
    .leftJoin(product, eq(subscription.productId, product.id))
    .leftJoin(address, eq(subscription.addressId, address.id))
    .where(eq(subscription.id, id))
    .limit(1);
  
  return result[0];
}

/**
 * Update subscription status
 */
export async function updateSubscriptionStatus({
  id,
  status,
}: {
  id: string;
  status: "active" | "paused" | "canceled";
}) {
  const { subscription } = await import("./schema");
  
  return db
    .update(subscription)
    .set({
      status,
      updatedAt: new Date(),
    })
    .where(eq(subscription.id, id))
    .returning();
}

/**
 * Update subscription details
 */
export async function updateSubscription({
  id,
  updates,
}: {
  id: string;
  updates: {
    renewalFrequencyDays?: number;
    addressId?: string;
    lastPriceCents?: number;
    nextRenewalAt?: Date;
  };
}) {
  const { subscription } = await import("./schema");
  
  return db
    .update(subscription)
    .set({
      ...updates,
      updatedAt: new Date(),
    })
    .where(eq(subscription.id, id))
    .returning();
}

/**
 * Delete subscription (soft delete - marks as canceled)
 */
export async function deleteSubscription(id: string) {
  const { subscription } = await import("./schema");
  
  // Soft delete: update status to canceled instead of deleting
  return db
    .update(subscription)
    .set({
      status: "canceled",
      canceledAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(subscription.id, id))
    .returning();
}

// ============================================================================
// ADDRESS OPERATIONS
// ============================================================================

/**
 * Create user address
 */
export async function createUserAddress({
  userId,
  street1,
  street2,
  city,
  state,
  zipCode,
  isPrimary = false,
}: {
  userId: string;
  street1: string;
  street2?: string;
  city: string;
  state: string;
  zipCode: string;
  isPrimary?: boolean;
}) {
  const { address } = await import("./schema");
  
  const [newAddress] = await db
    .insert(address)
    .values({
      userId,
      street1,
      street2,
      city,
      state,
      zipCode,
      isPrimary,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();

  return newAddress;
}

/**
 * Get user addresses
 */
export async function getUserAddresses(userId: string) {
  const { address } = await import("./schema");
  return db.query.address.findMany({
    where: eq(address.userId, userId),
    orderBy: (address, { desc }) => [desc(address.isPrimary), desc(address.createdAt)],
  });
}

/**
 * Get primary address for user
 */
export async function getPrimaryAddress(userId: string) {
  const { address } = await import("./schema");
  const { and } = await import("drizzle-orm");
  return db.query.address.findFirst({
    where: and(eq(address.userId, userId), eq(address.isPrimary, true)),
  });
}

/**
 * Update address
 */
export async function updateAddress({
  id,
  updates,
}: {
  id: string;
  updates: {
    street1?: string;
    street2?: string;
    city?: string;
    state?: string;
    zipCode?: string;
    isPrimary?: boolean;
  };
}) {
  const { address } = await import("./schema");
  
  return db
    .update(address)
    .set({
      ...updates,
      updatedAt: new Date(),
    })
    .where(eq(address.id, id))
    .returning();
}

/**
 * Delete address
 */
export async function deleteAddress(id: string) {
  const { address } = await import("./schema");
  return db.delete(address).where(eq(address.id, id));
}

// ============================================================================
// AGENT RUN OPERATIONS
// ============================================================================

/**
 * Create agent run
 */
export async function createAgentRun({
  intentId,
  subscriptionId,
  phase,
  input,
  browserbaseSessionId,
}: {
  intentId?: string;
  subscriptionId?: string;
  phase: string;
  input?: Record<string, any>;
  browserbaseSessionId?: string;
}) {
  const { agentRun } = await import("./schema");
  
  const [run] = await db
    .insert(agentRun)
    .values({
      intentId,
      subscriptionId,
      phase,
      input,
      browserbaseSessionId,
      createdAt: new Date(),
    })
    .returning();

  return run;
}

/**
 * Get agent run by ID
 */
export async function getAgentRunById(id: string) {
  const { agentRun } = await import("./schema");
  return db.query.agentRun.findFirst({
    where: eq(agentRun.id, id),
  });
}

/**
 * Get agent runs by subscription
 */
export async function getAgentRunsBySubscription(subscriptionId: string) {
  const { agentRun } = await import("./schema");
  return db.query.agentRun.findMany({
    where: eq(agentRun.subscriptionId, subscriptionId),
    orderBy: (agentRun, { desc }) => [desc(agentRun.createdAt)],
  });
}

/**
 * Get agent runs by intent
 */
export async function getAgentRunsByIntent(intentId: string) {
  const { agentRun } = await import("./schema");
  return db.query.agentRun.findMany({
    where: eq(agentRun.intentId, intentId),
    orderBy: (agentRun, { desc }) => [desc(agentRun.createdAt)],
  });
}

/**
 * Get recent agent runs (all)
 */
export async function getRecentAgentRuns(limit = 50) {
  return db.query.agentRun.findMany({
    limit,
    orderBy: (agentRun, { desc }) => [desc(agentRun.createdAt)],
  });
}

/**
 * Update agent run
 */
export async function updateAgentRun({
  id,
  updates,
}: {
  id: string;
  updates: {
    phase?: string;
    output?: Record<string, any>;
    error?: string;
    endedAt?: Date;
  };
}) {
  const { agentRun } = await import("./schema");
  
  return db
    .update(agentRun)
    .set(updates)
    .where(eq(agentRun.id, id))
    .returning();
}

/**
 * Get running agent runs (not completed)
 */
export async function getRunningAgentRuns() {
  const { agentRun } = await import("./schema");
  const { isNull } = await import("drizzle-orm");
  
  return db.query.agentRun.findMany({
    where: isNull(agentRun.endedAt),
    orderBy: (agentRun, { asc }) => [asc(agentRun.createdAt)],
  });
}

/**
 * Get failed agent runs
 */
export async function getFailedAgentRuns(limit = 50) {
  const { agentRun } = await import("./schema");
  
  return db.query.agentRun.findMany({
    where: eq(agentRun.phase, "failed"),
    limit,
    orderBy: (agentRun, { desc }) => [desc(agentRun.createdAt)],
  });
}

// ============================================================================
// ORDER OPERATIONS
// ============================================================================

/**
 * Create order
 */
export async function createOrder({
  subscriptionId,
  agentRunId,
  merchant,
  productUrl,
  orderId,
  priceCents,
  currency = "USD",
  receipt,
  status = "processing",
}: {
  subscriptionId: string;
  agentRunId?: string;
  merchant?: string;
  productUrl?: string;
  orderId?: string;
  priceCents?: number;
  currency?: string;
  receipt?: Record<string, any>;
  status?: string;
}) {
  const { order } = await import("./schema");
  
  const [newOrder] = await db
    .insert(order)
    .values({
      subscriptionId,
      agentRunId,
      merchant,
      productUrl,
      orderId,
      priceCents,
      currency,
      receipt,
      status,
      createdAt: new Date(),
    })
    .returning();

  return newOrder;
}

/**
 * Get order by ID
 */
export async function getOrderById(id: string) {
  const { order } = await import("./schema");
  return db.query.order.findFirst({
    where: eq(order.id, id),
  });
}

/**
 * Get orders by subscription
 */
export async function getOrdersBySubscription(subscriptionId: string) {
  const { order } = await import("./schema");
  return db.query.order.findMany({
    where: eq(order.subscriptionId, subscriptionId),
    orderBy: (order, { desc }) => [desc(order.createdAt)],
  });
}

/**
 * Get recent orders for user
 */
export async function getRecentOrdersForUser(userId: string, limit = 20) {
  const { order, subscription } = await import("./schema");
  
  return db
    .select()
    .from(order)
    .innerJoin(subscription, eq(order.subscriptionId, subscription.id))
    .where(eq(subscription.userId, userId))
    .orderBy(desc(order.createdAt))
    .limit(limit);
}

/**
 * Update order status
 */
export async function updateOrderStatus({
  id,
  status,
}: {
  id: string;
  status: string;
}) {
  const { order } = await import("./schema");
  
  return db
    .update(order)
    .set({ status })
    .where(eq(order.id, id))
    .returning();
}

/**
 * Get order statistics for user
 */
export async function getOrderStats(userId: string) {
  const { order, subscription } = await import("./schema");
  
  const orders = await db
    .select()
    .from(order)
    .innerJoin(subscription, eq(order.subscriptionId, subscription.id))
    .where(eq(subscription.userId, userId));

  const totalOrders = orders.length;
  const successfulOrders = orders.filter((o) => o.order.status === "succeeded").length;
  const failedOrders = orders.filter((o) => o.order.status === "failed").length;
  const totalSpentCents = orders
    .filter((o) => o.order.priceCents)
    .reduce((sum, o) => sum + (o.order.priceCents || 0), 0);

  return {
    totalOrders,
    successfulOrders,
    failedOrders,
    processingOrders: totalOrders - successfulOrders - failedOrders,
    totalSpentCents,
    averageOrderCents: totalOrders > 0 ? Math.round(totalSpentCents / totalOrders) : 0,
  };
}

// ============================================================================
// STRIPE CUSTOMER OPERATIONS
// ============================================================================

/**
 * Create or get Stripe customer
 */
export async function getOrCreateStripeCustomer({
  userId,
  stripeCustomerId,
}: {
  userId: string;
  stripeCustomerId: string;
}) {
  const { stripeCustomer } = await import("./schema");
  
  // Check if exists
  const existing = await db.query.stripeCustomer.findFirst({
    where: eq(stripeCustomer.userId, userId),
  });

  if (existing) {
    return existing;
  }

  // Create new
  const [customer] = await db
    .insert(stripeCustomer)
    .values({
      userId,
      stripeCustomerId,
      createdAt: new Date(),
    })
    .returning();

  return customer;
}

/**
 * Get Stripe customer by user ID
 */
export async function getStripeCustomerByUserId(userId: string) {
  const { stripeCustomer } = await import("./schema");
  return db.query.stripeCustomer.findFirst({
    where: eq(stripeCustomer.userId, userId),
  });
}

// ============================================================================
// PAYMENT OPERATIONS
// ============================================================================

/**
 * Create payment record
 */
export async function createPayment({
  subscriptionId,
  stripeInvoiceId,
  stripePaymentIntentId,
  amount,
  productCost,
  serviceFee,
  shippingCost,
  status = "pending",
}: {
  subscriptionId: string;
  stripeInvoiceId?: string;
  stripePaymentIntentId?: string;
  amount: string;
  productCost?: string;
  serviceFee?: string;
  shippingCost?: string;
  status?: string;
}) {
  const { payment } = await import("./schema");
  
  const [newPayment] = await db
    .insert(payment)
    .values({
      subscriptionId,
      stripeInvoiceId,
      stripePaymentIntentId,
      amount,
      productCost,
      serviceFee,
      shippingCost,
      status,
      createdAt: new Date(),
    })
    .returning();

  return newPayment;
}

/**
 * Get payments by subscription
 */
export async function getPaymentsBySubscription(subscriptionId: string) {
  const { payment } = await import("./schema");
  return db.query.payment.findMany({
    where: eq(payment.subscriptionId, subscriptionId),
    orderBy: (payment, { desc }) => [desc(payment.createdAt)],
  });
}

/**
 * Update payment status
 */
export async function updatePaymentStatus({
  id,
  status,
}: {
  id: string;
  status: string;
}) {
  const { payment } = await import("./schema");
  
  return db
    .update(payment)
    .set({ status })
    .where(eq(payment.id, id))
    .returning();
}

/**
 * Get payment by Stripe invoice ID
 */
export async function getPaymentByStripeInvoiceId(invoiceId: string) {
  const { payment } = await import("./schema");
  return db.query.payment.findFirst({
    where: eq(payment.stripeInvoiceId, invoiceId),
  });
}

/**
 * Get payment by Stripe payment intent ID
 */
export async function getPaymentByStripePaymentIntentId(paymentIntentId: string) {
  const { payment } = await import("./schema");
  return db.query.payment.findFirst({
    where: eq(payment.stripePaymentIntentId, paymentIntentId),
  });
}

// ============================================================================
// CREDENTIAL OPERATIONS (for storing merchant credentials)
// ============================================================================

/**
 * Create credential (encrypted merchant login)
 */
export async function createCredential({
  userId,
  merchant,
  secret,
}: {
  userId: string;
  merchant: string;
  secret: string; // Should be encrypted before passing
}) {
  const { credential } = await import("./schema");
  
  const [cred] = await db
    .insert(credential)
    .values({
      userId,
      merchant,
      secret,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();

  return cred;
}

/**
 * Get credentials for user and merchant
 */
export async function getCredential({
  userId,
  merchant,
}: {
  userId: string;
  merchant: string;
}) {
  const { credential } = await import("./schema");
  const { and } = await import("drizzle-orm");
  
  return db.query.credential.findFirst({
    where: and(
      eq(credential.userId, userId),
      eq(credential.merchant, merchant)
    ),
  });
}

/**
 * Delete credential
 */
export async function deleteCredential(id: string) {
  const { credential } = await import("./schema");
  return db.delete(credential).where(eq(credential.id, id));
}

// ============================================================================
// ANALYTICS & REPORTING
// ============================================================================

/**
 * Get subscription due for renewal
 * Returns subscriptions where nextRenewalAt is in the past or within next 24 hours
 */
export async function getSubscriptionsDueForRenewal() {
  const { subscription } = await import("./schema");
  const { lte, and } = await import("drizzle-orm");
  
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);

  return db.query.subscription.findMany({
    where: and(
      eq(subscription.status, "active"),
      lte(subscription.nextRenewalAt, tomorrow)
    ),
  });
}

/**
 * Get user activity summary
 */
export async function getUserActivitySummary(userId: string) {
  const [
    intents,
    subscriptions,
    addresses,
    agentRuns,
  ] = await Promise.all([
    getSubscriptionIntentsByUserId(userId),
    getSubscriptionsByUserId(userId),
    getUserAddresses(userId),
    (async () => {
      const { agentRun, subscription } = await import("./schema");
      return db
        .select()
        .from(agentRun)
        .innerJoin(subscription, eq(agentRun.subscriptionId, subscription.id))
        .where(eq(subscription.userId, userId))
        .limit(10);
    })(),
  ]);

  const orderStats = await getOrderStats(userId);

  return {
    totalIntents: intents.length,
    activeIntents: intents.filter((i) => i.status === "active").length,
    pausedIntents: intents.filter((i) => i.status === "paused").length,
    totalSubscriptions: subscriptions.length,
    totalAddresses: addresses.length,
    recentAgentRuns: agentRuns.length,
    orders: orderStats,
  };
}

/**
 * Search subscriptions by product name
 */
export async function searchSubscriptionsByProductName({
  userId,
  query,
}: {
  userId: string;
  query: string;
}) {
  const { subscription, product, subscriptionIntent } = await import("./schema");
  const { like, or } = await import("drizzle-orm");
  
  return db
    .select()
    .from(subscriptionIntent)
    .leftJoin(subscription, eq(subscriptionIntent.id, subscription.intentId))
    .leftJoin(product, eq(subscription.productId, product.id))
    .where(
      and(
        eq(subscriptionIntent.userId, userId),
        or(
          like(subscriptionIntent.title, `%${query}%`),
          like(product.name, `%${query}%`)
        )
      )
    );
}

// ============================================================================
// BULK OPERATIONS
// ============================================================================

/**
 * Bulk update subscription statuses
 */
export async function bulkUpdateSubscriptionStatus({
  subscriptionIds,
  status,
}: {
  subscriptionIds: string[];
  status: "active" | "paused" | "canceled";
}) {
  const { subscription } = await import("./schema");
  const { inArray } = await import("drizzle-orm");
  
  return db
    .update(subscription)
    .set({
      status,
      updatedAt: new Date(),
    })
    .where(inArray(subscription.id, subscriptionIds))
    .returning();
}

/**
 * Delete multiple subscriptions
 */
export async function bulkDeleteSubscriptions(subscriptionIds: string[]) {
  const { subscription } = await import("./schema");
  const { inArray } = await import("drizzle-orm");
  
  return db
    .delete(subscription)
    .where(inArray(subscription.id, subscriptionIds));
}

