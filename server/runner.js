import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { now, uid, matrix, validateConfig, renderPrompt, hash, BadRequest } from './domain.js';
import { Telemetry, emptyTelemetry } from './telemetry.js';
import { finalizeRun, FINALIZATION_VERSION } from './finalize.js';
import { priceFor } from './pricing.js';

function processStart(pid) {
  try {
    return fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ')[19];
  } catch {
    return null;
  }
}
export function runProcessAlive(run) {
  if (!run.pid) return false;
  try {
    process.kill(run.pid, 0);
    if (process.platform === 'linux') {
      if (run.processStart && processStart(run.pid) !== run.processStart) return false;
      if (
        !run.workspace ||
        fs.realpathSync(`/proc/${run.pid}/cwd`) !== fs.realpathSync(run.workspace)
      )
        return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function commandFor(row, config) {
  if (row.provider === 'rehearsal')
    return {
      command: process.execPath,
      args: [fileURLToPath(new URL('../scripts/rehearsal.js', import.meta.url))],
    };
  if (row.provider === 'codex') {
    const args = [
      'exec',
      '--json',
      '--skip-git-repo-check',
      '--color',
      'never',
      '-m',
      row.model,
      '-c',
      'approval_policy="never"',
    ];
    if (row.effort !== 'default') args.push('-c', `model_reasoning_effort="${row.effort}"`);
    if (config.permissions === 'unrestricted')
      args.push('--dangerously-bypass-approvals-and-sandbox');
    else
      args.push(
        '--sandbox',
        'workspace-write',
        '-c',
        'sandbox_workspace_write.network_access=true'
      );
    args.push('-');
    return { command: 'codex', args };
  }
  const args = ['-p', '--verbose', '--output-format', 'stream-json', '--model', row.model];
  if (row.effort !== 'default') args.push('--effort', row.effort);
  if (config.permissions === 'unrestricted') args.push('--dangerously-skip-permissions');
  else
    args.push(
      '--permission-mode',
      'acceptEdits',
      '--allowedTools',
      'Read,Edit,Write,Glob,Grep,Bash,WebFetch,WebSearch'
    );
  return { command: 'claude', args };
}
export function artifacts(workspace) {
  const files = [];
  try {
    if (fs.lstatSync(workspace).isSymbolicLink()) return files;
  } catch {
    return files;
  }
  function walk(dir, depth) {
    if (depth > 8 || files.length > 1000) return;
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      if (
        f.name.startsWith('.') ||
        ['node_modules', 'vendor'].includes(f.name) ||
        f.isSymbolicLink()
      )
        continue;
      const absolute = path.join(dir, f.name);
      if (f.isDirectory()) walk(absolute, depth + 1);
      else if (f.isFile())
        files.push({ name: path.relative(workspace, absolute), size: fs.statSync(absolute).size });
    }
  }
  try {
    walk(workspace, 0);
  } catch {}
  return files;
}
function readReport(workspace, finalText) {
  let report = {};
  try {
    const p = path.join(workspace, 'hub-report.json');
    if (fs.lstatSync(p).isSymbolicLink() || fs.statSync(p).size > 500000) throw Error();
    report = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {}
  const extract = (title) => {
    const re = new RegExp(
      '(?:^|\\n)#{0,4}\\s*' +
        title +
        '[^\\n]*\\n([\\s\\S]*?)(?=\\n#{1,4} |\\n(?:Engine Feedback|Prompt Feedback|Source Information)|$)',
      'i'
    );
    return finalText.match(re)?.[1]?.trim() || '';
  };
  return {
    actualStack: String(report.actualStack || 'unknown').slice(0, 4000),
    artDirection: String(report.artDirection || 'unknown').slice(0, 4000),
    animation: String(report.animation || 'unknown').slice(0, 4000),
    engineFeedback: String(report.engineFeedback || extract('Engine Feedback')).slice(0, 20000),
    promptFeedback: String(report.promptFeedback || extract('Prompt Feedback')).slice(0, 20000),
    testingPerformed: String(report.testingPerformed || 'unknown').slice(0, 10000),
    issues: Array.isArray(report.issues)
      ? report.issues.filter((x) => typeof x === 'string').slice(0, 100)
      : [],
    source: Object.keys(report).length
      ? 'Agent report file'
      : 'Agent final response (when available)',
  };
}
export class Runner {
  constructor(store, opts = {}) {
    this.store = store;
    this.active = new Map();
    this.stopping = false;
    this.commandFactory = opts.commandFactory || commandFor;
    this.timer = null;
    this.finalizations = new Map();
  }
  recover() {
    // Never infer process completion from a stale flag. A live old process blocks replay.
    for (const run of this.store.runsWithStatus('running')) {
      const live = runProcessAlive(run);
      this.store.patch('runs', run.id, {
        status: live ? 'orphaned' : 'interrupted',
        endedAt: live ? null : now(),
        error: live
          ? 'The previous runner process is still alive. Stop this run before retrying; its completion cannot be confirmed after the server interruption.'
          : 'Server stopped before a terminal result was recorded. Retry creates a new attempt.',
        pid: run.pid,
      });
      this.store.patch('experiments', run.experimentId, { status: 'paused' });
    }
  }
  start() {
    this.recover();
    this.timer = setInterval(() => this.tick(), 350);
    this.timer.unref();
    this.tick();
    // Backfill old runs and resume an interrupted metadata pass. This never
    // launches a model or changes a run's execution status.
    void (async () => {
      for (const r of this.store.runSummaries())
        if (
          !['queued', 'running', 'orphaned'].includes(r.status) &&
          (r.finalization?.version !== FINALIZATION_VERSION ||
            ['pending', 'failed'].includes(r.finalization?.status))
        )
          await this.finalize(r.id);
    })();
  }
  finalize(id) {
    if (this.finalizations.has(id)) return this.finalizations.get(id);
    const run = this.store.get('runs', id);
    if (!run) throw new BadRequest('Run not found.', 404);
    if (['queued', 'running', 'orphaned'].includes(run.status))
      throw new BadRequest('Wait for the run to stop before collecting final usage.');
    this.store.patch('runs', id, { finalization: { ...run.finalization, status: 'pending' } });
    const work = finalizeRun(this.store, id)
      .catch((error) =>
        this.store.patch('runs', id, {
          finalization: {
            status: 'failed',
            version: FINALIZATION_VERSION,
            finalizedAt: now(),
            warnings: [error.message],
          },
        })
      )
      .finally(() => this.finalizations.delete(id));
    this.finalizations.set(id, work);
    return work;
  }
  create(raw) {
    const config = validateConfig(raw),
      rows = matrix(config),
      id = uid(),
      createdAt = now();
    const exp = {
      id,
      name: config.name,
      config,
      createdAt,
      status: 'draft',
      promptVersion: hash(config.template).slice(0, 10),
      parentId: raw.parentId || null,
    };
    this.store.transaction(() => {
      this.store.save('experiments', exp);
      rows.forEach((r, index) => this.store.save('runs', this.newRun(exp, r, index)));
    });
    return exp;
  }
  newRun(exp, row, index, parentId = null) {
    const id = uid(),
      createdAt = now();
    const prompt = renderPrompt(exp.config, row, id, createdAt, exp.promptVersion);
    return {
      id,
      experimentId: exp.id,
      sequence: index + 1,
      provider: row.provider,
      model: row.model,
      effort: row.effort,
      variables: row.variables,
      repeat: row.repeat,
      createdAt,
      status: 'queued',
      prompt,
      promptHash: hash(prompt),
      promptVersion: exp.promptVersion,
      startedAt: null,
      endedAt: null,
      durationMs: null,
      telemetry: emptyTelemetry(),
      review: null,
      report: null,
      artifacts: [],
      parentId,
      priceSnapshot: null,
    };
  }
  action(id, action) {
    const exp = this.store.get('experiments', id);
    if (!exp) throw new BadRequest('Experiment not found.', 404);
    if (['start', 'resume'].includes(action)) {
      if (!this.store.list('runs').some((r) => r.experimentId === id && r.status === 'queued'))
        throw new BadRequest('No queued runs. Retry a run or duplicate this experiment.');
      if (exp.status === 'draft') validateConfig(exp.config);
      this.store.patch('experiments', id, { status: 'running', pauseReason: null });
      this.tick();
    } else if (action === 'pause')
      this.store.patch('experiments', id, { status: 'paused', pauseReason: null });
    else if (action === 'cancel-queued') {
      const result = this.cancelQueued(id);
      return { ...this.store.get('experiments', id), ...result };
    } else if (action === 'cancel') {
      this.store.patch('experiments', id, { status: 'cancelled' });
      for (const r of this.store
        .list('runs')
        .filter((r) => r.experimentId === id && ['queued', 'running'].includes(r.status)))
        this.cancel(r.id);
    } else throw new BadRequest('Unknown experiment action.');
    return this.store.get('experiments', id);
  }
  settleExperiment(id) {
    const exp = this.store.get('experiments', id);
    const runs = this.store.runStates().filter((r) => r.experimentId === id);
    if (
      !exp ||
      !runs.length ||
      runs.some((r) => ['queued', 'running', 'orphaned'].includes(r.status))
    )
      return;
    if (exp.status === 'cancelled') return;
    const status = runs.every((r) => r.status === 'cancelled') ? 'cancelled' : 'completed';
    if (exp.status !== status) this.store.patch('experiments', id, { status, pauseReason: null });
  }
  cancelQueued(experimentId = null) {
    const queued = this.store
      .runStates()
      .filter((r) => r.status === 'queued' && (!experimentId || r.experimentId === experimentId));
    const experiments = [...new Set(queued.map((r) => r.experimentId))];
    this.store.transaction(() => {
      for (const r of queued)
        this.store.patch('runs', r.id, { status: 'cancelled', endedAt: now() });
      for (const id of experiments) this.settleExperiment(id);
    });
    return { cancelledCount: queued.length, experimentIds: experiments };
  }
  retry(id) {
    const run = this.store.get('runs', id);
    if (!run) throw new BadRequest('Run not found.', 404);
    if (['running', 'queued', 'orphaned'].includes(run.status))
      throw new BadRequest('This run must stop before it can be retried.');
    const exp = this.store.get('experiments', run.experimentId),
      count = this.store.list('runs').filter((r) => r.experimentId === exp.id).length;
    const next = this.newRun(exp, run, count, run.id);
    this.store.save('runs', next);
    if (['completed', 'cancelled'].includes(exp.status))
      this.store.patch('experiments', exp.id, { status: 'paused' });
    this.tick();
    return next;
  }
  cancel(id, reason = 'cancelled') {
    const run = this.store.get('runs', id);
    if (!run) throw new BadRequest('Run not found.', 404);
    const active = this.active.get(id);
    if (active) {
      active.stopReason = reason;
      this.terminate(active.child);
    } else if (run.status === 'queued')
      this.store.patch('runs', id, { status: reason, endedAt: now() });
    else if (run.status === 'orphaned') {
      if (runProcessAlive(run)) {
        try {
          process.kill(-run.pid, 'SIGTERM');
        } catch {}
        const timer = setTimeout(() => {
          if (runProcessAlive(run)) {
            try {
              process.kill(-run.pid, 'SIGKILL');
            } catch {}
          }
        }, 2000);
        timer.unref();
        this.store.patch('runs', id, { stopRequested: reason });
      } else this.store.patch('runs', id, { status: reason, endedAt: now(), pid: null });
    }
    this.settleExperiment(run.experimentId);
  }
  terminate(child) {
    if (!child.pid) return;
    const kill = (signal) => {
      try {
        process.kill(-child.pid, signal);
      } catch {
        try {
          child.kill(signal);
        } catch {}
      }
    };
    kill('SIGTERM');
    const timer = setTimeout(() => kill('SIGKILL'), 2000);
    timer.unref();
  }
  tick() {
    if (this.stopping) return;
    for (const r of this.store.runsWithStatus('orphaned'))
      if (!runProcessAlive(r))
        this.store.patch('runs', r.id, {
          status: r.stopRequested || 'interrupted',
          endedAt: now(),
          pid: null,
          error:
            'The previous runner process has stopped. Its terminal result was not captured; inspect files and retry if needed.',
          artifacts: r.workspace ? artifacts(r.workspace) : r.artifacts,
        });
    const exps = this.store.list('experiments'),
      runs = this.store.runStates();
    const eligible = new Set(exps.filter((e) => e.status === 'running').map((e) => e.id));
    let capacity =
      this.store.settings().concurrency -
      this.active.size -
      runs.filter((r) => r.status === 'orphaned').length;
    for (const r of runs)
      if (
        capacity > 0 &&
        r.status === 'queued' &&
        eligible.has(r.experimentId) &&
        !this.active.has(r.id)
      ) {
        capacity--;
        this.launch(
          this.store.get('runs', r.id),
          exps.find((e) => e.id === r.experimentId)
        );
      }
    for (const e of exps)
      if (
        e.status === 'running' &&
        !runs.some(
          (r) => r.experimentId === e.id && ['queued', 'running', 'orphaned'].includes(r.status)
        )
      )
        this.store.patch('experiments', e.id, { status: 'completed' });
    for (const e of exps)
      if (
        ['draft', 'paused'].includes(e.status) &&
        !runs.some(
          (r) => r.experimentId === e.id && ['queued', 'running', 'orphaned'].includes(r.status)
        )
      )
        this.settleExperiment(e.id);
  }
  launch(row, exp) {
    const dir = path.join(this.store.dir, 'runs', row.id),
      workspace = path.join(dir, 'workspace');
    fs.mkdirSync(workspace, { recursive: true });
    fs.writeFileSync(path.join(dir, 'prompt.txt'), row.prompt);
    const startedAt = now(),
      command = this.commandFactory(row, exp.config);
    const priceSnapshot = priceFor(row.provider, row.model, this.store.settings());
    const environment = {
      os: process.platform,
      release: os.release(),
      arch: process.arch,
      node: process.version,
      cliVersion: this.providerVersions?.[row.provider] || null,
    };
    this.store.patch('runs', row.id, {
      status: 'running',
      startedAt,
      command,
      workspace,
      priceSnapshot,
      priceCapturedAt: startedAt,
      environment,
    });
    const writeEvent = (e) => this.store.event(row.id, e),
      telemetry = new Telemetry(row.provider, writeEvent);
    writeEvent({ kind: 'status', text: `Started ${row.provider} · ${row.model} · ${row.effort}` });
    fs.writeFileSync(
      path.join(dir, 'execution.json'),
      JSON.stringify(
        { command, startedAt, priceSnapshot, environment, permissions: exp.config.permissions },
        null,
        2
      )
    );
    const env = { ...process.env, NO_COLOR: '1' };
    delete env.CLAUDECODE;
    let child;
    try {
      child = spawn(command.command, command.args, {
        cwd: workspace,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: true,
        shell: false,
      });
    } catch (e) {
      this.store.patch('runs', row.id, { status: 'failed', endedAt: now(), error: e.message });
      return;
    }
    const active = { child, stopReason: null };
    this.active.set(row.id, active);
    this.store.patch('runs', row.id, {
      pid: child.pid || null,
      processStart: child.pid ? processStart(child.pid) : null,
    });
    let buffer = '',
      stderr = '',
      error = null,
      closed = false,
      dirty = false;
    const stdoutFile = fs.openSync(path.join(dir, 'stdout.jsonl'), 'a'),
      stderrFile = fs.openSync(path.join(dir, 'stderr.log'), 'a');
    const consume = (line) => {
      if (!line.trim()) return;
      try {
        telemetry.accept(JSON.parse(line));
        dirty = true;
      } catch {
        writeEvent({ kind: 'log', text: line.slice(0, 2000) });
      }
    };
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      fs.writeSync(stdoutFile, chunk);
      buffer += chunk;
      let n;
      while ((n = buffer.indexOf('\n')) >= 0) {
        consume(buffer.slice(0, n));
        buffer = buffer.slice(n + 1);
      }
      if (buffer.length > 8e6) {
        writeEvent({
          kind: 'warning',
          text: 'A stream event exceeded 8 MB; the complete output remains in stdout.jsonl.',
        });
        buffer = '';
      }
    });
    child.stderr.on('data', (chunk) => {
      fs.writeSync(stderrFile, chunk);
      stderr = (stderr + chunk).slice(-16000);
      writeEvent({ kind: 'stderr', text: chunk.slice(-4000) });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(row.prompt);
    child.on('error', (e) => {
      error = e.message;
    });
    const update = setInterval(() => {
      if (dirty) {
        this.store.patch('runs', row.id, { telemetry: telemetry.value });
        dirty = false;
      }
    }, 1000);
    update.unref();
    const deadline = setTimeout(
      () => this.cancel(row.id, 'timed_out'),
      exp.config.timeoutMinutes * 60000
    );
    deadline.unref();
    child.on('close', (code) => {
      if (closed) return;
      closed = true;
      clearInterval(update);
      clearTimeout(deadline);
      if (buffer) consume(buffer);
      fs.closeSync(stdoutFile);
      fs.closeSync(stderrFile);
      // Dispose any servers left in the child's process group after the agent exits.
      this.terminate(child);
      const endedAt = now(),
        data = telemetry.end(),
        status =
          active.stopReason || (code === 0 && !error && !telemetry.failed ? 'completed' : 'failed');
      const report = readReport(workspace, data.finalText),
        files = artifacts(workspace);
      fs.writeFileSync(path.join(dir, 'final-response.txt'), data.finalText);
      const failure =
        error ||
        telemetry.failed ||
        (code !== 0 ? stderr.trim().slice(-5000) || `Process exited ${code}` : null);
      this.store.patch('runs', row.id, {
        status,
        endedAt,
        durationMs: Date.parse(endedAt) - Date.parse(startedAt),
        telemetry: data,
        report,
        artifacts: files,
        exitCode: code,
        error: failure,
        pid: null,
      });
      if (
        status === 'failed' &&
        /quota|rate.?limit|usage.?limit|hit your|out of credits|insufficient.*credits|too many requests|unauthori[sz]ed|not logged in/i.test(
          failure || ''
        ) &&
        this.store.get('experiments', exp.id)?.status === 'running' &&
        this.store.list('runs').some((r) => r.experimentId === exp.id && r.status === 'queued')
      ) {
        this.store.patch('experiments', exp.id, {
          status: 'paused',
          pauseReason: `${row.provider} reported an account or usage limit. Remaining runs are queued. Resolve the limit and resume. ${failure.slice(0, 500)}`,
        });
      }
      writeEvent({ kind: 'status', text: `Run ${status}.` });
      this.active.delete(row.id);
      void this.finalize(row.id);
      this.tick();
    });
  }
  async shutdown() {
    this.stopping = true;
    clearInterval(this.timer);
    for (const [id] of this.active) this.cancel(id, 'interrupted');
    const limit = Date.now() + 5000;
    while (this.active.size && Date.now() < limit) await new Promise((r) => setTimeout(r, 50));
    await Promise.allSettled([...this.finalizations.values()]);
  }
}
