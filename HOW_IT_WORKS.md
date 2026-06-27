# TokenSage — How It Works

TokenSage is an **MCP (Model Context Protocol) server** that plugs into Claude, Cursor, Cline, Codex, and other AI coding tools. It intercepts context before it reaches the LLM and compresses it — reducing token consumption by **50–95%** while preserving enough structure for the model to understand code, logs, and conversations.

---

## The Core Problem

When an AI reads your codebase, it reads **everything** — full source files, raw logs, entire conversations. A single large TypeScript file can consume 8,000–15,000 tokens. A noisy build log can consume 5,000. Multiply that across a debugging session and you burn context window fast, hit rate limits, and pay high API costs.

TokenSage solves this by giving the model a **compressed structural view** instead of raw content.

---

## Architecture Overview

```
AI Tool (Claude / Cursor / Cline)
        │
        │  calls MCP tool
        ▼
  MCP Server (stdio transport)
  src/server/index.ts
        │
        ├── compress_file        → Code Parser + Code Compressor
        ├── compress_directory   → Scans dir tree, builds dependency graph
        ├── summarize_logs       → Log Compressor
        ├── summarize_conversation
        ├── detect_duplicates    → Hash + Jaccard fuzzy matching
        ├── semantic_relevance   → Query-based file scoring
        ├── context_budget       → Token planning
        └── token_usage_report   → Session analytics
        │
        ▼
  Dashboard (Fastify HTTP)
  http://localhost:7777
  Live analytics: savings, tool usage, session stats
```

The server speaks MCP over stdio. When Claude calls a tool (e.g., `compress_file`), the server processes the file locally — no external API calls — and returns a compressed JSON summary. Claude never sees the full source.

---

## 8 Tools and What They Do

### `compress_file`
**Savings: 60–90%**

Parses a single source file and extracts only its skeleton:
- File purpose (auto-inferred from name + comments)
- All imports (module + specifiers, not full trees)
- All exports (names only)
- All symbols: functions, classes, interfaces, types, enums — with name, kind, signature, exported flag, line numbers
- No implementation bodies

A 5,000-line Express server (~10,000 tokens) becomes a 20-symbol summary (~400 tokens).

Supports: TypeScript, JavaScript, Python, Go, Rust, Java, Ruby, PHP, Kotlin, Swift, C/C++

### `compress_directory`
**Savings: 70–95%**

Analyzes an entire repo or directory:
- Detects tech stack (frameworks, languages, tooling)
- Identifies entry points and architectural patterns
- Builds a dependency graph between files
- Flags most important files by symbol count + imports
- Skips `node_modules`, `.git`, `dist`, build artifacts

Returns an architecture summary (~600 tokens) instead of requiring the model to read every file.

### `summarize_logs`
**Savings: 80–95%**

Compresses npm, docker, test runner, and terminal logs:
- Strips timestamps, memory addresses, line numbers
- Deduplicates repeated errors (exact + fuzzy)
- Collapses multi-frame stack traces (keeps top 5)
- Detects status: success / warning / error
- Generates recommended actions (e.g., `ECONNREFUSED` → "check service is running")

1,000-token noisy log → 100-token actionable summary.

### `summarize_conversation`
**Savings: 60–85%**

Compresses long chat history into structured state:
- Goals stated
- Tasks completed
- Tasks pending
- Decisions made
- Blockers
- File paths and code blocks referenced
- Optionally preserves last N messages verbatim

### `detect_duplicates`
**Savings: 50–90%**

Input: array of strings (errors, stack traces, log lines).  
Returns only unique items, groups duplicates with counts.

Two-pass deduplication:
1. Exact hash match after normalization (strip timestamps, addresses, line numbers)
2. Jaccard similarity for near-duplicates (~80% similar = same error)

### `semantic_relevance`
**Savings: 70–95%**

"Which files relate to authentication?"

Scans up to 500 files, scores each by:
- Query term frequency in content
- Export names matching query terms
- File path matching query terms

Returns top-k files with relevance reasons. Claude loads only those — skips everything else.

### `context_budget`
**Planning tool — no direct savings on call itself**

Input: list of context items with priorities (critical / high / medium / low) + token budget.

Estimates post-compression size per item:
- critical → 90% retained
- high → 60% retained
- medium → 30% retained
- low → 10% retained

