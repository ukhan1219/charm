"use client";

import type { UIMessage } from "@ai-sdk/react";
import { memo } from "react";
import { useScrollToBottom } from "./use-scroll-to-bottom";
import { Overview } from "./overview";
import { PreviewMessage, ThinkingMessage } from "./message";

interface MessagesProps {
  messages: UIMessage[];
  isLoading: boolean;
}

function PureMessages({ messages, isLoading }: MessagesProps) {
  const [messagesContainerRef, messagesEndRef] =
    useScrollToBottom<HTMLDivElement>();

  return (
    <div
      ref={messagesContainerRef}
      className="flex min-w-0 flex-1 flex-col gap-6 overflow-y-scroll pt-4"
    >
      {messages.length === 0 && <Overview />}

      {messages.map((message, index) => (
        <PreviewMessage
          key={message.id}
          message={message}
          isLoading={isLoading && messages.length - 1 === index}
        />
      ))}

      {isLoading &&
        messages.length > 0 &&
        (messages[messages.length - 1]?.role === "user" ||
          (messages[messages.length - 1]?.role === "assistant" &&
            (!messages[messages.length - 1]?.parts ||
              messages[messages.length - 1]?.parts?.length === 0 ||
              !messages[messages.length - 1]?.parts?.some(
                (part: any) => part.type === "text" || part.type?.startsWith("tool-result")
              )))) && <ThinkingMessage />}

      <div
        ref={messagesEndRef}
        className="min-h-[24px] min-w-[24px] shrink-0"
      />
    </div>
  );
}

export const Messages = memo(PureMessages);

