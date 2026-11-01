import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError, fmtTime } from '../api.js';
import { IconWarn, IconWifiOff } from '../icons.jsx';

const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* full */ } };

const IconPhone = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A17 17 0 0 1 3 5a2 2 0 0 1 2-2z" />
  </svg>
);

/**
 * Emergency roll call. Works offline: the list of who is on site is kept on the device,
 * ticks are saved locally and sent to the server whenever there is a connection.
 *
 * headers: extra request headers (warden key or kiosk token)
 * storageKey: separates the saved copy per kind of device
 * onExit: show a "Close" button (used on the reception tablet)
 */
export default function RollCall({ headers = {}, storageKey = 'vs_rc', onExit }) {
  const K = { cache: `${storageKey}_cache`, local: `${storageKey}_local`, pending: `${storageKey}_pending` };
  const [cache, setCache] = useState(() => load(K.cache, null));      // { people, me, fetchedAt }
  const [local, setLocal] = useState(() => load(K.local, null));      // the roll call on this device
  const [pending, setPending] = useState(() => load(K.pending, {}));  // ticks not yet on the server
  const [online, setOnline] = useState(true);
  const [error, setError] = useState('');
  const [noAccess, setNoAccess] = useState(false);
  const [tab, setTab] = useState('missing');
  const [q, setQ] = useState('');
  const [summary, setSummary] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const syncing = useRef(false);
  const latest = useRef({ local, pending });
  latest.current = { local, pending };

  const setLocalS = (v) => { setLocal(v); save(K.local, v); latest.current.local = v; };
  const setPendingS = (v) => { setPending(v); save(K.pending, v); latest.current.pending = v; };

  const call = useCallback((path, opts = {}) => api(path, { ...opts, headers }), [headers]);

  const fromServer = (rc, prev) => ({
    serverId: rc.id,
    clientId: rc.clientId,
    startedAt: rc.startedAt,
    startedBy: rc.startedBy,
    ended: !!rc.endedAt,
    endedAt: rc.endedAt,
    endedBy: rc.endedBy,
    synced: true,
    entries: Object.fromEntries(rc.entries.map((e) => [e.personKey, e])),
    ...(prev?.endPending ? { endPending: true } : {}),
  });

  /** Send this device's roll call (start, ticks, end) to the server and take back the merged result. */
  const sync = useCallback(async () => {
    const { local: l, pending: p } = latest.current;
    if (!l || syncing.current) return null;
    syncing.current = true;
    const sent = { ...p };
    try {
      const rc = await call('/api/rollcall/sync', {
        method: 'POST',
        body: {
          clientId: l.clientId, startedAt: l.startedAt, startedBy: l.startedBy,
          marks: Object.values(sent), ended: !!l.endPending, endedAt: l.endedAt,
        },
      });
      // Keep any tick made while this request was on its way.
      const still = { ...latest.current.pending };
      for (const [key, m] of Object.entries(sent)) if (still[key]?.at === m.at) delete still[key];
      setPendingS(still);
      const next = fromServer(rc, null);
      for (const m of Object.values(still)) {
        if (next.entries[m.personKey]) next.entries[m.personKey] = { ...next.entries[m.personKey], status: m.status, markedBy: m.by, markedAt: m.at };
        else next.entries[m.personKey] = { ...m, markedBy: m.by, markedAt: m.at };
      }
      setOnline(true);
      if (next.ended) {
        setSummary(next);
        setLocalS(null);
      } else {
        setLocalS(next);
      }
      return next;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setNoAccess(true);
      else if (err.status === 0 || err.status >= 500) setOnline(false);
      else setError(err.message);
      return null;
    } finally {
      syncing.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [call]);

  /** Fetch who is on site and whether a roll call is running. */
  const refresh = useCallback(async () => {
    try {
      const s = await call('/api/rollcall/state');
      const c = { people: s.people, me: s.me, fetchedAt: s.serverTime };
      setCache(c);
      save(K.cache, c);
      setOnline(true);
      setNoAccess(false);
      const { local: l, pending: p } = latest.current;
      if (l && (!l.synced || l.endPending || Object.keys(p).length)) {
        await sync();
      } else if (s.active) {
        setLocalS(fromServer(s.active, l));
      } else if (l) {
        // Ended on another device (or closed automatically).
        if (s.lastEnded && s.lastEnded.id === l.serverId) setSummary({ ...l, ended: true, endedAt: s.lastEnded.endedAt, endedBy: s.lastEnded.endedBy });
        setLocalS(null);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setNoAccess(true);
      else setOnline(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [call, sync]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, local ? 10_000 : 30_000);
    const wake = () => document.visibilityState === 'visible' && refresh();
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', wake);
    return () => { clearInterval(t); window.removeEventListener('online', refresh); document.removeEventListener('visibilitychange', wake); };
  }, [refresh, !!local]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the phone screen on while a roll call is running (where supported).
  useEffect(() => {
    if (!local || !navigator.wakeLock) return undefined;
    let lock;
    navigator.wakeLock.request('screen').then((l) => { lock = l; }).catch(() => {});
    return () => { lock?.release().catch(() => {}); };
  }, [!!local]); // eslint-disable-line react-hooks/exhaustive-deps

  const me = cache?.me?.name || 'Warden';

  const start = () => {
    setConfirm(null);
    setSummary(null);
    const people = cache?.people || [];
    setLocalS({
      clientId: uuid(), startedAt: new Date().toISOString(), startedBy: me, synced: false, ended: false,
      entries: Object.fromEntries(people.map((p) => [p.personKey, { ...p, status: 'missing' }])),
    });
    setTab('missing');
    sync();
  };

  const mark = (entry, status) => {
    const at = new Date().toISOString();
    const l = latest.current.local;
    setLocalS({ ...l, entries: { ...l.entries, [entry.personKey]: { ...entry, status, markedBy: me, markedAt: at } } });
    setPendingS({
      ...latest.current.pending,
      [entry.personKey]: { personKey: entry.personKey, status, at, by: me, name: entry.name, detail: entry.detail, mobile: entry.mobile, kind: entry.kind },
    });
    sync();
  };

  const addPerson = () => {
    const name = window.prompt('Name of the person (found at the assembly point but not on the list):');
    if (!name?.trim()) return;
    mark({ personKey: `extra:${uuid()}`, kind: 'extra', name: name.trim(), detail: `Added by ${me}`, mobile: null }, 'safe');
  };

  const end = async () => {
    setConfirm(null);
    const l = latest.current.local;
    // If offline, it stays on this device marked "ending" and is sent when the connection is back.
    setLocalS({ ...l, endPending: true, endedAt: new Date().toISOString(), endedBy: me });
    await sync();
  };

  const entries = useMemo(() => Object.values(local?.entries || {}).sort((a, b) => a.name.localeCompare(b.name)), [local]);
  const safe = entries.filter((e) => e.status === 'safe').length;
  const missing = entries.length - safe;
  const shown = entries.filter((e) => (tab === 'all' || (tab === 'safe' ? e.status === 'safe' : e.status !== 'safe'))
    && (!q || e.name.toLowerCase().includes(q.toLowerCase())));
  const pendingCount = Object.keys(pending).length + (local && (!local.synced || local.endPending) ? 1 : 0);

  if (noAccess && !local) {
    return (
      <div className="rc rc-plain">
        <div className="rc-body" style={{ justifyContent: 'center' }}>
          <img src="/logo.svg" alt="Visitor Sign-In" style={{ height: 40, alignSelf: 'flex-start' }} />
          <h1 style={{ fontSize: 24 }}>Roll call</h1>
          <p>Open this page from your personal warden link (ask your admin to send it from Admin › Staff), or <a href="/admin">sign in to Admin</a> first.</p>
        </div>
      </div>
    );
  }

  const offlineBar = (!online || pendingCount > 0) && (
    <div className="rc-offline" role="status">
      <IconWifiOff />
      <span>
        {!online ? <><strong>Offline.</strong> Using the list from {cache?.fetchedAt ? fmtTime(cache.fetchedAt) : 'earlier'}. </> : null}
        {pendingCount > 0 ? `${pendingCount} change${pendingCount > 1 ? 's' : ''} waiting to send.` : 'Ticks are saved on this device.'}
      </span>
    </div>
  );

  // ----------------------------------------------------------- finished
  if ((!local && summary) || local?.endPending) {
    const done = local?.endPending ? { ...local, offline: true } : summary;
    const list = Object.values(done.entries || {});
    const sCount = list.filter((e) => e.status === 'safe').length;
    const notFound = list.filter((e) => e.status !== 'safe');
    return (
      <div className="rc rc-plain">
        <div className="rc-body">
          <h1 style={{ fontSize: 24 }}>Roll call ended</h1>
          <p>{done.endedBy ? `Ended by ${done.endedBy}` : 'Ended'}{done.endedAt ? ` at ${fmtTime(done.endedAt)}` : ''}. <strong>{sCount} of {list.length}</strong> marked safe.</p>
          {done.offline && <div className="rc-offline"><IconWifiOff /><span>Saved on this phone. The report reaches Admin when you’re back online.</span></div>}
          {notFound.length > 0 && (
            <div className="rc-card">
              <strong>Not marked safe ({notFound.length})</strong>
              {notFound.map((e) => <div key={e.personKey}>{e.name} <span className="rc-muted">{e.detail}</span></div>)}
            </div>
          )}
          <p className="rc-muted">The full report is in Admin › Roll calls.</p>
          <button type="button" className="rc-btn dark" disabled={!!local} onClick={() => setSummary(null)}>Done</button>
          {onExit && <button type="button" className="rc-btn" onClick={onExit}>Close</button>}
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------- idle
  if (!local) {
    const people = cache?.people || [];
    return (
      <div className="rc rc-plain">
        <div className="rc-head calm">
          <span className="rc-kicker">EMERGENCY</span>
          <span className="rc-title">Roll call</span>
          <span className="rc-sub">Signed in as {me}</span>
        </div>
        {offlineBar}
        <div className="rc-body">
          <div className="rc-card">
            <span style={{ fontSize: 28, fontWeight: 800 }}>{people.length} <span className="rc-muted" style={{ fontSize: 16 }}>on site now</span></span>
            <span className="rc-muted">{people.filter((p) => p.kind === 'visitor').length} visitors and contractors, {people.filter((p) => p.kind === 'staff').length} staff marked in.
              {cache?.fetchedAt ? ` List updated ${fmtTime(cache.fetchedAt)}.` : ''}</span>
          </div>
          <button type="button" className="rc-btn danger big" onClick={() => setConfirm('start')}>Start roll call</button>
          <p className="rc-muted">Starting tells the other wardens and reception by email. Everyone on site appears as “missing” until you tick them safe.</p>
          {people.length > 0 && (
            <div className="rc-card" style={{ gap: 6 }}>
              <strong>On site now</strong>
              {people.map((p) => <div key={p.personKey}>{p.name} <span className="rc-muted">· {p.detail}</span></div>)}
            </div>
          )}
          {onExit && <button type="button" className="rc-btn" onClick={onExit}>Close</button>}
        </div>
        {confirm === 'start' && (
          <Confirm title="Start the roll call?" body="Use this for a real evacuation or a drill. The wardens and reception will be emailed." yes="Start roll call" danger
            onYes={start} onNo={() => setConfirm(null)} />
        )}
      </div>
    );
  }

  // -------------------------------------------------------------- active
  return (
    <div className="rc">
      <div className="rc-head">
        <span className="rc-kicker"><IconWarn /> EVACUATION IN PROGRESS</span>
        <span className="rc-title">Roll call</span>
        <span className="rc-sub">Started {fmtTime(local.startedAt)} by {local.startedBy}</span>
      </div>
      {offlineBar}
      {error && <div className="rc-offline" style={{ background: '#FEE2E2', color: '#991B1B' }}>{error}</div>}
      <div className="rc-card rc-progress">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span style={{ fontSize: 28, fontWeight: 800 }}>{safe} <span className="rc-muted" style={{ fontSize: 16 }}>of {entries.length} safe</span></span>
          <span style={{ fontWeight: 700, color: missing ? '#B91C1C' : '#15803D' }}>{missing ? `${missing} missing` : 'Everyone accounted for'}</span>
        </div>
        <div className="rc-bar"><div style={{ width: `${entries.length ? Math.round((safe / entries.length) * 100) : 100}%` }} /></div>
      </div>
      <div className="rc-tabs" role="tablist">
        {[['missing', `Missing (${missing})`], ['safe', `Safe (${safe})`], ['all', 'All']].map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      <input className="rc-search" type="search" placeholder="Find a name…" aria-label="Find a name" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="rc-list">
        {shown.map((e) => (
          <div key={e.personKey} className="rc-row">
            <span className="grow">
              <span className="nm">{e.name}</span>
              <span className="dt">{e.detail}{e.status === 'safe' && e.markedBy ? ` · ticked by ${e.markedBy}` : ''}</span>
            </span>
            {e.mobile && <a className="rc-call" href={`tel:${e.mobile.replace(/[^\d+]/g, '')}`} aria-label={`Call ${e.name}`}><IconPhone /></a>}
            <button type="button" className={`rc-mark ${e.status === 'safe' ? 'safe' : ''}`} onClick={() => mark(e, e.status === 'safe' ? 'missing' : 'safe')}>
              {e.status === 'safe' ? 'Safe ✓' : 'Mark safe'}
            </button>
          </div>
        ))}
        {!shown.length && <p className="rc-muted" style={{ textAlign: 'center', padding: 16 }}>{tab === 'missing' && !q ? 'Everyone has been ticked safe.' : 'No one here.'}</p>}
        <button type="button" className="rc-btn" onClick={addPerson}>+ Add someone not on the list</button>
      </div>
      <div className="rc-foot">
        <button type="button" className="rc-btn dark" onClick={() => setConfirm('end')}>End roll call &amp; save report</button>
        {onExit && <button type="button" className="rc-btn" onClick={onExit}>Close (keeps running)</button>}
      </div>
      {confirm === 'end' && (
        <Confirm title="End the roll call?" body={missing ? `${missing} ${missing === 1 ? 'person is' : 'people are'} still not marked safe.` : 'Everyone is marked safe.'}
          yes="End and save report" onYes={end} onNo={() => setConfirm(null)} />
      )}
    </div>
  );
}

function Confirm({ title, body, yes, danger, onYes, onNo }) {
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onNo()}>
      <div className="modal" role="alertdialog" aria-modal="true" aria-label={title} style={{ width: 'min(420px, 100%)' }}>
        <h2>{title}</h2>
        <p>{body}</p>
        <button type="button" className={`rc-btn ${danger ? 'danger' : 'dark'}`} onClick={onYes}>{yes}</button>
        <button type="button" className="rc-btn" onClick={onNo}>Cancel</button>
      </div>
    </div>
  );
}
