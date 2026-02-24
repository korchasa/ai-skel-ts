/**
 * Unit tests for LLM streaming support.
 * Uses mocked LlmEngine to avoid real API calls.
 */

import { expect } from "@std/expect";
import { createVercelRequester, ModelURI, type LlmEngine, type StreamResult } from "./llm.ts";
import type { Logger } from "../logger/logger.ts";
import type { CostTracker } from "../cost-tracker/cost-tracker.ts";
import type { RunContext } from "../run-context/run-context.ts";
import { z } from "zod";

// --- Helpers ---

/**
 * Creates a fake StreamTextResult that mirrors the Vercel AI SDK interface.
 */
function makeFakeStreamResult(opts: {
  textChunks: string[];
  output?: unknown;
  /** If set, the `output` promise will reject with this error instead of resolving. */
  outputError?: Error;
  inputTokens?: number;
  outputTokens?: number;
  toolCalls?: Array<{ toolCallId: string; toolName: string; args: unknown }>;
  toolResults?: Array<{ toolCallId: string; toolName: string; args: unknown; result: unknown }>;
  steps?: unknown[];
}) {
  const {
    textChunks,
    output = null,
    outputError,
    inputTokens = 10,
    outputTokens = 20,
    toolCalls = [],
    toolResults = [],
    steps = [],
  } = opts;

  const fullText = textChunks.join("");

  async function* makeTextStream() {
    for (const chunk of textChunks) {
      yield chunk;
    }
  }

  // deno-lint-ignore no-explicit-any
  async function* makeFullStream(): AsyncIterable<any> {
    for (const chunk of textChunks) {
      yield { type: "text-delta", textDelta: chunk };
    }
    yield {
      type: "finish",
      finishReason: "stop",
      usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens },
    };
  }

  return {
    textStream: makeTextStream(),
    fullStream: makeFullStream(),
    text: Promise.resolve(fullText),
    output: outputError ? Promise.reject(outputError) : Promise.resolve(output),
    usage: Promise.resolve({ inputTokens, outputTokens, totalTokens: inputTokens + outputTokens }),
    toolCalls: Promise.resolve(toolCalls),
    toolResults: Promise.resolve(toolResults),
    steps: Promise.resolve(steps),
    finishReason: Promise.resolve("stop"),
    rawResponse: Promise.resolve(undefined),
    providerMetadata: Promise.resolve(undefined),
    experimental_providerMetadata: Promise.resolve(undefined),
    // Callbacks are no-ops in the mock
    // deno-lint-ignore no-explicit-any
  } as any;
}

function makeTestDeps() {
  const logger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  } as unknown as Logger;

  const costTracker = {
    addCost: () => {},
    addTokens: () => {},
  } as unknown as CostTracker;

  const ctx = {
    runId: "test-run-streaming",
    debugDir: "/tmp/test-debug-streaming",
    logger,
    startTime: new Date(),
  } as unknown as RunContext;

  return { logger, costTracker, ctx };
}

// --- Tests ---

Deno.test("LLM Streaming - LlmStreamer type exists on requester", () => {
  const { logger, costTracker, ctx } = makeTestDeps();
  const requester = createVercelRequester({
    modelUri: ModelURI.parse("chat://openai/gpt-4?apiKey=test-key"),
    logger,
    costTracker,
    ctx,
  });

  expect(typeof requester.stream).toBe("function");
});

Deno.test("LLM Streaming - text-only: yields chunks in order", async () => {
  const { logger, costTracker, ctx } = makeTestDeps();

  const requester = createVercelRequester({
    modelUri: ModelURI.parse("chat://openai/gpt-4?apiKey=test-key"),
    logger,
    costTracker,
    ctx,
  });

  const mockEngine: LlmEngine = {
    generateText: () => Promise.resolve({} as never),
    streamText: () => makeFakeStreamResult({ textChunks: ["Hello", " ", "World"] }),
  };
  requester.engine = mockEngine;

  const stream = requester.stream<string>({
    messages: [{ role: "user", content: "Say hello" }],
    identifier: "test-stream-text",
    schema: undefined,
    tools: undefined,
    maxSteps: undefined,
    stageName: "test",
    settings: undefined,
  });

  const chunks: string[] = [];
  for await (const chunk of stream.textStream) {
    chunks.push(chunk);
  }

  expect(chunks).toEqual(["Hello", " ", "World"]);
});

