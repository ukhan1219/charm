"use client";

import { useEffect, useState } from "react";

/**
 * Agent Job Status
 */
export interface AgentJobStatus {
  runId: string;
  status: "running" | "done" | "failed";
  phase: string;
  result?: any;
  error?: string;
  createdAt: Date;
  endedAt?: Date;
  durationMs?: number;
  browserbaseSessionId?: string;
}

/**
 * Hook to poll agent job status
 * Automatically polls every 2 seconds until completion
 */
export function useAgentJob(runId: string | null) {
  const [status, setStatus] = useState<AgentJobStatus | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!runId) {
      setStatus(null);
      setIsPolling(false);
      return;
    }

    setIsPolling(true);
    let pollInterval: NodeJS.Timeout;

    const pollStatus = async () => {
      try {
        const response = await fetch(`/api/agents/status?runId=${runId}`);
        
        if (!response.ok) {
          throw new Error("Failed to fetch agent status");
        }

        const data = await response.json();
        setStatus(data);

        // Stop polling if job is done or failed
        if (data.status === "done" || data.status === "failed") {
          setIsPolling(false);
          clearInterval(pollInterval);
        }
      } catch (err) {
        console.error("Failed to poll agent status:", err);
        setError(err instanceof Error ? err.message : "Unknown error");
        setIsPolling(false);
        clearInterval(pollInterval);
      }
    };

    // Initial poll
    pollStatus();

    // Poll every 2 seconds
    pollInterval = setInterval(pollStatus, 2000);

    return () => {
      clearInterval(pollInterval);
    };
  }, [runId]);

  return {
    status,
    isPolling,
    error,
  };
}

/**
 * Start an agent job
 */
export async function startAgentJob(job: any): Promise<{
  runId: string;
  status: string;
  message: string;
} | null> {
  try {
    const response = await fetch("/api/agents/run", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(job),
    });

    if (!response.ok) {
      throw new Error("Failed to start agent job");
    }

    return await response.json();
  } catch (error) {
    console.error("Failed to start agent job:", error);
    return null;
  }
}

