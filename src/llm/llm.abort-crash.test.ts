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

// Mock fs/promises
vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  stat: vi.fn().mockResolvedValue({}),
}));

// Mock logger
class MockLogger {
  debug = vi.fn();
  info = vi.fn();
  warn = vi.fn();
  error = vi.fn();
}

// Mock cost tracker
class MockCostTracker {
  addCost(_cost: number) {}
  addTokens(_input: number, _output: number) {}
}

describe("LLM Requester Abort Crash", () => {
  const logger = new MockLogger();
  const costTracker = new MockCostTracker() as unknown as CostTracker;
  const ctx = {
    runId: "test-run-123",
    debugDir: "/tmp/test-debug",
    logger: logger as unknown as Logger,
    startTime: new Date(),
  } as RunContext;

  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should catch synchronous error during abort()", async () => {
    const requester = createLlmRequester({
      modelUri: ModelURI.parse("chat://openai/gpt-4?apiKey=test-key"),
      logger: logger as unknown as Logger,
      costTracker,
      ctx,
    });

    // Mock abort to throw synchronously
    const abortSpy = vi.spyOn(AbortController.prototype, "abort").mockImplementation(() => {
      throw new Error("Simulated synchronous crash in abort()");
    });

    // Mock generateText to wait a bit and then throw AbortError
    // to simulate the timeout rejection
    (generateText as any).mockImplementation(async ({ abortSignal }: { abortSignal: AbortSignal }) => {
      return new Promise((_, reject) => {
        const timeout = setTimeout(() => {
          const error = new Error("The operation was aborted");
          error.name = "AbortError";
          reject(error);
        }, 50); // Slightly longer than LLM timeout to ensure LLM timeout triggers first
        
        abortSignal.addEventListener("abort", () => {
          clearTimeout(timeout);
          const error = new Error("The operation was aborted");
          error.name = "AbortError";
          reject(error);
        });
      });
    });

    const result = await requester({
      prompt: "test",
      identifier: "test-id",
      stageName: "test-stage",
      settings: { timeout: 10 }, // Very short timeout
      schema: undefined,
      tools: undefined,
      maxSteps: undefined,
    });

    expect(result.validationError).toContain("Request timed out");
    
    // Verify that the error was caught and logged
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Error during controller.abort(): Simulated synchronous crash in abort()")
    );

    abortSpy.mockRestore();
  });
});
