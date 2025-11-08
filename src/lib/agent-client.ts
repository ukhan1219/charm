/**
 * Agent API Client
 * Helper functions for interacting with agent endpoints
 */

/**
 * Start a plan agent job
 */
export async function startPlanAgent({
  userMessage,
  conversationHistory,
}: {
  userMessage: string;
  conversationHistory?: Array<{ role: "user" | "assistant"; content: string }>;
}) {
  const response = await fetch("/api/agents/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "plan",
      userMessage,
      conversationHistory,
    }),
  });

  if (!response.ok) {
    throw new Error("Failed to start plan agent");
  }

  return await response.json();
}

/**
 * Start a product intelligence agent job
 */
export async function startProductIntelligenceAgent({
  productUrl,
}: {
  productUrl: string;
}) {
  const response = await fetch("/api/agents/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "product_intelligence",
      productUrl,
    }),
  });

  if (!response.ok) {
    throw new Error("Failed to start product intelligence agent");
  }

  return await response.json();
}

/**
 * Start a checkout agent job
 */
export async function startCheckoutAgent({
  subscriptionId,
  productUrl,
  addressId,
  useNativeSubscription,
}: {
  subscriptionId: string;
  productUrl: string;
  addressId: string;
  useNativeSubscription?: boolean;
}) {
  const response = await fetch("/api/agents/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "checkout",
      subscriptionId,
      productUrl,
      addressId,
      useNativeSubscription,
    }),
  });

  if (!response.ok) {
    throw new Error("Failed to start checkout agent");
  }

  return await response.json();
}

/**
 * Get agent job status
 */
export async function getAgentStatus(runId: string) {
  const response = await fetch(`/api/agents/status?runId=${runId}`);

  if (!response.ok) {
    throw new Error("Failed to get agent status");
  }

  return await response.json();
}

/**
 * Poll agent job until completion
 */
export async function pollAgentUntilComplete(
  runId: string,
  options: {
    maxAttempts?: number;
    intervalMs?: number;
    onProgress?: (status: any) => void;
  } = {}
): Promise<any> {
  const { maxAttempts = 150, intervalMs = 2000, onProgress } = options;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const status = await getAgentStatus(runId);

    if (onProgress) {
      onProgress(status);
    }

    if (status.status === "done") {
      return status.result;
    }

    if (status.status === "failed") {
      throw new Error(status.error || "Agent job failed");
    }

    // Wait before next poll
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error("Agent job timed out");
}

