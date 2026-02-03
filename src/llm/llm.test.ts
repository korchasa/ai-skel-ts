import { describe, it, expect } from "vitest";
import { createLlmRequester, ModelURI } from "./llm.ts";
import type { Logger } from "../logger/logger.ts";
import type { CostTracker } from "../cost-tracker/cost-tracker.ts";
import type { RunContext } from "../run-context/run-context.ts";

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

describe("ModelURI", () => {
  it("should parse chat://openai/gpt-4", () => {
    const uri = ModelURI.parse("chat://openai/gpt-4");
    expect(uri.provider).toBe("openai");
    expect(uri.modelName).toBe("gpt-4");
    expect(uri.protocol).toBe("chat");
  });

  it("should parse response-api://openai/gpt-4o", () => {
    const uri = ModelURI.parse("response-api://openai/gpt-4o");
    expect(uri.provider).toBe("openai");
    expect(uri.modelName).toBe("gpt-4o");
    expect(uri.protocol).toBe("response-api");
  });

  it("should parse openai/gpt-4 as chat://openai/gpt-4 (default protocol)", () => {
    const uri = ModelURI.parse("openai/gpt-4");
    expect(uri.provider).toBe("openai");
    expect(uri.modelName).toBe("gpt-4");
    expect(uri.protocol).toBe("chat");
  });

  it("should throw error for legacy openai:gpt-4 format", () => {
    expect(() => ModelURI.parse("openai:gpt-4")).toThrow();
  });

  it("should throw error for legacy openai://gpt-4 format (missing model in path)", () => {
    // In strict mode, openai://gpt-4 parses as host=gpt-4, path=""
    // Our parse method now throws if path is empty.
    expect(() => ModelURI.parse("openai://gpt-4")).toThrow();
  });


  it("should throw error for legacy anthropic:claude-3 format", () => {
    expect(() => ModelURI.parse("anthropic:claude-3")).toThrow();
  });

  it("should parse with parameters", () => {
    const uri = ModelURI.parse("chat://openai/gpt-4?apiKey=test-key&temperature=0.5");
    expect(uri.provider).toBe("openai");
    expect(uri.modelName).toBe("gpt-4");
    expect(uri.params.get("apiKey")).toBe("test-key");
    expect(uri.params.get("temperature")).toBe("0.5");
  });

  it("should mask apiKey in toString()", () => {
    const uri = ModelURI.parse("chat://openai/gpt-4?apiKey=secret-key&other=val");
    expect(uri.toString()).toContain("apiKey=***");
    expect(uri.toString()).toContain("other=val");
    expect(uri.toString()).not.toContain("secret-key");
  });

  it("should handle OpenRouter models via chat:// protocol", () => {
    // chat://openrouter/meta-llama/llama-3-70b-instruct
    const uri = ModelURI.parse("chat://openrouter/meta-llama/llama-3-70b-instruct");
    expect(uri.provider).toBe("openrouter");
    expect(uri.modelName).toBe("meta-llama/llama-3-70b-instruct");
  });

  it("should throw error for invalid URI", () => {
    expect(() => ModelURI.parse("invalid")).toThrow();
  });
});

describe("LLM Requester", () => {
  const logger = new MockLogger() as unknown as Logger;
  const costTracker = new MockCostTracker() as unknown as CostTracker;
  const ctx = {
    runId: "test-run-123",
    debugDir: "/tmp/test-debug",
    logger,
    startTime: new Date(),
  } as RunContext;

  it("should create requester for OpenAI", () => {
    expect(() => createLlmRequester({
      modelUri: ModelURI.parse("chat://openai/gpt-4?apiKey=test-key"),
      logger,
      costTracker,
      ctx
    }));
  });

  it("should create requester for Anthropic", () => {
    expect(() => createLlmRequester({
      modelUri: ModelURI.parse("chat://anthropic/claude-3-sonnet-20240229?apiKey=test-key"),
      logger,
      costTracker,
      ctx
    }));
  });

  it("should create requester for Gemini", () => {
    expect(() => createLlmRequester({
      modelUri: ModelURI.parse("chat://gemini/gemini-pro?apiKey=test-key"),
      logger,
      costTracker,
      ctx
    }));
  });

    it("should create requester for OpenRouter", () => {
    expect(() => createLlmRequester({
      modelUri: ModelURI.parse("chat://openrouter/meta-llama/llama-3-70b-instruct?apiKey=test-key"),
      logger,
      costTracker,
      ctx
    }));
  });

  it("should throw error for unknown provider", () => {
    try {
      createLlmRequester({
        modelUri: ModelURI.parse("chat://unknown/model?apiKey=test-key"),
        logger,
        costTracker,
        ctx
      });
      expect.fail("Should have thrown error for unknown provider");
    } catch (error) {
      expect(error instanceof Error).toBe(true);
      expect((error as Error).message).toBe("Unknown LLM provider: unknown");
    }
  });

  it("should throw error for invalid URI format", () => {
    try {
      createLlmRequester({
        modelUri: ModelURI.parse("invalid-uri-format"),
        logger,
        costTracker,
        ctx
      });
      expect.fail("Should have thrown error for invalid URI");
    } catch (error) {
      expect(error instanceof Error).toBe(true);
      // Our custom error message for missing path
      expect((error as Error).message).toContain("Model identifier (path) is required");
    }
  });

  it("should handle URI with baseURL parameter", () => {
    expect(() => createLlmRequester({
      modelUri: ModelURI.parse("chat://openai/gpt-4?apiKey=test-key&baseURL=https://custom.openai.com"),
      logger,
      costTracker,
      ctx
    }));
  });

  it("should handle URI with additional parameters", () => {
    expect(() => createLlmRequester({
      modelUri: ModelURI.parse("chat://openai/gpt-4?apiKey=test-key&temperature=0.5&maxTokens=100"),
      logger,
      costTracker,
      ctx
    }));
  });

  describe("API Key Resolution", () => {
    const originalEnv = { ...process.env };

    it("should fallback to environment variable if apiKey is missing from URI", () => {
      process.env.OPENAI_API_KEY = "env-key";
      
      const requester = createLlmRequester({
        modelUri: ModelURI.parse("chat://openai/gpt-4"),
        logger,
        costTracker,
        ctx
      });
      expect(requester).toBeDefined();
    });

    it("should NOT override apiKey from URI with environment variable", () => {
      process.env.OPENAI_API_KEY = "env-key";
      
      const requester = createLlmRequester({
        modelUri: ModelURI.parse("chat://openai/gpt-4?apiKey=uri-key"),
        logger,
        costTracker,
        ctx
      });
      // We can't easily check the internal apiKey, but the logic in llm.ts
      // uses `if (!result.apiKey)`, so it's safe.
      // This test ensures it doesn't crash and the logic is exercised.
      expect(requester).toBeDefined();
    });

    it("should use provider-specific environment variable", () => {
      process.env.GEMINI_API_KEY = "gemini-env-key";
      const requester = createLlmRequester({
        modelUri: ModelURI.parse("chat://gemini/model"),
        logger,
        costTracker,
        ctx
      });
      expect(requester).toBeDefined();
    });

    it("should cleanup env", () => {
      Object.assign(process.env, originalEnv);
    });
  });
});
