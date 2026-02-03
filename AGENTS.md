# YOU MUST

- STRICTLY FOLLOW YOUR ROLE.
- START PROCESSING USER INPUT BY READING THE DOCUMENTATION IN `./documents` AT BEGIN OF THE TASK.
- FINISH PROCESSING USER INPUT BY RUNNING `deno task check` AND FIXING ALL FOUND ERRORS, WARNINGS, AND LINTING PROBLEMS.
- YOU WILL BE REWARDED FOR FOLLOWING INSTRUCTIONS AND GOOD ANSWERS.
- DO NOT USE STUBS IN THE CODE, AS I HAVE NO FINGERS, AND THIS IS A TRAUMA.
- ALWAYS INDEPENDENTLY CHECK HYPOTHESES.
- ALWAYS CHECK THE CHANGES MADE BY RUNNING THE APPROPRIATE TESTS OR SCRIPTS.
- ALWAYS KEEP THE PROJECT IN WORKING CONDITION: WITHOUT ERRORS, WARNINGS, AND PROBLEMS IN THE FORMATER AND LINTER OUTPUT
- STRICTLY FOLLOW TDD RULES.
- ANSWER IN LANGUAGE OF THE USER QUERY.
- WRITE ALL DOCUMENTATION IN ENGLISH IN INFORMATIONAL STYLE.
- IF YOU SEE CONTRADICTIONS IN THE REQUEST OR CONTEXT, SAY ABOUT THEM, ASK THE NECESSARY QUESTIONS AND STOP.
- DO NOT USE STUBS, "CRUTCHES", DECEPTIONS, OR OTHER PREMODS TO BYPASS CHECKS.

## REMEMBER

AFTER EACH MEMORY RESET, YOU START COMPLETELY FROM SCRATCH. DOCUMENTATION IS THE ONLY LINK TO PREVIOUS WORK. IT MUST BE MAINTAINED WITH ACCURACY AND CLARITY, AS EFFECTIVENESS ENTIRELY DEPENDS ON ITS ACCURACY.

# Agent Reference: AI Skeleton Tools (ai-skel-ts)

## Tooling Stack

- **Languages**: TypeScript (ES2022), JavaScript (ESM).
- **Runtimes**: Node.js (>=20.0.0), Deno 2.x (for task orchestration).
- **Package Managers**: npm (primary), hosted on GitHub Packages.
- **Build Tool**: `tsup` (generates ESM bundles with `.d.ts` in `dist/`).
- **Testing**: `vitest` (unit, integration, e2e, and provider acceptance tests).
- **Linting**: `eslint` with `@typescript-eslint`.
- **Key Libraries**:
  - `ai`: Vercel AI SDK (core LLM interaction).
  - `@modelcontextprotocol/sdk`: MCP integration.
  - `@mozilla/readability`: Content extraction.
  - `zod`: Schema validation.
  - `jsdom` & `cheerio`: HTML parsing and sanitization.
  - `metascraper`: Metadata extraction.

## Development Commands

- `deno task check`: Runs linting, tests, and build (alias for `npm run check`).
- `deno task test`: Runs all tests (unit, integration, e2e).
- `deno task build`: Builds the project using `tsup`.
- `deno task release`: Performs version release using `standard-version`.
- `npm run lint`: Runs ESLint on `src/`.
- `npm test -- <path>`: Runs specific tests via Vitest.

## Architecture

The project follows a modular "skeleton" architecture designed for AI agent foundations.

- `src/agent/`: Stateful conversation runner with MCP and local tool support.
- `src/llm/`: Provider-agnostic LLM interface using `ModelURI` (chat://provider/model). Supports self-correction and retry logic.
- `src/fetchers/`: Content acquisition strategies.
  - `local-fetcher/`: High-performance extraction using Readability.
  - `jina-fetcher/`: Integration with Jina Reader/Search APIs.
  - `brave-fetcher/`: Integration with Brave Search API.
- `src/run-context/`: Centralized context for metadata, logging, and debug artifact management.
- `src/cost-tracker/`: Singleton for tracking token usage and costs across all requests.
- `src/logger/`: Structured YAML logging for observability and detailed console tracing.
- `src/llm-session-compactor/`: Manages context windows via summarization or trimming.
- `src/mcp/`: Bridge between Model Context Protocol and Vercel AI SDK tools.
- `mod.ts`: Main entry point for the library.

## Key Decisions

- **Observability over everything**: Every LLM call and major operation logs detailed YAML artifacts to a `debugDir` managed by `RunContext`.
- **URI-based Configuration**: LLM models are identified by URIs (`chat://openai/gpt-4o`), allowing easy provider switching and parameter tuning via query strings.
- **Resilient Generation**: The `LlmRequester` handles retries, timeouts, and automatically feeds schema validation errors back to the LLM for self-correction.
- **Node/Deno Hybrid**: Uses Node.js for the core library logic (ensuring compatibility with the vast npm ecosystem) and Deno for clean, scriptable dev-ops tasks.
- **TDD Focus**: Extensive test suite covering unit, integration, and live API acceptance.
- **Tool Namespacing**: MCP tools are automatically prefixed with their server name to prevent collisions.
