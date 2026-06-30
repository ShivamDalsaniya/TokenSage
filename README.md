<p align="center">
  <img src="src/public/tokensage-logo.webp" alt="TokenSage" width="96" />
</p>

<h1 align="center">TokenSage</h1>

<p align="center">
  <strong>MCP server that slashes LLM token usage by 50–99% — transparently, in real time.</strong><br/>
  Every file read, bash call, and prompt is compressed before the LLM ever sees it. Zero workflow changes.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/token-sage"><img src="https://img.shields.io/npm/v/token-sage?color=10b981&label=npm&style=flat-square" alt="npm version"/></a>
  <a href="https://github.com/ShivamDalsaniya/TokenSage/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-3b82f6?style=flat-square" alt="MIT License"/></a>
  <img src="https://img.shields.io/badge/node-%3E%3D22-brightgreen?style=flat-square" alt="Node 22+"/>
  <img src="https://img.shields.io/badge/MCP-compatible-10b981?style=flat-square" alt="MCP compatible"/>
</p>

<p align="center">
  Works with <strong>Claude Code</strong> · <strong>Cursor</strong> · <strong>Codex CLI</strong> · <strong>Cline</strong> · <strong>Roo Code</strong> · <strong>Gemini CLI</strong> · <strong>OpenCode</strong>
</p>

---

## What is TokenSage?

