import { useCallback, useEffect, useState } from 'react';
import { api, fmtDateTime } from '../api.js';
import { Modal, useFlash } from './AdminApp.jsx';

export default function Tablets() {
  const [rows, setRows] = useState(null);
  const [types, setTypes] = useState([]);
  const [adding, setAdding] = useState(null);
  const [code, setCode] = useState(null);
  const [links, setLinks] = useState(null);
  const [flash, setFlash] = useFlash();

  const load = useCallback(async () => {
    try {
      const [k, t, l] = await Promise.all([api('/api/admin/kiosks'), api('/api/admin/visitor-types'), api('/api/admin/links')]);
      setRows(k);
      setLinks(l);
      setTypes(t.filter((x) => x.active));
    } catch (e) {
      setFlash(e.message, 'bad');
    }
  }, [setFlash]);
  useEffect(() => { load(); }, [load]);
  // Refresh while a pairing code is showing, so "Paired" appears as soon as the iPad connects.
  useEffect(() => {
    if (!code) return undefined;
    const t = setInterval(async () => {
      const k = await api('/api/admin/kiosks');
      setRows(k);
      if (k.find((x) => x.id === code.id)?.paired) setCode((c) => ({ ...c, paired: true }));
    }, 3000);
    return () => clearInterval(t);
  }, [code]);

  const add = async (e) => {
    e.preventDefault();
    try {
      const k = await api('/api/admin/kiosks', { method: 'POST', body: adding });
      setAdding(null);
      setCode(k);
      load();
    } catch (err) {
      setAdding({ ...adding, error: err.message });
    }
  };
  const repair = async (k) => {
    if (k.paired && !window.confirm(`Make a new pairing code for ${k.name}? The iPad currently paired will be signed out until you enter the new code on it.`)) return;
    setCode(await api(`/api/admin/kiosks/${k.id}/pair`, { method: 'POST', body: {} }));
    load();
  };
  const remove = async (k) => {
    if (!window.confirm(`Remove ${k.name}? It will stop working until it is added and paired again.`)) return;
    await api(`/api/admin/kiosks/${k.id}`, { method: 'DELETE' });
    load();
  };
  const setDefault = async (k, defaultType) => {
    await api(`/api/admin/kiosks/${k.id}`, { method: 'PUT', body: { name: k.name, defaultType } });
    setFlash(`${k.name} will now open to ${types.find((t) => t.key === defaultType)?.name || 'the first visit type'}.`);
    load();
  };

  const url = links?.kiosk || '…';
  return (
    <>
      <div className="a-head">
        <div><h1>Tablets</h1><p>The reception iPads visitors sign in on.</p></div>
        <div className="a-actions"><button type="button" className="a-btn primary" onClick={() => setAdding({ name: '', defaultType: '' })}>+ Add tablet</button></div>
      </div>
      {flash}
      <section className="a-card">
        <div className="a-table-wrap">
          <table className="a-table">
            <thead><tr><th>Tablet</th><th>Status</th><th>Opens to</th><th>Last seen</th><th className="r"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {(rows || []).map((k) => (
                <tr key={k.id}>
                  <td><strong>{k.name}</strong></td>
                  <td>{k.paired ? <span className="badge ok">Paired</span> : k.pairing_code ? <span className="badge warn">Waiting for code</span> : <span className="badge">Not paired</span>}</td>
                  <td>
                    <select className="a-select" style={{ height: 34, width: 'auto' }} aria-label={`${k.name} opens to`} value={k.default_type || ''} onChange={(e) => setDefault(k, e.target.value)}>
                      <option value="">First visit type</option>
                      {types.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}
                    </select>
                  </td>
                  <td>{k.last_seen_at ? fmtDateTime(k.last_seen_at) : <span className="muted">Never</span>}</td>
                  <td className="r"><div className="a-row" style={{ justifyContent: 'flex-end' }}>
                    <button type="button" className="a-btn sm" onClick={() => repair(k)}>{k.paired ? 'Re-pair' : 'Show code'}</button>
                    <button type="button" className="a-btn sm danger" onClick={() => remove(k)}>Remove</button>
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows && !rows.length && <div className="a-empty">No tablets yet. Add one for each iPad at reception.</div>}
        </div>
      </section>
      <section className="a-card">
        <h2>Setting up an iPad</h2>
        <ol className="steps-list">
          <li>On the iPad, open Safari and go to <strong>{url}</strong></li>
          <li>Tap <strong>Share › Add to Home Screen</strong>, then open the new “Sign In” icon. It runs full screen with no Safari bars.</li>
          <li>Here, click <strong>Add tablet</strong> and type the 6-digit code it shows into the iPad.</li>
          <li>Lock it to the app: <strong>Settings › Accessibility › Guided Access</strong> on, then open the app and triple-click the top (or side) button to start Guided Access.</li>
          <li>Set <strong>Settings › Display &amp; Brightness › Auto-Lock</strong> to Never and keep it on power.</li>
        </ol>
        <p className="sub">The iPad only keeps working offline when the app is opened over HTTPS (for example https://visitors.yourcompany.co.nz).</p>
      </section>

      {adding && (
        <Modal title="Add a tablet" onClose={() => setAdding(null)}>
          <form onSubmit={add} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <label className="a-field">Name<input className="a-input" placeholder="e.g. Tablet 1 · Main entrance" value={adding.name} onChange={(e) => setAdding({ ...adding, name: e.target.value })} required /></label>
            <label className="a-field">Opens to <span className="hint">The visit type already selected when someone taps Sign In</span>
              <select className="a-select" value={adding.defaultType} onChange={(e) => setAdding({ ...adding, defaultType: e.target.value })}>
                <option value="">First visit type</option>
                {types.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}
              </select>
            </label>
            {adding.error && <div className="a-msg bad">{adding.error}</div>}
            <div className="a-row" style={{ justifyContent: 'flex-end' }}><button type="button" className="a-btn" onClick={() => setAdding(null)}>Cancel</button><button type="submit" className="a-btn primary">Add and show code</button></div>
          </form>
        </Modal>
      )}
      {code && (
        <Modal title={`Pair ${code.name}`} onClose={() => setCode(null)}>
          {code.paired ? (
            <div className="a-msg ok">Paired. The iPad is ready to sign visitors in.</div>
          ) : (
            <>
              <p className="sub">On the iPad, open <strong>{url}</strong> and enter this code. It works for 30 minutes.</p>
              <div className="code-box" aria-label={`Pairing code ${code.pairing_code.split('').join(' ')}`}>{code.pairing_code}</div>
              <p className="sub">This window updates by itself once the iPad is paired.</p>
            </>
          )}
          <div className="a-row" style={{ justifyContent: 'flex-end' }}><button type="button" className="a-btn primary" onClick={() => setCode(null)}>Done</button></div>
        </Modal>
      )}
    </>
  );
}
