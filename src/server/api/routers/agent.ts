import { z } from "zod";
import { createTRPCRouter, privateProcedure } from "~/server/api/trpc";
import {
  planWithProductDiscovery,
  analyzeProductSubscriptionCapability,
  executeCheckout,
} from "~/server/agents";
import { db } from "~/server/db";
import { agentRun } from "~/server/db/schema";
import { eq } from "drizzle-orm";

/**
 * Agent Router
 * Manage agent jobs and background tasks
 */
export const agentRouter = createTRPCRouter({
  /**
   * Start a plan agent job
   * Extract subscription intent from natural language
   */
  startPlan: privateProcedure
    .input(
      z.object({
        userMessage: z.string(),
        conversationHistory: z
          .array(
            z.object({
              role: z.enum(["user", "assistant"]),
              content: z.string(),
            })
          )
          .optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const result = await planWithProductDiscovery({
          userMessage: input.userMessage,
          conversationHistory: input.conversationHistory,
        });

        return result;
      } catch (error) {
        console.error("Plan agent failed:", error);
        return {
          success: false,
          error: "Failed to process subscription request",
        };
      }
    }),

  /**
   * Analyze product subscription capability
   */
  analyzeProduct: privateProcedure
    .input(
      z.object({
        productUrl: z.string().url(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const result = await analyzeProductSubscriptionCapability(
          input.productUrl
        );

        return result;
      } catch (error) {
        console.error("Product analysis failed:", error);
        return {
          success: false,
          error: "Failed to analyze product",
        };
      }
    }),

  /**
   * Start a checkout agent job
   */
  startCheckout: privateProcedure
    .input(
      z.object({
        subscriptionIntentId: z.string().uuid(), // Fixed: should be intentId, not subscriptionId
        productUrl: z.string().url(),
        addressId: z.string().uuid(),
        useNativeSubscription: z.boolean().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        // Get address
        const address = await db.query.address.findFirst({
          where: eq((await import("~/server/db/schema")).address.id, input.addressId),
        });

        if (!address) {
          return {
            success: false,
            error: "Address not found",
          };
        }

        // Execute checkout (will create its own agent run)
        const result = await executeCheckout({
          productUrl: input.productUrl,
          subscriptionIntentId: input.subscriptionIntentId, // Fixed parameter name
          address: {
            street1: address.street1,
            street2: address.street2 || undefined,
            city: address.city,
            state: address.state,
            zipCode: address.zipCode,
          },
          paymentMethod: {
            type: "stripe_saved",
            details: {}, // TODO: Get from Stripe
          },
          useNativeSubscription: input.useNativeSubscription,
          // Don't pass agentRunId - let executeCheckout create its own for TRPC calls
        });

        return result;
      } catch (error) {
        console.error("Checkout failed:", error);
        return {
          success: false,
          error: "Failed to start checkout",
        };
      }
    }),

  /**
   * Get agent run status by ID
   */
  getRunStatus: privateProcedure
    .input(z.object({ runId: z.string().uuid() }))
    .query(async ({ input }) => {
      const run = await db.query.agentRun.findFirst({
        where: eq(agentRun.id, input.runId),
      });

      if (!run) {
        throw new Error("Agent run not found");
      }

      const status = run.endedAt
        ? run.phase === "failed"
          ? "failed"
          : "done"
        : "running";

      return {
        runId: run.id,
        status,
        phase: run.phase,
        result: run.output,
        error: run.error,
        createdAt: run.createdAt,
        endedAt: run.endedAt,
        browserbaseSessionId: run.browserbaseSessionId,
      };
    }),

  /**
   * List all agent runs for current user
   */
  getMyRuns: privateProcedure
    .input(
      z.object({
        limit: z.number().int().positive().default(10),
        offset: z.number().int().default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      // Get agent runs via subscriptions
      const runs = await db.query.agentRun.findMany({
        limit: input.limit,
        offset: input.offset,
        orderBy: (agentRun, { desc }) => [desc(agentRun.createdAt)],
      });

      return {
        runs: runs.map((run) => ({
          runId: run.id,
          phase: run.phase,
          status: run.endedAt
            ? run.phase === "failed"
              ? "failed"
              : "done"
            : "running",
          createdAt: run.createdAt,
          endedAt: run.endedAt,
        })),
        total: runs.length,
      };
    }),
});

