import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse } from 'parse5';
import { Store } from '../server/store.js';
import { finalizeRun, stampHtml } from '../server/finalize.js';
import { publishedPrices, estimateCost } from '../server/pricing.js';
import { codexSessionUsage } from '../server/usage-evidence.js';
import { emptyTelemetry } from '../server/telemetry.js';
const id = '12345678-1234-1234-1234-123456789abc';
const usage = {
  input_tokens: 1000,
  cached_input_tokens: 600,
  cache_write_input_tokens: 100,
  output_tokens: 50,
  reasoning_output_tokens: 10,
};
const html =
  '<!DOCTYPE html><!-- Source Information\nUsage: unknown; runner records usage. No estimates.\n--><html><head><title>Game</title></head><body><p>Usage and cost: unknown, recorded by runner.</p><script>window.about=`<h2>About</h2><p>Usage: unknown. Runner records usage; no estimates.</p>`;window.hook="<span data-gpt-hub-usage>Usage finalized after the run</span>";window.play=()=>7;</script></body></html>';
function setup(provider = 'codex') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-finalize-')),
    store = new Store(dir),
    workspace = path.join(dir, 'runs', id, 'workspace');
  fs.mkdirSync(workspace, { recursive: true });
  const run = {
    id,
    experimentId: 'e',
    provider,
    model: 'gpt-6.1-sol',
    effort: 'low',
    status: 'completed',
    startedAt: '2026-10-20T12:00:00.000Z',
    endedAt: '2026-10-20T12:02:03.456Z',
    durationMs: 123456,
    workspace,
    promptHash: 'hash',
    telemetry: { ...emptyTelemetry(), inputTokens: 99, finalText: 'The game is ready.' },
    artifacts: [
      { name: 'game.html', size: html.length },
      { name: 'hub-report.json', size: 2 },
    ],
    review: { verdict: 'pass', notes: 'Preserve my review' },
    report: { actualStack: 'HTML' },
  };
  fs.writeFileSync(path.join(workspace, 'game.html'), html);
  fs.writeFileSync(
    path.join(workspace, 'hub-report.json'),
    JSON.stringify({ actualStack: 'HTML', engineFeedback: 'Agent feedback' })
  );
  store.save('runs', run);
  const stdout = path.join(dir, 'runs', id, 'stdout.jsonl');
  fs.writeFileSync(
    stdout,
    [
      { type: 'thread.started', thread_id: id },
      { type: 'item.completed', item: { type: 'agent_message', text: 'Done' } },
      { type: 'turn.completed', usage },
    ]
      .map((e) => JSON.stringify(e))
      .join('\n')
  ); // intentionally no trailing newline
  return {
    dir,
    store,
    workspace,
    stdout,
    cleanup() {
      store.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
test('Post-run finalization captures trailing totals, stamps static and dynamic credits, and preserves the original', async () => {
  const s = setup();
  try {
    const r = await finalizeRun(s.store, id, { codexHome: path.join(s.dir, 'no-home') });
    assert.equal(r.finalization.status, 'complete');
    assert.equal(r.telemetry.inputTokens, 1000);
    assert.equal(r.telemetry.cacheWriteTokens, 100);
    assert.equal(r.durationMs, 123456);
    assert.ok(Math.abs(r.telemetry.costUsd - 0.00141) < 1e-10);
    const stamped = fs.readFileSync(path.join(s.workspace, 'game.html'), 'utf8');
    assert.ok(stamped.startsWith('<!DOCTYPE html>'));
    assert.doesNotMatch(stamped, /Usage(?: and cost)?: unknown/);
    assert.match(stamped, /Session time 2m 03s/);
    assert.match(stamped, /1,050 total/);
    assert.match(stamped, /\$0.001410/);
    assert.match(stamped, /window.play=\(\)=>7/);
    assert.equal(
      fs.readFileSync(path.join(s.dir, 'runs', id, 'original-artifacts/game.html'), 'utf8'),
      html
    );
    const report = JSON.parse(fs.readFileSync(path.join(s.workspace, 'hub-report.json'), 'utf8'));
    assert.equal(report.engineFeedback, 'Agent feedback');
    assert.equal(report.runnerUsage.totalTokens, 1050);
    assert.equal(r.review.notes, 'Preserve my review');
    assert.match(
      fs.readFileSync(path.join(s.dir, 'runs', id, 'final-response.txt'), 'utf8'),
      /GPT Hub final usage/
    );
    const again = await finalizeRun(s.store, id, { codexHome: path.join(s.dir, 'no-home') });
    assert.equal(again.telemetry.inputTokens, 1000);
    assert.equal(again.telemetry.costUsd, r.telemetry.costUsd);
    const updated = fs.readFileSync(path.join(s.workspace, 'game.html'), 'utf8');
    assert.equal((updated.match(/id="gpt-hub-run-metrics"/g) || []).length, 1);
    assert.equal((updated.match(/<!-- GPT-HUB FINAL METRICS/g) || []).length, 1);
  } finally {
    s.cleanup();
  }
});
test('Finalization keeps a later human edit and reports the skipped file', async () => {
  const s = setup();
  try {
    await finalizeRun(s.store, id);
    fs.appendFileSync(path.join(s.workspace, 'game.html'), '\n<!-- manual fix -->');
    const edited = fs.readFileSync(path.join(s.workspace, 'game.html'), 'utf8');
    const r = await finalizeRun(s.store, id);
    assert.equal(r.finalization.status, 'partial');
    assert.ok(r.finalization.warnings.some((w) => w.includes('kept your edits')));
    assert.equal(fs.readFileSync(path.join(s.workspace, 'game.html'), 'utf8'), edited);
  } finally {
    s.cleanup();
  }
});
test('Provider-reported Claude cost is preserved and provider duration stays distinct from runner time', async () => {
  const s = setup('claude');
  try {
    fs.writeFileSync(
      s.stdout,
      JSON.stringify({
        type: 'result',
        subtype: 'success',
        session_id: 'claude-session',
        duration_ms: 120000,
        total_cost_usd: 0.123,
        usage: {
          input_tokens: 100,
          cache_read_input_tokens: 500,
          cache_creation_input_tokens: 50,
          output_tokens: 30,
        },
      })
    );
    const r = await finalizeRun(s.store, id);
    assert.equal(r.telemetry.inputTokens, 650);
    assert.equal(r.telemetry.costUsd, 0.123);
    assert.equal(r.finalization.metrics.providerDurationMs, 120000);
    assert.equal(r.durationMs, 123456);
    assert.match(r.telemetry.costSource, /CLI-reported/);
  } finally {
    s.cleanup();
  }
});
test('Cost context tiers apply per request, with no estimate from ambiguous session totals', () => {
  const rate = publishedPrices['codex:gpt-6.1-sol'];
  const request = {
    model: 'gpt-6.1-sol',
    inputTokens: 200000,
    cachedTokens: 100000,
    cacheWriteTokens: 0,
    outputTokens: 1000,
  };
  const total = {
    inputTokens: 1000000,
    cachedTokens: 500000,
    cacheWriteTokens: 0,
    outputTokens: 5000,
  };
  assert.equal(estimateCost(total, rate).costUsd, null);
  assert.ok(
    Math.abs(estimateCost(total, rate, Array(5).fill(request), 'gpt-6.1-sol').costUsd - 1.1) < 1e-9
  );
  const long = { ...request, inputTokens: 300000 };
  assert.equal(estimateCost(long, rate, [long], 'gpt-6.1-sol').costUsd, 0.835);
  assert.equal(
    estimateCost(total, rate, [request], 'gpt-6.1-sol').costUsd,
    null,
    'partial request coverage is not enough'
  );
});
test('Codex session evidence is tied to this run and duplicate response records are counted once', async () => {
  const s = setup();
  try {
    const home = path.join(s.dir, 'codex'),
      day = path.join(home, 'sessions/2026/10/20');
    fs.mkdirSync(day, { recursive: true });
    const file = path.join(day, `rollout-${id}.jsonl`),
      record = {
        type: 'token_usage_record',
        payload: { thread_id: id, response_id: 'response1', usage },
      };
    const events = [
      { type: 'session_meta', payload: { id, cwd: s.workspace } },
      { type: 'turn_context', payload: { model: 'gpt-6.1-sol' } },
      record,
      record,
      { type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: usage } } },
    ];
    fs.writeFileSync(file, events.map((e) => JSON.stringify(e)).join('\n'));
    const r = await finalizeRun(s.store, id, { codexHome: home });
    assert.equal(r.finalization.metrics.requestCount, 1);
    assert.deepEqual(r.telemetry.observedModels, ['gpt-6.1-sol']);
    fs.unlinkSync(file);
    const refreshed = await finalizeRun(s.store, id, { codexHome: home });
    assert.equal(
      refreshed.finalization.metrics.requestCount,
      1,
      'saved request evidence survives CLI log cleanup'
    );
    assert.equal(refreshed.telemetry.costUsd, r.telemetry.costUsd);
    events[0].payload.cwd = s.dir;
    fs.writeFileSync(file, events.map((e) => JSON.stringify(e)).join('\n'));
    assert.equal(await codexSessionUsage(r, home), null);
  } finally {
    s.cleanup();
  }
});
test('HTML data is escaped and an explicit usage marker is filled without changing scripts', () => {
  const m = {
    runId: 'r',
    requestedModel: '</script><script>bad()</script>',
    inputTokens: 1,
    outputTokens: 2,
    totalTokens: 3,
    cachedTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    sessionTimeMs: 1000,
    costUsd: null,
    finalizedAt: 'now',
  };
  const out = stampHtml(
    '<!doctype html><html><head></head><body><span data-gpt-hub-usage>Pending</span><script>window.ok=1;</script></body></html>',
    m
  ).html;
  assert.match(out, /\\u003c\/script>/);
  assert.match(out, /window.ok=1;/);
  assert.doesNotMatch(out, /data-gpt-hub-usage>Pending/);
  assert.equal(parse(out).mode, 'no-quirks');
});
