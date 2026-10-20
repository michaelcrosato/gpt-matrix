import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { claudeModels } from './models.js';

export const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const starter = JSON.parse(fs.readFileSync(path.join(root, 'prompts/starter.json'), 'utf8'));
export const uid = () => randomUUID();
export const now = () => new Date().toISOString();
export const hash = (text) => createHash('sha256').update(text).digest('hex');
export const defaults = {
  concurrency: 8,
  prices: {},
  issueCatalog: [
    { key: 'boot', label: 'Game fails to boot' },
    { key: 'axes', label: 'Controller axes inverted' },
    { key: 'controls', label: 'Controls missing or broken' },
    { key: 'attract', label: 'Attract mode broken' },
    { key: 'features', label: 'Incomplete gameplay / placeholders' },
    { key: 'visuals', label: 'Visual or layout problems' },
    { key: 'packaging', label: 'Packaging / dependency problems' },
  ],
};
export class BadRequest extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
export function requireValue(condition, message) {
  if (!condition) throw new BadRequest(message);
}
const reserved = new Set([
  'MODEL',
  'EFFORT',
  'PROVIDER',
  'REPEAT',
  'RUN_ID',
  'STAMP',
  'PROMPT_VERSION',
]);
export function validateConfig(raw) {
  requireValue(raw && typeof raw === 'object', 'Experiment configuration is required.');
  const c = structuredClone(raw);
  requireValue(
    typeof c.name === 'string' && c.name.trim().length > 0 && c.name.length <= 200,
    'Give the experiment a name (up to 200 characters).'
  );
  requireValue(
    typeof c.template === 'string' && c.template.trim().length > 0 && c.template.length <= 100000,
    'The prompt must contain 1–100,000 characters.'
  );
  requireValue(
    Array.isArray(c.models) && c.models.length > 0 && c.models.length <= 40,
    'Select at least one model.'
  );
  const pairs = new Set();
  for (const m of c.models) {
    requireValue(['codex', 'claude', 'rehearsal'].includes(m.provider), 'Unknown runner.');
    requireValue(
      typeof m.model === 'string' && /^[\w.\-:/]+$/.test(m.model) && m.model.length < 150,
      'Model names may contain letters, numbers, dots, dashes, colons and slashes.'
    );
    requireValue(
      Array.isArray(m.efforts) && m.efforts.length > 0,
      'Select at least one effort per model.'
    );
    const supported =
      m.provider === 'claude'
        ? ['default', 'low', 'medium', 'high', 'xhigh', 'max']
        : ['default', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
    for (const e of m.efforts) {
      requireValue(supported.includes(e), `Unsupported effort: ${e}`);
      const p = `${m.provider}/${m.model}/${e}`;
      requireValue(!pairs.has(p), 'The same model and effort appears twice.');
      pairs.add(p);
    }
  }
  requireValue(Array.isArray(c.axes) && c.axes.length <= 20, 'Use up to 20 variable axes.');
  const keys = new Set();
  for (const a of c.axes) {
    requireValue(
      typeof a.key === 'string' &&
        /^[A-Z][A-Z0-9_]*$/.test(a.key) &&
        !reserved.has(a.key) &&
        !keys.has(a.key),
      'Variable keys must be unique uppercase names; built-in keys are reserved.'
    );
    keys.add(a.key);
    requireValue(
      typeof a.label === 'string' && a.label.length <= 200,
      'Each variable needs a label.'
    );
    requireValue(
      Array.isArray(a.options) && a.options.length > 0 && a.options.length <= 200,
      `Add options for ${a.key}.`
    );
    for (const o of a.options) {
      requireValue(
        typeof o.label === 'string' &&
          o.label.length <= 200 &&
          typeof o.value === 'string' &&
          o.value.length <= 20000,
        `Each ${a.key} option needs a label and prompt text.`
      );
      if (o.customLabel === false) o.label = o.value.trim().replace(/\s+/g, ' ').slice(0, 200);
      if (o.enabled)
        requireValue(
          o.label.trim() && o.value.trim(),
          `${a.label} option "${o.label || '(empty)'}" has no prompt text. Enter a value or deselect it.`
        );
    }
    const selected = a.options.filter((o) => o.enabled);
    requireValue(selected.length > 0, `Select an option for ${a.label}.`);
    requireValue(
      new Set(selected.map((o) => o.label)).size === selected.length,
      `Selected labels for ${a.label} must be unique.`
    );
  }
  const unknown = [...c.template.matchAll(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g)]
    .map((m) => m[1])
    .filter((k) => !keys.has(k) && !reserved.has(k));
  requireValue(!unknown.length, `No values configured for: ${[...new Set(unknown)].join(', ')}.`);
  requireValue(
    Number.isInteger(c.repeats) && c.repeats >= 1 && c.repeats <= 100,
    'Repetitions must be between 1 and 100.'
  );
  requireValue(
    Number.isInteger(c.timeoutMinutes) && c.timeoutMinutes >= 1 && c.timeoutMinutes <= 1440,
    'Run timeout must be 1–1440 minutes.'
  );
  requireValue(
    ['workspace', 'unrestricted'].includes(c.permissions),
    'Choose a run permission mode.'
  );
  c.name = c.name.trim();
  c.captureReport = c.captureReport !== false;
  c.randomize = Boolean(c.randomize);
  const count =
    c.models.reduce((s, m) => s + m.efforts.length, 0) *
    c.axes.reduce((n, a) => n * a.options.filter((o) => o.enabled).length, 1) *
    c.repeats;
  requireValue(
    count <= 5000,
    `This matrix has ${count.toLocaleString()} runs; the limit is 5,000 per experiment.`
  );
  return c;
}
export function matrix(config) {
  const c = validateConfig(config);
  let choices = [{}];
  for (const a of c.axes)
    choices = choices.flatMap((v) =>
      a.options
        .filter((o) => o.enabled)
        .map((o) => ({ ...v, [a.key]: { label: o.label, value: o.value } }))
    );
  const rows = [];
  for (const m of c.models)
    for (const effort of m.efforts)
      for (const variables of choices)
        for (let repeat = 1; repeat <= c.repeats; repeat++)
          rows.push({ provider: m.provider, model: m.model, effort, variables, repeat });
  if (c.randomize)
    for (let i = rows.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [rows[i], rows[j]] = [rows[j], rows[i]];
    }
  return rows;
}
export function renderPrompt(
  config,
  row,
  id,
  stamp = now(),
  version = hash(config.template).slice(0, 10)
) {
  const vars = Object.fromEntries(Object.entries(row.variables).map(([k, v]) => [k, v.value]));
  Object.assign(vars, {
    MODEL: row.model,
    EFFORT: row.effort,
    PROVIDER: row.provider,
    REPEAT: row.repeat,
    RUN_ID: id,
    STAMP: stamp.replace(/[-:]/g, '').slice(0, 13).replace('T', '-'),
    PROMPT_VERSION: version,
  });
  let text = config.template.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (_, key) =>
    String(vars[key])
  );
  const used = new Set([...config.template.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]));
  const extra = Object.entries(row.variables).filter(([key]) => !used.has(key));
  if (extra.length)
    text +=
      '\n\nAdditional experiment instructions:\n' +
      extra.map(([key, v]) => `${key}: ${v.value}`).join('\n');
  text += `\n\nExecution identity: runner=${row.provider}; requested model=${row.model}; effort=${row.effort}; repetition=${row.repeat}; run=${id}.\nWork within the current run directory. Keep your deliverable files here.\n`;
  if (config.captureReport)
    text +=
      '\nAfter finishing, also write hub-report.json in the current directory. This is a metadata report, not a request to run tests. Use valid JSON with these keys: actualStack (string: libraries and versions actually used), artDirection (string), animation (string), engineFeedback (string), promptFeedback (string), testingPerformed (string), issues (array of short issue labels). Use "unknown" for unconfirmed facts. Do not estimate usage; the runner records it after you exit. In the HTML About/Credits screen, include this plain HTML marker: <span data-gpt-hub-usage>Usage finalized after the run</span>. The runner will fill it with final session time, token totals, and available cost without another model call.\n';
  return text;
}
export function catalog() {
  let models = [];
  try {
    models = JSON.parse(
      fs.readFileSync(path.join(os.homedir(), '.codex/models_cache.json'), 'utf8')
    )
      .models.filter((m) => m.visibility === 'list')
      .map((m) => ({
        provider: 'codex',
        model: m.slug,
        label: m.display_name,
        efforts: m.supported_reasoning_levels.map((e) => e.effort),
      }));
  } catch {}
  return {
    models: [...models, ...claudeModels],
    source: models.length
      ? 'Codex models come from your local CLI catalog. Claude versions were verified on October 20, 2026; access depends on your account.'
      : 'Enter a model ID available to your CLI account.',
  };
}
export function validateReview(raw, issueCatalog) {
  requireValue(
    raw && ['unreviewed', 'pass', 'partial', 'fail'].includes(raw.verdict),
    'Choose a review outcome.'
  );
  const r = {
    verdict: raw.verdict,
    score: raw.score == null || raw.score === '' ? null : Number(raw.score),
    notes: String(raw.notes || '').slice(0, 20000),
    actualStack: String(raw.actualStack || '').slice(0, 4000),
    engineFeedback: String(raw.engineFeedback || '').slice(0, 20000),
    promptFeedback: String(raw.promptFeedback || '').slice(0, 20000),
    testingMinutes:
      raw.testingMinutes == null || raw.testingMinutes === '' ? null : Number(raw.testingMinutes),
    issues: raw.issues || [],
    updatedAt: now(),
  };
  requireValue(
    r.score === null || (Number.isFinite(r.score) && r.score >= 1 && r.score <= 5),
    'Quality score must be between 1 and 5.'
  );
  requireValue(
    r.testingMinutes === null ||
      (Number.isFinite(r.testingMinutes) && r.testingMinutes >= 0 && r.testingMinutes <= 100000),
    'Testing minutes must be a nonnegative number.'
  );
  requireValue(Array.isArray(r.issues) && r.issues.length <= 200, 'Invalid issue checklist.');
  const seen = new Set();
  r.issues = r.issues.map((i) => {
    requireValue(
      issueCatalog.some((x) => x.key === i.key) && !seen.has(i.key),
      'Issue checklist contains an unknown or duplicate item.'
    );
    seen.add(i.key);
    requireValue(['untested', 'clear', 'found'].includes(i.outcome), 'Invalid checklist outcome.');
    const minutes = (k) => (i[k] === '' || i[k] == null ? null : Number(i[k]));
    const o = {
      key: i.key,
      outcome: i.outcome,
      testMinutes: minutes('testMinutes'),
      fixMinutes: minutes('fixMinutes'),
      notes: String(i.notes || '').slice(0, 4000),
    };
    for (const k of ['testMinutes', 'fixMinutes'])
      requireValue(
        o[k] === null || (Number.isFinite(o[k]) && o[k] >= 0 && o[k] <= 100000),
        'Issue times must be nonnegative.'
      );
    return o;
  });
  return r;
}
