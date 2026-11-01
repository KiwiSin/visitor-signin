import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError, fmtTime, initials } from '../api.js';
import { IconCheck, IconPin, IconSearch, IconSignIn, IconSignOut, IconStaff, IconWarn, IconWifiOff } from '../icons.jsx';
import SignaturePad from './SignaturePad.jsx';
import RollCall from '../rollcall/RollCall.jsx';
import { applyTheme, colorsOf, isDark, logoFor } from '../theme.js';

const TOKEN_KEY = 'vs_kiosk_token';
const CACHE_KEY = 'vs_kiosk_cache';
const OUTBOX_KEY = 'vs_kiosk_outbox';
const IDLE_MS = 90_000;
const DONE_MS = 15_000;

const load = (k, fallback) => {
  try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch { return fallback; }
};
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full */ } };
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

function useClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

const emptyForm = (type = '') => ({
  clientId: uuid(), type, name: '', company: '', mobile: '', email: '', rego: '', inductionNo: '',
  hostId: null, noHost: false, answers: {}, signature: null, agreed: false,
});

export default function Kiosk() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY));
  const [data, setData] = useState(() => load(CACHE_KEY, null));
  const [online, setOnline] = useState(true);
  const [screen, setScreen] = useState('home');
  const [form, setForm] = useState(emptyForm());
  const [result, setResult] = useState(null);
  const [outboxCount, setOutboxCount] = useState(() => load(OUTBOX_KEY, []).length);
  const [wpIndex, setWpIndex] = useState(0);

  const kfetch = useCallback((path, opts = {}) => api(path, { ...opts, headers: { 'X-Kiosk-Token': token || '' } }), [token]);
  const kioskHeaders = useMemo(() => ({ 'X-Kiosk-Token': token || '' }), [token]);

  const unpair = () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(CACHE_KEY);
    setToken(null);
    setData(null);
  };

  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      const d = await kfetch('/api/kiosk/bootstrap');
      setData(d);
      save(CACHE_KEY, d);
      setOnline(true);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'unpaired') unpair();
      else setOnline(false);
    }
  }, [token, kfetch]);

  // Send any sign-ins that were saved while offline.
  const flushOutbox = useCallback(async () => {
    const box = load(OUTBOX_KEY, []);
    if (!box.length || !token) return;
    const left = [];
    for (const item of box) {
      try {
        await kfetch('/api/kiosk/visits', { method: 'POST', body: item });
      } catch (err) {
        if (err.status === 0 || err.status >= 500) left.push(item); // still offline: keep it
      }
    }
    save(OUTBOX_KEY, left);
    setOutboxCount(left.length);
    if (left.length < box.length) setOnline(true);
  }, [token, kfetch]);

  useEffect(() => {
    refresh();
    flushOutbox();
    const t1 = setInterval(refresh, 5 * 60_000);
    const t2 = setInterval(flushOutbox, 20_000);
    const onOnline = () => { refresh(); flushOutbox(); };
    window.addEventListener('online', onOnline);
    return () => { clearInterval(t1); clearInterval(t2); window.removeEventListener('online', onOnline); };
  }, [refresh, flushOutbox]);

  const branding = data?.branding;
  useEffect(() => {
    applyTheme(branding);
    document.title = branding?.companyName ? `Sign in · ${branding.companyName}` : 'Visitor Sign-In';
  }, [branding]);

  // Wallpaper (optionally rotating every 60 seconds).
  const wallpapers = branding?.wallpapers?.length ? branding.wallpapers : ['/wallpapers/mountains.jpg'];
  useEffect(() => {
    setWpIndex(Math.min(branding?.wallpaper ?? 0, wallpapers.length - 1));
    if (!branding?.rotateWallpapers || wallpapers.length < 2) return undefined;
    const t = setInterval(() => setWpIndex((i) => (i + 1) % wallpapers.length), 60_000);
    return () => clearInterval(t);
  }, [branding?.wallpaper, branding?.rotateWallpapers, wallpapers.length]);

  // Return to the home screen after a period of no touches.
  const idleTimer = useRef(null);
  const goHome = useCallback(() => {
    setScreen('home');
    setForm(emptyForm());
    setResult(null);
  }, []);
  useEffect(() => {
    if (screen === 'home' || screen === 'rollcall') return undefined; // never time out a roll call
    const ms = screen === 'done' ? DONE_MS : IDLE_MS;
    const reset = () => {
      clearTimeout(idleTimer.current);
      idleTimer.current = setTimeout(goHome, ms);
    };
    reset();
    window.addEventListener('pointerdown', reset);
    window.addEventListener('keydown', reset);
    return () => {
      clearTimeout(idleTimer.current);
      window.removeEventListener('pointerdown', reset);
      window.removeEventListener('keydown', reset);
    };
  }, [screen, goHome]);

  const wall = (
    <>
      <img className="k-wall" src={wallpapers[wpIndex] || wallpapers[0]} alt="" />
      <div className="k-scrim" style={{ background: `rgba(17,24,39,${branding?.scrim ?? 0.35})` }} />
    </>
  );

  if (!token) {
    return (
      <div className="k-root">{wall}
        <div className="k-content"><Pair onPaired={(t) => { localStorage.setItem(TOKEN_KEY, t); setToken(t); }} /></div>
      </div>
    );
  }
  if (screen === 'rollcall') {
    return <div className="k-root"><RollCall headers={kioskHeaders} storageKey="vs_rc_kiosk" onExit={goHome} /></div>;
  }
  if (!data) {
    return (
      <div className="k-root">{wall}
        <div className="k-content"><div className="k-pair"><div className="k-pair-card">
          <h1 style={{ fontSize: 24 }}>Connecting…</h1>
          {!online && <p>Can’t reach the server yet. Check the tablet’s Wi-Fi.</p>}
        </div></div></div>
      </div>
    );
  }

  const types = data.types;
  const type = types.find((t) => t.key === form.type);
  const setF = (patch) => setForm((f) => ({ ...f, ...patch }));
  const barLogo = logoFor(branding, colorsOf(branding).barBg);

  const startSignIn = () => {
    const def = types.find((t) => t.key === data.kiosk.default_type) ? data.kiosk.default_type : types[0]?.key;
    setForm(emptyForm(def));
    setScreen('details');
  };

  const submit = async () => {
    const body = {
      clientId: form.clientId, type: form.type, name: form.name, company: form.company, mobile: form.mobile, email: form.email,
      rego: form.rego, inductionNo: form.inductionNo, hostId: form.hostId, noHost: form.noHost, agreed: form.agreed,
      signature: form.signature, signedInAt: new Date().toISOString(),
      answers: Object.entries(form.answers).map(([questionId, answer]) => ({ questionId: Number(questionId), answer })),
    };
    const hostName = data.staff.find((s) => s.id === form.hostId)?.name ?? null;
    try {
      const r = await kfetch('/api/kiosk/visits', { method: 'POST', body });
      setResult({ ...r, name: form.name, hostName: r.hostName ?? hostName, queued: false });
      setOnline(true);
    } catch (err) {
      if (err.status === 0 || err.status >= 500) {
        const box = [...load(OUTBOX_KEY, []), body];
        save(OUTBOX_KEY, box);
        setOutboxCount(box.length);
        setOnline(false);
        setResult({ name: form.name, hostName, queued: true });
      } else {
        throw err;
      }
    }
    setScreen('done');
  };

  const steps = [
    { key: 'details', label: 'Your details' },
    { key: 'host', label: 'Visiting' },
    ...(type?.require_signature ? [{ key: 'safety', label: 'Health & Safety' }] : []),
    { key: 'done', label: 'Done' },
  ];

  const header = (right) => (
    <div className="k-bar">
      <img className="k-logo" src={barLogo} alt={branding.companyName} />
      <div className="a-row">
        {(!online || outboxCount > 0) && (
          <span className="k-chip k-offline"><IconWifiOff /> {outboxCount > 0 ? `Offline · ${outboxCount} waiting to send` : 'Offline'}</span>
        )}
        {right}
      </div>
    </div>
  );
  const stepBar = (current) => (
    <div className="k-steps" aria-label="Progress">
      {steps.map((s, i) => {
        const idx = steps.findIndex((x) => x.key === current);
        const cls = i < idx ? 'done' : i === idx ? 'on' : '';
        return (
          <span key={s.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            {i > 0 && <span className="sep" />}
            <span className={cls}><span className="n">{i < idx ? <IconCheck style={{ width: 16, height: 16 }} /> : i + 1}</span> {s.label}</span>
          </span>
        );
      })}
    </div>
  );

  let body;
  if (screen === 'home') {
    body = (
      <Home branding={branding} online={online} outboxCount={outboxCount}
        onSignIn={startSignIn} onSignOut={() => setScreen('signout')} onStaff={() => setScreen('staff')} />
    );
  } else if (screen === 'details') {
    body = (<>{header(stepBar('details'))}
      <Details types={types} form={form} setF={setF} onBack={goHome} onNext={() => setScreen('host')} /></>);
  } else if (screen === 'host') {
    body = (<>{header(stepBar('host'))}
      <Host staff={data.staff} type={type} form={form} setF={setF} onBack={() => setScreen('details')}
        onNext={async () => (type?.require_signature ? setScreen('safety') : submit())} /></>);
  } else if (screen === 'safety') {
    body = (<>{header(stepBar('safety'))}
      <Safety data={data} form={form} setF={setF} onBack={() => setScreen('host')} onSubmit={submit} /></>);
  } else if (screen === 'done') {
    body = (<>{header(null)}<Done result={result} branding={branding} onDone={goHome} /></>);
  } else if (screen === 'signout') {
    body = (<>{header(null)}<SignOutScreen kfetch={kfetch} onDone={goHome} /></>);
  } else if (screen === 'staff') {
    body = (<>{header(null)}<StaffScreen kfetch={kfetch} onDone={goHome} onRollCall={() => setScreen('rollcall')} /></>);
  }

  return (
    <div className="k-root">
      {wall}
      <div className="k-content">{body}</div>
    </div>
  );
}

