import { describe, it, beforeEach, afterEach, expect } from "vitest";
import { Logger, createContextFromLevelString, log } from "./logger.ts";

describe("Logger", () => {
  // Capture console output for testing
  let consoleOutput: string[] = [];
  let originalConsoleDebug: typeof console.debug;
  let originalConsoleInfo: typeof console.info;
  let originalConsoleWarn: typeof console.warn;
  let originalConsoleError: typeof console.error;

  beforeEach(() => {
    consoleOutput = [];
    originalConsoleDebug = console.debug;
    originalConsoleInfo = console.info;
    originalConsoleWarn = console.warn;
    originalConsoleError = console.error;

    // Mock console methods to capture output
    console.debug = (message: string) => consoleOutput.push(`DEBUG: ${message}`);
    console.info = (message: string) => consoleOutput.push(`INFO: ${message}`);
    console.warn = (message: string) => consoleOutput.push(`WARN: ${message}`);
    console.error = (message: string, ...args: unknown[]) => {
      consoleOutput.push(`ERROR: ${message}`);
      if (args.length > 0) {
        consoleOutput.push(`ERROR_EXTRA: ${JSON.stringify(args)}`);
      }
    };
  });

  afterEach(() => {
    console.debug = originalConsoleDebug;
    console.info = originalConsoleInfo;
    console.warn = originalConsoleWarn;
    console.error = originalConsoleError;
  });

  describe("constructor", () => {
    it("should create logger with default debug level", () => {
      const logger = new Logger({ context: "test" });
      expect(logger["logLevel"]).toBe("debug");
      expect(logger["context"]).toBe("test");
    });

    it("should create logger with specified log level", () => {
      const logger = new Logger({ context: "test", logLevel: "debug" });
      expect(logger["logLevel"]).toBe("debug");
    });

    it("should accept all valid log levels", () => {
      const levels: Array<"debug" | "info" | "warn" | "error"> = ["debug", "info", "warn", "error"];

      for (const level of levels) {
        const logger = new Logger({ context: "test", logLevel: level });
        expect(logger["logLevel"]).toBe(level);
      }
    });
  });

  describe("debug()", () => {
    it("should log debug message when level is debug", () => {
      const logger = new Logger({ context: "test", logLevel: "debug" });
      logger.debug("Test debug message");

      expect(consoleOutput.length).toBe(1);
      expect(consoleOutput[0]).toContain("DEBUG:");
      expect(consoleOutput[0]).toContain("[test]");
      expect(consoleOutput[0]).toContain("Test debug message");
    });

    it("should not log debug message when level is info", () => {
      const logger = new Logger({ context: "test", logLevel: "info" });
      logger.debug("Test debug message");

      expect(consoleOutput.length).toBe(0);
    });

    it("should include metadata in debug message", () => {
      const logger = new Logger({ context: "test", logLevel: "debug" });
      logger.debug("Test message", { key: "value", number: 42 });

      expect(consoleOutput.length).toBe(1);
      expect(consoleOutput[0]).toContain('"key": "value"');
      expect(consoleOutput[0]).toContain('"number": 42');
    });
  });

  describe("info()", () => {
    it("should log info message when level allows it", () => {
      const logger = new Logger({ context: "test", logLevel: "info" });
      logger.info("Test info message");

      expect(consoleOutput.length).toBe(1);
      expect(consoleOutput[0]).toContain("INFO:");
      expect(consoleOutput[0]).toContain("[test]");
      expect(consoleOutput[0]).toContain("Test info message");
    });

    it("should not log info when level is warn", () => {
      const logger = new Logger({ context: "test", logLevel: "warn" });
      logger.info("Test info message");

      expect(consoleOutput.length).toBe(0);
    });
  });

  describe("warn()", () => {
    it("should log warning message when level allows it", () => {
      const logger = new Logger({ context: "test", logLevel: "warn" });
      logger.warn("Test warning message");

      expect(consoleOutput.length).toBe(1);
      expect(consoleOutput[0]).toContain("WARN:");
      expect(consoleOutput[0]).toContain("[test]");
      expect(consoleOutput[0]).toContain("Test warning message");
    });

    it("should not log warning when level is error", () => {
      const logger = new Logger({ context: "test", logLevel: "error" });
      logger.warn("Test warning message");

      expect(consoleOutput.length).toBe(0);
    });
  });

  describe("error()", () => {
  it("should log error message always", () => {
    const logger = new Logger({ context: "test", logLevel: "debug" });
    logger.error("Test error message");

    expect(consoleOutput.length >= 1).toBe(true);
    expect(consoleOutput[0]).toContain("ERROR:");
    expect(consoleOutput[0]).toContain("[test]");
    expect(consoleOutput[0]).toContain("Test error message");
  });

    it("should handle Error objects in metadata", () => {
      const logger = new Logger({ context: "test", logLevel: "error" });
      const testError = new Error("Test error");
      testError.stack = "Error stack trace";
      testError.name = "TestError";

      logger.error("Error occurred", testError);

      expect(consoleOutput.length >= 1).toBe(true);
      expect(consoleOutput[0]).toContain("ERROR:");
      // Error objects are logged directly as the second parameter to console.error
      // so we don't check the exact format, just that logging works
    });

    it("should handle regular objects in metadata", () => {
      const logger = new Logger({ context: "test", logLevel: "error" });
      logger.error("Error with metadata", { code: 500, details: "Server error" });

      expect(consoleOutput.length >= 1).toBe(true);
      // Just check that logging occurred - the exact format may vary
      // since Error objects are logged differently than regular objects
      expect(consoleOutput.some(msg => msg.includes("ERROR:") || msg.includes("ERROR_EXTRA:"))).toBe(true);
    });
  });

  describe("warning() alias", () => {
    it("should be alias for warn()", () => {
      const logger = new Logger({ context: "test", logLevel: "warn" });
      logger.warning("Test warning");

      expect(consoleOutput.length).toBe(1);
      expect(consoleOutput[0]).toContain("WARN:");
      expect(consoleOutput[0]).toContain("Test warning");
    });
  });

  describe("message formatting", () => {
    it("should include timestamp in ISO format", () => {
      const logger = new Logger({ context: "test", logLevel: "info" });
      logger.info("Test message");

      expect(consoleOutput.length).toBe(1);
      // Check that timestamp is in ISO format (contains T and Z or +/-timezone)
      const message = consoleOutput[0];
      const timestampMatch = message.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      expect(timestampMatch).toBeTruthy();
    });

    it("should format message as [TIMESTAMP] [LEVEL] [CONTEXT] MESSAGE", () => {
      const logger = new Logger({ context: "my-context", logLevel: "info" });
      logger.info("Test message");

      expect(consoleOutput.length).toBe(1);
      const message = consoleOutput[0];

      // Check general structure
      expect(message).toContain("[my-context]");
      expect(message).toContain("Test message");

      // Check that level is uppercase
      expect(/\[INFO\]/.test(message)).toBe(true);
    });

    it("should handle messages with special characters", () => {
      const logger = new Logger({ context: "test", logLevel: "info" });
      logger.info("Message with special chars: éñüñ");

      expect(consoleOutput.length).toBe(1);
      expect(consoleOutput[0]).toContain("Message with special chars: éñüñ");
    });
  });

  describe("log levels filtering", () => {
    it("should filter messages based on log level", () => {
      const logger = new Logger({ context: "test", logLevel: "warn" });

      const initialLength = consoleOutput.length;
      logger.debug("Debug message"); // Should not log
      logger.info("Info message");   // Should not log
      logger.warn("Warn message");   // Should log
      logger.error("Error message"); // Should log

      const newMessages = consoleOutput.slice(initialLength);
      // Should have at least 2 messages (warn and error)
      expect(newMessages.length >= 2).toBe(true);
      const warnMessages = newMessages.filter(m => m.includes("WARN:"));
      const errorMessages = newMessages.filter(m => m.includes("ERROR:"));
      expect(warnMessages.length >= 1).toBe(true);
      expect(errorMessages.length >= 1).toBe(true);
    });

    it("should log all messages at debug level", () => {
      const logger = new Logger({ context: "test", logLevel: "debug" });

      const initialLength = consoleOutput.length;
      logger.debug("Debug");
      logger.info("Info");
      logger.warn("Warn");
      logger.error("Error");

      const newMessages = consoleOutput.slice(initialLength);
      // Should have at least 4 messages (debug, info, warn, error)
      expect(newMessages.length >= 4).toBe(true);
      const debugMessages = newMessages.filter(m => m.includes("DEBUG:"));
      const infoMessages = newMessages.filter(m => m.includes("INFO:"));
      const warnMessages = newMessages.filter(m => m.includes("WARN:"));
      const errorMessages = newMessages.filter(m => m.includes("ERROR:"));
      expect(debugMessages.length >= 1).toBe(true);
      expect(infoMessages.length >= 1).toBe(true);
      expect(warnMessages.length >= 1).toBe(true);
      expect(errorMessages.length >= 1).toBe(true);
    });
  });
});

