import { useCallback, useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { api, fmtDate, fmtDateTime } from '../api.js';
import { IconCog, IconHome, IconStaff } from '../icons.jsx';
import { Login, Modal, Toggle, useFlash } from '../admin/AdminApp.jsx';

/** /host — the Host Admin console: every business on this platform. */
export default function HostApp() {
  const [status, setStatus] = useState(null);
  const load = useCallback(() => api('/api/auth/status').then(setStatus).catch(() => setStatus({ error: true })), []);
  useEffect(() => { document.title = 'Host console · Visitor Sign-In'; load(); }, [load]);

  if (!status) return null;
  if (status.error) return <Center title="Can’t reach the server">Check that the app is running, then reload.</Center>;
  if (status.needsSetup) return <Center title="Not set up yet">Open the first-time setup link from the app container’s log to create the Host Admin account.</Center>;
  if (!status.user) return <Login onDone={load} branding={null} />;
  if (!status.user.isHost) {
    return <Center title="Host Admins only">This console is for the people who run the platform. {status.user.businessSlug && <a href={`/b/${status.user.businessSlug}/admin`}>Go to your business admin</a>}</Center>;
  }
  const logout = async () => { await api('/api/auth/logout', { method: 'POST', body: {} }); load(); };

  return (
    <div className="a-shell">
      <nav className="a-nav" aria-label="Host console" style={{ '--nav-bg': '#0B1220', '--nav-ink': '#E5E7EB' }}>
        <div className="brand"><img src="/logo-white.svg" alt="Visitor Sign-In" /></div>
        <div className="who" style={{ marginTop: -14, marginBottom: 8 }}>Host console</div>
        <NavLink end to="/host"><IconHome /> Businesses</NavLink>
        <NavLink to="/host/defaults"><IconCog /> Defaults for new businesses</NavLink>
        <NavLink to="/host/admins"><IconStaff /> Host Admins</NavLink>
        <div className="spacer" />
        {status.user.businessSlug && <a href={`/b/${status.user.businessSlug}/admin`}>My business admin ↗</a>}
        <div className="who">Signed in as {status.user.name}</div>
        <button type="button" className="link" onClick={logout}>Sign out</button>
      </nav>
      <main className="a-main">
        <Routes>
          <Route index element={<Businesses />} />
          <Route path="defaults" element={<Defaults />} />
          <Route path="admins" element={<HostAdmins me={status.user} />} />
          <Route path="*" element={<Navigate to="/host" replace />} />
        </Routes>
      </main>
    </div>
  );
}

function Center({ title, children }) {
  return <div className="a-center"><div className="a-auth"><img src="/logo.svg" alt="Visitor Sign-In" /><h1>{title}</h1><p>{children}</p></div></div>;
}

function CopyField({ label, value }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setDone(true); setTimeout(() => setDone(false), 2000); } catch { /* select instead */ }
  };
  return (
    <label className="a-field">{label}
      <span className="a-row" style={{ flexWrap: 'nowrap' }}>
        <input className="a-input" readOnly value={value} onFocus={(e) => e.target.select()} />
        <button type="button" className="a-btn" onClick={copy}>{done ? 'Copied' : 'Copy'}</button>
      </span>
    </label>
  );
}

