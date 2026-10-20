// Versioned IDs and CLI effort support verified against official docs on
// 2026-10-20. These describe the catalog, not a guarantee of account access.
// https://platform.claude.com/docs/en/models/overview
// https://code.claude.com/docs/en/model-config#adjust-effort-level
export const claudeModels = [
  ['claude-sonnet-5-5', 'Claude Sonnet 5.5'],
  ['claude-opus-5-5', 'Claude Opus 5.5'],
  ['claude-haiku-5-5', 'Claude Haiku 5.5'],
  ['claude-fable-5-1', 'Claude Fable 5.1'],
].map(([model, label]) => ({
  provider: 'claude',
  model,
  label,
  efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
  defaultEffort: model.includes('fable') ? 'high' : 'medium',
}));
