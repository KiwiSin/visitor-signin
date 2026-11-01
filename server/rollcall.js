import { config } from './config.js';
import { currentUser } from './auth.js';
import { many, one, query, tx } from './db.js';
import { sha256 } from './security.js';
import { getSettings } from './settings.js';
import { rollCallEmail } from './templates.js';

const ACTIVE_WINDOW = "interval '12 hours'"; // a roll call left open longer than this is treated as finished

/**
 * Who is using the roll call: a signed-in admin, a warden's personal link, or a paired tablet.
 * Returns null if none.
 */
export async function rollCallActor(request) {
  const user = await currentUser(request);
  if (user) return { type: 'admin', name: user.name };
  const warden = request.headers['x-warden-token'];
  if (warden) {
    const s = await one('SELECT id, name FROM staff WHERE rollcall_key_hash = $1 AND active', [sha256(String(warden))]);
    if (s) return { type: 'warden', name: s.name, staffId: s.id };
  }
  const kioskToken = request.headers['x-kiosk-token'];
  if (kioskToken) {
    const k = await one('UPDATE kiosks SET last_seen_at = now() WHERE token_hash = $1 RETURNING id, name', [sha256(String(kioskToken))]);
    if (k) return { type: 'kiosk', name: k.name };
  }
  return null;
}

/** Everyone currently on site: visitors signed in, and staff marked In. */
export async function peopleOnSite(client = { query }) {
  const visitors = (await client.query(
    `SELECT v.id, vi.name, vi.company, vi.mobile, t.name AS type, v.host_name
       FROM visits v JOIN visitors vi ON vi.id = v.visitor_id JOIN visitor_types t ON t.id = v.type_id
      WHERE v.signed_out_at IS NULL AND v.signed_in_at > now() - interval '7 days'`,
  )).rows.map((r) => ({
    personKey: `visit:${r.id}`,
    kind: 'visitor',
    name: r.name,
    detail: [r.type, r.company, r.host_name ? `host ${r.host_name}` : null].filter(Boolean).join(' · '),
    mobile: r.mobile || null,
  }));
  const staff = (await client.query(
    `SELECT s.id, s.name, s.mobile, t.name AS team FROM staff s LEFT JOIN teams t ON t.id = s.team_id
      WHERE s.active AND s.presence = 'in'`,
  )).rows.map((r) => ({
    personKey: `staff:${r.id}`,
    kind: 'staff',
    name: r.name,
    detail: ['Staff', r.team].filter(Boolean).join(' · '),
    mobile: r.mobile || null,
  }));
  return [...visitors, ...staff].sort((a, b) => a.name.localeCompare(b.name));
}

export async function rollCallView(id) {
  const rc = await one('SELECT * FROM roll_calls WHERE id = $1', [id]);
  if (!rc) return null;
  const entries = await many(
    `SELECT person_key, kind, name, detail, mobile, status, marked_by, marked_at FROM roll_call_entries
      WHERE roll_call_id = $1 ORDER BY name`,
    [id],
  );
  return {
    id: rc.id,
    clientId: rc.client_id,
    startedAt: rc.started_at,
    startedBy: rc.started_by,
    endedAt: rc.ended_at,
    endedBy: rc.ended_by,
    entries: entries.map((e) => ({
      personKey: e.person_key, kind: e.kind, name: e.name, detail: e.detail, mobile: e.mobile,
      status: e.status, markedBy: e.marked_by, markedAt: e.marked_at,
    })),
  };
}

export async function rollCallState() {
  const [people, active, lastEnded] = await Promise.all([
    peopleOnSite(),
    one(`SELECT id FROM roll_calls WHERE ended_at IS NULL AND started_at > now() - ${ACTIVE_WINDOW} ORDER BY started_at DESC LIMIT 1`),
    one(`SELECT id, client_id, started_at, ended_at, ended_by FROM roll_calls WHERE ended_at > now() - ${ACTIVE_WINDOW} ORDER BY ended_at DESC LIMIT 1`),
  ]);
  return {
    people,
    active: active ? await rollCallView(active.id) : null,
    lastEnded: lastEnded ? { id: lastEnded.id, clientId: lastEnded.client_id, startedAt: lastEnded.started_at, endedAt: lastEnded.ended_at, endedBy: lastEnded.ended_by } : null,
    serverTime: new Date().toISOString(),
  };
}

