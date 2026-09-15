import { createHash } from 'node:crypto';

export type LogicalRequestContext = {
  key: string;
  source: string;
  preview: string;
  metaKeys: string[];
};

type Candidate = { score: number; source: string; value: string };
const openAiConversationKey = /(?:^|\.)openai\/session$/i;
const unstableKey =
  /(request[_-]?id|run[_-]?id|trace|span|progress|nonce|timestamp|locale|user.?agent|location)/i;

function identifierScore(path: string): number {
  // A changing request identifier is never a chat identifier, even inside conversation.*.
  if (unstableKey.test(path)) return 0;
  if (openAiConversationKey.test(path)) return 250;
  const parts = path.split(/[./]/).map((part) => part.replace(/[_-]/g, '').toLowerCase());
  const leaf = parts.at(-1);
  const parent = parts.at(-2);
  const kind = leaf === 'id' ? parent : leaf?.replace(/id$/, '');
  if (leaf !== 'id' && !leaf?.endsWith('id')) return 0;
  if (kind === 'conversation') return 140;
  if (kind === 'chat' || kind === 'thread') return 130;
  if (kind === 'workflow') return 120;
  if (kind === 'context') return 100;
  return 0;
}

function scalar(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text.length >= 6 && text.length <= 512 ? text : null;
}

function walk(value: unknown, path: string, out: Candidate[], keys: Set<string>, depth = 0): void {
  if (!value || typeof value !== 'object' || depth > 4) return;
  for (const [name, child] of Object.entries(value as Record<string, unknown>)) {
    const next = path ? `${path}.${name}` : name;
    keys.add(next);
    const text = scalar(child);
    if (text) {
      const score = identifierScore(next);
      if (score > 0) out.push({ score, source: next, value: text });
    } else if (child && typeof child === 'object') walk(child, next, out, keys, depth + 1);
  }
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

export function resolveLogicalRequestContext(
  meta: unknown,
  envelope?: unknown,
): LogicalRequestContext | null {
  const candidates: Candidate[] = [],
    keys = new Set<string>();
  walk(meta, 'meta', candidates, keys);
  walk(envelope, 'envelope', candidates, keys);
  candidates.sort((a, b) => b.score - a.score || a.source.localeCompare(b.source));
  const best = candidates[0];
  if (!best) return null;
  const valueDigest = digest(best.value);
  return {
    key: `${best.source}:sha256:${valueDigest}`,
    source: best.source,
    preview: `${best.source.replace(/^meta\./, '')}#${valueDigest}`,
    metaKeys: [...keys].sort().slice(0, 40),
  };
}

export function contextDiagnostic(meta: unknown, envelope?: unknown) {
  const keys = new Set<string>();
  walk(meta, 'meta', [], keys);
  walk(envelope, 'envelope', [], keys);
  return { keys: [...keys].sort().slice(0, 80) };
}
