/**
 * Unit tests for createOpenRouterRequester and helper functions.
 * @module
 */

import { expect } from "@std/expect";
import { z } from "zod";
import { jsonSchema, type ModelMessage, type Tool } from "ai";

import {
  convertToOrMessages,
  convertToOrTools,
  createOpenRouterRequester,
  type OpenRouterEngine,
  type OpenRouterRequesterParams,
} from "./openrouter.ts";
import { ModelURI } from "../llm/llm.ts";
import type { Logger } from "../logger/logger.ts";
import type { CostTracker } from "../cost-tracker/cost-tracker.ts";
import type { RunContext } from "../run-context/run-context.ts";

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------

function makeLogger(): Logger {
  return {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  } as unknown as Logger;
}

function makeCostTracker(): CostTracker {
  return {
    addCost: () => {},
    addTokens: () => {},
    getReport: () => ({
      totalCost: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalTokens: 0,
      requestCount: 0,
    }),
  } as unknown as CostTracker;
}

function makeCtx(): RunContext {
  return {
    runId: "test-run-123",
    debugDir: "/tmp/test-debug",
    logger: makeLogger(),
    startTime: new Date(),
    saveDebugFile: () => Promise.resolve(),
  } as unknown as RunContext;
}

/** Build a minimal successful ChatResponse */
// deno-lint-ignore no-explicit-any
function makeChatResponse(content: string, usage?: { promptTokens: number; completionTokens: number; totalTokens: number }): any {
  return {
    id: "gen-123",
    object: "chat.completion",
    created: Date.now(),
    model: "openai/gpt-4o",
    choices: [
      {
        index: 0,
        finishReason: "stop",
        message: {
          role: "assistant",
          content,
          toolCalls: undefined,
        },
      },
    ],
    usage: usage ?? { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
  };
}

/** Build a ChatResponse that requests a tool call */
// deno-lint-ignore no-explicit-any
function makeToolCallResponse(toolName: string, args: Record<string, unknown>, toolCallId = "call-1"): any {
  return {
    id: "gen-456",
    object: "chat.completion",
    created: Date.now(),
    model: "openai/gpt-4o",
    choices: [
      {
        index: 0,
        finishReason: "tool_calls",
        message: {
          role: "assistant",
          content: null,
          toolCalls: [
            {
              id: toolCallId,
              type: "function",
              function: {
                name: toolName,
                arguments: JSON.stringify(args),
              },
            },
          ],
        },
      },
    ],
    usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
  };
}

// ---------------------------------------------------------------------------
// convertToOrMessages
// ---------------------------------------------------------------------------

Deno.test("convertToOrMessages", async (t) => {
  await t.step("converts system message", () => {
    const msgs: ModelMessage[] = [{ role: "system", content: "You are helpful." }];
    const result = convertToOrMessages(msgs);
    expect(result).toEqual([{ role: "system", content: "You are helpful." }]);
  });

  await t.step("converts user message with string content", () => {
    const msgs: ModelMessage[] = [{ role: "user", content: "Hello" }];
    const result = convertToOrMessages(msgs);
    expect(result).toEqual([{ role: "user", content: "Hello" }]);
  });

  await t.step("converts user message with text content parts", () => {
    const msgs: ModelMessage[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "Part 1" },
          { type: "text", text: "Part 2" },
        ],
      },
    ];
    const result = convertToOrMessages(msgs);
    expect(result).toEqual([{ role: "user", content: "Part 1\nPart 2" }]);
  });

  await t.step("converts assistant message with string content", () => {
    const msgs: ModelMessage[] = [{ role: "assistant", content: "Answer" }];
    const result = convertToOrMessages(msgs);
    expect(result).toEqual([{ role: "assistant", content: "Answer" }]);
  });

  await t.step("converts assistant message with tool-call parts (v6 input field)", () => {
    const msgs: ModelMessage[] = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "Let me check." },
          {
            type: "tool-call",
            toolCallId: "tc-1",
            toolName: "search",
            input: { query: "test" },
          },
        ],
      },
    ] as unknown as ModelMessage[];
    const result = convertToOrMessages(msgs);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      role: "assistant",
      content: "Let me check.",
      toolCalls: [
        {
          id: "tc-1",
          type: "function",
          function: { name: "search", arguments: '{"query":"test"}' },
        },
      ],
    });
  });

  await t.step("converts assistant message with tool-call parts (legacy args field)", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "tc-2",
            toolName: "fetch",
            args: { url: "https://example.com" },
          },
        ],
      },
    ] as unknown as ModelMessage[];
    const result = convertToOrMessages(msgs);
    expect(result[0]).toMatchObject({
      role: "assistant",
      toolCalls: [
        {
          id: "tc-2",
          type: "function",
          function: { name: "fetch", arguments: '{"url":"https://example.com"}' },
        },
      ],
    });
  });

  await t.step("converts tool result message into per-call messages (v6 output field)", () => {
    const msgs = [
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "tc-1",
            toolName: "search",
            output: { type: "json", value: { hits: 5 } },
          },
          {
            type: "tool-result",
            toolCallId: "tc-2",
            toolName: "fetch",
            output: { type: "text", value: "raw text" },
          },
        ],
      },
    ] as unknown as ModelMessage[];
    const result = convertToOrMessages(msgs);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      role: "tool",
      toolCallId: "tc-1",
    });
    expect(result[1]).toMatchObject({
      role: "tool",
      content: "raw text",
      toolCallId: "tc-2",
    });
  });

  await t.step("converts tool result message (legacy result field)", () => {
    const msgs = [
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "tc-1",
            toolName: "search",
            result: { hits: 5 },
          },
        ],
      },
    ] as unknown as ModelMessage[];
    const result = convertToOrMessages(msgs);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      role: "tool",
      content: '{"hits":5}',
      toolCallId: "tc-1",
    });
  });
});

