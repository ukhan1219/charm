/**
 * Model definitions for the application
 * Using Claude 3.7 Sonnet as the primary model
 */

import type { ClaudeModel } from "./claude";
import { claudeModels, DEFAULT_CLAUDE_MODEL } from "./claude";

// Re-export for convenience
export type { ClaudeModel };
export { claudeModels, DEFAULT_CLAUDE_MODEL };

/**
 * Get model by ID
 */
export function getModelById(id: string): ClaudeModel | undefined {
  return claudeModels.find((model) => model.id === id);
}

/**
 * Get default model
 */
export function getDefaultModel(): ClaudeModel {
  const model = getModelById(DEFAULT_CLAUDE_MODEL);
  if (!model) {
    throw new Error(`Default model ${DEFAULT_CLAUDE_MODEL} not found`);
  }
  return model;
}

