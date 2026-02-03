import { describe, it, expect, vi, beforeEach } from "vitest";
import { Agent } from "./agent.ts";
import type { LlmRequester } from "../llm/llm.ts";
import type { McpClientWrapper } from "../mcp/client.ts";
import type { RunContext } from "../run-context/run-context.ts";
import type { HistoryCompactor } from "../llm-session-compactor/compactor.ts";

describe("Agent", () => {
  let llm: LlmRequester;
  let mcpClient: McpClientWrapper;
  let ctx: RunContext;
  let compactor: HistoryCompactor;

  beforeEach(() => {
    llm = vi.fn().mockResolvedValue({
      text: "Hello from LLM",
      estimatedCost: 0.01,
      inputTokens: 100,
      outputTokens: 50,
    });

    mcpClient = {
      connect: vi.fn(),
      getTools: vi.fn().mockResolvedValue({
        "mcp__tool": {
          description: "A tool",
          parameters: {} as any,
          execute: vi.fn(),
        },
      }),
    } as unknown as McpClientWrapper;

    ctx = {
      runId: "test-run",
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
    } as unknown as RunContext;

    compactor = {
      compact: vi.fn((msgs) => msgs),
      estimateSymbols: vi.fn(() => 10),
    } as unknown as HistoryCompactor;
  });

  it("should initialize and aggregate tools", async () => {
    const agent = new Agent({
      llm,
      mcpClients: [mcpClient],
      ctx,
      systemPrompt: undefined,
      compactor: undefined,
      tools: undefined,
    });

    await agent.init();

    expect(mcpClient.getTools).toHaveBeenCalled();
  });

  it("should maintain chat history and call LLM", async () => {
    const agent = new Agent({
      llm,
      mcpClients: [],
      ctx,
      systemPrompt: "You are a helpful assistant.",
      compactor: undefined,
      tools: undefined,
    });

    await agent.init();
    const response = await agent.chat("Hi");

    expect(response).toBe("Hello from LLM");
    expect(llm).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          { role: "system", content: "You are a helpful assistant." },
          { role: "user", content: "Hi" },
        ],
      })
    );
  });

  it("should use compactor when history grows", async () => {
    const agent = new Agent({
      llm,
      mcpClients: [],
      ctx,
      compactor,
      systemPrompt: undefined,
      tools: undefined,
    });

    await agent.init();
    await agent.chat("Message 1");
    
    expect(compactor.compact).toHaveBeenCalled();
  });

  it("should accept and use local tools", async () => {
    const localTool = {
      description: "Local tool",
      parameters: { type: "object", properties: {} },
      execute: vi.fn(),
    };

    const agent = new Agent({
      llm,
      ctx,
      tools: {
        "local_tool": localTool as any
      },
      mcpClients: undefined,
      systemPrompt: undefined,
      compactor: undefined,
    });

    await agent.init();
    await agent.chat("Use local tool");

    expect(llm).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: expect.objectContaining({
          "local_tool": localTool
        })
      })
    );
  });
});
