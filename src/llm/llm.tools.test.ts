import { describe, it, expect, vi } from "vitest";
import { createLlmRequester, ModelURI } from "./llm.ts";
import type { Logger } from "../logger/logger.ts";
import type { CostTracker } from "../cost-tracker/cost-tracker.ts";
import type { RunContext } from "../run-context/run-context.ts";
import { z } from "zod";

// We need to mock 'ai' package to test tool loops without real API calls
vi.mock("ai", async () => {
  const actual = await vi.importActual("ai");
  return {
    ...actual,
    generateText: vi.fn(),
  };
});

import { generateText } from "ai";

describe("LlmRequester Tools Support", () => {
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

  const ctx: RunContext = {
    runId: "test-run",
    debugDir: "/tmp/test-debug",
    logger,
    startTime: new Date(),
  };

  it("should return newMessages containing tool calls and results", async () => {
    const requester = createLlmRequester({
      modelUri: ModelURI.parse("chat://openai/gpt-4o"),
      logger,
      costTracker,
      ctx,
    });

    // Mock steps from Vercel AI SDK
    const mockSteps = [
      {
        text: "",
        toolCalls: [{ toolCallId: "call-1", toolName: "get_weather", args: { city: "London" } }],
        toolResults: [{ toolCallId: "call-1", toolName: "get_weather", args: { city: "London" }, result: { temp: 20 } }],
        usage: { inputTokens: 10, outputTokens: 5 },
      },
      {
        text: "It is sunny in London.",
        toolCalls: [],
        toolResults: [],
        usage: { inputTokens: 20, outputTokens: 10 },
      },
    ];

    (generateText as any).mockResolvedValue({
      text: "It is sunny in London.",
      steps: mockSteps,
      usage: { inputTokens: 30, outputTokens: 15 },
      providerMetadata: {},
      finishReason: "stop",
    });

    const result = await requester({
      prompt: "What is the weather in London?",
      identifier: "test-tools",
      stageName: "test",
      schema: undefined,
      maxSteps: undefined,
      settings: undefined,
      tools: {
        get_weather: {
          description: "Get weather",
          parameters: z.object({ city: z.string() }),
          execute: async () => ({ temp: 20 }),
        },
      },
    });

    // This should fail because newMessages is not yet in the interface
    expect(result).toHaveProperty("newMessages");
    expect((result as any).newMessages).toHaveLength(3); // assistant call, tool result, assistant final
    expect((result as any).newMessages[0].role).toBe("assistant");
    expect((result as any).newMessages[1].role).toBe("tool");
    expect((result as any).newMessages[2].role).toBe("assistant");
  });

  it("should pass toolChoice to generateText", async () => {
    const requester = createLlmRequester({
      modelUri: ModelURI.parse("chat://openai/gpt-4o"),
      logger,
      costTracker,
      ctx,
    });

    (generateText as any).mockResolvedValue({
      text: "Manual response",
      steps: [],
      usage: { inputTokens: 5, outputTokens: 2 },
      providerMetadata: {},
      finishReason: "stop",
    });

    await requester({
      prompt: "Hello",
      identifier: "test-tool-choice",
      stageName: "test",
      schema: undefined,
      tools: undefined,
      maxSteps: undefined,
      settings: {
        toolChoice: "required"
      }
    });

    expect(generateText).toHaveBeenCalledWith(expect.objectContaining({
      toolChoice: "required"
    }));
  });
});
