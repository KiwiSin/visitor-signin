import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, fmtDateTime, fmtTime } from '../api.js';
import { Modal, useFlash } from './AdminApp.jsx';

export default function RollCalls() {
  const [rows, setRows] = useState(null);
  const [open, setOpen] = useState(null);
  const [flash, setFlash] = useFlash();
  const load = useCallback(() => api('/api/admin/rollcalls').then(setRows).catch((e) => setFlash(e.message, 'bad')), [setFlash]);
  useEffect(() => {
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [load]);

  const view = async (id) => {
    try {
      setOpen(await api(`/api/admin/rollcalls/${id}`));
    } catch (e) {
      setFlash(e.message, 'bad');
    }
  };

  return (
    <>
      <div className="a-head">
        <div><h1>Roll calls</h1><p>Every evacuation and drill, with who was marked safe, by whom and when. Kept for 7 years.</p></div>
        <div className="a-actions"><a className="a-btn danger" href="/rollcall" target="_blank" rel="noreferrer">Open roll call ↗</a></div>
      </div>
      {flash}
      <section className="a-card">
        <div className="a-table-wrap">
          <table className="a-table">
            <thead><tr><th>Started</th><th>Started by</th><th>Ended</th><th>Accounted for</th><th className="r"><span className="sr-only">Report</span></th></tr></thead>
            <tbody>
              {(rows || []).map((r) => (
                <tr key={r.id}>
                  <td>{fmtDateTime(r.started_at)}</td>
                  <td>{r.started_by}</td>
                  <td>{r.ended_at ? <>{fmtTime(r.ended_at)} <span className="muted">by {r.ended_by}</span></> : <span className="badge bad">In progress</span>}</td>
                  <td><span className={`badge ${r.safe === r.total ? 'ok' : 'warn'}`}>{r.safe} of {r.total} safe</span></td>
                  <td className="r"><div className="a-row" style={{ justifyContent: 'flex-end' }}>
                    <button type="button" className="a-btn sm" onClick={() => view(r.id)}>View</button>
                    <a className="a-btn sm" href={`/api/admin/rollcalls/${r.id}/csv`}>CSV</a>
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows && !rows.length && <div className="a-empty">No roll calls yet. Run a drill to check everything works.</div>}
        </div>
      </section>
      <section className="a-card">
        <h2>How wardens get the roll call</h2>
        <ol className="steps-list">
          <li>In <Link to="/admin/staff">Staff &amp; teams</Link>, edit each fire warden and click <strong>Roll call link</strong>. Email it to them or copy it.</li>
          <li>They open the link on their phone and add it to the home screen.</li>
          <li>It keeps a copy of who is on site, so it works at the assembly point without Wi-Fi. Wardens should open it as they leave the building.</li>
          <li>A roll call can also be started from the reception iPad (Staff in / out › Emergency roll call) or from here.</li>
        </ol>
      </section>
      {open && (
        <Modal title={`Roll call · ${fmtDateTime(open.startedAt)}`} onClose={() => setOpen(null)}>
          <p className="sub">Started by {open.startedBy}. {open.endedAt ? `Ended ${fmtDateTime(open.endedAt)} by ${open.endedBy}.` : 'Still in progress.'}</p>
          <div className="a-table-wrap">
            <table className="a-table" style={{ minWidth: 0 }}>
              <thead><tr><th>Name</th><th>Status</th><th>Marked by</th></tr></thead>
              <tbody>
                {[...open.entries].sort((a, b) => (a.status === b.status ? a.name.localeCompare(b.name) : a.status === 'safe' ? 1 : -1)).map((e) => (
                  <tr key={e.personKey}>
                    <td><strong>{e.name}</strong><div className="muted">{e.detail}{e.mobile ? ` · ${e.mobile}` : ''}</div></td>
                    <td>{e.status === 'safe' ? <span className="badge ok">Safe</span> : <span className="badge bad">Not accounted for</span>}</td>
                    <td>{e.markedBy ? <>{e.markedBy}<div className="muted">{fmtTime(e.markedAt)}</div></> : <span className="muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="a-row" style={{ justifyContent: 'flex-end' }}>
            <a className="a-btn" href={`/api/admin/rollcalls/${open.id}/csv`}>Download CSV</a>
            <button type="button" className="a-btn primary" onClick={() => setOpen(null)}>Close</button>
          </div>
        </Modal>
      )}
    </>
  );
}
