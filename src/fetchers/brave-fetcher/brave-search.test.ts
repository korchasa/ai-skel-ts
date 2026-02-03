import { describe, it, expect, vi, beforeEach } from "vitest";
import { BraveSearchClient } from "./client.ts";
import { BraveSearchError } from "./types.ts";
import { createRunContext } from "../../run-context/run-context.ts";

describe("BraveSearchClient", () => {
  const mockCtx = createRunContext({
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as any,
    debugDir: "/tmp/mock-debug-dir",
  });

  // Mock saveDebugFile to prevent actual file writes
  mockCtx.saveDebugFile = vi.fn().mockResolvedValue(undefined);

  const mockFetch = vi.fn();
  global.fetch = mockFetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should throw error if API key is missing", () => {
    expect(() => new BraveSearchClient(mockCtx, {})).toThrow(BraveSearchError);
  });

  it("should instantiate with API key in config", () => {
    const client = new BraveSearchClient(mockCtx, { apiKey: "test-key" });
    expect(client).toBeDefined();
  });

  it("should perform search successfully", async () => {
    const client = new BraveSearchClient(mockCtx, { apiKey: "test-key" });

    const responseData = {
      web: {
        results: [
          { title: "Result 1", url: "https://example.com/1" },
          { title: "Result 2", url: "https://example.com/2" }
        ]
      }
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => responseData,
      text: async () => JSON.stringify(responseData),
      headers: new Headers(),
    });

    const result = await client.search({ q: "test query" });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("https://api.search.brave.com/res/v1/web/search?q=test+query"),
      expect.objectContaining({
        headers: expect.objectContaining({
          "X-Subscription-Token": "test-key"
        })
      })
    );
    expect(result.web?.results).toHaveLength(2);
  });

  it("should handle API errors", async () => {
    const client = new BraveSearchClient(mockCtx, { apiKey: "test-key" });

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      text: async () => "Invalid API key",
      headers: new Headers(),
    });

    await expect(client.search({ q: "test" })).rejects.toThrow("HTTP error: 401 Unauthorized");
  });

  it("should retry on 429 error once", async () => {
    const client = new BraveSearchClient(mockCtx, { apiKey: "test-key" });
    const responseData = { web: { results: [] } };

    // First call returns 429
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
      text: async () => "Rate limit exceeded",
      headers: new Headers(),
    });

    // Second call succeeds
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => responseData,
      text: async () => JSON.stringify(responseData),
      headers: new Headers(),
    });

    const result = await client.search({ q: "test" });

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(result.web?.results).toHaveLength(0);
  });

  it("should fail after two 429 errors", async () => {
    const client = new BraveSearchClient(mockCtx, { apiKey: "test-key" });

    mockFetch.mockResolvedValue({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
      text: async () => "Rate limit exceeded",
      headers: new Headers(),
    });

    await expect(client.search({ q: "test" })).rejects.toThrow("HTTP error: 429 Too Many Requests");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("should perform searchMany with rate limiting", async () => {
    const client = new BraveSearchClient(mockCtx, { apiKey: "test-key" });
    const responseData = { web: { results: [] } };

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => responseData,
      text: async () => JSON.stringify(responseData),
      headers: new Headers(),
    });

    const startTime = Date.now();
    const results = await client.searchMany(["q1", "q2"], {}, 2); // 2 RPS = 500ms delay
    const endTime = Date.now();

    expect(results).toHaveLength(2);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(endTime - startTime).toBeGreaterThanOrEqual(450); // Allowing some jitter
  });
});
