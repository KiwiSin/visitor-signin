import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { many, query, tx } from './db.js';
import { sendMail } from './mailer.js';
import { getSettings } from './settings.js';

const GIVE_UP_AFTER_MS = 24 * 60 * 60 * 1000;

/** Send due notifications. Failed sends retry with growing gaps for 24 hours. */
export async function processNotifications(log) {
  const due = await tx(async (c) => {
    const { rows } = await c.query(
      `SELECT * FROM notifications
        WHERE status = 'pending' AND next_attempt_at <= now()
        ORDER BY id LIMIT 10 FOR UPDATE SKIP LOCKED`,
    );
    if (rows.length) {
      // Push them forward so a parallel worker doesn't pick them up while we send.
      await c.query(`UPDATE notifications SET next_attempt_at = now() + interval '2 minutes' WHERE id = ANY($1)`, [rows.map((r) => r.id)]);
    }
    return rows;
  });
  if (!due.length) return 0;

  const { email } = await getSettings();
  for (const n of due) {
    try {
      await sendMail(email, { to: n.recipient, subject: n.subject, html: n.body_html, text: n.body_text });
      await query(`UPDATE notifications SET status='sent', sent_at=now(), attempts=attempts+1, last_error=NULL WHERE id=$1`, [n.id]);
      log.info({ id: n.id, to: n.recipient, kind: n.kind }, 'Email sent');
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
      log.warn({ id: n.id, to: n.recipient, err: err.message }, `Email failed (attempt ${attempts})`);
    }
  }
  return due.length;
}

/** Delete visits (and their signatures) older than the retention period. */
export async function applyRetention(log) {
  const { privacy } = await getSettings();
  const months = Math.max(1, Number(privacy.retentionMonths) || 12);
  const old = await many(
    `DELETE FROM visits WHERE signed_in_at < now() - ($1 || ' months')::interval RETURNING signature_file`,
    [String(months)],
  );
  for (const v of old) {
    if (v.signature_file) await fs.rm(path.join(config.uploadDir, 'private', v.signature_file), { force: true });
  }
  await query(`DELETE FROM visitors v WHERE NOT EXISTS (SELECT 1 FROM visits WHERE visitor_id = v.id)`);
  await query(`DELETE FROM sessions WHERE expires_at < now()`);
  await query(`DELETE FROM notifications WHERE created_at < now() - interval '90 days'`);
  if (old.length) log.info(`Retention: removed ${old.length} visits older than ${months} months`);
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
  const retention = setInterval(() => applyRetention(log).catch((e) => log.error(e, 'Retention error')), 6 * 60 * 60 * 1000);
  setTimeout(() => applyRetention(log).catch((e) => log.error(e, 'Retention error')), 30_000);
  return () => {
    clearInterval(timer);
    clearInterval(retention);
  };
}