// ---------------------------------------------------------------------------
// convertToOrTools
// ---------------------------------------------------------------------------

Deno.test("convertToOrTools", async (t) => {
  await t.step("converts Record<string, Tool> using inputSchema (v6)", () => {
    const tools: Record<string, Tool> = {
      search: {
        description: "Search the web",
        inputSchema: z.object({ query: z.string() }),
        execute: ({ query }: { query: string }) => `Results for ${query}`,
      } as unknown as Tool,
    };
    const result = convertToOrTools(tools);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("function");
    expect(result[0].function.name).toBe("search");
    expect(result[0].function.description).toBe("Search the web");
    expect(result[0].function.parameters).toBeDefined();
    expect(result[0].function.parameters?.type).toBe("object");
  });

  await t.step("converts Record<string, Tool> using jsonSchema wrapped inputSchema", () => {
    const tools: Record<string, Tool> = {
      noop: {
        description: "No-op tool",
        inputSchema: jsonSchema({ type: "object", properties: { x: { type: "string" } } }),
        execute: () => "done",
      } as unknown as Tool,
    };
    const result = convertToOrTools(tools);
    expect(result).toHaveLength(1);
    expect(result[0].function.parameters).toBeDefined();
  });

  await t.step("handles tool without description", () => {
    const tools: Record<string, Tool> = {
      noop: {
        inputSchema: z.object({}),
      } as unknown as Tool,
    };
    const result = convertToOrTools(tools);
    expect(result).toHaveLength(1);
    expect(result[0].function.name).toBe("noop");
    expect(result[0].function.description).toBeUndefined();
  });

  await t.step("returns empty array for empty tools", () => {
    expect(convertToOrTools({})).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// createOpenRouterRequester - factory
// ---------------------------------------------------------------------------

Deno.test("createOpenRouterRequester - factory", async (t) => {
  const logger = makeLogger();
  const costTracker = makeCostTracker();
  const ctx = makeCtx();

  await t.step("returns a function", () => {
    const params: OpenRouterRequesterParams = {
      modelUri: ModelURI.parse("chat://openrouter/openai/gpt-4o?apiKey=test"),
      logger,
      costTracker,
      ctx,
    };
    const requester = createOpenRouterRequester(params);
    expect(typeof requester).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// createOpenRouterRequester - text generation
// ---------------------------------------------------------------------------

Deno.test("createOpenRouterRequester - text generation", async (t) => {
  const logger = makeLogger();
  const costTracker = makeCostTracker();
  const ctx = makeCtx();

  await t.step("sends correct model name from URI and returns text", async () => {
    const capturedRequests: unknown[] = [];
    const engine: OpenRouterEngine = {
      chatSend: (req) => {
        capturedRequests.push(req);
        return makeChatResponse("Hello world");
      },
    };

    const requester = createOpenRouterRequester({
      modelUri: ModelURI.parse("chat://openrouter/openai/gpt-4o?apiKey=test"),
      logger,
      costTracker,
      ctx,
      engine,
    });

    const result = await requester({
      messages: [{ role: "user", content: "Hi" }],
      identifier: "test-1",
      schema: undefined,
      tools: undefined,
      maxSteps: undefined,
      stageName: "test",
      settings: undefined,
    });

    expect(capturedRequests).toHaveLength(1);
    const req = capturedRequests[0] as { model: string; messages: unknown[] };
    expect(req.model).toBe("openai/gpt-4o");
    expect(result.text).toBe("Hello world");
    expect(result.result).toBeNull();
    expect(result.newMessages).toHaveLength(1);
    expect(result.estimatedCost).toBeGreaterThanOrEqual(0);
  });

  await t.step("tracks input/output tokens from response", async () => {
    const engine: OpenRouterEngine = {
      chatSend: () =>
        makeChatResponse("ok", { promptTokens: 50, completionTokens: 100, totalTokens: 150 }),
    };
    const requester = createOpenRouterRequester({
      modelUri: ModelURI.parse("chat://openrouter/openai/gpt-4o?apiKey=test"),
      logger,
      costTracker,
      ctx,
      engine,
    });
    const result = await requester({
      messages: [{ role: "user", content: "Hi" }],
      identifier: "test-2",
      schema: undefined,
      tools: undefined,
      maxSteps: undefined,
      stageName: "test",
      settings: undefined,
    });
    expect(result.inputTokens).toBe(50);
    expect(result.outputTokens).toBe(100);
  });

  await t.step("passes settings (temperature, maxTokens) to request", async () => {
    const capturedRequests: unknown[] = [];
    const engine: OpenRouterEngine = {
      chatSend: (req) => {
        capturedRequests.push(req);
        return makeChatResponse("ok");
      },
    };
    const requester = createOpenRouterRequester({
      modelUri: ModelURI.parse("chat://openrouter/openai/gpt-4o?apiKey=test"),
      logger,
      costTracker,
      ctx,
      engine,
    });
    await requester({
      messages: [{ role: "user", content: "Hi" }],
      identifier: "test-3",
      schema: undefined,
      tools: undefined,
      maxSteps: undefined,
      stageName: "test",
      settings: { temperature: 0.5, maxOutputTokens: 200 },
    });
    const req = capturedRequests[0] as Record<string, unknown>;
    expect(req.temperature).toBe(0.5);
    expect(req.maxTokens).toBe(200); // mapped from maxOutputTokens
  });
});

// ---------------------------------------------------------------------------
// createOpenRouterRequester - structured output
// ---------------------------------------------------------------------------

Deno.test("createOpenRouterRequester - structured output", async (t) => {
  const logger = makeLogger();
  const costTracker = makeCostTracker();
  const ctx = makeCtx();

  await t.step("parses and validates JSON response with Zod schema", async () => {
    const schema = z.object({ name: z.string(), age: z.number() });
    const engine: OpenRouterEngine = {
      chatSend: () => makeChatResponse('{"name":"Alice","age":30}'),
    };
    const requester = createOpenRouterRequester({
      modelUri: ModelURI.parse("chat://openrouter/openai/gpt-4o?apiKey=test"),
      logger,
      costTracker,
      ctx,
      engine,
    });
    const result = await requester({
      messages: [{ role: "user", content: "Give me a person" }],
      identifier: "test-schema",
      schema,
      tools: undefined,
      maxSteps: undefined,
      stageName: "test",
      settings: undefined,
    });
    expect(result.result).toEqual({ name: "Alice", age: 30 });
  });

  await t.step("sends json_schema response_format when schema is provided", async () => {
    const capturedRequests: unknown[] = [];
    const schema = z.object({ value: z.string() });
    const engine: OpenRouterEngine = {
      chatSend: (req) => {
        capturedRequests.push(req);
        return makeChatResponse('{"value":"test"}');
      },
    };
    const requester = createOpenRouterRequester({
      modelUri: ModelURI.parse("chat://openrouter/openai/gpt-4o?apiKey=test"),
      logger,
      costTracker,
      ctx,
      engine,
    });
    await requester({
      messages: [{ role: "user", content: "Go" }],
      identifier: "test-rf",
      schema,
      tools: undefined,
      maxSteps: undefined,
      stageName: "test",
      settings: undefined,
    });
    const req = capturedRequests[0] as Record<string, unknown>;
    expect(req.responseFormat).toBeDefined();
    expect((req.responseFormat as { type: string }).type).toBe("json_schema");
  });

  await t.step("retries on schema validation failure and returns error", async () => {
    const schema = z.object({ value: z.number() });
    let callCount = 0;
    const engine: OpenRouterEngine = {
      chatSend: () => {
        callCount++;
        return makeChatResponse('{"value":"not-a-number"}'); // Always wrong type
      },
    };
    const requester = createOpenRouterRequester({
      modelUri: ModelURI.parse("chat://openrouter/openai/gpt-4o?apiKey=test"),
      logger,
      costTracker,
      ctx,
      engine,
    });
    const result = await requester({
      messages: [{ role: "user", content: "Give value" }],
      identifier: "test-retry",
      schema,
      tools: undefined,
      maxSteps: undefined,
      stageName: "test",
      settings: undefined,
    });
    // Should retry MAX_RETRIES times total
    expect(callCount).toBeGreaterThan(1);
    expect(result.result).toBeNull();
    expect(result.validationError).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// createOpenRouterRequester - tool calling
// ---------------------------------------------------------------------------

Deno.test("createOpenRouterRequester - tool calling", async (t) => {
  const logger = makeLogger();
  const costTracker = makeCostTracker();
  const ctx = makeCtx();

  await t.step("executes a tool and sends result back", async () => {
    const responses = [
      makeToolCallResponse("search", { query: "Deno" }),
      makeChatResponse("Deno is great!"),
    ];
    let callCount = 0;
    const capturedMessages: unknown[][] = [];

    const engine: OpenRouterEngine = {
      chatSend: (req) => {
        capturedMessages.push([...(req.messages ?? [])]);
        return responses[callCount++];
      },
    };

    const searchTool: Tool = {
      description: "Search the web",
      inputSchema: z.object({ query: z.string() }),
      execute: ({ query }: { query: string }) => `Results for: ${query}`,
    } as unknown as Tool;

    const requester = createOpenRouterRequester({
      modelUri: ModelURI.parse("chat://openrouter/openai/gpt-4o?apiKey=test"),
      logger,
      costTracker,
      ctx,
      engine,
    });

    const result = await requester({
      messages: [{ role: "user", content: "Search for Deno" }],
      identifier: "test-tools",
      schema: undefined,
      tools: { search: searchTool },
      maxSteps: 5,
      stageName: "test",
      settings: undefined,
    });

    expect(callCount).toBe(2); // first call + tool result call
    expect(result.text).toBe("Deno is great!");

    // Second call should include tool result in messages
    const secondCallMsgs = capturedMessages[1] as Array<{ role: string }>;
    expect(secondCallMsgs.some((m) => m.role === "tool")).toBe(true);
  });

  await t.step("respects maxSteps limit", async () => {
    let callCount = 0;
    const engine: OpenRouterEngine = {
      chatSend: () => {
        callCount++;
        // Always return tool_calls finish reason - would loop forever without maxSteps
        return makeToolCallResponse("noop", {});
      },
    };

    const requester = createOpenRouterRequester({
      modelUri: ModelURI.parse("chat://openrouter/openai/gpt-4o?apiKey=test"),
      logger,
      costTracker,
      ctx,
      engine,
    });

    await requester({
      messages: [{ role: "user", content: "Go" }],
      identifier: "test-maxsteps",
      schema: undefined,
      tools: {
        noop: {
          inputSchema: z.object({}),
          execute: () => "done",
        } as unknown as Tool,
      },
      maxSteps: 3,
      stageName: "test",
      settings: undefined,
    });

    expect(callCount).toBeLessThanOrEqual(3);
  });

  await t.step("populates toolCalls and toolResults in result", async () => {
    const responses = [
      makeToolCallResponse("calc", { x: 2, y: 3 }, "tc-abc"),
      makeChatResponse("The result is 5"),
    ];
    let callCount = 0;

    const engine: OpenRouterEngine = {
      chatSend: () => responses[callCount++],
    };

    const requester = createOpenRouterRequester({
      modelUri: ModelURI.parse("chat://openrouter/openai/gpt-4o?apiKey=test"),
      logger,
      costTracker,
      ctx,
      engine,
    });

    const result = await requester({
      messages: [{ role: "user", content: "Calc 2+3" }],
      identifier: "test-toolresults",
      schema: undefined,
      tools: {
        calc: {
          inputSchema: z.object({ x: z.number(), y: z.number() }),
          execute: ({ x, y }: { x: number; y: number }) => x + y,
        } as unknown as Tool,
      },
      maxSteps: 5,
      stageName: "test",
      settings: undefined,
    });

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls![0].toolName).toBe("calc");
    expect(result.toolResults).toHaveLength(1);
    expect(result.toolResults![0].result).toBe(5);
  });
});