const clamp = (iso, fallback) => {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return fallback;
  return new Date(Math.min(t, Date.now()));
};
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/**
 * Bring the server up to date with one device's view of a roll call.
 * Safe to repeat: the device sends everything it has done; the latest mark for each person wins.
 * If another roll call is already running, the device joins that one instead of starting a second.
 */
export async function syncRollCall(body, actor) {
  const clientId = str(body.clientId, 80);
  if (!clientId) {
    const err = new Error('Missing roll call id.');
    err.statusCode = 400;
    throw err;
  }
  const marks = Array.isArray(body.marks) ? body.marks.slice(0, 2000) : [];
  let started = false;

  const id = await tx(async (c) => {
    // Serialise roll call starts so two wardens starting at once end up in the same roll call.
    await c.query('SELECT pg_advisory_xact_lock(424242)');
    let rc = (await c.query('SELECT * FROM roll_calls WHERE client_id = $1', [clientId])).rows[0];
    if (!rc) {
      rc = (await c.query(
        `SELECT * FROM roll_calls WHERE ended_at IS NULL AND started_at > now() - ${ACTIVE_WINDOW} ORDER BY started_at DESC LIMIT 1`,
      )).rows[0];
    }
    if (!rc) {
      const startedAt = clamp(body.startedAt, new Date());
      const tooOld = Date.now() - startedAt.getTime() > 12 * 3600 * 1000;
      rc = (await c.query(
        'INSERT INTO roll_calls (client_id, site_id, started_at, started_by) VALUES ($1, 1, $2, $3) RETURNING *',
        [clientId, tooOld ? new Date() : startedAt, str(body.startedBy, 120) || actor.name],
      )).rows[0];
      started = true;
      for (const p of await peopleOnSite(c)) {
        await c.query(
          `INSERT INTO roll_call_entries (roll_call_id, person_key, kind, name, detail, mobile) VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT DO NOTHING`,
          [rc.id, p.personKey, p.kind, p.name, p.detail, p.mobile],
        );
      }
    }

    for (const m of marks) {
      const personKey = str(m.personKey, 120);
      const status = m.status === 'safe' ? 'safe' : 'missing';
      if (!personKey) continue;
      const at = clamp(m.at, new Date());
      const by = str(m.by, 120) || actor.name;
      // People the device knew about but the server didn't (offline start, or someone added by hand).
      if (m.name) {
        const kind = ['visitor', 'staff', 'extra'].includes(m.kind) ? m.kind : 'extra';
        await c.query(
          `INSERT INTO roll_call_entries (roll_call_id, person_key, kind, name, detail, mobile) VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (roll_call_id, person_key) DO NOTHING`,
          [rc.id, personKey, kind, str(m.name, 120), str(m.detail, 200) || null, str(m.mobile, 40) || null],
        );
      }
      await c.query(
        `UPDATE roll_call_entries SET status = $3, marked_by = $4, marked_at = $5
          WHERE roll_call_id = $1 AND person_key = $2 AND (marked_at IS NULL OR marked_at <= $5)`,
        [rc.id, personKey, status, by, at],
      );
    }

    if (body.ended && !rc.ended_at) {
      await c.query('UPDATE roll_calls SET ended_at = $2, ended_by = $3 WHERE id = $1',
        [rc.id, clamp(body.endedAt, new Date()), str(body.endedBy, 120) || actor.name]);
    }
    return rc.id;
  });

  if (started) await queueRollCallEmails(id).catch(() => {});
  return rollCallView(id);
}

/** Tell the wardens and reception that a roll call has started (internal email works without internet). */
async function queueRollCallEmails(id) {
  const settings = await getSettings();
  if (settings.email.method === 'none') return;
  const rc = await rollCallView(id);
  const wardens = await many(`SELECT DISTINCT lower(email) AS email FROM staff WHERE active AND role = 'warden' AND email IS NOT NULL AND email <> ''`);
  const to = new Set(wardens.map((w) => w.email));
  if (settings.notify.receptionMailbox) to.add(settings.notify.receptionMailbox.toLowerCase());
  const msg = rollCallEmail({ branding: settings.branding, rc, url: `${config.appUrl}/rollcall` });
  for (const recipient of to) {
    await query(
      `INSERT INTO notifications (kind, recipient, subject, body_html, body_text) VALUES ('rollcall', $1, $2, $3, $4)`,
      [recipient, msg.subject, msg.html, msg.text],
    );
  }
}
