"use client";

import { useChat } from "@ai-sdk/react";
import { useState } from "react";
import { Messages } from "./messages";
import { MultimodalInput } from "./multimodal-input";

/**
 * Main chat component - Single persistent conversation
 * No chatId needed - conversation tied to user
 */
export function Chat({ initialMessages = [] }: { initialMessages?: any[] }) {
  const [input, setInput] = useState("");
  const chat = useChat() as any;
  const { messages, sendMessage, stop } = chat;
  const isGenerating = chat.isGenerating || false;

  // Merge initial messages with current messages
  const allMessages = initialMessages.length > 0 && messages.length === 0 
    ? initialMessages 
    : messages;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim()) {
      sendMessage({ text: input });
      setInput("");
    }
  };

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col bg-background">
      {/* Messages area - subtract header height (4rem = 64px) */}
      <Messages messages={allMessages} isLoading={isGenerating} />

      {/* Input area */}
      <div className="mx-auto w-full max-w-3xl gap-2 bg-background px-4 pb-4 md:pb-6">
        <MultimodalInput
          input={input}
          setInput={setInput}
          handleSubmit={handleSubmit}
          isLoading={isGenerating}
          stop={stop}
        />
      </div>
    </div>
  );
}

