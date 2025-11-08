"use client";

import { useRef, useEffect, type FormEvent } from "react";
import { ArrowUpIcon, StopIcon } from "./icons";
import { cn } from "~/lib/utils";

interface MultimodalInputProps {
  input: string;
  setInput: (value: string) => void;
  isLoading: boolean;
  stop: () => void;
  handleSubmit: (e: FormEvent<HTMLFormElement>) => void;
  className?: string;
}

/**
 * Input component for chat messages
 * Simplified version without attachments for MVP
 */
export function MultimodalInput({
  input,
  setInput,
  isLoading,
  stop,
  handleSubmit,
  className,
}: MultimodalInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      adjustHeight();
    }
  }, [input]);

  const adjustHeight = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight + 2}px`;
    }
  };

  const submitForm = () => {
    if (input.trim() && !isLoading) {
      // Create a synthetic form event
      const form = textareaRef.current?.form;
      if (form) {
        handleSubmit({
          preventDefault: () => {},
        } as FormEvent<HTMLFormElement>);
      }
    }
  };

  return (
    <div
      className={cn(
        "relative flex w-full items-end gap-2 rounded-xl bg-muted p-2",
        className
      )}
    >
      <form onSubmit={handleSubmit} className="flex w-full items-end gap-2 border-2 border-border rounded-xl p-3 border-">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            adjustHeight();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submitForm();
            }
          }}
          placeholder="Send a message..."
          className="max-h-[200px] min-h-[24px] w-full resize-none bg-transparent px-2 py-1.5 text-sm text-foreground outline-none placeholder:text-muted-foreground"
          rows={1}
        />

        {isLoading ? (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              stop();
            }}
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <StopIcon size={16} />
          </button>
        ) : (
          <button
            type="submit"
            disabled={!input.trim() || isLoading}
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            <ArrowUpIcon size={16} />
          </button>
        )}
      </form>
    </div>
  );
}

