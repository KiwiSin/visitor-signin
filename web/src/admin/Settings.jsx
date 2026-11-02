import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api, fmtDateTime } from '../api.js';
import { Toggle, useFlash } from './AdminApp.jsx';
import { colorsOf, contrast, isDark, logoFor, PRESETS, readableOn } from '../theme.js';

const TABS = [
  ['branding', 'Branding'],
  ['hours', 'Business hours'],
  ['email', 'Email & alerts'],
  ['safety', 'Health & Safety'],
  ['types', 'Visit types'],
  ['users', 'Admin users'],
];

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
          {tab === 'hours' && <Hours settings={settings} save={save} />}
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
const COLOR_GROUPS = [
  { title: 'Buttons', hint: 'Sign In, Continue, selected options', items: [['accent', 'Button colour', true], ['accentText', 'Button text']] },
  { title: 'Top bar', hint: 'The bar with your logo on the sign-in screens', items: [['barBg', 'Background'], ['barText', 'Text']] },
  { title: 'Panels', hint: 'The boxes the forms sit in', items: [['cardBg', 'Background'], ['cardText', 'Text']] },
  { title: 'Home screen', hint: 'Clock and welcome text over the wallpaper', items: [['homeText', 'Text']] },
  { title: 'Emergency banner', hint: 'Assembly point message on the home screen', items: [['bannerBg', 'Background'], ['bannerText', 'Text']] },
  { title: 'Admin sidebar', hint: 'The menu on the left of these admin pages', items: [['navBg', 'Background'], ['navText', 'Text']] },
];
// Which text sits on which background, for the readability check.
const PAIRS = [['accentText', 'accent', 'Button text'], ['barText', 'barBg', 'Top bar text'], ['cardText', 'cardBg', 'Panel text'], ['bannerText', 'bannerBg', 'Banner text'], ['navText', 'navBg', 'Sidebar text']];

