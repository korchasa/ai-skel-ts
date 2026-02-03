import { describe, it, expect, vi, beforeEach } from "vitest";
import { createLlmRequester, ModelURI } from "./llm.ts";
import type { Logger } from "../logger/logger.ts";
import type { CostTracker } from "../cost-tracker/cost-tracker.ts";
import type { RunContext } from "../run-context/run-context.ts";
import { z } from "zod";
import * as ai from "ai";
import * as fsPromises from "node:fs/promises";
import { load as yamlLoad } from "js-yaml";

// Mock AI SDK
vi.mock("ai", async () => {
  const actual = await vi.importActual("ai");
  return {
    ...actual,
    generateObject: vi.fn(),
    generateText: vi.fn(),
  };
});

// Mock fs/promises
vi.mock("node:fs/promises", async () => {
  const actual = await vi.importActual("node:fs/promises");
  return {
    ...actual,
    writeFile: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue(undefined),
    stat: vi.fn().mockResolvedValue({ isDirectory: () => true }),
  };
});

describe("LLM Raw Response Logging", () => {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as Logger;

  const costTracker = {
    addCost: vi.fn(),
    addTokens: vi.fn(),
  } as unknown as CostTracker;

  const ctx: RunContext = {
    runId: "test-run-raw",
    debugDir: "/tmp/test-debug-raw",
    logger,
    startTime: new Date(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should log raw response on NoObjectGeneratedError (new behavior)", async () => {
    const schema = z.object({
      name: z.string(),
    });

    const rawResponseText = '{"name": 123, "extra": "data"}';

    // Mock NoObjectGeneratedError
    // Note: We need to use the actual class if possible or mock it if it's not exported
    // For the test, we'll just mock generateText to throw something that looks like it
    (ai.generateText as any).mockRejectedValue(
      new (ai as any).NoObjectGeneratedError({
        message: "No object generated",
        cause: new Error("Validation failed"),
        text: rawResponseText,
        modelId: "test-model",
        settings: {},
      })
    );

    const requester = createLlmRequester({
      modelUri: ModelURI.parse("chat://openai/gpt-4?apiKey=test-key"),
      logger,
      costTracker,
      ctx
    });

    await requester({
      prompt: "test prompt",
      identifier: "test-no-obj-error",
      schema,
      stageName: "test-stage",
      tools: undefined,
      maxSteps: undefined,
      settings: undefined,
    });

    const yamlCalls = (fsPromises.writeFile as any).mock.calls.filter((call: any) => call[0].endsWith(".yaml"));
    const lastYamlContent = yamlCalls[yamlCalls.length - 1][1];
    const logData = yamlLoad(lastYamlContent) as any;

    // NEW BEHAVIOR: raw contains the actual raw text from the model
    expect(logData.attempts[0].response.raw).toBe(rawResponseText);
  });

  it("should log raw response on success", async () => {
    const schema = z.object({
      name: z.string(),
    });

    const rawResponseText = '{"name": "test"}';
    const parsedObject = { name: "test" };

    // Mock successful generateText
    (ai.generateText as any).mockResolvedValue({
      text: rawResponseText,
      output: parsedObject,
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      finishReason: "stop",
      providerMetadata: {},
    });

    const requester = createLlmRequester({
      modelUri: ModelURI.parse("chat://openai/gpt-4?apiKey=test-key"),
      logger,
      costTracker,
      ctx
    });

    const result = await requester({
      prompt: "test prompt",
      identifier: "test-success",
      schema,
      stageName: "test-stage",
      tools: undefined,
      maxSteps: undefined,
      settings: undefined,
    });

    expect(result.result).toEqual(parsedObject);

    const yamlCalls = (fsPromises.writeFile as any).mock.calls.filter((call: any) => call[0].endsWith(".yaml"));
    const lastYamlContent = yamlCalls[yamlCalls.length - 1][1];
    const logData = yamlLoad(lastYamlContent) as any;

    expect(logData.attempts[0].response.raw).toBe(rawResponseText);
    expect(logData.attempts[0].response.parsed).toEqual(parsedObject);
  });

  it("should preserve multiline strings and special characters in YAML", async () => {
    const rawResponseText = "Line 1\nLine 2 with \"quotes\" and 'single quotes'\n  Indented line\n\nLast line.";

    (ai.generateText as any).mockResolvedValue({
      text: rawResponseText,
      output: rawResponseText,
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      finishReason: "stop",
      providerMetadata: {},
    });

    const requester = createLlmRequester({
      modelUri: ModelURI.parse("chat://openai/gpt-4?apiKey=test-key"),
      logger,
      costTracker,
      ctx
    });

    await requester({
      prompt: "test",
      identifier: "test-multiline",
      schema: undefined,
      stageName: "test-stage",
      tools: undefined,
      maxSteps: undefined,
      settings: undefined,
    });

    const yamlCalls = (fsPromises.writeFile as any).mock.calls.filter((call: any) => call[0].endsWith(".yaml"));
    const lastYamlContent = yamlCalls[yamlCalls.length - 1][1];

    // js-yaml should use |- scalar for multiline strings without trailing newline
    expect(lastYamlContent).toContain("raw: |-");
    expect(lastYamlContent).toContain("  Line 1");
    expect(lastYamlContent).toContain("  Line 2 with \"quotes\" and 'single quotes'");
  });

  it("should log empty raw field and error message on API error", async () => {
    (ai.generateText as any).mockRejectedValue(
        new (ai as any).APICallError({
          message: "Wait, the API is down!",
          statusCode: 503,
          url: "https://api.openai.com/v1/chat/completions",
          responseBody: "Internal Server Error"
        })
    );

    const requester = createLlmRequester({
      modelUri: ModelURI.parse("chat://openai/gpt-4?apiKey=test-key"),
      logger,
      costTracker,
      ctx
    });

    await requester({
      prompt: "test",
      identifier: "api-error",
      schema: undefined,
      stageName: "test-stage",
      tools: undefined,
      maxSteps: undefined,
      settings: undefined,
    });

    const yamlCalls = (fsPromises.writeFile as any).mock.calls.filter((call: any) => call[0].endsWith(".yaml"));
    const lastYamlContent = yamlCalls[yamlCalls.length - 1][1];

    const logData = yamlLoad(lastYamlContent) as any;
    expect(logData.attempts[0].response.raw).toBe("");
    expect(logData.attempts[0].response.error).toContain("API Error: Wait, the API is down!");
  });

  it("should preserve markdown code blocks in raw response", async () => {
    const rawResponseText = "Here is the JSON:\n```json\n{\"key\": \"value\"}\n```\nHope it helps!";

    (ai.generateText as any).mockResolvedValue({
      text: rawResponseText,
      output: { key: "value" },
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      finishReason: "stop",
      providerMetadata: {},
    });

    const requester = createLlmRequester({
      modelUri: ModelURI.parse("chat://openai/gpt-4?apiKey=test-key"),
      logger,
      costTracker,
      ctx
    });

    await requester({
      prompt: "test",
      identifier: "markdown-test",
      schema: z.object({ key: z.string() }),
      stageName: "test-stage",
      tools: undefined,
      maxSteps: undefined,
      settings: undefined,
    });

    const yamlCalls = (fsPromises.writeFile as any).mock.calls.filter((call: any) => call[0].endsWith(".yaml"));
    const lastYamlContent = yamlCalls[yamlCalls.length - 1][1];

    expect(lastYamlContent).toContain("```json");
    expect(lastYamlContent).toContain("{\"key\": \"value\"}");
  });
});

