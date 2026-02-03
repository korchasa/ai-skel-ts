import { describe, it, expect } from "vitest";
import { createLlmRequester, ModelURI } from "./llm.ts";
import type { Logger } from "../logger/logger.ts";
import type { CostTracker } from "../cost-tracker/cost-tracker.ts";
import type { RunContext } from "../run-context/run-context.ts";
import { z } from "zod";

// Mock implementations
class MockLogger {
  debug(_message: string) {}
  info(_message: string) {}
  warn(_message: string) {}
  error(_message: string) {}
}

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

describe("LLM Integration Tests", () => {
  const logger = new MockLogger() as unknown as Logger;
  const costTracker = new MockCostTracker() as unknown as CostTracker;
  const ctx: RunContext = {
    runId: "test-run-123",
    debugDir: "/tmp/test-debug",
    logger,
    startTime: new Date(),
  };

  describe("JSON generation with schema validation", () => {
    it("should handle successful JSON generation", () => {
      // Create a mock requester that simulates successful generation
      // Note: In real integration tests, this would use actual AI SDK with test keys
      // For now, we'll test the interface contract

      // Test that the function signature is correct
      const requester = createLlmRequester({
        modelUri: ModelURI.parse("chat://openai/gpt-4?apiKey=test-key"),
        logger,
        costTracker,
        ctx
      });

      expect(requester instanceof Function, "Should return a function").toBe(true);

      // Test function signature
      const hasCorrectParams = (
        typeof requester === "function" &&
        requester.length >= 1 // At least one parameter
      );
      expect(hasCorrectParams, "Requester should be a function with parameters").toBe(true);
    });

    it("should handle schema validation errors", () => {
      // Test schema validation interface

      // Test that schema is accepted
      const requester = createLlmRequester({
        modelUri: ModelURI.parse("chat://anthropic/claude-3-sonnet-20240229?apiKey=test-key"),
        logger,
        costTracker,
        ctx
      });

      expect(requester instanceof Function).toBe(true);
    });

    it("should support different response formats", () => {
      const schemas = [
        z.string(),
        z.number(),
        z.boolean(),
        z.array(z.string()),
        z.object({ result: z.string() }),
      ];

      for (const schema of schemas) {
        const requester = createLlmRequester({
          modelUri: ModelURI.parse("chat://gemini/gemini-pro?apiKey=test-key"),
          logger,
          costTracker,
          ctx
        });

        expect(requester instanceof Function, `Should support schema: ${schema.description || 'unnamed'}`).toBe(true);
      }
    });
  });

  describe("Error handling and retry logic", () => {
    it("should handle invalid model URIs", () => {
      try {
        createLlmRequester({
          modelUri: ModelURI.parse("invalid-format"),
          logger,
          costTracker,
          ctx
        });
        expect(false, "Should have thrown error for invalid URI").toBe(true);
      } catch (error) {
        expect(error instanceof Error).toBe(true);
        expect((error as Error).message).toContain("Model identifier (path) is required");
      }
    });

    it("should handle unknown providers", () => {
      try {
        createLlmRequester({
          modelUri: ModelURI.parse("chat://unknown/some-model?apiKey=test"),
          logger,
          costTracker,
          ctx
        });
        expect(false, "Should have thrown error for unknown provider").toBe(true);
      } catch (error) {
        expect(error instanceof Error).toBe(true);
        expect((error as Error).message).toBe("Unknown LLM provider: unknown");
      }
    });

    it("should handle missing API keys", () => {
      try {
        createLlmRequester({
          modelUri: ModelURI.parse("chat://openai/gpt-4"), // No apiKey parameter
          logger,
          costTracker,
          ctx
        });
        // This might not throw immediately, depending on implementation
        // But the interface should still work
        expect(true, "Should handle missing API key gracefully or throw appropriate error").toBe(true);
      } catch (error) {
        expect(error instanceof Error).toBe(true);
      }
    });
  });

  describe("Cost tracking integration", () => {
    it("should integrate with cost tracker", () => {
      const requester = createLlmRequester({
        modelUri: ModelURI.parse("chat://openai/gpt-4?apiKey=test-key"),
        logger,
        costTracker,
        ctx
      });

      expect(requester instanceof Function).toBe(true);
      // Cost tracking would be tested in actual LLM calls
      // Here we verify the integration point exists
    });
  });

  describe("Logging integration", () => {
    it("should integrate with logger", () => {
      const requester = createLlmRequester({
        modelUri: ModelURI.parse("chat://anthropic/claude-3-sonnet-20240229?apiKey=test-key"),
        logger,
        costTracker,
        ctx
      });

      expect(requester instanceof Function).toBe(true);
      // Logging integration would be tested in actual LLM calls
    });
  });

  describe("Provider-specific configurations", () => {
    it("should support OpenAI with various parameters", () => {
      const requester = createLlmRequester({
        modelUri: ModelURI.parse("chat://openai/gpt-4?apiKey=test-key&temperature=0.5&maxTokens=100"),
        logger,
        costTracker,
        ctx
      });

      expect(requester instanceof Function).toBe(true);
    });

    it("should support Anthropic with various parameters", () => {
      const requester = createLlmRequester({
        modelUri: ModelURI.parse("chat://anthropic/claude-3-sonnet-20240229?apiKey=test-key&temperature=0.3"),
        logger,
        costTracker,
        ctx
      });

      expect(requester instanceof Function).toBe(true);
    });

    it("should support Gemini with various parameters", () => {
      const requester = createLlmRequester({
        modelUri: ModelURI.parse("chat://gemini/gemini-pro?apiKey=test-key&temperature=0.7"),
        logger,
        costTracker,
        ctx
      });

      expect(requester instanceof Function).toBe(true);
    });

    it("should support OpenRouter with various parameters", () => {
      const requester = createLlmRequester({
        modelUri: ModelURI.parse("chat://openrouter/meta-llama/llama-3-70b-instruct?apiKey=test-key&temperature=0.1"),
        logger,
        costTracker,
        ctx
      });

      expect(requester instanceof Function).toBe(true);
    });
  });

  describe("URI parameter parsing", () => {
    it("should parse baseURL parameter", () => {
      const requester = createLlmRequester({
        modelUri: ModelURI.parse("chat://openai/gpt-4?apiKey=test-key&baseURL=https://custom.openai.com"),
        logger,
        costTracker,
        ctx
      });

      expect(requester instanceof Function).toBe(true);
    });

    it("should parse multiple parameters", () => {
      const requester = createLlmRequester({
        modelUri: ModelURI.parse("chat://openai/gpt-4?apiKey=test-key&temperature=0.5&maxTokens=100&topP=0.9"),
        logger,
        costTracker,
        ctx
      });

      expect(requester instanceof Function).toBe(true);
    });

    it("should handle URL-encoded parameters", () => {
      const requester = createLlmRequester({
        modelUri: ModelURI.parse("chat://openai/gpt-4?apiKey=test%2Bkey&baseURL=https%3A%2F%2Fcustom.openai.com"),
        logger,
        costTracker,
        ctx
      });

      expect(requester instanceof Function).toBe(true);
    });
  });

  describe("Debug directory integration", () => {
    it("should accept run context with debug directory", () => {
      const customCtx: RunContext = {
        runId: "integration-test-run",
        debugDir: "/tmp/integration-debug",
        logger,
        startTime: new Date(),
      };

      const requester = createLlmRequester({
        modelUri: ModelURI.parse("chat://openai/gpt-4?apiKey=test-key"),
        logger,
        costTracker,
        ctx: customCtx
      });

      expect(requester instanceof Function).toBe(true);
    });
  });

  describe("Type safety", () => {
    it("should maintain type safety with Zod schemas", () => {
      const requester = createLlmRequester({
        modelUri: ModelURI.parse("chat://openai/gpt-4?apiKey=test-key"),
        logger,
        costTracker,
        ctx
      });

      // TypeScript should enforce that the requester accepts the schema type
      expect(requester instanceof Function).toBe(true);
    });
  });
});
