import { z } from "zod";
import { createTRPCRouter, privateProcedure } from "~/server/api/trpc";
import {
  createSubscriptionIntent,
  getSubscriptionIntentsByUserId,
  updateSubscriptionIntent,
  deleteSubscriptionIntent,
  createSubscription,
  getSubscriptionsByUserId,
  getSubscriptionById,
  updateSubscriptionStatus,
  updateSubscription,
  deleteSubscription,
  getOrCreateProduct,
} from "~/server/db/queries";
import { usStates } from "~/server/db/schema";

/**
 * Subscription Router
 * Full CRUD operations for subscription intents and active subscriptions
 */
export const subscriptionRouter = createTRPCRouter({
  // ============================================================================
  // SUBSCRIPTION INTENTS
  // ============================================================================

  /**
   * Create a subscription intent from natural language
   */
  createIntent: privateProcedure
    .input(
      z.object({
        title: z.string().min(1, "Title is required"),
        productUrl: z.string().url("Must be a valid URL"),
        cadenceDays: z.number().int().positive("Must be a positive number"),
        maxPriceCents: z.number().int().optional(),
        constraints: z.record(z.string()).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const intent = await createSubscriptionIntent({
        userId: ctx.userId,
        title: input.title,
        productUrl: input.productUrl,
        cadenceDays: input.cadenceDays,
        maxPriceCents: input.maxPriceCents,
        constraints: input.constraints,
      });

      return {
        success: true,
        intent,
        message: `Subscription intent created for "${input.title}"`,
      };
    }),

  /**
   * Get all subscription intents for the current user
   */
  getMyIntents: privateProcedure.query(async ({ ctx }) => {
    const intents = await getSubscriptionIntentsByUserId(ctx.userId);
    return {
      intents,
      count: intents.length,
    };
  }),

  /**
   * Get a single subscription intent by ID
   */
  getIntentById: privateProcedure
    .input(z.object({ intentId: z.string().uuid() }))
    .query(async ({ input }) => {
      const { subscriptionIntent } = await import("~/server/db/schema");
      const { eq } = await import("drizzle-orm");
      const { db } = await import("~/server/db");
      
      const intent = await db.query.subscriptionIntent.findFirst({
        where: eq(subscriptionIntent.id, input.intentId),
      });

      if (!intent) {
        throw new Error("Subscription intent not found");
      }

      return intent;
    }),

  /**
   * Update a subscription intent
   */
  updateIntent: privateProcedure
    .input(
      z.object({
        intentId: z.string().uuid(),
        updates: z.object({
          title: z.string().optional(),
          cadenceDays: z.number().int().positive().optional(),
          maxPriceCents: z.number().int().optional(),
          constraints: z.record(z.string()).optional(),
          status: z.enum(["active", "paused", "canceled", "error"]).optional(),
        }),
      })
    )
    .mutation(async ({ input }) => {
      const [updated] = await updateSubscriptionIntent({
        id: input.intentId,
        updates: input.updates,
      });

      // Sync changes to linked subscriptions
      const { syncIntentToSubscriptions } = await import("~/server/db/queries");
      await syncIntentToSubscriptions(input.intentId);

      return {
        success: true,
        intent: updated,
        message: "Subscription intent updated",
      };
    }),

  /**
   * Pause a subscription intent
   */
  pauseIntent: privateProcedure
    .input(z.object({ intentId: z.string().uuid() }))
    .mutation(async ({ input }) => {
      await updateSubscriptionIntent({
        id: input.intentId,
        updates: { status: "paused" },
      });

      // Sync status to linked subscriptions
      const { syncIntentToSubscriptions } = await import("~/server/db/queries");
      await syncIntentToSubscriptions(input.intentId);

      return {
        success: true,
        message: "Subscription paused",
      };
    }),

  /**
   * Resume a paused subscription intent
   */
  resumeIntent: privateProcedure
    .input(z.object({ intentId: z.string().uuid() }))
    .mutation(async ({ input }) => {
      await updateSubscriptionIntent({
        id: input.intentId,
        updates: { status: "active" },
      });

      // Sync status to linked subscriptions
      const { syncIntentToSubscriptions } = await import("~/server/db/queries");
      await syncIntentToSubscriptions(input.intentId);

      return {
        success: true,
        message: "Subscription resumed",
      };
    }),

  /**
   * Delete/cancel a subscription intent (soft delete)
   */
  deleteIntent: privateProcedure
    .input(z.object({ intentId: z.string().uuid() }))
    .mutation(async ({ input }) => {
      // Soft delete: marks as canceled instead of deleting
      await deleteSubscriptionIntent(input.intentId);

      return {
        success: true,
        message: "Subscription canceled",
      };
    }),

  // ============================================================================
  // ACTIVE SUBSCRIPTIONS
  // ============================================================================

  /**
   * Create an active subscription
   * (Usually called after successful checkout)
   */
  createSubscription: privateProcedure
    .input(
      z.object({
        productUrl: z.string().url(),
        productName: z.string(),
        intentId: z.string().uuid().optional(),
        renewalFrequencyDays: z.number().int().positive(),
        addressId: z.string().uuid(),
        lastPriceCents: z.number().int().optional(),
        merchant: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Get or create product with current price
      const product = await getOrCreateProduct({
        name: input.productName,
        url: input.productUrl,
        merchant: input.merchant,
        currentPriceCents: input.lastPriceCents,
      });

      // Create subscription
      const subscription = await createSubscription({
        userId: ctx.userId,
        productId: product.id,
        intentId: input.intentId,
        renewalFrequencyDays: input.renewalFrequencyDays,
        addressId: input.addressId,
        lastPriceCents: input.lastPriceCents,
      });

      return {
        success: true,
        subscription,
        message: "Subscription activated",
      };
    }),

  /**
   * Get all active subscriptions for the current user
   */
  getMySubscriptions: privateProcedure.query(async ({ ctx }) => {
    const subscriptions = await getSubscriptionsByUserId(ctx.userId);
    return {
      subscriptions,
      count: subscriptions.length,
    };
  }),

  /**
   * Get a single subscription by ID
   */
  getSubscriptionById: privateProcedure
    .input(z.object({ subscriptionId: z.string().uuid() }))
    .query(async ({ input }) => {
      const subscription = await getSubscriptionById(input.subscriptionId);

      if (!subscription) {
        throw new Error("Subscription not found");
      }

      return subscription;
    }),

  /**
   * Update subscription status
   */
  updateStatus: privateProcedure
    .input(
      z.object({
        subscriptionId: z.string().uuid(),
        status: z.enum(["active", "paused", "canceled"]),
      })
    )
    .mutation(async ({ input }) => {
      const [updated] = await updateSubscriptionStatus({
        id: input.subscriptionId,
        status: input.status,
      });

      return {
        success: true,
        subscription: updated,
        message: `Subscription ${input.status}`,
      };
    }),

  /**
   * Update subscription details
   */
  updateSubscription: privateProcedure
    .input(
      z.object({
        subscriptionId: z.string().uuid(),
        updates: z.object({
          renewalFrequencyDays: z.number().int().positive().optional(),
          addressId: z.string().uuid().optional(),
          lastPriceCents: z.number().int().optional(),
        }),
      })
    )
    .mutation(async ({ input }) => {
      const [updated] = await updateSubscription({
        id: input.subscriptionId,
        updates: input.updates,
      });

      return {
        success: true,
        subscription: updated,
        message: "Subscription updated",
      };
    }),

  /**
   * Delete an active subscription
   */
  deleteSubscription: privateProcedure
    .input(z.object({ subscriptionId: z.string().uuid() }))
    .mutation(async ({ input }) => {
      await deleteSubscription(input.subscriptionId);

      return {
        success: true,
        message: "Subscription deleted",
      };
    }),

  // ============================================================================
  // COMBINED QUERIES
  // ============================================================================

  /**
   * Get everything: intents + subscriptions + addresses
   * Useful for dashboard overview
   */
  getDashboard: privateProcedure.query(async ({ ctx }) => {
    const [intents, subscriptions, addresses] = await Promise.all([
      getSubscriptionIntentsByUserId(ctx.userId, { includeCanceled: false }), // Exclude canceled by default
      getSubscriptionsByUserId(ctx.userId),
      (async () => {
        const { getUserAddresses } = await import("~/server/db/queries");
        return getUserAddresses(ctx.userId);
      })(),
    ]);

    return {
      intents,
      subscriptions,
      addresses,
      stats: {
        totalIntents: intents.length,
        activeIntents: intents.filter((i) => i.status === "active").length,
        pausedIntents: intents.filter((i) => i.status === "paused").length,
        totalSubscriptions: subscriptions.length,
      },
    };
  }),
});

