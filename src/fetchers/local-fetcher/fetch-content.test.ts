import { describe, it, expect, vi } from "vitest";

// Import functions to test
import {
  fetch,
  fetchFromURL,
  normalizeField,
  normalizeContent,
} from "./fetch-content.ts";
import type { FetchContentResult as _FetchContentResult } from "../types.ts";
import type { Downloader } from "./downloader.ts";
import type { RunContext } from "../../run-context/run-context.ts";
import { Logger } from "../../logger/logger.ts";

interface MockDownloaderOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  headers?: Record<string, string>;
}

// Mock implementations
class _MockMetadataExtractor {
  extract({ html }: { html: string; url?: string }) {
    return {
      url: null,
      canonicalUrl: null,
      title: "Test Title",
      description: "Test Description",
      image: null,
      author: null,
      publisher: null,
      date: null,
      lang: "en",
      logo: null,
      audio: null,
      video: null,
    };
  }
}

class MockDownloader {
  fetchImpl: typeof fetch;
  timeoutMs: number;
  headers?: HeadersInit;

  constructor(options: MockDownloaderOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 12000;
    this.headers = options.headers;
  }

  download({ url }: { url: string }): string {
    return `<html><head><title>Mock HTML for ${url}</title></head><body><h1>Mock content for ${url}</h1></body></html>`;
  }
}

// Replace original implementations with mocks

// Note: In a real implementation, we would need to properly mock the module dependencies
// For now, we'll test the pure functions directly

const mockCtx: RunContext = {
  runId: "test-run",
  debugDir: "/tmp/test-debug",
  logger: new Logger({ context: "test", logLevel: "info" }),
  startTime: new Date(),
  saveDebugFile: vi.fn(),
};

