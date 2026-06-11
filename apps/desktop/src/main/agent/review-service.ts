import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { app } from "electron";
import { z } from "zod";
import type { AgentReviewDepth, AgentReviewIssue, AgentReviewResult } from "../../shared/contracts";
import { getDatabase } from "../db/database";
import { readDiff } from "../git/git-service";
import { getDefaultModel, getModelRegistry } from "./model-service";
import { toolRegistry } from "./tools/registry";

const reviewIssueSchema = z.object({
  severity: z.enum(["low", "medium", "high"]),
  title: z.string().trim().min(1),
  file: z.string().trim().min(1).optional(),
  line: z.number().int().positive().optional(),
  detail: z.string().trim().min(1),
});

const reviewOutputSchema = z.object({
  summary: z.string().trim().min(1),
  issues: z.array(reviewIssueSchema).default([]),
});

type AgentReviewRow = {
  id: string;
  session_id: string | null;
  workspace_id: string | null;
  cwd: string;
  depth: AgentReviewDepth;
  status: AgentReviewResult["status"];
  summary: string;
  issues_json: string;
  created_at: string;
};

function toReviewIssue(
  issue: z.infer<typeof reviewIssueSchema> & { id?: string },
): AgentReviewIssue {
  return {
    id: issue.id ?? randomUUID(),
    severity: issue.severity,
    title: issue.title,
    detail: issue.detail,
    ...(issue.file !== undefined ? { file: issue.file } : {}),
    ...(issue.line !== undefined ? { line: issue.line } : {}),
  };
}

function safeParseIssues(raw: string): AgentReviewIssue[] {
  try {
    return z
      .array(reviewIssueSchema.extend({ id: z.string().trim().min(1) }))
      .parse(JSON.parse(raw))
      .map(toReviewIssue);
  } catch {
    return [];
  }
}

function toReview(row: AgentReviewRow): AgentReviewResult {
  const review: AgentReviewResult = {
    id: row.id,
    cwd: row.cwd,
    depth: row.depth,
    status: row.status,
    summary: row.summary,
    issues: safeParseIssues(row.issues_json),
    createdAt: row.created_at,
  };
  if (row.session_id !== null) review.sessionId = row.session_id;
  if (row.workspace_id !== null) review.workspaceId = row.workspace_id;
  return review;
}

