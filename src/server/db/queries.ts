import "server-only";

import { eq } from "drizzle-orm";
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
}: {
  name: string;
  url: string;
  description?: string;
  imageUrl?: string;
  merchant?: string;
}) {
  const { product } = await import("./schema");
  
  // Try to find existing product by URL
  const existing = await db.query.product.findFirst({
    where: eq(product.url, url),
  });

  if (existing) {
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
 */
export async function getSubscriptionIntentsByUserId(userId: string) {
  const { subscriptionIntent } = await import("./schema");
  return db.query.subscriptionIntent.findMany({
    where: eq(subscriptionIntent.userId, userId),
    orderBy: (subscriptionIntent, { desc }) => [desc(subscriptionIntent.createdAt)],
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
    status?: "active" | "paused" | "error";
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
 * Delete subscription intent
 */
export async function deleteSubscriptionIntent(id: string) {
  const { subscriptionIntent } = await import("./schema");
  return db.delete(subscriptionIntent).where(eq(subscriptionIntent.id, id));
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
 * Delete subscription
 */
export async function deleteSubscription(id: string) {
  const { subscription } = await import("./schema");
  return db.delete(subscription).where(eq(subscription.id, id));
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