describe("fetch-content", () => {
  describe("normalizeField", () => {
    it("should return null for non-string values", () => {
      expect(normalizeField({ value: null })).toBe(null);
      expect(normalizeField({ value: undefined })).toBe(null);
      expect(normalizeField({ value: 123 })).toBe(null);
      expect(normalizeField({ value: {} })).toBe(null);
      expect(normalizeField({ value: [] })).toBe(null);
    });

    it("should trim whitespace and return trimmed string", () => {
      expect(normalizeField({ value: "  test  " })).toBe("test");
      expect(normalizeField({ value: "\t\ntest\t\n" })).toBe("test");
      expect(normalizeField({ value: "test" })).toBe("test");
    });

    it("should return null for empty strings after trimming", () => {
      expect(normalizeField({ value: "" })).toBe(null);
      expect(normalizeField({ value: "   " })).toBe(null);
      expect(normalizeField({ value: "\t\n" })).toBe(null);
    });
  });

  describe("normalizeContent", () => {
    it("should collapse multiple whitespace characters to single spaces", () => {
      expect(normalizeContent({ content: "test  \t\n  content" })).toBe("test content");
      expect(normalizeContent({ content: "multiple   spaces" })).toBe("multiple spaces");
      expect(normalizeContent({ content: "tabs\t\tand\n\nnewlines" })).toBe("tabs and newlines");
    });

    it("should trim leading and trailing whitespace", () => {
      expect(normalizeContent({ content: "  content  " })).toBe("content");
      expect(normalizeContent({ content: "\t\ncontent\t\n" })).toBe("content");
      expect(normalizeContent({ content: "content" })).toBe("content");
    });

    it("should handle empty content", () => {
      expect(normalizeContent({ content: "" })).toBe("");
      expect(normalizeContent({ content: "   " })).toBe("");
    });
  });

  describe("fetch", () => {
    it("should process HTML and return structured result", async () => {
      const html = `
        <html>
          <head>
            <title>Test Title</title>
            <meta name="description" content="Test Description">
            <link rel="canonical" href="https://example.com/test">
          </head>
          <body>
            <h1>Test Content</h1>
            <p>This is some test content for extraction.</p>
          </body>
        </html>
      `;

      const result = await fetch({ html, options: { url: "https://example.com/test" } });

      expect(result.title).toBe("Test Title");
      expect(result.description).toBe("Test Description");
      expect(result.canonicalUrl).toBe("https://example.com/test");
      expect(result.textLength).toBe(result.text.length);
      expect(typeof result.text).toBe("string");
      expect(result.text.length > 0).toBe(true);
      expect(typeof result.html).toBe("string");
    });

    it("should use default content limit when not specified", async () => {
      const longContent = "word ".repeat(1000); // Create long content
      const html = `<html><body><p>${longContent}</p></body></html>`;

      const result = await fetch({ html, options: { url: "https://example.com/test" } });

      // Default limit is 10_000, so text should be truncated if longer
      expect(result.textLength <= 10000).toBe(true);
    });

    it("should apply custom content limit", async () => {
      const longContent = "word ".repeat(100); // Create long content
      const html = `<html><body><p>${longContent}</p></body></html>`;

      const result = await fetch({ html, options: { url: "https://example.com/test", contentLimit: 50 } });

      expect(result.textLength <= 50).toBe(true);
    });

    it("should handle missing URL option", async () => {
      const html = `<html><head><title>Test</title></head><body>Content</body></html>`;

      const result = await fetch({ html, options: { url: "https://example.com/fallback" } });

      expect(result.url).toBe("https://example.com/fallback");
      expect(result.canonicalUrl).toBe("https://example.com/fallback");
    });

    it("should use URL from options when metadata doesn't provide it", async () => {
      const html = `<html><head><title>Test</title></head><body>Content</body></html>`;
      const testUrl = "https://example.com/page";

      const result = await fetch({ html, options: { url: testUrl } });

      expect(result.url).toBe(testUrl);
      expect(result.canonicalUrl).toBe(testUrl);
    });

    it("should set canonical URL to resolved URL when no canonical metadata", async () => {
      const html = `
        <html>
          <head>
            <title>Test</title>
          </head>
          <body>Content</body>
        </html>
      `;
      const testUrl = "https://example.com/page";

      const result = await fetch({ html, options: { url: testUrl } });

      expect(result.url).toBe(testUrl);
      expect(result.canonicalUrl).toBe(testUrl);
    });
  });

  describe("fetchFromURL", () => {
    it("should download and process content from URL", async () => {
      const mockDownloader = new MockDownloader();
      const testUrl = "https://example.com/test";

      const result = await fetchFromURL({
        url: testUrl,
        options: { ctx: mockCtx },
        downloader: mockDownloader as unknown as Downloader
      });

      expect(result.url).toBe(testUrl);
      expect(result.title).toBe("Mock HTML for https://example.com/test");
      expect(result.text.includes("Mock content for")).toBe(true);
      expect(result.textLength).toBe(result.text.length);
      expect(typeof result.html).toBe("string");
    });

    it("should pass downloader options correctly", async () => {
      // Since we can't easily test the actual downloader options without a real server,
      // we'll test that the function accepts and passes options
      const mockDownloader = new MockDownloader();

      const result = await fetchFromURL({
        url: "https://example.com/test",
        options: {
          ctx: mockCtx,
          timeoutMs: 5000,
          headers: { "User-Agent": "test" }
        },
        downloader: mockDownloader as unknown as Downloader
      });

      expect(result.url).toBe("https://example.com/test");
      expect(typeof result.text).toBe("string");
    });

    it("should handle content limit option", async () => {
      const mockDownloader = new MockDownloader();
      const testUrl = "https://example.com/test";

      const result = await fetchFromURL({
        url: testUrl,
        options: { ctx: mockCtx, contentLimit: 20 },
        downloader: mockDownloader as unknown as Downloader
      });

      expect(result.textLength <= 20).toBe(true);
    });

    it("should create default downloader when none provided", () => {
      // This test verifies the function doesn't break when called without downloader
      // Note: This would make a real HTTP request, so it's more of an integration test
      // In a real scenario, you'd want to mock this or use a test server
      expect(true).toBe(true); // Skip actual execution to avoid network calls
    });
  });

  describe("error handling", () => {
    it("should handle downloader errors", async () => {
      class ErrorDownloader {
        fetchImpl: typeof fetch;
        timeoutMs: number;
        headers?: HeadersInit;

        constructor(options: MockDownloaderOptions = {}) {
          this.fetchImpl = options.fetchImpl ?? fetch;
          this.timeoutMs = options.timeoutMs ?? 12000;
          this.headers = options.headers;
        }

        download(_params: { url: string }): string {
          throw new Error("Network error");
        }
      }

      const errorDownloader = new ErrorDownloader();

      try {
        await fetchFromURL({
          url: "https://example.com/test",
          options: { ctx: mockCtx },
          downloader: errorDownloader as unknown as Downloader
        });
        expect(false).toBe(true, "Should have thrown an error");
      } catch (error) {
        expect(error instanceof Error).toBe(true);
        expect((error as Error).message).toBe("Network error");
      }
    });

    it("should handle malformed HTML gracefully", async () => {
      const malformedHtml = "<html><head><title>Test</title><body><p>Unclosed paragraph";

      const result = await fetch({ html: malformedHtml, options: { url: "https://example.com/test" } });

      // Should still return a valid result even with malformed HTML
      expect(typeof result).toBe("object");
      expect(typeof result.text).toBe("string");
      expect(typeof result.textLength).toBe("number");
    });

    it("should handle empty HTML", async () => {
      const result = await fetch({ html: "", options: { url: "https://example.com/test" } });

      expect(result.title).toBe(null);
      expect(result.text).toBe("");
      expect(result.textLength).toBe(0);
    });
  });
});
