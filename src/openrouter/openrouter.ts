/**
 * Direct OpenRouter SDK integration module.
 *
 * Provides `createOpenRouterRequester()` that uses the official `@openrouter/sdk`
 * instead of the Vercel AI SDK abstraction layer, while producing the same
 * `GenerateResult<T>` interface for drop-in compatibility with `Agent`.
 *
 * @module
 */

import { OpenRouter } from "@openrouter/sdk";
import type {
  ChatGenerationParams,
  ChatResponse,
  Message,
  ToolDefinitionJson,
} from "@openrouter/sdk/models";
import type { SendChatCompletionRequestRequest } from "@openrouter/sdk/models/operations";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { z } from "zod";
import { dump as yamlDump } from "js-yaml";
import type { ModelMessage, Tool } from "ai";
import type { Logger } from "../logger/logger.ts";
import type { RunContext } from "../run-context/run-context.ts";
import { getSubDebugDir } from "../run-context/run-context.ts";
import type {
  GenerateResult,
  LlmRequester,
  LlmRequesterParams,
  LlmSettings,
} from "../llm/llm.ts";
import { ModelURI } from "../llm/llm.ts";

// ---------------------------------------------------------------------------
// Engine interface for testability
// ---------------------------------------------------------------------------

/**
 * Interface for the underlying HTTP transport to allow mocking in tests.
 */
export interface OpenRouterEngine {
  chatSend(params: ChatGenerationParams): Promise<ChatResponse>;
}

// ---------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------

/**
 * Parameters for creating an OpenRouter requester.
 * Extends `LlmRequesterParams` with an optional test engine.
 */
export interface OpenRouterRequesterParams extends LlmRequesterParams {
  /** Optional engine override for tests. */
  readonly engine?: OpenRouterEngine;
}

// ---------------------------------------------------------------------------
// Internal types for YAML logging
// ---------------------------------------------------------------------------

interface YamlLogAttempt {
  readonly attempt: number;
  readonly timestamp: string;
  // deno-lint-ignore no-explicit-any
  readonly response?: { status: number; raw: string; parsed: any; steps?: unknown[]; error?: string };
  readonly stats?: { duration: number; cost: number; tokens: { input: number; output: number; total: number } };
  readonly error?: string;
}

