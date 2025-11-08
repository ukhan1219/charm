import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { db } from "~/server/db";
import { agentRun } from "~/server/db/schema";
import { eq } from "drizzle-orm";

/**
 * GET /api/agents/status?runId=xxx
 * 
 * Poll the status of an agent job
 * 
 * Response:
 * {
 *   "runId": "uuid",
 *   "status": "running" | "done" | "failed",
 *   "phase": "plan" | "checkout" | "done" | "failed",
 *   "result": {...},  // Only when done
 *   "error": "...",   // Only when failed
 *   "createdAt": "timestamp",
 *   "endedAt": "timestamp"  // Only when done/failed
 * }
 */
export async function GET(req: Request) {
  const { userId: clerkUserId } = await auth();

  if (!clerkUserId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const runId = searchParams.get("runId");

    if (!runId) {
      return Response.json(
        { error: "Missing runId parameter" },
        { status: 400 }
      );
    }

    // Validate UUID format
    const uuidSchema = z.string().uuid();
    const validationResult = uuidSchema.safeParse(runId);
    
    if (!validationResult.success) {
      return Response.json(
        { error: "Invalid runId format" },
        { status: 400 }
      );
    }

    // Get agent run
    const run = await db.query.agentRun.findFirst({
      where: eq(agentRun.id, runId),
    });

    if (!run) {
      return Response.json(
        { error: "Agent run not found" },
        { status: 404 }
      );
    }

    // Determine status
    const status = run.endedAt
      ? run.phase === "failed"
        ? "failed"
        : "done"
      : "running";

    // Build response
    const response: any = {
      runId: run.id,
      status,
      phase: run.phase,
      createdAt: run.createdAt,
      browserbaseSessionId: run.browserbaseSessionId,
    };

    if (run.output) {
      response.result = run.output;
    }

    if (run.error) {
      response.error = run.error;
    }

    if (run.endedAt) {
      response.endedAt = run.endedAt;
      response.durationMs = run.endedAt.getTime() - run.createdAt.getTime();
    }

    return Response.json(response);
  } catch (error) {
    console.error("Failed to get agent status:", error);
    return Response.json(
      { error: "Failed to get agent status" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/agents/status/list
 * 
 * List all agent runs for the current user
 * Optional query params: limit, offset
 */
// // TODO: THIS DOESNT WORK RN
// export async function GET_LIST(req: Request) {
//   const { userId: clerkUserId } = await auth();

//   if (!clerkUserId) {
//     return Response.json({ error: "Unauthorized" }, { status: 401 });
//   }

//   try {
//     const { searchParams } = new URL(req.url);
//     const limit = parseInt(searchParams.get("limit") || "10");
//     const offset = parseInt(searchParams.get("offset") || "0");

//     // Get agent runs
//     // Note: We'd need to join with subscriptions to filter by userId
//     // For now, return all runs (in production, add proper filtering)
//     const runs = await db.query.agentRun.findMany({
//       limit,
//       offset,
//       orderBy: (agentRun, { desc }) => [desc(agentRun.createdAt)],
//     });

//     return Response.json({
//       runs: runs.map((run) => ({
//         runId: run.id,
//         phase: run.phase,
//         status: run.endedAt ? (run.phase === "failed" ? "failed" : "done") : "running",
//         createdAt: run.createdAt,
//         endedAt: run.endedAt,
//       })),
//       total: runs.length,
//       limit,
//       offset,
//     });
//   } catch (error) {
//     console.error("Failed to list agent runs:", error);
//     return Response.json(
//       { error: "Failed to list agent runs" },
//       { status: 500 }
//     );
//   }
// }

