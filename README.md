# AI Skeleton Tools

TypeScript library for content fetching and LLM interactions with robust error handling and cost tracking.

## Requirements

- **Node.js**: `>=20.0.0` (for Node.js usage and local development)

## Installation (Private GitHub Package)

This package is hosted on GitHub Packages. To install it, you need to configure authentication.

1.  **Generate a Personal Access Token (PAT)**:
    *   Go to GitHub Settings -> Developer settings -> Personal access tokens.
    *   Create a classic token with `read:packages` scope.

2.  **Configure `.npmrc`**:
    Create a `.npmrc` file in your project root with the following content:

    ```ini
    @korchasa:registry=https://npm.pkg.github.com
    //npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
    ```

    Replace `${GITHUB_TOKEN}` with your token, or better yet, set the `GITHUB_TOKEN` environment variable.

3.  **Install**:

    ```bash
    npm install @korchasa/ai-skel-ts
    ```

## Deno Reference Implementation

The most robust way to use this library in Deno 2.x projects is through native environment management and a minimal automation script.

### 1. Transparent Authentication Setup

Instead of manual token management, use Deno's native support for `.npmrc` interpolation.

**`.npmrc` (Static, safe to commit)**:
```ini
@korchasa:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NPM_TOKEN}
```

### 2. Project Automation (`run.ts`)

Use the `--env-file` flag in the shebang. This makes variables from `.env` available globally to Deno **before** it resolves dependencies.

**`run.ts` (Shebang)**:
```typescript
#!/usr/bin/env -S deno run --allow-all --env-file
```

### 3. Minimal Alias (`run`)

A simple bash wrapper serves as a convenient alias, completely decoupled from the application logic.

**`run` (Bash)**:
```bash
#!/bin/bash
exec ./run.ts "$@"
```

### 4. Benefits of this approach

- **Zero-knowledge Application**: The app uses `Deno.env.get()` and knows nothing about the `.env` file.
- **Inheritance**: All child processes (app, tests, linters) automatically inherit the environment.
- **CI/CD Compatibility**: In CI (e.g., GitHub Actions), where `.env` is absent but variables are in the environment, the `--env-file` flag is ignored and everything still works.
- **Security**: No temporary files with secrets; tokens are only in memory.

### 5. `deno.json` configuration

```json
{
  "vendor": true,
  "nodeModulesDir": "auto",
  "imports": {
    "@korchasa/ai-skel-ts": "npm:@korchasa/ai-skel-ts@^0.2.10",
    "@korchasa/ai-skel-ts/logger": "npm:@korchasa/ai-skel-ts@^0.2.10/logger"
  }
}
```

### CI/CD Setup

For CI/CD (e.g., GitHub Actions), ensure your workflow has permission to read packages or provide a `GITHUB_TOKEN` secret.

## Development

```bash
npm ci
./run check
```

## Troubleshooting

- If you see an `npm update check failed` warning during scripts, this repo disables npm's update notifier via `.npmrc`.

## AI Context & Usage Rules

This library is optimized for AI-assisted development. To help Cursor (or other agents) understand the library's patterns, this README serves as the primary context.

### 🤖 For Cursor / AI Agents
**System Instruction:** If you are an AI assistant (like Cursor, Copilot, etc.), please read the sections below and apply them to your code generation logic.

### 📐 Architecture Context

#### Core Philosophy
`ai-skel-ts` is a "skeleton" for building AI agents. It prioritizes:
1.  **Observability**: Every LLM call is logged to a YAML file in a debug directory.
2.  **Cost Awareness**: Every token is counted via `CostTracker`.
3.  **Robustness**: The LLM requester handles retries, timeouts, and JSON schema validation self-correction automatically.

#### Main Components

**1. RunContext (`src/run-context/`)**
The "spine" of any operation. It carries `logger`, `debugDir`, and `runId`.
Always create a context at the entry point:
```typescript
const ctx = createRunContext({ logger: console, debugDir: "./tmp/debug" });
```

**2. LlmRequester (`src/llm/`)**
A wrapper around Vercel AI SDK.
- **ModelURI**: `chat://provider/model?param=value`
- **Self-Correction**: Automatically feeds schema validation errors back for correction.
- **Unified Logging**: Saves input/output to `debugDir`.

**3. Fetchers (`src/fetchers/`)**
- **Local Fetcher** (`fetchFromURL`): Fast, cheap, uses `readability`.
- **Jina Fetcher** (`JinaScraper`): Better for complex JS-heavy sites.

