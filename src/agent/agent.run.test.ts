import { describe, it, expect, vi, beforeEach } from "vitest";
import { Agent } from "./agent.ts";
import type { LlmRequester } from "../llm/llm.ts";
import type { RunContext } from "../run-context/run-context.ts";

describe("Agent.run and history preservation", () => {
  let llm: LlmRequester;
  let ctx: RunContext;

  beforeEach(() => {
    ctx = {
      runId: "test-run",
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
    } as unknown as RunContext;
  });

  it("should preserve tool call history in the agent messages", async () => {
    // 1. First call results in a tool call
    const toolCallResult = {
      result: null,
      text: "",
      newMessages: [
        { role: "assistant", content: [{ type: "tool-call", toolCallId: "call-1", toolName: "get_data", args: {} }] },
        { role: "tool", content: [{ type: "tool-result", toolCallId: "call-1", toolName: "get_data", result: "some data" }] },
        { role: "assistant", content: "Final answer with data" }
      ],
      steps: [],
      estimatedCost: 0,
      inputTokens: 0,
      outputTokens: 0,
    };

    llm = vi.fn().mockResolvedValue(toolCallResult);

    const agent = new Agent({
      llm,
      ctx,
      mcpClients: undefined,
      systemPrompt: undefined,
      compactor: undefined,
      tools: undefined,
    });

    await agent.init();
    
    // We expect run() to exist
    const result = await (agent as any).run("Get some data");

    expect(result).toEqual(toolCallResult);
    
    // Check history preservation
    const history = agent.getHistory();
    expect(history).toHaveLength(4); // user, assistant(call), tool(result), assistant(final)
    expect(history[1].role).toBe("assistant");
    expect(history[2].role).toBe("tool");
    expect(history[3].role).toBe("assistant");
  });

  it("chat() should use run() and return text", async () => {
    const finalResult = {
      result: null,
      text: "Hello",
      newMessages: [{ role: "assistant", content: "Hello" }],
      steps: [],
      estimatedCost: 0,
      inputTokens: 0,
      outputTokens: 0,
    };

    llm = vi.fn().mockResolvedValue(finalResult);

    const agent = new Agent({
      llm,
      ctx,
      mcpClients: undefined,
      systemPrompt: undefined,
      compactor: undefined,
      tools: undefined,
    });

    await agent.init();
    const text = await agent.chat("Hi");

    expect(text).toBe("Hello");
    expect(agent.getHistory()).toHaveLength(2); // user, assistant
  });
});
