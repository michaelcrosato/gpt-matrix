export const optionLabel = (value) => value.trim().replace(/\s+/g, ' ').slice(0, 200);

export function hasCustomLabel(option) {
  return (
    option.customLabel ??
    (option.value.trim().length > 0 && option.label.trim() !== optionLabel(option.value))
  );
}

export function setOptionValue(option, value) {
  const customLabel = hasCustomLabel(option);
  return { ...option, value, customLabel, label: customLabel ? option.label : optionLabel(value) };
}

function commaSeparated(text) {
  const fields = [];
  let current = '',
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"' && (quoted || !current.trim())) {
      if (quoted && text[i + 1] === '"') {
        current += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === ',' && !quoted) {
      fields.push(current.trim());
      current = '';
    } else current += c;
  }
  if (quoted) throw new Error('Close the quoted name in your pasted list.');
  fields.push(current.trim());
  return fields;
}

export function parseOptions(text, { commaList = false } = {}) {
  const trimmed = text.trim();
  if (!trimmed) return { options: [], duplicates: 0 };
  // Also accept literal \n sequences copied from an escaped list.
  const normalized = trimmed.replace(/\\r\\n|\\n/g, '\n').replace(/\r\n?/g, '\n');
  const lines =
    commaList && !/[\n|\t]/.test(normalized) ? commaSeparated(normalized) : normalized.split('\n');
  const options = [],
    seen = new Set();
  let duplicates = 0;
  for (const [index, raw] of lines.entries()) {
    const line = raw
      .trim()
      .replace(/^(?:[-*•]\s+|\d+[.)]\s+)/, '')
      .trim();
    if (!line) continue;
    const pipe = line.indexOf('|'),
      tab = line.indexOf('\t');
    const split = pipe >= 0 ? pipe : tab;
    const value = (split >= 0 ? line.slice(split + 1) : line).trim();
    const label = split >= 0 ? line.slice(0, split).trim() : optionLabel(value);
    if (!label || !value)
      throw new Error(
        `Line ${index + 1} needs a name and prompt text. Use just a name, or label | prompt text.`
      );
    if (value.length > 20000 || label.length > 200)
      throw new Error(`Line ${index + 1} is too long.`);
    const key = value.toLocaleLowerCase();
    if (seen.has(key)) {
      duplicates++;
      continue;
    }
    seen.add(key);
    options.push({
      label,
      value,
      enabled: true,
      customLabel: split >= 0 && label !== optionLabel(value),
    });
  }
  if (options.length > 200) throw new Error('Paste up to 200 options at a time.');
  return { options, duplicates };
}

export function mergeOptions(existing, incoming, mode) {
  if (mode === 'replace') return incoming;
  const result = existing.map((o) => ({ ...o }));
  for (const option of incoming) {
    const found = result.findIndex(
      (o) => o.value.trim().toLocaleLowerCase() === option.value.toLocaleLowerCase()
    );
    if (found >= 0) result[found] = { ...result[found], enabled: true };
    else result.push(option);
  }
  if (result.length > 200) throw new Error('Use up to 200 options per variable.');
  return result;
}

export function selectedModel(model, available, current) {
  const entry = available.find((m) => m.model === model);
  const valid = entry ? new Set(['default', ...entry.efforts]) : null;
  const efforts = valid ? current.efforts.filter((e) => valid.has(e)) : current.efforts;
  return {
    ...current,
    model,
    efforts: efforts.length ? efforts : [entry?.defaultEffort || 'medium'],
  };
}
