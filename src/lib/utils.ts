import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Utility to merge Tailwind CSS classes
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Generate a random UUID
 */
export function generateUUID(): string {
  return crypto.randomUUID();
}

/**
 * Sanitize messages for UI display
 * Removes tool calls that are not complete
 */
export function sanitizeUIMessages(messages: any[]) {
  return messages.filter((message) => {
    if (message.role === "assistant" && message.toolInvocations) {
      return message.toolInvocations.every((tool: any) => "result" in tool);
    }
    return true;
  });
}

