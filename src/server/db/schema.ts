import type { InferSelectModel } from "drizzle-orm";
import { pgTableCreator } from "drizzle-orm/pg-core";

/**
 * Multi-project schema for Drizzle ORM
 * All tables prefixed with charmv2_
 */
export const createTable = pgTableCreator((name) => `charmv2_${name}`);

// ============================================================================
// US STATES CONSTANT
// ============================================================================
export const usStates = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
  "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY"
] as const;
export type USState = (typeof usStates)[number];

// ============================================================================
// USER & AUTH
// ============================================================================
export const user = createTable("user", (d) => ({
  id: d.uuid().primaryKey().notNull().defaultRandom(),
  email: d.varchar({ length: 255 }).notNull().unique(),
  clerkId: d.varchar({ length: 255 }).unique(), // Clerk user ID
  createdAt: d.timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: d.timestamp({ withTimezone: true }).notNull().defaultNow(),
}));

export type User = InferSelectModel<typeof user>;

// ============================================================================
// STRIPE INTEGRATION
// ============================================================================
export const stripeCustomer = createTable("stripe_customer", (d) => ({
  id: d.uuid().primaryKey().notNull().defaultRandom(),
  userId: d.uuid().notNull().references(() => user.id, { onDelete: "cascade" }),
  stripeCustomerId: d.varchar({ length: 255 }).notNull().unique(),
  createdAt: d.timestamp({ withTimezone: true }).notNull().defaultNow(),
}));

export type StripeCustomer = InferSelectModel<typeof stripeCustomer>;

export const stripeFee = createTable("stripe_fee", (d) => ({
  id: d.uuid().primaryKey().notNull().defaultRandom(),
  userId: d.uuid().notNull().references(() => user.id, { onDelete: "cascade" }),
  stripeSubscriptionId: d.varchar({ length: 255 }).notNull().unique(),
  amount: d.varchar({ length: 20 }).notNull(), // $1.00 = "100" (cents)
  status: d.varchar({ length: 32 }).notNull().default("active"), // active, canceled, past_due
  createdAt: d.timestamp({ withTimezone: true }).notNull().defaultNow(),
  canceledAt: d.timestamp({ withTimezone: true }),
}));

export type StripeFee = InferSelectModel<typeof stripeFee>;

export const payment = createTable("payment", (d) => ({
  id: d.uuid().primaryKey().notNull().defaultRandom(),
  subscriptionId: d.uuid().notNull().references(() => subscription.id, { onDelete: "cascade" }),
  stripeInvoiceId: d.varchar({ length: 255 }),
  stripePaymentIntentId: d.varchar({ length: 255 }),
  amount: d.varchar({ length: 20 }).notNull(), // Total amount in cents
  productCost: d.varchar({ length: 20 }), // Actual product price
  serviceFee: d.varchar({ length: 20 }), // Our fee
  shippingCost: d.varchar({ length: 20 }),
  status: d.varchar({ length: 32 }).notNull(), // pending, succeeded, failed, refunded
  createdAt: d.timestamp({ withTimezone: true }).notNull().defaultNow(),
}));

export type Payment = InferSelectModel<typeof payment>;

// ============================================================================
// ADDRESS
// ============================================================================
export const address = createTable("address", (d) => ({
  id: d.uuid().primaryKey().notNull().defaultRandom(),
  userId: d.uuid().notNull().references(() => user.id, { onDelete: "cascade" }),
  street1: d.varchar({ length: 128 }).notNull(),
  street2: d.varchar({ length: 128 }),
  city: d.varchar({ length: 64 }).notNull(),
  state: d.varchar({ length: 2 }).notNull(), // Two-letter state code
  zipCode: d.varchar({ length: 10 }).notNull(),
  isPrimary: d.boolean().notNull().default(true),
  createdAt: d.timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: d.timestamp({ withTimezone: true }).notNull().defaultNow(),
}));

export type Address = InferSelectModel<typeof address>;

// ============================================================================
// PRODUCTS
// ============================================================================
export const product = createTable("product", (d) => ({
  id: d.uuid().primaryKey().notNull().defaultRandom(),
  name: d.text().notNull(),
  url: d.text().notNull(), // Product URL
  description: d.text(),
  imageUrl: d.text(),
  merchant: d.varchar({ length: 128 }), // e.g., "Amazon", "Target"
  currentPriceCents: d.integer(), // Current price in cents
  lastPriceCheckAt: d.timestamp({ withTimezone: true }), // Last time price was checked
  priceUpdatedAt: d.timestamp({ withTimezone: true }), // Last time price was updated
  createdAt: d.timestamp({ withTimezone: true }).notNull().defaultNow(),
}));

export type Product = InferSelectModel<typeof product>;