/* --------------------------------------------------------------- Pairing */
function Pair({ onPaired }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const press = (d) => setCode((c) => (d === 'del' ? c.slice(0, -1) : (c + d).slice(0, 6)));
  const go = async () => {
    setBusy(true);
    setError('');
    try {
      const r = await api('/api/kiosk/pair', { method: 'POST', body: { code } });
      onPaired(r.token);
    } catch (err) {
      setError(err.message);
      setCode('');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="k-pair">
      <div className="k-pair-card">
        <img src="/logo.svg" alt="Visitor Sign-In" style={{ height: 44, alignSelf: 'center' }} />
        <h1 style={{ fontSize: 24 }}>Set up this tablet</h1>
        <p style={{ color: 'var(--muted)' }}>In Admin › Tablets, add this tablet and type the 6-digit code shown there.</p>
        <input className="k-input k-code" inputMode="numeric" value={code} aria-label="Pairing code"
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} />
        <div className="k-keypad">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => <button key={d} type="button" onClick={() => press(d)}>{d}</button>)}
          <button type="button" onClick={() => setCode('')} aria-label="Clear">C</button>
          <button type="button" onClick={() => press('0')}>0</button>
          <button type="button" onClick={() => press('del')} aria-label="Delete">⌫</button>
        </div>
        {error && <div className="k-error">{error}</div>}
        <button type="button" className="k-btn primary" disabled={code.length !== 6 || busy} onClick={go}>Pair tablet</button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Home */
