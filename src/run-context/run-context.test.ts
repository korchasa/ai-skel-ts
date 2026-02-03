import { describe, it, expect, vi } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { getSubDebugDir } from "./run-context.ts";
import type { RunContext } from "./run-context.ts";
import { Logger } from "../logger/logger.ts";

// Mock logger
class MockLogger extends Logger {
  constructor() {
    super({ context: "test" });
  }
}

describe("run-context", () => {
  describe("getSubDebugDir()", () => {
    it("should create subdirectory path within debug directory", () => {
      const ctx: RunContext = {
        runId: "test-run-123",
        debugDir: "/tmp/debug",
        logger: new MockLogger(),
        startTime: new Date(),
      };

      const result = getSubDebugDir({ ctx, stageDir: "processing" });

      expect(result).toBe("/tmp/debug/processing");
    });

    it("should handle nested stage directories", () => {
      const ctx: RunContext = {
        runId: "test-run-456",
        debugDir: "/app/debug",
        logger: new MockLogger(),
        startTime: new Date(),
      };

      const result = getSubDebugDir({ ctx, stageDir: "llm/session-compaction" });

      expect(result).toBe("/app/debug/llm/session-compaction");
    });

    it("should handle debug directory with trailing slash", () => {
      const ctx: RunContext = {
        runId: "test-run-789",
        debugDir: "/tmp/debug/",
        logger: new MockLogger(),
        startTime: new Date(),
      };

      const result = getSubDebugDir({ ctx, stageDir: "output" });

      // Should handle trailing slash gracefully (depends on path.join implementation)
      expect(result).toMatch(/output$/);
      expect(result).toContain("/tmp/debug");
    });

    it("should handle debug directory without trailing slash", () => {
      const ctx: RunContext = {
        runId: "test-run-101",
        debugDir: "/tmp/debug",
        logger: new MockLogger(),
        startTime: new Date(),
      };

      const result = getSubDebugDir({ ctx, stageDir: "output" });

      expect(result).toBe("/tmp/debug/output");
    });

    it("should handle empty stage directory", () => {
      const ctx: RunContext = {
        runId: "test-run-202",
        debugDir: "/tmp/debug",
        logger: new MockLogger(),
        startTime: new Date(),
      };

      const result = getSubDebugDir({ ctx, stageDir: "" });

      expect(result).toBe("/tmp/debug");
    });

    it("should handle relative debug directory paths", () => {
      const ctx: RunContext = {
        runId: "test-run-303",
        debugDir: "./debug",
        logger: new MockLogger(),
        startTime: new Date(),
      };

      const result = getSubDebugDir({ ctx, stageDir: "stage1" });

      expect(result).toBe("debug/stage1");
    });

    it("should handle Windows-style paths", () => {
      const ctx: RunContext = {
        runId: "test-run-404",
        debugDir: "C:\\debug",
        logger: new MockLogger(),
        startTime: new Date(),
      };

      const result = getSubDebugDir({ ctx, stageDir: "stage1" });

      // On Unix systems, backslashes might be preserved or converted
      expect(result).toContain("stage1");
      expect(result).toContain("debug");
    });

    it("should handle stage directory with special characters", () => {
      const ctx: RunContext = {
        runId: "test-run-505",
        debugDir: "/tmp/debug",
        logger: new MockLogger(),
        startTime: new Date(),
      };

      const result = getSubDebugDir({ ctx, stageDir: "stage-with_special.chars" });

      expect(result).toBe("/tmp/debug/stage-with_special.chars");
    });

    it("should create consistent paths for same inputs", () => {
      const ctx: RunContext = {
        runId: "test-run-606",
        debugDir: "/tmp/debug",
        logger: new MockLogger(),
        startTime: new Date(),
      };

      const result1 = getSubDebugDir({ ctx, stageDir: "test" });
      const result2 = getSubDebugDir({ ctx, stageDir: "test" });

      expect(result1).toBe(result2);
    });
  });

  describe("RunContext interface", () => {
    it("should support all required RunContext properties", () => {
      const ctx: RunContext = {
        runId: "test-run",
        debugDir: "/tmp/test",
        logger: new MockLogger(),
        startTime: new Date("2024-01-01T00:00:00Z"),
      };

      expect(ctx.runId).toBe("test-run");
      expect(ctx.debugDir).toBe("/tmp/test");
      expect(ctx.startTime.getTime()).toBe(new Date("2024-01-01T00:00:00Z").getTime());
      expect(ctx.logger instanceof MockLogger).toBe(true);
    });
  });

  describe("createRunContext()", () => {
    it("should use provided runId and debugDir", async () => {
      const { createRunContext } = await import("./run-context.ts");
      const ctx = createRunContext({
        logger: new MockLogger(),
        debugDir: "/tmp/debug",
        runId: "explicit-run",
      });

      expect(ctx.runId).toBe("explicit-run");
      expect(ctx.debugDir).toBe("/tmp/debug");
      expect(typeof ctx.saveDebugFile).toBe("function");
    });

    it("should generate deterministic reverse-sortable runId with fixed time", async () => {
      vi.useFakeTimers();
      try {
        const fixedTime = new Date("2024-01-01T00:00:00.000Z");
        vi.setSystemTime(fixedTime);
        vi.resetModules();

        const { createRunContext } = await import("./run-context.ts");
        const ctx = createRunContext({
          logger: new MockLogger(),
          debugDir: "/tmp/debug",
        });

        const maxReverseMs = Date.UTC(9999, 11, 31, 23, 59, 59, 999);
        const expectedIso = new Date(maxReverseMs - fixedTime.getTime()).toISOString().replace("Z", "999Z");

        expect(ctx.runId).toBe(expectedIso);
      } finally {
        vi.useRealTimers();
      }
    });

    it("should save debug files with default saveDebugFile", async () => {
      const { createRunContext } = await import("./run-context.ts");
      const baseDir = await mkdtemp(join(tmpdir(), "run-context-"));

      try {
        const ctx = createRunContext({
          logger: new MockLogger(),
          debugDir: baseDir,
          runId: "test-run",
        });

        await ctx.saveDebugFile?.({
          filename: "debug.txt",
          content: "hello",
          stageDir: "stage",
        });

        const fileContent = await readFile(join(baseDir, "stage", "debug.txt"), "utf-8");
        expect(fileContent).toBe("hello");
      } finally {
        await rm(baseDir, { recursive: true, force: true });
      }
    });
  });
});
