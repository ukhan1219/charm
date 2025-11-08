"use client";

import { LoaderIcon } from "./icons";

/**
 * Display component for tool calls and results
 */
export function ToolCallDisplay({ toolName, args }: { toolName: string; args?: any }) {
  return (
    <div className="rounded-lg border border-border bg-muted/50 p-3 text-sm">
      <div className="flex items-center gap-2 text-muted-foreground">
        <LoaderIcon className="animate-spin" size={14} />
        <span className="font-medium">Calling {toolName}...</span>
      </div>
      {args && (
        <pre className="mt-2 text-xs opacity-70">
          {JSON.stringify(args, null, 2)}
        </pre>
      )}
    </div>
  );
}

export function ToolResultDisplay({ toolName, result }: { toolName: string; result: any }) {
  const isSuccess = result?.success !== false;
  
  return (
    <div
      className={`rounded-lg border p-3 text-sm ${
        isSuccess
          ? "border-green-500/20 bg-green-500/5"
          : "border-red-500/20 bg-red-500/5"
      }`}
    >
      <div
        className={`font-medium ${
          isSuccess
            ? "text-green-600 dark:text-green-400"
            : "text-red-600 dark:text-red-400"
        }`}
      >
        {isSuccess ? "✓" : "✗"} {toolName} {isSuccess ? "completed" : "failed"}
      </div>
      {result && (
        <div className="mt-2">
          {typeof result === "string" ? (
            <p className="text-xs">{result}</p>
          ) : result.message ? (
            <p className="text-xs">{result.message}</p>
          ) : result.error ? (
            <p className="text-xs text-red-600 dark:text-red-400">{result.error}</p>
          ) : (
            <pre className="text-xs opacity-70">
              {JSON.stringify(result, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

