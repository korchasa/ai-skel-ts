# Requirements

## Functional Requirements

### LLM Integration (FR-LLM)
- **FR-LLM-1**: Support multiple providers via `ModelURI` class with unified syntax (`protocol://provider/model?params`)
- **FR-LLM-2**: Implement automatic retry with exponential backoff (max 3 attempts)
- **FR-LLM-3**: Support self-correction on JSON parsing/Zod validation failures
- **FR-LLM-4**: Provide structured generation with schema validation and conversational output
- **FR-LLM-5**: Mask sensitive parameters (apiKey) in logging output
- **FR-LLM-6**: Support provider-specific environment variables (`<PROVIDER>_API_KEY`) as API key fallback
- **FR-LLM-7**: Support suppression of Vercel AI SDK internal warnings via `logVercelWarnings=false` URI parameter
- **FR-LLM-8**: Support tool calling and multi-step execution
- **FR-LLM-9**: Return all generated messages (`newMessages`) and detailed execution steps (`steps`) for observability
- **FR-LLM-10**: Support `toolChoice` parameter to control tool calling behavior
- **FR-LLM-11**: Ensure `AbortController.abort()` calls are protected from listener exceptions to prevent process crashes

### Agent (FR-AGENT)
- **FR-AGENT-1**: Maintain stateful conversation history (`ModelMessage[]`)
- **FR-AGENT-2**: Integrate with MCP clients for tool discovery and execution
- **FR-AGENT-3**: Use history compactor to manage context length
- **FR-AGENT-4**: Support structured logging of agent actions
- **FR-AGENT-5**: Support local tool definition and execution injected directly into the agent
- **FR-AGENT-6**: Provide `run()` method for full access to execution results and `chat()` for simple text output
- **FR-AGENT-7**: Automatically preserve all intermediate tool calls and results in conversation history

### MCP Integration (FR-MCP)
- **FR-MCP-1**: Connect to MCP servers via stdio or SSE
- **FR-MCP-2**: Convert MCP tools to AI SDK compatible formats using `jsonSchema`
- **FR-MCP-3**: Prefix tool names to prevent collisions across multiple servers

### Local Content Processing (FR-LOCAL-CONTENT)
- **FR-LOCAL-CONTENT-1**: Extract clean content from HTML using Mozilla Readability
- **FR-LOCAL-CONTENT-2**: Provide cheerio fallback for Readability failures
- **FR-LOCAL-CONTENT-3**: Extract comprehensive metadata (title, description, author, date, etc.)
- **FR-LOCAL-CONTENT-4**: Sanitize HTML to remove script/style elements
- **FR-LOCAL-CONTENT-5**: Support configurable content length limits
- **FR-LOCAL-CONTENT-6**: Normalize whitespace and handle empty/null fields
- **FR-LOCAL-CONTENT-7**: Suppress irrelevant CSS parsing warnings from JSDOM in stderr

### Jina Scraper (FR-JINA)
- **FR-JINA-1**: Support web search with advanced filtering (site, filetype, intitle, loc)
- **FR-JINA-2**: Provide URL scraping with multiple output formats (markdown, html, text, content)
- **FR-JINA-3**: Support advanced scraping options (CSS selectors, timing controls, image/link retention)
- **FR-JINA-4**: Use separate API endpoints for search (`s.jina.ai`) and reader (`r.jina.ai`)
- **FR-JINA-5**: Provide Bearer token authentication with environment variable fallback
- **FR-JINA-6**: Support markdown formatting options and image alt-text generation

### Brave Search (FR-BRAVE)
- **FR-BRAVE-1**: Support web search with advanced filtering (site, filetype, intitle, freshness)
- **FR-BRAVE-2**: Provide configurable adult content filtering (off/moderate/strict)
- **FR-BRAVE-3**: Include rich metadata in results (thumbnails, profiles, page age)
- **FR-BRAVE-4**: Support country/language preferences and spellcheck
- **FR-BRAVE-5**: Use Bearer token authentication with environment variable fallback
- **FR-BRAVE-6**: Provide debug logging with sensitive header masking
- **FR-BRAVE-7**: Implement automatic 429 (Rate Limit) retry (2 attempts, 1s delay)
- **FR-BRAVE-8**: Support batch search (`searchMany`) with configurable RPS rate limiting

