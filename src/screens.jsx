import React, { useState, useEffect } from 'react';
import {
  Plus,
  ArrowUpRight,
  ArrowRight,
  Play,
  Pause,
  Copy,
  Download,
  Square,
  FlaskConical,
  Activity,
  Clock3,
  CheckCheck,
  Layers3,
  FileText,
  RefreshCw,
  Search,
  Cpu,
  SlidersHorizontal,
  MessageSquare,
  ExternalLink,
  X,
} from 'lucide-react';
import {
  Button,
  PageHead,
  Field,
  Badge,
  Metric,
  SectionTitle,
  Empty,
  RunTable,
  num,
  money,
  duration,
  date,
} from './ui';

export function Overview({ state, navigate, newExperiment, api, refresh, notify }) {
  const [cancelling, setCancelling] = useState(null);
  const { runs, experiments } = state,
    active = runs.filter((r) => r.status === 'running').length,
    finished = runs.filter((r) => r.status === 'completed').length,
    needs = runs.filter(
      (r) => r.status === 'completed' && (!r.review || r.review.verdict === 'unreviewed')
    ).length;
  const queuedCount = runs.filter((r) => r.status === 'queued').length;
  async function cancelQueued(id = null) {
    setCancelling(id || 'all');
    try {
      const result = await api(
        id ? `/api/experiments/${id}/cancel-queued` : '/api/runs/cancel-queued',
        {}
      );
      await refresh();
      notify(
        `Cancelled ${result.cancelledCount} queued run${result.cancelledCount === 1 ? '' : 's'}.`
      );
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setCancelling(null);
    }
  }
  return (
    <>
      <PageHead
        eyebrow="YOUR LOCAL RESEARCH WORKSPACE"
        title="Experiments"
        description="Turn repeated runs into a better next prompt."
      >
        <Button variant="primary" icon={Plus} onClick={() => newExperiment()}>
          New experiment
        </Button>
      </PageHead>
      <div className="metrics-grid">
        <Metric
          label="Active runs"
          value={active.toString().padStart(2, '0')}
          sub={`${Math.max(0, state.settings.concurrency - active)} of ${state.settings.concurrency} slots free`}
          icon={Activity}
          accent
        />
        <Metric
          label="Queued"
          value={num(runs.filter((r) => r.status === 'queued').length)}
          sub="Waiting for an active queue"
          icon={Layers3}
        />
        <Metric
          label="Completed"
          value={num(finished)}
          sub="Execution finished · review still matters"
          icon={CheckCheck}
        />
        <Metric
          label="Awaiting review"
          value={num(needs)}
          sub="Bring a human perspective"
          icon={MessageSquare}
        />
      </div>
      {!experiments.length && (
        <section className="welcome-panel">
          <div>
            <span className="label-pill">FROM EIGHT TERMINALS TO ONE WORKSPACE</span>
            <h2>
              Less managing runs.
              <br />
              More finding what works.
            </h2>
            <p>
              Cross models, effort, tech stacks, and testing constraints. Keep every output
              connected to the choices that produced it.
            </p>
            <Button variant="dark" icon={ArrowRight} onClick={() => newExperiment()}>
              Build your first experiment
            </Button>
          </div>
          <div className="matrix-illustration" aria-hidden="true">
            <div className="mini-run">
              <Cpu size={17} />
              <span>Model + effort</span>
              <span>×</span>
            </div>
            <div className="mini-run">
              <SlidersHorizontal size={17} />
              <span>Your variables</span>
              <span>×</span>
            </div>
            <div className="mini-run result">
              <CheckCheck size={17} />
              <span>Human-tested results</span>
              <span>↗</span>
            </div>
            <div className="mini-caption">
              <span /> Every combination, accounted for.
            </div>
          </div>
        </section>
      )}
      <SectionTitle
        title={`Your experiments${experiments.length ? ' · ' + experiments.length : ''}`}
      >
        <div className="section-actions">
          <span className="muted small">Stored on this machine</span>
          {queuedCount > 0 && (
            <Button
              variant="compact"
              className="danger"
              icon={X}
              disabled={cancelling !== null}
              onClick={() => cancelQueued()}
            >
              Cancel all {queuedCount} queued
            </Button>
          )}
        </div>
      </SectionTitle>
      {experiments.length ? (
        <div className="experiment-grid">
          {experiments.map((e) => {
            const rr = runs.filter((r) => r.experimentId === e.id),
              done = rr.filter((r) =>
                ['completed', 'failed', 'cancelled', 'timed_out', 'interrupted'].includes(r.status)
              ).length,
              queued = rr.filter((r) => r.status === 'queued').length;
            return (
              <article className="experiment-card" key={e.id}>
                <a
                  className="experiment-card-link"
                  href={`/experiment/${e.id}`}
                  onClick={(event) => {
                    event.preventDefault();
                    navigate(`experiment/${e.id}`);
                  }}
                >
                  <div className="split-row">
                    <span className="card-icon">
                      <FlaskConical size={20} />
                    </span>
                    <Badge value={e.status} />
                  </div>
                  <h3>{e.name}</h3>
                  <p>{e.config.models.map((m) => m.model).join(' · ')}</p>
                  <div className="chip-row">
                    {e.config.axes.slice(0, 3).map((a) => (
                      <span key={a.key} className="subtle-chip">
                        {a.options.filter((o) => o.enabled).length} {a.label.toLowerCase()}
                      </span>
                    ))}
                  </div>
                  <div className="progress">
                    <i style={{ width: `${rr.length ? (done / rr.length) * 100 : 0}%` }} />
                  </div>
                  <div className="split-row small muted">
                    <span>
                      {done} / {rr.length} runs finished
                    </span>
                    <ArrowUpRight size={17} />
                  </div>
                  <small className="card-date">Created {date(e.createdAt)}</small>
                </a>
                <div className="experiment-card-actions">
                  <button className="text-button" onClick={() => navigate(`experiment/${e.id}`)}>
                    View runs <ArrowRight size={14} />
                  </button>
                  {queued > 0 && (
                    <Button
                      variant="ghost compact"
                      className="danger"
                      icon={X}
                      disabled={cancelling !== null}
                      onClick={() => cancelQueued(e.id)}
                    >
                      {cancelling === e.id ? 'Cancelling…' : `Cancel ${queued} queued`}
                    </Button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="starter-card">
          <span className="card-icon">
            <FileText size={22} />
          </span>
          <div>
            <h3>Your game prompt is ready</h3>
            <p>
              Imported with tech stack, art direction, animation, source, and all five testing
              options.
            </p>
          </div>
          <Button icon={ArrowRight} onClick={() => newExperiment()}>
            Use this prompt
          </Button>
        </div>
      )}
      {runs.length > 0 && (
        <>
          <SectionTitle title="Recent runs">
            <button className="text-button" onClick={() => navigate('runs')}>
              View all runs <ArrowRight size={14} />
            </button>
          </SectionTitle>
          <section className="panel table-panel">
            <RunTable
              runs={[...runs].reverse().slice(0, 6)}
              onRun={(id) => navigate(`run/${id}`)}
            />
          </section>
        </>
      )}
      <div className="workspace-footer">
        <span className="status-dot" />
        Local queue · exact prompts · traceable results<span>GPT HUB / LAB NOTEBOOK</span>
      </div>
    </>
  );
}
export function Experiment({
  experiment: e,
  state,
  api,
  refresh,
  notify,
  navigate,
  newExperiment,
}) {
  const [filter, setFilter] = useState('all'),
    [busy, setBusy] = useState(false);
  if (!e)
    return <Empty title="Experiment not found">Choose an experiment from the workbench.</Empty>;
  const runs = state.runs.filter((r) => r.experimentId === e.id),
    done = runs.filter((r) => r.status === 'completed').length,
    reviewed = runs.filter((r) => r.review && r.review.verdict !== 'unreviewed').length;
  async function action(a) {
    setBusy(true);
    try {
      await api(`/api/experiments/${e.id}/${a}`, {});
      await refresh();
      notify(
        a === 'pause'
          ? 'Queue paused. Active runs continue.'
          : a === 'cancel'
            ? 'Experiment stopped.'
            : 'Queue started.'
      );
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button className="back-link" onClick={() => navigate('experiments')}>
        ← All experiments
      </button>
      <PageHead
        eyebrow={`PROMPT VERSION ${e.promptVersion}`}
        title={e.name}
        description={`Created ${date(e.createdAt)} · ${runs.length} attempts · ${e.config.randomize ? 'Shuffled' : 'Ordered'} execution`}
      >
        <Button
          icon={Copy}
          onClick={() =>
            newExperiment({ ...e.config, name: e.name + ' · next iteration', parentId: e.id })
          }
        >
          Duplicate & edit
        </Button>
        {e.status === 'running' ? (
          <Button icon={Pause} disabled={busy} onClick={() => action('pause')}>
            Pause queue
          </Button>
        ) : (
          runs.some((r) => r.status === 'queued') && (
            <Button variant="primary" icon={Play} disabled={busy} onClick={() => action('start')}>
              {e.status === 'draft' ? 'Start experiment' : 'Resume queue'}
            </Button>
          )
        )}
        {runs.some((r) => ['running', 'queued'].includes(r.status)) && (
          <Button
            variant="ghost danger"
            icon={Square}
            disabled={busy}
            onClick={() => action('cancel')}
          >
            Stop all
          </Button>
        )}
      </PageHead>
      {e.status === 'paused' && e.pauseReason && <div className="alert">{e.pauseReason}</div>}
      <div className="experiment-summary">
        <Badge value={e.status} />
        <span>{done} completed</span>
        <span>{reviewed} human reviews</span>
        <span>Timeout {e.config.timeoutMinutes}m per run</span>
        {e.config.models.some((m) => m.provider === 'rehearsal') && (
          <span className="fixture-label">Includes local rehearsal</span>
        )}
      </div>
      <div className="toolbar">
        <div className="filter-pills">
          {['all', 'running', 'queued', 'completed', 'failed', 'unreviewed'].map((f) => (
            <button key={f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>
              {f === 'all' ? 'All runs' : f}
            </button>
          ))}
        </div>
        <a className="button ghost compact" href={`/api/export?format=csv&experimentId=${e.id}`}>
          <Download size={15} /> Export CSV
        </a>
      </div>
      <section className="panel table-panel">
        <RunTable
          runs={runs.filter(
            (r) =>
              filter === 'all' ||
              (filter === 'unreviewed'
                ? r.status === 'completed' && (!r.review || r.review.verdict === 'unreviewed')
                : r.status === filter)
          )}
          onRun={(id) => navigate(`run/${id}`)}
        />
      </section>
      <details className="panel prompt-snapshot">
        <summary>
          <FileText size={17} /> Saved prompt & execution settings
        </summary>
        <pre className="prompt-preview">{e.config.template}</pre>
        <p className="helper">
          Permission mode: {e.config.permissions}. Structured feedback:{' '}
          {e.config.captureReport ? 'requested' : 'off'}. Every run stores the final rendered prompt
          and command.
        </p>
      </details>
    </>
  );
}
export function Runs({ state, navigate }) {
  const [q, setQ] = useState(''),
    [status, setStatus] = useState('all'),
    [exp, setExp] = useState('');
  const rows = [...state.runs]
    .reverse()
    .filter(
      (r) =>
        (!exp || r.experimentId === exp) &&
        (status === 'all' ||
          (status === 'needs_review'
            ? r.status === 'completed' && (!r.review || r.review.verdict === 'unreviewed')
            : r.status === status)) &&
        JSON.stringify([r.model, r.effort, r.variables, r.review?.notes])
          .toLowerCase()
          .includes(q.toLowerCase())
    );
  return (
    <>
      <PageHead
        title="Run library"
        description="The complete record: output, prompt, usage, and your verdict."
      >
        <a className="button" href="/api/export?format=csv">
          <Download size={16} />
          Export CSV
        </a>
      </PageHead>
      <div className="toolbar">
        <label className="search-input">
          <Search size={16} />
          <input
            aria-label="Search runs"
            placeholder="Search models, variables, notes…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
        <div className="inline-controls">
          <select
            aria-label="Experiment filter"
            value={exp}
            onChange={(e) => setExp(e.target.value)}
          >
            <option value="">All experiments</option>
            {state.experiments.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Status filter"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            {[
              'all',
              'needs_review',
              'queued',
              'running',
              'completed',
              'failed',
              'timed_out',
              'cancelled',
              'interrupted',
              'orphaned',
            ].map((s) => (
              <option value={s} key={s}>
                {s.replaceAll('_', ' ')}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p className="muted small">{rows.length} runs</p>
      <section className="panel table-panel">
        <RunTable runs={rows} onRun={(id) => navigate(`run/${id}`)} />
      </section>
    </>
  );
}
export function Insights({ state, api, navigate }) {
  const [groupBy, setGroupBy] = useState('testing'),
    [exp, setExp] = useState(''),
    [include, setInclude] = useState(false),
    [analysis, setAnalysis] = useState(null),
    [error, setError] = useState(''),
    [tab, setTab] = useState('compare'),
    [query, setQuery] = useState('');
  useEffect(() => {
    let active = true;
    api(
      `/api/analysis?groupBy=${encodeURIComponent(groupBy)}&experimentId=${exp}&includeRehearsal=${include}`
    )
      .then((a) => {
        if (active) {
          setAnalysis(a);
          setError('');
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [groupBy, exp, include, state.runs]);
  const axes = [
    ...new Set(state.experiments.flatMap((e) => e.config.axes.map((a) => a.key))),
  ].filter((k) => !['TESTING', 'STACK'].includes(k));
  return (
    <>
      <PageHead
        eyebrow="EVIDENCE, BEFORE INTUITION"
        title="Patterns & tradeoffs"
        description="See what improves the output, and what only adds work."
      >
        <a className="button" href={`/api/export?format=json${exp ? '&experimentId=' + exp : ''}`}>
          <Download size={16} />
          Export evidence
        </a>
      </PageHead>
      <div className="toolbar">
        <div className="tabs">
          {[
            ['compare', 'Compare results'],
            ['issues', 'Issue frequency'],
            ['feedback', 'Agent feedback'],
          ].map(([v, l]) => (
            <button key={v} className={tab === v ? 'active' : ''} onClick={() => setTab(v)}>
              {l}
            </button>
          ))}
        </div>
        <select
          aria-label="Analyze experiment"
          value={exp}
          onChange={(e) => setExp(e.target.value)}
        >
          <option value="">All experiments</option>
          {state.experiments.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
      </div>
      <label className="check-line small">
        <input type="checkbox" checked={include} onChange={(e) => setInclude(e.target.checked)} />{' '}
        Include local rehearsal fixtures
      </label>
      {error && <div className="alert error">{error}</div>}
      {!analysis ? (
        <div className="loading">Loading evidence…</div>
      ) : !analysis.runCount ? (
        <section className="panel">
          <Empty
            title="Your patterns start with your runs"
            action={<Button onClick={() => navigate('experiments')}>Go to experiments</Button>}
          >
            Start an experiment, open its outputs, and add human reviews. Rehearsal fixtures are
            excluded by default.
          </Empty>
        </section>
      ) : (
        <>
          <div className="insight-context">
            <span>
              <strong>{analysis.runCount}</strong> started attempts
            </span>
            <span>
              <strong>{analysis.reviewed}</strong> human reviews
            </span>
            <span>Includes retries and failed attempts</span>
          </div>
          {tab === 'compare' && (
            <>
              <div className="toolbar">
                <h2>Quality against cost</h2>
                <Field label="Group by">
                  <select value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
                    {[
                      ['testing', 'Testing constraint'],
                      ['model', 'Requested model'],
                      ['effort', 'Reasoning effort'],
                      ['model_effort', 'Model + effort'],
                      ['stack', 'Requested tech stack'],
                      ['actualStack', 'Reported / reviewed tech stack'],
                      ['prompt', 'Prompt version'],
                      ...axes.map((a) => [a, a]),
                    ].map(([v, l]) => (
                      <option value={v} key={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <section className="panel table-panel">
                <div className="table-wrap">
                  <table className="comparison-table">
                    <thead>
                      <tr>
                        <th>Group</th>
                        <th>Human pass rate</th>
                        <th>Quality / 5</th>
                        <th>Avg. tokens</th>
                        <th>Avg. time</th>
                        <th>Avg. cost</th>
                        <th>Testing time*</th>
                        <th>Total time / pass†</th>
                        <th>Total cost / pass†</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analysis.groups.map((g) => (
                        <tr key={g.label}>
                          <td>
                            <strong>{g.label}</strong>
                            <small>
                              {g.runs} attempts · {g.reviewed} reviewed
                            </small>
                          </td>
                          <td>
                            <div className="pass-bar">
                              <i style={{ width: `${(g.passRate || 0) * 100}%` }} />
                            </div>
                            <small>
                              {g.passRate == null
                                ? 'No reviews'
                                : `${Math.round(g.passRate * 100)}% · ${g.passed}/${g.reviewed}`}
                            </small>
                          </td>
                          <td>{num(g.score)}</td>
                          <td>
                            {num(g.meanTokens)}
                            <small>
                              {g.tokenCoverage}/{g.runs} measured
                            </small>
                          </td>
                          <td>{duration(g.meanMs)}</td>
                          <td>
                            {money(g.meanCost)}
                            <small>
                              {g.costCoverage}/{g.runs} known
                            </small>
                          </td>
                          <td>
                            {duration(g.meanTestingMs)}
                            <small>
                              {g.testingCoverage}/{g.runs} measured
                            </small>
                          </td>
                          <td>{duration(g.timePerPass)}</td>
                          <td>{money(g.costPerPass)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
              <div className="method-note">
                <p>
                  * Testing time uses your manual run total when supplied; otherwise it uses elapsed
                  tool intervals with testing keywords. This is a heuristic, not a token allocation.
                  Parallel tool intervals are counted once.
                </p>
                <p>
                  † Cost and time per pass include every started attempt in the group and appear
                  only when all attempts have reviews and the corresponding measurement. Group
                  averages use measured values; unknowns are excluded. CLI cost can be
                  API-equivalent, not a subscription invoice.
                </p>
                <p>
                  These are descriptive comparisons. Source games, prompt versions, and other
                  variables can differ; filter to a controlled experiment before attributing a
                  difference to one variable.
                </p>
              </div>
            </>
          )}
          {tab === 'issues' && (
            <>
              <SectionTitle title="What is worth checking?">
                <span className="small muted">Human-observed issues</span>
              </SectionTitle>
              <section className="panel table-panel">
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Issue</th>
                        <th>Found / checked</th>
                        <th>Occurrence</th>
                        <th>Time checking</th>
                        <th>Time fixing</th>
                        <th>Evidence</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analysis.issues.map((i) => (
                        <tr key={i.key}>
                          <td>
                            <strong>{i.label}</strong>
                          </td>
                          <td>
                            {i.found} / {i.checked}
                          </td>
                          <td>{i.rate == null ? 'Not checked' : Math.round(i.rate * 100) + '%'}</td>
                          <td>
                            {i.testMinutes == null ? '—' : `${num(i.testMinutes)}m`}
                            <small>
                              {i.testTimeCoverage}/{i.checked} timed
                            </small>
                          </td>
                          <td>
                            {i.fixMinutes == null ? '—' : `${num(i.fixMinutes)}m`}
                            <small>
                              {i.fixTimeCoverage}/{i.found} timed
                            </small>
                          </td>
                          <td>
                            <span className="evidence-note">
                              {!i.checked
                                ? 'No observation yet'
                                : !i.found
                                  ? `No cases observed; 95% upper bound ≈ ${Math.round(i.zeroUpperBound * 100)}%`
                                  : `${i.found} case${i.found === 1 ? '' : 's'} to investigate`}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
              <div className="method-note">
                <p>
                  The denominator includes only checks marked “Clear” or “Found.” “Not checked” is
                  excluded. Zero observed cases does not prove an issue never occurs; the upper
                  bound assumes independent comparable trials.
                </p>
                <p>
                  Compare checking time with repair time and the cost of another attempt. Human
                  check time and agent testing time are distinct measurements. These observations
                  can guide a shorter checklist or a targeted tool; they do not automatically
                  establish causation or ROI.
                </p>
              </div>
              {analysis.agentPatterns.length > 0 && (
                <section className="panel">
                  <h2>Agent-reported issue tags</h2>
                  <p className="muted">Unverified reports, separate from your human checklist.</p>
                  <div className="chip-row">
                    {analysis.agentPatterns.map((t) => (
                      <span className="subtle-chip" key={t.label}>
                        {t.label} · {t.count}
                      </span>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
          {tab === 'feedback' && (
            <>
              <label className="search-input feedback-search">
                <Search size={17} />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Find recurring feedback, libraries, or friction…"
                  aria-label="Search feedback"
                />
              </label>
              <div className="feedback-grid">
                {analysis.feedback
                  .filter((f) => JSON.stringify(f).toLowerCase().includes(query.toLowerCase()))
                  .map((f) => (
                    <article className="panel feedback-card" key={f.runId}>
                      <div className="split-row">
                        <strong>{f.source}</strong>
                        <Badge value={f.verdict} />
                      </div>
                      <p className="small muted">
                        {f.model} · {f.testing}
                      </p>
                      <span className="subtle-chip">{f.actualStack}</span>
                      <h3>Engine feedback</h3>
                      <p className="preserve">{f.engine || 'No feedback captured.'}</p>
                      <h3>Prompt feedback</h3>
                      <p className="preserve">{f.prompt || 'No feedback captured.'}</p>
                      <button className="text-button" onClick={() => navigate(`run/${f.runId}`)}>
                        Inspect source run <ArrowUpRight size={14} />
                      </button>
                    </article>
                  ))}
              </div>
              {!analysis.feedback.length && (
                <Empty title="Feedback has not arrived yet">
                  Agent reports and your review notes appear here, linked to the original run.
                </Empty>
              )}
            </>
          )}
        </>
      )}
    </>
  );
}
export function Library({ state, newExperiment, api, refresh, notify }) {
  const [name, setName] = useState(''),
    [text, setText] = useState('');
  async function save() {
    try {
      await api('/api/templates', { name, template: text, axes: [] });
      setName('');
      setText('');
      await refresh();
      notify('Prompt saved.');
    } catch (e) {
      notify(e.message, 'error');
    }
  }
  return (
    <>
      <PageHead
        title="Prompt library"
        description="Keep the original. Make the next version measurable."
      />
      <div className="experiment-grid">
        {[
          { ...state.starter, id: 'original', version: 'Original attachment' },
          ...state.templates,
        ].map((t) => (
          <article className="panel library-card" key={t.id}>
            <FileText size={22} />
            <h3>{t.name}</h3>
            <span className="subtle-chip">{t.version}</span>
            <p className="prompt-excerpt">{t.template.slice(0, 230)}…</p>
            <Button icon={ArrowRight} onClick={() => newExperiment(null, t)}>
              Use prompt
            </Button>
          </article>
        ))}
      </div>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Add a prompt</h2>
            <p>Paste another prompt to reuse in future experiments.</p>
          </div>
        </div>
        <Field label="Prompt name">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Shorter controller-first prompt"
          />
        </Field>
        <Field label="Prompt text">
          <textarea
            rows={8}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste your prompt here…"
          />
        </Field>
        <Button variant="primary" onClick={save}>
          Save prompt
        </Button>
      </section>
    </>
  );
}
export function Settings({ state, api, refresh, notify }) {
  const [s, setS] = useState(() => structuredClone(state.settings)),
    [priceModel, setPriceModel] = useState(
      'codex:' + state.catalog.models.find((m) => m.provider === 'codex')?.model
    ),
    [rates, setRates] = useState({ input: '', cached: '', output: '', cacheWrite: '' }),
    [issue, setIssue] = useState(''),
    [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      await api('/api/settings', s);
      await refresh();
      notify('Settings saved.');
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHead
        title="Runners & settings"
        description="Your accounts, your machine, your experiment rules."
      >
        <Button variant="primary" onClick={save} disabled={busy}>
          Save settings
        </Button>
      </PageHead>
      <div className="settings-grid">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Connected CLIs</h2>
              <p>Uses the same authentication as your terminal.</p>
            </div>
            <button
              className="icon-button"
              aria-label="Refresh runners"
              onClick={async () => {
                await api('/api/providers/refresh', {});
                await refresh();
                notify('Runner status refreshed.');
              }}
            >
              <RefreshCw size={16} />
            </button>
          </div>
          {state.providers.map((p) => (
            <div className="provider-row" key={p.name}>
              <span className={`provider-icon ${p.name}`}>
                <Cpu size={20} />
              </span>
              <div>
                <strong>{p.name === 'codex' ? 'Codex CLI' : 'Claude Code'}</strong>
                <small>{p.version || 'Not installed'}</small>
              </div>
              <span className={`connection ${p.auth === 'signed in' ? 'connected' : ''}`}>
                <i />
                {p.auth}
              </span>
            </div>
          ))}
          <p className="helper">
            To change accounts, use <code>codex login</code> or <code>claude auth login</code> in
            your terminal, then refresh. Runs inherit CLI configuration and installed tools.
          </p>
        </section>
        <section className="panel">
          <h2>Queue capacity</h2>
          <Field
            label="Maximum concurrent runs"
            hint="Shared across all experiments. Lowering the limit lets existing runs finish."
          >
            <input
              type="number"
              min="1"
              max="32"
              value={s.concurrency}
              onChange={(e) => setS({ ...s, concurrency: Number(e.target.value) })}
            />
          </Field>
          <div className="info-note">
            Keep the local server running for the queue to continue. On restart, unfinished
            processes are checked and affected experiments are paused for review.
          </div>
        </section>
      </div>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>API cost estimates</h2>
            <p>USD per million tokens. Prices are snapshotted when a run starts.</p>
          </div>
        </div>
        <p className="helper">
          Published standard token rates are used for the models below. Custom prices override them;
          other models remain unknown unless the CLI reports a cost. Estimates are not subscription
          charges and exclude tool fees and service-tier or regional adjustments. Context tiers use
          each request size, not the sum of a long session.
        </p>
        {Object.entries(state.publishedPrices || {}).map(([key, p]) => (
          <div className="saved-rate" key={key}>
            <strong>{key}</strong>
            <span>
              Input ${p.input} · cached ${p.cached} · cache write ${p.cacheWrite} · output $
              {p.output} / 1M tokens
            </span>
            <a className="text-button" href={p.sourceUrl} target="_blank" rel="noopener noreferrer">
              Rates verified {p.verifiedAt} ↗
            </a>
          </div>
        ))}
        <div className="price-form">
          <Field label="Runner:model">
            <input
              value={priceModel}
              onChange={(e) => setPriceModel(e.target.value)}
              placeholder="codex:model-id"
            />
          </Field>
          {[
            ['input', 'Input'],
            ['cached', 'Cached input'],
            ['output', 'Output'],
            ['cacheWrite', 'Cache write (optional)'],
          ].map(([k, l]) => (
            <Field label={l} key={k}>
              <input
                type="number"
                min="0"
                step="any"
                value={rates[k]}
                onChange={(e) => setRates({ ...rates, [k]: e.target.value })}
              />
            </Field>
          ))}
          <Button
            onClick={() => {
              if (
                !/^(codex|claude):.+/.test(priceModel) ||
                ['input', 'cached', 'output'].some((k) => rates[k] === '' || Number(rates[k]) < 0)
              ) {
                notify('Enter a runner:model and all three required prices.', 'error');
                return;
              }
              const p = Object.fromEntries(
                Object.entries(rates)
                  .filter(([k, v]) => v !== '')
                  .map(([k, v]) => [k, Number(v)])
              );
              setS({ ...s, prices: { ...s.prices, [priceModel]: p } });
              setRates({ input: '', cached: '', output: '', cacheWrite: '' });
            }}
          >
            Add / replace
          </Button>
        </div>
        {Object.entries(s.prices).map(([k, p]) => (
          <div className="saved-rate" key={k}>
            <strong>{k}</strong>
            <span>
              Input ${p.input} · cache ${p.cached} · output ${p.output}
              {p.cacheWrite != null ? ' · cache write $' + p.cacheWrite : ''}
            </span>
            <button
              className="text-button danger"
              onClick={() => {
                const prices = { ...s.prices };
                delete prices[k];
                setS({ ...s, prices });
              }}
            >
              Remove
            </button>
          </div>
        ))}
      </section>
      <section className="panel">
        <h2>Human review checklist</h2>
        <p className="muted">
          Track recurring problems, including checks that rarely find anything.
        </p>
        <div className="catalog-list">
          {s.issueCatalog.map((i, n) => (
            <Field label={i.key} key={i.key}>
              <input
                value={i.label}
                onChange={(e) =>
                  setS({
                    ...s,
                    issueCatalog: s.issueCatalog.map((o, j) =>
                      j === n ? { ...o, label: e.target.value } : o
                    ),
                  })
                }
              />
            </Field>
          ))}
        </div>
        <div className="inline-controls">
          <input
            aria-label="New issue category"
            placeholder="Add an issue to watch for…"
            value={issue}
            onChange={(e) => setIssue(e.target.value)}
          />
          <Button
            icon={Plus}
            onClick={() => {
              if (!issue.trim()) return;
              const key = 'issue_' + Date.now().toString(36);
              setS({ ...s, issueCatalog: [...s.issueCatalog, { key, label: issue.trim() }] });
              setIssue('');
            }}
          >
            Add category
          </Button>
        </div>
      </section>
      <section className="panel">
        <h2>Your data</h2>
        <p className="muted">
          SQLite records, prompts, logs, and artifacts live in the project's <code>data/</code>{' '}
          folder by default. Back up that folder with the server stopped.
        </p>
        <div className="inline-controls">
          <a className="button" href="/api/export?format=json">
            <Download size={15} /> Export records as JSON
          </a>
          <a className="button" href="/api/export?format=csv">
            <Download size={15} /> Export runs as CSV
          </a>
        </div>
        <p className="helper">
          Exports include prompts, feedback, review outcomes and metrics. Artifact files remain in
          the data folder and can be downloaded from each run.
        </p>
      </section>
    </>
  );
}
