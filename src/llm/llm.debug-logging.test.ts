import { describe, it, expect, vi, beforeEach } from "vitest";
import { createLlmRequester, ModelURI } from "./llm.ts";
import type { Logger } from "../logger/logger.ts";
import type { CostTracker } from "../cost-tracker/cost-tracker.ts";
import type { RunContext } from "../run-context/run-context.ts";
import { z } from "zod";

// Mock the AI SDK
vi.mock("ai", async () => {
  const actual = await vi.importActual("ai");
  return {
    ...actual as any,
    generateText: vi.fn(),
  };
});

import { generateText } from "ai";

describe("LLM Debug Logging", () => {
  let logger: Logger;
  let costTracker: CostTracker;
  let ctx: RunContext;

  beforeEach(() => {
    vi.clearAllMocks();
    logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as unknown as Logger;

    costTracker = {
      addCost: vi.fn(),
      addTokens: vi.fn(),
    } as unknown as CostTracker;

    ctx = {
      runId: "test-run-123",
      debugDir: "/tmp/test-debug",
      logger,
      startTime: new Date(),
    } as unknown as RunContext;
  });

  it("should log request and response at debug level", async () => {
    const mockResponse = {
      text: '{"result": "ok"}',
      output: { result: "ok" },
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
      finishReason: "stop",
      providerMetadata: {},
    };

    (generateText as any).mockResolvedValue(mockResponse);

    const requester = createLlmRequester({
      modelUri: ModelURI.parse("chat://openai/gpt-4?apiKey=test-key"),
      logger,
      costTracker,
      ctx
    });

    const schema = z.object({ result: z.string() });
    await requester({
      prompt: "test prompt",
      identifier: "test-id",
      schema,
      stageName: "test-stage",
      tools: undefined,
      maxSteps: undefined,
      settings: undefined,
    });

    // Verify request log
    expect(logger.debug).toHaveBeenCalledWith(
      expect.stringContaining("[LLM] [run:test-run-123] [id:test-id:1] 🚀 Request")
    );
    expect(logger.debug).toHaveBeenCalledWith(
      expect.stringContaining("model=chat://openai/gpt-4?apiKey=***")
    );
    expect(logger.debug).toHaveBeenCalledWith(
      expect.stringContaining("maxRetries=3")
    );
    expect(logger.debug).toHaveBeenCalledWith(
      expect.stringContaining("timeout=30000ms")
    );
    expect(logger.debug).toHaveBeenCalledWith(
      expect.stringContaining("attempt=1")
    );

    // Verify response log
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("[LLM] [run:test-run-123] [id:test-id:1] ✅ Response: status=200, duration=")
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("cost=")
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("tokens=")
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("finishReason=")
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("[LLM] [run:test-run-123] [id:test-id] Completed in 1 attempts. File: ")
    );
  });

  it("should log error at debug level", async () => {
    const error = new Error("API Error");
    (error as any).statusCode = 500;
    (generateText as any).mockRejectedValue(error);

    const requester = createLlmRequester({
      modelUri: ModelURI.parse("chat://openai/gpt-4?apiKey=test-key"),
      logger,
      costTracker,
      ctx
    });

    const schema = z.object({ result: z.string() });
    await requester({
      prompt: "test prompt",
      identifier: "test-id",
      schema,
      stageName: "test-stage",
      tools: undefined,
      maxSteps: undefined,
      settings: undefined,
    });

    // Verify error log
    expect(logger.debug).toHaveBeenCalledWith(
      expect.stringContaining("[LLM] [run:test-run-123] [id:test-id:1] ❌ Error")
    );
    expect(logger.debug).toHaveBeenCalledWith(
      expect.stringContaining("status=500")
    );
    expect(logger.debug).toHaveBeenCalledWith(
      expect.stringContaining("error=API Error")
    );
  });
});