function ColorInput({ label, value, onChange }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <label className="a-field" style={{ fontWeight: 500 }}>{label}
      <span className="a-row" style={{ gap: 8, flexWrap: 'nowrap' }}>
        <input type="color" aria-label={`${label} colour`} value={value} onChange={(e) => onChange(e.target.value.toUpperCase())}
          style={{ width: 44, height: 40, padding: 0, border: '1px solid var(--line-2)', borderRadius: 8, background: '#fff' }} />
        <input className="a-input" style={{ width: 110, fontFamily: 'monospace' }} aria-label={`${label} hex code`} value={text}
          onChange={(e) => { setText(e.target.value); if (/^#[0-9a-f]{6}$/i.test(e.target.value)) onChange(e.target.value.toUpperCase()); }} />
      </span>
    </label>
  );
}

function LogoPicker({ label, hint, value, fallback, bg, onPick, onClear }) {
  return (
    <div className="a-field">{label} <span className="hint">{hint}</span>
      <div className="a-row">
        <div style={{ padding: 12, borderRadius: 10, background: bg, border: '1px solid var(--line-2)', minWidth: 200 }}>
          <img src={value || fallback} alt="" style={{ height: 44, maxWidth: 240, objectFit: 'contain', display: 'block' }} />
        </div>
        <label className="a-btn">Upload<input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={onPick} /></label>
        {value && <button type="button" className="a-btn" onClick={onClear}>Remove</button>}
      </div>
    </div>
  );
}

function Branding({ settings, save, setFlash }) {
  const [b, setB] = useState({ ...settings.branding, colors: colorsOf(settings.branding) });
  const set = (patch) => setB((x) => ({ ...x, ...patch }));
  const c = b.colors;
  const setColor = (key, v) => (key === 'accent' ? set({ accent: v, theme: 'custom' }) : set({ colors: { ...c, [key]: v }, theme: 'custom' }));
  const colorOf = (key) => (key === 'accent' ? b.accent : c[key]);

  const pick = async (e, kind) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const { url } = await upload(file);
      if (kind === 'wallpaper') set({ wallpapers: [...b.wallpapers, url], wallpaper: b.wallpapers.length });
      else set({ [kind]: url });
    } catch (err) {
      setFlash(err.message, 'bad');
    }
  };
  const removeWp = (i) => {
    const list = b.wallpapers.filter((_, j) => j !== i);
    set({ wallpapers: list, wallpaper: Math.min(b.wallpaper, Math.max(0, list.length - 1)) });
  };
  const applyPreset = (p) => set({ theme: p.id, accent: p.accent, colors: { ...p.colors } });
  const wp = b.wallpapers[b.wallpaper] || b.wallpapers[0];
  const lowContrast = PAIRS.filter(([fg, bg]) => contrast(colorOf(fg), colorOf(bg)) < 4.5);

  return (
    <>
      <section className="a-card">
        <h2>Company</h2>
        <div className="a-grid2">
          <label className="a-field">Company name<input className="a-input" value={b.companyName} onChange={(e) => set({ companyName: e.target.value })} /></label>
          <label className="a-field">App name <span className="hint">Shown in admin and emails</span><input className="a-input" value={b.appName} onChange={(e) => set({ appName: e.target.value })} /></label>
          <label className="a-field">Greeting <span className="hint">Shown before your company name</span><input className="a-input" value={b.welcome} onChange={(e) => set({ welcome: e.target.value })} /></label>
          <label className="a-field">Reception name<input className="a-input" value={b.locationName} onChange={(e) => set({ locationName: e.target.value })} /></label>
        </div>
        <label className="a-field">Line under the greeting<input className="a-input" value={b.subtitle} onChange={(e) => set({ subtitle: e.target.value })} /></label>
        <label className="a-field">Emergency assembly point <span className="hint">Shown at the bottom of the home screen. Leave empty to hide.</span><input className="a-input" value={b.assemblyPoint} onChange={(e) => set({ assemblyPoint: e.target.value })} /></label>
      </section>

      <section className="a-card">
        <h2>Logos</h2>
        <p className="sub">Upload a version of your logo for each kind of background. Each screen uses the one that suits the colour behind it. If you only upload one, it is used everywhere. PNG with a transparent background, about 600 × 160 px.</p>
        <div className="a-grid2">
          <LogoPicker label="Logo for dark backgrounds" hint="Light or white logo: home screen over the wallpaper, dark bars and sidebar"
            value={b.logo} fallback="/logo-white.svg" bg="#1F2937" onPick={(e) => pick(e, 'logo')} onClear={() => set({ logo: '' })} />
          <LogoPicker label="Logo for light backgrounds" hint="Dark or full-colour logo: white bars, admin sign-in, emails"
            value={b.logoOnLight} fallback="/logo.svg" bg="#FFFFFF" onPick={(e) => pick(e, 'logoOnLight')} onClear={() => set({ logoOnLight: '' })} />
        </div>
      </section>

      <section className="a-card">
        <h2>Colours</h2>
        <div className="a-field">Start from a theme
          <div className="a-row" style={{ gap: 8 }}>
            {PRESETS.map((p) => (
              <button key={p.id} type="button" onClick={() => applyPreset(p)} aria-pressed={b.theme === p.id}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px 6px 6px', borderRadius: 999, background: '#fff', fontWeight: 600, fontSize: 14,
                  border: b.theme === p.id ? '2px solid var(--ink)' : '1px solid var(--line-2)' }}>
                <span style={{ display: 'flex', borderRadius: 999, overflow: 'hidden', border: '1px solid var(--line)' }}>
                  {[p.colors.barBg, p.accent, p.colors.cardBg, p.colors.navBg].map((col, i) => <span key={i} style={{ width: 14, height: 24, background: col }} />)}
                </span>
                {p.name}
              </button>
            ))}
            {b.theme === 'custom' && <span className="badge">Custom</span>}
          </div>
        </div>
        <div className="a-split">
          <div className="main" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {COLOR_GROUPS.map((g) => (
              <div key={g.title} style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingBottom: 12, borderBottom: '1px solid #F3F4F6' }}>
                <div><strong style={{ fontSize: 14 }}>{g.title}</strong> <span className="muted" style={{ fontSize: 13, color: 'var(--muted)' }}>{g.hint}</span></div>
                <div className="a-row" style={{ gap: 18, alignItems: 'flex-end' }}>
                  {g.items.map(([key, label]) => <ColorInput key={key} label={label} value={colorOf(key)} onChange={(v) => setColor(key, v)} />)}
                  {g.items.length === 2 && (
                    <button type="button" className="a-btn sm" onClick={() => setColor(g.items[1][0], readableOn(colorOf(g.items[0][0])))}>Best text colour</button>
                  )}
                </div>
              </div>
            ))}
            {lowContrast.length > 0 && (
              <div className="a-msg warn">Hard to read: {lowContrast.map(([, , l]) => l).join(', ')}. Use “Best text colour”, or pick colours further apart.</div>
            )}
          </div>
          <div className="side" style={{ maxWidth: 460, flexBasis: 380, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Preview b={b} wp={wp} />
          </div>
        </div>
      </section>

      <section className="a-card">
        <h2>Wallpapers</h2>
        <p className="sub">Full screen behind every tablet screen. Landscape photos, at least 2048 px wide.</p>
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
        <div className="a-toggle-row"><span>Change wallpaper every 60 seconds</span><Toggle on={b.rotateWallpapers} label="Rotate wallpapers" onChange={(v) => set({ rotateWallpapers: v })} /></div>
        <label className="a-toggle-row">Darken wallpaper so text stays readable
          <input type="range" min="0" max="0.8" step="0.05" value={b.scrim} onChange={(e) => set({ scrim: Number(e.target.value) })} style={{ width: 180, accentColor: b.accent }} /></label>
      </section>

      <div style={{ position: 'sticky', bottom: 0, padding: '12px 0', background: 'linear-gradient(transparent, var(--ground) 30%)' }}>
        <button type="button" className="a-btn primary" style={{ height: 46 }} onClick={() => save('branding', b, 'Branding saved. Tablets pick it up within 5 minutes.')}>Save branding</button>
      </div>
    </>
  );
}