**4. Compactor (`src/llm-session-compactor/`)**
Manages context window size via `SummarizingHistoryCompactor`.

**5. Agent (`src/agent/`)**
A high-level orchestrator that combines LLM, Tools (both local and via MCP), and Session Management into a stateful conversational interface.

### 🛠 Usage Rules (Cursor Rules)

When writing code that uses `@korchasa/ai-skel-ts`, follow these guidelines:

1.  **Initialization Sequence**: `CostTracker` -> `Logger`/`RunContext` -> `LlmRequester`.
2.  **LLM Interaction**: Prefer `createLlmRequester`. Always provide a meaningful `identifier`. Use Zod schemas for structured output.
3.  **Model URIs**: Use `chat://provider/model-name` format.
4.  **Content Fetching**: Default to `fetchFromURL`.
5.  **Logging**: Use `ctx.logger` instead of `console`. Check `ctx.debugDir` for artifacts.
6.  **Error Handling**: Check `result.result` (success) or `result.validationError` (failure).

#### Anti-Patterns to Avoid
- ❌ Don't use `process.env` directly in business logic.
- ❌ Don't implement manual retry loops for LLM calls.
- ❌ Don't use `console.log` for debugging.

## Usage

### Basic LLM Usage

```typescript
import { createLlmRequester, createRunContext, CostTracker, ModelURI } from "@korchasa/ai-skel-ts";

const costTracker = CostTracker.getInstance();
const ctx = createRunContext({
  logger: console,
  debugDir: "./debug"
});

const requester = createLlmRequester({
  modelUri: ModelURI.parse("chat://openai/gpt-4?apiKey=your-api-key"),
  logger: console,
  costTracker,
  ctx
});

const result = await requester({
  prompt: "Hello, how are you?",
  identifier: "greeting",
  schema: z.object({ response: z.string() })
});
```

### Content Fetching

```typescript
import { fetchFromURL } from "@korchasa/ai-skel-ts";

const result = await fetchFromURL({
  url: "https://example.com/article",
  options: { contentLimit: 10000, ctx }
});

console.log(result.title, result.text);
```

### Jina Scraper

```typescript
import { JinaScraper } from "@korchasa/ai-skel-ts";

const client = new JinaScraper(ctx);
const result = await client.fetch("https://example.com/article");
console.log(result.text);
```

### Session Compaction

```typescript
import { SummarizingHistoryCompactor } from "@korchasa/ai-skel-ts";

const compactor = new SummarizingHistoryCompactor({
  maxSymbols: 10000,
  summaryTokenThreshold: 1000,
  summaryGenerator: mySummaryGenerator
});

const compacted = await compactor.compact(messages);
```

### Agent (Beta)

The `Agent` class orchestrates LLM interactions, tool usage (via MCP), and session management.

```typescript
import { Agent, createLlmRequester, ModelURI } from "@korchasa/ai-skel-ts";

// 1. Setup dependencies
const llm = createLlmRequester({
  modelUri: ModelURI.parse("chat://openai/gpt-4"),
  logger: console,
  costTracker,
  ctx
});

// 2. Create Agent
const agent = new Agent({
  llm,
  ctx,
  systemPrompt: "You are a helpful assistant.",
  // Optional: Add local tools
  tools: {
    "get_time": {
      description: "Get current time",
      parameters: z.object({}),
      execute: async () => ({ time: new Date().toISOString() })
    }
  },
  // Optional: Add MCP clients for tools
  // mcpClients: [weatherClient] 
});

// 3. Initialize (connects to MCP servers)
await agent.init();

// 4. Chat (Legacy/Simple)
const response = await agent.chat("What is the weather in Paris?");
console.log(response);

// 5. Run (Modern/Detailed)
const result = await agent.run("What is the weather in London?");
console.log(`Answer: ${result.text}`);
console.log(`Cost: $${result.estimatedCost}`);
console.log(`Steps: ${result.steps.length}`);
```

## API Reference

### LLM Module

- `createLlmRequester(params)` - Creates an LLM requester function
- `type LlmRequester` - Type for LLM requester function
- `type GenerateJsonResult<T>` - Result type for JSON generation

### Content Fetching (Local)

- `fetch(params)` - Extract plain text and HTML content from HTML
- `fetchFromURL(params)` - Fetch and extract content from URL
- `type FetchContentResult` - Content extraction result
- `type FetchOptions` - Options for content extraction

### Jina Scraper