interface YamlLogData {
  readonly id: string;
  readonly timestamp: string;
  readonly model: string;
  readonly stage: string;
  readonly settings: LlmSettings | undefined;
  // deno-lint-ignore no-explicit-any
  readonly request: { model: string; messages: any[] };
  readonly attempts: YamlLogAttempt[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY = 1000;

// ---------------------------------------------------------------------------
// Message conversion helpers
// ---------------------------------------------------------------------------

/**
 * Extracts the JSON schema from a Vercel AI SDK `Tool.inputSchema`.
 *
 * The schema can be a Zod schema (v3) or a `jsonSchema()` wrapped object.
 * Returns a plain JSON schema object.
 */
// deno-lint-ignore no-explicit-any
function extractJsonSchema(inputSchema: unknown): Record<string, any> {
  if (!inputSchema) return { type: "object", properties: {} };

  // Zod schema: has `.safeParse` method
  if (typeof (inputSchema as z.ZodType).safeParse === "function") {
    // deno-lint-ignore no-explicit-any
    return zodToJsonSchema(inputSchema as z.ZodType<any>) as Record<string, any>;
  }

  // Vercel AI SDK `jsonSchema()` wrapper: has `jsonSchema` or `validate` property
  // The wrapped object stores the raw schema in `jsonSchema` property
  const wrapped = inputSchema as Record<string, unknown>;
  if (wrapped.jsonSchema && typeof wrapped.jsonSchema === "object") {
    return wrapped.jsonSchema as Record<string, unknown>;
  }

  // Fallback: assume it's already a plain JSON schema object
  return inputSchema as Record<string, unknown>;
}

/**
 * Converts Vercel AI SDK `ModelMessage[]` to OpenRouter `Message[]` format.
 *
 * Handles both Vercel AI SDK v6 format (`input`/`output`) and legacy v5 format
 * (`args`/`result`) for backward compatibility with messages stored by
 * the existing `createLlmRequester`.
 */
export function convertToOrMessages(messages: ModelMessage[]): Message[] {
  const result: Message[] = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      result.push({ role: "system", content: msg.content } as Message);
      continue;
    }

    if (msg.role === "user") {
      const content = typeof msg.content === "string"
        ? msg.content
        : (msg.content as Array<{ type: string; text?: string }>)
            .filter((p) => p.type === "text")
            .map((p) => p.text ?? "")
            .join("\n");
      result.push({ role: "user", content } as Message);
      continue;
    }

    if (msg.role === "assistant") {
      if (typeof msg.content === "string") {
        result.push({ role: "assistant", content: msg.content } as Message);
        continue;
      }

      const contentParts = msg.content as Array<Record<string, unknown>>;
      const textParts = contentParts
        .filter((p) => p.type === "text")
        .map((p) => (p.text as string) ?? "");

      const toolCallParts = contentParts.filter((p) => p.type === "tool-call");
      const toolCalls: ToolDefinitionJson[] = toolCallParts.length > 0
        ? toolCallParts.map((p) => ({
            id: p.toolCallId as string,
            type: "function" as const,
            function: {
              name: p.toolName as string,
              // v6 uses `input`, legacy uses `args`
              arguments: JSON.stringify(p.input ?? p.args ?? {}),
            },
          }))
        : undefined!;

      result.push({
        role: "assistant",
        content: textParts.join("\n") || null,
        ...(toolCallParts.length > 0 ? { toolCalls } : {}),
      } as unknown as Message);
      continue;
    }

    if (msg.role === "tool") {
      // Expand each tool result into a separate ToolResponseMessage
      const toolContent = msg.content as Array<Record<string, unknown>>;
      for (const part of toolContent) {
        if (part.type === "tool-result") {
          let content: string;

          // v6 format: output = { type: 'text', value } | { type: 'json', value }
          if (part.output && typeof part.output === "object") {
            const output = part.output as { type: string; value: unknown };
            if (output.type === "text") {
              content = String(output.value);
            } else if (output.type === "json") {
              content = typeof output.value === "string"
                ? output.value
                : JSON.stringify(output.value);
            } else {
              content = JSON.stringify(part.output);
            }
          } else if (part.result !== undefined) {
            // Legacy v5 format: result field
            content = typeof part.result === "string"
              ? part.result
              : JSON.stringify(part.result);
          } else {
            content = "";
          }

          result.push({
            role: "tool",
            content,
            toolCallId: part.toolCallId as string,
          } as Message);
        }
      }
    }
  }

  return result;
}

/**
 * Converts Vercel AI SDK `Record<string, Tool>` to OpenRouter `ToolDefinitionJson[]`.
 */
export function convertToOrTools(tools: Record<string, Tool>): ToolDefinitionJson[] {
  return Object.entries(tools).map(([name, tool]) => {
    const toolRecord = tool as unknown as Record<string, unknown>;
    const schema = extractJsonSchema(toolRecord.inputSchema ?? toolRecord.parameters);
    return {
      type: "function" as const,
      function: {
        name,
        ...(toolRecord.description ? { description: toolRecord.description as string } : {}),
        parameters: schema,
      },
    };
  });
}

// ---------------------------------------------------------------------------
// Tool execution helper
// ---------------------------------------------------------------------------

/**
 * Executes tool calls from an OpenRouter response.
 */