function persistReview(review: AgentReviewResult): AgentReviewResult {
  getDatabase()
    .prepare(
      `insert into agent_reviews (
        id, session_id, workspace_id, cwd, depth, status, summary, issues_json, created_at
       )
       values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      review.id,
      review.sessionId ?? null,
      review.workspaceId ?? null,
      review.cwd,
      review.depth,
      review.status,
      review.summary,
      JSON.stringify(review.issues),
      review.createdAt,
    );
  return review;
}

function buildReviewPrompt(diff: string, depth: AgentReviewDepth): string {
  return `You are running a dedicated read-only code review for Modus local changes.

Rules:
- Review only the supplied Git diff.
- Do not modify files.
- Prefer high-confidence correctness, security, data-loss, and regression issues.
- For ${depth} depth, ${depth === "fast" ? "be brief and report only obvious issues" : depth === "deep" ? "inspect thoroughly and include subtle issues when well supported" : "balance signal and coverage"}.
- Return ONLY valid JSON with this shape:
{"summary":"short summary","issues":[{"severity":"low|medium|high","title":"short title","file":"optional path","line":123,"detail":"why this matters"}]}

Git diff:
${diff}`;
}

function extractJsonObject(text: string): string | undefined {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  if (fenced) return fenced;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) return text.slice(start, end + 1);
  return undefined;
}

export function parseReviewOutput(
  text: string,
  fallbackDiff: string,
): Pick<AgentReviewResult, "summary" | "issues"> {
  const candidate = extractJsonObject(text) ?? text.trim();
  try {
    const parsed = reviewOutputSchema.parse(JSON.parse(candidate));
    return {
      summary: parsed.summary,
      issues: parsed.issues.map(toReviewIssue),
    };
  } catch {
    const summary = text
      .split("\n")
      .map((line) => line.trim())
      .find(Boolean);
    const fallbackIssues = inspectDiff(fallbackDiff);
    return {
      summary:
        summary ??
        (fallbackIssues.length === 0
          ? "Review completed, but the model response was not valid JSON. No heuristic issues found."
          : "Review completed with fallback heuristic findings."),
      issues: fallbackIssues,
    };
  }
}

async function runPiReview(cwd: string, diff: string, depth: AgentReviewDepth): Promise<string> {
  const agentDir = join(app.getPath("userData"), "pi-agent");
  mkdirSync(agentDir, { recursive: true });
  const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false } });
  const loader = new DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager,
    systemPromptOverride: () =>
      "You are a read-only code reviewer. You must never edit files or run destructive commands. Return strict JSON only.",
  });
  await loader.reload();

  const selectedModel = getDefaultModel();
  const sessionOptions: Parameters<typeof createAgentSession>[0] = {
    cwd,
    agentDir,
    authStorage: getModelRegistry().authStorage,
    modelRegistry: getModelRegistry(),
    resourceLoader: loader,
    sessionManager: SessionManager.inMemory(),
    settingsManager,
    tools: toolRegistry.resolveActiveTools("review"),
    customTools: toolRegistry.getCustomToolDefinitions("review"),
  };
  if (selectedModel !== undefined) {
    sessionOptions.model = selectedModel;
  }
  const { session } = await createAgentSession(sessionOptions);

  let text = "";
  const unsubscribe = session.subscribe((event) => {
    if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
      text += event.assistantMessageEvent.delta;
    }
  });

  try {
    await session.prompt(buildReviewPrompt(diff, depth), { source: "rpc" });
    return text;
  } finally {
    unsubscribe();
    session.dispose();
  }
}

export async function startAgentReview(input: {
  cwd: string;
  sessionId?: string;
  workspaceId?: string;
  depth?: AgentReviewDepth;
}): Promise<AgentReviewResult> {
  const unstaged = await readDiff(input.cwd, undefined, "unstaged");
  const staged = await readDiff(input.cwd, undefined, "staged");
  const diff = `${staged.diff}\n${unstaged.diff}`.trim();
  const depth = input.depth ?? "standard";
  const baseReview = {
    id: randomUUID(),
    cwd: input.cwd,
    depth,
    createdAt: new Date().toISOString(),
  };

  if (!diff) {
    return persistReview({
      ...baseReview,
      ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
      ...(input.workspaceId !== undefined ? { workspaceId: input.workspaceId } : {}),
      status: "completed",
      summary: "No local changes to review.",
      issues: [],
    });
  }

  try {
    const response = await runPiReview(input.cwd, diff, depth);
    const parsed = parseReviewOutput(response, diff);
    return persistReview({
      ...baseReview,
      ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
      ...(input.workspaceId !== undefined ? { workspaceId: input.workspaceId } : {}),
      status: "completed",
      summary: parsed.summary,
      issues: parsed.issues,
    });
  } catch (error) {
    const issues = inspectDiff(diff);
    return persistReview({
      ...baseReview,
      ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
      ...(input.workspaceId !== undefined ? { workspaceId: input.workspaceId } : {}),
      status: "failed",
      summary: `Agent review failed: ${error instanceof Error ? error.message : String(error)}`,
      issues,
    });
  }
}

export function listAgentReviews(cwd: string): AgentReviewResult[] {
  const rows = getDatabase()
    .prepare(
      `select id, session_id, workspace_id, cwd, depth, status, summary, issues_json, created_at
       from agent_reviews
       where cwd = ?
       order by created_at desc
       limit 20`,
    )
    .all(cwd) as AgentReviewRow[];
  return rows.map(toReview);
}

export function inspectDiff(diff: string): AgentReviewIssue[] {
  const issues: AgentReviewIssue[] = [];
  let currentFile = "";
  let lineNumber = 0;

  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ b/")) {
      currentFile = line.slice("+++ b/".length);
      continue;
    }
    if (line.startsWith("@@")) {
      lineNumber = Number(line.match(/\+(\d+)/)?.[1] ?? 0);
      continue;
    }
    if (!line.startsWith("+") || line.startsWith("+++")) {
      continue;
    }

    const added = line.slice(1);
    if (/\b(api[_-]?key|secret|password|token)\b\s*[:=]/i.test(added)) {
      issues.push({
        id: randomUUID(),
        severity: "high",
        title: "Possible secret in added code",
        file: currentFile,
        line: lineNumber,
        detail: "This added line looks like it may contain a secret value.",
      });
    }
    if (/\bTODO\b|\bFIXME\b/i.test(added)) {
      issues.push({
        id: randomUUID(),
        severity: "low",
        title: "Unresolved TODO in diff",
        file: currentFile,
        line: lineNumber,
        detail: "A TODO/FIXME was added. Make sure it is intentional before committing.",
      });
    }
    lineNumber += 1;
  }

  return issues;
}
