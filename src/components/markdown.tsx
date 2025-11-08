"use client";

import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Markdown renderer for assistant messages
 * Properly renders markdown with GitHub Flavored Markdown support
 */
export const Markdown = memo(({ children }: { children: string }) => {
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none
      prose-p:leading-relaxed prose-pre:p-0
      prose-headings:font-semibold prose-headings:text-foreground
      prose-a:text-primary prose-a:no-underline hover:prose-a:underline
      prose-strong:text-foreground prose-strong:font-semibold
      prose-code:text-foreground prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:rounded
      prose-pre:bg-muted prose-pre:text-foreground
      prose-ul:my-2 prose-ol:my-2
      prose-li:my-1"
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
        // Code blocks
        pre: ({ children }) => (
          <pre className="overflow-x-auto rounded-lg bg-muted p-4">
            {children}
          </pre>
        ),
        // Inline code
        code: ({ children }) => (
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-sm">
            {children}
          </code>
        ),
        // Lists
        ul: ({ children }) => <ul className="my-2 ml-4 list-disc">{children}</ul>,
        ol: ({ children }) => <ol className="my-2 ml-4 list-decimal">{children}</ol>,
        // Links
        a: ({ href, children }) => (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            {children}
          </a>
        ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
});

Markdown.displayName = "Markdown";
