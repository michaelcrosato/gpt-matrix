import React, { useId } from 'react';
import { ArrowUpRight, ChevronRight, FlaskConical, LoaderCircle } from 'lucide-react';
export const num = (v) =>
  v == null
    ? '—'
    : new Intl.NumberFormat('en', {
        notation: Math.abs(v) >= 10000 ? 'compact' : 'standard',
        maximumFractionDigits: 1,
      }).format(v);
export const money = (v) => (v == null ? 'Unknown' : `$${v.toFixed(v < 1 ? 4 : 2)}`);
export function duration(ms) {
  if (ms == null) return '—';
  const s = Math.round(ms / 1000);
  return s < 60
    ? `${s}s`
    : s < 3600
      ? `${Math.floor(s / 60)}m ${s % 60}s`
      : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}
export const date = (v) =>
  v
    ? new Date(v).toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : '—';
export function Badge({ value }) {
  return (
    <span className={`badge ${value}`}>
      {value === 'running' && <LoaderCircle size={12} className="spin" />}
      {value?.replaceAll('_', ' ') || 'unreviewed'}
    </span>
  );
}
export function Button({ children, icon: Icon, variant = '', className = '', ...props }) {
  return (
    <button className={`button ${variant} ${className}`} {...props}>
      {Icon && <Icon size={16} />}
      <span>{children}</span>
    </button>
  );
}
export function Empty({ title, children, action }) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <FlaskConical size={27} />
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
export function PageHead({ eyebrow, title, description, children }) {
  return (
    <header className="page-head">
      <div>
        <div className="eyebrow">{eyebrow || 'EXPERIMENT WORKBENCH'}</div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      <div className="head-actions">{children}</div>
    </header>
  );
}
export function Field({ label, hint, children, className = '' }) {
  const generated = useId(),
    items = React.Children.toArray(children),
    control = items.findIndex((c) => ['input', 'select', 'textarea'].includes(c.type)),
    id = items[control]?.props.id || generated;
  return (
    <div className={`field ${className}`}>
      <label htmlFor={id}>{label}</label>
      {items.map((child, i) =>
        i === control
          ? React.cloneElement(child, {
              id,
              'aria-describedby': hint ? `${id}-hint` : child.props['aria-describedby'],
            })
          : child
      )}
      {hint && <small id={`${id}-hint`}>{hint}</small>}
    </div>
  );
}
export function Metric({ label, value, sub, icon: Icon, accent }) {
  return (
    <div className={`metric ${accent ? 'accent' : ''}`}>
      <div className="metric-label">
        {label}
        {Icon && <Icon size={17} />}
      </div>
      <strong>{value}</strong>
      <small>{sub}</small>
    </div>
  );
}
export function SectionTitle({ title, children }) {
  return (
    <div className="section-title">
      <h2>{title}</h2>
      {children}
    </div>
  );
}
export function RunTable({ runs, experiments, onRun }) {
  if (!runs.length)
    return (
      <Empty title="No runs here yet">
        Your selected combinations will appear here with their status and results.
      </Empty>
    );
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Run / source</th>
            <th>Model & effort</th>
            <th>Testing</th>
            <th>Status</th>
            <th>Tokens</th>
            <th>Time</th>
            <th>Cost</th>
            <th>Human review</th>
            <th>
              <span className="sr-only">Open</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.id} onClick={() => onRun(r.id)}>
              <td>
                <button
                  className="text-button row-name"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRun(r.id);
                  }}
                >
                  {r.variables.SOURCE?.label || `Run ${r.sequence}`}
                  <ChevronRight size={14} />
                </button>
                <small>
                  #{String(r.sequence).padStart(3, '0')} · repeat {r.repeat}
                  {r.parentId ? ' · retry' : ''}
                </small>
              </td>
              <td>
                <strong className="model-name">{r.model}</strong>
                <small>
                  {r.provider} · {r.effort}
                </small>
              </td>
              <td>
                <span className="subtle-chip">{r.variables.TESTING?.label || 'Not specified'}</span>
              </td>
              <td>
                <Badge value={r.status} />
              </td>
              <td className="numeric">
                {num(
                  r.telemetry.inputTokens == null || r.telemetry.outputTokens == null
                    ? null
                    : r.telemetry.inputTokens + r.telemetry.outputTokens
                )}
              </td>
              <td className="numeric">
                {duration(
                  r.durationMs ??
                    (r.startedAt && !r.endedAt ? Date.now() - Date.parse(r.startedAt) : null)
                )}
              </td>
              <td className="numeric">{money(r.telemetry.costUsd)}</td>
              <td>
                <Badge value={r.review?.verdict || 'unreviewed'} />
              </td>
              <td>
                <ArrowUpRight size={15} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
