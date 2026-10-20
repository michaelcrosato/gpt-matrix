import test from 'node:test';
import assert from 'node:assert/strict';
import {
  setOptionValue,
  parseOptions,
  mergeOptions,
  selectedModel,
} from '../src/experiment-inputs.js';
import { validateConfig, matrix, renderPrompt, catalog } from '../server/domain.js';

const config = (option) => ({
  name: 'Source test',
  template: 'Build a successor to {{SOURCE}}.',
  models: [{ provider: 'codex', model: 'gpt-6.1-sol', efforts: ['medium'] }],
  axes: [{ key: 'SOURCE', label: 'Source game', options: [option] }],
  repeats: 1,
  timeoutMinutes: 5,
  permissions: 'workspace',
});
test('Changing the primary source value changes the label and the exact submitted prompt', () => {
  const option = setOptionValue(
    { label: 'Doom (1993)', value: 'Doom (1993)', enabled: true },
    'StarFox 64'
  );
  assert.equal(option.label, 'StarFox 64');
  assert.equal(option.value, 'StarFox 64');
  const c = validateConfig(config(option)),
    row = matrix(c)[0];
  assert.equal(row.variables.SOURCE.label, 'StarFox 64');
  assert.match(renderPrompt(c, row, 'r'), /Build a successor to StarFox 64/);
  assert.doesNotMatch(renderPrompt(c, row, 'r'), /Doom/);
  const custom = setOptionValue(
    { label: 'Short label', value: 'Long instructions', customLabel: true, enabled: true },
    'Updated instructions'
  );
  assert.equal(custom.label, 'Short label');
  assert.equal(custom.value, 'Updated instructions');
});
test('A selected empty prompt value is rejected instead of silently producing a source-less run', () => {
  assert.throws(
    () => validateConfig(config({ label: 'StarFox 64', value: '', enabled: true })),
    /has no prompt text/
  );
  const c = config({ label: 'StarFox 64', value: 'StarFox 64', enabled: true });
  c.axes[0].options.push({ label: '', value: '', enabled: false });
  assert.doesNotThrow(() => validateConfig(c));
});
test('Bulk input supports pasted lines, bullets, escaped newlines, CSV names, and spreadsheet columns', () => {
  for (const text of [
    'StarFox 64\nQuake (1996)\r\nHalf-Life (1998)',
    '- StarFox 64\n• Quake (1996)\n3. Half-Life (1998)',
    'StarFox 64\\nQuake (1996)\\nHalf-Life (1998)',
    'StarFox 64, Quake (1996), Half-Life (1998)',
  ]) {
    const { options } = parseOptions(text, { commaList: true });
    assert.deepEqual(
      options.map((o) => o.value),
      ['StarFox 64', 'Quake (1996)', 'Half-Life (1998)']
    );
    assert.ok(options.every((o) => o.label === o.value && o.enabled));
  }
  assert.deepEqual(
    parseOptions('"Doom, original", StarFox 64', { commaList: true }).options.map((o) => o.value),
    ['Doom, original', 'StarFox 64']
  );
  const tab = parseOptions('StarFox\tStarFox 64 for Nintendo 64\nDoom | Doom (1993)', {
    commaList: true,
  }).options;
  assert.equal(tab[0].label, 'StarFox');
  assert.equal(tab[0].value, 'StarFox 64 for Nintendo 64');
  assert.equal(tab[1].value, 'Doom (1993)');
  assert.equal(
    parseOptions('No tests | Do not write tests, do not run tests', { commaList: true }).options
      .length,
    1
  );
  assert.throws(() => parseOptions('StarFox |'), /needs a name and prompt text/);
  assert.throws(
    () => parseOptions('"Unclosed, name', { commaList: true }),
    /Close the quoted name/
  );
});
test('Bulk replace removes the old default; append deduplicates and enables an existing option', () => {
  const existing = [
    { label: 'Doom', value: 'Doom', enabled: true },
    { label: 'StarFox', value: 'StarFox', enabled: false },
  ];
  const incoming = parseOptions('StarFox\nstarfox\nQuake');
  assert.equal(incoming.duplicates, 1);
  assert.deepEqual(
    mergeOptions(existing, incoming.options, 'replace').map((o) => o.value),
    ['StarFox', 'Quake']
  );
  const added = mergeOptions(existing, incoming.options, 'append');
  assert.equal(added.length, 3);
  assert.equal(added[1].enabled, true);
  assert.equal(existing[1].enabled, false);
  const c = config(incoming.options[0]);
  c.axes[0].options = mergeOptions(existing, incoming.options, 'replace');
  const rows = matrix(c);
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => !renderPrompt(c, r, 'r').includes('Doom')));
});
test('Model catalog includes versioned Claude choices and selecting a model drops incompatible effort', () => {
  const models = catalog().models;
  for (const id of ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'])
    assert.ok(models.some((m) => m.model === id && m.label.includes('5.5')));
  assert.equal(
    new Set(models.map((m) => m.provider + ':' + m.model.toLowerCase())).size,
    models.length
  );
  const selected = selectedModel(
    'next',
    [{ model: 'next', efforts: ['low', 'medium'], defaultEffort: 'medium' }],
    { model: 'old', provider: 'codex', efforts: ['ultra'] }
  );
  assert.deepEqual(selected.efforts, ['medium']);
});
