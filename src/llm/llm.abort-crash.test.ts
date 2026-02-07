import { expect } from "@std/expect";
import { createLlmRequester, ModelURI, type LlmEngine } from "./llm.ts";
import type { Logger } from "../logger/logger.ts";
import type { CostTracker } from "../cost-tracker/cost-tracker.ts";
import type { RunContext } from "../run-context/run-context.ts";
import { z } from "zod";

Deno.test("LLM Abort Crash", async (t) => {
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
    runId: "test-run-123",
    debugDir: await Deno.makeTempDir({ prefix: "test-abort-crash-" }),
    logger,
    startTime: new Date(),
  } as unknown as RunContext;

  await t.step("should handle abort without crashing", async () => {
    const mockEngine: LlmEngine = {
      generateText: (params: Record<string, unknown>) => {
        const signal = params.abortSignal as AbortSignal | undefined;
        if (signal?.aborted) {
          const error = new Error("Aborted");
          error.name = "AbortError";
          return Promise.reject(error);
        }
        return new Promise((_resolve, reject) => {
          signal?.addEventListener("abort", () => {
            const error = new Error("Aborted");
            error.name = "AbortError";
            reject(error);
          });
        });
      },
    };

    const requester = createLlmRequester({
      modelUri: ModelURI.parse("chat://openai/gpt-4?apiKey=test-key&timeout=10"),
      logger,
      costTracker,
      ctx
    });
    requester.engine = mockEngine;

    const schema = z.object({ result: z.string() });
    const result = await requester({
      messages: [{ role: "user", content: "test prompt" }],
      identifier: "test-id",
      schema,
      stageName: "test-stage",
      tools: undefined,
      maxSteps: undefined,
      settings: undefined,
    });

    expect(result.result).toBeNull();
    expect(result.validationError).toContain("Request timed out");

    // Cleanup
    await Deno.remove(ctx.debugDir, { recursive: true });
  });
});
