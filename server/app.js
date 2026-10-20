import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  BadRequest,
  requireValue,
  catalog,
  starter,
  matrix,
  renderPrompt,
  validateConfig,
  validateReview,
  uid,
  now,
  hash,
} from './domain.js';
import { analyze, csvExport } from './analysis.js';
import { publishedPrices } from './pricing.js';
const exec = promisify(execFile);

export async function providerStatus() {
  return Promise.all(
    ['codex', 'claude'].map(async (name) => {
      let version = null,
        installed = false,
        auth = 'unknown';
      try {
        const r = await exec(name, ['--version'], { timeout: 8000 });
        version = r.stdout.trim();
        installed = true;
      } catch {}
      if (installed)
        try {
          const r = await exec(name, name === 'codex' ? ['login', 'status'] : ['auth', 'status'], {
            timeout: 8000,
          });
          if (name === 'codex')
            auth = /Logged in/.test(r.stdout + r.stderr) ? 'signed in' : 'sign in required';
          else auth = JSON.parse(r.stdout).loggedIn ? 'signed in' : 'sign in required';
        } catch {
          auth = 'sign in required';
        }
      return { name, version, installed, auth };
    })
  );
}
function localGuard(req, res, next) {
  const host = req.headers.host?.split(':')[0];
  if (!['localhost', '127.0.0.1', '[::1]'].includes(host))
    return res.status(403).json({ error: 'Localhost access only.' });
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    if (req.headers.origin && ![`http://${req.headers.host}`].includes(req.headers.origin))
      return res.status(403).json({ error: 'Cross-origin writes are blocked.' });
    if (!req.is('application/json'))
      return res.status(415).json({ error: 'Send application/json.' });
  }
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
}
function safeFile(store, runId, name) {
  const run = store.get('runs', runId);
  if (!run || !run.workspace) throw new BadRequest('Artifact not found.', 404);
  const base = fs.realpathSync(run.workspace),
    expected = path.join(fs.realpathSync(store.dir), 'runs', runId, 'workspace');
  if (base !== expected || fs.lstatSync(run.workspace).isSymbolicLink())
    throw new BadRequest('Invalid workspace path.', 403);
  const candidate = path.resolve(base, name);
  if (!candidate.startsWith(base + path.sep)) throw new BadRequest('Invalid artifact path.', 403);
  let real;
  try {
    real = fs.realpathSync(candidate);
  } catch {
    throw new BadRequest('File not found.', 404);
  }
  if (!real.startsWith(base + path.sep) || !fs.statSync(real).isFile())
    throw new BadRequest('Invalid artifact path.', 403);
  return real;
}
export function artifactApp(store) {
  const app = express();
  app.use(localGuard);
  app.use((req, res) => {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new BadRequest('Read only.', 405);
      const parts = decodeURIComponent(req.path).split('/').filter(Boolean),
        id = parts.shift();
      res.setHeader(
        'Content-Security-Policy',
        'sandbox allow-scripts allow-same-origin allow-forms allow-pointer-lock allow-modals allow-downloads'
      );
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.sendFile(safeFile(store, id, parts.join('/')));
    } catch (e) {
      res.status(e.status || 404).send(e.message);
    }
  });
  return app;
}
export function apiApp(store, runner, { artifactPort = 4311, providers = [] } = {}) {
  runner.providerVersions = Object.fromEntries(providers.map((p) => [p.name, p.version]));
  const app = express();
  app.use(localGuard);
  app.use((req, res, next) => {
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "frame-ancestors 'none'");
    next();
  });
  app.use(express.json({ limit: '4mb' }));
  app.get('/api/state', (_, res) => {
    const runs = store.runSummaries();
    const experiments = store
      .list('experiments')
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    res.json({
      experiments,
      runs,
      settings: store.settings(),
      providers,
      catalog: catalog(),
      templates: store.list('templates'),
      starter,
      artifactPort,
      publishedPrices,
    });
  });
  app.get('/api/health', (_, res) => res.json({ ok: true, active: runner.active.size }));
  app.post('/api/providers/refresh', async (_, res) => {
    providers = await providerStatus();
    runner.providerVersions = Object.fromEntries(providers.map((p) => [p.name, p.version]));
    res.json(providers);
  });
  app.post('/api/preview', (req, res) => {
    const config = validateConfig(req.body),
      rows = matrix({ ...config, randomize: false });
    res.json({
      count: rows.length,
      rows: rows.slice(0, 80),
      prompt: renderPrompt(config, rows[0], 'preview', now()),
    });
  });
  app.post('/api/experiments', (req, res) => res.status(201).json(runner.create(req.body)));
  app.post('/api/runs/cancel-queued', (req, res) => res.json(runner.cancelQueued()));
  app.post('/api/experiments/:id/:action', (req, res) => {
    if (req.params.action === 'start' || req.params.action === 'resume') {
      const e = store.get('experiments', req.params.id);
      if (!e) throw new BadRequest('Experiment not found.', 404);
      const missing = e.config.models.filter(
        (m) =>
          m.provider !== 'rehearsal' && !providers.some((p) => p.name === m.provider && p.installed)
      );
      requireValue(!missing.length, 'A selected CLI is not installed. Check Runners & settings.');
    }
    res.json(runner.action(req.params.id, req.params.action));
  });
  app.get('/api/runs/:id', (req, res) => {
    const r = store.get('runs', req.params.id);
    if (!r) throw new BadRequest('Run not found.', 404);
    res.json(r);
  });
  app.get('/api/runs/:id/events', (req, res) => {
    const r = store.get('runs', req.params.id);
    if (!r) throw new BadRequest('Run not found.', 404);
    const file = path.join(store.dir, 'runs', r.id, 'events.jsonl');
    let events = [];
    try {
      const fd = fs.openSync(file, 'r');
      try {
        const size = fs.fstatSync(fd).size,
          len = Math.min(size, 250000),
          b = Buffer.alloc(len);
        fs.readSync(fd, b, 0, len, size - len);
        const lines = b.toString().split('\n');
        if (size > len) lines.shift();
        events = lines
          .filter(Boolean)
          .flatMap((s) => {
            try {
              return [JSON.parse(s)];
            } catch {
              return [];
            }
          })
          .slice(-200);
      } finally {
        fs.closeSync(fd);
      }
    } catch {}
    res.json(events);
  });
  app.post('/api/runs/:id/cancel', (req, res) => {
    runner.cancel(req.params.id);
    res.json({ ok: true });
  });
  app.post('/api/runs/:id/retry', (req, res) => res.status(201).json(runner.retry(req.params.id)));
  app.post('/api/runs/:id/finalize', async (req, res) =>
    res.json(await runner.finalize(req.params.id))
  );
  app.post('/api/runs/:id/review', (req, res) => {
    requireValue(Boolean(store.get('runs', req.params.id)), 'Run not found.');
    res.json(
      store.patch('runs', req.params.id, {
        review: validateReview(req.body, store.settings().issueCatalog),
      })
    );
  });
  app.get('/api/runs/:id/download', (req, res) => {
    if (req.query.file) return res.download(safeFile(store, req.params.id, String(req.query.file)));
    const r = store.get('runs', req.params.id);
    if (!r) throw new BadRequest('Run not found.', 404);
    const name = String(req.query.log || 'prompt.txt');
    if (
      ![
        'prompt.txt',
        'stdout.jsonl',
        'stderr.log',
        'events.jsonl',
        'execution.json',
        'final-response.txt',
        'usage-evidence.json',
        'finalization.json',
      ].includes(name)
    )
      throw new BadRequest('Unknown record.');
    if (name === 'prompt.txt') return res.attachment('prompt.txt').send(r.prompt);
    res.download(path.join(store.dir, 'runs', r.id, name));
  });
  app.get('/api/analysis', (req, res) =>
    res.json(
      analyze(store.runSummaries(), store.settings(), {
        groupBy: String(req.query.groupBy || 'testing'),
        includeRehearsal: req.query.includeRehearsal === 'true',
        experimentId: String(req.query.experimentId || ''),
      })
    )
  );
  app.get('/api/export', (req, res) => {
    const experiments = store
        .list('experiments')
        .filter((e) => !req.query.experimentId || e.id === req.query.experimentId),
      ids = new Set(experiments.map((e) => e.id)),
      runs = store.list('runs').filter((r) => ids.has(r.experimentId));
    if (req.query.format === 'csv')
      return res.attachment('gpt-hub-runs.csv').type('text/csv').send(csvExport(runs));
    res.attachment('gpt-hub-export.json').json({
      schemaVersion: 1,
      exportedAt: now(),
      experiments,
      runs,
      templates: store.list('templates'),
      issueCatalog: store.settings().issueCatalog,
    });
  });
  app.post('/api/templates', (req, res) => {
    const { name, template } = req.body;
    requireValue(
      typeof name === 'string' && name.trim() && name.length <= 200,
      'Give the prompt a name.'
    );
    requireValue(
      typeof template === 'string' && template.trim() && template.length <= 100000,
      'Add prompt text.'
    );
    const axes = req.body.axes || [];
    requireValue(Array.isArray(axes), 'Invalid variable definitions.');
    const t = {
      id: uid(),
      name: name.trim(),
      template,
      axes,
      version: hash(template).slice(0, 10),
      createdAt: now(),
    };
    store.save('templates', t);
    res.status(201).json(t);
  });
  app.post('/api/settings', (req, res) => {
    const s = req.body;
    requireValue(
      Number.isInteger(s.concurrency) && s.concurrency >= 1 && s.concurrency <= 32,
      'Concurrency must be 1–32.'
    );
    requireValue(
      s.prices && typeof s.prices === 'object' && !Array.isArray(s.prices),
      'Invalid price table.'
    );
    for (const [key, p] of Object.entries(s.prices)) {
      requireValue(key.length < 200 && p && typeof p === 'object', 'Invalid price entry.');
      for (const k of ['input', 'cached', 'output'])
        requireValue(
          typeof p[k] === 'number' && Number.isFinite(p[k]) && p[k] >= 0,
          'Prices must be nonnegative numbers.'
        );
      if (p.cacheWrite != null)
        requireValue(
          typeof p.cacheWrite === 'number' && Number.isFinite(p.cacheWrite) && p.cacheWrite >= 0,
          'Invalid cache-write price.'
        );
    }
    requireValue(
      Array.isArray(s.issueCatalog) && s.issueCatalog.length > 0 && s.issueCatalog.length <= 100,
      'Add 1–100 issue categories.'
    );
    const keys = new Set();
    for (const i of s.issueCatalog) {
      requireValue(
        i &&
          /^[a-z][a-z0-9_-]{0,60}$/.test(i.key) &&
          typeof i.label === 'string' &&
          i.label.trim() &&
          i.label.length < 200 &&
          !keys.has(i.key),
        'Issue keys must be unique lowercase names.'
      );
      keys.add(i.key);
    }
    requireValue(
      store.settings().issueCatalog.every((i) => keys.has(i.key)),
      'Keep existing issue categories so earlier reviews remain comparable.'
    );
    res.json(
      store.saveSettings({
        concurrency: s.concurrency,
        prices: s.prices,
        issueCatalog: s.issueCatalog,
      })
    );
  });
  app.use('/api', (_, res) => res.status(404).json({ error: 'API endpoint not found.' }));
  app.use((e, req, res, next) => {
    if (res.headersSent) return next(e);
    res
      .status(e.status || 500)
      .json({ error: e.status ? e.message : 'Unexpected server error. See the server log.' });
    if (!e.status) console.error(e);
  });
  return app;
}
