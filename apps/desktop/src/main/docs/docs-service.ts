import { randomUUID } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, extname, join, relative } from "node:path";
import type { AddDocInput, DocHit, DocSource } from "../../shared/contracts";
import { getDatabase } from "../db/database";

type DocSourceRow = {
  id: string;
  workspace_id: string;
  title: string;
  path: string | null;
  url: string | null;
  created_at: string;
  updated_at: string;
};

type DocChunkRow = {
  id: string;
  source_id: string;
  heading: string | null;
  content: string;
  ordinal: number;
  title: string;
  path: string | null;
};

const DOC_GLOBS = new Set(["README.md", "README.zh-CN.md"]);
const MAX_DOC_BYTES = 512 * 1024;

function toSource(row: DocSourceRow): DocSource {
  const source: DocSource = {
    id: row.id,
    workspaceId: row.workspace_id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };

  if (row.path !== null) {
    source.path = row.path;
  }
  if (row.url !== null) {
    source.url = row.url;
  }

  return source;
}

function docHitFromRow(row: DocChunkRow, snippet: string, score: number): DocHit {
  const hit: DocHit = {
    sourceId: row.source_id,
    chunkId: row.id,
    title: row.title,
    snippet,
    score,
  };

  if (row.heading !== null) {
    hit.heading = row.heading;
  }
  if (row.path !== null) {
    hit.path = row.path;
  }

  return hit;
}

async function walkMarkdown(root: string, dir = root): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const paths: string[] = [];

  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "target") {
      continue;
    }

    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      paths.push(...(await walkMarkdown(root, fullPath)));
      continue;
    }

    const rel = relative(root, fullPath).replace(/\\/g, "/");
    if (DOC_GLOBS.has(rel) || rel.startsWith("docs/") || rel.startsWith("MODUS_")) {
      if (extname(fullPath).toLowerCase() === ".md") {
        paths.push(fullPath);
      }
    }
  }

  return paths;
}

