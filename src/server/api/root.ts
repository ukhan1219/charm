import { createCallerFactory, createTRPCRouter } from "~/server/api/trpc";
import { healthRouter } from "~/server/api/routers/health";
import { subscriptionRouter } from "~/server/api/routers/subscription";
import { agentRouter } from "~/server/api/routers/agent";
import { productRouter } from "~/server/api/routers/product";
import { addressRouter } from "~/server/api/routers/address";

/**
 * This is the primary router for your server.
 *
 * All routers added in /api/routers should be manually added here.
 */
export const appRouter = createTRPCRouter({
  health: healthRouter,
  subscription: subscriptionRouter,
  agent: agentRouter,
  product: productRouter,
  address: addressRouter,
});

// export type definition of API
export type AppRouter = typeof appRouter;

/**
 * Create a server-side caller for the tRPC API.
 * @example
 * const trpc = createCaller(createContext);
 * const res = await trpc.post.all();
 *       ^? Post[]
 */
export const createCaller = createCallerFactory(appRouter);
