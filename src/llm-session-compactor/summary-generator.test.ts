import { expect } from "@std/expect";
import type { ModelMessage, LanguageModel } from "ai";
import { SummaryGenerator } from "./summary-generator.ts";

Deno.test("SummaryGenerator", async (t) => {
  await t.step("constructor should create summary generator with default config", () => {
    const generator = new SummaryGenerator({
      model: {} as LanguageModel,
    });
    expect(generator).toBeInstanceOf(SummaryGenerator);
  });

  await t.step("generateSummary should generate summary for single message", () => {
    const generator = new SummaryGenerator({
      model: {} as LanguageModel,
    });

    const messages: ModelMessage[] = [
      { role: "user", content: "Hello world" },
    ];

    const result = generator.generateSummary({ messages });
    expect(result.role).toBe("assistant");
    expect(typeof result.content).toBe("string");
  });
});