// ============================================================================
// SUBSCRIPTION INTENTS & SUBSCRIPTIONS
// ============================================================================
export const subscriptionIntent = createTable("subscription_intent", (d) => ({
  id: d.uuid().primaryKey().notNull().defaultRandom(),
  userId: d.uuid().notNull().references(() => user.id, { onDelete: "cascade" }),
  title: d.text().notNull(), // User-friendly name
  productUrl: d.text().notNull(),
  cadenceDays: d.integer().notNull(), // Renewal frequency in days
  maxPriceCents: d.integer(), // Optional price cap
  constraints: d.jsonb(), // { color?: string, size?: string, etc. }
  status: d.varchar({ length: 32 }).notNull().default("active"), // active, paused, canceled, error
  createdAt: d.timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: d.timestamp({ withTimezone: true }).notNull().defaultNow(),
  canceledAt: d.timestamp({ withTimezone: true }), // When the subscription was canceled
}));

export type SubscriptionIntent = InferSelectModel<typeof subscriptionIntent>;

export const subscription = createTable("subscription", (d) => ({
  id: d.uuid().primaryKey().notNull().defaultRandom(),
  userId: d.uuid().notNull().references(() => user.id, { onDelete: "cascade" }),
  productId: d.uuid().notNull().references(() => product.id),
  intentId: d.uuid().references(() => subscriptionIntent.id),
  stripeSubscriptionId: d.varchar({ length: 255 }), // For product-level subscription tracking
  renewalFrequencyDays: d.integer().notNull(),
  lastPriceCents: d.integer(), // Track price changes
  status: d.varchar({ length: 32 }).notNull().default("active"), // active, paused, canceled
  addressId: d.uuid().references(() => address.id),
  createdAt: d.timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: d.timestamp({ withTimezone: true }).notNull().defaultNow(),
  nextRenewalAt: d.timestamp({ withTimezone: true }),
  canceledAt: d.timestamp({ withTimezone: true }), // When the subscription was canceled
}));

export type Subscription = InferSelectModel<typeof subscription>;

// ============================================================================
// AGENT SYSTEM
// ============================================================================
export const agentRun = createTable("agent_run", (d) => ({
  id: d.uuid().primaryKey().notNull().defaultRandom(),
  intentId: d.uuid().references(() => subscriptionIntent.id),
  subscriptionId: d.uuid().references(() => subscription.id),
  phase: d.varchar({ length: 32 }).notNull(), // plan, checkout, done, failed
  input: d.jsonb(),
  output: d.jsonb(),
  error: d.text(),
  browserbaseSessionId: d.varchar({ length: 128 }),
  createdAt: d.timestamp({ withTimezone: true }).notNull().defaultNow(),
  endedAt: d.timestamp({ withTimezone: true }),
}));

export type AgentRun = InferSelectModel<typeof agentRun>;

export const order = createTable("order", (d) => ({
  id: d.uuid().primaryKey().notNull().defaultRandom(),
  subscriptionId: d.uuid().notNull().references(() => subscription.id, { onDelete: "cascade" }),
  agentRunId: d.uuid().references(() => agentRun.id),
  merchant: d.varchar({ length: 128 }),
  productUrl: d.text(),
  orderId: d.varchar({ length: 128 }), // Merchant's order ID
  priceCents: d.integer(),
  currency: d.varchar({ length: 8 }).default("USD"),
  receipt: d.jsonb(),
  status: d.varchar({ length: 32 }).notNull(), // processing, succeeded, failed
  createdAt: d.timestamp({ withTimezone: true }).notNull().defaultNow(),
}));

export type Order = InferSelectModel<typeof order>;

export const credential = createTable("credential", (d) => ({
  id: d.uuid().primaryKey().notNull().defaultRandom(),
  userId: d.uuid().notNull().references(() => user.id, { onDelete: "cascade" }),
  merchant: d.varchar({ length: 128 }).notNull(),
  secret: d.text().notNull(), // Encrypted tokens/cookies
  createdAt: d.timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: d.timestamp({ withTimezone: true }).notNull().defaultNow(),
}));

export type Credential = InferSelectModel<typeof credential>;

// ============================================================================
// CHAT (Single Persistent Conversation)
// ============================================================================
export const message = createTable("message", (d) => ({
  id: d.uuid().primaryKey().notNull().defaultRandom(),
  userId: d.uuid().notNull().references(() => user.id, { onDelete: "cascade" }),
  role: d.varchar({ length: 32 }).notNull(), // user, assistant, system
  content: d.jsonb().notNull(),
  createdAt: d.timestamp({ withTimezone: true }).notNull().defaultNow(),
}));

export type Message = InferSelectModel<typeof message>;