/* --------------------------------------------------------------- Businesses */
function Businesses() {
  const [rows, setRows] = useState(null);
  const [creating, setCreating] = useState(null);
  const [created, setCreated] = useState(null);
  const [open, setOpen] = useState(null);
  const [flash, setFlash] = useFlash();
  const load = useCallback(() => api('/api/host/businesses').then(setRows).catch((e) => setFlash(e.message, 'bad')), [setFlash]);
  useEffect(() => { load(); }, [load]);

  // Suggest the web address from the name as it is typed.
  useEffect(() => {
    if (!creating || creating.slugTouched) return undefined;
    const t = setTimeout(() => {
      if (!creating.name.trim()) return;
      api(`/api/host/slug?name=${encodeURIComponent(creating.name)}`).then((r) => setCreating((c) => (c && !c.slugTouched ? { ...c, slug: r.slug } : c))).catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [creating?.name, creating?.slugTouched]); // eslint-disable-line react-hooks/exhaustive-deps

  const create = async (e) => {
    e.preventDefault();
    try {
      const r = await api('/api/host/businesses', { method: 'POST', body: { name: creating.name, slug: creating.slug } });
      setCreating(null);
      setCreated(r);
      load();
    } catch (err) {
      setCreating({ ...creating, error: err.message });
    }
  };

  return (
    <>
      <div className="a-head">
        <div><h1>Businesses</h1><p>Each business has its own admin, tablets, staff, branding, Health &amp; Safety rules and records.</p></div>
        <div className="a-actions"><button type="button" className="a-btn primary" onClick={() => setCreating({ name: '', slug: '' })}>+ New business</button></div>
      </div>
      {flash}
      <section className="a-card">
        <div className="a-table-wrap">
          <table className="a-table">
            <thead><tr><th>Business</th><th>Status</th><th>Admins</th><th>Staff</th><th>Tablets</th><th>Visits (30 days)</th><th>Last visit</th><th className="r"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {(rows || []).map((b) => (
                <tr key={b.id}>
                  <td><strong>{b.name}</strong><div className="muted">/b/{b.slug}</div></td>
                  <td>
                    {b.status === 'active' ? <span className="badge ok">Active</span> : <span className="badge warn">Paused</span>}
                    {b.setup_pending && <div style={{ marginTop: 4 }}><span className="badge blue">Setup link sent</span></div>}
                  </td>
                  <td>{b.admins}</td>
                  <td>{b.staff}</td>
                  <td>{b.tablets}</td>
                  <td>{b.visits_30d}</td>
                  <td>{b.last_visit ? fmtDate(b.last_visit) : <span className="muted">—</span>}</td>
                  <td className="r"><div className="a-row" style={{ justifyContent: 'flex-end' }}>
                    <a className="a-btn sm" href={`/b/${b.slug}/admin`} target="_blank" rel="noreferrer">Open admin ↗</a>
                    <button type="button" className="a-btn sm" onClick={() => setOpen(b)}>Manage</button>
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows && !rows.length && <div className="a-empty">No businesses yet.</div>}
        </div>
      </section>

      {creating && (
        <Modal title="New business" onClose={() => setCreating(null)}>
          <form onSubmit={create} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <label className="a-field">Company name<input className="a-input" autoFocus value={creating.name} onChange={(e) => setCreating({ ...creating, name: e.target.value })} required /></label>
            <label className="a-field">Web address <span className="hint">Made from the name. Letters, numbers and dashes.</span>
              <span className="a-row" style={{ flexWrap: 'nowrap', gap: 6 }}>
                <span className="muted" style={{ whiteSpace: 'nowrap', color: 'var(--muted)' }}>{window.location.origin}/b/</span>
                <input className="a-input" value={creating.slug} onChange={(e) => setCreating({ ...creating, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''), slugTouched: true })} />
              </span>
            </label>
            <p className="sub">The business starts with your default Health &amp; Safety text and safety questions, which they can change.</p>
            {creating.error && <div className="a-msg bad">{creating.error}</div>}
            <div className="a-row" style={{ justifyContent: 'flex-end' }}><button type="button" className="a-btn" onClick={() => setCreating(null)}>Cancel</button><button type="submit" className="a-btn primary">Create business</button></div>
          </form>
        </Modal>
      )}

      {created && (
        <Modal title={`${created.business.name} is ready`} onClose={() => setCreated(null)}>
          <p className="sub">Send this setup link to the company. They open it, create their admin account, and set up their branding, staff and iPads. It works once and expires in 14 days.</p>
          <CopyField label="Setup link" value={created.setupUrl} />
          <CopyField label="Their admin address (after setup)" value={created.adminUrl} />
          <div className="a-row" style={{ justifyContent: 'flex-end' }}><button type="button" className="a-btn primary" onClick={() => setCreated(null)}>Done</button></div>
        </Modal>
      )}

      {open && <ManageBusiness b={open} onClose={() => { setOpen(null); load(); }} setFlash={setFlash} />}
    </>
  );
}

function ManageBusiness({ b, onClose, setFlash }) {
  const [f, setF] = useState({ name: b.name, slug: b.slug });
  const [link, setLink] = useState(null);
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const save = async (patch, message) => {
    setError('');
    try {
      await api(`/api/host/businesses/${b.id}`, { method: 'PUT', body: patch });
      setFlash(message);
      onClose();
    } catch (e) {
      setError(e.message);
    }
  };
  const newLink = async () => {
    if (b.admins && !window.confirm(`${b.name} already has ${b.admins} admin${b.admins > 1 ? 's' : ''}. Make a setup link anyway (it adds another admin)?`)) return;
    try {
      const r = await api(`/api/host/businesses/${b.id}/setup-link`, { method: 'POST', body: {} });
      setLink(r.setupUrl);
    } catch (e) {
      setError(e.message);
    }
  };
  const remove = async () => {
    try {
      await api(`/api/host/businesses/${b.id}`, { method: 'DELETE', body: { confirm } });
      setFlash(`${b.name} deleted.`);
      onClose();
    } catch (e) {
      setError(e.message);
    }
  };
  return (
    <Modal title={b.name} onClose={onClose}>
      <div className="a-grid2" style={{ fontSize: 14, gap: 8 }}>
        <div><div className="muted" style={{ color: 'var(--muted)' }}>Created</div>{fmtDateTime(b.created_at)}</div>
        <div><div className="muted" style={{ color: 'var(--muted)' }}>Activity</div>{b.visits_30d} visits in 30 days · {b.tablets} tablets</div>
      </div>
      <CopyField label="Admin address" value={b.adminUrl} />
      <CopyField label="Kiosk address (for their iPads)" value={b.kioskUrl} />
      <div className="a-card" style={{ padding: 14, gap: 10 }}>
        <strong>Setup link</strong>
        <p className="sub">{b.setup_pending ? `A setup link is waiting to be used (expires ${fmtDate(b.setup_expires)}). Making a new one replaces it.` : 'Make a link for someone at the company to create an admin account.'}</p>
        {link ? <CopyField label="New setup link (works once, 14 days)" value={link} /> : <button type="button" className="a-btn" style={{ alignSelf: 'flex-start' }} onClick={newLink}>Make setup link</button>}
      </div>
      <div className="a-grid2">
        <label className="a-field">Name<input className="a-input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label className="a-field">Web address <span className="hint">Changing it breaks links already sent</span>
          <input className="a-input" value={f.slug} onChange={(e) => setF({ ...f, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })} /></label>
      </div>
      <div className="a-row"><button type="button" className="a-btn primary" onClick={() => save(f, 'Saved.')}>Save</button></div>
      <div className="a-toggle-row">
        <span>{b.status === 'active' ? 'Active: tablets and admins can sign in' : 'Paused: tablets and admins are blocked (data is kept)'}</span>
        <Toggle on={b.status === 'active'} label="Business active" onChange={(on) => save({ status: on ? 'active' : 'suspended' }, on ? `${b.name} resumed.` : `${b.name} paused.`)} />
      </div>
      <div className="a-card" style={{ padding: 14, gap: 10, borderColor: '#FCA5A5' }}>
        <strong style={{ color: 'var(--bad-ink)' }}>Delete business</strong>
        <p className="sub">Deletes all its staff, tablets, visits, signatures, roll calls and settings. This can’t be undone. Type <strong>{b.slug}</strong> to confirm.</p>
        <div className="a-row"><input className="a-input" style={{ maxWidth: 240 }} aria-label="Type the web address to confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          <button type="button" className="a-btn danger" disabled={confirm !== b.slug} onClick={remove}>Delete forever</button></div>
      </div>
      {error && <div className="a-msg bad">{error}</div>}
      <div className="a-row" style={{ justifyContent: 'flex-end' }}><button type="button" className="a-btn" onClick={onClose}>Close</button></div>
    </Modal>
  );
}

/* ----------------------------------------------------------------- Defaults */
function Defaults() {
  const [s, setS] = useState(null);
  const [flash, setFlash] = useFlash();
  useEffect(() => { api('/api/host/settings').then(setS).catch((e) => setFlash(e.message, 'bad')); }, [setFlash]);
  const save = async () => {
    try {
      setS(await api('/api/host/settings', { method: 'PUT', body: s }));
      setFlash('Defaults saved. New businesses will start with these.');
    } catch (e) {
      setFlash(e.message, 'bad');
    }
  };
  if (!s) return <p>Loading…</p>;
  const qs = s.defaultQuestions;
  const setQ = (i, patch) => setS({ ...s, defaultQuestions: qs.map((q, j) => (j === i ? { ...q, ...patch } : q)) });
  return (
    <>
      <div className="a-head"><div><h1>Defaults for new businesses</h1><p>Each new business starts with a copy of these. They can change their own copy; existing businesses aren’t affected.</p></div></div>
      {flash}
      <section className="a-card">
        <h2>Site Health &amp; Safety rules (template)</h2>
        <textarea className="a-textarea" rows={14} value={s.defaultSafetyText} onChange={(e) => setS({ ...s, defaultSafetyText: e.target.value })} />
      </section>
      <section className="a-card">
        <h2>Safety questions (template)</h2>
        {qs.map((q, i) => (
          <div key={i} className="a-row" style={{ flexWrap: 'nowrap' }}>
            <input className="a-input" aria-label={`Question ${i + 1}`} value={q.text} onChange={(e) => setQ(i, { text: e.target.value })} />
            <select className="a-select" style={{ width: 170 }} aria-label="Flag when the answer is" value={q.flag_answer} onChange={(e) => setQ(i, { flag_answer: e.target.value })}>
              <option value="yes">Flag if Yes</option><option value="no">Flag if No</option>
            </select>
            <button type="button" className="a-btn sm danger" aria-label="Remove question" onClick={() => setS({ ...s, defaultQuestions: qs.filter((_, j) => j !== i) })}>×</button>
          </div>
        ))}
        <div><button type="button" className="a-btn" onClick={() => setS({ ...s, defaultQuestions: [...qs, { text: '', flag_answer: 'yes' }] })}>+ Add question</button></div>
      </section>
      <div><button type="button" className="a-btn primary" onClick={save}>Save defaults</button></div>
    </>
  );
}

/* -------------------------------------------------------------- Host Admins */
function HostAdmins({ me }) {
  const [rows, setRows] = useState([]);
  const [f, setF] = useState({ name: '', email: '', password: '' });
  const [flash, setFlash] = useFlash();
  const load = useCallback(() => api('/api/host/admins').then(setRows).catch((e) => setFlash(e.message, 'bad')), [setFlash]);
  useEffect(() => { load(); }, [load]);
  const add = async (e) => {
    e.preventDefault();
    try {
      await api('/api/host/admins', { method: 'POST', body: f });
      setFlash(`${f.name} is now a Host Admin.`);
      setF({ name: '', email: '', password: '' });
      load();
    } catch (err) {
      setFlash(err.message, 'bad');
    }
  };
  const remove = async (u) => {
    if (!window.confirm(`Remove Host Admin access for ${u.name}?`)) return;
    try { await api(`/api/host/admins/${u.id}`, { method: 'DELETE' }); load(); } catch (err) { setFlash(err.message, 'bad'); }
  };
  return (
    <>
      <div className="a-head"><div><h1>Host Admins</h1><p>People who can create and manage every business on this platform.</p></div></div>
      {flash}
      <section className="a-card">
        <div className="a-table-wrap">
          <table className="a-table">
            <thead><tr><th>Name</th><th>Email</th><th>Also admin of</th><th>Last sign-in</th><th className="r"><span className="sr-only">Remove</span></th></tr></thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id}>
                  <td><strong>{u.name}</strong>{u.id === me.id && <span className="muted"> (you)</span>}</td>
                  <td>{u.email}</td>
                  <td>{u.business || <span className="muted">—</span>}</td>
                  <td>{u.last_login_at ? fmtDateTime(u.last_login_at) : <span className="muted">Never</span>}</td>
                  <td className="r">{u.id !== me.id && <button type="button" className="a-btn sm danger" onClick={() => remove(u)}>Remove</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <form onSubmit={add} className="a-row" style={{ alignItems: 'flex-end' }}>
          <label className="a-field">Name<input className="a-input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></label>
          <label className="a-field">Email<input className="a-input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required /></label>
          <label className="a-field">Temporary password<input className="a-input" type="password" autoComplete="new-password" minLength={10} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required /></label>
          <button type="submit" className="a-btn primary">Add Host Admin</button>
        </form>
      </section>
    </>
  );
}
