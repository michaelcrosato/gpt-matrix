// Published standard API token rates, verified 2026-10-20. These are comparison
// estimates for CLI subscription runs, not billed subscription charges.
export const publishedPrices = {
  'codex:gpt-6.1-sol': {
    input: 2,
    cached: 0.1,
    cacheWrite: 2.5,
    output: 10,
    longContextThreshold: 272000,
    longInputMultiplier: 2,
    longOutputMultiplier: 1.5,
    sourceUrl: 'https://developers.openai.com/api/docs/models/gpt-6.1-sol',
    verifiedAt: '2026-10-20',
    basis: 'published-standard-api',
  },
  'codex:gpt-6-astra': {
    input: 10,
    cached: 1,
    cacheWrite: 12.5,
    output: 50,
    longContextThreshold: 272000,
    longInputMultiplier: 2,
    longOutputMultiplier: 1.5,
    sourceUrl: 'https://developers.openai.com/api/docs/models/gpt-6-astra',
    verifiedAt: '2026-10-20',
    basis: 'published-standard-api',
  },
};
export function priceFor(provider, model, settings) {
  const key = `${provider}:${model}`;
  const custom = settings.prices[key];
  return custom
    ? { ...custom, basis: 'user-supplied' }
    : structuredClone(publishedPrices[key] || null);
}
const valid = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0;
export function estimateCost(telemetry, rate, requests = [], model = null) {
  if (!rate)
    return { costUsd: null, reason: 'No reported cost or configured price for this model.' };
  const u = telemetry;
  if (!valid(u.inputTokens) || !valid(u.outputTokens) || !valid(u.cachedTokens))
    return { costUsd: null, reason: 'Complete token and cache totals are not available.' };
  const coverage =
    requests.length &&
    ['inputTokens', 'cachedTokens', 'outputTokens', 'cacheWriteTokens'].every(
      (key) =>
        valid(u[key]) &&
        requests.every((r) => valid(r[key])) &&
        requests.reduce((n, r) => n + r[key], 0) === u[key]
    );
  const rows = coverage ? requests : [u];
  if (rate.longContextThreshold && !coverage && u.inputTokens > rate.longContextThreshold)
    return {
      costUsd: null,
      reason:
        'Per-request usage is needed to distinguish long-context pricing from a long session.',
    };
  if (coverage && model && requests.some((r) => r.model && r.model !== model))
    return {
      costUsd: null,
      reason: 'The session used multiple models; a single-model price would be misleading.',
    };
  let total = 0;
  for (const r of rows) {
    if (r.cacheWriteTokens == null && rate.cacheWrite != null)
      return { costUsd: null, reason: 'Cache-write tokens were not reported.' };
    const writes = r.cacheWriteTokens || 0;
    if ((writes > 0 && !valid(rate.cacheWrite)) || r.cachedTokens + writes > r.inputTokens)
      return { costUsd: null, reason: 'Cache usage cannot be priced reliably.' };
    const long = rate.longContextThreshold && r.inputTokens > rate.longContextThreshold;
    total +=
      (((r.inputTokens - r.cachedTokens - writes) * rate.input +
        r.cachedTokens * rate.cached +
        writes * (rate.cacheWrite || 0)) *
        (long ? rate.longInputMultiplier : 1)) /
      1e6;
    total += (r.outputTokens * rate.output * (long ? rate.longOutputMultiplier : 1)) / 1e6;
  }
  return {
    costUsd: total,
    source:
      rate.basis === 'published-standard-api'
        ? 'Estimated standard API token cost'
        : 'Estimate from your saved price snapshot',
    requestCoverage: coverage ? requests.length : 0,
    assumptions:
      rate.basis === 'published-standard-api'
        ? 'Standard API token rates; cache discounts and per-request context size applied. Excludes tool fees, regional and service-tier adjustments. Not subscription billing.'
        : 'User-supplied token rates; not subscription billing.',
  };
}
