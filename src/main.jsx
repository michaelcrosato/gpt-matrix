import React, { useState, useEffect, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import {
  FlaskConical,
  LayoutGrid,
  Rows3,
  ChartNoAxesCombined,
  BookOpen,
  Settings2,
  Plus,
  ArrowUpRight,
  Check,
  X,
  Menu,
  CircleHelp,
} from 'lucide-react';
import Builder, { defaultConfig } from './builder';
import { Overview, Experiment, Runs, Insights, Library, Settings } from './screens';
import Run from './run';
import './style.css';

async function api(url, body) {
  const res = await fetch(
    url,
    body === undefined
      ? {}
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}
const readRoute = () => location.hash.slice(1) || location.pathname.slice(1) || 'experiments';
function App() {
  const [state, setState] = useState(null),
    [route, setRoute] = useState(readRoute),
    [error, setError] = useState(''),
    [toast, setToast] = useState(null),
    [initial, setInitial] = useState(null),
    [buildKey, setBuildKey] = useState(0),
    [menu, setMenu] = useState(false);
  const notify = useCallback((text, type = 'success') => setToast({ text, type }), []);
  const refresh = useCallback(async () => {
    try {
      const s = await api('/api/state');
      setState(s);
      setError('');
      return s;
    } catch (e) {
      setError(e.message);
    }
  }, []);
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 2500);
    const onHash = () => {
      setRoute(readRoute());
      setMenu(false);
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onHash);
    window.addEventListener('popstate', onHash);
    return () => {
      clearInterval(t);
      window.removeEventListener('hashchange', onHash);
      window.removeEventListener('popstate', onHash);
    };
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);
  function navigate(r) {
    history.pushState(null, '', '/' + r);
    setRoute(r);
    setMenu(false);
    window.scrollTo(0, 0);
  }
  function newExperiment(config = null, template = null) {
    setInitial(config || defaultConfig(state, template));
    setBuildKey((k) => k + 1);
    navigate('new');
  }
  const props = { state, api, refresh, notify, navigate, newExperiment };
  const [page, id] = route.split('/');
  const nav = [
    ['experiments', 'Experiments', LayoutGrid],
    ['runs', 'Run library', Rows3],
    ['insights', 'Patterns & tradeoffs', ChartNoAxesCombined],
    ['prompts', 'Prompt library', BookOpen],
  ];
  return (
    <div className="app-shell">
      <aside className={`sidebar ${menu ? 'mobile-open' : ''}`}>
        <a
          className="brand"
          href="/experiments"
          onClick={(e) => {
            e.preventDefault();
            navigate('experiments');
          }}
        >
          <span className="brand-mark">
            <FlaskConical size={22} />
          </span>
          <span>
            gpt<span className="brand-light">hub</span>
            <small>EXPERIMENT WORKBENCH</small>
          </span>
        </a>
        <div className="workspace-switch">
          <span className="workspace-avatar">M</span>
          <div>
            <strong>My workspace</strong>
            <small>Local · private</small>
          </div>
          <span className="status-dot" />
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav>
          {nav.map(([r, label, Icon]) => (
            <a
              href={`/${r}`}
              onClick={(e) => {
                e.preventDefault();
                navigate(r);
              }}
              className={
                page === r ||
                (r === 'experiments' && ['experiment', 'new'].includes(page)) ||
                (r === 'runs' && page === 'run')
                  ? 'active'
                  : ''
              }
              key={r}
            >
              <Icon size={18} />
              <span>{label}</span>
              {r === 'runs' && state?.runs.length > 0 && (
                <small className="nav-count">{state.runs.length}</small>
              )}
            </a>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="queue-status">
            <div className="split-row">
              <span className="small">Runner capacity</span>
              <strong>
                {state?.runs.filter((r) => r.status === 'running').length || 0} /{' '}
                {state?.settings.concurrency || 8}
              </strong>
            </div>
            <div className="slots">
              {Array.from({ length: Math.min(state?.settings.concurrency || 8, 16) }, (_, i) => (
                <i
                  key={i}
                  className={
                    i < (state?.runs.filter((r) => r.status === 'running').length || 0)
                      ? 'busy'
                      : ''
                  }
                />
              ))}
            </div>
            <small>Ready for your next experiment</small>
          </div>
          <a
            className={`settings-link ${page === 'settings' ? 'active' : ''}`}
            href="/settings"
            onClick={(e) => {
              e.preventDefault();
              navigate('settings');
            }}
          >
            <Settings2 size={18} />
            Runners & settings
          </a>
          <div className="sidebar-foot">
            <span className="avatar">M</span>
            <span>Your research, on your machine.</span>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <button
            className="icon-button mobile-menu"
            aria-label="Toggle navigation"
            aria-expanded={menu}
            onClick={() => setMenu(!menu)}
          >
            <Menu size={20} />
          </button>
          <div className="breadcrumb">
            Workspace <span>/</span>
            <strong>
              {page === 'new'
                ? 'New experiment'
                : page === 'run'
                  ? 'Run details'
                  : page === 'experiment'
                    ? 'Experiment'
                    : nav.find((n) => n[0] === page)?.[1] || 'Settings'}
            </strong>
          </div>
          <div className="topbar-right">
            <span className="local-pill">
              <span className="status-dot" />
              Local runner
            </span>
            <span className="avatar small-avatar">M</span>
          </div>
        </header>
        <main>
          {error && (
            <div className="alert error" role="alert">
              Cannot reach the local server: {error}. Retrying…
            </div>
          )}
          {!state ? (
            <div className="loading">Connecting to your workbench…</div>
          ) : page === 'new' ? (
            <Builder key={buildKey} {...props} initial={initial} />
          ) : page === 'experiment' ? (
            <Experiment {...props} experiment={state.experiments.find((e) => e.id === id)} />
          ) : page === 'run' ? (
            <Run key={id} id={id} {...props} />
          ) : page === 'runs' ? (
            <Runs {...props} />
          ) : page === 'insights' ? (
            <Insights {...props} />
          ) : page === 'prompts' ? (
            <Library {...props} />
          ) : page === 'settings' ? (
            <Settings {...props} />
          ) : (
            <Overview {...props} />
          )}
        </main>
      </div>
      {toast && (
        <div className={`toast ${toast.type}`} role="status">
          {toast.type === 'error' ? <X size={17} /> : <Check size={17} />}
          <span>{toast.text}</span>
          <button aria-label="Dismiss message" onClick={() => setToast(null)}>
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
createRoot(document.getElementById('root')).render(<App />);