TokenSage is a [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server that sits between your AI client and the LLM. It intercepts every file read, bash command, and conversation turn — compressing the content before the model sees it — then tracks exactly how many tokens were saved using **real encoding**, not ratios.

> **167,000 tokens saved in a single session — measured, not estimated.**

Token counts use **gpt-tokenizer (cl100k_base)** on actual before/after text. The savings numbers you see are real measurements from real encoding runs.

## Architecture

![TokenSage Architecture](assets/TokenSageInfo.webp)

## Quick Start

The fastest way to get TokenSage running — no installation required:

```bash
npx token-sage
```

Dashboard opens automatically at **http://localhost:7450**

**Global install (faster startup):**
```bash
npm install -g token-sage
token-sage
```

**From source:**
```bash
git clone https://github.com/ShivamDalsaniya/TokenSage.git
cd TokenSage
npm install && npm run build
npm start
```

---

## How It Works

TokenSage compresses context through two independent layers. Use one or both.

### Layer 1: Hooks (Automatic, Zero Config)

Hooks are shell commands registered with your AI client. Claude Code calls them before/after every tool use. You never change a prompt.

| Hook | Trigger | What it does | Typical savings |
|------|---------|--------------|----------------|
| `auto_compress_read` | Before every `Read` | Returns a structural skeleton (symbols, imports, exports) instead of full source | 50–99% |
| `post_bash` | After every `Bash` | Trims verbose stdout — keeps errors, strips noise | 60–80% |
| `edit_operation` | After `Write` / `Edit` | Records diff size vs full file write for analytics | Analytics |
| `user_prompt` | Before each prompt | Compresses large code blocks inline before they hit the context window | 40–70% |

**Supported languages for structural compression:**
TypeScript · JavaScript · Python · Go · Rust · Java · C/C++ · C# · Ruby · PHP · Swift · Kotlin · Scala · Vue · Svelte

### Layer 2: MCP Tools (Explicit)

Call these directly inside Claude when you want deeper, targeted compression on specific files or a long conversation.

| Tool | What it does | Typical savings |
|------|-------------|----------------|
| `compress_file` | Source code → purpose + symbols + imports + exports skeleton | 60–90% |
| `compress_directory` | Repo → architecture + dependency graph + key files summary | 70–95% |
| `summarize_logs` | Raw logs → status + unique errors + action summary | 80–95% |
| `summarize_conversation` | Long chat → goals + tasks + decisions + blockers | 60–85% |
| `detect_duplicates` | Remove repeated stack traces and duplicate chunks from context | 50–90% |
| `semantic_relevance` | Rank files by query relevance — load only what actually matters | 70–95% |
| `context_budget` | Calculate token cost and fit context within a model's budget | Analytics |
| `token_usage_report` | Full session + all-time savings report | Analytics |

---

## Live Dashboard

![TokenSage Dashboard](src/public/dashboard-img.png)

The real-time dashboard at **http://localhost:7450** shows:

- **Tokens saved** — live count for the current session
- **Optimization %** — average reduction across all tool calls
- **Requests** — total compressions this session
- **Time saved** — estimated at 300 tokens/min reading speed
- **Tool effectiveness** — per-tool breakdown with call counts and share
- **Recent activity** — live feed of every file compressed with before/after sizes

The port is **auto-computed per project** (range 7450–7999, derived from project path hash), so multiple projects each get their own dashboard without conflicts.

---

## Installation

### Claude Code

Add to `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "token-sage": {
      "command": "npx",
      "args": ["token-sage"]
    }
  },
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Read",
        "hooks": [
          { "type": "command", "command": "npx token-sage hook:pre-read" }
        ]
      },
      {
        "matcher": "Write|Edit",
        "hooks": [
          { "type": "command", "command": "npx token-sage hook:pre-write" }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          { "type": "command", "command": "npx token-sage hook:post-bash" }
        ]
      }
    ],
    "SessionStart": [
      {
        "hooks": [
          { "type": "command", "command": "npx token-sage hook:session-start" }
        ]
      }
    ]
  }
}
```

Restart Claude Code. The `auto_compress_read` hook fires on every file read from that point on — no other changes needed.

### Cursor

Add to `.cursor/mcp.json` in your project root:

```json
{
  "mcpServers": {
    "token-sage": {
      "command": "npx",
      "args": ["token-sage"]
    }
  }
}
```

### Other Clients

**Codex CLI:**
```bash
codex mcp add token-sage npx token-sage
```

**Gemini CLI:**
```bash
gemini mcp add token-sage -- npx token-sage
```

**Cline / Roo Code:**
In the MCP settings panel, add a new server with command `npx` and args `token-sage`.

**Any MCP-compatible client:**
Point it at `npx token-sage`. The server speaks standard MCP over stdio.

---

## Token Counting — Real Data, Not Estimates

Token counts are measured using **gpt-tokenizer** (`cl100k_base` encoding) on actual before/after text — the same tokenizer used by GPT-4 and closely matching Claude's tokenization:

```typescript
// src/analytics/token-counter.ts
import { encode } from 'gpt-tokenizer';

export function countTokens(text: string): number {
  return encode(text).length; // real encoding, not character ratios
}
```

Every compression hook runs `countTokens(original)` and `countTokens(compressed)`, stores both values, and reports the difference. The dashboard shows these real measurements — not estimates, not heuristics.

---

## Configuration

All settings can be overridden via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `DASHBOARD_PORT` | `7450` | Dashboard HTTP port (auto-computed per project if unset) |
| `DASHBOARD_HOST` | `localhost` | Dashboard bind host |
| `DASHBOARD_ENABLED` | `true` | Enable or disable the dashboard server |
| `TOKENSAGE_NO_COMPRESS` | — | Set to `1` to disable auto-compression globally |
| `TOKENSAGE_COMPRESS_THRESHOLD` | `100` | Minimum lines before compressing a file |
| `TOKENSAGE_MIN_SAVINGS_PCT` | `15` | Minimum savings % required before blocking a read |
| `LOG_LEVEL` | `info` | Logging verbosity (`debug`, `info`, `warn`, `error`) |
| `MAX_FILE_SIZE_BYTES` | `512000` | Maximum file size considered for compression (512 KB) |

---

## Development

```bash
npm run dev          # Run with tsx — no build step needed
npm run build        # Compile TypeScript to dist/
npm test             # Run test suite (83 tests)
npm run test:watch   # Watch mode for TDD
npm run lint         # ESLint
npm run typecheck    # tsc --noEmit — zero errors enforced
```

### Project Structure

```
src/
├── server/
│   ├── index.ts              # MCP stdio server + tool registration
│   └── dashboard.ts          # Fastify web dashboard (real-time SSE)
├── hooks/
│   ├── pre-read.ts           # Intercepts Read — compresses large code files
│   ├── pre-write.ts          # Tracks write/edit operations
│   ├── post-bash.ts          # Trims verbose bash output
│   ├── post-tool-edit.ts     # Post-edit diff tracking
│   ├── user-prompt.ts        # Compresses prompts with large code blocks
│   └── session-start.ts      # Registers session with daemon
├── tools/
│   ├── compress-file.ts
│   ├── compress-directory.ts
│   ├── summarize-logs.ts
│   ├── summarize-conversation.ts
│   ├── detect-duplicates.ts
│   ├── semantic-relevance.ts
│   ├── context-budget.ts
│   └── token-usage-report.ts
├── compression/
│   ├── code-compressor.ts    # File → structural skeleton (multi-language)
│   └── log-compressor.ts     # Logs → deduplicated summary
├── analytics/
│   ├── token-counter.ts      # gpt-tokenizer cl100k_base real counting
│   └── session-tracker.ts    # Per-session stats accumulator
├── parsers/
│   ├── code-parser.ts        # Multi-language parser (tree-sitter)
│   └── languages/            # Per-language grammars: TS, JS, Python, Go, Rust…
├── daemon/
│   ├── index.ts              # Background daemon for cross-session tracking
│   ├── project-registry.ts   # Per-project port assignment (7450–7999)
│   └── session-manager.ts    # Session registry with 48h auto-expire
└── config/
    └── index.ts              # Configuration + env var resolution
```

---

## Contributing

Pull requests welcome. Before submitting:

```bash
npm test          # All 83 tests must pass
npm run typecheck # Zero TypeScript errors
npm run lint      # Zero lint warnings
```

Open an issue first for large changes. Keep PRs focused — one feature or fix per PR.

---

## License

MIT — © 2025 Shivam Dalsaniya