function Home({ branding, onSignIn, onSignOut, onStaff, online, outboxCount }) {
  const now = useClock();
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
        <img className="k-home-logo" src={logoFor(branding, isDark(colorsOf(branding).homeText) ? '#FFFFFF' : '#000000')} alt={branding.companyName} />
        <div className="a-row">
          {(!online || outboxCount > 0) && <span className="k-chip k-offline"><IconWifiOff /> Offline</span>}
          <span className="k-chip"><IconPin /> {branding.locationName}</span>
        </div>
      </div>
      <div className="k-home">
        <div className="k-time">{now.toLocaleTimeString('en-NZ', { hour: 'numeric', minute: '2-digit' })}</div>
        <div className="k-date">{now.toLocaleDateString('en-NZ', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div>
        <h1 className="k-welcome">{branding.welcome} to {branding.companyName}</h1>
        {branding.subtitle && <p className="k-sub">{branding.subtitle}</p>}
        <div className="k-big-row">
          <button type="button" className="k-big primary" onClick={onSignIn}><IconSignIn /> Sign In</button>
          <button type="button" className="k-big secondary" onClick={onSignOut}><IconSignOut /> Sign Out</button>
        </div>
        <div className="k-small-row">
          <button type="button" className="k-small" onClick={onStaff}><IconStaff /> Staff in / out</button>
        </div>
      </div>
      {branding.assemblyPoint && (
        <div className="k-banner"><IconWarn /> <span>In an emergency, follow the wardens to the assembly point: <strong>{branding.assemblyPoint}</strong></span></div>
      )}
    </>
  );
}

/* --------------------------------------------------------------- Details */
function Details({ types, form, setF, onBack, onNext }) {
  const type = types.find((t) => t.key === form.type);
  const [error, setError] = useState('');
  const next = () => {
    if (!form.name.trim()) return setError('Please enter your full name.');
    if (form.mobile.replace(/\D/g, '').length < 7) return setError('Please enter your mobile number.');
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) return setError('That email address doesn’t look right.');
    setError('');
    return onNext();
  };
  const field = (label, key, props = {}) => (
    <label className="k-field">{label}
      <input className="k-input" value={form[key]} onChange={(e) => setF({ [key]: e.target.value })} {...props} />
    </label>
  );
  return (
    <>
      <div className="k-card">
        <div>
          <h1>Tell us about you</h1>
          <p className="lead">Choose the option that best describes your visit.</p>
        </div>
        <div className="k-types" role="radiogroup" aria-label="Visit type">
          {types.map((t) => (
            <button key={t.key} type="button" role="radio" aria-checked={form.type === t.key}
              className={`k-pill ${form.type === t.key ? 'on' : ''}`} onClick={() => setF({ type: t.key })}>{t.name}</button>
          ))}
        </div>
        <div className="k-form">
          {field('Full name *', 'name', { autoComplete: 'name', autoCapitalize: 'words' })}
          {type?.ask_company && field('Company', 'company', { autoComplete: 'organization', autoCapitalize: 'words' })}
          {field('Mobile *', 'mobile', { type: 'tel', inputMode: 'tel', autoComplete: 'tel' })}
          {type?.ask_email && field('Email', 'email', { type: 'email', inputMode: 'email', autoComplete: 'email', autoCapitalize: 'off' })}
          {type?.ask_induction_no && field('Site Safe / induction card number', 'inductionNo')}
          {type?.ask_rego && field('Vehicle rego (if parked on site)', 'rego', { autoCapitalize: 'characters' })}
        </div>
        {error && <div className="k-error" role="alert">{error}</div>}
      </div>
      <div className="k-foot">
        <button type="button" className="k-btn" onClick={onBack}>Cancel</button>
        <button type="button" className="k-btn primary" onClick={next}>Continue</button>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ Host */
function Host({ staff, type, form, setF, onBack, onNext }) {
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return staff.filter((p) => !s || p.name.toLowerCase().includes(s) || (p.team || '').toLowerCase().includes(s));
  }, [q, staff]);
  const next = async () => {
    if (!form.hostId && !form.noHost) return setError('Please choose who you are visiting.');
    setError('');
    setBusy(true);
    try { await onNext(); } catch (err) { setError(err.message); } finally { setBusy(false); }
    return undefined;
  };
  return (
    <>
      <div className="k-card">
        <div>
          <h1>Who are you here to see?</h1>
          <p className="lead">Start typing a name or team. We’ll let them know you’re here as soon as you’ve signed in.</p>
        </div>
        <label className="k-search">
          <IconSearch />
          <span className="sr-only">Search staff</span>
          <input className="k-input" type="search" placeholder="Search by name or team…" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <div className="k-people">
          {list.map((p) => (
            <button key={p.id} type="button" className={`k-person ${form.hostId === p.id ? 'on' : ''}`}
              onClick={() => setF({ hostId: p.id, noHost: false })}>
              <span className="k-avatar">{initials(p.name)}</span>
              <span><span className="nm">{p.name}</span><span className="tm">{p.team || ' '}</span></span>
            </button>
          ))}
          <button type="button" className={`k-person ${form.noHost ? 'on' : ''}`} onClick={() => setF({ hostId: null, noHost: true })}>
            <span className="k-avatar">?</span>
            <span><span className="nm">{type?.require_host ? 'Not sure / Reception' : 'No one in particular'}</span>
              <span className="tm">{type?.require_host ? 'Reception will find them' : 'Just dropping off'}</span></span>
          </button>
          {!list.length && <p className="lead">No one matches “{q}”. Choose Not sure / Reception and we’ll help.</p>}
        </div>
        {error && <div className="k-error" role="alert">{error}</div>}
      </div>
      <div className="k-foot">
        <button type="button" className="k-btn" onClick={onBack}>Back</button>
        <button type="button" className="k-btn primary" disabled={busy} onClick={next}>{type?.require_signature ? 'Continue' : 'Sign in'}</button>
      </div>
    </>
  );
}

