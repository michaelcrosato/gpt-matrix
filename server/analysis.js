const sum = (a) => a.reduce((s, v) => s + v, 0);
const avg = (a) => (a.length ? sum(a) / a.length : null);
const known = (a) => a.filter((v) => typeof v === 'number' && Number.isFinite(v));
export function analyze(
  runs,
  settings,
  { groupBy = 'testing', includeRehearsal = false, experimentId = '' } = {}
) {
  const data = runs.filter(
    (r) =>
      (includeRehearsal || r.provider !== 'rehearsal') &&
      (!experimentId || r.experimentId === experimentId) &&
      r.startedAt
  );
  const labels = (r) => {
    if (groupBy === 'model') return `${r.provider} · ${r.model}`;
    if (groupBy === 'effort') return r.effort;
    if (groupBy === 'model_effort') return `${r.model} · ${r.effort}`;
    if (groupBy === 'actualStack')
      return r.review?.actualStack || r.report?.actualStack || 'unknown';
    if (groupBy === 'prompt') return r.promptVersion;
    if (groupBy === 'experiment') return r.experimentId;
    return (
      r.variables[groupBy === 'testing' ? 'TESTING' : groupBy === 'stack' ? 'STACK' : groupBy]
        ?.label || 'Not specified'
    );
  };
  const buckets = new Map();
  for (const r of data) {
    const label = labels(r);
    if (!buckets.has(label)) buckets.set(label, []);
    buckets.get(label).push(r);
  }
  const groups = [...buckets]
    .map(([label, rows]) => {
      const reviewed = rows.filter((r) => r.review && r.review.verdict !== 'unreviewed'),
        passed = reviewed.filter((r) => r.review.verdict === 'pass');
      const cost = known(rows.map((r) => r.telemetry.costUsd)),
        tokens = known(
          rows.map((r) =>
            r.telemetry.inputTokens == null || r.telemetry.outputTokens == null
              ? null
              : r.telemetry.inputTokens + r.telemetry.outputTokens
          )
        );
      const time = known(rows.map((r) => r.durationMs)),
        score = known(reviewed.map((r) => r.review.score));
      const testing = known(
        rows.map((r) =>
          r.review?.testingMinutes != null
            ? r.review.testingMinutes * 60000
            : r.telemetry.toolCalls > 0
              ? r.telemetry.testingMs
              : null
        )
      );
      return {
        label,
        runs: rows.length,
        finished: rows.filter((r) => r.endedAt).length,
        reviewed: reviewed.length,
        passed: passed.length,
        passRate: reviewed.length ? passed.length / reviewed.length : null,
        score: avg(score),
        meanTokens: avg(tokens),
        tokenCoverage: tokens.length,
        meanMs: avg(time),
        meanCost: avg(cost),
        costCoverage: cost.length,
        totalCost: cost.length ? sum(cost) : null,
        meanTestingMs: avg(testing),
        testingCoverage: testing.length,
        totalMs: sum(time),
        costPerPass:
          passed.length && reviewed.length === rows.length && cost.length === rows.length
            ? sum(cost) / passed.length
            : null,
        timePerPass:
          passed.length && reviewed.length === rows.length && time.length === rows.length
            ? sum(time) / passed.length
            : null,
      };
    })
    .sort((a, b) => b.runs - a.runs);
  const issues = settings.issueCatalog
    .map((issue) => {
      const observations = data.flatMap((r) =>
        (r.review?.issues || []).filter((i) => i.key === issue.key && i.outcome !== 'untested')
      );
      const found = observations.filter((i) => i.outcome === 'found').length;
      const tests = known(observations.map((i) => i.testMinutes)),
        fixes = known(observations.filter((i) => i.outcome === 'found').map((i) => i.fixMinutes));
      return {
        ...issue,
        checked: observations.length,
        found,
        rate: observations.length ? found / observations.length : null,
        testMinutes: tests.length ? sum(tests) : null,
        fixMinutes: fixes.length ? sum(fixes) : null,
        testTimeCoverage: tests.length,
        fixTimeCoverage: fixes.length,
        zeroUpperBound:
          observations.length && !found ? 1 - Math.pow(0.05, 1 / observations.length) : null,
      };
    })
    .sort((a, b) => b.found - a.found || b.checked - a.checked);
  const feedback = data
    .filter(
      (r) =>
        r.report?.engineFeedback ||
        r.report?.promptFeedback ||
        r.review?.engineFeedback ||
        r.review?.promptFeedback
    )
    .map((r) => ({
      runId: r.id,
      experimentId: r.experimentId,
      source: r.variables.SOURCE?.label || r.model,
      model: r.model,
      testing: r.variables.TESTING?.label || 'Not specified',
      verdict: r.review?.verdict || 'unreviewed',
      actualStack: r.review?.actualStack || r.report?.actualStack || 'unknown',
      engine: r.review?.engineFeedback || r.report?.engineFeedback || '',
      prompt: r.review?.promptFeedback || r.report?.promptFeedback || '',
      agentIssues: r.report?.issues || [],
    }));
  const tags = new Map();
  for (const row of feedback)
    for (const issue of new Set(row.agentIssues.map((x) => x.trim().toLowerCase()).filter(Boolean)))
      tags.set(issue, (tags.get(issue) || 0) + 1);
  return {
    runCount: data.length,
    reviewed: data.filter((r) => r.review && r.review.verdict !== 'unreviewed').length,
    groups,
    issues,
    feedback,
    agentPatterns: [...tags]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count),
  };
}
export function csvExport(runs) {
  const columns = [
    'run_id',
    'experiment_id',
    'status',
    'provider',
    'model',
    'effort',
    'repeat',
    'prompt_version',
    'prompt_sha256',
    'variables',
    'input_tokens',
    'cached_input_tokens',
    'cache_write_tokens',
    'output_tokens',
    'cost_usd',
    'cost_source',
    'duration_seconds',
    'inferred_testing_seconds',
    'human_testing_minutes',
    'verdict',
    'score',
    'actual_stack',
    'issues',
    'engine_feedback',
    'prompt_feedback',
    'notes',
    'retry_of',
  ];
  const cell = (value) => {
    let s = value == null ? '' : String(value);
    if (/^[\s]*[=+@-]/.test(s)) s = "'" + s;
    return '"' + s.replaceAll('"', '""') + '"';
  };
  const rows = runs.map((r) => [
    r.id,
    r.experimentId,
    r.status,
    r.provider,
    r.model,
    r.effort,
    r.repeat,
    r.promptVersion,
    r.promptHash,
    JSON.stringify(r.variables),
    r.telemetry.inputTokens,
    r.telemetry.cachedTokens,
    r.telemetry.cacheWriteTokens,
    r.telemetry.outputTokens,
    r.telemetry.costUsd,
    r.telemetry.costSource,
    r.durationMs == null ? null : r.durationMs / 1000,
    r.telemetry.toolCalls ? r.telemetry.testingMs / 1000 : null,
    r.review?.testingMinutes,
    r.review?.verdict,
    r.review?.score,
    r.review?.actualStack || r.report?.actualStack,
    JSON.stringify(r.review?.issues || []),
    r.review?.engineFeedback || r.report?.engineFeedback,
    r.review?.promptFeedback || r.report?.promptFeedback,
    r.review?.notes,
    r.parentId,
  ]);
  return [columns, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
}
