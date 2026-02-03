import { describe, it, expect } from "vitest";
import { createLlmRequester, ModelURI } from "./llm.ts";
import type { Logger } from "../logger/logger.ts";
import type { CostTracker } from "../cost-tracker/cost-tracker.ts";
import type { RunContext } from "../run-context/run-context.ts";
import { z } from "zod";
import { config } from "dotenv";

// Load environment variables from .env file
config();

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
  getReport() {
    return {
      totalCost: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalTokens: 0,
      requestCount: 0
    };
  }
}

describe("OpenRouter Acceptance Tests", () => {
  const logger = new MockLogger() as unknown as Logger;
  const costTracker = new MockCostTracker() as unknown as CostTracker;
  const ctx: RunContext = {
    runId: "acceptance-test-run",
    debugDir: "/tmp/acceptance-debug",
    logger,
    startTime: new Date(),
  };

  // Test schema
  const testSchema = z.object({
    message: z.string(),
    count: z.number(),
    active: z.boolean()
  });

  it("should generate valid JSON with correct cost tracking", async () => {
    // Check if API key is available
    const apiKey = process.env.OPENROUTER_API_KEY;
    const skipAcceptanceTests = process.env.SKIP_ACCEPTANCE_TESTS === 'true';
    const modelUriString = process.env.ACCEPTANCE_TEST_MODEL || 'chat://openrouter/meta-llama/llama-3-8b-instruct';

    // Fail test if API key is not available and acceptance tests are not skipped
    if (!apiKey && !skipAcceptanceTests) {
      throw new Error(
        "OPENROUTER_API_KEY environment variable is required for acceptance tests. " +
        "Set it in your .env file, or set SKIP_ACCEPTANCE_TESTS=true to skip these tests."
      );
    }

    // Skip test if explicitly requested or no API key available
    if (skipAcceptanceTests || !apiKey) {
      console.warn("⚠️  Skipping acceptance test: OPENROUTER_API_KEY not set or SKIP_ACCEPTANCE_TESTS=true");
      return;
    }

    const requester = createLlmRequester({
      modelUri: ModelURI.parse(`${modelUriString}?apiKey=${apiKey}`),
      logger,
      costTracker,
      ctx
    });

    const prompt = "Generate a JSON object with a message, count, and active status. Make it something simple and positive.";
    const result = await requester({
      prompt,
      identifier: "acceptance-test",
      schema: testSchema,
      stageName: "acceptance-testing",
      tools: undefined,
      maxSteps: undefined,
      settings: undefined,
    });

    // Verify result is not null
    expect(result.result).not.toBeNull();
    expect(result.result).toBeDefined();

    // Verify schema compliance
    const parsedResult = result.result as z.infer<typeof testSchema>;
    expect(typeof parsedResult.message).toBe("string");
    expect(parsedResult.message.length).toBeGreaterThan(0);
    expect(typeof parsedResult.count).toBe("number");
    expect(typeof parsedResult.active).toBe("boolean");

    // Verify cost tracking
    expect(typeof result.estimatedCost).toBe("number");
    expect(result.estimatedCost).toBeGreaterThan(0);

    // Verify token usage
    expect(typeof result.inputTokens).toBe("number");
    expect(result.inputTokens).toBeGreaterThan(0);
    expect(typeof result.outputTokens).toBe("number");
    expect(result.outputTokens).toBeGreaterThan(0);

    // Verify no validation errors (happy path)
    expect(result.validationError).toBeUndefined();

    console.log(`✅ Acceptance test passed! Cost: $${result.estimatedCost.toFixed(6)}, Tokens: ${result.inputTokens + result.outputTokens}`);
  }, 30000); // 30 second timeout
});
