import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'parse5';
import { hash, now, uid } from './domain.js';
import { priceFor, estimateCost } from './pricing.js';
import { terminalUsage, codexSessionUsage } from './usage-evidence.js';

export const FINALIZATION_VERSION = 1;
const unknownUsage =
  /\bUsage(?:[ \t]+and[ \t]+cost|,[ \t]*cost[ \t]+and[ \t]+token[ \t]+counts)?[ \t]*:[ \t]*unknown(?:[ \t]*[;,.][ \t]*(?:not estimated(?: here)?|recorded by (?:the )?runner|runner records usage|no estimates?))*[.;]?/gi;
const hook = /(<span\b[^>]*\bdata-gpt-hub-usage\b[^>]*>)[^<>"'`]*(<\/span>)/gi;
const numericKeys = [
  'inputTokens',
  'cachedTokens',
  'cacheWriteTokens',
  'outputTokens',
  'reasoningTokens',
];
function atomicWrite(file, text) {
  const tmp = path.join(path.dirname(file), '.hub-finalize-' + uid());
  try {
    fs.writeFileSync(tmp, text, { flag: 'wx' });
    fs.renameSync(tmp, file);
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {}
  }
}
function n(value) {
  return value == null ? 'unknown' : value.toLocaleString('en-US');
}
export function usageSummary(metrics) {
  const seconds = metrics.sessionTimeMs == null ? null : Math.round(metrics.sessionTimeMs / 1000);
  const time =
    seconds == null
      ? 'unknown'
      : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
  const cost =
    metrics.costUsd == null
      ? 'unknown'
      : `$${metrics.costUsd.toFixed(6)} USD (${metrics.costSource}; not subscription billing)`;
  const partial =
    metrics.finalUsageReceived === false && metrics.inputTokens != null
      ? 'Last reported usage (final provider event missing). '
      : '';
  return `${partial}Usage: Session time ${time}; tokens ${n(metrics.totalTokens)} total (${n(metrics.inputTokens)} input including ${n(metrics.cachedTokens)} cached and ${n(metrics.cacheWriteTokens)} cache-write; ${n(metrics.outputTokens)} output including ${n(metrics.reasoningTokens)} reasoning); API cost ${cost}.`;
}
export function stampHtml(source, metrics) {
  const doc = parse(source, { sourceCodeLocationInfo: true }),
    patches = [];
  const summary = usageSummary(metrics);
  let visibleReplacements = 0,
    headEnd = null;
  function visit(node, parent) {
    const loc = node.sourceCodeLocation;
    if (node.tagName === 'head' && loc?.endTag) headEnd = loc.endTag.startOffset;
    if (
      node.tagName === 'span' &&
      node.attrs.some((a) => a.name === 'data-gpt-hub-usage') &&
      loc?.startTag &&
      loc?.endTag
    ) {
      patches.push([loc.startTag.endOffset, loc.endTag.startOffset, summary]);
      visibleReplacements++;
      return;
    }
    if (
      loc &&
      (node.nodeName === '#text' || node.nodeName === '#comment') &&
      !['style', 'textarea'].includes(parent?.tagName)
    ) {
      const original = source.slice(loc.startOffset, loc.endOffset);
      let count = 0;
      let next = original.replace(unknownUsage, () => {
        count++;
        return summary;
      });
      if (parent?.tagName === 'script')
        next = next.replace(hook, (_, open, close) => {
          count++;
          return open + summary + close;
        });
      if (next !== original) {
        patches.push([loc.startOffset, loc.endOffset, next]);
        if (node.nodeName !== '#comment') visibleReplacements += count;
      }
    }
    for (const child of node.childNodes || []) visit(child, node);
    if (node.content) visit(node.content, node);
  }
  visit(doc, null);
  // Escape '<' so strings cannot close the JSON script or the HTML comment.
  const json = JSON.stringify(metrics, null, 2)
    .replaceAll('<', '\\u003c')
    .replaceAll('--', '\\u002d\\u002d');
  const data = `\n<script type="application/json" id="gpt-hub-run-metrics">${json}</script>\n`;
  const heading = `\n<!-- GPT-HUB FINAL METRICS\nMeasured after the agent exited.\n${summary}\nRun ID: ${metrics.runId}\nFinalized: ${metrics.finalizedAt}\nEND GPT-HUB FINAL METRICS -->\n`;
  const doctype = /^\s*<!doctype[^>]*>/i.exec(source);
  patches.push([doctype ? doctype[0].length : 0, doctype ? doctype[0].length : 0, heading]);
  patches.push([headEnd ?? source.length, headEnd ?? source.length, data]);
  for (const [start, end, text] of patches.sort((a, b) => b[0] - a[0]))
    source = source.slice(0, start) + text + source.slice(end);
  return { html: source, visibleReplacements };
}
function inWorkspace(root, name) {
  const candidate = path.resolve(root, name);
  if (
    !candidate.startsWith(root + path.sep) ||
    fs.realpathSync(candidate) !== candidate ||
    !fs.statSync(candidate).isFile()
  )
    throw Error('File leaves the run workspace.');
  return candidate;
}
function backedUpSource(dir, file, name, previous) {
  const backup = path.resolve(dir, 'original-artifacts', name);
  const base = path.resolve(dir, 'original-artifacts');
  if (!backup.startsWith(base + path.sep)) throw Error('Invalid original-artifact path.');
  const current = fs.readFileSync(file, 'utf8'),
    currentHash = hash(current);
  fs.mkdirSync(path.dirname(backup), { recursive: true });
  if (fs.realpathSync(path.dirname(backup)) !== path.dirname(backup))
    throw Error('Invalid backup directory.');
  if (!fs.existsSync(backup)) fs.writeFileSync(backup, current, { flag: 'wx' });
  if (fs.lstatSync(backup).isSymbolicLink() || fs.realpathSync(backup) !== backup)
    throw Error('Invalid backup path.');
  const original = fs.readFileSync(backup, 'utf8'),
    originalHash = hash(original);
  if (currentHash !== originalHash && currentHash !== previous?.publishedHash)
    throw Error(
      'File changed since finalization; kept your edits. Original remains in original-artifacts.'
    );
  return { original, originalHash };
}

export async function finalizeRun(store, id, { codexHome } = {}) {
  let run = store.get('runs', id);
  if (!run || ['queued', 'running', 'orphaned'].includes(run.status))
    throw Error('Final usage can be collected only after the process stops.');
  const dir = path.resolve(store.dir, 'runs', id);
  if (!run.workspace || !fs.existsSync(run.workspace))
    return store.patch('runs', id, {
      finalization: {
        status: 'unavailable',
        version: FINALIZATION_VERSION,
        finalizedAt: now(),
        warnings: ['No run workspace was created.'],
      },
    });
  const workspace = fs.realpathSync(run.workspace),
    expected = path.join(fs.realpathSync(store.dir), 'runs', id, 'workspace');
  if (workspace !== expected) throw Error('Invalid run workspace.');
  const manifestPath = path.join(dir, 'finalization.json');
  let previous = {};
  try {
    previous = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch {}
  const warnings = [],
    trail = await terminalUsage(run.provider, path.join(dir, 'stdout.jsonl'));
  const telemetry = { ...run.telemetry };
  // Replace totals from a fresh replay. Never add a reconciliation to old totals.
  if (trail.received)
    for (const k of [...numericKeys, 'usageSource'])
      if (trail.telemetry[k] != null) telemetry[k] = trail.telemetry[k];
  if (trail.telemetry.sessionId) telemetry.sessionId = trail.telemetry.sessionId;
  telemetry.observedModels = [
    ...new Set([...(telemetry.observedModels || []), ...trail.telemetry.observedModels]),
  ];
  run = { ...run, telemetry };
  let session = await codexSessionUsage(run, codexHome);
  // Once collected, request evidence remains usable even if the CLI rotates
  // its own session files. Only reuse evidence belonging to this exact prompt.
  if (!session)
    try {
      const saved = JSON.parse(fs.readFileSync(path.join(dir, 'usage-evidence.json'), 'utf8'));
      if (
        saved.metrics?.runId === id &&
        saved.metrics.promptHash === run.promptHash &&
        Array.isArray(saved.requests) &&
        saved.requests.length
      )
        session = {
          file: saved.sessionFile,
          model: saved.metrics.observedModels?.at(-1),
          total: null,
          requests: saved.requests,
          retained: true,
        };
    } catch {}
  if (session?.total) {
    if (!trail.received) {
      for (const k of numericKeys) if (session.total[k] != null) telemetry[k] = session.total[k];
      telemetry.usageSource = 'Codex session usage record';
    } else if (
      numericKeys.some(
        (k) => telemetry[k] != null && session.total[k] != null && telemetry[k] !== session.total[k]
      )
    )
      warnings.push(
        'Terminal totals differ from the session trace; terminal totals were retained.'
      );
    for (const k of numericKeys)
      if (telemetry[k] == null && session.total[k] != null) telemetry[k] = session.total[k];
    if (session.model)
      telemetry.observedModels = [...new Set([...telemetry.observedModels, session.model])];
  }
  // Existing custom price snapshots take precedence. A missing price can be
  // filled after the run; keep its source and the date of the new snapshot.
  const rate = run.priceSnapshot || priceFor(run.provider, run.model, store.settings());
  let estimate = null;
  if (trail.telemetry.costUsd != null) {
    telemetry.costUsd = trail.telemetry.costUsd;
    telemetry.costSource = trail.telemetry.costSource;
  } else if (telemetry.costUsd == null || !telemetry.costSource?.startsWith('CLI-reported')) {
    estimate = estimateCost(telemetry, rate, session?.requests || [], run.model);
    telemetry.costUsd = estimate.costUsd;
    telemetry.costSource = estimate.source || null;
  }
  let durationMs = run.durationMs;
  // Recovery observation timestamps are not proof of the actual exit time.
  if (
    durationMs == null &&
    ['completed', 'failed', 'timed_out', 'cancelled'].includes(run.status) &&
    run.startedAt &&
    run.endedAt
  )
    durationMs = Math.max(0, Date.parse(run.endedAt) - Date.parse(run.startedAt));
  const finalizedAt = now(),
    metrics = {
      schemaVersion: 1,
      runId: id,
      status: run.status,
      provider: run.provider,
      requestedModel: run.model,
      observedModels: telemetry.observedModels,
      effort: run.effort,
      promptHash: run.promptHash,
      startedAt: run.startedAt,
      endedAt: run.endedAt,
      sessionTimeMs: durationMs,
      sessionTimeSource: durationMs == null ? 'unknown' : 'Runner process wall clock',
      providerDurationMs: trail.reportedDurationMs,
      ...Object.fromEntries(numericKeys.map((k) => [k, telemetry[k]])),
      totalTokens:
        telemetry.inputTokens != null && telemetry.outputTokens != null
          ? telemetry.inputTokens + telemetry.outputTokens
          : null,
      usageSource: telemetry.usageSource,
      costUsd: telemetry.costUsd,
      costSource: telemetry.costSource,
      costAssumptions: estimate?.assumptions || null,
      costUnavailableReason: telemetry.costUsd == null ? estimate?.reason || 'Not reported' : null,
      priceSnapshot: rate,
      finalUsageReceived: trail.received,
      requestCount: session?.requests.length || 0,
      finalizedAt,
    };
  atomicWrite(
    path.join(dir, 'usage-evidence.json'),
    JSON.stringify(
      {
        terminalUsageReceived: trail.received,
        sessionFile: session?.file || null,
        requests: session?.requests || [],
        metrics,
      },
      null,
      2
    )
  );
  atomicWrite(
    path.join(workspace, 'hub-run-metrics.json'),
    JSON.stringify(metrics, null, 2) + '\n'
  );
  const files = {};
  let htmlCount = 0,
    visibleCount = 0;
  for (const item of run.artifacts.filter((a) => /\.html?$/i.test(a.name))) {
    try {
      const file = inWorkspace(workspace, item.name);
      const { original, originalHash } = backedUpSource(
        dir,
        file,
        item.name,
        previous.files?.[item.name]
      );
      const result = stampHtml(original, metrics);
      atomicWrite(file, result.html);
      files[item.name] = {
        originalHash,
        publishedHash: hash(result.html),
        visibleReplacements: result.visibleReplacements,
      };
      htmlCount++;
      visibleCount += result.visibleReplacements;
    } catch (e) {
      warnings.push(`${item.name}: ${e.message}`);
      if (previous.files?.[item.name]) files[item.name] = previous.files[item.name];
    }
  }
  const reportPath = path.join(workspace, 'hub-report.json');
  if (fs.existsSync(reportPath))
    try {
      inWorkspace(workspace, 'hub-report.json');
      const { original, originalHash } = backedUpSource(
        dir,
        reportPath,
        'hub-report.json',
        previous.files?.['hub-report.json']
      );
      const report = JSON.parse(original);
      if (!report || typeof report !== 'object' || Array.isArray(report))
        throw Error('Expected a report object.');
      const text = JSON.stringify({ ...report, runnerUsage: metrics }, null, 2) + '\n';
      atomicWrite(reportPath, text);
      files['hub-report.json'] = { originalHash, publishedHash: hash(text) };
    } catch (e) {
      warnings.push(`hub-report.json: ${e.message}`);
      if (previous.files?.['hub-report.json'])
        files['hub-report.json'] = previous.files['hub-report.json'];
    }
  atomicWrite(
    path.join(dir, 'final-response.txt'),
    (telemetry.finalText || '') +
      '\n\nGPT Hub final usage (recorded after execution)\n' +
      usageSummary(metrics) +
      '\n'
  );
  const finalization = {
    status: warnings.length ? 'partial' : 'complete',
    version: FINALIZATION_VERSION,
    finalizedAt,
    htmlCount,
    visibleCount,
    warnings,
    metrics,
    costUnavailableReason: metrics.costUnavailableReason,
  };
  atomicWrite(manifestPath, JSON.stringify({ ...finalization, files }, null, 2));
  const artifacts = run.artifacts.map((a) => {
    try {
      return { ...a, size: fs.statSync(inWorkspace(workspace, a.name)).size };
    } catch {
      return a;
    }
  });
  const metricsFile = {
    name: 'hub-run-metrics.json',
    size: fs.statSync(path.join(workspace, 'hub-run-metrics.json')).size,
  };
  if (!artifacts.some((a) => a.name === metricsFile.name)) artifacts.push(metricsFile);
  else
    artifacts.splice(
      artifacts.findIndex((a) => a.name === metricsFile.name),
      1,
      metricsFile
    );
  return store.patch('runs', id, {
    telemetry,
    durationMs,
    priceSnapshot: rate,
    priceCapturedAt: run.priceCapturedAt || finalizedAt,
    finalization,
    artifacts,
    report: run.report ? { ...run.report, runnerUsage: metrics } : null,
  });
}
