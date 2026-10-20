import React from 'react';
import { Field } from './ui';
import { selectedModel } from './experiment-inputs';

export default function ModelPicker({ model, available, onChange }) {
  const choices = [...new Map(available.map((m) => [m.model.toLowerCase(), m])).values()];
  const known = choices.some((m) => m.model === model.model);
  const oldAlias =
    model.provider === 'claude' && ['sonnet', 'opus', 'haiku', 'fable'].includes(model.model);
  const custom = !known && !oldAlias;
  return (
    <div className="model-picker">
      <Field label="Model">
        <select
          value={custom ? '__custom__' : model.model}
          onChange={(e) =>
            onChange(
              selectedModel(e.target.value === '__custom__' ? '' : e.target.value, choices, model)
            )
          }
        >
          {choices.map((m) => (
            <option key={m.model} value={m.model}>
              {m.label}
            </option>
          ))}
          {oldAlias && (
            <option value={model.model}>{model.model} — CLI alias from saved setup</option>
          )}
          <option value="__custom__">Enter a custom model ID…</option>
        </select>
      </Field>
      {custom ? (
        <Field label="Custom model ID" hint="Enter the exact ID accepted by your CLI.">
          <input
            value={model.model}
            onChange={(e) => onChange({ ...model, model: e.target.value })}
            placeholder="e.g. claude-haiku-5-5"
            spellCheck="false"
            autoComplete="off"
          />
        </Field>
      ) : (
        <p className="model-id">
          ID: <code>{model.model}</code>
          {oldAlias && <span> · choose a version above to pin the model.</span>}
        </p>
      )}
    </div>
  );
}
