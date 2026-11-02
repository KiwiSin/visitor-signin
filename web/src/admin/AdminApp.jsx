import { useCallback, useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { IconCog, IconHome, IconList, IconStaff, IconTablet, IconWarn } from '../icons.jsx';
import Dashboard from './Dashboard.jsx';
import { applyTheme, colorsOf, logoFor } from '../theme.js';
import { appPath, slug } from '../tenant.js';
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
    const s = await api('/api/auth/status');
    setStatus(s);
    const b = await api('/api/public/branding').catch(() => null);
    setBranding(b);
    applyTheme(b);
    document.title = `${b?.companyName || 'Visitor Sign-In'} · Admin`;
  }, []);
  useEffect(() => { load().catch(() => setStatus({ error: true })); }, [load]);

  if (!status) return null;
  if (status.error) return <Message title="Can’t reach the server">Check that the app is running, then reload.</Message>;
  if (status.needsSetup) return <Setup onDone={load} token={new URLSearchParams(location.search).get('token')} />;
  if (!status.business) return <Message title="Business not found">There is no business at this address. Check the link you were given.</Message>;
  if (!status.user) return <Login onDone={load} branding={branding} />;
  if (!status.canManage) {
    const u = status.user;
    return (
      <Message title="This account is for a different business">
        You are signed in as {u.email}.{' '}
        {u.businessSlug ? <a href={`/b/${u.businessSlug}/admin`}>Go to {u.businessName}</a> : null}
        {u.isHost ? <> · <a href="/host">Host console</a></> : null}
        {' · '}<button type="button" className="a-btn sm" onClick={async () => { await api('/api/auth/logout', { method: 'POST', body: {} }); load(); }}>Sign out</button>
      </Message>
    );
  }
  if (status.business.status !== 'active' && !status.user.isHost) {
    return <Message title="This business is paused">Sign-in and admin are paused for {status.business.name}. Contact your provider.</Message>;
  }

  return (
    <Shell user={status.user} business={status.business} branding={branding} onLogout={load}>
      {status.business.status !== 'active' && <div className="a-msg warn">This business is paused: its tablets and admins can’t sign in. Resume it in the Host console.</div>}
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

function Message({ title, children }) {
  return <div className="a-center"><div className="a-auth"><img src="/logo.svg" alt="Visitor Sign-In" /><h1>{title}</h1><p>{children}</p></div></div>;
}

function Shell({ user, business, branding, onLogout, children }) {
  const navigate = useNavigate();
  const logout = async () => {
    await api('/api/auth/logout', { method: 'POST', body: {} });
    await onLogout();
    navigate('/admin');
  };
  return (
    <div className="a-shell">
      <nav className="a-nav" aria-label="Admin">
        <div className="brand"><img src={logoFor(branding, colorsOf(branding).navBg)} alt={branding?.companyName || business.name} /></div>
        <NavLink end to="/admin"><IconHome /> Dashboard</NavLink>
        <NavLink to="/admin/visits"><IconList /> Visitor log</NavLink>
        <NavLink to="/admin/staff"><IconStaff /> Staff &amp; teams</NavLink>
        <NavLink to="/admin/tablets"><IconTablet /> Tablets</NavLink>
        <NavLink to="/admin/rollcalls"><IconWarn /> Roll calls</NavLink>
        <NavLink to="/admin/settings"><IconCog /> Settings</NavLink>
        <div className="spacer" />
        <a href={appPath('/rollcall')} target="_blank" rel="noreferrer" style={{ background: '#B91C1C', color: '#fff', fontWeight: 700 }}>Emergency roll call ↗</a>
        <a href={appPath('/kiosk')} target="_blank" rel="noreferrer">Open kiosk screen ↗</a>
        {user.isHost && <a href="/host">Host console ↗</a>}
        <div className="who">{business.name}<br />Signed in as {user.name}</div>
        <button type="button" className="link" onClick={logout}>Sign out</button>
      </nav>
      <main className="a-main">{children}</main>
    </div>
  );
}

export function Login({ onDone, branding }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const r = await api('/api/auth/login', { method: 'POST', body: { email, password } });
      const st = await api('/api/auth/status');
      if (!st.canManage) {
        // Signed in at another business's address: go to your own.
        if (r.businessSlug && r.businessSlug !== slug) { window.location.href = `/b/${r.businessSlug}/admin`; return; }
        if (r.isHost) { window.location.href = '/host'; return; }
      }
      await onDone();
    } catch (err) {
      setError(err.message);
    }
  };
  return (
    <div className="a-center">
      <form className="a-auth" onSubmit={submit}>
        <img src={logoFor(branding, '#FFFFFF')} alt={branding?.companyName || 'Visitor Sign-In'} />
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
      window.history.replaceState(null, '', appPath('/admin'));
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
        <p className="sub" style={{ color: 'var(--muted)', fontSize: 14 }}>Create the Host Admin account (you run this platform) and name your company, the first business. You can add more businesses later in the Host console.</p>
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
