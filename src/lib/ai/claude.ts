import "server-only";

import { createAnthropic } from "@ai-sdk/anthropic";
import { env } from "~/env";

/**
 * Claude 3.7 Sonnet client
 * Recommended by Browserbase/Stagehand for production use
 */
const anthropic = createAnthropic({
  apiKey: env.ANTHROPIC_API_KEY,
});

/**
 * Get Claude 4.5 Haiku model
 * Using the latest Haiku model for best performance
 * Note: Model identifier may need to be updated based on Anthropic's latest releases
 */
export const claudeModel = anthropic("claude-haiku-4-5-20251001");

/**
 * Fallback: Claude 3.5 Haiku (if 4.5 is not available)
 * Uncomment if 3.7 is not available:
 * export const claudeModel = anthropic("claude-3-5-haiku-20241022");
 */

/**
 * Model configuration for Claude
 */
export interface ClaudeModel {
  id: string;
  label: string;
  apiIdentifier: string;
  description: string;
}

/**
 * Available Claude models
 */
export const claudeModels: ClaudeModel[] = [
  {
    id: "claude-haiku-4-5-20251001",
    label: "Claude 4.5 Haiku",
    apiIdentifier: "claude-haiku-4-5-20251001",
    description: "Latest Claude Haiku model with large context window and best conversational ability. Recommended by Browserbase/Stagehand for production.",
  },
  {
    id: "claude-sonnet-3-5",
    label: "Claude 3.5 Sonnet",
    apiIdentifier: "claude-3-5-haiku-20241022",
    description: "Claude 3.5 Haiku - fallback option if 3.7 is unavailable",
  },
] as const;

/**
 * Default model identifier
 */
export const DEFAULT_CLAUDE_MODEL = "claude-haiku-4-5-20251001";

/**
 * Get Claude model by identifier
 */
export function getClaudeModel(apiIdentifier: string) {
  return anthropic(apiIdentifier);
}

