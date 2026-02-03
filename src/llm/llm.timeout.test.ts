import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createLlmRequester, ModelURI } from "./llm.ts";
import type { Logger } from "../logger/logger.ts";
import type { CostTracker } from "../cost-tracker/cost-tracker.ts";
import type { RunContext } from "../run-context/run-context.ts";
import { generateText } from "ai";

// Mock the ai module
vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    generateText: vi.fn(),
  };
});

// Mock logger
class MockLogger {
  debug(_message: string) {}
  info(_message: string) {}
  warn(_message: string) {}
  error(_message: string) {}
}

// Mock cost tracker
class MockCostTracker {
  addCost(_cost: number) {}
  addTokens(_input: number, _output: number) {}
}

describe("LLM Requester Timeout", () => {
  const logger = new MockLogger() as unknown as Logger;
  const costTracker = new MockCostTracker() as unknown as CostTracker;
  const ctx = {
    runId: "test-run-123",
    debugDir: "/tmp/test-debug",
    logger,
    startTime: new Date(),
  } as RunContext;

  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should timeout when request takes longer than default timeout", async () => {
    const requester = createLlmRequester({
      modelUri: ModelURI.parse("chat://openai/gpt-4?apiKey=test-key"),
      logger,
      costTracker,
      ctx,
    });

    // Mock generateText to hang
    (generateText as any).mockImplementation(async ({ abortSignal }: { abortSignal: AbortSignal }) => {
      return new Promise((resolve, reject) => {
        const onAbort = () => {
          const error = new Error("The operation was aborted");
          error.name = "AbortError";
          reject(error);
        };
        if (abortSignal.aborted) {
          onAbort();
        } else {
          abortSignal.addEventListener("abort", onAbort);
        }
      });
    });

    // Reduce timeout for test speed
    const result = await requester({
      prompt: "test",
      identifier: "test-id",
      schema: undefined,
      stageName: "test-stage",
      settings: { timeout: 100 }, // 100ms timeout
      tools: undefined,
      maxSteps: undefined,
    });

    expect(result.validationError).toContain("Request timed out");
    expect(result.validationError).toContain("100ms");
  });

  it("should use timeout from URI", async () => {
    const requester = createLlmRequester({
      modelUri: ModelURI.parse("chat://openai/gpt-4?apiKey=test-key&timeout=200"),
      logger,
      costTracker,
      ctx,
    });

    (generateText as any).mockImplementation(async ({ abortSignal }: { abortSignal: AbortSignal }) => {
      return new Promise((resolve, reject) => {
         const onAbort = () => {
          const error = new Error("The operation was aborted");
          error.name = "AbortError";
          reject(error);
        };
        if (abortSignal.aborted) {
            onAbort();
        } else {
            abortSignal.addEventListener("abort", onAbort);
        }
      });
    });

    const start = Date.now();
    const result = await requester({
      prompt: "test",
      identifier: "test-id",
      schema: undefined,
      stageName: "test-stage",
      tools: undefined,
      maxSteps: undefined,
      settings: undefined,
    });
    const duration = Date.now() - start;

    expect(result.validationError).toContain("Request timed out");
    expect(result.validationError).toContain("200ms");
    expect(duration).toBeGreaterThanOrEqual(190); // Allow some margin
  });

  it("should succeed if request completes before timeout", async () => {
    const requester = createLlmRequester({
      modelUri: ModelURI.parse("chat://openai/gpt-4?apiKey=test-key"),
      logger,
      costTracker,
      ctx,
    });

    (generateText as any).mockResolvedValue({
      text: "success",
      usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
      finishReason: "stop",
    });

    const result = await requester({
      prompt: "test",
      identifier: "test-id",
      schema: undefined,
      stageName: "test-stage",
      settings: { timeout: 500 },
      tools: undefined,
      maxSteps: undefined,
    });

    expect(result.result).toBeNull(); // Because schema is undefined and we return text in rawResponse
    expect(result.rawResponse).toBe("success");
    expect(result.validationError).toBeUndefined();
  });
});
