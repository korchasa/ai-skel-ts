import { describe, it, expect } from "vitest";
import type { ModelMessage, LanguageModel } from "ai";
import { SummaryGenerator } from "./summary-generator.ts";

describe("SummaryGenerator", () => {
  describe("constructor", () => {
    it("should create summary generator with default config", () => {
      const generator = new SummaryGenerator({
        model: {} as LanguageModel,
      });
      expect(generator).toBeInstanceOf(SummaryGenerator);
    });
  });

  describe("generateSummary", () => {
    it("should generate summary for single message", async () => {
      const generator = new SummaryGenerator({
        model: {} as LanguageModel,
      });

      const messages: ModelMessage[] = [
        { role: "user", content: "Hello world" },
      ];

      const result = await generator.generateSummary({ messages });
      expect(result).toHaveProperty("role", "assistant");
      expect(result).toHaveProperty("content");
      expect(typeof result.content).toBe("string");
    });
  });
});
