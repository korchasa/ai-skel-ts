import { describe, it, expect, vi } from "vitest";
import { createLlmRequester, ModelURI } from "./llm.ts";
import type { Logger } from "../logger/logger.ts";
import type { CostTracker } from "../cost-tracker/cost-tracker.ts";
import type { RunContext } from "../run-context/run-context.ts";
import { generateText } from "ai";

// Mock AI SDK
vi.mock("ai", async () => {
  const actual = await vi.importActual("ai");
  return {
    ...actual,
    generateText: vi.fn(),
  };
});

describe("LLM Requester Refactor", () => {
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as Logger;

  const costTracker = {
    addCost: vi.fn(),
    addTokens: vi.fn(),
  } as unknown as CostTracker;

  const ctx = {
    runId: "test-run",
    debugDir: "/tmp/test-debug",
    logger,
    startTime: new Date(),
  } as RunContext;

  it("should support messages instead of prompt", async () => {
    const mockedGenerateText = vi.mocked(generateText);
    mockedGenerateText.mockResolvedValue({
      text: "Hello!",
      usage: { inputTokens: 10, outputTokens: 5 },
      finishReason: "stop",
      providerMetadata: {},
    } as any);

    const requester = createLlmRequester({
      modelUri: ModelURI.parse("chat://openai/gpt-4?apiKey=test"),
      logger,
      costTracker,
      ctx,
    });

    const result = await requester({
      messages: [{ role: "user", content: "Hello" }],
      identifier: "test",
      stageName: "test-stage",
      schema: undefined,
      tools: undefined,
      maxSteps: undefined,
      settings: undefined,
    });

    expect(result.text).toBe("Hello!");
    expect(mockedGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [{ role: "user", content: "Hello" }],
      })
    );
  });

  it("should support tools and maxSteps", async () => {
    const mockedGenerateText = vi.mocked(generateText);
    mockedGenerateText.mockResolvedValue({
      text: "I used the tool.",
      usage: { inputTokens: 20, outputTokens: 10 },
      finishReason: "stop",
      toolCalls: [{ toolCallId: "1", toolName: "myTool", args: { x: 1 } }],
      toolResults: [{ toolCallId: "1", toolName: "myTool", args: { x: 1 }, result: "result" }],
      providerMetadata: {},
    } as any);

    const requester = createLlmRequester({
      modelUri: ModelURI.parse("chat://openai/gpt-4?apiKey=test"),
      logger,
      costTracker,
      ctx,
    });

    const myTool = {
      description: "My tool",
      inputSchema: { type: "object", properties: { x: { type: "number" } } } as any,
      execute: async () => "result",
    };

    const result = await requester({
      messages: [{ role: "user", content: "Use tool" }],
      tools: { myTool },
      maxSteps: 5,
      identifier: "test-tools",
      stageName: "test-stage",
      schema: undefined,
      settings: undefined,
    });

    expect(result.text).toBe("I used the tool.");
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls![0].toolName).toBe("myTool");
    expect(mockedGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: { myTool },
        stopWhen: expect.any(Function),
      })
    );
  });
});
