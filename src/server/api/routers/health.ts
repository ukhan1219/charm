import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";

/**
 * Health check router
 * Minimal router to satisfy tRPC requirements
 */
export const healthRouter = createTRPCRouter({
  check: publicProcedure.query(() => {
    return { status: "ok", message: "Charm v2 API is running" };
  }),
});