async function executeToolCalls(
  toolCalls: Array<{ id: string; type: string; function: { name: string; arguments: string } }>,
  tools: Record<string, Tool>,
  messages: ModelMessage[],
): Promise<Array<{ toolCallId: string; toolName: string; args: unknown; result: unknown }>> {
  const results: Array<{ toolCallId: string; toolName: string; args: unknown; result: unknown }> = [];

  for (const toolCall of toolCalls) {
    const toolName = toolCall.function.name;
    const tool = tools[toolName] as unknown as Record<string, unknown>;
    // deno-lint-ignore no-explicit-any
    let args: any;
    try {
      args = JSON.parse(toolCall.function.arguments);
    } catch {
      args = {};
    }

    if (!tool || typeof tool.execute !== "function") {
      results.push({
        toolCallId: toolCall.id,
        toolName,
        args,
        result: { error: `Tool "${toolName}" not found or not executable` },
      });
      continue;
    }

    try {
      // deno-lint-ignore no-explicit-any
      const result = await (tool.execute as (...a: any[]) => Promise<unknown>)(args, {
        toolCallId: toolCall.id,
        messages,
      });
      results.push({ toolCallId: toolCall.id, toolName, args, result });
    } catch (err) {
      results.push({
        toolCallId: toolCall.id,
        toolName,
        args,
        result: { error: err instanceof Error ? err.message : String(err) },
      });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Logging helpers
// ---------------------------------------------------------------------------

function sanitizeForYaml(obj: unknown, visited = new WeakSet()): unknown {
  if (obj === null || typeof obj !== "object") return obj;
  if (visited.has(obj as object)) return "[Circular Reference]";
  if (obj instanceof Error) {
    return { name: obj.name, message: obj.message, stack: obj.stack };
  }
  visited.add(obj as object);
  if (Array.isArray(obj)) return obj.map((item) => sanitizeForYaml(item, visited));
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    result[key] = sanitizeForYaml(value, visited);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Main factory function
// ---------------------------------------------------------------------------

/**
 * Creates an `LlmRequester`-compatible function that uses the official
 * `@openrouter/sdk` for direct OpenRouter API access, bypassing Vercel AI SDK.
 *
 * @example
 * ```ts
 * const requester = createOpenRouterRequester({
 *   modelUri: ModelURI.parse("chat://openrouter/openai/gpt-4o"),
 *   logger,
 *   costTracker,
 *   ctx,
 * });
 * ```
 */
export function createOpenRouterRequester(
  params: OpenRouterRequesterParams,
): LlmRequester {
  const { modelUri, logger, costTracker, ctx, engine: providedEngine } = params;

  const apiKey = modelUri.params.get("apiKey") ?? Deno.env.get("OPENROUTER_API_KEY") ?? "";
  const baseURL = modelUri.params.get("baseURL");
  const maskedUri = modelUri.toString();
  const modelName = modelUri.modelName; // e.g. "openai/gpt-4o"

  // Build engine (real or injected for tests)
  const engine: OpenRouterEngine = providedEngine ?? {
    chatSend: (reqParams: ChatGenerationParams): Promise<ChatResponse> => {
      const client = new OpenRouter({
        apiKey,
        ...(baseURL ? { serverURL: baseURL } : {}),
      });
      // The SDK wraps ChatGenerationParams inside { chatGenerationParams: ... }
      const req: SendChatCompletionRequestRequest & { chatGenerationParams: { stream?: false } } = {
        chatGenerationParams: { ...reqParams, stream: false as const },
      };
      return client.chat.send(req);
    },
  };

  const requester = async <T>(
    reqParams: Readonly<{
      messages: ModelMessage[];
      identifier: string;
      schema: z.ZodType<T> | undefined;
      tools: Record<string, Tool> | undefined;
      maxSteps: number | undefined;
      stageName: string;
      settings: LlmSettings | undefined;
    }>,
  ): Promise<GenerateResult<T>> => {
    const { messages, identifier, schema, tools, maxSteps, stageName, settings } = reqParams;

    const logId = `${identifier}-${Date.now()}`;
    const logTimestamp = new Date().toISOString();

    const yamlLogData: YamlLogData = {
      id: logId,
      timestamp: logTimestamp,
      model: maskedUri,
      stage: stageName,
      settings,
      request: {
        model: modelName,
        messages: messages.map((m) => ({
          role: m.role,
          content: typeof m.content === "string" ? m.content : "[complex]",
        })),
      },
      attempts: [],
    };

    // Mutable state for the request loop
    let currentMessages = [...messages];
    const allToolCalls: Array<{ toolCallId: string; toolName: string; args: unknown }> = [];
    const allToolResults: Array<{ toolCallId: string; toolName: string; args: unknown; result: unknown }> = [];
    const newMessages: ModelMessage[] = [];
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    const totalCost = 0;

    // Retry loop for validation errors
    let lastValidationError: string | undefined;
    let lastRawResponse: string | undefined;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const attemptTimestamp = new Date().toISOString();
      const attemptStart = Date.now();

      logger.debug(
        `[OpenRouter] [run:${ctx.runId}] [id:${identifier}:${attempt}] 🚀 Request: model=${maskedUri}, attempt=${attempt}`,
      );

      try {
        // Tool execution loop within this attempt
        let orMessages = convertToOrMessages(currentMessages);
        const orTools = tools ? convertToOrTools(tools) : undefined;

        const maxStepsUsed = maxSteps ?? (tools ? 5 : 1);
        let stepCount = 0;
        let lastResponse: ChatResponse | null = null;

        while (stepCount < maxStepsUsed) {
          stepCount++;

          // Build request params
          const requestParams: ChatGenerationParams = {
            model: modelName,
            messages: orMessages,
            stream: false as const,
            ...(orTools && orTools.length > 0 ? { tools: orTools } : {}),
            ...(schema
              ? {
                  responseFormat: {
                    type: "json_schema" as const,
                    jsonSchema: {
                      name: "response",
                      schema: zodToJsonSchema(schema) as Record<string, unknown>,
                      strict: true,
                    },
                  },
                }
              : {}),
            ...(settings?.temperature !== undefined ? { temperature: settings.temperature } : {}),
            ...(settings?.maxOutputTokens !== undefined ? { maxTokens: settings.maxOutputTokens } : {}),
            ...(settings?.topP !== undefined ? { topP: settings.topP } : {}),
            ...(settings?.frequencyPenalty !== undefined ? { frequencyPenalty: settings.frequencyPenalty } : {}),
            ...(settings?.presencePenalty !== undefined ? { presencePenalty: settings.presencePenalty } : {}),
            ...(settings?.seed !== undefined ? { seed: settings.seed } : {}),
          };

          const response = await engine.chatSend(requestParams);
          lastResponse = response;

          // Accumulate token usage
          const usage = response.usage;
          if (usage) {
            totalInputTokens += usage.promptTokens ?? 0;
            totalOutputTokens += usage.completionTokens ?? 0;
          }

          const choice = response.choices[0];
          const finishReason = choice?.finishReason;
          const assistantMsg = choice?.message;

          if (!assistantMsg) break;

          lastRawResponse = typeof assistantMsg.content === "string"
            ? assistantMsg.content
            : JSON.stringify(assistantMsg.content);

          // Check for tool calls
          const toolCallList = assistantMsg.toolCalls;
          if (
            finishReason === "tool_calls" &&
            toolCallList &&
            toolCallList.length > 0 &&
            tools
          ) {
            // Record assistant message with tool calls in newMessages
            newMessages.push({
              role: "assistant",
              content: [
                ...(assistantMsg.content ? [{ type: "text" as const, text: typeof assistantMsg.content === "string" ? assistantMsg.content : "" }] : []),
                ...toolCallList.map((tc) => ({
                  type: "tool-call" as const,
                  toolCallId: tc.id,
                  toolName: tc.function.name,
                  input: JSON.parse(tc.function.arguments),
                })),
              ],
            } as unknown as ModelMessage);

            // Execute tools
            const execResults = await executeToolCalls(toolCallList, tools, currentMessages);

            // Accumulate tool calls/results for the final GenerateResult
            for (const r of execResults) {
              allToolCalls.push({ toolCallId: r.toolCallId, toolName: r.toolName, args: r.args });
              allToolResults.push(r);
            }

            // Build tool result messages and add to newMessages
            for (const r of execResults) {
              newMessages.push({
                role: "tool",
                content: [{
                  type: "tool-result",
                  toolCallId: r.toolCallId,
                  toolName: r.toolName,
                  result: r.result,
                }],
              } as unknown as ModelMessage);
            }

            // Rebuild orMessages from scratch for next iteration
            orMessages = convertToOrMessages([...currentMessages, ...newMessages]);

            continue; // Next step
          }

          // No more tool calls — we have the final response
          break;
        }

        if (!lastResponse) {
          throw new Error("No response received from OpenRouter API");
        }

        const finalContent = lastResponse.choices[0]?.message?.content ?? "";
        const finalText = typeof finalContent === "string" ? finalContent : JSON.stringify(finalContent);

        // Add final assistant message to newMessages
        newMessages.push({ role: "assistant", content: finalText });

        const duration = Date.now() - attemptStart;

        // Try to parse structured output if schema provided
        let parsedResult: T | null = null;
        let validationError: string | undefined;

        if (schema) {
          try {
            const parsed = JSON.parse(finalText);
            const zodResult = schema.safeParse(parsed);
            if (zodResult.success) {
              parsedResult = zodResult.data;
            } else {
              validationError = zodResult.error.message;
              lastValidationError = validationError;

              const attemptLog: YamlLogAttempt = {
                attempt,
                timestamp: attemptTimestamp,
                response: { status: 200, raw: finalText, parsed: null, error: validationError },
                stats: {
                  duration,
                  cost: totalCost,
                  tokens: { input: totalInputTokens, output: totalOutputTokens, total: totalInputTokens + totalOutputTokens },
                },
              };
              yamlLogData.attempts.push(attemptLog);

              logger.warn(
                `[OpenRouter] [run:${ctx.runId}] [id:${identifier}:${attempt}] ⚠️ Validation failed: ${validationError}`,
              );

              if (attempt < MAX_RETRIES) {
                // Self-correction: add error message for retry
                currentMessages = [
                  ...currentMessages,
                  { role: "assistant", content: finalText } as ModelMessage,
                  {
                    role: "user",
                    content: `Your previous response failed validation. Error: ${validationError}\n\nPlease fix your response and ensure it matches the required schema.`,
                  } as ModelMessage,
                ];
                await sleep(INITIAL_RETRY_DELAY * Math.pow(2, attempt - 1));
                continue;
              }

              // Exhausted retries — return with validation error
              costTracker.addCost(totalCost);
              costTracker.addTokens(totalInputTokens, totalOutputTokens);
              await saveYamlLog({ ctx, stageName, logId, yamlLogData, logger });

              return {
                result: null,
                text: finalText,
                toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
                toolResults: allToolResults.length > 0 ? allToolResults : undefined,
                newMessages,
                steps: [],
                estimatedCost: totalCost,
                inputTokens: totalInputTokens,
                outputTokens: totalOutputTokens,
                validationError: lastValidationError,
                rawResponse: lastRawResponse,
              };
            }
          } catch (parseErr) {
            validationError = `JSON parse error: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`;
            lastValidationError = validationError;

            const attemptLog: YamlLogAttempt = {
              attempt,
              timestamp: attemptTimestamp,
              response: { status: 200, raw: finalText, parsed: null, error: validationError },
              stats: {
                duration,
                cost: totalCost,
                tokens: { input: totalInputTokens, output: totalOutputTokens, total: totalInputTokens + totalOutputTokens },
              },
            };
            yamlLogData.attempts.push(attemptLog);

            if (attempt < MAX_RETRIES) {
              currentMessages = [
                ...currentMessages,
                { role: "assistant", content: finalText } as ModelMessage,
                {
                  role: "user",
                  content: `Your previous response was not valid JSON. Error: ${validationError}\n\nPlease provide a valid JSON response.`,
                } as ModelMessage,
              ];
              await sleep(INITIAL_RETRY_DELAY * Math.pow(2, attempt - 1));
              continue;
            }

            costTracker.addCost(totalCost);
            costTracker.addTokens(totalInputTokens, totalOutputTokens);
            await saveYamlLog({ ctx, stageName, logId, yamlLogData, logger });

            return {
              result: null,
              text: finalText,
              toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
              toolResults: allToolResults.length > 0 ? allToolResults : undefined,
              newMessages,
              steps: [],
              estimatedCost: totalCost,
              inputTokens: totalInputTokens,
              outputTokens: totalOutputTokens,
              validationError: lastValidationError,
              rawResponse: lastRawResponse,
            };
          }
        }

        // Success
        const tokens = totalInputTokens + totalOutputTokens;
        const attemptLog: YamlLogAttempt = {
          attempt,
          timestamp: attemptTimestamp,
          response: { status: 200, raw: finalText, parsed: parsedResult },
          stats: {
            duration,
            cost: totalCost,
            tokens: { input: totalInputTokens, output: totalOutputTokens, total: tokens },
          },
        };
        yamlLogData.attempts.push(attemptLog);

        logger.info(
          `[OpenRouter] [run:${ctx.runId}] [id:${identifier}:${attempt}] ✅ Response: status=200, duration=${duration}ms, cost=$${totalCost.toFixed(6)}, tokens=${tokens}`,
        );

        costTracker.addCost(totalCost);
        costTracker.addTokens(totalInputTokens, totalOutputTokens);
        await saveYamlLog({ ctx, stageName, logId, yamlLogData, logger });

        return {
          result: parsedResult,
          text: finalText,
          toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
          toolResults: allToolResults.length > 0 ? allToolResults : undefined,
          newMessages,
          steps: [],
          estimatedCost: totalCost,
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
          validationError: undefined,
          rawResponse: lastRawResponse,
        };
      } catch (err) {
        const duration = Date.now() - attemptStart;
        const errorMsg = err instanceof Error ? err.message : String(err);

        const attemptLog: YamlLogAttempt = {
          attempt,
          timestamp: attemptTimestamp,
          stats: { duration, cost: 0, tokens: { input: 0, output: 0, total: 0 } },
          error: errorMsg,
        };
        yamlLogData.attempts.push(attemptLog);

        logger.error(
          `[OpenRouter] [run:${ctx.runId}] [id:${identifier}:${attempt}] ❌ Error: ${errorMsg}`,
        );

        if (attempt < MAX_RETRIES) {
          await sleep(INITIAL_RETRY_DELAY * Math.pow(2, attempt - 1));
          continue;
        }

        await saveYamlLog({ ctx, stageName, logId, yamlLogData, logger });
        throw err;
      }
    }

    // Should not reach here, but TypeScript requires a return
    return {
      result: null,
      text: "",
      newMessages,
      steps: [],
      estimatedCost: totalCost,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      validationError: lastValidationError,
      rawResponse: lastRawResponse,
    };
  };

  return requester as LlmRequester;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function saveYamlLog({
  ctx,
  stageName,
  logId,
  yamlLogData,
  logger,
}: {
  ctx: RunContext;
  stageName: string;
  logId: string;
  yamlLogData: YamlLogData;
  logger: Logger;
}): Promise<void> {
  try {
    if (ctx.saveDebugFile) {
      const stageDir = getSubDebugDir({ ctx, stageDir: stageName });
      const yamlContent = yamlDump(sanitizeForYaml(yamlLogData), {
        indent: 2,
        lineWidth: -1,
        noRefs: true,
      });
      await ctx.saveDebugFile({
        filename: `${logId}.yaml`,
        content: yamlContent,
        stageDir,
      });
    }
  } catch (err) {
    logger.warn(`[OpenRouter] Failed to save debug log: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// Re-export ModelURI for convenience
export { ModelURI };
