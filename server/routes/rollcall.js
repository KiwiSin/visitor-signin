import { audit, requireAdmin } from '../auth.js';
import { config } from '../config.js';
import { toCsv } from '../csv.js';
import { many, one, query } from '../db.js';
import { sendMail } from '../mailer.js';
import { randomToken, sha256 } from '../security.js';
import { rollCallActor, rollCallState, rollCallView, syncRollCall } from '../rollcall.js';
import { getSettings } from '../settings.js';
import { esc, formatDateTime } from '../templates.js';

export default async function rollCallRoutes(app) {
  // ---- Used by the roll call app (wardens' phones, tablets, signed-in admins) ----
  app.register(async (r) => {
    r.addHook('preHandler', async (request, reply) => {
      const actor = await rollCallActor(request);
      if (!actor) return reply.code(401).send({ error: 'Open the roll call from your warden link, or sign in to Admin.', code: 'no-access' });
      request.actor = actor;
    });

    r.get('/api/rollcall/state', async (request) => ({ me: request.actor, ...(await rollCallState()) }));

    r.post('/api/rollcall/sync', async (request) => syncRollCall(request.body || {}, request.actor));
  });

  // ---- Admin: warden links and reports ----
  app.register(async (a) => {
    a.addHook('preHandler', requireAdmin);

    a.post('/api/admin/staff/:id/rollcall-link', async (request, reply) => {
      const s = await one('SELECT id, name, email FROM staff WHERE id = $1 AND active', [Number(request.params.id)]);
      if (!s) return reply.code(404).send({ error: 'Staff member not found.' });
      const key = randomToken(24);
      await query(`UPDATE staff SET rollcall_key_hash = $2, rollcall_key_created_at = now(), role = 'warden' WHERE id = $1`, [s.id, sha256(key)]);
      const url = `${config.appUrl}/rollcall#key=${key}`;
      await audit(request.user.id, 'rollcall.link', { staff: s.id });
      let emailed = false;
      if (request.body?.email) {
        if (!s.email) return reply.code(400).send({ error: `${s.name} has no email address. Copy the link instead.` });
        const { email, branding } = await getSettings();
        try {
          await sendMail(email, {
            to: s.email,
            subject: `Your roll call link for ${branding.companyName}`,
            html: `<p>Kia ora ${esc(s.name.split(' ')[0])},</p><p>You are set up as a fire warden. Open this link <strong>on your phone</strong>, then add it to your home screen (Share › Add to Home Screen on iPhone; ⋮ › Add to Home screen on Android):</p><p><a href="${esc(url)}">${esc(url)}</a></p><p>Open it once a week or so, and as you leave the building in an evacuation, so it has the latest list of who is on site. It keeps working without Wi-Fi.</p><p>Keep this link to yourself. It is your personal access.</p>`,
            text: `You are set up as a fire warden. Open this link on your phone and add it to your home screen:\n${url}\n\nOpen it as you leave the building in an evacuation so it has the latest list. Keep this link to yourself.`,
          });
          emailed = true;
        } catch (err) {
          return reply.code(400).send({ error: `The link was made but the email failed: ${err.message}`, url });
        }
      }
      return { url, emailed };
    });

    a.delete('/api/admin/staff/:id/rollcall-link', async (request) => {
      await query('UPDATE staff SET rollcall_key_hash = NULL, rollcall_key_created_at = NULL WHERE id = $1', [Number(request.params.id)]);
      await audit(request.user.id, 'rollcall.revoke', { staff: Number(request.params.id) });
      return { ok: true };
    });

    a.get('/api/admin/rollcalls', async () => many(
      `SELECT r.id, r.started_at, r.started_by, r.ended_at, r.ended_by,
              count(e.id)::int AS total, count(e.id) FILTER (WHERE e.status = 'safe')::int AS safe
         FROM roll_calls r LEFT JOIN roll_call_entries e ON e.roll_call_id = r.id
        GROUP BY r.id ORDER BY r.started_at DESC LIMIT 200`,
    ));

    a.get('/api/admin/rollcalls/:id', async (request, reply) => {
      const v = await rollCallView(Number(request.params.id));
      if (!v) return reply.code(404).send({ error: 'Roll call not found.' });
      return v;
    });

    a.get('/api/admin/rollcalls/:id/csv', async (request, reply) => {
      const v = await rollCallView(Number(request.params.id));
      if (!v) return reply.code(404).send({ error: 'Roll call not found.' });
      const csv = toCsv(v.entries, [
        { label: 'Name', value: (e) => e.name },
        { label: 'Who', value: (e) => e.detail },
        { label: 'Mobile', value: (e) => e.mobile },
        { label: 'Status', value: (e) => (e.status === 'safe' ? 'Safe' : 'NOT ACCOUNTED FOR') },
        { label: 'Marked by', value: (e) => e.markedBy },
        { label: 'Marked at', value: (e) => (e.markedAt ? formatDateTime(e.markedAt) : '') },
      ]);
      const head = `Roll call ${v.id},Started ${formatDateTime(v.startedAt)} by ${v.startedBy},${v.endedAt ? `Ended ${formatDateTime(v.endedAt)} by ${v.endedBy}` : 'Not ended'}\r\n\r\n`;
      reply.header('Content-Type', 'text/csv; charset=utf-8');
      reply.header('Content-Disposition', `attachment; filename="roll-call-${v.id}.csv"`);
      return `﻿${head}${csv}`;
    });
  });
}