Deno.test("LLM Streaming - text-only: text promise resolves to full text", async () => {
  const { logger, costTracker, ctx } = makeTestDeps();

  const requester = createVercelRequester({
    modelUri: ModelURI.parse("chat://openai/gpt-4?apiKey=test-key"),
    logger,
    costTracker,
    ctx,
  });

  const mockEngine: LlmEngine = {
    generateText: () => Promise.resolve({} as never),
    streamText: () => makeFakeStreamResult({ textChunks: ["Hello", " ", "World"] }),
  };
  requester.engine = mockEngine;

  const stream = requester.stream<string>({
    messages: [{ role: "user", content: "Say hello" }],
    identifier: "test-stream-text-promise",
    schema: undefined,
    tools: undefined,
    maxSteps: undefined,
    stageName: "test",
    settings: undefined,
  });

  const text = await stream.text;
  expect(text).toBe("Hello World");
});

Deno.test("LLM Streaming - text-only: usage promise resolves with token counts", async () => {
  const { logger, costTracker, ctx } = makeTestDeps();

  const requester = createVercelRequester({
    modelUri: ModelURI.parse("chat://openai/gpt-4?apiKey=test-key"),
    logger,
    costTracker,
    ctx,
  });

  const mockEngine: LlmEngine = {
    generateText: () => Promise.resolve({} as never),
    streamText: () => makeFakeStreamResult({
      textChunks: ["hi"],
      inputTokens: 15,
      outputTokens: 5,
    }),
  };
  requester.engine = mockEngine;

  const stream = requester.stream<string>({
    messages: [{ role: "user", content: "hi" }],
    identifier: "test-stream-usage",
    schema: undefined,
    tools: undefined,
    maxSteps: undefined,
    stageName: "test",
    settings: undefined,
  });

  const usage = await stream.usage;
  expect(usage.inputTokens).toBe(15);
  expect(usage.outputTokens).toBe(5);
});

Deno.test("LLM Streaming - cost tracker is updated via onFinish", async () => {
  const addCostCalls: number[] = [];
  const addTokensCalls: Array<[number, number]> = [];

  const logger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  } as unknown as Logger;

  const costTracker = {
    addCost: (c: number) => addCostCalls.push(c),
    addTokens: (i: number, o: number) => addTokensCalls.push([i, o]),
  } as unknown as CostTracker;

  const ctx = {
    runId: "test-run-cost",
    debugDir: "/tmp/test-debug-streaming",
    logger,
    startTime: new Date(),
  } as unknown as RunContext;

  const requester = createVercelRequester({
    modelUri: ModelURI.parse("chat://openai/gpt-4?apiKey=test-key"),
    logger,
    costTracker,
    ctx,
  });

  const mockEngine: LlmEngine = {
    generateText: () => Promise.resolve({} as never),
    streamText: () => makeFakeStreamResult({ textChunks: ["ok"], inputTokens: 10, outputTokens: 20 }),
  };
  requester.engine = mockEngine;

  const stream = requester.stream<string>({
    messages: [{ role: "user", content: "go" }],
    identifier: "test-cost",
    schema: undefined,
    tools: undefined,
    maxSteps: undefined,
    stageName: "test",
    settings: undefined,
  });

  // Consume the stream to trigger onFinish
  await stream.text;

  // Cost tracker should have been called
  expect(addTokensCalls.length).toBeGreaterThan(0);
  expect(addTokensCalls[0]).toEqual([10, 20]);
});

Deno.test("LLM Streaming - structured output: output promise resolves after validation", async () => {
  const { logger, costTracker, ctx } = makeTestDeps();

  const schema = z.object({ name: z.string(), age: z.number() });
  const validObject = { name: "Alice", age: 30 };

  const requester = createVercelRequester({
    modelUri: ModelURI.parse("chat://openai/gpt-4?apiKey=test-key"),
    logger,
    costTracker,
    ctx,
  });

  const mockEngine: LlmEngine = {
    generateText: () => Promise.resolve({} as never),
    streamText: () => makeFakeStreamResult({
      textChunks: [JSON.stringify(validObject)],
      output: validObject,
    }),
  };
  requester.engine = mockEngine;

  const stream = requester.stream<{ name: string; age: number }>({
    messages: [{ role: "user", content: "give me a person" }],
    identifier: "test-schema",
    schema,
    tools: undefined,
    maxSteps: undefined,
    stageName: "test",
    settings: undefined,
  });

  const result = await stream.output;
  expect(result).toEqual(validObject);
});

