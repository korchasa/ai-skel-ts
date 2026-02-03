import { describe, it, expect, beforeEach, vi } from "vitest";
import { JinaScraper } from "./client.ts";
import { JinaScraperError } from "./types.ts";
import { createRunContext } from "../../run-context/run-context.ts";
import { Logger } from "../../logger/logger.ts";

describe("JinaScraper", () => {
  const mockApiKey = "test-api-key";
  let client: JinaScraper;
  let mockCtx: any;

  beforeEach(() => {
    // Mock environment variable
    vi.stubEnv("JINA_API_KEY", mockApiKey);

    // Create mock run context
    mockCtx = {
      runId: "test-run",
      debugDir: "/tmp/test-debug",
      logger: new Logger({ context: "test", logLevel: "info" }),
      startTime: new Date(),
      saveDebugFile: vi.fn(),
    };
  });

  describe("constructor", () => {
    it("should create instance with config only", () => {
      const client = new JinaScraper({ apiKey: "custom-key" });
      expect(client).toBeInstanceOf(JinaScraper);
    });

    it("should create instance without context when env key is set", () => {
      const client = new JinaScraper();
      expect(client).toBeInstanceOf(JinaScraper);
    });

    it("should create instance with provided API key", () => {
      const client = new JinaScraper(mockCtx, { apiKey: "custom-key" });
      expect(client).toBeInstanceOf(JinaScraper);
    });

    it("should create instance with API key from environment", () => {
      const client = new JinaScraper(mockCtx);
      expect(client).toBeInstanceOf(JinaScraper);
    });

    it("should throw error when API key is not provided", () => {
      vi.stubEnv("JINA_API_KEY", "");
      expect(() => new JinaScraper(mockCtx)).toThrow(JinaScraperError);
      expect(() => new JinaScraper(mockCtx)).toThrow("API key is required");
    });

    it("should use custom base URL when provided", () => {
      const client = new JinaScraper(mockCtx, {
        apiKey: mockApiKey,
        baseUrl: "https://custom.api.url",
      });
      expect(client).toBeInstanceOf(JinaScraper);
    });
  });

  describe("searchRaw", () => {
    beforeEach(() => {
      client = new JinaScraper(mockCtx, { apiKey: mockApiKey });
      global.fetch = vi.fn();
    });

    it("should throw error when query is missing", async () => {
      await expect(
        client.searchRaw({ q: "" })
      ).rejects.toThrow("Search query (q) is required");
    });

    it("should make GET request with correct headers", async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        headers: new Map([["content-type", "application/json"]]),
        json: async () => ({
          code: 200,
          status: 20000,
          data: "search results",
        }),
      } as unknown as Response;

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      await client.searchRaw({ q: "test query" });

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("test%20query"),
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            Authorization: `Bearer ${mockApiKey}`,
            Accept: "application/json",
          }),
        })
      );
    });

    it("should handle JSON response", async () => {
      const mockData = {
        code: 200,
        status: 20000,
        data: "search results",
      };

      const mockResponse = {
        ok: true,
        status: 200,
        headers: new Map([["content-type", "application/json"]]),
        json: async () => mockData,
      } as unknown as Response;

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      const result = await client.searchRaw({ q: "test" });

      expect(result).toEqual(mockData);
    });

    it("should handle text response", async () => {
      const mockText = "plain text response";

      const mockResponse = {
        ok: true,
        status: 200,
        headers: new Map([["content-type", "text/plain"]]),
        text: async () => mockText,
      } as unknown as Response;

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      const result = await client.searchRaw({ q: "test" });

      expect(result).toEqual({
        code: 200,
        status: 20000,
        data: mockText,
      });
    });

    it("should handle HTTP errors", async () => {
      const mockResponse = {
        ok: false,
        status: 404,
        statusText: "Not Found",
        text: async () => "Not Found",
        headers: new Map(),
      } as unknown as Response;

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      await expect(client.searchRaw({ q: "test" })).rejects.toThrow(JinaScraperError);
      await expect(client.searchRaw({ q: "test" })).rejects.toThrow("HTTP error: 404");
    });

    it("should handle network errors", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("Network error")
      );

      await expect(client.searchRaw({ q: "test" })).rejects.toThrow(JinaScraperError);
      await expect(client.searchRaw({ q: "test" })).rejects.toThrow(
        "Failed to perform search"
      );
    });

    it("should include query parameters", async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        headers: new Map([["content-type", "application/json"]]),
        json: async () => ({ code: 200, status: 20000, data: "" }),
      } as unknown as Response;

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      await client.searchRaw({
        q: "test",
        num: 10,
        type: "web",
        engine: "google",
      });

      const callUrl = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(callUrl).toContain("num=10");
      expect(callUrl).toContain("type=web");
      expect(callUrl).toContain("engine=google");
    });

    it("should include array parameters", async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        headers: new Map([["content-type", "application/json"]]),
        json: async () => ({ code: 200, status: 20000, data: "" }),
      } as unknown as Response;

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      await client.searchRaw({
        q: "test",
        site: ["github.com", "stackoverflow.com"],
        filetype: ["pdf"],
      });

      const callUrl = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(callUrl).toContain("site=github.com");
      expect(callUrl).toContain("site=stackoverflow.com");
      expect(callUrl).toContain("filetype=pdf");
    });

    it("should include custom headers", async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        headers: new Map([["content-type", "application/json"]]),
        json: async () => ({ code: 200, status: 20000, data: "" }),
      } as unknown as Response;

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      await client.searchRaw({
        q: "test",
        noCache: true,
        cacheTolerance: 60,
        respondWith: "markdown",
        timeout: 30,
        proxyUrl: "http://proxy.example.com",
        userAgent: "CustomBot/1.0",
      });

      const headers = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1]
        .headers;

      expect(headers["X-No-Cache"]).toBe("true");
      expect(headers["X-Cache-Tolerance"]).toBe("60");
      expect(headers["X-Respond-With"]).toBe("markdown");
      expect(headers["X-Timeout"]).toBe("30");
      expect(headers["X-Proxy-Url"]).toBe("http://proxy.example.com");
      expect(headers["X-User-Agent"]).toBe("CustomBot/1.0");
    });
  });

  describe("searchIndex", () => {
    beforeEach(() => {
      client = new JinaScraper(mockCtx, { apiKey: mockApiKey });
      global.fetch = vi.fn();
    });

    it("should make GET request to /search endpoint", async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        headers: new Map([["content-type", "application/json"]]),
        json: async () => ({ code: 200, status: 20000, data: "" }),
      } as unknown as Response;

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      await client.searchIndex({ q: "test" });

      const callUrl = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(callUrl).toContain("/search");
      expect(callUrl).toContain("q=test");
    });

    it("should handle errors similarly to search method", async () => {
      const mockResponse = {
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      } as Response;

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      await expect(client.searchIndex({ q: "test" })).rejects.toThrow(
        JinaScraperError
      );
    });
  });

  describe("scrapeUrlToResponse", () => {
    beforeEach(() => {
      client = new JinaScraper(mockCtx, { apiKey: mockApiKey });
      global.fetch = vi.fn();
    });

    it("should throw error when URL is missing", async () => {
      await expect(
        client.scrapeUrlToResponse({ url: "" })
      ).rejects.toThrow("URL is required for scraping");
    });

    it("should make GET request to reader endpoint", async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        headers: new Map([["content-type", "application/json"]]),
        json: async () => ({
          code: 200,
          status: 20000,
          data: "scraped content",
        }),
      } as unknown as Response;

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      await client.scrapeUrlToResponse({ url: "https://example.com" });

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("https://r.jina.ai/"),
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            Authorization: `Bearer ${mockApiKey}`,
            Accept: "application/json",
          }),
        })
      );
    });

    it("should handle scraping options in headers", async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        headers: new Map([["content-type", "text/plain"]]),
        text: async () => "markdown content",
      } as unknown as Response;

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      await client.scrapeUrlToResponse({
        url: "https://example.com",
        respondWith: "markdown",
        timeout: 30,
        retainImages: "none",
      });

      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            "X-Respond-With": "markdown",
            "X-Timeout": "30",
            "X-Retain-Images": "none",
          }),
        })
      );
    });

    it("should handle markdown formatting options", async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        headers: new Map([["content-type", "text/plain"]]),
        text: async () => "formatted markdown",
      } as unknown as Response;

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      await client.scrapeUrlToResponse({
        url: "https://example.com",
        markdown: {
          headingStyle: "atx",
          bulletListMarker: "-",
        },
      });

      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            "X-Md-Heading-Style": "atx",
            "X-Md-Bullet-List-Marker": "-",
          }),
        })
      );
    });
  });

  describe("scrapeIndexToResponse", () => {
    beforeEach(() => {
      client = new JinaScraper(mockCtx, { apiKey: mockApiKey });
      global.fetch = vi.fn();
    });

    it("should make POST request to reader index endpoint", async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        headers: new Map([["content-type", "application/json"]]),
        json: async () => ({
          code: 200,
          status: 20000,
          data: "scraped content",
        }),
      } as unknown as Response;

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      await client.scrapeIndexToResponse({
        url: "https://example.com",
        respondWith: "content",
      });

      expect(global.fetch).toHaveBeenCalledWith(
        "https://r.jina.ai/",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: `Bearer ${mockApiKey}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          }),
        })
      );
    });

    it("should include options in request body", async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        headers: new Map([["content-type", "text/plain"]]),
        text: async () => "scraped text",
      } as unknown as Response;

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      const options = {
        url: "https://example.com",
        respondWith: "text" as const,
        timeout: 45,
        noCache: true,
      };

      await client.scrapeIndexToResponse(options);

      const callArgs = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const requestBody = JSON.parse(callArgs[1].body);

      expect(requestBody).toEqual(options);
    });

    it("should handle network errors", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("Connection failed")
      );

      await expect(
        client.scrapeIndexToResponse({ url: "https://example.com" })
      ).rejects.toThrow(JinaScraperError);
      await expect(
        client.scrapeIndexToResponse({ url: "https://example.com" })
      ).rejects.toThrow("Failed to scrape");
    });
  });

  describe("high-level methods", () => {
    beforeEach(() => {
      client = new JinaScraper(mockCtx, { apiKey: mockApiKey });
      global.fetch = vi.fn();
    });

    describe("fetch", () => {
      it("should fetch and normalize content", async () => {
        const mockJinaData = {
          url: "https://example.com/article",
          title: "Test Title",
          description: "Test Description",
          content: "# Markdown Header\n\nSome content.",
          author: "Test Author",
          siteName: "Test Publisher",
          publishedTime: "2023-01-01",
        };

        const mockResponse = {
          ok: true,
          status: 200,
          headers: new Map([["content-type", "application/json"]]),
          json: async () => ({
            code: 200,
            status: 20000,
            data: mockJinaData,
          }),
        } as unknown as Response;

        (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

        const result = await client.fetch("https://example.com/article");

        expect(result.url).toBe(mockJinaData.url);
        expect(result.title).toBe(mockJinaData.title);
        expect(result.text).toBe(mockJinaData.content);
        expect(result.author).toBe(mockJinaData.author);
        expect(result.publisher).toBe(mockJinaData.siteName);
        expect(result.date).toBe(mockJinaData.publishedTime);
        expect(result.textLength).toBe(mockJinaData.content.length);
      });

      it("should apply content limit", async () => {
        const mockJinaData = {
          content: "1234567890",
        };

        const mockResponse = {
          ok: true,
          status: 200,
          headers: new Map([["content-type", "application/json"]]),
          json: async () => ({
            code: 200,
            status: 20000,
            data: mockJinaData,
          }),
        } as unknown as Response;

        (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

        const result = await client.fetch("https://example.com", { contentLimit: 5 });

        expect(result.text).toBe("12345");
        expect(result.textLength).toBe(5);
      });
    });

    describe("search", () => {
      it("should search and normalize results", async () => {
        const mockJinaResults = [
          { url: "https://1.com", title: "T1", content: "C1" },
          { url: "https://2.com", title: "T2", content: "C2" },
        ];

        const mockResponse = {
          ok: true,
          status: 200,
          headers: new Map([["content-type", "application/json"]]),
          json: async () => ({
            code: 200,
            status: 20000,
            data: mockJinaResults,
          }),
        } as unknown as Response;

        (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

        const results = await client.search("query");

        expect(results).toHaveLength(2);
        expect(results[0].url).toBe("https://1.com");
        expect(results[1].text).toBe("C2");
      });

      it("should handle empty results", async () => {
        const mockResponse = {
          ok: true,
          status: 200,
          headers: new Map([["content-type", "application/json"]]),
          json: async () => ({
            code: 200,
            status: 20000,
            data: [],
          }),
        } as unknown as Response;

        (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

        const results = await client.search("query");
        expect(results).toEqual([]);
      });
    });
  });
});
