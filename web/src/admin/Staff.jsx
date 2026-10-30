import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { Modal, Toggle, useFlash } from './AdminApp.jsx';

const blank = { name: '', email: '', mobile: '', teamId: '', role: 'staff', showOnKiosk: true };

export default function Staff() {
  const [staff, setStaff] = useState(null);
  const [teams, setTeams] = useState([]);
  const [team, setTeam] = useState('all');
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState(null);
  const [teamEdit, setTeamEdit] = useState(null);
  const [flash, setFlash] = useFlash();
  const fileRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const [s, t] = await Promise.all([api('/api/admin/staff'), api('/api/admin/teams')]);
      setStaff(s);
      setTeams(t);
    } catch (e) {
      setFlash(e.message, 'bad');
    }
  }, [setFlash]);
  useEffect(() => { load(); }, [load]);

  const saveStaff = async (e) => {
    e.preventDefault();
    try {
      const body = { ...edit, teamId: edit.teamId || null };
      if (edit.id) await api(`/api/admin/staff/${edit.id}`, { method: 'PUT', body });
      else await api('/api/admin/staff', { method: 'POST', body });
      setFlash(`${edit.name} saved.`);
      setEdit(null);
      load();
    } catch (err) {
      setEdit({ ...edit, error: err.message });
    }
  };

  const remove = async (s) => {
    if (!window.confirm(`Remove ${s.name}? They will no longer show on the tablets. Past visits keep their name.`)) return;
    await api(`/api/admin/staff/${s.id}`, { method: 'DELETE' });
    setEdit(null);
    load();
  };

  const setKiosk = async (s, on) => {
    setStaff((list) => list.map((x) => (x.id === s.id ? { ...x, show_on_kiosk: on } : x)));
    await api(`/api/admin/staff/${s.id}`, { method: 'PATCH', body: { showOnKiosk: on } }).catch((e) => setFlash(e.message, 'bad'));
  };

  const importCsv = async (file) => {
    if (!file) return;
    try {
      const csv = await file.text();
      const r = await api('/api/admin/staff/import', { method: 'POST', body: { csv } });
      setFlash(`Import done: ${r.added} added, ${r.updated} updated${r.skipped.length ? `, ${r.skipped.length} skipped (${r.skipped.slice(0, 3).join('; ')})` : ''}.`, r.skipped.length ? 'warn' : 'ok');
      load();
    } catch (e) {
      setFlash(e.message, 'bad');
    } finally {
      fileRef.current.value = '';
    }
  };

  const saveTeam = async (e) => {
    e.preventDefault();
    try {
      if (teamEdit.id) await api(`/api/admin/teams/${teamEdit.id}`, { method: 'PUT', body: teamEdit });
      else await api('/api/admin/teams', { method: 'POST', body: teamEdit });
      setTeamEdit(null);
      load();
    } catch (err) {
      setTeamEdit({ ...teamEdit, error: err.message });
    }
  };
  const removeTeam = async (t) => {
    if (!window.confirm(`Delete the team "${t.name}"? Its staff stay, without a team.`)) return;
    await api(`/api/admin/teams/${t.id}`, { method: 'DELETE' });
    setTeamEdit(null);
    if (String(team) === String(t.id)) setTeam('all');
    load();
  };

  const list = (staff || []).filter((s) => (team === 'all' || String(s.team_id) === String(team))
    && (!q || `${s.name} ${s.email || ''} ${s.team || ''}`.toLowerCase().includes(q.toLowerCase())));

  return (
    <>
      <div className="a-head">
        <div><h1>Staff &amp; teams</h1><p>Everyone visitors can choose as a host. {staff ? `${staff.length} staff · ${teams.length} teams` : ''}</p></div>
        <div className="a-actions">
          <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => importCsv(e.target.files[0])} />
          <a className="a-btn" href={`data:text/csv;charset=utf-8,${encodeURIComponent('name,email,team,mobile,role\nJane Wilson,jane.wilson@company.co.nz,Operations,021 123 4567,warden\n')}`} download="staff-template.csv">CSV template</a>
          <button type="button" className="a-btn" onClick={() => fileRef.current.click()}>Import CSV</button>
          <button type="button" className="a-btn primary" onClick={() => setEdit({ ...blank })}>+ Add staff member</button>
        </div>
      </div>
      {flash}
      <div className="a-split">
        <section className="a-card side">
          <div className="a-row" style={{ justifyContent: 'space-between' }}>
            <h2 style={{ fontSize: 16, fontWeight: 700 }}>Teams</h2>
            <button type="button" className="a-btn sm" onClick={() => setTeamEdit({ name: '', email: '' })}>+ Team</button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <button type="button" className={`a-btn ${team === 'all' ? 'primary' : ''}`} style={{ justifyContent: 'space-between', border: 'none' }} onClick={() => setTeam('all')}>
              <span>All staff</span><span>{staff?.length ?? ''}</span>
            </button>
            {teams.map((t) => (
              <div key={t.id} className="a-row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                <button type="button" className={`a-btn ${String(team) === String(t.id) ? 'primary' : ''}`} style={{ flex: 1, justifyContent: 'space-between', border: 'none' }} onClick={() => setTeam(t.id)}>
                  <span>{t.name}</span><span>{t.staff_count}</span>
                </button>
                <button type="button" className="a-btn sm" aria-label={`Edit team ${t.name}`} onClick={() => setTeamEdit(t)}>Edit</button>
              </div>
            ))}
          </div>
          <p className="sub">A team can have a shared mailbox. Visitors who choose someone with no email of their own alert the team mailbox instead.</p>
        </section>
        <section className="a-card main">
          <input className="a-input" type="search" aria-label="Search staff" placeholder="Search name, email or team…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 360 }} />
          <div className="a-table-wrap">
            <table className="a-table">
              <thead><tr><th>Name</th><th>Team</th><th>Role</th><th>Status</th><th>Show on tablet</th><th className="r"><span className="sr-only">Edit</span></th></tr></thead>
              <tbody>
                {list.map((s) => (
                  <tr key={s.id}>
                    <td><strong>{s.name}</strong><div className="muted">{s.email || 'No email: alerts go to their team or reception'}</div></td>
                    <td>{s.team || <span className="muted">—</span>}</td>
                    <td>{s.role === 'warden' ? <span className="badge warn">Fire warden</span> : 'Staff'}</td>
                    <td>{s.presence === 'in' ? <span className="badge ok">In</span> : <span className="badge">Out</span>}</td>
                    <td><Toggle on={s.show_on_kiosk} label={`Show ${s.name} on tablet`} onChange={(on) => setKiosk(s, on)} /></td>
                    <td className="r"><button type="button" className="a-btn sm" onClick={() => setEdit({ id: s.id, name: s.name, email: s.email || '', mobile: s.mobile || '', teamId: s.team_id || '', role: s.role, showOnKiosk: s.show_on_kiosk })}>Edit</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {staff && !list.length && <div className="a-empty">{staff.length ? 'No one matches.' : 'No staff yet. Add people one by one, or import a CSV with the columns name, email, team, mobile.'}</div>}
          </div>
        </section>
      </div>

      {edit && (
        <Modal title={edit.id ? `Edit ${edit.name}` : 'Add staff member'} onClose={() => setEdit(null)}>
          <form onSubmit={saveStaff} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <label className="a-field">Name<input className="a-input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} required /></label>
            <label className="a-field">Email <span className="hint">Where their visitor alerts go</span><input className="a-input" type="email" value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></label>
            <div className="a-grid2">
              <label className="a-field">Mobile<input className="a-input" value={edit.mobile} onChange={(e) => setEdit({ ...edit, mobile: e.target.value })} /></label>
              <label className="a-field">Team
                <select className="a-select" value={edit.teamId} onChange={(e) => setEdit({ ...edit, teamId: e.target.value })}>
                  <option value="">No team</option>
                  {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </label>
            </div>
            <label className="a-field">Role
              <select className="a-select" value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value })}>
                <option value="staff">Staff</option>
                <option value="warden">Fire warden</option>
              </select>
            </label>
            <div className="a-toggle-row"><span>Show on the tablet as someone visitors can choose</span><Toggle on={edit.showOnKiosk} label="Show on tablet" onChange={(on) => setEdit({ ...edit, showOnKiosk: on })} /></div>
            {edit.error && <div className="a-msg bad">{edit.error}</div>}
            <div className="a-row" style={{ justifyContent: 'space-between' }}>
              {edit.id ? <button type="button" className="a-btn danger" onClick={() => remove(edit)}>Remove</button> : <span />}
              <div className="a-row"><button type="button" className="a-btn" onClick={() => setEdit(null)}>Cancel</button><button type="submit" className="a-btn primary">Save</button></div>
            </div>
          </form>
        </Modal>
      )}
      {teamEdit && (
        <Modal title={teamEdit.id ? `Edit ${teamEdit.name}` : 'Add team'} onClose={() => setTeamEdit(null)}>
          <form onSubmit={saveTeam} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <label className="a-field">Team name<input className="a-input" value={teamEdit.name} onChange={(e) => setTeamEdit({ ...teamEdit, name: e.target.value })} required /></label>
            <label className="a-field">Team mailbox <span className="hint">Optional, e.g. warehouse@company.co.nz</span><input className="a-input" type="email" value={teamEdit.email || ''} onChange={(e) => setTeamEdit({ ...teamEdit, email: e.target.value })} /></label>
            {teamEdit.error && <div className="a-msg bad">{teamEdit.error}</div>}
            <div className="a-row" style={{ justifyContent: 'space-between' }}>
              {teamEdit.id ? <button type="button" className="a-btn danger" onClick={() => removeTeam(teamEdit)}>Delete team</button> : <span />}
              <div className="a-row"><button type="button" className="a-btn" onClick={() => setTeamEdit(null)}>Cancel</button><button type="submit" className="a-btn primary">Save</button></div>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
