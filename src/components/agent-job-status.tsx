"use client";

import { useAgentJob } from "~/hooks/use-agent-job";
import { LoaderIcon } from "./icons";

/**
 * Agent Job Status Display
 * Shows real-time progress of agent jobs (checkout, product analysis, etc.)
 */
export function AgentJobStatus({ runId }: { runId: string }) {
  const { status, isPolling, error } = useAgentJob(runId);

  if (error) {
    return (
      <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-sm">
        <div className="font-medium text-red-600 dark:text-red-400">
          ❌ Agent job failed
        </div>
        <p className="mt-1 text-xs text-red-600/80 dark:text-red-400/80">{error}</p>
      </div>
    );
  }

  if (!status) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <LoaderIcon className="animate-spin" size={14} />
        <span className="text-xs">Loading status...</span>
      </div>
    );
  }

  // Running
  if (status.status === "running") {
    return (
      <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-3 text-sm">
        <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400">
          <LoaderIcon className="animate-spin" size={14} />
          <span className="font-medium">
            {status.phase === "plan" && "Planning subscription..."}
            {status.phase === "checkout" && "Processing checkout..."}
            {status.phase === "product_intelligence" && "Analyzing product..."}
          </span>
        </div>
        {status.browserbaseSessionId && (
          <p className="mt-1 text-xs opacity-70">
            Session: {status.browserbaseSessionId.slice(0, 8)}...
          </p>
        )}
      </div>
    );
  }

  // Done
  if (status.status === "done") {
    return (
      <div className="rounded-lg border border-green-500/20 bg-green-500/5 p-3 text-sm">
        <div className="font-medium text-green-600 dark:text-green-400">
          ✓ Agent job completed
        </div>
        {status.durationMs && (
          <p className="mt-1 text-xs opacity-70">
            Completed in {(status.durationMs / 1000).toFixed(1)}s
          </p>
        )}
        {status.result && (
          <pre className="mt-2 text-xs opacity-70">
            {JSON.stringify(status.result, null, 2)}
          </pre>
        )}
      </div>
    );
  }

  // Failed
  if (status.status === "failed") {
    return (
      <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-sm">
        <div className="font-medium text-red-600 dark:text-red-400">
          ❌ Agent job failed
        </div>
        {status.error && (
          <p className="mt-1 text-xs text-red-600/80 dark:text-red-400/80">
            {status.error}
          </p>
        )}
      </div>
    );
  }

  return null;
}

