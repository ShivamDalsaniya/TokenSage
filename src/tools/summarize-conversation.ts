import { z } from "zod";
import { calculateSavings } from "../analytics/token-counter.js";
import { sessionTracker } from "../analytics/session-tracker.js";
import type { CompressedConversation, ConversationMessage } from "../types/index.js";

export const summarizeConversationSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant", "system"]),
        content: z.string(),
        timestamp: z.string().optional(),
      })
    )
    .describe("Array of conversation messages to compress"),
  preserveLastN: z
    .number()
    .int()
    .min(0)
    .max(20)
    .default(3)
    .describe("Number of recent messages to preserve verbatim"),
});

export type SummarizeConversationInput = z.infer<typeof summarizeConversationSchema>;

// ── Extraction helpers ───────────────────────────────────────────────────────

function extractGoals(messages: ConversationMessage[]): string[] {
  const goals: string[] = [];
  const goalPatterns = [
    /(?:^|\n)(?:goal|objective|task|need|want|trying|please|could you|can you)[:\s]+(.+?)(?:\n|$)/gi,
    /(?:^|\n)(?:i want to|i need to|i'm trying to|help me)[:\s]+(.+?)(?:\n|$)/gi,
  ];

  for (const msg of messages.filter((m) => m.role === "user")) {
    for (const pattern of goalPatterns) {
      const matches = msg.content.matchAll(pattern);
      for (const m of matches) {
        const goal = m[1]?.trim();
        if (goal && goal.length > 10 && goal.length < 200) {
          goals.push(goal);
        }
      }
    }
  }

  return [...new Set(goals)].slice(0, 8);
}

function extractCompletedTasks(messages: ConversationMessage[]): string[] {
  const tasks: string[] = [];
  const completionPatterns = [
    /(?:^|\n)(?:✓|✅|done|completed?|finished?|created?|added?|fixed?|updated?)[:\s]+(.+?)(?:\n|$)/gi,
    /(?:^|\n)(?:i've? (?:created?|added?|fixed?|updated?|implemented?))[:\s]+(.+?)(?:\n|$)/gi,
    /(?:^|\n)(?:successfully (?:created?|added?|fixed?|updated?))[:\s]+(.+?)(?:\n|$)/gi,
  ];

  for (const msg of messages.filter((m) => m.role === "assistant")) {
    for (const pattern of completionPatterns) {
      const matches = msg.content.matchAll(pattern);
      for (const m of matches) {
        const task = m[1]?.trim();
        if (task && task.length > 5 && task.length < 200) {
          tasks.push(task);
        }
      }
    }
  }

  return [...new Set(tasks)].slice(0, 10);
}

function extractPendingTasks(messages: ConversationMessage[]): string[] {
  const tasks: string[] = [];
  const pendingPatterns = [
    /(?:^|\n)(?:todo|to-do|pending|next step|still need|haven't)[:\s]+(.+?)(?:\n|$)/gi,
    /(?:^|\n)(?:\[ \]|☐|○)\s+(.+?)(?:\n|$)/gi,
    /(?:^|\n)(?:- \[ \])\s+(.+?)(?:\n|$)/gi,
  ];

  for (const msg of messages) {
    for (const pattern of pendingPatterns) {
      const matches = msg.content.matchAll(pattern);
      for (const m of matches) {
        const task = m[1]?.trim();
        if (task && task.length > 5 && task.length < 200) {
          tasks.push(task);
        }
      }
    }
  }

  return [...new Set(tasks)].slice(0, 10);
}

function extractDecisions(messages: ConversationMessage[]): string[] {
  const decisions: string[] = [];
  const decisionPatterns = [
    /(?:^|\n)(?:decided?|chose?|using|will use|going with|opted for)[:\s]+(.+?)(?:\n|$)/gi,
    /(?:^|\n)(?:the decision is|we'll|let's use|i'll use)[:\s]+(.+?)(?:\n|$)/gi,
  ];

  for (const msg of messages) {
    for (const pattern of decisionPatterns) {
      const matches = msg.content.matchAll(pattern);
      for (const m of matches) {
        const decision = m[1]?.trim();
        if (decision && decision.length > 10 && decision.length < 200) {
          decisions.push(decision);
        }
      }
    }
  }

  return [...new Set(decisions)].slice(0, 8);
}

function extractBlockers(messages: ConversationMessage[]): string[] {
  const blockers: string[] = [];
  const blockerPatterns = [
    /(?:^|\n)(?:error|blocked?|issue|problem|fail|broken)[:\s]+(.+?)(?:\n|$)/gi,
    /(?:^|\n)(?:can't|cannot|doesn't work|not working|failed)[:\s]+(.+?)(?:\n|$)/gi,
  ];

  for (const msg of messages.filter((m) => m.role === "user")) {
    for (const pattern of blockerPatterns) {
      const matches = msg.content.matchAll(pattern);
      for (const m of matches) {
        const blocker = m[1]?.trim();
        if (blocker && blocker.length > 5 && blocker.length < 200) {
          blockers.push(blocker);
        }
      }
    }
  }

  return [...new Set(blockers)].slice(0, 5);
}

function buildKeyContext(messages: ConversationMessage[]): string {
  // Extract file paths, code snippets, and key facts mentioned
  const allText = messages.map((m) => m.content).join("\n");

  const filePaths = [...new Set(allText.match(/(?:[\w@][\w./-]*\/[\w./-]+|\.{1,2}\/[\w./-]+)\.[a-z]{1,5}/g) ?? [])].slice(0, 10);
  const codeBlocks = (allText.match(/```[\w]*\n([\s\S]*?)```/g) ?? []).length;

  const parts: string[] = [];
  if (filePaths.length > 0) parts.push(`Files: ${filePaths.join(", ")}`);
  if (codeBlocks > 0) parts.push(`Code blocks: ${codeBlocks}`);

  return parts.join(". ") || "General conversation";
}

// ── Main handler ─────────────────────────────────────────────────────────────

export function handleSummarizeConversation(input: SummarizeConversationInput): CompressedConversation {
  const allMessages = input.messages as ConversationMessage[];
  const toSummarize = input.preserveLastN > 0
    ? allMessages.slice(0, Math.max(0, allMessages.length - input.preserveLastN))
    : allMessages;

  const originalText = allMessages.map((m) => `${m.role}: ${m.content}`).join("\n\n");

  const goals = extractGoals(toSummarize);
  const completedTasks = extractCompletedTasks(toSummarize);
  const pendingTasks = extractPendingTasks(toSummarize);
  const decisions = extractDecisions(toSummarize);
  const blockers = extractBlockers(toSummarize);
  const keyContext = buildKeyContext(toSummarize);

  const compressedText = [
    goals.length > 0 ? `Goals: ${goals.join("; ")}` : "",
    completedTasks.length > 0 ? `Done: ${completedTasks.join("; ")}` : "",
    pendingTasks.length > 0 ? `Pending: ${pendingTasks.join("; ")}` : "",
    decisions.length > 0 ? `Decisions: ${decisions.join("; ")}` : "",
    blockers.length > 0 ? `Blockers: ${blockers.join("; ")}` : "",
    `Context: ${keyContext}`,
  ].filter(Boolean).join("\n");

  const tokens = calculateSavings(originalText, compressedText);
  sessionTracker.record("summarize_conversation", tokens);

  return {
    goals: goals.length > 0 ? goals : ["No explicit goals detected — see key context"],
    completedTasks,
    pendingTasks,
    decisions,
    blockers,
    keyContext,
    tokens,
  };
}

export function formatSummarizeConversationOutput(result: CompressedConversation): string {
  const lines: string[] = ["## Conversation Summary", ""];

  if (result.goals.length > 0) {
    lines.push("### Goals");
    result.goals.forEach((g) => lines.push(`- ${g}`));
    lines.push("");
  }

  if (result.completedTasks.length > 0) {
    lines.push("### Completed Tasks");
    result.completedTasks.forEach((t) => lines.push(`- ✅ ${t}`));
    lines.push("");
  }

  if (result.pendingTasks.length > 0) {
    lines.push("### Pending Tasks");
    result.pendingTasks.forEach((t) => lines.push(`- ⬜ ${t}`));
    lines.push("");
  }

  if (result.decisions.length > 0) {
    lines.push("### Decisions");
    result.decisions.forEach((d) => lines.push(`- ${d}`));
    lines.push("");
  }

  if (result.blockers.length > 0) {
    lines.push("### Blockers");
    result.blockers.forEach((b) => lines.push(`- 🚫 ${b}`));
    lines.push("");
  }

  lines.push("### Key Context");
  lines.push(result.keyContext);
  lines.push("");
  lines.push("### Token Savings");
  lines.push(`Original: **${result.tokens.original}** → Optimized: **${result.tokens.optimized}** (saved **${result.tokens.savedPercent}%**)`);

  return lines.join("\n");
}
