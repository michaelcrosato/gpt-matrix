import React, { useState } from 'react';
import { Plus, X, Layers3, Save, ArrowRight, Eye, FileText } from 'lucide-react';
import { Button, PageHead, Field, Badge } from './ui';
import ModelPicker from './model-picker';
import AxisEditor from './axis-editor';

export function defaultConfig(state, template = null) {
  const t = template || state.starter,
    model = state.catalog.models.find((m) => m.provider === 'codex');
  return {
    name: 'Controller-first game study',
    template: t.template,
    axes: structuredClone(t.axes || []),
    models: [{ provider: 'codex', model: model?.model || 'gpt-6.1-sol', efforts: ['medium'] }],
    repeats: 1,
    timeoutMinutes: 120,
    permissions: 'workspace',
    captureReport: true,
    randomize: true,
  };
}
export default function Builder({ state, initial, api, notify, refresh, navigate }) {
  const [c, setC] = useState(() => structuredClone(initial || defaultConfig(state))),
    [step, setStep] = useState('configure'),
    [preview, setPreview] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [bulk, setBulk] = useState({});
  const update = (key, value) => {
    setC((v) => ({ ...v, [key]: value }));
    setPreview(null);
    setError('');
  };
  const updateModel = (i, key, value) =>
    update(
      'models',
      c.models.map((m, n) => (n === i ? { ...m, [key]: value } : m))
    );
  const replaceModel = (i, model) =>
    update(
      'models',
      c.models.map((m, n) => (n === i ? model : m))
    );
  const replaceAxis = (i, axis) => {
    const previous = c.axes[i];
    if (previous.key !== axis.key)
      setBulk((values) => {
        const next = { ...values, [axis.key]: values[previous.key] || '' };
        delete next[previous.key];
        return next;
      });
    update(
      'axes',
      c.axes.map((a, n) => (n === i ? axis : a))
    );
  };
  const removeAxis = (i) => {
    setBulk((values) => {
      const next = { ...values };
      delete next[c.axes[i].key];
      return next;
    });
    update(
      'axes',
      c.axes.filter((_, n) => n !== i)
    );
  };
  const pendingPaste = () => {
    const names = c.axes.filter((a) => (bulk[a.key] || '').trim()).map((a) => a.label);
    if (!names.length) return false;
    setError(`Apply or clear the pasted list for ${names.join(', ')} before continuing.`);
    window.scrollTo(0, 0);
    return true;
  };
  const counts = c.axes.map((a) => a.options.filter((o) => o.enabled).length),
    models = c.models.reduce((s, m) => s + m.efforts.length, 0),
    total = counts.reduce((s, n) => s * n, models) * c.repeats;
  async function inspect() {
    if (pendingPaste()) return;
    setBusy(true);
    setError('');
    try {
      setPreview(await api('/api/preview', c));
      setStep('preview');
      window.scrollTo(0, 0);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function save(start = false) {
    if (pendingPaste()) return;
    setBusy(true);
    setError('');
    try {
      const e = await api('/api/experiments', c);
      if (start)
        try {
          await api(`/api/experiments/${e.id}/start`, {});
        } catch (err) {
          notify(`Saved as draft. ${err.message}`, 'error');
        }
      await refresh();
      navigate(`experiment/${e.id}`);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function saveTemplate() {
    if (pendingPaste()) return;
    try {
      await api('/api/templates', { name: c.name, template: c.template, axes: c.axes });
      await refresh();
      notify('Prompt version saved to the library.');
    } catch (e) {
      setError(e.message);
    }
  }
  return (
    <>
      <PageHead
        eyebrow="DESIGN AN EXPERIMENT"
        title="One prompt. Every combination."
        description="Set up your variables once. Let the queue do the repetitive work."
      >
        <Button variant="ghost" onClick={() => navigate('experiments')}>
          Cancel
        </Button>
      </PageHead>
      <div className="builder-layout">
        <div className="builder-main">
          <div className="step-tabs">
            <button
              className={step === 'configure' ? 'active' : ''}
              onClick={() => setStep('configure')}
            >
              <span>01</span> Configure
            </button>
            <button
              className={step === 'preview' ? 'active' : ''}
              onClick={inspect}
              disabled={busy}
            >
              <span>02</span> Inspect matrix
            </button>
          </div>
          {error && (
            <div className="alert error" role="alert">
              {error}
            </div>
          )}
          {step === 'configure' ? (
            <>
              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <h2>Experiment details</h2>
                    <p>A name to make this study easy to find later.</p>
                  </div>
                  <Layers3 size={20} />
                </div>
                <Field label="Experiment name">
                  <input
                    value={c.name}
                    onChange={(e) => update('name', e.target.value)}
                    placeholder="e.g. Testing constraints · October"
                  />
                </Field>
              </section>
              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <h2>Base prompt</h2>
                    <p>
                      Paste your prompt. Insert <code>{'{{VARIABLE}}'}</code> where an option
                      belongs.
                    </p>
                  </div>
                  <FileText size={20} />
                </div>
                <div className="inline-controls">
                  <select
                    aria-label="Load prompt template"
                    value=""
                    onChange={(e) => {
                      const t =
                        e.target.value === 'original'
                          ? state.starter
                          : state.templates.find((x) => x.id === e.target.value);
                      if (t) {
                        update('template', t.template);
                        update('axes', structuredClone(t.axes));
                      }
                    }}
                  >
                    <option value="">Load from library…</option>
                    <option value="original">Your original game prompt</option>
                    {state.templates.map((t) => (
                      <option value={t.id} key={t.id}>
                        {t.name} · {t.version}
                      </option>
                    ))}
                  </select>
                  <label className="button ghost file-button">
                    <FileText size={15} /> Import .txt
                    <input
                      type="file"
                      accept=".txt,.md"
                      onChange={async (e) => {
                        if (e.target.files[0]) update('template', await e.target.files[0].text());
                      }}
                    />
                  </label>
                </div>
                <textarea
                  aria-label="Base prompt"
                  className="prompt-editor"
                  value={c.template}
                  onChange={(e) => update('template', e.target.value)}
                  spellCheck="false"
                />
                <div className="editor-footer">
                  <span>
                    {c.template.length.toLocaleString()} characters · exact snapshot saved per run
                  </span>
                  <button className="text-button" onClick={saveTemplate}>
                    <Save size={14} /> Save to library
                  </button>
                </div>
                <p className="helper">
                  Built-in variables: MODEL, EFFORT, PROVIDER, REPEAT, RUN_ID, STAMP,
                  PROMPT_VERSION. Variables absent from the prompt are appended as instructions.
                </p>
              </section>
              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <h2>Models & reasoning</h2>
                    <p>Each selected effort becomes a separate run.</p>
                  </div>
                  <Button
                    variant="ghost compact"
                    icon={Plus}
                    onClick={() => {
                      const next = state.catalog.models.find(
                        (model) =>
                          !c.models.some(
                            (selected) =>
                              selected.provider === model.provider && selected.model === model.model
                          )
                      );
                      update('models', [
                        ...c.models,
                        next
                          ? { provider: next.provider, model: next.model, efforts: ['medium'] }
                          : { provider: 'codex', model: '', efforts: ['medium'] },
                      ]);
                    }}
                  >
                    Add model
                  </Button>
                </div>
                {c.models.map((m, i) => {
                  const available = state.catalog.models.filter((x) => x.provider === m.provider),
                    supported =
                      available.find((x) => x.model === m.model)?.efforts ||
                      (m.provider === 'claude'
                        ? ['low', 'medium', 'high', 'xhigh', 'max']
                        : ['low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
                  return (
                    <div className="model-config" key={i}>
                      <div className="model-inputs">
                        <Field label="Runner">
                          <select
                            value={m.provider}
                            onChange={(e) => {
                              const provider = e.target.value;
                              update(
                                'models',
                                c.models.map((old, j) =>
                                  j === i
                                    ? {
                                        provider,
                                        model:
                                          provider === 'claude'
                                            ? 'claude-sonnet-5-5'
                                            : provider === 'rehearsal'
                                              ? 'local-fixture'
                                              : state.catalog.models.find(
                                                  (x) => x.provider === 'codex'
                                                )?.model || 'gpt-6.1-sol',
                                        efforts: ['medium'],
                                      }
                                    : old
                                )
                              );
                            }}
                          >
                            <option value="codex">Codex CLI</option>
                            <option value="claude">Claude Code</option>
                            <option value="rehearsal">Local rehearsal (no model)</option>
                          </select>
                        </Field>
                        <ModelPicker
                          model={m}
                          available={
                            available.length
                              ? available
                              : m.provider === 'rehearsal'
                                ? [
                                    {
                                      provider: 'rehearsal',
                                      model: 'local-fixture',
                                      label: 'Local fixture',
                                      efforts: ['medium'],
                                    },
                                  ]
                                : []
                          }
                          onChange={(model) => replaceModel(i, model)}
                        />
                        <button
                          className="icon-button danger"
                          aria-label={`Remove model ${i + 1}`}
                          disabled={c.models.length === 1}
                          onClick={() =>
                            update(
                              'models',
                              c.models.filter((_, n) => n !== i)
                            )
                          }
                        >
                          <X size={17} />
                        </button>
                      </div>
                      <div className="efforts">
                        {['default', ...supported].map((e) => (
                          <label
                            className={`choice-pill ${m.efforts.includes(e) ? 'selected' : ''}`}
                            key={e}
                          >
                            <input
                              type="checkbox"
                              checked={m.efforts.includes(e)}
                              onChange={() =>
                                updateModel(
                                  i,
                                  'efforts',
                                  m.efforts.includes(e)
                                    ? m.efforts.filter((x) => x !== e)
                                    : [...m.efforts, e]
                                )
                              }
                            />
                            {e}
                          </label>
                        ))}
                      </div>
                      {m.provider === 'rehearsal' && (
                        <p className="helper">
                          Exercises the queue and review flow using a labeled fixture. Excluded from
                          analysis by default.
                        </p>
                      )}
                    </div>
                  );
                })}
                <p className="helper">
                  {state.catalog.source} Custom IDs are passed directly to the CLI; unsupported
                  combinations are recorded as failures.
                </p>
              </section>
              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <h2>Variable matrix</h2>
                    <p>Check the alternatives you want to compare.</p>
                  </div>
                  <Button
                    variant="ghost compact"
                    icon={Plus}
                    onClick={() =>
                      update('axes', [
                        ...c.axes,
                        {
                          key: `VAR_${c.axes.length + 1}`,
                          label: 'New variable',
                          options: [{ label: '', value: '', enabled: true, customLabel: false }],
                        },
                      ])
                    }
                  >
                    Add variable
                  </Button>
                </div>
                <div className="axes">
                  {c.axes.map((a, i) => (
                    <AxisEditor
                      key={i}
                      axis={a}
                      onChange={(axis) => replaceAxis(i, axis)}
                      onRemove={() => removeAxis(i)}
                      bulk={bulk[a.key] || ''}
                      onBulk={(value) => setBulk((old) => ({ ...old, [a.key]: value }))}
                      notify={notify}
                    />
                  ))}
                </div>
              </section>
              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <h2>Execution</h2>
                    <p>New sessions and separate folders for every attempt.</p>
                  </div>
                </div>
                <div className="two-fields">
                  <Field
                    label="Repetitions per combination"
                    hint="Repeat to account for variation between generations."
                  >
                    <input
                      type="number"
                      min="1"
                      max="100"
                      value={c.repeats}
                      onChange={(e) => update('repeats', Number(e.target.value))}
                    />
                  </Field>
                  <Field label="Timeout per run (minutes)">
                    <input
                      type="number"
                      min="1"
                      max="1440"
                      value={c.timeoutMinutes}
                      onChange={(e) => update('timeoutMinutes', Number(e.target.value))}
                    />
                  </Field>
                </div>
                <Field
                  label="Agent permissions"
                  hint="Workspace mode: Codex uses its workspace sandbox with network access; Claude allows its standard coding tools, including Bash. Separate folders are not an OS sandbox for Claude."
                >
                  <select
                    value={c.permissions}
                    onChange={(e) => update('permissions', e.target.value)}
                  >
                    <option value="workspace">Workspace / standard coding tools</option>
                    <option value="unrestricted">
                      Unrestricted — agent may access the whole machine
                    </option>
                  </select>
                </Field>
                <label className="check-line">
                  <input
                    type="checkbox"
                    checked={c.randomize}
                    onChange={(e) => update('randomize', e.target.checked)}
                  />
                  <span>
                    <strong>Shuffle run order</strong>
                    <small>Reduce the effect of running every variant in the same order.</small>
                  </span>
                </label>
                <label className="check-line">
                  <input
                    type="checkbox"
                    checked={c.captureReport}
                    onChange={(e) => update('captureReport', e.target.checked)}
                  />
                  <span>
                    <strong>Request a structured feedback report</strong>
                    <small>
                      Appends a request for stack, engine, and prompt feedback. The full addition is
                      visible in the preview.
                    </small>
                  </span>
                </label>
              </section>
            </>
          ) : (
            preview && (
              <>
                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <h2>{preview.count.toLocaleString()} runs, ready to inspect</h2>
                      <p>
                        All selected values are crossed with each model, effort, and repetition.
                      </p>
                    </div>
                    <Badge value="draft" />
                  </div>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Model</th>
                          <th>Effort</th>
                          {c.axes.map((a) => (
                            <th key={a.key}>{a.label}</th>
                          ))}
                          <th>Repeat</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.rows.map((r, i) => (
                          <tr key={i}>
                            <td>
                              {r.provider} / {r.model}
                            </td>
                            <td>{r.effort}</td>
                            {c.axes.map((a) => (
                              <td key={a.key}>{r.variables[a.key].label}</td>
                            ))}
                            <td>{r.repeat}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {preview.count > 80 && (
                    <p className="helper">
                      First 80 of {preview.count.toLocaleString()} combinations shown. All
                      combinations are saved.
                    </p>
                  )}
                </section>
                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Rendered prompt · first combination</h2>
                      <p>Run ID and timestamp are replaced when the experiment is saved.</p>
                    </div>
                  </div>
                  <pre className="prompt-preview">{preview.prompt}</pre>
                </section>
              </>
            )
          )}
        </div>
        <aside className="run-plan">
          <div className="eyebrow">YOUR RUN PLAN</div>
          <div className="plan-number">
            {total.toLocaleString()}
            <span>runs</span>
          </div>
          <p>One queue. Every combination.</p>
          <div className="plan-breakdown">
            <div>
              <span>Model × effort pairs</span>
              <strong>{models}</strong>
            </div>
            {c.axes.map((a, i) => (
              <div key={i}>
                <span>{a.label}</span>
                <strong>× {counts[i]}</strong>
              </div>
            ))}
            <div>
              <span>Repetitions</span>
              <strong>× {c.repeats}</strong>
            </div>
          </div>
          <div className="plan-note">
            <Layers3 size={17} />
            <span>
              Up to <strong>{state.settings.concurrency} runs</strong> at once across all
              experiments. The queue continues while this tab is closed.
            </span>
          </div>
          {step === 'configure' ? (
            <Button variant="primary" icon={Eye} onClick={inspect} disabled={busy}>
              Inspect matrix
            </Button>
          ) : (
            <Button variant="primary" icon={ArrowRight} onClick={() => save(true)} disabled={busy}>
              Start {total} runs
            </Button>
          )}
          <Button icon={Save} onClick={() => save(false)} disabled={busy}>
            Save as draft
          </Button>
          <small>Starting uses your existing CLI account and its usage limits.</small>
        </aside>
      </div>
    </>
  );
}
