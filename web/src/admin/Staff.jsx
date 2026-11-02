import { useCallback, useEffect, useRef, useState } from 'react';
import { api, fmtDateTime, fmtTime } from '../api.js';
import { Modal, Toggle, useFlash } from './AdminApp.jsx';

const blank = { name: '', email: '', mobile: '', teamId: '', groupIds: [], showOnKiosk: true };

export default function Staff() {
  const [staff, setStaff] = useState(null);
  const [teams, setTeams] = useState([]);
  const [team, setTeam] = useState('all');
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState(null);
  const [teamEdit, setTeamEdit] = useState(null);
  const [groups, setGroups] = useState([]);
  const [groupEdit, setGroupEdit] = useState(null);
  const [flash, setFlash] = useFlash();
  const fileRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const [s, t, g] = await Promise.all([api('/api/admin/staff'), api('/api/admin/teams'), api('/api/admin/groups')]);
      setStaff(s);
      setTeams(t);
      setGroups(g);
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

  const setPresence = async (s, presence) => {
    try {
      const r = await api(`/api/admin/staff/${s.id}`, { method: 'PATCH', body: { presence } });
      setStaff((list) => list.map((x) => (x.id === s.id ? { ...x, presence: r.presence, presence_at: r.presence_at } : x)));
      setFlash(`${s.name} signed ${presence}.`);
    } catch (e) {
      setFlash(e.message, 'bad');
    }
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

  const saveGroup = async (e) => {
    e.preventDefault();
    try {
      const g = groupEdit.id
        ? await api(`/api/admin/groups/${groupEdit.id}`, { method: 'PUT', body: groupEdit })
        : await api('/api/admin/groups', { method: 'POST', body: groupEdit });
      // A group made from the staff form is ticked straight away.
      if (!groupEdit.id && groupEdit.forEdit && edit) setEdit((x) => ({ ...x, groupIds: [...x.groupIds, g.id] }));
      setGroupEdit(null);
      load();
    } catch (err) {
      setGroupEdit({ ...groupEdit, error: err.message });
    }
  };
  const removeGroup = async (g) => {
    if (!window.confirm(`Delete the group "${g.name}"? People stay; they just leave the group.`)) return;
    try {
      await api(`/api/admin/groups/${g.id}`, { method: 'DELETE' });
      setGroupEdit(null);
      if (team === `g${g.id}`) setTeam('all');
      load();
    } catch (err) {
      setGroupEdit({ ...groupEdit, error: err.message });
    }
  };
  const groupById = Object.fromEntries(groups.map((g) => [g.id, g]));

  const list = (staff || []).filter((s) => (team === 'all' || (team === 'in' ? s.presence === 'in'
    : String(team).startsWith('g') ? s.group_ids.includes(Number(String(team).slice(1))) : String(s.team_id) === String(team)))
    && (!q || `${s.name} ${s.email || ''} ${s.team || ''}`.toLowerCase().includes(q.toLowerCase())));

  return (
    <>
      <div className="a-head">
        <div><h1>Staff &amp; teams</h1><p>Everyone visitors can choose as a host. {staff ? `${staff.length} staff · ${teams.length} teams` : ''}</p></div>
        <div className="a-actions">
          <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => importCsv(e.target.files[0])} />
          <a className="a-btn" href={`data:text/csv;charset=utf-8,${encodeURIComponent('name,email,team,mobile,groups\nJane Wilson,jane.wilson@company.co.nz,Operations,021 123 4567,Fire warden; First aider\n')}`} download="staff-template.csv">CSV template</a>
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
            <button type="button" className={`a-btn ${team === 'in' ? 'primary' : ''}`} style={{ justifyContent: 'space-between', border: 'none' }} onClick={() => setTeam('in')}>
              <span>Signed in now</span><span>{staff ? staff.filter((s) => s.presence === 'in').length : ''}</span>
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
          <div className="a-row" style={{ justifyContent: 'space-between', marginTop: 8 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700 }}>Groups</h2>
            <button type="button" className="a-btn sm" onClick={() => setGroupEdit({ name: '', color: '#1D4ED8' })}>+ Group</button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {groups.map((g) => (
              <div key={g.id} className="a-row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                <button type="button" className={`a-btn ${team === `g${g.id}` ? 'primary' : ''}`} style={{ flex: 1, justifyContent: 'space-between', border: 'none' }} onClick={() => setTeam(`g${g.id}`)}>
                  <span className="a-row" style={{ gap: 8, flexWrap: 'nowrap' }}><span className="a-gdot" style={{ background: g.color }} />{g.name}</span><span>{g.members}</span>
                </button>
                <button type="button" className="a-btn sm" aria-label={`Edit group ${g.name}`} onClick={() => setGroupEdit(g)}>Edit</button>
              </div>
            ))}
          </div>
          <p className="sub">People can be in several groups. <strong>Fire warden</strong> gives the Emergency roll call button in their phone app.</p>
        </section>
        <section className="a-card main">
          <input className="a-input" type="search" aria-label="Search staff" placeholder="Search name, email or team…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 360 }} />
          <div className="a-table-wrap">
            <table className="a-table">
              <thead><tr><th>Name</th><th>Team</th><th>Groups</th><th>Status</th><th>Show on tablet</th><th className="r"><span className="sr-only">Edit</span></th></tr></thead>
              <tbody>
                {list.map((s) => (
                  <tr key={s.id}>
                    <td><strong>{s.name}</strong><div className="muted">{s.email || 'No email: alerts go to their team or reception'}</div></td>
                    <td>{s.team || <span className="muted">—</span>}</td>
                    <td>
                      <div className="a-chips">{s.group_ids.map((id) => groupById[id] && <span key={id} className="a-chip" style={{ background: groupById[id].color }}>{groupById[id].name}</span>)}</div>
                      <div className="muted" style={{ marginTop: s.group_ids.length ? 4 : 0 }}>{s.phone_linked ? `Phone ✓ ${s.phone_device || ''}` : s.phone_invited ? 'Phone link sent' : ''}</div>
                    </td>
                    <td>
                      <div className="a-row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                        {s.presence === 'in' ? <span className="badge ok">In</span> : <span className="badge">Out</span>}
                        <button type="button" className="a-btn sm" onClick={() => setPresence(s, s.presence === 'in' ? 'out' : 'in')}>{s.presence === 'in' ? 'Sign out' : 'Sign in'}</button>
                      </div>
                      {s.presence === 'in' && s.presence_at && <div className="muted">since {fmtTime(s.presence_at)}</div>}
                    </td>
                    <td><Toggle on={s.show_on_kiosk} label={`Show ${s.name} on tablet`} onChange={(on) => setKiosk(s, on)} /></td>
                    <td className="r"><button type="button" className="a-btn sm" onClick={() => setEdit({ id: s.id, name: s.name, email: s.email || '', mobile: s.mobile || '', teamId: s.team_id || '', groupIds: s.group_ids, showOnKiosk: s.show_on_kiosk })}>Edit</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {staff && !list.length && <div className="a-empty">{staff.length ? 'No one matches.' : 'No staff yet. Add people one by one, or import a CSV with the columns name, email, team, mobile, groups.'}</div>}
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
            <div className="a-field">
              <span>Groups <span className="hint">Tap to add or remove</span></span>
              <div className="a-chips">
                {groups.map((g) => {
                  const on = edit.groupIds.includes(g.id);
                  return (
                    <button key={g.id} type="button" className={`a-gchip ${on ? 'on' : ''}`} aria-pressed={on} style={on ? { background: g.color, borderColor: g.color } : undefined}
                      onClick={() => setEdit({ ...edit, groupIds: on ? edit.groupIds.filter((x) => x !== g.id) : [...edit.groupIds, g.id] })}>
                      {on ? '✓ ' : ''}{g.name}
                    </button>
                  );
                })}
                <button type="button" className="a-gchip new" onClick={() => setGroupEdit({ name: '', color: '#1D4ED8', forEdit: true })}>+ New group</button>
              </div>
              {groups.some((g) => g.key === 'fire_warden' && edit.groupIds.includes(g.id)) && <span className="hint">Fire warden: sees the Emergency roll call button in their phone app.</span>}
            </div>
            <div className="a-toggle-row"><span>Show on the tablet as someone visitors can choose</span><Toggle on={edit.showOnKiosk} label="Show on tablet" onChange={(on) => setEdit({ ...edit, showOnKiosk: on })} /></div>
            {edit.id && <PhoneSignIn staff={staff.find((x) => x.id === edit.id)} email={edit.email} onChange={load} />}
            {edit.error && <div className="a-msg bad">{edit.error}</div>}
            <div className="a-row" style={{ justifyContent: 'space-between' }}>
              {edit.id ? <button type="button" className="a-btn danger" onClick={() => remove(edit)}>Remove</button> : <span />}
              <div className="a-row"><button type="button" className="a-btn" onClick={() => setEdit(null)}>Cancel</button><button type="submit" className="a-btn primary">Save</button></div>
            </div>
          </form>
        </Modal>
      )}
      {groupEdit && (
        <Modal title={groupEdit.id ? `Edit ${groupEdit.name}` : 'New group'} onClose={() => setGroupEdit(null)}>
          <form onSubmit={saveGroup} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <label className="a-field">Group name <span className="hint">e.g. Key holder, Forklift licence</span><input className="a-input" value={groupEdit.name} onChange={(e) => setGroupEdit({ ...groupEdit, name: e.target.value })} required maxLength={40} /></label>
            <div className="a-field"><span>Colour</span>
              <div className="a-chips">{['#B91C1C', '#C2410C', '#B45309', '#15803D', '#0F766E', '#1D4ED8', '#7C3AED', '#BE185D', '#374151'].map((c) => (
                <button key={c} type="button" className={`a-swatch ${groupEdit.color === c ? 'on' : ''}`} style={{ background: c }} aria-label={c} aria-pressed={groupEdit.color === c} onClick={() => setGroupEdit({ ...groupEdit, color: c })} />
              ))}</div>
            </div>
            {groupEdit.key === 'fire_warden' && <p className="sub">Built-in: people in this group can run the emergency roll call from their phone app. It can be renamed but not deleted.</p>}
            {groupEdit.error && <div className="a-msg bad">{groupEdit.error}</div>}
            <div className="a-row" style={{ justifyContent: 'space-between' }}>
              {groupEdit.id && groupEdit.key !== 'fire_warden' ? <button type="button" className="a-btn danger" onClick={() => removeGroup(groupEdit)}>Delete group</button> : <span />}
              <div className="a-row"><button type="button" className="a-btn" onClick={() => setGroupEdit(null)}>Cancel</button><button type="submit" className="a-btn primary">Save</button></div>
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

/** The "Phone sign-in" block in the staff form: status, send a link, turn it off. */
function PhoneSignIn({ staff, email, onChange }) {
  const [msg, setMsg] = useState(null);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  if (!staff) return null;
  const send = async (viaEmail) => {
    if (staff.phone_linked && !window.confirm(`Send ${staff.name} a new link? Their current phone will stop working once the new link is opened.`)) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await api(`/api/admin/staff/${staff.id}/phone-link`, { method: 'POST', body: { send: viaEmail } });
      setUrl(r.emailed ? '' : r.url);
      setMsg({ kind: 'ok', text: r.emailed ? `Link emailed to ${staff.email}. It works on one phone and expires in 7 days.` : 'Link made. Copy it and send it to them. It works on one phone.' });
      onChange();
    } catch (e) {
      setMsg({ kind: 'bad', text: e.message });
    } finally {
      setBusy(false);
    }
  };
  const revoke = async () => {
    if (!window.confirm(`Turn off phone sign-in for ${staff.name}?`)) return;
    await api(`/api/admin/staff/${staff.id}/phone`, { method: 'DELETE' });
    setMsg(null);
    setUrl('');
    onChange();
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setMsg({ kind: 'ok', text: 'Copied.' }); } catch { setMsg({ kind: 'warn', text: 'Select the link and copy it.' }); }
  };
  const when = (d) => (d ? fmtDateTime(d) : '');
  const changedEmail = (email || '') !== (staff.email || '');
  return (
    <div className="a-phone">
      <div className="a-row" style={{ justifyContent: 'space-between' }}>
        <strong>Phone sign-in</strong>
        {staff.phone_linked ? <span className="badge ok">Active</span> : staff.phone_invited ? <span className="badge warn">Link sent</span> : <span className="badge">Not set up</span>}
      </div>
      <p className="sub" style={{ margin: 0 }}>
        {staff.phone_linked
          ? `Linked to ${/^[AEIOU]/i.test(staff.phone_device || '') ? 'an' : 'a'} ${staff.phone_device || 'phone'} on ${when(staff.phone_linked_at)}.${staff.phone_last_used_at ? ` Last used ${when(staff.phone_last_used_at)}.` : ''}`
          : staff.phone_invited
            ? `A link was sent. It works until ${when(staff.phone_invite_expires)} or until it’s opened on a phone.`
            : 'Email them a personal link. They open it on their phone and sign in or out with one tap.'}
      </p>
      {url && <input className="a-input" readOnly value={url} onFocus={(e) => e.target.select()} aria-label="Phone sign-in link" />}
      {msg && <div className={`a-msg ${msg.kind}`}>{msg.text}</div>}
      {changedEmail && <div className="a-msg warn">Save the new email address first, then send the link.</div>}
      <div className="a-row">
        {staff.email && !changedEmail && <button type="button" className="a-btn sm primary" disabled={busy} onClick={() => send(true)}>{staff.phone_linked ? 'Send new link (new phone)' : staff.phone_invited ? 'Send the link again' : `Email link to ${staff.email}`}</button>}
        {!url && <button type="button" className="a-btn sm" disabled={busy} onClick={() => send(false)}>Make link to copy</button>}
        {url && <button type="button" className="a-btn sm" onClick={copy}>Copy link</button>}
        {(staff.phone_linked || staff.phone_invited) && <button type="button" className="a-btn sm danger" onClick={revoke}>Turn off phone sign-in</button>}
      </div>
    </div>
  );
}
