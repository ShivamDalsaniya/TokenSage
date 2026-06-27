#!/usr/bin/env node
/**
 * TokenSage MCP Server
 * Reduces LLM token usage by 50%+ while preserving coding accuracy.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { zodToJsonSchema } from "zod-to-json-schema";

// Tool handlers
import { compressFileSchema, handleCompressFile, formatCompressFileOutput } from "../tools/compress-file.js";
import { compressDirectorySchema, handleCompressDirectory } from "../tools/compress-directory.js";
import { summarizeLogsSchema, handleSummarizeLogs, formatSummarizeLogsOutput } from "../tools/summarize-logs.js";
import { summarizeConversationSchema, handleSummarizeConversation, formatSummarizeConversationOutput } from "../tools/summarize-conversation.js";
import { detectDuplicatesSchema, handleDetectDuplicates, formatDetectDuplicatesOutput } from "../tools/detect-duplicates.js";
import { semanticRelevanceSchema, handleSemanticRelevance, formatSemanticRelevanceOutput } from "../tools/semantic-relevance.js";
import { contextBudgetSchema, handleContextBudget, formatContextBudgetOutput } from "../tools/context-budget.js";
import { tokenUsageReportSchema, handleTokenUsageReport, formatTokenUsageReportOutput } from "../tools/token-usage-report.js";
import { startDashboard } from "./dashboard.js";
import { DEFAULT_CONFIG } from "../config/index.js";

// ── Tool definitions ─────────────────────────────────────────────────────────

const TOOLS: Tool[] = [
  {
    name: "compress_file",
    description:
      "Analyze a source file using structural parsing. Returns purpose, imports, exports, functions, classes, and dependencies instead of full source code. Typically saves 60-90% of tokens.",
    inputSchema: zodToJsonSchema(compressFileSchema) as Tool["inputSchema"],
  },
  {
    name: "compress_directory",
    description:
      "Analyze a directory or repository. Returns architecture summary, dependency graph, file relationships, and important files. Dramatically reduces tokens needed to understand a codebase.",
    inputSchema: zodToJsonSchema(compressDirectorySchema) as Tool["inputSchema"],
  },
  {
    name: "summarize_logs",
    description:
      "Compress npm, docker, build, test, or terminal logs. Removes noise and returns status, unique errors (deduplicated), warnings, and recommended actions.",
    inputSchema: zodToJsonSchema(summarizeLogsSchema) as Tool["inputSchema"],
  },
  {
    name: "summarize_conversation",
    description:
      "Convert a long conversation into structured goals, completed tasks, pending tasks, decisions, and blockers. Preserves recent messages verbatim.",
    inputSchema: zodToJsonSchema(summarizeConversationSchema) as Tool["inputSchema"],
  },
  {
    name: "detect_duplicates",
    description:
      "Remove duplicate stack traces, tool outputs, messages, or context chunks. Uses exact hashing and fuzzy similarity. Returns unique items only.",
    inputSchema: zodToJsonSchema(detectDuplicatesSchema) as Tool["inputSchema"],
  },
  {
    name: "semantic_relevance",
    description:
      "Rank repository files by relevance to a query. Returns top-k most relevant files with reasons. Use before loading files to find what matters.",
    inputSchema: zodToJsonSchema(semanticRelevanceSchema) as Tool["inputSchema"],
  },
  {
    name: "context_budget",
    description:
      "Calculate token budget for context items. Shows original vs optimized tokens, savings per item, and recommendations for fitting within budget.",
    inputSchema: zodToJsonSchema(contextBudgetSchema) as Tool["inputSchema"],
  },
  {
    name: "token_usage_report",
    description:
      "Get analytics for token usage: current request, current session totals, all-time savings, and top token-saving tools.",
    inputSchema: zodToJsonSchema(tokenUsageReportSchema) as Tool["inputSchema"],
  },
];

// ── Server setup ─────────────────────────────────────────────────────────────

const server = new Server(
  {
    name: "token-sage",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
    instructions:
      "TokenSage reduces token usage 50%+ on coding tasks. " +
      "BEFORE reading files or exploring repos: use compress_file (single file) or compress_directory (repo/dir) instead of reading raw source. " +
      "BEFORE loading logs: use summarize_logs. " +
      "BEFORE long context tasks: use context_budget to plan token allocation. " +
      "Use semantic_relevance to find relevant files before loading them. " +
      "Use detect_duplicates to deduplicate repeated stack traces or tool outputs. " +
      "Use token_usage_report to see session savings.",
  }
);

// List tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

// Call tool
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "compress_file": {
        const input = compressFileSchema.parse(args);
        const result = await handleCompressFile(input);
        return {
          content: [{ type: "text", text: formatCompressFileOutput(result) }],
        };
      }

      case "compress_directory": {
        const input = compressDirectorySchema.parse(args);
        const result = await handleCompressDirectory(input);
        return {
          content: [
            {
              type: "text",
              text: [
                `# Directory: ${result.path}`,
                "",
                `## Architecture`,
                result.architecture,
                "",
                `## Tech Stack`,
                result.techStack.join(", ") || "Unknown",
                "",
                `## Entry Points`,
                result.entryPoints.length > 0 ? result.entryPoints.map((e) => `- ${e}`).join("\n") : "None detected",
                "",
                `## Important Files`,
                result.importantFiles.map((f) => `- \`${f.path}\` — ${f.reason}`).join("\n"),
                "",
                `## File Relationships (top 20)`,
                result.fileRelationships.slice(0, 20).map((r) => `- \`${r.from}\` → \`${r.to}\``).join("\n"),
                "",
                `## Token Savings`,
                `Original: **${result.tokens.original.toLocaleString()}** → Optimized: **${result.tokens.optimized.toLocaleString()}** (saved **${result.tokens.savedPercent}%**)`,
              ].join("\n"),
            },
          ],
        };
      }

      case "summarize_logs": {
        const input = summarizeLogsSchema.parse(args);
        const result = handleSummarizeLogs(input);
        return {
          content: [{ type: "text", text: formatSummarizeLogsOutput(result) }],
        };
      }

      case "summarize_conversation": {
        const input = summarizeConversationSchema.parse(args);
        const result = handleSummarizeConversation(input);
        return {
          content: [{ type: "text", text: formatSummarizeConversationOutput(result) }],
        };
      }

      case "detect_duplicates": {
        const input = detectDuplicatesSchema.parse(args);
        const result = handleDetectDuplicates(input);
        return {
          content: [{ type: "text", text: formatDetectDuplicatesOutput(result) }],
        };
      }

      case "semantic_relevance": {
        const input = semanticRelevanceSchema.parse(args);
        const result = await handleSemanticRelevance(input);
        return {
          content: [{ type: "text", text: formatSemanticRelevanceOutput(result) }],
        };
      }

      case "context_budget": {
        const input = contextBudgetSchema.parse(args);
        const result = handleContextBudget(input);
        return {
          content: [{ type: "text", text: formatContextBudgetOutput(result) }],
        };
      }

      case "token_usage_report": {
        const input = tokenUsageReportSchema.parse(args);
        const result = handleTokenUsageReport(input);
        return {
          content: [{ type: "text", text: formatTokenUsageReportOutput(result) }],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text", text: `Error: ${message}` }],
      isError: true,
    };
  }
});

// ── Start ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Start dashboard if enabled
  if (DEFAULT_CONFIG.dashboard.enabled) {
    await startDashboard(DEFAULT_CONFIG.dashboard.port);
    // Register actual dashboard port with daemon so session-start hook can find it
    fetch("http://localhost:7099/dashboard/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectPath: DEFAULT_CONFIG.dashboard.projectPath,
        port: DEFAULT_CONFIG.dashboard.port,
      }),
      signal: AbortSignal.timeout(2000),
    }).catch(() => { /* daemon may not be running yet, hook has fallback */ });
  }

  // Start MCP stdio server
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[TokenSage] MCP server ready. Tools:", TOOLS.map((t) => t.name).join(", "));
}

main().catch((err) => {
  console.error("[TokenSage] Fatal error:", err);
  process.exit(1);
});
