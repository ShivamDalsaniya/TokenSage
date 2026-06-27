# TokenSage Integration Guide

## Claude Code

### Method 1: Global (all projects)

Edit `~/.claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "token-sage": {
      "command": "node",
      "args": ["/absolute/path/to/token-sage/dist/server/index.js"]
    }
  }
}
```

Restart Claude Code. Verify with: `/mcp` → should show `token-sage` connected.

### Method 2: Project-level

Create `.claude/mcp.json` in your project root with the same JSON.

### Verification

In Claude Code, run:
```
Use token_usage_report to show current session stats
```

---

## Cursor

Create `.cursor/mcp.json` in your project root:

```json
{
  "mcpServers": {
    "token-sage": {
      "command": "node",
      "args": ["/absolute/path/to/token-sage/dist/server/index.js"]
    }
  }
}
```

Restart Cursor. Check the MCP panel in settings.

---

## Codex CLI

```bash
# Add the server
codex mcp add token-sage node /absolute/path/to/token-sage/dist/server/index.js

# Verify
codex mcp list
```

---

## Serena

In Serena's MCP configuration file:

```json
{
  "servers": [
    {
      "name": "token-sage",
      "command": "node",
      "args": ["/absolute/path/to/token-sage/dist/server/index.js"]
    }
  ]
}
```

---

## Caveman (Claude Code with Caveman mode)

Same as Claude Code — add to `~/.claude/claude_desktop_config.json`.

TokenSage is designed to work alongside Caveman mode. Both reduce token usage through different mechanisms:
- **Caveman**: Compresses the AI's output (responses)
- **TokenSage**: Compresses the AI's input (context, files, logs)

Together they achieve maximum token reduction.

---

## Cline / Roo Code

In VSCode settings or Cline's MCP configuration:

```json
{
  "cline.mcpServers": {
    "token-sage": {
      "command": "node",
      "args": ["/absolute/path/to/token-sage/dist/server/index.js"]
    }
  }
}
```

---

## Usage Patterns

### Before reading a large file

```
Use compress_file on /path/to/large-file.ts
```

Instead of reading the full 500-line file, get a 50-token structural summary.

### Before exploring a repository

```
Use compress_directory on /path/to/repo with maxFiles=50
```

Understand the entire architecture in ~200 tokens.

### When paste has logs

```
Use summarize_logs with the following output: [paste logs]
```

Turn 5000 tokens of npm error output into 200 tokens of actionable summary.

### Finding relevant files

```
Use semantic_relevance with query="authentication JWT" directory="/src"
```

Know exactly which 5 files to read instead of loading 50.

### Before a long session

```
Use context_budget with items=[...] budgetTokens=8000
```

Understand what fits and what needs compression.