### Session Management (FR-SESSION)
- **FR-SESSION-1**: Compress message history to fit context windows
- **FR-SESSION-2**: Preserve tool-call/tool-result pairing integrity
- **FR-SESSION-3**: Support LLM-powered summarization for history compaction
- **FR-SESSION-4**: Provide simple trimming as fallback option
- **FR-SESSION-5**: Estimate message weight by JSON representation length

### Cost Tracking (FR-COST)
- **FR-COST-1**: Track cumulative token usage (input/output/total)
- **FR-COST-2**: Calculate and accumulate USD costs
- **FR-COST-3**: Provide singleton instance for global cost tracking
- **FR-COST-4**: Generate detailed cost reports per request

### Logging (FR-LOG)
- **FR-LOG-1**: Support structured YAML logging for LLM interactions
- **FR-LOG-2**: Include request/response metadata and timing
- **FR-LOG-3**: Provide configurable log levels and contexts
- **FR-LOG-4**: Support debug file output for troubleshooting
- **FR-LOG-5**: Provide string-to-level logger factory with warn + fallback to `debug`
- **FR-LOG-6**: Provide detailed console debug logging for LLM requests/responses with `runId`, request identifier, and file references
- **FR-LOG-7**: Sanitize non-serializable objects (Errors, circular references) in YAML logs to prevent crashes

### Run Context (FR-RUN)
- **FR-RUN-1**: Provide `createRunContext({ logger, debugDir, runId? })`
- **FR-RUN-2**: Require `debugDir` input; use it as the run debug root
- **FR-RUN-3**: Default `runId` is reverse-sortable ISO timestamp with micro suffix
- **FR-RUN-4**: Attach working `saveDebugFile` by default
- **FR-RUN-5**: Support saving complex objects with automatic sanitization (Errors, Buffers, Circular references)

### AI Agent Support (FR-AI)
- **FR-AI-1**: Provide a unified architectural context for AI agents within the `README.md`
- **FR-AI-2**: Include explicit usage rules and anti-patterns for AI-assisted development in `README.md`
- **FR-AI-3**: Provide reference code examples specifically for AI context windows in `README.md`

## Non-Functional Requirements

### Performance (NFR-PERF)
- **NFR-PERF-1**: Process HTML content < 1MB in < 5 seconds
- **NFR-PERF-2**: LLM requests complete within provider timeout limits
- **NFR-PERF-3**: Session compaction scales linearly with message count
- **NFR-PERF-4**: Memory usage proportional to processed content size

### Reliability (NFR-REL)
- **NFR-REL-1**: Graceful degradation on LLM provider failures
- **NFR-REL-2**: 99% success rate for content extraction from valid HTML
- **NFR-REL-3**: No data loss during session compaction
- **NFR-REL-4**: Automatic recovery from transient network errors

### Security (NFR-SEC)
- **NFR-SEC-1**: No sensitive data in logs (apiKey masking)
- **NFR-SEC-2**: HTML structure validation and noisy element removal
- **NFR-SEC-3**: No arbitrary code execution from processed content
- **NFR-SEC-4**: Secure handling of malformed input data

### Usability (NFR-USAB)
- **NFR-USAB-1**: TypeScript-first API with full type safety
- **NFR-USAB-2**: Comprehensive JSDoc documentation
- **NFR-USAB-3**: Intuitive parameter naming and structure
- **NFR-USAB-4**: Clear error messages with actionable guidance
- **NFR-USAB-5**: Public fetcher method names should be generic (e.g., `fetch`, `fetchFromURL`) when they return complex objects, to avoid misleading names that imply a single data format.

### Compatibility (NFR-COMPAT)
- **NFR-COMPAT-1**: Node.js runtime support (primary target, ≥20.0.0)
- **NFR-COMPAT-2**: ESM module system with TypeScript declarations
- **NFR-COMPAT-3**: npm package distribution with JSR (jsr.io)
- **NFR-COMPAT-4**: ES2022+ JavaScript features
- **NFR-COMPAT-5**: Support JSR publication for Deno/Web ecosystem compatibility with automatic version synchronization from `package.json` to `deno.json` in CI.

### Maintainability (NFR-MAINT)
- **NFR-MAINT-1**: Modular architecture with clear separation of concerns
- **NFR-MAINT-2**: Comprehensive test coverage (>80%)
- **NFR-MAINT-3**: Consistent code formatting and linting
- **NFR-MAINT-4**: Semantic versioning with breaking change indicators
- **NFR-MAINT-5**: Automation tasks must be defined in `deno.json` with one script per task in `scripts/`