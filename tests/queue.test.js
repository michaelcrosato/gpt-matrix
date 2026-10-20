import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { Store } from '../server/store.js';
import { Runner } from '../server/runner.js';
import { apiApp, artifactApp } from '../server/app.js';
const config = () => ({
  name: 'Queue verification',
  template: 'Rehearsal {{SOURCE}}',
  models: [{ provider: 'rehearsal', model: 'fixture', efforts: ['low'] }],
  axes: [
    { key: 'SOURCE', label: 'Source', options: [{ label: 'A', value: 'alpha', enabled: true }] },
  ],
  repeats: 3,
  timeoutMinutes: 1,
  permissions: 'workspace',
  randomize: false,
  captureReport: true,
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 10000) {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > ms) throw Error('Timed out waiting for queue condition');
    await sleep(30);
  }
}
function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gpt-hub-test-')),
    store = new Store(dir);
  store.saveSettings({ ...store.settings(), concurrency: 2 });
  const runner = new Runner(store);
  return {
    dir,
    store,
    runner,
    cleanup: async () => {
      await runner.shutdown();
      store.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
test('Queue honors concurrency, pause, resume, isolated artifacts, and retries preserve originals', async () => {
  const s = setup();
  try {
    const exp = s.runner.create(config());
    assert.equal(s.store.list('runs').length, 3);
    s.runner.start();
    s.runner.action(exp.id, 'start');
    assert.equal(s.runner.active.size, 2);
    s.runner.action(exp.id, 'pause');
    await until(() => s.runner.active.size === 0);
    assert.equal(s.store.list('runs').filter((r) => r.status === 'completed').length, 2);
    assert.equal(s.store.list('runs').filter((r) => r.status === 'queued').length, 1);
    s.runner.action(exp.id, 'resume');
    await until(() => s.store.get('experiments', exp.id).status === 'completed');
    const first = s.store.list('runs')[0];
    assert.ok(first.artifacts.some((f) => f.name === 'rehearsal.html'));
    assert.ok(first.durationMs > 0);
    assert.equal(first.telemetry.inputTokens, null);
    assert.equal(first.telemetry.costUsd, null);
    assert.ok(fs.existsSync(path.join(s.dir, 'runs', first.id, 'prompt.txt')));
    assert.match(first.report.actualStack, /local fixture/);
    const retry = s.runner.retry(first.id);
    assert.notEqual(retry.id, first.id);
    assert.equal(retry.parentId, first.id);
    assert.equal(s.store.get('runs', first.id).status, 'completed');
    assert.equal(s.store.get('experiments', exp.id).status, 'paused');
    s.runner.action(exp.id, 'start');
    await until(() => s.store.get('runs', retry.id).status === 'completed');
    assert.notEqual(s.store.get('runs', retry.id).workspace, first.workspace);
  } finally {
    await s.cleanup();
  }
});
test('Stop all cancels running and queued processes; restart preserves evidence and pauses', async () => {
  const s = setup();
  try {
    const exp = s.runner.create(config());
    s.runner.start();
    s.runner.action(exp.id, 'start');
    s.runner.action(exp.id, 'cancel');
    await until(() => s.runner.active.size === 0);
    assert.ok(s.store.list('runs').every((r) => r.status === 'cancelled'));
    const r = s.store.list('runs')[0];
    s.store.patch('runs', r.id, { status: 'running', pid: 99999999 });
    s.store.patch('experiments', exp.id, { status: 'running' });
    s.runner.recover();
    assert.equal(s.store.get('runs', r.id).status, 'interrupted');
    assert.equal(s.store.get('experiments', exp.id).status, 'paused');
    assert.equal(s.runner.active.size, 0);
  } finally {
    await s.cleanup();
  }
});
test('HTTP flow persists review and exports; artifact origin and path protections hold', async () => {
  const s = setup(),
    app = apiApp(s.store, s.runner, { providers: [] });
  const server = app.listen(0, '127.0.0.1'),
    artifact = artifactApp(s.store).listen(0, '127.0.0.1');
  await Promise.all([
    new Promise((r) => server.once('listening', r)),
    new Promise((r) => artifact.once('listening', r)),
  ]);
  const base = `http://127.0.0.1:${server.address().port}`,
    preview = `http://127.0.0.1:${artifact.address().port}`;
  const post = (url, data, headers = {}) =>
    fetch(base + url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(data),
    });
  try {
    const c = config();
    c.repeats = 1;
    const response = await post('/api/experiments', c);
    assert.equal(response.status, 201);
    const e = await response.json();
    await post(`/api/experiments/${e.id}/start`, {});
    await until(() => s.store.list('runs')[0].status === 'completed');
    const r = s.store.list('runs')[0];
    const saved = await post(`/api/runs/${r.id}/review`, {
      verdict: 'pass',
      score: 4,
      notes: 'Reviewed',
      issues: [{ key: 'boot', outcome: 'clear', testMinutes: 1 }],
    });
    assert.equal(saved.status, 200);
    assert.equal(s.store.get('runs', r.id).review.verdict, 'pass');
    const a = await (await fetch(base + '/api/analysis?includeRehearsal=true')).json();
    assert.equal(a.reviewed, 1);
    assert.equal(a.issues.find((i) => i.key === 'boot').checked, 1);
    assert.match(await (await fetch(base + '/api/export?format=csv')).text(), /Reviewed/);
    const ex = await (await fetch(base + '/api/export')).json();
    assert.equal(ex.runs[0].prompt, r.prompt);
    assert.equal(
      (await post('/api/settings', s.store.settings(), { Origin: preview })).status,
      403
    );
    assert.equal(
      (
        await fetch(base + '/api/experiments', {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: '{}',
        })
      ).status,
      415
    );
    const invalidHost = await new Promise((resolve, reject) => {
      http
        .get(base + '/api/state', { headers: { Host: 'malicious.example' } }, (res) => {
          res.resume();
          resolve(res.statusCode);
        })
        .on('error', reject);
    });
    assert.equal(invalidHost, 403);
    const output = await fetch(`${preview}/${r.id}/rehearsal.html`);
    assert.equal(output.status, 200);
    assert.match(output.headers.get('content-security-policy'), /sandbox/);
    fs.symlinkSync('/etc/passwd', path.join(r.workspace, 'leak.txt'));
    assert.equal((await fetch(`${preview}/${r.id}/leak.txt`)).status, 403);
    assert.equal(
      (await fetch(base + `/api/runs/${r.id}/download?file=../../../../etc/passwd`)).status,
      403
    );
  } finally {
    await new Promise((r) => server.close(r));
    await new Promise((r) => artifact.close(r));
    await s.cleanup();
  }
});
test('A provider account limit pauses pending combinations without retrying', async () => {
  const s = setup();
  try {
    s.store.saveSettings({ ...s.store.settings(), concurrency: 1 });
    s.runner.commandFactory = () => ({
      command: process.execPath,
      args: [
        '-e',
        `console.log(JSON.stringify({type:'result',is_error:true,subtype:'error',result:"You've hit your weekly limit",usage:{input_tokens:0,output_tokens:0},total_cost_usd:0}));`,
      ],
    });
    const c = config();
    c.models = [{ provider: 'claude', model: 'sonnet', efforts: ['low'] }];
    const e = s.runner.create(c);
    s.runner.start();
    s.runner.action(e.id, 'start');
    await until(() => s.runner.active.size === 0);
    assert.equal(s.store.get('experiments', e.id).status, 'paused');
    assert.equal(s.store.list('runs').filter((r) => r.status === 'queued').length, 2);
    assert.equal(s.store.list('runs').filter((r) => r.status === 'failed').length, 1);
  } finally {
    await s.cleanup();
  }
});
test('An actual live process is not replayed after recovery and can be stopped', async () => {
  const s = setup();
  let child;
  try {
    const c = config();
    c.repeats = 1;
    const e = s.runner.create(c),
      r = s.store.list('runs')[0];
    const workspace = path.join(s.dir, 'runs', r.id, 'workspace');
    fs.mkdirSync(workspace, { recursive: true });
    child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {
      cwd: workspace,
      detached: true,
      stdio: 'ignore',
    });
    await new Promise((resolve) => child.once('spawn', resolve));
    s.store.patch('runs', r.id, { status: 'running', pid: child.pid, workspace });
    s.store.patch('experiments', e.id, { status: 'running' });
    s.runner.start();
    assert.equal(s.store.get('runs', r.id).status, 'orphaned');
    assert.equal(s.store.get('experiments', e.id).status, 'paused');
    assert.equal(s.runner.active.size, 0);
    assert.throws(() => s.runner.retry(r.id), /must stop/);
    s.runner.cancel(r.id);
    await until(() => s.store.get('runs', r.id).status === 'cancelled');
    assert.ok(s.store.get('runs', r.id).endedAt);
  } finally {
    if (child?.pid)
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {}
    await s.cleanup();
  }
});
test('Run deadlines terminate the process and preserve a timed-out attempt', async () => {
  const s = setup();
  try {
    s.runner.commandFactory = () => ({
      command: process.execPath,
      args: ['-e', 'setInterval(()=>{},1000)'],
    });
    const c = config();
    c.repeats = 1;
    const e = s.runner.create(c);
    // Accelerate this internal deadline test without weakening public input validation.
    const launch = s.runner.launch.bind(s.runner);
    s.runner.launch = (row, experiment) =>
      launch(row, { ...experiment, config: { ...experiment.config, timeoutMinutes: 0.001 } });
    s.runner.start();
    s.runner.action(e.id, 'start');
    await until(() => s.runner.active.size === 0);
    const r = s.store.list('runs')[0];
    assert.equal(r.status, 'timed_out');
    assert.ok(r.durationMs >= 50);
    assert.equal(r.telemetry.costUsd, null);
  } finally {
    await s.cleanup();
  }
});
test('Process exit automatically finalizes the trailing usage event into the HTML', async () => {
  const s = setup();
  try {
    s.store.saveSettings({
      ...s.store.settings(),
      prices: { 'codex:fixture': { input: 2, cached: 0.2, output: 10 } },
    });
    s.runner.commandFactory = () => ({
      command: process.execPath,
      args: [
        '-e',
        `
      require('fs').writeFileSync('game.html','<!doctype html><html><head></head><body><span data-gpt-hub-usage>Pending usage</span></body></html>');
      console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'Done'}}));
      setTimeout(()=>process.stdout.write(JSON.stringify({type:'turn.completed',usage:{input_tokens:1024,cached_input_tokens:512,cache_write_input_tokens:0,output_tokens:128}})),30);
    `,
      ],
    });
    const c = config();
    c.repeats = 1;
    c.models = [{ provider: 'codex', model: 'fixture', efforts: ['low'] }];
    const e = s.runner.create(c);
    s.runner.start();
    s.runner.action(e.id, 'start');
    await until(() => s.store.list('runs')[0].finalization?.status === 'complete');
    const r = s.store.list('runs')[0];
    assert.equal(r.status, 'completed');
    assert.equal(r.finalization.metrics.totalTokens, 1152);
    assert.ok(Math.abs(r.telemetry.costUsd - 0.0024064) < 1e-10);
    assert.match(fs.readFileSync(path.join(r.workspace, 'game.html'), 'utf8'), /1,152 total/);
  } finally {
    await s.cleanup();
  }
});
test('Cancelling waiting runs leaves an active process intact and keeps every record', async () => {
  const s = setup();
  try {
    s.store.saveSettings({ ...s.store.settings(), concurrency: 1 });
    const e = s.runner.create(config());
    const otherConfig = config();
    otherConfig.repeats = 1;
    const other = s.runner.create(otherConfig);
    s.runner.start();
    s.runner.action(e.id, 'start');
    const active = [...s.runner.active.values()][0].child.pid;
    const result = s.runner.action(e.id, 'cancel-queued');
    assert.equal(result.cancelledCount, 2);
    assert.equal([...s.runner.active.values()][0].child.pid, active);
    assert.equal(s.store.list('runs').filter((r) => r.status === 'running').length, 1);
    assert.equal(s.store.get('experiments', e.id).status, 'running');
    assert.equal(s.store.list('runs').find((r) => r.experimentId === other.id).status, 'queued');
    await until(() => s.store.get('experiments', e.id).status === 'completed');
    assert.equal(s.store.list('runs').filter((r) => r.status === 'completed').length, 1);
    assert.equal(s.runner.cancelQueued().cancelledCount, 1);
    assert.equal(s.store.get('experiments', other.id).status, 'cancelled');
    assert.equal(s.store.list('runs').length, 4);
    assert.equal(s.runner.cancelQueued().cancelledCount, 0);
  } finally {
    await s.cleanup();
  }
});
test('Queued cancellation APIs are scoped and an individually cancelled draft settles correctly', async () => {
  const s = setup(),
    app = apiApp(s.store, s.runner),
    server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (url, data = {}) => {
    const r = await fetch(base + url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    assert.ok(r.ok);
    return r.json();
  };
  try {
    const a = s.runner.create(config()),
      b = s.runner.create(config());
    const first = await post(`/api/experiments/${a.id}/cancel-queued`);
    assert.equal(first.cancelledCount, 3);
    assert.equal(first.status, 'cancelled');
    assert.equal(s.store.get('experiments', b.id).status, 'draft');
    const all = await post('/api/runs/cancel-queued');
    assert.equal(all.cancelledCount, 3);
    assert.equal(s.store.get('experiments', b.id).status, 'cancelled');
    const c = config();
    c.repeats = 1;
    const e = s.runner.create(c),
      run = s.store.list('runs').find((r) => r.experimentId === e.id);
    await post(`/api/runs/${run.id}/cancel`);
    assert.equal(s.store.get('experiments', e.id).status, 'cancelled');
  } finally {
    await new Promise((r) => server.close(r));
    await s.cleanup();
  }
});
