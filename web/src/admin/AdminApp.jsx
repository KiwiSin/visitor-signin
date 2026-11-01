import { useCallback, useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { IconCog, IconHome, IconList, IconStaff, IconTablet, IconWarn } from '../icons.jsx';
import Dashboard from './Dashboard.jsx';
import RollCalls from './RollCalls.jsx';
import Settings from './Settings.jsx';
import Staff from './Staff.jsx';
import Tablets from './Tablets.jsx';
import Visits from './Visits.jsx';

export default function AdminApp() {
  const [status, setStatus] = useState(null);
  const [branding, setBranding] = useState(null);
  const location = useLocation();

  const load = useCallback(async () => {
    const [s, b] = await Promise.all([api('/api/auth/status'), api('/api/public/branding')]);
    setStatus(s);
    setBranding(b);
    if (b?.accent) document.documentElement.style.setProperty('--accent', b.accent);
    document.title = `${b?.appName || 'Visitor Sign-In'} · Admin`;
  }, []);
  useEffect(() => { load().catch(() => setStatus({ error: true })); }, [load]);

  if (!status) return null;
  if (status.error) return <div className="a-center"><div className="a-auth"><h1>Can’t reach the server</h1><p>Check that the app is running, then reload.</p></div></div>;
  if (status.needsSetup) return <Setup onDone={load} token={new URLSearchParams(location.search).get('token')} />;
  if (!status.user) return <Login onDone={load} branding={branding} />;

  return (
    <Shell user={status.user} branding={branding} onLogout={load}>
      <Routes>
        <Route index element={<Dashboard />} />
        <Route path="visits" element={<Visits />} />
        <Route path="staff" element={<Staff />} />
        <Route path="tablets" element={<Tablets />} />
        <Route path="rollcalls" element={<RollCalls />} />
        <Route path="settings/*" element={<Settings onBrandingChange={load} user={status.user} />} />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes>
    </Shell>
  );
}

function Shell({ user, branding, onLogout, children }) {
  const navigate = useNavigate();
  const logout = async () => {
    await api('/api/auth/logout', { method: 'POST', body: {} });
    await onLogout();
    navigate('/admin');
  };
  return (
    <div className="a-shell">
      <nav className="a-nav" aria-label="Admin">
        <div className="brand"><img src="/logo-white.svg" alt={branding?.appName || 'Visitor Sign-In'} /></div>
        <NavLink end to="/admin"><IconHome /> Dashboard</NavLink>
        <NavLink to="/admin/visits"><IconList /> Visitor log</NavLink>
        <NavLink to="/admin/staff"><IconStaff /> Staff &amp; teams</NavLink>
        <NavLink to="/admin/tablets"><IconTablet /> Tablets</NavLink>
        <NavLink to="/admin/rollcalls"><IconWarn /> Roll calls</NavLink>
        <NavLink to="/admin/settings"><IconCog /> Settings</NavLink>
        <div className="spacer" />
        <a href="/rollcall" target="_blank" rel="noreferrer" style={{ background: '#B91C1C', color: '#fff', fontWeight: 700 }}>Emergency roll call ↗</a>
        <a href="/kiosk" target="_blank" rel="noreferrer">Open kiosk screen ↗</a>
        <div className="who">Signed in as {user.name}</div>
        <button type="button" className="link" onClick={logout}>Sign out</button>
      </nav>
      <main className="a-main">{children}</main>
    </div>
  );
}

function Login({ onDone, branding }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await api('/api/auth/login', { method: 'POST', body: { email, password } });
      await onDone();
    } catch (err) {
      setError(err.message);
    }
  };
  return (
    <div className="a-center">
      <form className="a-auth" onSubmit={submit}>
        <img src={branding?.logo || '/logo.svg'} alt={branding?.companyName || 'Visitor Sign-In'} />
        <h1>Admin sign in</h1>
        <label className="a-field">Email<input className="a-input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        <label className="a-field">Password<input className="a-input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
        {error && <div className="a-msg bad" role="alert">{error}</div>}
        <button className="a-btn primary" type="submit" style={{ justifyContent: 'center', height: 46 }}>Sign in</button>
      </form>
    </div>
  );
}

function Setup({ onDone, token }) {
  const [f, setF] = useState({ companyName: '', name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await api('/api/auth/setup', { method: 'POST', body: { ...f, token } });
      window.history.replaceState(null, '', '/admin');
      await onDone();
    } catch (err) {
      setError(err.message);
    }
  };
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="a-center">
      <form className="a-auth" onSubmit={submit}>
        <img src="/logo.svg" alt="Visitor Sign-In" />
        <h1>Welcome. Let’s set up</h1>
        <p className="sub" style={{ color: 'var(--muted)', fontSize: 14 }}>Create the first admin account. You can add more people later in Settings.</p>
        {!token && <div className="a-msg warn">Open this page using the setup link printed in the app container’s log (Portainer › Containers › app › Logs).</div>}
        <label className="a-field">Company name<input className="a-input" value={f.companyName} onChange={set('companyName')} required /></label>
        <label className="a-field">Your name<input className="a-input" autoComplete="name" value={f.name} onChange={set('name')} required /></label>
        <label className="a-field">Your email<input className="a-input" type="email" autoComplete="username" value={f.email} onChange={set('email')} required /></label>
        <label className="a-field">Password <span className="hint">At least 10 characters</span>
          <input className="a-input" type="password" autoComplete="new-password" minLength={10} value={f.password} onChange={set('password')} required /></label>
        {error && <div className="a-msg bad" role="alert">{error}</div>}
        <button className="a-btn primary" type="submit" style={{ justifyContent: 'center', height: 46 }}>Create admin account</button>
      </form>
    </div>
  );
}

/** Small shared helpers for admin pages. */
export function Toggle({ on, onChange, label }) {
  return (
    <button type="button" role="switch" aria-checked={!!on} aria-label={label} className={`toggle ${on ? 'on' : ''}`} onClick={() => onChange(!on)}>
      <span />
    </button>
  );
}

export function Modal({ title, children, onClose }) {
  useEffect(() => {
    const esc = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function useFlash() {
  const [msg, setMsg] = useState(null);
  useEffect(() => {
    if (!msg || msg.kind === 'bad') return undefined;
    const t = setTimeout(() => setMsg(null), 4000);
    return () => clearTimeout(t);
  }, [msg]);
  const node = msg ? <div className={`a-msg ${msg.kind}`} role="status">{msg.text}</div> : null;
  const set = useCallback((text, kind = 'ok') => setMsg(text ? { text, kind } : null), []);
  return [node, set];
}
