import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api, fmtDateTime } from '../api.js';
import { Toggle, useFlash } from './AdminApp.jsx';

const TABS = [
  ['branding', 'Branding'],
  ['email', 'Email & alerts'],
  ['safety', 'Health & Safety'],
  ['types', 'Visit types'],
  ['users', 'Admin users'],
];
const SWATCHES = ['#0F766E', '#1D4ED8', '#B45309', '#B91C1C', '#7C3AED', '#111827'];

export default function Settings({ onBrandingChange, user }) {
  const location = useLocation();
  const navigate = useNavigate();
  const tab = location.pathname.split('/')[3] || 'branding';
  const [settings, setSettings] = useState(null);
  const [flash, setFlash] = useFlash();

  const load = useCallback(() => api('/api/admin/settings').then(setSettings).catch((e) => setFlash(e.message, 'bad')), [setFlash]);
  useEffect(() => { load(); }, [load]);

  const save = async (section, body, message = 'Saved.') => {
    try {
      const s = await api(`/api/admin/settings/${section}`, { method: 'PUT', body });
      setSettings(s);
      setFlash(message);
      if (section === 'branding') onBrandingChange();
      return true;
    } catch (e) {
      setFlash(e.message, 'bad');
      return false;
    }
  };

  return (
    <>
      <div className="a-head"><div><h1>Settings</h1></div></div>
      <div className="a-tabs" role="tablist">
        {TABS.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => navigate(`/admin/settings/${k}`)}>{label}</button>
        ))}
      </div>
      {flash}
      {!settings ? <p>Loading…</p> : (
        <>
          {tab === 'branding' && <Branding settings={settings} save={save} setFlash={setFlash} />}
          {tab === 'email' && <Email settings={settings} save={save} setFlash={setFlash} />}
          {tab === 'safety' && <Safety settings={settings} save={save} setFlash={setFlash} />}
          {tab === 'types' && <Types setFlash={setFlash} />}
          {tab === 'users' && <Users setFlash={setFlash} me={user} />}
        </>
      )}
    </>
  );
}

async function upload(file) {
  const fd = new FormData();
  fd.append('file', file);
  return api('/api/admin/uploads', { method: 'POST', body: fd });
}

