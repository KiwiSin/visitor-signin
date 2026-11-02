import { apiUrl } from '../tenant.js';
import { useCallback, useEffect, useState } from 'react';
import { api, fmtDateTime, fmtTime } from '../api.js';
import { Modal, useFlash } from './AdminApp.jsx';

const iso = (d) => d.toLocaleDateString('en-CA');

export default function Visits() {
  const [from, setFrom] = useState(() => iso(new Date(Date.now() - 6 * 864e5)));
  const [to, setTo] = useState(() => iso(new Date()));
  const [q, setQ] = useState('');
  const [rows, setRows] = useState(null);
  const [open, setOpen] = useState(null);
  const [flash, setFlash] = useFlash();

  const params = new URLSearchParams({ from, to, q }).toString();
  const load = useCallback(() => api(`/api/admin/visits?${params}`).then(setRows).catch((e) => setFlash(e.message, 'bad')), [params, setFlash]);
  useEffect(() => { load(); }, [load]);

  const signOut = async (v) => {
    try {
      await api(`/api/admin/visits/${v.id}/signout`, { method: 'POST', body: {} });
      setOpen(null);
      load();
    } catch (e) {
      setFlash(e.message, 'bad');
    }
  };

  return (
    <>
      <div className="a-head">
        <div><h1>Visitor log</h1><p>Every sign-in, newest first. Records are deleted automatically after the retention period in Settings.</p></div>
        <div className="a-actions"><a className="a-btn" href={apiUrl(`/api/admin/visits.csv?${params}`)}>Export CSV</a></div>
      </div>
      {flash}
      <div className="a-card">
        <div className="a-row">
          <label className="a-field">From<input className="a-input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="a-field">To<input className="a-input" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          <label className="a-field" style={{ flex: 1, minWidth: 220 }}>Search<input className="a-input" type="search" placeholder="Name, company or host" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        </div>
        <div className="a-table-wrap">
          <table className="a-table">
            <thead><tr><th>Signed in</th><th>Name</th><th>Type</th><th>Visiting</th><th>Signed out</th><th>H&amp;S</th></tr></thead>
            <tbody>
              {(rows || []).map((v) => (
                <tr key={v.id} onClick={() => setOpen(v)} style={{ cursor: 'pointer' }}>
                  <td>{fmtDateTime(v.signed_in_at)}</td>
                  <td><strong>{v.name || 'Removed'}</strong>{v.company && <div className="muted">{v.company}</div>}</td>
                  <td>{v.type}</td>
                  <td>{v.host_name || <span className="muted">No host</span>}</td>
                  <td>{v.signed_out_at ? fmtTime(v.signed_out_at) : <span className="badge ok">On site</span>}</td>
                  <td>{v.flagged ? <span className="badge warn">Flagged</span> : v.agreed_hs ? <span className="badge ok">Agreed</span> : <span className="muted">Not required</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows && !rows.length && <div className="a-empty">No sign-ins in this period.</div>}
        </div>
      </div>
      {open && (
        <Modal title={open.name || 'Visit'} onClose={() => setOpen(null)}>
          <div className="a-grid2" style={{ fontSize: 14, gap: 10 }}>
            <div><div className="muted">Company</div>{open.company || '—'}</div>
            <div><div className="muted">Mobile</div>{open.mobile || '—'}</div>
            <div><div className="muted">Email</div>{open.email || '—'}</div>
            <div><div className="muted">Type</div>{open.type}</div>
            <div><div className="muted">Visiting</div>{open.host_name || 'No host'}</div>
            <div><div className="muted">Tablet</div>{open.kiosk || '—'}</div>
            <div><div className="muted">Signed in</div>{fmtDateTime(open.signed_in_at)}</div>
            <div><div className="muted">Signed out</div>{open.signed_out_at ? `${fmtDateTime(open.signed_out_at)} (${open.signed_out_by})` : 'Still on site'}</div>
            {open.extra?.rego && <div><div className="muted">Vehicle</div>{open.extra.rego}</div>}
            {open.extra?.inductionNo && <div><div className="muted">Induction card</div>{open.extra.inductionNo}</div>}
          </div>
          {open.answers?.length > 0 && (
            <div style={{ fontSize: 14 }}>
              <div className="muted" style={{ marginBottom: 6 }}>Safety answers (H&amp;S version {open.hs_version})</div>
              {open.answers.map((a) => (
                <div key={a.questionId} className="a-toggle-row" style={{ marginBottom: 6 }}>
                  <span>{a.question}</span>
                  <span className={`badge ${a.flagged ? 'warn' : 'ok'}`}>{a.answer === 'yes' ? 'Yes' : 'No'}</span>
                </div>
              ))}
            </div>
          )}
          {open.has_signature && (
            <div>
              <div className="muted" style={{ fontSize: 14, marginBottom: 6 }}>Signature</div>
              <img src={apiUrl(`/api/admin/visits/${open.id}/signature`)} alt={`Signature of ${open.name}`} style={{ width: '100%', border: '1px solid var(--line)', borderRadius: 10 }} />
            </div>
          )}
          <div className="a-row" style={{ justifyContent: 'flex-end' }}>
            {!open.signed_out_at && <button type="button" className="a-btn" onClick={() => signOut(open)}>Sign out now</button>}
            <button type="button" className="a-btn primary" onClick={() => setOpen(null)}>Close</button>
          </div>
        </Modal>
      )}
    </>
  );
}
