import React, { useState } from 'react';
import { Plus, X, ChevronDown, ClipboardPaste } from 'lucide-react';
import { Button, Field } from './ui';
import {
  hasCustomLabel,
  setOptionValue,
  optionLabel,
  parseOptions,
  mergeOptions,
} from './experiment-inputs';

export default function AxisEditor({ axis: a, onChange, onRemove, bulk, onBulk, notify }) {
  const [open, setOpen] = useState(a.key === 'SOURCE'),
    [showPaste, setShowPaste] = useState(false),
    [mode, setMode] = useState('replace'),
    [pasteError, setPasteError] = useState('');
  const source = a.key === 'SOURCE',
    count = a.options.filter((o) => o.enabled).length;
  let parsed = { options: [], duplicates: 0 },
    error = '';
  try {
    parsed = parseOptions(bulk, { commaList: source });
  } catch (e) {
    error = e.message;
  }
  const edit = (index, option) =>
    onChange({ ...a, options: a.options.map((o, i) => (i === index ? option : o)) });
  function apply() {
    try {
      if (error) throw Error(error);
      if (!parsed.options.length) throw Error('Paste at least one option first.');
      const options = mergeOptions(a.options, parsed.options, mode);
      onChange({ ...a, options });
      onBulk('');
      setPasteError('');
      notify(
        `${options.filter((o) => o.enabled).length} ${a.label.toLowerCase()} options selected.${parsed.duplicates ? ` Skipped ${parsed.duplicates} duplicate${parsed.duplicates === 1 ? '' : 's'}.` : ''}`
      );
    } catch (e) {
      setPasteError(e.message);
    }
  }
  return (
    <details
      className="axis"
      data-axis-key={a.key}
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>
        <div>
          <span className="axis-key">{a.key}</span>
          <strong>{a.label}</strong>
        </div>
        <span className="axis-summary">
          {a.options
            .filter((o) => o.enabled)
            .map((o) => o.label || o.value || 'Empty option')
            .join(' · ') || 'None selected'}
        </span>
        <span className="count-badge">{count}</span>
        <ChevronDown size={15} />
      </summary>
      <div className="axis-body">
        <p className="axis-help">
          {source
            ? 'Enter the game names you want sent to the model.'
            : 'The prompt text below is inserted for each selected option.'}
        </p>
        {a.options.map((o, index) => {
          const custom = hasCustomLabel(o);
          return (
            <div className={`option-editor ${o.enabled ? 'enabled' : ''}`} key={index}>
              <label className="option-check">
                <input
                  type="checkbox"
                  checked={o.enabled}
                  onChange={(e) => edit(index, { ...o, enabled: e.target.checked })}
                />
                <span className="sr-only">Include {o.label || `option ${index + 1}`}</span>
              </label>
              <div className="option-fields">
                <Field
                  label={source ? `Source game ${index + 1}` : `Prompt text · option ${index + 1}`}
                  hint={
                    !o.value.trim() && o.enabled
                      ? 'Enter the text to send, or deselect this option.'
                      : undefined
                  }
                >
                  {source ? (
                    <input
                      value={o.value}
                      onChange={(e) => edit(index, setOptionValue(o, e.target.value))}
                      placeholder="e.g. StarFox 64"
                    />
                  ) : (
                    <textarea
                      rows={3}
                      value={o.value}
                      onChange={(e) => edit(index, setOptionValue(o, e.target.value))}
                      placeholder="Instructions to insert into the prompt…"
                    />
                  )}
                </Field>
                <label className="custom-label-toggle">
                  <input
                    type="checkbox"
                    checked={custom}
                    onChange={(e) =>
                      edit(index, {
                        ...o,
                        customLabel: e.target.checked,
                        label: e.target.checked
                          ? o.label || optionLabel(o.value)
                          : optionLabel(o.value),
                      })
                    }
                  />{' '}
                  Use a different display label
                </label>
                {custom && (
                  <Field
                    label={`Display label · option ${index + 1}`}
                    hint="This only names the option in tables; it does not change the prompt."
                  >
                    <input
                      value={o.label}
                      onChange={(e) =>
                        edit(index, { ...o, label: e.target.value, customLabel: true })
                      }
                    />
                  </Field>
                )}
              </div>
              <button
                className="icon-button"
                aria-label={`Remove option ${index + 1} from ${a.label}`}
                onClick={() => onChange({ ...a, options: a.options.filter((_, i) => i !== index) })}
              >
                <X size={15} />
              </button>
            </div>
          );
        })}
        <div className="axis-actions">
          <Button
            variant="ghost compact"
            icon={Plus}
            onClick={() =>
              onChange({
                ...a,
                options: [
                  ...a.options,
                  { label: '', value: '', enabled: true, customLabel: false },
                ],
              })
            }
          >
            {source ? 'Add a game' : 'Add option'}
          </Button>
          <Button
            variant="compact"
            icon={ClipboardPaste}
            aria-expanded={showPaste}
            onClick={() => setShowPaste(!showPaste)}
          >
            Paste a list
          </Button>
        </div>
        {showPaste && (
          <section className="bulk-options" aria-label={`Paste options for ${a.label}`}>
            <h3>{source ? 'Paste game names' : 'Paste options'}</h3>
            <p className="helper">
              {source ? 'One game per line, or comma-separated names.' : 'One option per line.'} For
              a short label with longer instructions, use <code>label | prompt text</code>. Bulleted
              lists and spreadsheet columns also work.
            </p>
            <textarea
              aria-label={`Pasted options for ${a.label}`}
              rows={5}
              value={bulk}
              onChange={(e) => {
                onBulk(e.target.value);
                setPasteError('');
              }}
              placeholder={
                source
                  ? 'StarFox 64\nQuake (1996)\nHalf-Life (1998)'
                  : 'Short label | Full prompt instructions\nAnother option'
              }
            />
            <Field label={`How to apply ${a.label} list`}>
              <select value={mode} onChange={(e) => setMode(e.target.value)}>
                <option value="replace">Replace the current options</option>
                <option value="append">Add to the current options</option>
              </select>
            </Field>
            {error || pasteError ? (
              <p className="danger" role="alert">
                {error || pasteError}
              </p>
            ) : (
              <p className="bulk-preview" aria-live="polite">
                {parsed.options.length
                  ? `${parsed.options.length} options ready${parsed.duplicates ? ` · ${parsed.duplicates} duplicates ignored` : ''}. ${mode === 'replace' ? 'This replaces the current list.' : 'Existing options stay selected as they are.'}`
                  : 'Paste your list above, then apply it.'}
              </p>
            )}
            {parsed.options.length > 0 && (
              <div className="chip-row">
                {parsed.options.slice(0, 8).map((o) => (
                  <span className="subtle-chip" key={o.value}>
                    {o.label}
                  </span>
                ))}
                {parsed.options.length > 8 && (
                  <span className="subtle-chip">+{parsed.options.length - 8} more</span>
                )}
              </div>
            )}
            <div className="inline-controls">
              <Button
                variant="primary compact"
                disabled={!parsed.options.length || Boolean(error)}
                onClick={apply}
              >
                {mode === 'replace'
                  ? `Replace with ${parsed.options.length} options`
                  : `Add ${parsed.options.length} options`}
              </Button>
              <Button
                variant="ghost compact"
                onClick={() => {
                  onBulk('');
                  setPasteError('');
                }}
              >
                Clear paste
              </Button>
            </div>
          </section>
        )}
        <details className="variable-settings">
          <summary>Variable settings</summary>
          <div className="two-fields">
            <Field label="Variable display name">
              <input value={a.label} onChange={(e) => onChange({ ...a, label: e.target.value })} />
            </Field>
            <Field label="Template key">
              <input
                value={a.key}
                onChange={(e) =>
                  onChange({ ...a, key: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '') })
                }
              />
            </Field>
          </div>
          <button className="text-button danger" onClick={onRemove}>
            Remove variable
          </button>
        </details>
      </div>
    </details>
  );
}
