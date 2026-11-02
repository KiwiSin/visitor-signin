import { audit, requireAdmin } from '../auth.js';
import { businessUrl } from '../business.js';
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
      if (!actor) return reply.code(401).send({ error: 'Only fire wardens can open the roll call. Open it from your staff phone app, or sign in to Admin.', code: 'no-access' });
      request.actor = actor;
    });

    r.get('/api/rollcall/state', async (request) => ({ me: { type: request.actor.type, name: request.actor.name }, ...(await rollCallState(request.actor.businessId)) }));

    r.post('/api/rollcall/sync', async (request) => syncRollCall(request.body || {}, request.actor));
  });

  // ---- Admin: reports ----
  app.register(async (a) => {
    a.addHook('preHandler', requireAdmin);

    a.get('/api/admin/rollcalls', async (request) => many(
      `SELECT r.id, r.started_at, r.started_by, r.ended_at, r.ended_by,
              count(e.id)::int AS total, count(e.id) FILTER (WHERE e.status = 'safe')::int AS safe
         FROM roll_calls r LEFT JOIN roll_call_entries e ON e.roll_call_id = r.id
        WHERE r.business_id = $1
        GROUP BY r.id ORDER BY r.started_at DESC LIMIT 200`,
      [request.business.id],
    ));

    a.get('/api/admin/rollcalls/:id', async (request, reply) => {
      const v = await rollCallView(Number(request.params.id), request.business.id);
      if (!v) return reply.code(404).send({ error: 'Roll call not found.' });
      return v;
    });

    a.get('/api/admin/rollcalls/:id/csv', async (request, reply) => {
      const v = await rollCallView(Number(request.params.id), request.business.id);
      if (!v) return reply.code(404).send({ error: 'Roll call not found.' });
      const tz = (await getSettings(request.business.id)).hours.timezone;
      const csv = toCsv(v.entries, [
        { label: 'Name', value: (e) => e.name },
        { label: 'Who', value: (e) => e.detail },
        { label: 'Mobile', value: (e) => e.mobile },
        { label: 'Status', value: (e) => (e.status === 'safe' ? 'Safe' : 'NOT ACCOUNTED FOR') },
        { label: 'Marked by', value: (e) => e.markedBy },
        { label: 'Marked at', value: (e) => (e.markedAt ? formatDateTime(e.markedAt, tz) : '') },
      ]);
      const head = `Roll call ${v.id},Started ${formatDateTime(v.startedAt, tz)} by ${v.startedBy},${v.endedAt ? `Ended ${formatDateTime(v.endedAt, tz)} by ${v.endedBy}` : 'Not ended'}\r\n\r\n`;
      reply.header('Content-Type', 'text/csv; charset=utf-8');
      reply.header('Content-Disposition', `attachment; filename="roll-call-${v.id}.csv"`);
      return `﻿${head}${csv}`;
    });
  });
}