Deno.test("LLM Streaming - structured output retry: first attempt fails validation, second succeeds", async () => {
  const { logger, costTracker, ctx } = makeTestDeps();

  const schema = z.object({ value: z.number() });
  const validObject = { value: 42 };

  let callCount = 0;

  const requester = createVercelRequester({
    modelUri: ModelURI.parse("chat://openai/gpt-4?apiKey=test-key"),
    logger,
    costTracker,
    ctx,
  });

  const mockEngine: LlmEngine = {
    generateText: () => Promise.resolve({} as never),
    streamText: () => {
      callCount++;
      if (callCount === 1) {
        // First attempt: output promise rejects (validation failure)
        return makeFakeStreamResult({
          textChunks: ["not valid json"],
          output: null, // null signals validation failed
        });
      }
      // Second attempt: output resolves successfully
      return makeFakeStreamResult({
        textChunks: [JSON.stringify(validObject)],
        output: validObject,
      });
    },
  };
  requester.engine = mockEngine;

  const stream = requester.stream<{ value: number }>({
    messages: [{ role: "user", content: "give me a number object" }],
    identifier: "test-schema-retry",
    schema,
    tools: undefined,
    maxSteps: undefined,
    stageName: "test",
    settings: undefined,
  });

  const result = await stream.output;
  expect(result).toEqual(validObject);
  // Engine must have been called at least twice (first failure + second success)
  expect(callCount).toBeGreaterThanOrEqual(2);
});

Deno.test("LLM Streaming - structured output retry: output promise rejects (real SDK behavior), second succeeds", async () => {
  const { logger, costTracker, ctx } = makeTestDeps();

  const schema = z.object({ value: z.number() });
  const validObject = { value: 99 };

  let callCount = 0;

  const requester = createVercelRequester({
    modelUri: ModelURI.parse("chat://openai/gpt-4?apiKey=test-key"),
    logger,
    costTracker,
    ctx,
  });

  const mockEngine: LlmEngine = {
    generateText: () => Promise.resolve({} as never),
    streamText: () => {
      callCount++;
      if (callCount === 1) {
        // First attempt: output promise rejects with validation error (real Vercel SDK behavior)
        return makeFakeStreamResult({
          textChunks: ['{"value": "not-a-number"}'],
          outputError: new Error("Expected number, received string at path: value"),
        });
      }
      // Second attempt: output resolves successfully
      return makeFakeStreamResult({
        textChunks: [JSON.stringify(validObject)],
        output: validObject,
      });
    },
  };
  requester.engine = mockEngine;

  const stream = requester.stream<{ value: number }>({
    messages: [{ role: "user", content: "give me a number object" }],
    identifier: "test-schema-retry-reject",
    schema,
    tools: undefined,
    maxSteps: undefined,
    stageName: "test",
    settings: undefined,
  });

  const result = await stream.output;
  expect(result).toEqual(validObject);
  expect(callCount).toBeGreaterThanOrEqual(2);
});

Deno.test("LLM Streaming - error handling: stream error propagates through textStream", async () => {
  const { logger, costTracker, ctx } = makeTestDeps();

  const requester = createVercelRequester({
    modelUri: ModelURI.parse("chat://openai/gpt-4?apiKey=test-key"),
    logger,
    costTracker,
    ctx,
  });

  const streamError = new Error("Network failure");

  const mockEngine: LlmEngine = {
    generateText: () => Promise.resolve({} as never),
    streamText: () => {
      async function* failingStream(): AsyncIterable<string> {
        yield "partial";
        throw streamError;
      }

      async function* failingFullStream(): AsyncIterable<unknown> {
        yield { type: "text-delta", textDelta: "partial" };
        throw streamError;
      }

      return {
        textStream: failingStream(),
        fullStream: failingFullStream(),
        // These are consumed by tryStreamText in the text-only path:
        text: Promise.reject(streamError),
        usage: Promise.reject(streamError),
        // These are NOT consumed in the text-only path — resolve them to avoid
        // dangling rejected promises that would cause unhandled rejection errors:
        output: Promise.resolve(null),
        toolCalls: Promise.resolve([]),
        toolResults: Promise.resolve([]),
        steps: Promise.resolve([]),
        finishReason: Promise.resolve("error"),
        rawResponse: Promise.resolve(undefined),
        providerMetadata: Promise.resolve(undefined),
        experimental_providerMetadata: Promise.resolve(undefined),
        // deno-lint-ignore no-explicit-any
      } as any;
    },
  };
  requester.engine = mockEngine;

  const stream = requester.stream<string>({
    messages: [{ role: "user", content: "trigger error" }],
    identifier: "test-stream-error",
    schema: undefined,
    tools: undefined,
    maxSteps: undefined,
    stageName: "test",
    settings: undefined,
  });

  // Suppress unhandled rejections from stream properties not directly tested here.
  // These promises all reject because the underlying engine stream fails.
  stream.text.catch(() => {});
  stream.usage.catch(() => {});
  stream.estimatedCost.catch(() => {});

  // The textStream itself should propagate the error
  const chunks: string[] = [];
  let caught: unknown;
  try {
    for await (const chunk of stream.textStream) {
      chunks.push(chunk);
    }
  } catch (e) {
    caught = e;
  }

  // We should have received the partial chunk before the error
  expect(chunks).toContain("partial");
  // And the error should have propagated
  expect(caught).toBeInstanceOf(Error);
  expect((caught as Error).message).toBe("Network failure");
});

