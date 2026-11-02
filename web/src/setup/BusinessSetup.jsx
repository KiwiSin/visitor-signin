import { useEffect, useState } from 'react';
import { api } from '../api.js';

/** /b/<slug>/setup?token=… — a company creates its first admin from the link its provider sent. */
export default function BusinessSetup() {
  const token = new URLSearchParams(window.location.search).get('token') || '';
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');
  const [f, setF] = useState({ name: '', email: '', password: '' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    document.title = 'Set up your sign-in';
    if (!token) { setError('This page needs the setup link you were sent.'); return; }
    api(`/api/business-setup?token=${encodeURIComponent(token)}`).then(setInfo).catch((e) => setError(e.message));
  }, [token]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await api('/api/business-setup', { method: 'POST', body: { ...f, token } });
      window.location.href = `/b/${r.slug}/admin/settings/branding`;
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  return (
    <div className="a-center">
      <form className="a-auth" onSubmit={submit}>
        <img src="/logo.svg" alt="Visitor Sign-In" />
        {!info && !error && <p>Checking your link…</p>}
        {info && (
          <>
            <h1>Welcome, {info.name}</h1>
            <p className="sub" style={{ color: 'var(--muted)', fontSize: 14, lineHeight: 1.5 }}>
              Create your admin account. Next you’ll add your logo and colours, your Health &amp; Safety rules (we’ve started you with a template), your staff and your reception iPads.
            </p>
            <label className="a-field">Your name<input className="a-input" autoComplete="name" value={f.name} onChange={set('name')} required /></label>
            <label className="a-field">Your email <span className="hint">You’ll sign in with this</span>
              <input className="a-input" type="email" autoComplete="username" value={f.email} onChange={set('email')} required /></label>
            <label className="a-field">Password <span className="hint">At least 10 characters</span>
              <input className="a-input" type="password" autoComplete="new-password" minLength={10} value={f.password} onChange={set('password')} required /></label>
          </>
        )}
        {error && <div className="a-msg bad" role="alert">{error}</div>}
        {info && <button className="a-btn primary" type="submit" disabled={busy} style={{ justifyContent: 'center', height: 46 }}>Create account and start</button>}
      </form>
    </div>
  );
}