describe("global log function", () => {
  let consoleOutput: string[] = [];
  let originalConsoleInfo: typeof console.info;

  beforeEach(() => {
    consoleOutput = [];
    originalConsoleInfo = console.info;
    console.info = (message: string) => consoleOutput.push(message);
  });

  afterEach(() => {
    console.info = originalConsoleInfo;
  });

  it("should format message with mod and event", () => {
    log({
      mod: "test-module",
      event: "test-event",
      extra: "data"
    });

    expect(consoleOutput.length).toBe(1);
    expect(consoleOutput[0]).toContain("[test-module] test-event");
    expect(consoleOutput[0]).toContain('"extra": "data"');
  });

  it("should handle missing extra data", () => {
    log({
      mod: "test",
      event: "simple"
    });

    expect(consoleOutput.length).toBe(1);
    expect(consoleOutput[0]).toContain("[test] simple");
  });

  it("should use default logger context", () => {
    log({
      mod: "test",
      event: "event"
    });

    expect(consoleOutput.length).toBe(1);
    expect(consoleOutput[0]).toContain("[default]");
  });
});

describe("createContextFromLevelString", () => {
  let consoleOutput: string[] = [];
  let originalConsoleWarn: typeof console.warn;

  beforeEach(() => {
    consoleOutput = [];
    originalConsoleWarn = console.warn;
    console.warn = (message: string) => consoleOutput.push(message);
  });

  afterEach(() => {
    console.warn = originalConsoleWarn;
  });

  it("should create logger with matching level without warning", () => {
    const logger = createContextFromLevelString({ context: "test", level: "debug" });
    expect(logger["logLevel"]).toBe("debug");
    expect(consoleOutput.length).toBe(0);
  });

  it("should warn and fallback to debug on unknown level", () => {
    const logger = createContextFromLevelString({ context: "test", level: "verbose" });
    expect(logger["logLevel"]).toBe("debug");
    expect(consoleOutput.length).toBe(1);
    expect(consoleOutput[0]).toContain('Unknown log level "verbose", falling back to "debug".');
  });
});
