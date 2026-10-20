export const emptyTelemetry = () => ({
  inputTokens: null,
  cachedTokens: null,
  cacheWriteTokens: null,
  outputTokens: null,
  reasoningTokens: null,
  costUsd: null,
  costSource: null,
  sessionId: null,
  observedModels: [],
  finalText: '',
  toolCalls: 0,
  testingCalls: 0,
  testingMs: 0,
  toolMs: 0,
  usageSource: null,
  warnings: [],
});
const testingPattern =
  /\b(playwright|puppeteer|vitest|pytest|jest|lighthouse|viewport-matrix|screenshot|test[s]?)\b|npm\s+(run\s+)?test|\b(curl|wget)\b.*(localhost|127\.0\.0\.1)/i;
export function toolCategory(name, command) {
  return testingPattern.test(name + ' ' + command) ? 'testing' : 'building';
}
function number(v) {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
}
export function unionMs(intervals) {
  let total = 0,
    end = -Infinity;
  for (const [start, stop] of [...intervals].sort((a, b) => a[0] - b[0])) {
    total += Math.max(0, stop - Math.max(start, end));
    end = Math.max(end, stop);
  }
  return total;
}
export class Telemetry {
  constructor(provider, onEvent = () => {}) {
    this.provider = provider;
    this.value = emptyTelemetry();
    this.open = new Map();
    this.intervals = [];
    this.allIntervals = [];
    this.emit = onEvent;
    this.failed = null;
  }
  start(id, name, command, at) {
    if (this.open.has(id)) return;
    const category = toolCategory(name, command);
    this.open.set(id, { at, category, name, command });
    this.value.toolCalls++;
    if (category === 'testing') this.value.testingCalls++;
    this.emit({
      kind: 'tool',
      phase: category,
      name,
      text: String(command || name).slice(0, 4000),
      toolId: id,
    });
  }
  finish(id, at) {
    const start = this.open.get(id);
    if (!start) return;
    this.open.delete(id);
    this.allIntervals.push([start.at, at]);
    if (start.category === 'testing') this.intervals.push([start.at, at]);
    this.value.toolMs = unionMs(this.allIntervals);
    this.value.testingMs = unionMs(this.intervals);
  }
  usage(u, accumulate = false) {
    const map = {
      inputTokens: u.input_tokens,
      cachedTokens: u.cached_input_tokens ?? u.cache_read_input_tokens,
      cacheWriteTokens: u.cache_write_input_tokens ?? u.cache_creation_input_tokens,
      outputTokens: u.output_tokens,
      reasoningTokens: u.reasoning_output_tokens,
    };
    for (const [k, v] of Object.entries(map))
      if (number(v) !== null) this.value[k] = accumulate ? (this.value[k] || 0) + v : v;
    // Claude reports cache reads/writes separately from uncached input. Normalize total input.
    if (this.provider === 'claude' && number(u.input_tokens) !== null)
      this.value.inputTokens =
        u.input_tokens + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
    this.value.usageSource = `${this.provider} CLI event`;
  }
  accept(e, at = Date.now()) {
    const v = this.value;
    if (this.provider === 'codex' || this.provider === 'rehearsal') {
      if (e.type === 'thread.started') v.sessionId = e.thread_id;
      if (e.type === 'turn.completed' && e.usage) this.usage(e.usage, true);
      if (e.type === 'turn.failed' || e.type === 'error') {
        this.failed = e.error?.message || e.message || 'Runner reported an error.';
        this.emit({ kind: 'error', text: this.failed });
      }
      const i = e.item;
      if (
        i &&
        ['command_execution', 'mcp_tool_call', 'web_search', 'file_change'].includes(i.type)
      ) {
        if (e.type === 'item.started')
          this.start(
            i.id,
            i.type,
            i.command || i.tool || i.query || JSON.stringify(i.changes || []),
            at
          );
        if (e.type === 'item.completed') {
          if (!this.open.has(i.id))
            this.start(
              i.id,
              i.type,
              i.command || i.tool || i.query || JSON.stringify(i.changes || []),
              at
            );
          this.finish(i.id, at);
        }
      }
      if (e.type === 'item.completed' && i?.type === 'agent_message') {
        v.finalText += (v.finalText ? '\n\n' : '') + (i.text || '');
        this.emit({ kind: 'message', text: i.text || '' });
      }
    }
    if (this.provider === 'claude') {
      if (e.session_id) v.sessionId = e.session_id;
      if (e.type === 'system' && e.model && !v.observedModels.includes(e.model))
        v.observedModels.push(e.model);
      if (e.type === 'assistant')
        for (const c of e.message?.content || []) {
          if (c.type === 'tool_use')
            this.start(c.id, c.name, c.input?.command || JSON.stringify(c.input || {}), at);
          if (c.type === 'text') {
            v.finalText += (v.finalText ? '\n\n' : '') + c.text;
            this.emit({ kind: 'message', text: c.text });
          }
        }
      if (e.type === 'user')
        for (const c of e.message?.content || [])
          if (c.type === 'tool_result') this.finish(c.tool_use_id, at);
      if (e.type === 'result') {
        if (e.usage) this.usage(e.usage);
        if (number(e.total_cost_usd) !== null) {
          v.costUsd = e.total_cost_usd;
          v.costSource = 'CLI-reported API-equivalent cost';
        }
        if (e.result) v.finalText = e.result;
        v.observedModels = [...new Set([...v.observedModels, ...Object.keys(e.modelUsage || {})])];
        if (e.is_error || (e.subtype && e.subtype !== 'success'))
          this.failed = (e.errors || []).join('\n') || e.result || e.subtype;
      }
    }
  }
  end(at = Date.now()) {
    for (const id of [...this.open.keys()]) this.finish(id, at);
    return this.value;
  }
}
export function pricedUsage(telemetry, rate) {
  const t = { ...telemetry };
  if (t.costUsd != null || !rate || t.inputTokens == null || t.outputTokens == null) return t;
  if (t.cachedTokens == null && t.inputTokens > 0) return t;
  const cache = t.cachedTokens || 0,
    write = t.cacheWriteTokens || 0;
  if (write > 0 && rate.cacheWrite == null) return t;
  t.costUsd =
    (Math.max(0, t.inputTokens - cache - write) * rate.input +
      cache * rate.cached +
      t.outputTokens * rate.output +
      write * (rate.cacheWrite || 0)) /
    1e6;
  t.costSource = 'Estimate from your saved price snapshot';
  return t;
}