- `JinaScraper` - Client for Jina AI Search and Reader APIs
- `client.fetch(url)` - Fetch normalized content
- `client.search(query)` - Search and get normalized content results
- `client.searchRaw(options)` - Raw search with Jina envelope
- `client.scrapeUrlToResponse(options)` - Raw URL scraping
- `client.scrapeIndexToResponse(options)` - Raw advanced scraping

### Cost Tracking

- `CostTracker.getInstance()` - Get singleton cost tracker
- `type CostReport` - Cost report structure

### Logging

- `Logger` - Structured logger class
- `log(meta)` - Simple logging function

### Session Management

- `SimpleHistoryCompactor` - Basic message compaction
- `SummarizingHistoryCompactor` - LLM-powered compaction with summarization
- `type HistoryCompactor` - Compactor interface

### Utilities

- `type RunContext` - Execution context
- `createRunContext({ logger, debugDir, runId? })` - Run context factory
- `getSubDebugDir(ctx, stageDir)` - Get debug subdirectory

## Supported LLM Providers

- OpenAI (`chat://openai/model-name`)
- Anthropic (`chat://anthropic/model-name`)
- Gemini (`chat://gemini/model-name`)
- OpenRouter (`chat://openrouter/model-name`)

## Model URI Parameters

The `modelUri` supports standard and provider-specific parameters via query string:

| Parameter | Type | Description |
|-----------|------|-------------|
| `apiKey` | string | API key for the provider (overrides environment variables) |
| `baseURL` | string | Custom base URL for API requests |
| `timeout` | number | Request timeout in milliseconds (default: 30000) |
| `logVercelWarnings` | boolean | Set to `false` to suppress Vercel AI SDK compatibility warnings |
| `temperature` | number | Sampling temperature (0.0 to 2.0) |
| `maxTokens` | number | Maximum tokens to generate |
| `topP` | number | Nucleus sampling probability |
| `topK` | number | Top-K sampling |
| `seed` | number | Random seed for reproducibility |
| `maxRetries` | number | Maximum retries at the SDK level |
| `stop` | string | Stop sequences (comma-separated for multiple values) |
| `frequencyPenalty` | number | Frequency penalty |
| `presencePenalty` | number | Presence penalty |

**Example URI:**
`chat://openrouter/google/gemini-2.5-flash-lite?logVercelWarnings=false&temperature=0.7&timeout=60000`

## Testing

### Running Tests

```bash
# Run all tests (unit, integration, e2e)
npm test

# Run specific test file
npm test -- src/llm/llm.test.ts

# Run checks (lint + test + build)
npm run check
```

### Acceptance Tests

The project includes acceptance tests that verify the LLM module contract with real API providers. These tests require API keys to be set as environment variables.

#### Local Development

Create a `.env` file in the project root:

```env
OPENROUTER_API_KEY=your_openrouter_api_key_here
```

**Note:** The project uses `dotenv` to load environment variables from `.env` file in acceptance tests.

Then run the acceptance tests:

```bash
npm test -- src/llm/llm.acceptance.test.ts
```

If you want to skip acceptance tests locally (they require API keys), set:

```env
SKIP_ACCEPTANCE_TESTS=true
```

Or run with environment variable:

```bash
SKIP_ACCEPTANCE_TESTS=true npm test
```

#### CI/CD Setup

In GitHub Actions, set the `OPENROUTER_API_KEY` secret to enable acceptance tests in the CI pipeline. Without the secret, acceptance tests will be skipped automatically.

### Test Coverage

- **Unit Tests**: Component logic and isolated functionality
- **Integration Tests**: Provider interfaces and mock interactions
- **E2E Tests**: Full content processing pipelines
- **Acceptance Tests**: Real API contract verification with OpenRouter

## Features

- **Robust Error Handling**: Automatic retries with exponential backoff
- **Cost Tracking**: Monitor token usage and costs across providers
- **Content Extraction**: Extract clean content from web pages
- **Session Management**: Compress conversation history to fit context windows
- **Type Safety**: Full TypeScript support with Zod validation
- **Debug Logging**: Detailed YAML logs for troubleshooting

## Recent Changes

### [0.7.3] - 2026-01-13
- **feat(agent):** support local tools injection via constructor

### [0.7.2] - 2026-01-11
- **docs:** remove AI_CONTEXT.md and update references in README and design documents

### [0.7.1] - 2026-01-11
- **ai:** add unified context and usage rules for cursor agents

## License

MIT