Returns: fits in budget / items to remove / recommendation to increase budget.

### `token_usage_report`
**Analytics tool**

Session stats: total requests, original vs optimized tokens, percent saved, top 5 tools by savings. Cumulative across sessions with optional reset.

---

## How Tokens Are Counted

Uses `gpt-tokenizer` with `cl100k_base` encoding — the same encoding used by GPT-4 and Claude. Accurate to ±1% on typical code and English text. Fallback: 4 chars per token estimate.

Every tool call records:
- Original token count (what the model would have consumed)
- Optimized token count (what it actually consumed)
- Saved tokens and percentage
- Tool name and timestamp

All tracked in a singleton in-memory `SessionTracker`.

---

## Code Parser Internals

`src/parsers/code-parser.ts` — regex-based, no native dependencies, cross-platform.

For each file:
1. Detect language from extension
2. Run language-specific regex patterns to extract:
   - Import statements → `Import { source, specifiers, isDefault, isSideEffect }`
   - Function/method declarations → signature, async, exported, line range
   - Class/interface/type/enum declarations → name, kind, exported
   - Top-level doc comments
3. Infer file purpose from filename patterns + first-line comments
   - e.g., `auth.service.ts` → "authentication service"
   - e.g., `*.test.ts` → "test file"
4. Deduplicate imports by source

No AST libraries. Pure regex, works on partial or broken code.

---

## Token Savings: Real Example

**Debugging a TypeScript repo without TokenSage:**
| Step | Tokens Used |
|------|------------|
| Read `src/server/index.ts` (full) | 8,000 |
| Read `src/middleware/auth.ts` (full) | 5,000 |
| Manually describe dependency graph | 2,000 |
| **Total** | **15,000** |

**Same task with TokenSage:**
| Step | Tokens Used | Saved |
|------|------------|-------|
| `compress_file` on index.ts | 400 | 95% |
| `compress_directory` on src/ | 600 | 88% |
| `semantic_relevance` → auth error | 200 | 90% |
| **Total** | **1,200** | **92%** |

---

## How the LLM Learns to Use It

The MCP server embeds instructions that are sent to the model at connection time:

> "BEFORE reading files or exploring repos: use `compress_file` (single file) or `compress_directory` (repo/dir) instead of reading raw source. BEFORE loading logs: use `summarize_logs`. BEFORE long context tasks: use `context_budget` to plan token allocation."

Claude follows these as part of its context, so it calls compress tools first without being explicitly told each time.

---

## Dashboard

Fastify HTTP server on `localhost:7777` (or a hash-derived port 7100–7999 per project).

Shows:
- Session token savings with percentage
- Per-tool usage counts and savings breakdown
- Top 5 token-saving tools
- All-time cumulative savings
- Dark theme single-page UI

---

## Installation

Add to `~/.claude/claude_desktop_config.json` (or equivalent for your AI tool):

```json
{
  "mcpServers": {
    "token-sage": {
      "command": "node",
      "args": ["/path/to/token-sage/dist/server/index.js"]
    }
  }
}
```

Build from source:

```bash
npm install
npm run build   # TypeScript → dist/
npm start       # starts MCP server on stdio
```

### Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `DASHBOARD_PORT` | hash of project path | Web UI port |
| `DASHBOARD_HOST` | localhost | Bind address |
| `DASHBOARD_ENABLED` | true | Enable/disable web UI |
| `MAX_FILE_SIZE_BYTES` | 500,000 | Skip files larger than this |
| `LOG_LEVEL` | info | Logging verbosity |

---

## Savings Summary

| Tool | Typical Savings | Best For |
|------|----------------|----------|
| `compress_file` | 60–90% | Understanding single file structure |
| `compress_directory` | 70–95% | Repo-wide architecture exploration |
| `summarize_logs` | 80–95% | Noisy build/test/docker output |
| `summarize_conversation` | 60–85% | Long chat history compression |
| `detect_duplicates` | 50–90% | Repeated errors and stack traces |
| `semantic_relevance` | 70–95% | Loading only relevant files |
| `context_budget` | N/A | Token planning before long tasks |
| `token_usage_report` | N/A | Session analytics |

**Typical session savings: 70–92%.**