/** Small live previews of the home screen and a sign-in screen. */
function Preview({ b, wp }) {
  const c = b.colors;
  const homeLogo = logoFor(b, isDark(c.homeText) ? '#FFFFFF' : '#000000');
  return (
    <>
      <div className="a-field">Home screen</div>
      <div className="preview">
        <img className="bg" src={wp} alt="" />
        <div style={{ position: 'absolute', inset: 0, background: `rgba(17,24,39,${b.scrim})` }} />
        <div className="in" style={{ color: c.homeText }}>
          <img src={homeLogo} alt="" style={{ height: 24, maxWidth: 160, objectFit: 'contain' }} />
          <strong style={{ fontSize: 32 }}>{new Date().toLocaleTimeString('en-NZ', { hour: 'numeric', minute: '2-digit' })}</strong>
          <span style={{ fontSize: 12 }}>{b.welcome} to {b.companyName}</span>
          <div className="a-row" style={{ marginTop: 6, justifyContent: 'center' }}>
            <span style={{ width: 100, height: 44, borderRadius: 10, background: b.accent, color: c.accentText, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>Sign In</span>
            <span style={{ width: 100, height: 44, borderRadius: 10, background: '#fff', color: '#111827', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>Sign Out</span>
          </div>
          {b.assemblyPoint && <span style={{ position: 'absolute', left: 10, right: 10, bottom: 8, padding: '4px 8px', borderRadius: 6, fontSize: 9, background: c.bannerBg, color: c.bannerText }}>Assembly point: {b.assemblyPoint}</span>}
        </div>
      </div>
      <div className="a-field">Sign-in screens</div>
      <div className="preview">
        <img className="bg" src={wp} alt="" />
        <div style={{ position: 'absolute', inset: 0, background: `rgba(17,24,39,${b.scrim})` }} />
        <div style={{ position: 'absolute', inset: 0, padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ background: c.barBg, color: c.barText, borderRadius: 8, padding: '6px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <img src={logoFor(b, c.barBg)} alt="" style={{ height: 22, maxWidth: 130, objectFit: 'contain' }} />
            <span style={{ fontSize: 10, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 16, height: 16, borderRadius: 999, background: b.accent, color: c.accentText, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 9 }}>1</span>Your details · 2 Visiting
            </span>
          </div>
          <div style={{ flex: 1, background: c.cardBg, color: c.cardText, borderRadius: 10, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <strong style={{ fontSize: 15 }}>Tell us about you</strong>
            <div style={{ display: 'flex', gap: 6 }}>
              <span style={{ flex: 1, height: 26, borderRadius: 6, background: b.accent, color: c.accentText, fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Visitor</span>
              <span style={{ flex: 1, height: 26, borderRadius: 6, background: '#fff', color: '#111827', border: '1px solid #D1D5DB', fontSize: 10, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Contractor</span>
            </div>
            <span style={{ fontSize: 10, fontWeight: 600 }}>Full name *</span>
            <span style={{ height: 24, borderRadius: 6, background: '#fff', border: '1px solid #D1D5DB' }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ padding: '6px 12px', borderRadius: 8, background: '#fff', color: '#111827', fontSize: 11, fontWeight: 700 }}>Back</span>
            <span style={{ padding: '6px 16px', borderRadius: 8, background: b.accent, color: c.accentText, fontSize: 11, fontWeight: 700 }}>Continue</span>
          </div>
        </div>
      </div>
      <div className="a-field">Admin sidebar</div>
      <div style={{ background: c.navBg, color: c.navText, borderRadius: 12, padding: 12, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
        <img src={logoFor(b, c.navBg)} alt="" style={{ height: 22, maxWidth: 150, objectFit: 'contain', alignSelf: 'flex-start' }} />
        <span style={{ padding: '6px 10px', borderRadius: 8, background: `color-mix(in srgb, ${c.navText} 12%, transparent)`, fontWeight: 600 }}>Dashboard</span>
        <span style={{ padding: '0 10px', opacity: 0.85 }}>Visitor log</span>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------- Hours */
const DAY_NAMES = [['mon', 'Monday'], ['tue', 'Tuesday'], ['wed', 'Wednesday'], ['thu', 'Thursday'], ['fri', 'Friday'], ['sat', 'Saturday'], ['sun', 'Sunday']];
const TIME_ZONES = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : ['Pacific/Auckland', 'Australia/Sydney', 'Europe/London', 'America/New_York'];

function fmt12(t) {
  const [h, m] = t.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}

function Hours({ settings, save }) {
  const [h, setH] = useState(settings.hours);
  const a = h.autoSignOut;
  const setDay = (d, patch) => setH({ ...h, days: { ...h.days, [d]: { ...h.days[d], ...patch } } });
  const setA = (patch) => setH({ ...h, autoSignOut: { ...a, ...patch } });
  const copyMon = () => setH({ ...h, days: Object.fromEntries(DAY_NAMES.map(([d]) => [d, ['sat', 'sun'].includes(d) ? h.days[d] : { ...h.days.mon }])) });
  const summary = a.mode === 'off' || (!a.visitors && !a.staff)
    ? 'Nobody is signed out automatically.'
    : `Every day at ${a.mode === 'time' ? fmt12(a.time) : `closing time + ${a.afterClosingMins} min`}, ${[a.visitors && 'visitors', a.staff && 'staff'].filter(Boolean).join(' and ')} still signed in are signed out.`;
  return (
    <>
      <section className="a-card">
        <h2>Opening hours</h2>
        <p className="sub">Used for the “after closing time” sign-out below, and kept for future features such as after-hours messages.</p>
        <label className="a-field" style={{ maxWidth: 320 }}>Time zone
          <select className="a-select" value={h.timezone} onChange={(e) => setH({ ...h, timezone: e.target.value })}>
            {TIME_ZONES.map((tz) => <option key={tz} value={tz}>{tz.replace(/_/g, ' ')}</option>)}
          </select>
        </label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {DAY_NAMES.map(([d, label]) => (
            <div key={d} className="a-toggle-row" style={{ justifyContent: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
              <span style={{ width: 110, fontWeight: 600 }}>{label}</span>
              <Toggle on={h.days[d].open} label={`${label} open`} onChange={(v) => setDay(d, { open: v })} />
              {h.days[d].open ? (
                <span className="a-row" style={{ gap: 8 }}>
                  <input className="a-input" type="time" aria-label={`${label} opens`} value={h.days[d].start} onChange={(e) => setDay(d, { start: e.target.value })} style={{ width: 130 }} />
                  <span>to</span>
                  <input className="a-input" type="time" aria-label={`${label} closes`} value={h.days[d].end} onChange={(e) => setDay(d, { end: e.target.value })} style={{ width: 130 }} />
                </span>
              ) : <span className="muted" style={{ color: 'var(--muted)' }}>Closed</span>}
            </div>
          ))}
        </div>
        <div><button type="button" className="a-btn sm" onClick={copyMon}>Copy Monday’s hours to Tuesday–Friday</button></div>
      </section>
      <section className="a-card">
        <h2>Automatic sign-out</h2>
        <p className="sub">Signs out anyone who forgot, so the on-site list and emergency roll calls stay accurate. The visitor log shows these as “Signed out automatically”.</p>
        <div className="a-tabs">
          {[['time', 'At a set time'], ['closing', 'After closing time'], ['off', 'Off']].map(([k, label]) => (
            <button key={k} type="button" className={a.mode === k ? 'on' : ''} onClick={() => setA({ mode: k })}>{label}</button>
          ))}
        </div>
        {a.mode === 'time' && (
          <label className="a-field" style={{ maxWidth: 200 }}>Time each day<input className="a-input" type="time" value={a.time} onChange={(e) => setA({ time: e.target.value })} /></label>
        )}
        {a.mode === 'closing' && (
          <label className="a-field" style={{ maxWidth: 320 }}>Minutes after closing time <span className="hint">On closed days the set time ({fmt12(a.time)}) is used</span>
            <input className="a-input" type="number" min="0" max="600" step="15" value={a.afterClosingMins} onChange={(e) => setA({ afterClosingMins: Number(e.target.value) })} /></label>
        )}
        {a.mode !== 'off' && (
          <>
            <div className="a-toggle-row"><span>Sign out visitors and contractors</span><Toggle on={a.visitors} label="Sign out visitors" onChange={(v) => setA({ visitors: v })} /></div>
            <div className="a-toggle-row"><span>Sign out staff</span><Toggle on={a.staff} label="Sign out staff" onChange={(v) => setA({ staff: v })} /></div>
            <div className="a-toggle-row"><span>Email the reception mailbox a list of who was signed out</span><Toggle on={a.emailReception} label="Email reception" onChange={(v) => setA({ emailReception: v })} /></div>
          </>
        )}
        <div className="a-msg ok" style={{ fontWeight: 500 }}>{summary}</div>
      </section>
      <div><button type="button" className="a-btn primary" onClick={() => save('hours', h, 'Business hours saved.')}>Save business hours</button></div>
    </>
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
