import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { many, one, query, tx } from './db.js';
import { sendMail } from './mailer.js';
import { getSettings } from './settings.js';
import { autoSignOutEmail } from './templates.js';

const GIVE_UP_AFTER_MS = 24 * 60 * 60 * 1000;

/** Send due notifications, each with its own business's email settings. Failures retry for 24 hours. */
export async function processNotifications(log) {
  const due = await tx(async (c) => {
    const { rows } = await c.query(
      `SELECT * FROM notifications
        WHERE status = 'pending' AND next_attempt_at <= now()
        ORDER BY id LIMIT 20 FOR UPDATE SKIP LOCKED`,
    );
    if (rows.length) {
      // Push them forward so a parallel worker doesn't pick them up while we send.
      await c.query(`UPDATE notifications SET next_attempt_at = now() + interval '2 minutes' WHERE id = ANY($1)`, [rows.map((r) => r.id)]);
    }
    return rows;
  });
  if (!due.length) return 0;

  const emailSettings = new Map();
  for (const n of due) {
    try {
      if (!n.business_id) throw new Error('No business for this email.');
      if (!emailSettings.has(n.business_id)) emailSettings.set(n.business_id, (await getSettings(n.business_id)).email);
      await sendMail(emailSettings.get(n.business_id), { to: n.recipient, subject: n.subject, html: n.body_html, text: n.body_text });
      await query(`UPDATE notifications SET status='sent', sent_at=now(), attempts=attempts+1, last_error=NULL WHERE id=$1`, [n.id]);
      log.info({ id: n.id, business: n.business_id, kind: n.kind }, 'Email sent');
    } catch (err) {
      const attempts = n.attempts + 1;
      const tooOld = Date.now() - new Date(n.created_at).getTime() > GIVE_UP_AFTER_MS;
      const delayMin = Math.min(2 ** attempts, 60);
      await query(
        `UPDATE notifications SET attempts=$2, last_error=$3,
           status = CASE WHEN $4 THEN 'failed' ELSE 'pending' END,
           next_attempt_at = now() + ($5 || ' minutes')::interval
         WHERE id=$1`,
        [n.id, attempts, String(err.message).slice(0, 500), tooOld, String(delayMin)],
      );
      log.warn({ id: n.id, business: n.business_id, err: err.message }, `Email failed (attempt ${attempts})`);
    }
  }
  return due.length;
}

/** Delete each business's visits (and signatures) older than its retention period, and other old records. */
export async function applyRetention(log) {
  for (const b of await many('SELECT id FROM businesses')) {
    const { privacy } = await getSettings(b.id);
    const months = Math.max(1, Number(privacy.retentionMonths) || 12);
    const old = await many(
      `DELETE FROM visits WHERE business_id = $2 AND signed_in_at < now() - ($1 || ' months')::interval RETURNING signature_file`,
      [String(months), b.id],
    );
    for (const v of old) {
      if (v.signature_file) await fs.rm(path.join(config.uploadDir, 'private', path.basename(v.signature_file)), { force: true });
    }
    if (old.length) log.info(`Retention: business ${b.id} removed ${old.length} visits older than ${months} months`);
  }
  await query(`DELETE FROM visitors v WHERE NOT EXISTS (SELECT 1 FROM visits WHERE visitor_id = v.id)`);
  await query(`DELETE FROM sessions WHERE expires_at < now()`);
  await query(`DELETE FROM notifications WHERE created_at < now() - interval '90 days'`);
  // Roll call reports are kept for 7 years (H&S records), then deleted.
  await query(`DELETE FROM roll_calls WHERE started_at < now() - interval '7 years'`);
  // A roll call nobody ended within 12 hours is closed automatically.
  await query(`UPDATE roll_calls SET ended_at = started_at + interval '12 hours', ended_by = 'Closed automatically'
                WHERE ended_at IS NULL AND started_at < now() - interval '12 hours'`);
}

const ISO_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

/** The time of day (HH:MM, business's local time) the automatic sign-out runs today, or null if off. */
export function cutoffFor(hours, isoDow) {
  const a = hours.autoSignOut || {};
  if (a.mode === 'off' || (!a.visitors && !a.staff)) return null;
  if (a.mode === 'closing') {
    const day = hours.days?.[ISO_DAYS[isoDow - 1]];
    if (!day?.open) return a.time || '23:00'; // closed today: fall back to the set time
    const [h, m] = day.end.split(':').map(Number);
    const mins = Math.min(h * 60 + m + (Number(a.afterClosingMins) || 0), 23 * 60 + 59);
    return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
  }
  return a.time || '23:00';
}

