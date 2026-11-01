import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, fmtTime } from '../api.js';
import { useFlash } from './AdminApp.jsx';

const typeBadge = (key) => ({ visitor: 'blue', contractor: 'warn', interview: 'purple' }[key] || '');

export default function Dashboard() {
  const [d, setD] = useState(null);
  const [flash, setFlash] = useFlash();
  const [rc, setRc] = useState(null);
  const load = useCallback(() => {
    api('/api/rollcall/state').then((s) => setRc(s.active)).catch(() => {});
    return api('/api/admin/dashboard').then(setD).catch((e) => setFlash(e.message, 'bad'));
  }, [setFlash]);
  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  const signOut = async (v) => {
    try {
      await api(`/api/admin/visits/${v.id}/signout`, { method: 'POST', body: {} });
      setFlash(`${v.name} signed out.`);
      load();
    } catch (e) {
      setFlash(e.message, 'bad');
    }
  };

  const today = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const stale = (k) => !k.last_seen_at || Date.now() - new Date(k.last_seen_at).getTime() > 10 * 60_000;

  return (
    <>
      <div className="a-head">
        <div>
          <h1>{greet}</h1>
          <p>{new Date().toLocaleDateString('en-NZ', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
        </div>
        <div className="a-actions">
          <a className="a-btn" href={`/api/admin/visits.csv?from=${today}&to=${today}`}>Export today’s CSV</a>
        </div>
      </div>
      {flash}
      {rc && (
        <a href="/rollcall" target="_blank" rel="noreferrer" className="a-msg bad" style={{ display: 'block', textDecoration: 'none' }}>
          Roll call in progress: {rc.entries.filter((e) => e.status === 'safe').length} of {rc.entries.length} marked safe. Started {fmtTime(rc.startedAt)} by {rc.startedBy}. Open it ↗
        </a>
      )}
      {!d ? <p>Loading…</p> : (
        <>
          {d.failedEmails.length > 0 && (
            <div className="a-msg bad">
              {d.failedEmails.length} host email{d.failedEmails.length > 1 ? 's' : ''} couldn’t be sent. Latest error: {d.failedEmails[0].last_error}.{' '}
              <Link to="/admin/settings/email">Check email settings</Link>
            </div>
          )}
          <div className="a-tiles">
            <div className="a-tile"><span className="k">Visitors on site now</span><span className="v">{d.onsite.length}</span>
              <span className="s">{(() => { const c = d.onsite.filter((v) => v.type_key === 'contractor').length; return `${c} contractor${c === 1 ? '' : 's'}`; })()}</span></div>
            <div className="a-tile"><span className="k">Sign-ins today</span><span className="v">{d.today.n}</span><span className="s">since midnight</span></div>
            <div className="a-tile"><span className="k">Staff in</span><span className="v">{d.staffIn}</span><span className="s">signed in on the tablet or here</span></div>
            <div className="a-tile"><span className="k">Safety flags today</span><span className="v" style={{ color: d.today.flagged ? '#B45309' : undefined }}>{d.today.flagged}</span>
              <span className="s">answers that need a check</span></div>
          </div>

          <section className="a-card">
            <h2>Who’s on site</h2>
            <div className="a-table-wrap">
              <table className="a-table">
                <thead><tr><th>Name</th><th>Type</th><th>Visiting</th><th>Signed in</th><th>H&amp;S</th><th className="r"><span className="sr-only">Action</span></th></tr></thead>
                <tbody>
                  {d.onsite.map((v) => (
                    <tr key={v.id}>
                      <td><strong>{v.name}</strong>{v.company && <div className="muted">{v.company}</div>}</td>
                      <td><span className={`badge ${typeBadge(v.type_key)}`}>{v.type}</span></td>
                      <td>{v.host_name || <span className="muted">No host</span>}</td>
                      <td>{fmtTime(v.signed_in_at)}</td>
                      <td>{v.flagged ? <span className="badge warn">Flagged</span> : <span className="badge ok">OK</span>}</td>
                      <td className="r"><button type="button" className="a-btn sm" onClick={() => signOut(v)}>Sign out</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!d.onsite.length && <div className="a-empty">No visitors are signed in right now.</div>}
            </div>
          </section>

          <StaffOnSite d={d} reload={load} setFlash={setFlash} />

          <section className="a-card">
            <h2>Tablets</h2>
            {!d.kiosks.length ? (
              <p className="sub">No tablets yet. <Link to="/admin/tablets">Add your reception tablets</Link> to start signing visitors in.</p>
            ) : (
              <div className="a-grid2">
                {d.kiosks.map((k) => (
                  <div key={k.id} className="a-toggle-row">
                    <span>{k.name}</span>
                    {!k.paired ? <span className="badge">Not paired</span>
                      : stale(k) ? <span className="badge warn">Offline · last seen {k.last_seen_at ? fmtTime(k.last_seen_at) : 'never'}</span>
                        : <span className="badge ok">Online</span>}
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}

function StaffOnSite({ d, reload, setFlash }) {
  const [all, setAll] = useState([]);
  const [pick, setPick] = useState('');
  useEffect(() => { api('/api/admin/staff').then(setAll).catch(() => {}); }, [d.staffIn]);
  const set = async (id, presence, name) => {
    try {
      await api(`/api/admin/staff/${id}`, { method: 'PATCH', body: { presence } });
      setFlash(`${name} signed ${presence}.`);
      setPick('');
      reload();
    } catch (e) {
      setFlash(e.message, 'bad');
    }
  };
  const out = all.filter((s) => s.presence !== 'in');
  return (
    <section className="a-card">
      <div className="a-row" style={{ justifyContent: 'space-between' }}>
        <h2>Staff on site ({d.staffInList.length})</h2>
        <form className="a-row" onSubmit={(e) => { e.preventDefault(); const s = out.find((x) => String(x.id) === pick); if (s) set(s.id, 'in', s.name); }}>
          <select className="a-select" style={{ width: 240 }} aria-label="Team member to sign in" value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">Choose a team member…</option>
            {out.map((s) => <option key={s.id} value={s.id}>{s.name}{s.team ? ` · ${s.team}` : ''}</option>)}
          </select>
          <button type="submit" className="a-btn primary" disabled={!pick}>Sign in</button>
        </form>
      </div>
      {d.staffInList.length ? (
        <div className="a-grid2">
          {d.staffInList.map((s) => (
            <div key={s.id} className="a-toggle-row">
              <span><strong>{s.name}</strong> <span className="muted">{s.team ? `${s.team} · ` : ''}in since {fmtTime(s.presence_at)}</span></span>
              <button type="button" className="a-btn sm" onClick={() => set(s.id, 'out', s.name)}>Sign out</button>
            </div>
          ))}
        </div>
      ) : <p className="sub">No staff are signed in. Staff sign in on the reception iPad (Staff in / out), or sign someone in here.</p>}
    </section>
  );
}
