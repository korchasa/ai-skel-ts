import { describe, it, expect } from "vitest";
import { extract } from "./extractor.ts";

describe("extract", () => {
  describe("basic functionality", () => {
    it("should extract title from HTML", async () => {
      const html = `<html><head><title>Test Title</title></head><body><p>Content</p></body></html>`;
      const result = await extract({ html });

      expect(result.title).toBe("Test Title");
      expect(result.text.length > 0, "Should extract text").toBe(true);
      expect(typeof result.html).toBe("string");
    });

    it("should extract content from HTML", async () => {
      const html = `<html><body><article><h1>Title</h1><p>Content here</p></article></body></html>`;
      const result = await extract({ html });

      expect(result.text.length > 0, "Should extract text").toBe(true);
      expect(result.text).toContain("Content here");
      expect(typeof result.html).toBe("string");
    });

    it("should handle empty HTML", async () => {
      const result = await extract({ html: "" });

      expect(result.text).toBe("");
      expect(result.html).toBe(null);
      expect(result.title).toBe(null);
    });
  });
});