/* ---------------------------------------------------------------- Safety */
function Safety({ data, form, setF, onBack, onSubmit }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const answered = data.questions.every((q) => form.answers[q.id]);
  const ready = answered && form.signature && form.agreed;
  const go = async () => {
    if (!answered) return setError('Please answer every question.');
    if (!form.signature) return setError('Please sign in the box.');
    if (!form.agreed) return setError('Please tick the box to agree.');
    setBusy(true);
    setError('');
    try { await onSubmit(); } catch (err) { setError(err.message); } finally { setBusy(false); }
    return undefined;
  };
  return (
    <>
      <div className="k-safety">
        <div className="k-card" style={{ gap: 12 }}>
          <h1 style={{ fontSize: 24 }}>Site Health &amp; Safety rules</h1>
          <div className="k-hs-text">{data.safety.text}</div>
        </div>
        <div className="k-card" style={{ gap: 14 }}>
          {data.questions.length > 0 && <h2 style={{ fontSize: 20, fontWeight: 700 }}>A few quick questions</h2>}
          {data.questions.map((q) => (
            <div key={q.id} className="k-q">
              <span>{q.text}</span>
              <span className="k-yn" role="radiogroup" aria-label={q.text}>
                {['yes', 'no'].map((a) => (
                  <button key={a} type="button" role="radio" aria-checked={form.answers[q.id] === a}
                    className={form.answers[q.id] === a ? 'on' : ''}
                    onClick={() => setF({ answers: { ...form.answers, [q.id]: a } })}>{a === 'yes' ? 'Yes' : 'No'}</button>
                ))}
              </span>
            </div>
          ))}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>Your signature</span>
            <SignaturePad onChange={(sig) => setF({ signature: sig })} />
          </div>
          <button type="button" className={`k-check ${form.agreed ? 'on' : ''}`} role="checkbox" aria-checked={form.agreed}
            onClick={() => setF({ agreed: !form.agreed })}>
            <span className="box">{form.agreed && <IconCheck />}</span>
            I have read and agree to follow the site Health &amp; Safety rules.
          </button>
          {data.privacyNotice && <p className="k-privacy">{data.privacyNotice}</p>}
          {error && <div className="k-error" role="alert">{error}</div>}
        </div>
      </div>
      <div className="k-foot">
        <button type="button" className="k-btn" onClick={onBack}>Back</button>
        <button type="button" className="k-btn primary" disabled={busy || !ready} onClick={go}>
          {ready ? 'Agree & sign in' : 'Answer, sign and tick to continue'}
        </button>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ Done */
function Done({ result, branding, onDone }) {
  const first = (result?.name || '').split(' ')[0];
  return (
    <div className="k-done">
      <div className="k-done-card">
        <div className="tick"><IconCheck style={{ width: 48, height: 48 }} /></div>
        <h1>You’re signed in{first ? `, ${first}` : ''}</h1>
        {result?.hostName
          ? <p>We’re letting <strong>{result.hostName}</strong> know you’re here. Please take a seat at {branding.locationName}.</p>
          : <p>Please let reception know you’ve arrived.</p>}
        {result?.queued && <p className="k-privacy">This tablet is offline right now. Your sign-in is saved and will be sent as soon as it reconnects.</p>}
        <p style={{ fontSize: 15, color: 'var(--card-muted)' }}>Remember to sign out on this tablet when you leave.</p>
        <button type="button" className="k-btn primary" style={{ alignSelf: 'flex-start' }} onClick={onDone}>Done</button>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- Sign out */
function SignOutScreen({ kfetch, onDone }) {
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState('');
  const [gone, setGone] = useState({});
  const [error, setError] = useState('');
  useEffect(() => {
    kfetch('/api/kiosk/onsite').then(setRows).catch((e) => { setError(e.message); setRows([]); });
  }, [kfetch]);
  const out = async (id) => {
    try {
      await kfetch(`/api/kiosk/visits/${id}/signout`, { method: 'POST', body: {} });
      setGone((g) => ({ ...g, [id]: true }));
    } catch (e) {
      setError(e.message);
    }
  };
  const list = (rows || []).filter((r) => !q || r.name.toLowerCase().includes(q.toLowerCase()) || (r.company || '').toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <div className="k-card">
        <div>
          <h1>Signing out? Find your name</h1>
          <p className="lead">Tap Sign out next to your name. Thanks for visiting, ngā mihi.</p>
        </div>
        <label className="k-search">
          <IconSearch /><span className="sr-only">Search your name</span>
          <input className="k-input" type="search" placeholder="Type your name…" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        {error && <div className="k-error">{error}</div>}
        <div className="k-list">
          {rows === null && <p className="lead">Loading…</p>}
          {rows && !list.length && <p className="lead">{q ? `No one called “${q}” is signed in.` : 'No visitors are signed in right now.'}</p>}
          {list.map((r) => (
            <div key={r.id} className="k-row">
              <span className="k-avatar">{initials(r.name)}</span>
              <span className="grow">
                <span style={{ display: 'block', fontSize: 18, fontWeight: 700 }}>{r.name}</span>
                <span style={{ display: 'block', fontSize: 14, color: 'var(--card-muted)' }}>
                  {[r.company, r.host ? `visiting ${r.host}` : r.type, `in since ${fmtTime(r.signedInAt)}`].filter(Boolean).join(' · ')}
                </span>
              </span>
              {gone[r.id]
                ? <span className="k-tag in" style={{ fontSize: 15, padding: '10px 14px' }}>Signed out. See you next time</span>
                : <button type="button" className="k-btn primary" style={{ height: 52, padding: '0 26px' }} onClick={() => out(r.id)}>Sign out</button>}
            </div>
          ))}
        </div>
      </div>
      <div className="k-foot"><button type="button" className="k-btn" onClick={onDone}>Back to home</button></div>
    </>
  );
}

/* --------------------------------------------------------------- Staff */
function StaffScreen({ kfetch, onDone, onRollCall }) {
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    kfetch('/api/kiosk/staff').then(setRows).catch((e) => { setError(e.message); setRows([]); });
  }, [kfetch]);
  const toggle = async (s) => {
    const state = s.presence === 'in' ? 'out' : 'in';
    setRows((rs) => rs.map((r) => (r.id === s.id ? { ...r, presence: state, presence_at: new Date().toISOString() } : r)));
    try {
      await kfetch(`/api/kiosk/staff/${s.id}/presence`, { method: 'POST', body: { state } });
    } catch (e) {
      setError(e.message);
      setRows((rs) => rs.map((r) => (r.id === s.id ? s : r)));
    }
  };
  const list = (rows || []).filter((r) => !q || r.name.toLowerCase().includes(q.toLowerCase()));
  const inCount = (rows || []).filter((r) => r.presence === 'in').length;
  return (
    <>
      <div className="k-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <h1>Staff in / out</h1>
            <p className="lead">Tap your name to change your status.</p>
          </div>
          {rows && <div className="a-row"><span className="k-tag in">{inCount} in</span><span className="k-tag">{rows.length - inCount} out</span></div>}
        </div>
        <label className="k-search">
          <IconSearch /><span className="sr-only">Search staff</span>
          <input className="k-input" type="search" placeholder="Find your name…" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        {error && <div className="k-error">{error}</div>}
        <div className="k-tiles">
          {rows === null && <p className="lead">Loading…</p>}
          {rows && !rows.length && <p className="lead">No staff have been added yet. Add them in Admin › Staff.</p>}
          {list.map((s) => (
            <button key={s.id} type="button" className={`k-tile ${s.presence === 'in' ? 'in' : ''}`} onClick={() => toggle(s)}>
              <span className="k-avatar" style={{ width: 56, height: 56, fontSize: 18 }}>{initials(s.name)}</span>
              <span style={{ fontSize: 16, fontWeight: 700 }}>{s.name}</span>
              <span className={`k-tag ${s.presence === 'in' ? 'in' : ''}`}>
                {s.presence === 'in' ? `In${s.presence_at ? ` · since ${fmtTime(s.presence_at)}` : ''}` : 'Out'}
              </span>
            </button>
          ))}
        </div>
      </div>
      <div className="k-foot">
        <button type="button" className="k-btn" onClick={onDone}>Back to home</button>
        <button type="button" className="k-btn" style={{ background: '#B91C1C', borderColor: '#B91C1C', color: '#fff' }} onClick={onRollCall}><IconWarn /> Emergency roll call</button>
      </div>
    </>
  );
}