function splitMarkdown(content: string): Array<{ heading?: string; content: string }> {
  const chunks: Array<{ heading?: string; content: string }> = [];
  let heading: string | undefined;
  let lines: string[] = [];

  for (const line of content.split(/\r?\n/)) {
    const match = /^(#{1,6})\s+(.+)$/.exec(line);
    if (match && lines.length > 0) {
      const nextChunk = { content: lines.join("\n").trim() };
      chunks.push(heading ? { ...nextChunk, heading } : nextChunk);
      heading = match[2];
      lines = [line];
      continue;
    }

    if (match) {
      heading = match[2];
    }
    lines.push(line);
  }

  if (lines.length > 0) {
    const nextChunk = { content: lines.join("\n").trim() };
    chunks.push(heading ? { ...nextChunk, heading } : nextChunk);
  }

  return chunks.filter((chunk) => chunk.content.length > 0);
}

export function listDocSources(workspaceId: string): DocSource[] {
  const rows = getDatabase()
    .prepare(
      `select id, workspace_id, title, path, url, created_at, updated_at
       from docs_sources
       where workspace_id = ?
       order by title`,
    )
    .all(workspaceId) as DocSourceRow[];

  return rows.map(toSource);
}

export async function indexWorkspaceDocs(workspaceId: string, cwd: string): Promise<DocSource[]> {
  const files = await walkMarkdown(cwd);
  const sources: DocSource[] = [];

  for (const filePath of files) {
    const info = await stat(filePath);
    if (info.size > MAX_DOC_BYTES) {
      continue;
    }

    const now = new Date().toISOString();
    const title = relative(cwd, filePath).replace(/\\/g, "/") || basename(filePath);
    const existing = getDatabase()
      .prepare(
        `select id, workspace_id, title, path, url, created_at, updated_at
         from docs_sources
         where workspace_id = ? and path = ?`,
      )
      .get(workspaceId, filePath) as DocSourceRow | undefined;
    const sourceId = existing?.id ?? randomUUID();

    getDatabase()
      .prepare(
        `insert into docs_sources (id, workspace_id, title, path, url, created_at, updated_at)
         values (?, ?, ?, ?, null, ?, ?)
         on conflict(id) do update set title = excluded.title, updated_at = excluded.updated_at`,
      )
      .run(sourceId, workspaceId, title, filePath, existing?.created_at ?? now, now);

    getDatabase().prepare("delete from docs_chunks where source_id = ?").run(sourceId);
    const content = await readFile(filePath, "utf8");
    splitMarkdown(content).forEach((chunk, ordinal) => {
      getDatabase()
        .prepare(
          `insert into docs_chunks (id, source_id, heading, content, ordinal)
           values (?, ?, ?, ?, ?)`,
        )
        .run(randomUUID(), sourceId, chunk.heading ?? null, chunk.content, ordinal);
    });

    sources.push({
      id: sourceId,
      workspaceId,
      title,
      path: filePath,
      createdAt: existing?.created_at ?? now,
      updatedAt: now,
    });
  }

  return sources;
}

export function addDocSource(input: AddDocInput): DocSource {
  const now = new Date().toISOString();
  const source: DocSource = {
    id: randomUUID(),
    workspaceId: input.workspaceId,
    title: input.title,
    createdAt: now,
    updatedAt: now,
  };
  if (input.path !== undefined) {
    source.path = input.path;
  }
  if (input.url !== undefined) {
    source.url = input.url;
  }

  getDatabase()
    .prepare(
      `insert into docs_sources (id, workspace_id, title, path, url, created_at, updated_at)
       values (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      source.id,
      source.workspaceId,
      source.title,
      source.path ?? null,
      source.url ?? null,
      now,
      now,
    );

  return source;
}

export function searchDocs(workspaceId: string, query: string): DocHit[] {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    const rows = getDatabase()
      .prepare(
        `select c.id, c.source_id, c.heading, c.content, c.ordinal, s.title, s.path
         from docs_chunks c
         join docs_sources s on s.id = c.source_id
         where s.workspace_id = ?
         order by s.title, c.ordinal
         limit 20`,
      )
      .all(workspaceId) as DocChunkRow[];

    return rows.map((row) => docHitFromRow(row, row.content.slice(0, 220).replace(/\s+/g, " "), 1));
  }

  const rows = getDatabase()
    .prepare(
      `select c.id, c.source_id, c.heading, c.content, c.ordinal, s.title, s.path
       from docs_chunks c
       join docs_sources s on s.id = c.source_id
       where s.workspace_id = ?`,
    )
    .all(workspaceId) as DocChunkRow[];

  return rows
    .map((row) => {
      const haystack = `${row.title}\n${row.heading ?? ""}\n${row.content}`.toLowerCase();
      const index = haystack.indexOf(needle);
      if (index === -1) {
        return undefined;
      }
      const snippetStart = Math.max(0, index - 80);
      const snippet = row.content.slice(snippetStart, snippetStart + 220).replace(/\s+/g, " ");
      return docHitFromRow(
        row,
        snippet,
        needle.length + (row.heading?.toLowerCase().includes(needle) ? 10 : 0),
      );
    })
    .filter((hit): hit is DocHit => Boolean(hit))
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);
}

export function getDocChunk(
  chunkId: string,
): { title: string; heading?: string; content: string } | undefined {
  const row = getDatabase()
    .prepare(
      `select c.content, c.heading, s.title
       from docs_chunks c
       join docs_sources s on s.id = c.source_id
       where c.id = ?`,
    )
    .get(chunkId) as { title: string; heading: string | null; content: string } | undefined;

  if (!row) {
    return undefined;
  }

  const chunk: { title: string; heading?: string; content: string } = {
    title: row.title,
    content: row.content,
  };
  if (row.heading !== null) {
    chunk.heading = row.heading;
  }
  return chunk;
}