Deno.test("LLM Streaming - tool calls: tryStreamText passes tools to engine and returns them", async () => {
  const { logger, costTracker, ctx } = makeTestDeps();

  const toolCall = { toolCallId: "tc1", toolName: "myTool", args: { x: 1 } };
  const toolResult = { toolCallId: "tc1", toolName: "myTool", args: { x: 1 }, result: "tool output" };

  let capturedParams: Record<string, unknown> | undefined;

  const requester = createVercelRequester({
    modelUri: ModelURI.parse("chat://openai/gpt-4?apiKey=test-key"),
    logger,
    costTracker,
    ctx,
  });

  const mockEngine: LlmEngine = {
    generateText: () => Promise.resolve({} as never),
    streamText: (params: Record<string, unknown>) => {
      capturedParams = params;
      return makeFakeStreamResult({
        textChunks: ["used tool"],
        toolCalls: [toolCall],
        toolResults: [toolResult],
      });
    },
  };
  requester.engine = mockEngine;

  // deno-lint-ignore no-explicit-any
  const tools: Record<string, any> = {
    myTool: {
      description: "A test tool",
      parameters: {},
      execute: () => Promise.resolve("tool output"),
    },
  };

  const stream = requester.stream<string>({
    messages: [{ role: "user", content: "use the tool" }],
    identifier: "test-stream-tools",
    schema: undefined,
    tools,
    maxSteps: 5,
    stageName: "test",
    settings: undefined,
  });

  const resolvedToolCalls = await stream.toolCalls;
  const resolvedToolResults = await stream.toolResults;

  // Engine should have received the tools
  expect(capturedParams).toBeDefined();
  expect(capturedParams!.tools).toBe(tools);

  // Tool calls and results should be forwarded from the engine result
  expect(resolvedToolCalls).toEqual([toolCall]);
  expect(resolvedToolResults).toEqual([toolResult]);
});

Deno.test("LLM Streaming - StreamResult has all required properties", () => {
  const { logger, costTracker, ctx } = makeTestDeps();

  const requester = createVercelRequester({
    modelUri: ModelURI.parse("chat://openai/gpt-4?apiKey=test-key"),
    logger,
    costTracker,
    ctx,
  });

  const mockEngine: LlmEngine = {
    generateText: () => Promise.resolve({} as never),
    streamText: () => makeFakeStreamResult({ textChunks: ["test"] }),
  };
  requester.engine = mockEngine;

  const stream: StreamResult<string> = requester.stream<string>({
    messages: [{ role: "user", content: "test" }],
    identifier: "test-props",
    schema: undefined,
    tools: undefined,
    maxSteps: undefined,
    stageName: "test",
    settings: undefined,
  });

  // Check all properties exist
  expect(stream.textStream).toBeDefined();
  expect(stream.fullStream).toBeDefined();
  expect(stream.text).toBeInstanceOf(Promise);
  expect(stream.output).toBeInstanceOf(Promise);
  expect(stream.toolCalls).toBeInstanceOf(Promise);
  expect(stream.toolResults).toBeInstanceOf(Promise);
  expect(stream.newMessages).toBeInstanceOf(Promise);
  expect(stream.steps).toBeInstanceOf(Promise);
  expect(stream.usage).toBeInstanceOf(Promise);
  expect(stream.estimatedCost).toBeInstanceOf(Promise);
});
