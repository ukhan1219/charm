import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { db } from "~/server/db";
import { agentRun, subscriptionIntent } from "~/server/db/schema";
import { getOrCreateUserByClerkId } from "~/server/db/queries";
import {
  planWithProductDiscovery,
  analyzeProductSubscriptionCapability,
  executeCheckout,
} from "~/server/agents";
import { generateUUID } from "~/lib/utils";
import { eq } from "drizzle-orm";

export const maxDuration = 300; // 5 minutes for long-running Browserbase sessions

/**
 * Agent Job Types
 */
const agentJobSchema = z.discriminatedUnion("type", [
  // Plan: Extract subscription intent from NL
  z.object({
    type: z.literal("plan"),
    userMessage: z.string(),
    conversationHistory: z.array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string(),
      })
    ).optional(),
  }),
  
  // Product Intelligence: Analyze subscription capability
  z.object({
    type: z.literal("product_intelligence"),
    productUrl: z.string().url(),
  }),
  
  // Checkout: Execute checkout flow
  z.object({
    type: z.literal("checkout"),
    subscriptionId: z.string().uuid(),
    productUrl: z.string().url(),
    addressId: z.string().uuid(),
    useNativeSubscription: z.boolean().optional(),
  }),
]);

type AgentJob = z.infer<typeof agentJobSchema>;

/**
 * POST /api/agents/run
 * 
 * Kick off a background agent job
 * Returns a runId for polling status
 * 
 * Example:
 * POST /api/agents/run
 * {
 *   "type": "plan",
 *   "userMessage": "Subscribe me to dish soap every month"
 * }
 * 
 * Response:
 * {
 *   "runId": "uuid",
 *   "status": "running",
 *   "message": "Agent job started"
 * }
 */
export async function POST(req: Request) {
  const { userId: clerkUserId } = await auth();

  if (!clerkUserId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Parse and validate request
    const body = await req.json();
    const jobData = agentJobSchema.parse(body);

    // Get database user
    const clerkUser = await auth();
    const dbUser = await getOrCreateUserByClerkId({
      clerkId: clerkUserId,
      email: clerkUser?.sessionClaims?.email as string || "unknown@example.com",
    });

    const runId = generateUUID();

    // Execute agent job based on type
    // Note: In production, use Vercel Queue or similar for true background processing
    // For now, we execute inline with extended timeout
    executeAgentJob({
      runId,
      userId: dbUser.id,
      job: jobData,
    }).catch((error) => {
      console.error(`Agent job ${runId} failed:`, error);
    });

    return Response.json({
      runId,
      status: "running",
      message: "Agent job started",
    });
  } catch (error) {
    console.error("Failed to start agent job:", error);
    
    if (error instanceof z.ZodError) {
      return Response.json(
        { error: "Invalid request data", details: error.errors },
        { status: 400 }
      );
    }

    return Response.json(
      { error: "Failed to start agent job" },
      { status: 500 }
    );
  }
}

/**
 * Execute agent job (runs in background)
 */
async function executeAgentJob({
  runId,
  userId,
  job,
}: {
  runId: string;
  userId: string;
  job: AgentJob;
}) {
  try {
    console.log(`🤖 Starting agent job ${runId}:`, job.type);

    // Create agent run record
    const [run] = await db
      .insert(agentRun)
      .values({
        id: runId,
        phase: job.type === "plan" ? "plan" : job.type === "checkout" ? "checkout" : "plan",
        input: job,
        createdAt: new Date(),
      })
      .returning();

    let result: any;

    switch (job.type) {
      case "plan": {
        // Extract subscription intent from natural language
        result = await planWithProductDiscovery({
          userMessage: job.userMessage,
          conversationHistory: job.conversationHistory,
        });
        break;
      }

      case "product_intelligence": {
        // Analyze product subscription capability
        result = await analyzeProductSubscriptionCapability(job.productUrl);
        break;
      }

      case "checkout": {
        // Get subscription and address details
        const subscription = await db.query.subscription.findFirst({
          where: eq(subscriptionIntent.id, job.subscriptionId),
        });

        const address = await db.query.address.findFirst({
          where: eq(subscriptionIntent.userId, userId),
        });

        if (!subscription || !address) {
          throw new Error("Subscription or address not found");
        }

        // Execute checkout
        result = await executeCheckout({
          productUrl: job.productUrl,
          subscriptionId: job.subscriptionId,
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
          useNativeSubscription: job.useNativeSubscription,
        });
        break;
      }
    }

    // Update agent run with result
    await db
      .update(agentRun)
      .set({
        phase: "done",
        output: result,
        endedAt: new Date(),
      })
      .where(eq(agentRun.id, runId));

    console.log(`✅ Agent job ${runId} completed`);
  } catch (error) {
    console.error(`❌ Agent job ${runId} failed:`, error);

    // Update agent run with error
    await db
      .update(agentRun)
      .set({
        phase: "failed",
        error: error instanceof Error ? error.message : "Unknown error",
        endedAt: new Date(),
      })
      .where(eq(agentRun.id, runId));
  }
}

