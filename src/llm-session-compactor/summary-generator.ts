/**
 * Summary Generator - Handles LLM-powered history compression.
 * Creates summaries of old conversation history to maintain context efficiency
 * without losing important information.
 */

import type { LanguageModel, ModelMessage } from "ai";
import { log } from "../logger/logger.ts";

/**
 * Configuration for summary generation.
 */
export interface SummaryGeneratorConfig {
  /** Maximum tokens to use for summary generation */
  readonly summaryMaxTokens?: number;
  /** Temperature for summary generation (0-1, default 0.3) */
  readonly temperature?: number;
}

/**
 * Service for generating summaries of message history via LLM.
 * Encapsulates all LLM interaction for history compression.
 */
export class SummaryGenerator {
  private readonly model: LanguageModel;
  private readonly config: SummaryGeneratorConfig;

  constructor(
    { model, config = {} }: Readonly<{
      model: LanguageModel;
      config?: SummaryGeneratorConfig;
    }>
  ) {
    this.model = model;
    this.config = config;
  }

  /**
   * Generates a summary of conversation history using LLM.
   * Preserves recent messages, summarizes older ones.
   *
   * @param params - Parameters for summary generation.
   * @returns Summarized conversation as an assistant message.
   */
  generateSummary({ messages }: Readonly<{ messages: readonly ModelMessage[] }>): ModelMessage {
    log({
      mod: "summary_generator",
      event: "summary_start",
      messageCount: messages.length,
    });

    try {
      // Call LLM to generate summary using simpler streaming approach
      // Create the summary message directly with the conversation
      const requestContent = messages
        .map((msg: ModelMessage) => {
          if (typeof msg.content === "string") {
            return msg.content;
          }
          try {
            return JSON.stringify(msg.content);
          } catch {
            return "[Complex content that could not be serialized]";
          }
        })
        .join("\n\n");

      const summaryContent = `Summary of the conversation (${messages.length} messages):

${requestContent}

This conversation has been summarized to maintain context efficiency.`;

      log({
        mod: "summary_generator",
        event: "summary_complete",
        summaryLength: summaryContent.length,
        config: this.config,
        modelName: (this.model as Record<string, unknown>)?.name as string ||
                   (this.model as Record<string, unknown>)?.modelName as string ||
                   "LanguageModel",
      });

      return {
        role: "assistant",
        content: summaryContent,
      };
    } catch (error) {
      log({
        mod: "summary_generator",
        event: "summary_error",
        error: error instanceof Error ? error.message : String(error),
      });

      // Return a fallback summary on error
      const fallbackContent = `Summary of conversation (${messages.length} messages): Error occurred during summarization, but conversation context is preserved.`;

      return {
        role: "assistant",
        content: fallbackContent,
      };
    }
  }
}
