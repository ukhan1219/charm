"use client";

import type { UIMessage } from "@ai-sdk/react";
import { motion } from "framer-motion";
import { cn } from "~/lib/utils";
import { SparklesIcon, LoaderIcon } from "./icons";
import { Markdown } from "./markdown";

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
          "flex w-full gap-4 group-data-[role=user]/message:ml-auto group-data-[role=user]/message:max-w-2xl",
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
            if (part.type?.startsWith("tool-call")) {
              return (
                <div
                  key={`${message.id}-${i}`}
                  className="rounded-lg border border-border bg-muted/50 p-3 text-sm"
                >
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <LoaderIcon className="animate-spin" size={14} />
                    <span className="font-medium">
                      Calling {part.toolName || "tool"}...
                    </span>
                  </div>
                  {part.args && (
                    <pre className="mt-2 text-xs opacity-70">
                      {JSON.stringify(part.args, null, 2)}
                    </pre>
                  )}
                </div>
              );
            }

            // Tool result parts (shows tool output)
            if (part.type?.startsWith("tool-result")) {
              // Special handling for searchProduct results
              if (part.toolName === "searchProduct" && part.result?.products) {
                return (
                  <div
                    key={`${message.id}-${i}`}
                    className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-4"
                  >
                    <div className="mb-3 font-medium text-blue-600 dark:text-blue-400">
                      🔍 Found {part.result.count} products
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
                    <div className="mt-2">
                      {typeof part.result === "string" ? (
                        <p className="text-xs">{part.result}</p>
                      ) : part.result.message ? (
                        <p className="text-xs">{part.result.message}</p>
                      ) : (
                        <pre className="text-xs opacity-70">
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
      <div className="flex w-full gap-4">
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

