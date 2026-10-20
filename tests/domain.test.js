import test from 'node:test';
import assert from 'node:assert/strict';
import {
  matrix,
  renderPrompt,
  validateConfig,
  validateReview,
  defaults,
} from '../server/domain.js';
import { Telemetry, emptyTelemetry, pricedUsage, unionMs } from '../server/telemetry.js';
import { analyze, csvExport } from '../server/analysis.js';
import { commandFor } from '../server/runner.js';
export const config = () => ({
  name: 'Controlled study',
  template: 'Build {{SOURCE}}. {{TESTING}} / {{MODEL}} / {{EFFORT}}',
  models: [{ provider: 'rehearsal', model: 'fixture', efforts: ['low', 'high'] }],
  axes: [
    {
      key: 'SOURCE',
      label: 'Source',
      options: [
        { label: 'A', value: 'alpha', enabled: true },
        { label: 'B', value: 'beta', enabled: true },
      ],
    },
    {
      key: 'TESTING',
      label: 'Testing',
      options: [
        { label: 'None', value: 'No testing.', enabled: true },
        { label: 'Full', value: 'Test freely.', enabled: true },
      ],
    },
  ],
  repeats: 2,
  timeoutMinutes: 1,
  permissions: 'workspace',
  randomize: false,
  captureReport: true,
});
test('Cartesian product covers every model, effort, variable and repetition exactly once', () => {
  const c = config();
  c.models.push({ provider: 'claude', model: 'sonnet', efforts: ['medium'] });
  const rows = matrix(c);
  assert.equal(rows.length, 24);
  assert.equal(new Set(rows.map((r) => JSON.stringify(r))).size, 24);
  const p = renderPrompt(c, rows[0], 'run-test', '2026-10-20T12:30:00Z');
  assert.match(p, /Build alpha\. No testing\. \/ fixture \/ low/);
  assert.match(p, /hub-report.json/);
  assert.doesNotMatch(p, /\{\{[A-Z]+\}\}/);
  c.captureReport = false;
  assert.doesNotMatch(renderPrompt(c, rows[0], 'run-test'), /hub-report/);
  c.axes.push({
    key: 'EXTRA',
    label: 'Additional',
    options: [{ label: 'Opt', value: 'Add weather', enabled: true }],
  });
  assert.match(renderPrompt(c, matrix(c)[0], 'run'), /EXTRA: Add weather/);
});
test('Validation rejects invalid matrices and never interpolates model arguments into a shell', () => {
  const c = config();
  c.axes[0].options.forEach((o) => (o.enabled = false));
  assert.throws(() => matrix(c), /Select an option/);
  const c2 = config();
  c2.template += ' {{MISSING}}';
  assert.throws(() => matrix(c2), /No values configured/);
  const c3 = config();
  c3.models[0].model = 'foo;touch /tmp/bad';
  assert.throws(() => matrix(c3), /Model names/);
  const c4 = config();
  c4.models.push(c4.models[0]);
  assert.throws(() => matrix(c4), /appears twice/);
  const c5 = config();
  c5.repeats = 100;
  c5.models = Array.from({ length: 40 }, (_, i) => ({
    provider: 'codex',
    model: 'test-' + i,
    efforts: ['low', 'high'],
  }));
  assert.throws(() => matrix(c5), /limit is 5,000/);
  const c6 = config();
  c6.models = [{ provider: 'claude', model: 'sonnet', efforts: ['ultra'] }];
  assert.throws(() => matrix(c6), /Unsupported effort/);
  const command = commandFor({ provider: 'codex', model: 'exact-model', effort: 'high' }, config());
  assert.ok(command.args.includes('exact-model'));
  assert.ok(command.args.includes('model_reasoning_effort="high"'));
  assert.equal(command.args.at(-1), '-');
});
test('Codex usage is additive by turn and testing intervals do not double count overlap', () => {
  const t = new Telemetry('codex');
  t.accept(
    {
      type: 'turn.completed',
      usage: { input_tokens: 1000, cached_input_tokens: 700, output_tokens: 100 },
    },
    0
  );
  t.accept(
    {
      type: 'turn.completed',
      usage: { input_tokens: 2000, cached_input_tokens: 1500, output_tokens: 200 },
    },
    0
  );
  t.start('a', 'command_execution', 'npx playwright test', 100);
  t.start('b', 'command_execution', 'pytest', 200);
  t.finish('a', 600);
  t.finish('b', 800);
  assert.equal(t.value.inputTokens, 3000);
  assert.equal(t.value.cachedTokens, 2200);
  assert.equal(t.value.outputTokens, 300);
  assert.equal(t.value.testingMs, 700);
  assert.equal(t.value.testingCalls, 2);
  assert.equal(t.value.costUsd, null);
  assert.equal(
    unionMs([
      [1, 10],
      [3, 5],
      [8, 15],
      [20, 25],
    ]),
    19
  );
});
test('Claude usage includes cache reads/writes once, and reported cost takes precedence', () => {
  const t = new Telemetry('claude');
  t.accept({ type: 'system', model: 'observed-model' });
  t.accept({
    type: 'result',
    subtype: 'success',
    usage: {
      input_tokens: 100,
      cache_read_input_tokens: 1000,
      cache_creation_input_tokens: 200,
      output_tokens: 50,
    },
    total_cost_usd: 0.013,
    result: 'Done',
    modelUsage: { 'observed-model': {} },
  });
  assert.equal(t.value.inputTokens, 1300);
  assert.equal(t.value.cachedTokens, 1000);
  assert.equal(t.value.cacheWriteTokens, 200);
  assert.equal(pricedUsage(t.value, { input: 100, cached: 10, output: 200 }).costUsd, 0.013);
  assert.deepEqual(t.value.observedModels, ['observed-model']);
  const unknown = pricedUsage(emptyTelemetry(), { input: 1, cached: 1, output: 1 });
  assert.equal(unknown.costUsd, null);
  const priced = pricedUsage(
    { ...emptyTelemetry(), inputTokens: 1000000, cachedTokens: 500000, outputTokens: 100000 },
    { input: 2, cached: 0.2, output: 10 }
  );
  assert.equal(priced.costUsd, 2.1);
  assert.equal(
    pricedUsage({ ...t.value, costUsd: null }, { input: 1, cached: 1, output: 1 }).costUsd,
    null,
    'cache-write rate is required when cache writes are charged separately'
  );
});
test('Human review denominators exclude untested and unknown costs stay unknown', () => {
  const make = (id, review, cost = null) => ({
    id,
    provider: 'codex',
    model: 'm',
    effort: 'low',
    variables: { TESTING: { label: 'None' } },
    startedAt: '2026-10-20T00:00:00Z',
    durationMs: 60000,
    endedAt: '2026-10-20T00:01:00Z',
    telemetry: { ...emptyTelemetry(), costUsd: cost },
    review,
  });
  const review = (outcome, verdict = 'pass') => ({
    verdict,
    score: 4,
    issues: [{ key: 'boot', outcome, testMinutes: 1, fixMinutes: 2 }],
  });
  const a = analyze(
    [make('a', review('clear')), make('b', review('found', 'fail')), make('c', review('untested'))],
    defaults
  );
  const issue = a.issues.find((i) => i.key === 'boot');
  assert.equal(issue.checked, 2);
  assert.equal(issue.found, 1);
  assert.equal(issue.rate, 0.5);
  assert.equal(a.groups[0].passRate, 2 / 3);
  assert.equal(a.groups[0].meanCost, null);
  assert.equal(a.groups[0].costPerPass, null);
  assert.equal(a.groups[0].timePerPass, 90000);
  const zero = analyze([make('a', review('clear'))], defaults).issues.find((i) => i.key === 'boot');
  assert.equal(zero.zeroUpperBound, 0.95);
  assert.equal(
    analyze([{ ...make('s', review('clear')), provider: 'rehearsal' }], defaults).runCount,
    0
  );
});
test('Reviews validate numerics, preserve untested checks, and CSV neutralizes formulas', () => {
  assert.throws(
    () => validateReview({ verdict: 'pass', score: NaN, issues: [] }, defaults.issueCatalog),
    /Quality score/
  );
  assert.throws(
    () =>
      validateReview({ verdict: 'pass', testingMinutes: -1, issues: [] }, defaults.issueCatalog),
    /Testing minutes/
  );
  const review = validateReview(
    { verdict: 'pass', issues: [{ key: 'boot', outcome: 'untested', testMinutes: '' }] },
    defaults.issueCatalog
  );
  assert.equal(review.issues[0].testMinutes, null);
  const csv = csvExport([
    { id: 'r', variables: {}, telemetry: emptyTelemetry(), review: { notes: '=HYPERLINK("bad")' } },
  ]);
  assert.ok(csv.includes("'=HYPERLINK"));
});