/**
 * Sign out visitors and/or staff still signed in at the end of the day, once per business per day.
 * If the server was off at the cut-off time, it runs as soon as it is back.
 */
export async function runAutoSignOut(log, { force = false } = {}) {
  const results = [];
  for (const b of await many(`SELECT id FROM businesses WHERE status = 'active'`)) {
    const settings = await getSettings(b.id);
    const { hours } = settings;
    const tz = hours.timezone || config.timeZone;
    const now = await one(
      `SELECT (now() AT TIME ZONE $1)::date AS today, to_char(now() AT TIME ZONE $1, 'HH24:MI') AS hm,
              extract(isodow FROM now() AT TIME ZONE $1)::int AS dow`, [tz],
    );
    const cutoff = cutoffFor(hours, now.dow);
    if (!cutoff) continue;
    const today = String(now.today).slice(0, 10);
    if (!force && now.hm < cutoff) continue;
    // Claim today's run, so it happens once even if two copies of the app are running.
    const claimed = await one(
      `UPDATE businesses SET last_auto_signout = $2 WHERE id = $1 AND ($3 OR last_auto_signout IS DISTINCT FROM $2::date) RETURNING id`,
      [b.id, today, force],
    );
    if (!claimed) continue;

    const { cut } = await one(`SELECT (($1::date + $2::time) AT TIME ZONE $3) AS cut`, [today, cutoff, tz]);
    const until = force ? new Date() : cut;
    const visitors = hours.autoSignOut.visitors ? await many(
      `UPDATE visits v SET signed_out_at = $2, signed_out_by = 'auto'
         FROM visitors vi, visitor_types t
        WHERE v.business_id = $1 AND v.signed_out_at IS NULL AND v.signed_in_at < $2
          AND vi.id = v.visitor_id AND t.id = v.type_id
        RETURNING vi.name, t.name AS type, v.host_name AS host, v.signed_in_at`,
      [b.id, until],
    ) : [];
    const staff = hours.autoSignOut.staff ? await many(
      `WITH s AS (SELECT id, name, presence_at FROM staff WHERE business_id = $1 AND active AND presence = 'in'
                  AND (presence_at IS NULL OR presence_at < $2))
       UPDATE staff SET presence = 'out', presence_at = $2 FROM s WHERE staff.id = s.id
       RETURNING s.id, s.name, s.presence_at`,
      [b.id, until],
    ) : [];
    for (const s of staff) {
      await query(`INSERT INTO staff_presence (staff_id, state, changed_by, business_id, at) VALUES ($1, 'out', 'Automatic sign-out', $2, $3)`, [s.id, b.id, until]);
    }

    const { notify, email, branding } = settings;
    if (hours.autoSignOut.emailReception && notify.receptionMailbox && email.method !== 'none' && (visitors.length || staff.length)) {
      const msg = autoSignOutEmail({ branding, visitors, staff, tz });
      await query(`INSERT INTO notifications (business_id, kind, recipient, subject, body_html, body_text) VALUES ($1, 'autosignout', $2, $3, $4, $5)`,
        [b.id, notify.receptionMailbox, msg.subject, msg.html, msg.text]);
    }
    if (visitors.length || staff.length) log.info(`Automatic sign-out: business ${b.id} signed out ${visitors.length} visitors and ${staff.length} staff`);
    results.push({ businessId: b.id, visitors: visitors.length, staff: staff.length });
  }
  return results;
}

export function startWorker(log) {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      await processNotifications(log);
    } catch (err) {
      log.error(err, 'Notification worker error');
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(tick, 5000);
  const auto = setInterval(() => runAutoSignOut(log).catch((e) => log.error(e, 'Automatic sign-out error')), 60_000);
  const retention = setInterval(() => applyRetention(log).catch((e) => log.error(e, 'Retention error')), 6 * 60 * 60 * 1000);
  setTimeout(() => applyRetention(log).catch((e) => log.error(e, 'Retention error')), 30_000);
  setTimeout(() => runAutoSignOut(log).catch((e) => log.error(e, 'Automatic sign-out error')), 15_000);
  return () => {
    clearInterval(timer);
    clearInterval(auto);
    clearInterval(retention);
  };
}
