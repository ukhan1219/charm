"use client";

import type { UIMessage } from "@ai-sdk/react";
import { motion } from "framer-motion";
import { cn } from "~/lib/utils";
import { SparklesIcon, LoaderIcon } from "./icons";
import { Markdown } from "./markdown";
import { AgentJobStatus } from "./agent-job-status";

// AgentJobStatus support enabled

/**
 * Tool display names for better UX
 */
function getToolDisplayName(toolName?: string): string {
  if (!toolName) return "Processing";
  
  const displayNames: Record<string, string> = {
    searchProduct: "Searching for products",
    getProductInfo: "Getting product details",
    createSubscriptionIntent: "Creating subscription",
    updateSubscriptionIntent: "Updating subscription",
    pauseSubscription: "Pausing subscription",
    resumeSubscription: "Resuming subscription",
    cancelSubscription: "Canceling subscription",
    getMySubscriptions: "Loading your subscriptions",
    createAddress: "Saving address",
    getMyAddresses: "Loading your addresses",
    analyzeProduct: "Analyzing product page",
    startCheckout: "Starting checkout process",
  };

  return displayNames[toolName] || toolName;
}

/**
 * Individual message component
 * Handles AI SDK v5 message format with parts array
 */
export function PreviewMessage({ message, isLoading }: { message: UIMessage | any; isLoading?: boolean }) {
  return (
    <motion.div
      className="group/message mx-auto w-full max-w-3xl px-4"
      initial={{ y: 5, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      data-role={message.role}
    >
      <div
        className={cn(
          "flex items-start w-full gap-4 group-data-[role=user]/message:ml-auto group-data-[role=user]/message:max-w-2xl",
          "group-data-[role=user]/message:w-fit"
        )}
      >
        {message.role === "assistant" && (
          <div className="flex size-8 shrink-0 items-center justify-center rounded-full ring-1 ring-border">
            <SparklesIcon size={14} className="text-[#00ff84]" />
          </div>
        )}

        <div className="flex w-full flex-col gap-2">
          {/* Render message parts (AI SDK v5 format) */}
          {message.parts?.map((part: any, i: number) => {
            // Text parts
            if (part.type === "text") {
              return (
                <div key={`${message.id}-${i}`} className="flex flex-row items-start gap-2">
                  <div
                    className={cn(
                      "flex flex-col gap-4",
                      message.role === "user"
                        ? "rounded-xl bg-muted px-3 py-2 text-foreground"
                        : "text-foreground"
                    )}
                  >
                    {message.role === "user" ? (
                      <p className="whitespace-pre-wrap">{part.text}</p>
                    ) : (
                      <div className="text-foreground">
                        <Markdown>{part.text}</Markdown>
                      </div>
                    )}
                  </div>
                </div>
              );
            }

            // Tool call parts (shows what tool is being called)
            // AI SDK v5 uses format: "tool-{toolName}" with state property
            const isToolCall = part.type?.startsWith("tool-") && !part.type?.startsWith("tool-result");
            if (isToolCall) {
              // Extract tool name from type (e.g., "tool-searchProduct" -> "searchProduct")
              const toolName = part.toolName || part.type.replace("tool-", "").replace("tool-call-", "");
              
              // If tool has completed (state is "output-available"), show result instead of spinner
              if (part.state === "output-available" && part.output) {
                // Special handling for startCheckout with runId
                if (toolName === "startCheckout" && part.output?.runId) {
                  return (
                    <div key={`${message.id}-${i}`} className="space-y-2">
                      <AgentJobStatus runId={part.output.runId} />
                      {part.output.message && (
                        <div className="rounded-lg border border-green-500/20 bg-green-500/5 p-3 text-sm">
                          <div className="font-medium text-green-600 dark:text-green-400">
                            ✓ Checkout started
                          </div>
                          <p className="text-xs break-all mt-2">{part.output.message}</p>
                        </div>
                      )}
                    </div>
                  );
                }
                
                // Special handling for searchProduct results
                if (toolName === "searchProduct" && part.output?.products) {
                  return (
                    <div
                      key={`${message.id}-${i}`}
                      className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-4"
                    >
                      <div className="mb-3 font-medium text-blue-600 dark:text-blue-400">
                        🔍 Found {part.output.count} product
                      </div>
                      <div className="space-y-3">
                        {part.output.products.map((product: any, idx: number) => (
                          <div
                            key={idx}
                            className="rounded-lg border border-border bg-muted/50 p-3"
                          >
                            <div className="font-medium text-foreground mb-1">
                              {product.name}
                            </div>
                            {product.price && (
                              <div className="text-sm font-semibold text-green-600 dark:text-green-400 mb-1">
                                {product.price}
                              </div>
                            )}
                            {product.description && (
                              <p className="text-xs text-muted-foreground mb-2">
                                {product.description}
                              </p>
                            )}
                            {product.url && (
                              <a
                                href={product.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                              >
                                View on {product.merchant || "Website"} →
                              </a>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                }
                
                // Default completed tool result
                return (
                  <div
                    key={`${message.id}-${i}`}
                    className="rounded-lg border border-green-500/20 bg-green-500/5 p-3 text-sm"
                  >
                    <div className="font-medium text-green-600 dark:text-green-400">
                      ✓ {getToolDisplayName(toolName)} completed
                    </div>
                    {part.output.message && (
                      <p className="text-xs break-all mt-2">{part.output.message}</p>
                    )}
                  </div>
                );
              }
              
              // Tool is still running - show spinner
              const toolDisplayName = getToolDisplayName(toolName);
              const toolArgs = part.input || {};
              
              return (
                <div
                  key={`${message.id}-${i}`}
                  className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-3 text-sm my-2"
                >
                  <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400">
                    <LoaderIcon className="animate-spin" size={14} />
                    <span className="font-medium">
                      🔧 {toolDisplayName}
                    </span>
                  </div>
                  {toolArgs && Object.keys(toolArgs).length > 0 && (
                    <div className="mt-2 text-xs text-muted-foreground">
                      <div className="font-medium mb-1">Parameters:</div>
                      <div className="space-y-1">
                        {Object.entries(toolArgs).map(([key, value]) => (
                          <div key={key} className="flex gap-2">
                            <span className="font-mono text-blue-600 dark:text-blue-400 shrink-0">{key}:</span>
                            <span className="text-foreground break-all">{String(value)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            }

            // Tool result parts (shows tool output)
            if (part.type?.startsWith("tool-result")) {
              // Special handling for tools that return runId (like startCheckout)
              if (part.result?.runId) {
                return (
                  <div key={`${message.id}-${i}`} className="space-y-2">
                    {/* Display agent job status */}
                    <AgentJobStatus runId={part.result.runId} />
                    
                    {/* Also show the tool completion message if present */}
                    {part.result.message && (
                      <div className="rounded-lg border border-green-500/20 bg-green-500/5 p-3 text-sm">
                        <div className="font-medium text-green-600 dark:text-green-400">
                          ✓ {part.toolName || "Tool"} completed
                        </div>
                        <p className="text-xs break-all mt-2">{part.result.message}</p>
                      </div>
                    )}
                  </div>
                );
              }
              
              // Special handling for searchProduct results
              if (part.toolName === "searchProduct" && part.result?.products) {
                return (
                  <div
                    key={`${message.id}-${i}`}
                    className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-4"
                  >
                    <div className="mb-3 font-medium text-blue-600 dark:text-blue-400">
                      🔍 Found {part.result.count} product
                    </div>
                    <div className="space-y-2">
                      {part.result.products.map((product: any, idx: number) => (
                        <div
                          key={idx}
                          className="rounded border border-border bg-background p-3 hover:bg-muted/50 transition-colors"
                        >
                          <div className="flex gap-3">
                            {product.imageUrl && (
                              <img
                                src={product.imageUrl}
                                alt={product.name}
                                className="h-16 w-16 rounded object-cover"
                              />
                            )}
                            <div className="flex-1">
                              <div className="font-medium text-sm">{product.name}</div>
                              {product.price && (
                                <div className="text-xs text-green-600 dark:text-green-400 font-semibold mt-1">
                                  {product.price}
                                </div>
                              )}
                              {product.merchant && (
                                <div className="text-xs text-muted-foreground mt-1">
                                  {product.merchant}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              }

              // Default tool result display
              return (
                <div
                  key={`${message.id}-${i}`}
                  className="rounded-lg border border-green-500/20 bg-green-500/5 p-3 text-sm"
                >
                  <div className="font-medium text-green-600 dark:text-green-400">
                    ✓ {part.toolName || "Tool"} completed
                  </div>
                  {part.result && (
                    <div className="mt-2 wrap-break-word">
                      {typeof part.result === "string" ? (
                        <p className="text-xs break-all">{part.result}</p>
                      ) : part.result.message ? (
                        <p className="text-xs break-all">{part.result.message}</p>
                      ) : (
                        <pre className="text-xs opacity-70 overflow-x-auto whitespace-pre-wrap wrap-break-word">
                          {JSON.stringify(part.result, null, 2)}
                        </pre>
                      )}
                    </div>
                  )}
                </div>
              );
            }

            return null;
          })}

          {isLoading && message.role === "assistant" && (!message.parts || message.parts.length === 0) && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <LoaderIcon className="animate-spin" size={16} />
              <span>Thinking...</span>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

/**
 * Thinking indicator for when assistant is processing
 */
export function ThinkingMessage() {
  return (
    <motion.div
      className="mx-auto w-full max-w-3xl px-4"
      initial={{ y: 5, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
    >
      <div className="flex items-start w-full gap-4">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-full ring-1 ring-border">
          <SparklesIcon size={14} className="text-primary" />
        </div>
        <div className="flex items-center gap-2 text-muted-foreground">
          <LoaderIcon className="animate-spin" size={16} />
          <span>Thinking...</span>
        </div>
      </div>
    </motion.div>
  );
}

