import React, { useState, useEffect, useRef } from 'react';
import {
  ExternalLink,
  Download,
  RotateCcw,
  Square,
  Save,
  Copy,
  FileCode2,
  Activity,
  CheckCheck,
  Clock3,
  Coins,
  Cpu,
  RefreshCw,
} from 'lucide-react';
import { Button, PageHead, Field, Badge, Metric, Empty, money, num, duration, date } from './ui';

export default function Run({ id, state, api, refresh, notify, navigate }) {
  const [run, setRun] = useState(null),
    [events, setEvents] = useState([]),
    [tab, setTab] = useState('overview'),
    [review, setReview] = useState(null),
    [error, setError] = useState(''),
    [saving, setSaving] = useState(false),
    [dirty, setDirty] = useState(false);
  const initialized = useRef(false);
  useEffect(() => {
    let live = true;
    async function load() {
      try {
        const [r, e] = await Promise.all([api(`/api/runs/${id}`), api(`/api/runs/${id}/events`)]);
        if (!live) return;
        setRun(r);
        setEvents(e);
        setError('');
        if (!initialized.current) {
          initialized.current = true;
          setReview({
            verdict: 'unreviewed',
            score: '',
            notes: '',
            actualStack: '',
            engineFeedback: '',
            promptFeedback: '',
            testingMinutes: '',
            ...r.review,
            issues: state.settings.issueCatalog.map((i) => ({
              key: i.key,
              outcome: 'untested',
              testMinutes: '',
              fixMinutes: '',
              notes: '',
              ...r.review?.issues?.find((x) => x.key === i.key),
            })),
          });
        }
      } catch (e) {
        if (live) setError(e.message);
      }
    }
    load();
    const t = setInterval(load, 2000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [id]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const change = (k, v) => {
    setDirty(true);
    setReview((r) => ({ ...r, [k]: v }));
  };
  async function act(action) {
    try {
      const r = await api(`/api/runs/${id}/${action}`, {});
      await refresh();
      if (action === 'retry') {
        notify('New attempt queued. Resume the experiment to run it.');
        navigate(`run/${r.id}`);
      } else if (action === 'finalize') {
        setRun(r);
        notify(
          r.finalization?.status === 'failed'
            ? 'Finalization failed. See the details below.'
            : 'Final usage refreshed from saved records.',
          r.finalization?.status === 'failed' ? 'error' : 'success'
        );
      } else notify('Stopping the run…');
    } catch (e) {
      notify(e.message, 'error');
    }
  }
  async function save() {
    setSaving(true);
    try {
      setRun(await api(`/api/runs/${id}/review`, review));
      setDirty(false);
      await refresh();
      notify('Human review saved. Patterns updated.');
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setSaving(false);
    }
  }
  if (error && !run) return <div className="alert error">{error}</div>;
  if (!run || !review) return <div className="loading">Loading run…</div>;
  const e = state.experiments.find((e) => e.id === run.experimentId),
    t = run.telemetry,
    html = run.artifacts.filter((a) => /\.html?$/i.test(a.name)),
    preview = (name) =>
      `http://${location.hostname}:${state.artifactPort}/${id}/${name.split('/').map(encodeURIComponent).join('/')}`;
  return (
    <>
      <button className="back-link" onClick={() => navigate(`experiment/${run.experimentId}`)}>
        ← {e?.name || 'Experiment'}
      </button>
      <PageHead
        eyebrow={`RUN ${String(run.sequence).padStart(3, '0')} / REPEAT ${run.repeat}`}
        title={run.variables.SOURCE?.label || run.model}
        description={`${run.provider} · ${run.model} · ${run.effort} effort`}
      >
        <Badge value={run.status} />
        {['running', 'queued', 'orphaned'].includes(run.status) ? (
          <Button variant="ghost danger" icon={Square} onClick={() => act('cancel')}>
            Stop run
          </Button>
        ) : (
          run.status !== 'orphaned' && (
            <Button icon={RotateCcw} onClick={() => act('retry')}>
              Queue another attempt
            </Button>
          )
        )}
        {html.length > 0 && (
          <a
            className="button primary"
            href={preview(html[0].name)}
            target="_blank"
            rel="noopener noreferrer"
          >
            <ExternalLink size={16} />
            Open output
          </a>
        )}
      </PageHead>
      {run.provider === 'rehearsal' && (
        <div className="alert">
          Local rehearsal fixture. No model was called; usage is unknown. Excluded from analysis
          unless explicitly included.
        </div>
      )}
      {run.error && (
        <div className="alert error">
          <strong>{run.status === 'failed' ? 'Runner error' : 'Run note'}</strong>
          <pre>{run.error}</pre>
        </div>
      )}
      <div className="metrics-grid">
        <Metric
          label="Total tokens"
          value={num(
            t.inputTokens == null || t.outputTokens == null ? null : t.inputTokens + t.outputTokens
          )}
          sub={`${num(t.inputTokens)} input · ${num(t.outputTokens)} output`}
          icon={Cpu}
        />
        <Metric
          label="Session time"
          value={duration(
            run.durationMs ?? (run.startedAt ? Date.now() - Date.parse(run.startedAt) : null)
          )}
          sub={run.startedAt ? `Started ${date(run.startedAt)}` : 'Waiting in queue'}
          icon={Clock3}
        />
        <Metric
          label="Cost"
          value={money(t.costUsd)}
          sub={t.costSource || 'Not reported · not assumed to be zero'}
          icon={Coins}
        />
        <Metric
          label="Human verdict"
          value={review.verdict === 'unreviewed' ? 'Not reviewed' : review.verdict}
          sub={review.score ? `${review.score} / 5 quality score` : 'Your evaluation of the output'}
          icon={CheckCheck}
          accent
        />
      </div>
      {run.endedAt && (
        <section className="finalization-note">
          <div>
            <strong>
              {run.finalization?.status === 'pending'
                ? 'Collecting final usage…'
                : run.finalization?.status === 'complete'
                  ? 'Final usage added to output'
                  : run.finalization?.status === 'partial'
                    ? 'Final usage saved with file notes'
                    : 'Final usage can be collected from saved records'}
            </strong>
            <p>
              {run.finalization?.metrics?.costAssumptions ||
                run.finalization?.costUnavailableReason ||
                'Collects recorded totals after execution. No additional model call.'}
            </p>
            {run.finalization?.htmlCount > 0 && (
              <small>
                {run.finalization.htmlCount} HTML files stamped · originals preserved ·{' '}
                {date(run.finalization.finalizedAt)}
              </small>
            )}
            {run.finalization?.warnings?.map((warning, i) => (
              <p key={i} className="danger">
                {warning}
              </p>
            ))}
          </div>
          <Button
            variant="compact"
            icon={RefreshCw}
            disabled={run.finalization?.status === 'pending'}
            onClick={() => act('finalize')}
          >
            Refresh final totals
          </Button>
        </section>
      )}
      <div className="tabs run-tabs">
        {[
          ['overview', 'Output & details'],
          ['review', 'Human review'],
          ['prompt', 'Exact prompt'],
          ['logs', 'Activity & logs'],
        ].map(([v, l]) => (
          <button key={v} className={tab === v ? 'active' : ''} onClick={() => setTab(v)}>
            {l}
            {v === 'review' && dirty && <span className="unsaved-dot" />}
          </button>
        ))}
      </div>
      {tab === 'overview' && (
        <>
          <div className="run-detail-grid">
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <h2>Output files</h2>
                  <p>Open the result, play it, then record your review.</p>
                </div>
                <FileCode2 size={20} />
              </div>
              {run.artifacts.length ? (
                <div className="artifact-list">
                  {run.artifacts.map((a) => (
                    <div className="artifact" key={a.name}>
                      <FileCode2 size={18} />
                      <div>
                        <strong>{a.name}</strong>
                        <small>{num(a.size / 1024)} KB</small>
                      </div>
                      {/\.html?$/i.test(a.name) && (
                        <a
                          className="text-button"
                          href={preview(a.name)}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Open <ExternalLink size={14} />
                        </a>
                      )}
                      <a
                        className="icon-button"
                        aria-label={`Download ${a.name}`}
                        href={`/api/runs/${id}/download?file=${encodeURIComponent(a.name)}`}
                      >
                        <Download size={15} />
                      </a>
                    </div>
                  ))}
                </div>
              ) : (
                <Empty title={run.status === 'running' ? 'Agent is working' : 'No files captured'}>
                  {run.status === 'queued'
                    ? 'Files appear after the queued run finishes.'
                    : 'Check the final response and logs for the result or a runner error.'}
                </Empty>
              )}
              <Button variant="primary" onClick={() => setTab('review')}>
                Review this output
              </Button>
            </section>
            <section className="panel">
              <h2>Run conditions</h2>
              <dl className="conditions">
                {Object.entries(run.variables).map(([key, v]) => (
                  <React.Fragment key={key}>
                    <dt>{key}</dt>
                    <dd>{v.label}</dd>
                  </React.Fragment>
                ))}
                <dt>Prompt version</dt>
                <dd>
                  <code>{run.promptVersion}</code>
                </dd>
                <dt>Observed model(s)</dt>
                <dd>
                  {t.observedModels.length ? t.observedModels.join(', ') : 'Not reported by CLI'}
                </dd>
                <dt>Reported stack</dt>
                <dd>{run.report?.actualStack || 'Not reported'}</dd>
                <dt>Cached input</dt>
                <dd>{num(t.cachedTokens)} tokens (included in input)</dd>
                <dt>Cache write</dt>
                <dd>{num(t.cacheWriteTokens)} tokens (included in input)</dd>
                <dt>Exact total tokens</dt>
                <dd>
                  {t.inputTokens != null && t.outputTokens != null
                    ? (t.inputTokens + t.outputTokens).toLocaleString('en-US')
                    : 'Not reported'}
                </dd>
                <dt>Reasoning tokens</dt>
                <dd>{num(t.reasoningTokens)} (when reported; included in output)</dd>
                <dt>Environment</dt>
                <dd>
                  {run.environment
                    ? `${run.environment.os} ${run.environment.release} · ${run.environment.cliVersion || run.provider}`
                    : 'Not recorded'}
                </dd>
                <dt>Usage source</dt>
                <dd>{t.usageSource || 'Not available'}</dd>
                <dt>Session ID</dt>
                <dd>
                  <code>{t.sessionId || 'Not reported'}</code>
                </dd>
                {run.parentId && (
                  <>
                    <dt>Retry of</dt>
                    <dd>
                      <button
                        className="text-button"
                        onClick={() => navigate(`run/${run.parentId}`)}
                      >
                        Original attempt ↗
                      </button>
                    </dd>
                  </>
                )}
              </dl>
            </section>
          </div>
          <section className="panel">
            <h2>Agent's final response</h2>
            <pre className="response-text">{t.finalText || 'No final response yet.'}</pre>
          </section>
          {run.report && (
            <div className="settings-grid">
              <section className="panel">
                <h2>Engine feedback</h2>
                <p className="preserve">{run.report.engineFeedback || 'Not reported.'}</p>
              </section>
              <section className="panel">
                <h2>Prompt feedback</h2>
                <p className="preserve">{run.report.promptFeedback || 'Not reported.'}</p>
              </section>
            </div>
          )}
        </>
      )}
      {tab === 'review' && (
        <>
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>Your assessment</h2>
                <p>Judge the playable result, independently of whether the agent finished.</p>
              </div>
              <Badge value={review.verdict} />
            </div>
            <div className="verdict-options">
              {[
                ['unreviewed', 'Not reviewed'],
                ['pass', 'Pass'],
                ['partial', 'Partial'],
                ['fail', 'Fail'],
              ].map(([v, l]) => (
                <label className={review.verdict === v ? 'selected ' + v : ''} key={v}>
                  <input
                    type="radio"
                    name="verdict"
                    checked={review.verdict === v}
                    onChange={() => change('verdict', v)}
                  />
                  {l}
                </label>
              ))}
            </div>
            <div className="two-fields">
              <Field label="Overall quality (1–5)">
                <select
                  value={review.score ?? ''}
                  onChange={(e) => change('score', e.target.value)}
                >
                  <option value="">Unscored</option>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option value={n} key={n}>
                      {n} / 5
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                label="Agent testing time, if known (minutes)"
                hint="Optional manual correction for the inferred testing time."
              >
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={review.testingMinutes ?? ''}
                  onChange={(e) => change('testingMinutes', e.target.value)}
                  placeholder={
                    t.toolCalls ? `Inferred: ${(t.testingMs / 60000).toFixed(2)}m` : 'Unknown'
                  }
                />
              </Field>
            </div>
            <Field
              label="Actual technology used"
              hint="Your verified stack overrides the agent's report in comparisons."
            >
              <input
                value={review.actualStack}
                onChange={(e) => change('actualStack', e.target.value)}
                placeholder={run.report?.actualStack || 'e.g. Three.js r180 + Rapier 0.19.3'}
              />
            </Field>
            <Field label="Playtest notes">
              <textarea
                rows={5}
                value={review.notes}
                onChange={(e) => change('notes', e.target.value)}
                placeholder="How does it play? What is complete, broken, or surprising?"
              />
            </Field>
          </section>
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>Issue checklist</h2>
                <p>
                  “Clear” means you checked and did not find the issue. Leave unchecked items as
                  “Not checked.”
                </p>
              </div>
            </div>
            <div className="table-wrap">
              <table className="review-table">
                <thead>
                  <tr>
                    <th>Issue</th>
                    <th>Observation</th>
                    <th>Human check (min)</th>
                    <th>Fix effort (min)</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {review.issues.map((i, n) => {
                    const edit = (k, v) =>
                      change(
                        'issues',
                        review.issues.map((o, j) => (j === n ? { ...o, [k]: v } : o))
                      );
                    const label =
                      state.settings.issueCatalog.find((x) => x.key === i.key)?.label || i.key;
                    return (
                      <tr key={i.key}>
                        <td>
                          <strong>{label}</strong>
                        </td>
                        <td>
                          <select
                            aria-label={`${label} outcome`}
                            value={i.outcome}
                            onChange={(e) => edit('outcome', e.target.value)}
                          >
                            <option value="untested">Not checked</option>
                            <option value="clear">Clear</option>
                            <option value="found">Found</option>
                          </select>
                        </td>
                        <td>
                          <input
                            aria-label={`${label} check minutes`}
                            type="number"
                            min="0"
                            step="any"
                            placeholder="—"
                            value={i.testMinutes ?? ''}
                            onChange={(e) => edit('testMinutes', e.target.value)}
                          />
                        </td>
                        <td>
                          <input
                            aria-label={`${label} fix minutes`}
                            type="number"
                            min="0"
                            step="any"
                            placeholder="—"
                            value={i.fixMinutes ?? ''}
                            onChange={(e) => edit('fixMinutes', e.target.value)}
                          />
                        </td>
                        <td>
                          <input
                            aria-label={`${label} notes`}
                            value={i.notes || ''}
                            onChange={(e) => edit('notes', e.target.value)}
                            placeholder="Observation…"
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
          <section className="panel">
            <h2>Notes for the next iteration</h2>
            <Field label="Engine feedback">
              <textarea
                rows={3}
                value={review.engineFeedback}
                onChange={(e) => change('engineFeedback', e.target.value)}
                placeholder={
                  run.report?.engineFeedback || 'What should change in the engine or tooling?'
                }
              />
            </Field>
            <Field label="Prompt feedback">
              <textarea
                rows={3}
                value={review.promptFeedback}
                onChange={(e) => change('promptFeedback', e.target.value)}
                placeholder={
                  run.report?.promptFeedback ||
                  'What instructions should be clearer, shorter, or removed?'
                }
              />
            </Field>
          </section>
          <div className="save-review-bar">
            <span>
              {dirty
                ? 'Unsaved review changes'
                : run.review
                  ? `Review saved ${date(run.review.updatedAt)}`
                  : 'Review not saved yet'}
            </span>
            <Button variant="primary" icon={Save} disabled={saving} onClick={save}>
              Save review
            </Button>
          </div>
        </>
      )}
      {tab === 'prompt' && (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Exact submitted prompt</h2>
              <p>Immutable snapshot including all substituted values and metadata instructions.</p>
            </div>
            <a className="button compact" href={`/api/runs/${id}/download?log=prompt.txt`}>
              <Download size={15} />
              Download
            </a>
          </div>
          <p className="hash">SHA-256: {run.promptHash}</p>
          <pre className="prompt-preview">{run.prompt}</pre>
          {run.command && (
            <>
              <h3>Executed command</h3>
              <pre className="command-preview">
                {JSON.stringify([run.command.command, ...run.command.args], null, 2)}
              </pre>
            </>
          )}
          <p className="helper">
            Prompt delivered through stdin. Working directory:{' '}
            {run.workspace || 'Assigned when the run starts.'}
          </p>
        </section>
      )}
      {tab === 'logs' && (
        <>
          <div className="metrics-grid three">
            <Metric
              label="Tool calls"
              value={num(t.toolCalls)}
              sub="Parsed from the runner's event stream"
            />
            <Metric
              label="Testing tool calls*"
              value={num(t.testingCalls)}
              sub="Classified by command keywords"
            />
            <Metric
              label="Testing tool time*"
              value={t.toolCalls ? duration(t.testingMs) : 'Unknown'}
              sub="Union of testing tool intervals"
            />
          </div>
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>Activity stream</h2>
                <p>Most recent 200 events. Full logs are available below.</p>
              </div>
              <span className="live-label">
                <span className={run.status === 'running' ? 'status-dot' : 'muted-dot'} />
                {run.status === 'running' ? 'Live' : 'Recorded'}
              </span>
            </div>
            <div className="event-list">
              {events.length ? (
                events.map((ev, i) => (
                  <div className={`event ${ev.kind}`} key={i}>
                    <time>{new Date(ev.at).toLocaleTimeString()}</time>
                    <span className={`event-kind ${ev.phase || ''}`}>{ev.phase || ev.kind}</span>
                    <pre>{ev.text}</pre>
                  </div>
                ))
              ) : (
                <p className="muted">Events appear when this run starts.</p>
              )}
            </div>
          </section>
          <section className="panel">
            <h2>Full records</h2>
            <div className="chip-row">
              {[
                'stdout.jsonl',
                'stderr.log',
                'events.jsonl',
                'execution.json',
                'final-response.txt',
                'usage-evidence.json',
                'finalization.json',
              ].map((file) => (
                <a
                  key={file}
                  className="button compact"
                  href={`/api/runs/${id}/download?log=${file}`}
                >
                  <Download size={14} />
                  {file}
                </a>
              ))}
            </div>
            <p className="helper">
              * Classification is a heuristic. It can miss checks or count a command that merely
              mentions a test. Tool time excludes model thinking, overlaps are counted once, and
              phase token counts are not inferred. Correct testing time in your human review when
              you have a better measurement.
            </p>
          </section>
        </>
      )}
    </>
  );
}