/* ---------------------------------------------------------------- Branding */
function Branding({ settings, save, setFlash }) {
  const [b, setB] = useState(settings.branding);
  const set = (patch) => setB((x) => ({ ...x, ...patch }));
  const pick = async (e, kind) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const { url } = await upload(file);
      if (kind === 'logo') set({ logo: url });
      else set({ wallpapers: [...b.wallpapers, url], wallpaper: b.wallpapers.length });
    } catch (err) {
      setFlash(err.message, 'bad');
    }
  };
  const removeWp = (i) => {
    const list = b.wallpapers.filter((_, j) => j !== i);
    set({ wallpapers: list, wallpaper: Math.min(b.wallpaper, Math.max(0, list.length - 1)) });
  };
  const wp = b.wallpapers[b.wallpaper] || b.wallpapers[0];
  return (
    <section className="a-card">
      <div className="a-split">
        <div className="main" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="a-grid2">
            <label className="a-field">Company name<input className="a-input" value={b.companyName} onChange={(e) => set({ companyName: e.target.value })} /></label>
            <label className="a-field">App name <span className="hint">Shown in admin and emails</span><input className="a-input" value={b.appName} onChange={(e) => set({ appName: e.target.value })} /></label>
            <label className="a-field">Greeting <span className="hint">Shown before your company name</span><input className="a-input" value={b.welcome} onChange={(e) => set({ welcome: e.target.value })} /></label>
            <label className="a-field">Reception name<input className="a-input" value={b.locationName} onChange={(e) => set({ locationName: e.target.value })} /></label>
          </div>
          <label className="a-field">Line under the greeting<input className="a-input" value={b.subtitle} onChange={(e) => set({ subtitle: e.target.value })} /></label>
          <label className="a-field">Emergency assembly point <span className="hint">Shown at the bottom of the home screen. Leave empty to hide.</span><input className="a-input" value={b.assemblyPoint} onChange={(e) => set({ assemblyPoint: e.target.value })} /></label>
          <div className="a-field">Brand colour
            <div className="swatches">
              {SWATCHES.map((c) => <button key={c} type="button" aria-label={`Use ${c}`} className={`swatch ${b.accent.toLowerCase() === c.toLowerCase() ? 'on' : ''}`} style={{ background: c }} onClick={() => set({ accent: c })} />)}
              <input type="color" aria-label="Custom colour" value={b.accent} onChange={(e) => set({ accent: e.target.value })} style={{ width: 44, height: 40, border: 'none', background: 'none' }} />
              <code>{b.accent}</code>
            </div>
          </div>
          <div className="a-field">Company logo <span className="hint">PNG with a transparent background works best, about 600 × 160 px</span>
            <div className="a-row">
              <div style={{ padding: 10, border: '1px dashed var(--line-2)', borderRadius: 10, background: '#fff' }}><img src={b.logo || '/logo.svg'} alt="Current logo" style={{ height: 44, maxWidth: 240, objectFit: 'contain', display: 'block' }} /></div>
              <label className="a-btn">Upload logo<input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => pick(e, 'logo')} /></label>
              {b.logo && <button type="button" className="a-btn" onClick={() => set({ logo: '' })}>Use the default</button>}
            </div>
          </div>
          <div className="a-field">Kiosk wallpapers <span className="hint">Full screen behind every tablet screen. Landscape photos, at least 2048 px wide.</span>
            <div className="wp-grid">
              {b.wallpapers.map((w, i) => (
                <div key={w} className={`wp ${i === b.wallpaper ? 'on' : ''}`}>
                  <button type="button" style={{ border: 'none', background: 'none', padding: 0 }} onClick={() => set({ wallpaper: i })} aria-label={`Use wallpaper ${i + 1}`}><img src={w} alt="" /></button>
                  {b.wallpapers.length > 1 && <button type="button" className="x" aria-label="Remove wallpaper" onClick={() => removeWp(i)}>×</button>}
                </div>
              ))}
              <label className="wp" style={{ alignItems: 'center', justifyContent: 'center', borderStyle: 'dashed', minHeight: 100, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                + Upload JPG / PNG<input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => pick(e, 'wallpaper')} />
              </label>
            </div>
          </div>
          <div className="a-toggle-row"><span>Change wallpaper every 60 seconds</span><Toggle on={b.rotateWallpapers} label="Rotate wallpapers" onChange={(v) => set({ rotateWallpapers: v })} /></div>
          <label className="a-toggle-row">Darken wallpaper so text stays readable
            <input type="range" min="0" max="0.8" step="0.05" value={b.scrim} onChange={(e) => set({ scrim: Number(e.target.value) })} style={{ width: 180, accentColor: b.accent }} /></label>
          <div><button type="button" className="a-btn primary" onClick={() => save('branding', b, 'Branding saved. Tablets pick it up within 5 minutes.')}>Save branding</button></div>
        </div>
        <div className="side" style={{ maxWidth: 460, flexBasis: 360 }}>
          <div className="a-field">Preview</div>
          <div className="preview" style={{ '--accent': b.accent }}>
            <img className="bg" src={wp} alt="" />
            <div style={{ position: 'absolute', inset: 0, background: `rgba(17,24,39,${b.scrim})` }} />
            <div className="in">
              <img src={b.logo || '/logo-white.svg'} alt="" style={{ height: 26, maxWidth: 160, objectFit: 'contain' }} />
              <strong style={{ fontSize: 34 }}>{new Date().toLocaleTimeString('en-NZ', { hour: 'numeric', minute: '2-digit' })}</strong>
              <span style={{ fontSize: 12 }}>{b.welcome} to {b.companyName}</span>
              <div className="a-row" style={{ marginTop: 6, justifyContent: 'center' }}>
                <span style={{ width: 110, height: 50, borderRadius: 10, background: b.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>Sign In</span>
                <span style={{ width: 110, height: 50, borderRadius: 10, background: '#fff', color: '#111827', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>Sign Out</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------- Email */
function Email({ settings, save, setFlash }) {
  const [e, setE] = useState({ ...settings.email, password: '' });
  const [n, setN] = useState(settings.notify);
  const [testTo, setTestTo] = useState(settings.notify.receptionMailbox || '');
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState([]);
  const set = (patch) => setE((x) => ({ ...x, ...patch }));
  const loadLog = useCallback(() => api('/api/admin/notifications').then(setLog).catch(() => {}), []);
  useEffect(() => { loadLog(); }, [loadLog]);

  const method = (m) => set({
    method: m,
    port: m === 'relay' ? 25 : m === 'smtp' ? 587 : e.port,
    security: m === 'relay' ? 'none' : m === 'smtp' ? 'starttls' : e.security,
  });
  const saveEmail = async () => {
    if (await save('email', e, 'Email settings saved.')) set({ password: '' });
  };
  const test = async () => {
    setBusy(true);
    try {
      await api('/api/admin/email/test', { method: 'POST', body: { to: testTo } });
      setFlash(`Test email sent to ${testTo}. Check the inbox (and junk folder).`);
    } catch (err) {
      setFlash(err.message, 'bad');
    } finally {
      setBusy(false);
    }
  };
  const retry = async (id) => {
    await api(`/api/admin/notifications/${id}/retry`, { method: 'POST', body: {} });
    setFlash('Queued to send again.');
    setTimeout(loadLog, 6000);
  };

  return (
    <>
      <section className="a-card">
        <h2>How email is sent</h2>
        <div className="a-tabs">
          {[['relay', 'SMTP relay (no login)'], ['smtp', 'SMTP with login'], ['none', 'Off']].map(([k, label]) => (
            <button key={k} type="button" className={e.method === k ? 'on' : ''} onClick={() => method(k)}>{label}</button>
          ))}
        </div>
        {e.method === 'relay' && <p className="sub">Any mail server that accepts mail from this server without a login, such as your Exchange server or an existing port 25 relay. Ask IT to allow this server’s IP address to relay. Internal email keeps working when the internet is down.</p>}
        {e.method === 'smtp' && <p className="sub">A provider that needs a username and password or API key: your web host, SendGrid, Mailgun, Amazon SES, Brevo and so on.</p>}
        {e.method === 'none' && <p className="sub">No emails are sent. Visitors can still sign in.</p>}
        {e.method !== 'none' && (
          <>
            <div className="a-grid2">
              <label className="a-field">Mail server <span className="hint">Name or IP address</span><input className="a-input" placeholder="mail.company.local" value={e.host} onChange={(x) => set({ host: x.target.value })} /></label>
              <div className="a-row" style={{ alignItems: 'flex-end' }}>
                <label className="a-field" style={{ width: 100 }}>Port<input className="a-input" inputMode="numeric" value={e.port} onChange={(x) => set({ port: x.target.value.replace(/\D/g, '') })} /></label>
                <label className="a-field" style={{ flex: 1 }}>Security
                  <select className="a-select" value={e.security} onChange={(x) => set({ security: x.target.value })}>
                    <option value="none">None (port 25 relay)</option>
                    <option value="starttls">STARTTLS (usually port 587)</option>
                    <option value="tls">TLS (usually port 465)</option>
                  </select>
                </label>
              </div>
            </div>
            {e.method === 'smtp' && (
              <div className="a-grid2">
                <label className="a-field">Username<input className="a-input" autoComplete="off" value={e.user} onChange={(x) => set({ user: x.target.value })} /></label>
                <label className="a-field">Password / API key <span className="hint">{e.hasPassword ? 'Saved. Leave empty to keep it.' : 'Stored encrypted'}</span>
                  <input className="a-input" type="password" autoComplete="new-password" value={e.password} onChange={(x) => set({ password: x.target.value })} /></label>
              </div>
            )}
            <div className="a-grid2">
              <label className="a-field">Send from <span className="hint">e.g. reception@company.co.nz</span><input className="a-input" type="email" value={e.from} onChange={(x) => set({ from: x.target.value })} /></label>
              <label className="a-field">Sender name<input className="a-input" value={e.fromName} onChange={(x) => set({ fromName: x.target.value })} /></label>
              <label className="a-field">Replies go to <span className="hint">Optional</span><input className="a-input" type="email" value={e.replyTo} onChange={(x) => set({ replyTo: x.target.value })} /></label>
            </div>
            <div className="a-toggle-row"><span>Accept the mail server’s self-signed certificate (common for internal Exchange)</span><Toggle on={e.allowSelfSigned} label="Allow self-signed certificate" onChange={(v) => set({ allowSelfSigned: v })} /></div>
          </>
        )}
        <div className="a-row"><button type="button" className="a-btn primary" onClick={saveEmail}>Save email settings</button></div>
        {settings.email.method !== 'none' && (
          <div className="a-row" style={{ alignItems: 'flex-end', borderTop: '1px solid var(--line)', paddingTop: 16 }}>
            <label className="a-field" style={{ flex: 1, minWidth: 240 }}>Send a test email to<input className="a-input" type="email" value={testTo} onChange={(x) => setTestTo(x.target.value)} /></label>
            <button type="button" className="a-btn" disabled={busy} onClick={test}>{busy ? 'Sending…' : 'Send test'}</button>
          </div>
        )}
      </section>

      <section className="a-card">
        <h2>Who gets told</h2>
        <div className="a-toggle-row"><span>Email the host when their visitor signs in</span><Toggle on={n.hostOnSignIn} label="Email host" onChange={(v) => setN({ ...n, hostOnSignIn: v })} /></div>
        <div className="a-grid2">
          <label className="a-field">Reception shared mailbox <span className="hint">Gets visitors with no host, or no host email</span>
            <input className="a-input" type="email" placeholder="reception@company.co.nz" value={n.receptionMailbox} onChange={(x) => setN({ ...n, receptionMailbox: x.target.value })} /></label>
          <label className="a-field">Health &amp; Safety contact <span className="hint">Alerted when a safety answer is flagged</span>
            <input className="a-input" type="email" value={n.flaggedTo} onChange={(x) => setN({ ...n, flaggedTo: x.target.value })} /></label>
        </div>
        <div className="a-toggle-row"><span>Also copy every arrival to the reception mailbox</span><Toggle on={n.copyReception} label="Copy reception" onChange={(v) => setN({ ...n, copyReception: v })} /></div>
        <div><button type="button" className="a-btn primary" onClick={() => save('notify', n, 'Alert settings saved.')}>Save</button></div>
      </section>

      <section className="a-card">
        <div className="a-row" style={{ justifyContent: 'space-between' }}><h2>Recent emails</h2><button type="button" className="a-btn sm" onClick={loadLog}>Refresh</button></div>
        <div className="a-table-wrap">
          <table className="a-table">
            <thead><tr><th>When</th><th>To</th><th>Subject</th><th>Status</th></tr></thead>
            <tbody>
              {log.map((m) => (
                <tr key={m.id}>
                  <td>{fmtDateTime(m.created_at)}</td>
                  <td>{m.recipient}<div className="muted">{m.kind}</div></td>
                  <td>{m.subject}</td>
                  <td>
                    {m.status === 'sent' && <span className="badge ok">Sent</span>}
                    {m.status === 'pending' && <span className="badge warn" title={m.last_error || ''}>{m.attempts ? `Retrying (${m.attempts})` : 'Sending'}</span>}
                    {m.status === 'failed' && <span className="a-row"><span className="badge bad" title={m.last_error || ''}>Failed</span><button type="button" className="a-btn sm" onClick={() => retry(m.id)}>Retry</button></span>}
                    {m.last_error && m.status !== 'sent' && <div className="muted" style={{ maxWidth: 280 }}>{m.last_error}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!log.length && <div className="a-empty">No emails yet.</div>}
        </div>
      </section>
    </>
  );
}

/* ------------------------------------------------------------------- Safety */
function Safety({ settings, save, setFlash }) {
  const [text, setText] = useState(settings.safety.text);
  const [privacy, setPrivacy] = useState(settings.privacy);
  const [qs, setQs] = useState(null);
  useEffect(() => { api('/api/admin/questions').then(setQs).catch((e) => setFlash(e.message, 'bad')); }, [setFlash]);
  const saveQs = async () => {
    try {
      setQs(await api('/api/admin/questions', { method: 'PUT', body: { questions: qs } }));
      setFlash('Questions saved.');
    } catch (e) {
      setFlash(e.message, 'bad');
    }
  };
  const move = (i, d) => {
    const list = [...qs];
    const [x] = list.splice(i, 1);
    list.splice(i + d, 0, x);
    setQs(list);
  };
  return (
    <>
      <section className="a-card">
        <h2>Site Health &amp; Safety rules</h2>
        <p className="sub">Visitors read this and agree to it before signing in. Each change gets a new version number, and every visit records which version was agreed. Current version: {settings.safety.version}.</p>
        <textarea className="a-textarea" rows={12} value={text} onChange={(e) => setText(e.target.value)} />
        <div><button type="button" className="a-btn primary" onClick={() => save('safety', { text }, 'Health & Safety text saved.')}>Save rules</button></div>
      </section>
      <section className="a-card">
        <h2>Safety questions</h2>
        <p className="sub">Yes / no questions asked before signing in. Choose which answer raises a flag: flagged visits are highlighted on the dashboard and emailed to the Health &amp; Safety contact.</p>
        {qs && qs.map((q, i) => (
          <div key={q.id || `new-${i}`} className="a-row" style={{ flexWrap: 'nowrap' }}>
            <input className="a-input" aria-label={`Question ${i + 1}`} value={q.text} onChange={(e) => setQs(qs.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} />
            <select className="a-select" aria-label="Flag when the answer is" style={{ width: 170 }} value={q.flag_answer} onChange={(e) => setQs(qs.map((x, j) => (j === i ? { ...x, flag_answer: e.target.value } : x)))}>
              <option value="yes">Flag if Yes</option>
              <option value="no">Flag if No</option>
            </select>
            <button type="button" className="a-btn sm" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
            <button type="button" className="a-btn sm" aria-label="Move down" disabled={i === qs.length - 1} onClick={() => move(i, 1)}>↓</button>
            <button type="button" className="a-btn sm danger" aria-label="Remove question" onClick={() => setQs(qs.filter((_, j) => j !== i))}>×</button>
          </div>
        ))}
        <div className="a-row">
          <button type="button" className="a-btn" onClick={() => setQs([...(qs || []), { text: '', flag_answer: 'yes' }])}>+ Add question</button>
          <button type="button" className="a-btn primary" onClick={saveQs}>Save questions</button>
        </div>
      </section>
      <section className="a-card">
        <h2>Privacy</h2>
        <label className="a-field">Privacy note shown on the sign-in screen
          <textarea className="a-textarea" rows={3} value={privacy.notice} onChange={(e) => setPrivacy({ ...privacy, notice: e.target.value })} /></label>
        <label className="a-field" style={{ maxWidth: 260 }}>Delete visit records after (months)
          <input className="a-input" type="number" min="1" max="120" value={privacy.retentionMonths} onChange={(e) => setPrivacy({ ...privacy, retentionMonths: e.target.value })} /></label>
        <div><button type="button" className="a-btn primary" onClick={() => save('privacy', privacy, 'Privacy settings saved.')}>Save</button></div>
      </section>
    </>
  );
}

/* -------------------------------------------------------------------- Types */
function Types({ setFlash }) {
  const [types, setTypes] = useState(null);
  const load = useCallback(() => api('/api/admin/visitor-types').then(setTypes).catch((e) => setFlash(e.message, 'bad')), [setFlash]);
  useEffect(() => { load(); }, [load]);
  const update = async (t, patch) => {
    const next = { ...t, ...patch };
    setTypes((list) => list.map((x) => (x.id === t.id ? next : x)));
    try {
      await api(`/api/admin/visitor-types/${t.id}`, { method: 'PUT', body: next });
    } catch (e) {
      setFlash(e.message, 'bad');
      load();
    }
  };
  const cols = [
    ['active', 'Shown'], ['require_host', 'Must choose a host'], ['require_signature', 'H&S + signature'],
    ['ask_company', 'Ask company'], ['ask_email', 'Ask email'], ['ask_rego', 'Ask vehicle rego'], ['ask_induction_no', 'Ask induction card'],
  ];
  return (
    <section className="a-card">
      <h2>Visit types</h2>
      <p className="sub">The buttons visitors choose on the first screen, and what each one asks. Changes apply straight away.</p>
      <div className="a-table-wrap">
        <table className="a-table">
          <thead><tr><th>Name</th>{cols.map(([, l]) => <th key={l}>{l}</th>)}</tr></thead>
          <tbody>
            {(types || []).map((t) => (
              <tr key={t.id}>
                <td><input className="a-input" aria-label="Visit type name" defaultValue={t.name} onBlur={(e) => e.target.value !== t.name && update(t, { name: e.target.value })} style={{ minWidth: 160 }} /></td>
                {cols.map(([k, l]) => <td key={k}><Toggle on={t[k]} label={`${t.name}: ${l}`} onChange={(v) => update(t, { [k]: v })} /></td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------- Users */
function Users({ setFlash, me }) {
  const [users, setUsers] = useState([]);
  const [f, setF] = useState({ name: '', email: '', password: '' });
  const [pw, setPw] = useState({ current: '', password: '' });
  const load = useCallback(() => api('/api/admin/users').then(setUsers).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);
  const add = async (e) => {
    e.preventDefault();
    try {
      await api('/api/admin/users', { method: 'POST', body: f });
      setFlash(`${f.name} can now sign in to Admin.`);
      setF({ name: '', email: '', password: '' });
      load();
    } catch (err) {
      setFlash(err.message, 'bad');
    }
  };
  const remove = async (u) => {
    if (!window.confirm(`Remove admin access for ${u.name}?`)) return;
    try {
      await api(`/api/admin/users/${u.id}`, { method: 'DELETE' });
      load();
    } catch (err) {
      setFlash(err.message, 'bad');
    }
  };
  const changePw = async (e) => {
    e.preventDefault();
    try {
      await api('/api/admin/me/password', { method: 'PUT', body: pw });
      setFlash('Password changed.');
      setPw({ current: '', password: '' });
    } catch (err) {
      setFlash(err.message, 'bad');
    }
  };
  return (
    <>
      <section className="a-card">
        <h2>People who can sign in to Admin</h2>
        <div className="a-table-wrap">
          <table className="a-table">
            <thead><tr><th>Name</th><th>Email</th><th>Last sign-in</th><th className="r"><span className="sr-only">Remove</span></th></tr></thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}><td><strong>{u.name}</strong>{u.id === me.id && <span className="muted"> (you)</span>}</td><td>{u.email}</td>
                  <td>{u.last_login_at ? fmtDateTime(u.last_login_at) : <span className="muted">Never</span>}</td>
                  <td className="r">{u.id !== me.id && <button type="button" className="a-btn sm danger" onClick={() => remove(u)}>Remove</button>}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <form onSubmit={add} className="a-row" style={{ alignItems: 'flex-end' }}>
          <label className="a-field">Name<input className="a-input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></label>
          <label className="a-field">Email<input className="a-input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required /></label>
          <label className="a-field">Temporary password<input className="a-input" type="password" autoComplete="new-password" minLength={10} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required /></label>
          <button type="submit" className="a-btn primary">Add admin</button>
        </form>
      </section>
      <section className="a-card">
        <h2>Change your password</h2>
        <form onSubmit={changePw} className="a-row" style={{ alignItems: 'flex-end' }}>
          <label className="a-field">Current password<input className="a-input" type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} required /></label>
          <label className="a-field">New password<input className="a-input" type="password" autoComplete="new-password" minLength={10} value={pw.password} onChange={(e) => setPw({ ...pw, password: e.target.value })} required /></label>
          <button type="submit" className="a-btn primary">Change password</button>
        </form>
      </section>
    </>
  );
}
