"use client";

import { memo } from "react";

/**
 * Simple markdown renderer
 * TODO: Add full markdown support with react-markdown if needed
 */
export const Markdown = memo(({ children }: { children: string }) => {
  return (
    <div className="prose prose-zinc dark:prose-invert max-w-none prose-p:text-foreground prose-headings:text-foreground">
      {children}
    </div>
  );
});

Markdown.displayName = "Markdown";

