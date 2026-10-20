import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import { Telemetry } from './telemetry.js';

export async function* jsonLines(file) {
  const stream = fs.createReadStream(file, { encoding: 'utf8' });
  const reader = readline.createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of reader) {
      try {
        yield JSON.parse(line);
      } catch {}
    }
  } finally {
    reader.close();
    stream.destroy();
  }
}
export function normalizedUsage(u) {
  const n = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
  return {
    inputTokens: n(u.input_tokens),
    cachedTokens: n(u.cached_input_tokens),
    cacheWriteTokens: n(u.cache_write_input_tokens),
    outputTokens: n(u.output_tokens),
    reasoningTokens: n(u.reasoning_output_tokens),
  };
}
export async function terminalUsage(provider, file) {
  const t = new Telemetry(provider);
  let received = false,
    reportedDurationMs = null;
  if (!fs.existsSync(file)) return { telemetry: t.value, received, reportedDurationMs };
  for await (const event of jsonLines(file)) {
    if (['thread.started', 'turn.completed', 'result', 'system'].includes(event.type))
      t.accept(event);
    if (
      (event.type === 'turn.completed' && event.usage) ||
      (event.type === 'result' && event.usage)
    )
      received = true;
    if (event.type === 'result' && Number.isFinite(event.duration_ms) && event.duration_ms >= 0)
      reportedDurationMs = event.duration_ms;
  }
  return { telemetry: t.value, received, reportedDurationMs };
}
export async function codexSessionUsage(
  run,
  home = process.env.CODEX_HOME || path.join(os.homedir(), '.codex')
) {
  const id = run.telemetry.sessionId;
  if (run.provider !== 'codex' || !/^[a-f0-9-]{36}$/.test(id || '')) return null;
  const days = new Set();
  for (const date of [run.startedAt, run.endedAt])
    if (date)
      for (const delta of [-1, 0, 1]) {
        const d = new Date(Date.parse(date) + delta * 86400000);
        if (!Number.isNaN(d.getTime())) days.add(d.toISOString().slice(0, 10).replaceAll('-', '/'));
      }
  let file = null;
  for (const day of days) {
    const dir = path.join(home, 'sessions', day);
    let names = [];
    try {
      names = await fs.promises.readdir(dir);
    } catch {}
    const name = names.find((n) => n.endsWith(`-${id}.jsonl`));
    if (name) {
      file = path.join(dir, name);
      break;
    }
  }
  if (!file) return null;
  let verified = false,
    model = run.model,
    total = null;
  const requests = [],
    seen = new Set();
  for await (const event of jsonLines(file)) {
    const p = event.payload || {};
    if (event.type === 'session_meta') {
      try {
        verified = p.id === id && fs.realpathSync(p.cwd) === fs.realpathSync(run.workspace);
      } catch {
        verified = false;
      }
      if (!verified) return null;
    }
    if (!verified) continue;
    if (event.type === 'turn_context' && typeof p.model === 'string') model = p.model;
    if (event.type === 'token_usage_record' && p.thread_id === id && p.usage) {
      const key = p.response_id || event.ordinal;
      if (key != null && !seen.has(key)) {
        seen.add(key);
        requests.push({ id: String(key), at: event.timestamp, model, ...normalizedUsage(p.usage) });
      }
    }
    if (p.type === 'token_count' && p.info?.total_token_usage)
      total = normalizedUsage(p.info.total_token_usage);
  }
  return verified ? { file, model, total, requests } : null;
}
