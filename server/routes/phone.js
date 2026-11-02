// Staff groups and personal phone sign-in.
import { audit, requireAdmin } from '../auth.js';
import { businessUrl } from '../business.js';
import { many, one, query, tx } from '../db.js';
import { sendMail } from '../mailer.js';
import { makeLimiter, randomToken, sha256 } from '../security.js';
import { getSettings } from '../settings.js';
import { esc } from '../templates.js';
import { publicBranding } from './kiosk.js';

const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const bad = (reply, error) => reply.code(400).send({ error });
const HEX_RE = /^#[0-9a-f]{6}$/i;
const INVITE_DAYS = 7;
const claimLimit = makeLimiter({ max: 20, windowMs: 15 * 60 * 1000 });

/** Distance in metres between two points (haversine). */
export function distanceM(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Is this staff member in the business's Fire warden group? */
export async function isFireWarden(staffId) {
  return !!(await one(
    `SELECT 1 FROM staff_group_members m JOIN staff_groups g ON g.id = m.group_id WHERE m.staff_id = $1 AND g.key = 'fire_warden'`,
    [staffId],
  ));
}

/** The staff member using the phone app (X-Staff-Token), or null. */
export async function staffFromToken(request) {
  const token = request.headers['x-staff-token'];
  if (!token) return null;
  return one(
    `UPDATE staff s SET phone_last_used_at = now() FROM businesses b
      WHERE s.phone_key_hash = $1 AND s.active AND b.id = s.business_id AND b.status = 'active'
     RETURNING s.id, s.name, s.email, s.business_id, s.presence, s.presence_at, b.slug AS business_slug, b.name AS business_name`,
    [sha256(String(token))],
  );
}

/** Replace a staff member's groups (ids from other businesses are ignored) and keep role in step. */
export async function setStaffGroups(c, staffId, businessId, groupIds, groupKeys = []) {
  const ids = (Array.isArray(groupIds) ? groupIds : []).map(Number).filter(Number.isInteger);
  await c.query('DELETE FROM staff_group_members WHERE staff_id = $1', [staffId]);
  await c.query(
    `INSERT INTO staff_group_members (staff_id, group_id) SELECT $1, g.id FROM staff_groups g
      WHERE g.business_id = $2 AND (g.id = ANY($3::int[]) OR g.key = ANY($4::text[]))`,
    [staffId, businessId, ids, groupKeys],
  );
  // Keep the older role field in step (used by reports and CSV export).
  await c.query(`UPDATE staff SET role = CASE WHEN EXISTS (SELECT 1 FROM staff_group_members m JOIN staff_groups g ON g.id = m.group_id
                   WHERE m.staff_id = $1 AND g.key = 'fire_warden') THEN 'warden' ELSE 'staff' END WHERE id = $1`, [staffId]);
}

function deviceName(ua = '') {
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua)) return 'iPad';
  if (/Android/i.test(ua)) return 'Android phone';
  return 'phone';
}

/** Make a one-time link for a staff member's phone; optionally email it. */
async function makePhoneLink(business, staff, { send }) {
  const invite = randomToken(24);
  await query(
    `UPDATE staff SET phone_invite_hash = $2, phone_invite_expires = now() + ($3 || ' days')::interval WHERE id = $1`,
    [staff.id, sha256(invite), String(INVITE_DAYS)],
  );
  const url = `${businessUrl(business, '/me')}?invite=${invite}`;
  if (!send) return { url, emailed: false };
  if (!staff.email) throw Object.assign(new Error(`${staff.name} has no email address.`), { statusCode: 400 });
  const { email, branding } = await getSettings(business.id);
  const first = esc(staff.name.split(' ')[0]);
  const accent = HEX_RE.test(branding.accent) ? branding.accent : '#0F766E';
  const accentText = HEX_RE.test(branding.colors?.accentText || '') ? branding.colors.accentText : '#FFFFFF';
  await sendMail(email, {
    to: staff.email,
    subject: `Your sign-in link for ${branding.companyName}`,
    html: `<!doctype html><html><body style="margin:0;padding:24px;background:#F3F4F6;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111827">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:10px;overflow:hidden">
<tr><td style="background:${accent};padding:18px 24px;color:${accentText};font-size:16px;font-weight:700">${esc(branding.companyName)}</td></tr>
<tr><td style="padding:24px">
<h1 style="margin:0 0 10px;font-size:21px">Kia ora ${first}, sign in from your phone</h1>
<p style="margin:0 0 18px;font-size:15px;line-height:1.6;color:#374151">Open this link <strong>on your phone</strong> to get your personal sign-in. From then on, signing in or out is one tap.</p>
<p style="margin:0 0 18px"><a href="${esc(url)}" style="display:inline-block;background:${accent};color:${accentText};padding:13px 22px;border-radius:8px;font-weight:700;text-decoration:none">Open my sign-in</a></p>
<p style="margin:0 0 6px;font-size:14px;font-weight:700">Then add it to your home screen</p>
<p style="margin:0 0 18px;font-size:14px;line-height:1.55;color:#374151">iPhone: Share › Add to Home Screen. Android: ⋮ › Add to Home screen.</p>
<p style="margin:0;padding-top:14px;border-top:1px solid #E5E7EB;font-size:12px;color:#6B7280;line-height:1.6">This link is just for you and works on one phone, so please don’t forward it. If you change phones, ask your admin for a new link. It expires in ${INVITE_DAYS} days if not opened.</p>
</td></tr></table></body></html>`,
    text: `Kia ora ${staff.name.split(' ')[0]},\n\nOpen this link on your phone to get your personal sign-in for ${branding.companyName}:\n${url}\n\nThen add it to your home screen (iPhone: Share > Add to Home Screen; Android: menu > Add to Home screen).\nThe link works on one phone only. It expires in ${INVITE_DAYS} days if not opened.`,
  });
  return { url, emailed: true };
}

export default async function phoneRoutes(app) {
  // ------------------------------------------------------------- admin side
  app.register(async (a) => {
    a.addHook('preHandler', requireAdmin);

    a.get('/api/admin/groups', async (request) => many(
      `SELECT g.id, g.key, g.name, g.color, (SELECT count(*)::int FROM staff_group_members m JOIN staff s ON s.id = m.staff_id WHERE m.group_id = g.id AND s.active) AS members
         FROM staff_groups g WHERE g.business_id = $1 ORDER BY g.sort, g.name`,
      [request.business.id],
    ));

    a.post('/api/admin/groups', async (request, reply) => {
      const name = str(request.body?.name, 40);
      const color = HEX_RE.test(request.body?.color || '') ? request.body.color : '#1D4ED8';
      if (!name) return bad(reply, 'Enter a group name.');
      try {
        const g = await one('INSERT INTO staff_groups (business_id, name, color) VALUES ($1, $2, $3) RETURNING id, key, name, color',
          [request.business.id, name, color]);
        await audit(request.user.id, 'group.add', { id: g.id, name }, request.business.id);
        return g;
      } catch (e) {
        if (e.code === '23505') return bad(reply, 'A group with that name already exists.');
        throw e;
      }
    });

    a.put('/api/admin/groups/:id', async (request, reply) => {
      const name = str(request.body?.name, 40);
      if (!name) return bad(reply, 'Enter a group name.');
      const color = HEX_RE.test(request.body?.color || '') ? request.body.color : null;
      try {
        return await one('UPDATE staff_groups SET name = $3, color = coalesce($4, color) WHERE id = $1 AND business_id = $2 RETURNING id, key, name, color',
          [Number(request.params.id), request.business.id, name, color]);
      } catch (e) {
        if (e.code === '23505') return bad(reply, 'A group with that name already exists.');
        throw e;
      }
    });

    a.delete('/api/admin/groups/:id', async (request, reply) => {
      const g = await one('SELECT key FROM staff_groups WHERE id = $1 AND business_id = $2', [Number(request.params.id), request.business.id]);
      if (!g) return reply.code(404).send({ error: 'Group not found.' });
      if (g.key === 'fire_warden') return bad(reply, 'The Fire warden group can’t be deleted: it controls who can run a roll call.');
      await query('DELETE FROM staff_groups WHERE id = $1', [Number(request.params.id)]);
      await audit(request.user.id, 'group.remove', { id: Number(request.params.id) }, request.business.id);
      return { ok: true };
    });

    a.put('/api/admin/staff/:id/groups', async (request, reply) => {
      const B = request.business.id;
      const id = Number(request.params.id);
      if (!(await one('SELECT 1 FROM staff WHERE id = $1 AND business_id = $2', [id, B]))) return reply.code(404).send({ error: 'Staff member not found.' });
      const ids = request.body?.groupIds;
      await tx((c) => setStaffGroups(c, id, B, ids));
      await audit(request.user.id, 'staff.groups', { id, groups: ids }, B);
      return { ok: true };
    });

    a.post('/api/admin/staff/:id/phone-link', async (request, reply) => {
      const s = await one('SELECT id, name, email FROM staff WHERE id = $1 AND business_id = $2 AND active', [Number(request.params.id), request.business.id]);
      if (!s) return reply.code(404).send({ error: 'Staff member not found.' });
      try {
        const r = await makePhoneLink(request.business, s, { send: request.body?.send !== false });
        await audit(request.user.id, 'phone.link', { staff: s.id, emailed: r.emailed }, request.business.id);
        return r;
      } catch (err) {
        return bad(reply, err.statusCode === 400 ? err.message : `Couldn’t send the email: ${err.message}`);
      }
    });

    a.post('/api/admin/staff/phone-links', async (request) => {
      const B = request.business.id;
      const staff = await many(
        `SELECT id, name, email FROM staff WHERE business_id = $1 AND active AND email IS NOT NULL AND email <> ''
           AND phone_key_hash IS NULL AND (phone_invite_hash IS NULL OR phone_invite_expires < now())`,
        [B],
      );
      const result = { sent: 0, failed: [] };
      for (const s of staff) {
        try {
          await makePhoneLink(request.business, s, { send: true });
          result.sent++;
        } catch (err) {
          result.failed.push(`${s.name}: ${err.message}`);
        }
      }
      await audit(request.user.id, 'phone.links.bulk', result, B);
      return result;
    });

    a.delete('/api/admin/staff/:id/phone', async (request) => {
      await query(`UPDATE staff SET phone_key_hash = NULL, phone_invite_hash = NULL, phone_invite_expires = NULL, phone_linked_at = NULL, phone_device = NULL
                    WHERE id = $1 AND business_id = $2`, [Number(request.params.id), request.business.id]);
      await audit(request.user.id, 'phone.revoke', { staff: Number(request.params.id) }, request.business.id);
      return { ok: true };
    });
  });

  // -------------------------------------------------------- staff phone app
  app.post('/api/me/claim', async (request, reply) => {
    if (!claimLimit(request.ip)) return reply.code(429).send({ error: 'Too many attempts. Wait a few minutes and try again.' });
    const invite = str(request.body?.invite, 100);
    if (!invite) return bad(reply, 'This link is incomplete.');
    const token = randomToken();
    const s = await one(
      `UPDATE staff s SET phone_key_hash = $2, phone_invite_hash = NULL, phone_invite_expires = NULL, phone_linked_at = now(),
              phone_device = $3, phone_last_used_at = now()
         FROM businesses b
        WHERE s.phone_invite_hash = $1 AND s.phone_invite_expires > now() AND s.active AND b.id = s.business_id AND b.status = 'active'
       RETURNING s.id, s.name, s.business_id, b.slug AS business_slug`,
      [sha256(invite), sha256(token), deviceName(request.headers['user-agent'])],
    );
    if (!s) {
      return reply.code(400).send({
        error: 'This link has already been used on a phone, or it has expired. If this is your phone, open the app from your home screen. Otherwise ask your admin for a new link.',
        code: 'invite-used',
      });
    }
    await audit(null, 'phone.claim', { staff: s.id }, s.business_id);
    return { token, businessSlug: s.business_slug, name: s.name };
  });

  app.register(async (m) => {
    m.addHook('preHandler', async (request, reply) => {
      const s = await staffFromToken(request);
      if (!s) return reply.code(401).send({ error: 'This phone is no longer set up for sign-in. Ask your admin for a new link.', code: 'no-access' });
      request.staff = s;
    });

    m.get('/api/me', async (request) => {
      const s = request.staff;
      const settings = await getSettings(s.business_id);
      const tz = settings.hours.timezone;
      const [today, warden] = await Promise.all([
        many(`SELECT state, at, changed_by FROM staff_presence WHERE staff_id = $1
                AND at >= (date_trunc('day', now() AT TIME ZONE $2) AT TIME ZONE $2) ORDER BY at`, [s.id, tz]),
        isFireWarden(s.id),
      ]);
      const p = settings.phone;
      return {
        name: s.name,
        businessSlug: s.business_slug,
        branding: publicBranding(settings.branding),
        presence: s.presence,
        presenceAt: s.presence_at,
        today,
        isWarden: warden,
        timezone: tz,
        phone: {
          enabled: p.enabled,
          locationCheck: p.locationCheck && p.lat !== null && p.lng !== null,
          radius: p.radius,
          signOutAnywhere: p.signOutAnywhere,
          noLocation: p.noLocation,
          siteName: settings.branding.companyName,
        },
      };
    });

    m.post('/api/me/presence', async (request, reply) => {
      const s = request.staff;
      const state = request.body?.state === 'in' ? 'in' : 'out';
      const { phone } = await getSettings(s.business_id);
      if (!phone.enabled) return reply.code(403).send({ error: 'Phone sign-in is turned off. Please use the reception iPad.' });
      const needsCheck = phone.locationCheck && phone.lat !== null && phone.lng !== null && (state === 'in' || !phone.signOutAnywhere);
      let distance = null;
      let note = 'Phone';
      if (needsCheck) {
        const lat = Number(request.body?.lat);
        const lng = Number(request.body?.lng);
        const accuracy = Math.max(0, Number(request.body?.accuracy) || 0);
        if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
          if (phone.noLocation !== 'allow') {
            return reply.code(403).send({ error: 'Your phone didn’t share its location, so you can’t sign in from it. Please sign in on the reception iPad.', code: 'no-location' });
          }
          note = 'Phone (no location)';
        } else {
          distance = Math.round(distanceM(lat, lng, phone.lat, phone.lng));
          // Allow for GPS error indoors (up to 100 m of the reported accuracy).
          if (distance - Math.min(accuracy, 100) > phone.radius) {
            return reply.code(403).send({
              error: `You’re ${distance >= 1000 ? `${(distance / 1000).toFixed(1)} km` : `${distance} m`} from the site. You can sign in when you’re on site (within ${phone.radius} m).`,
              code: 'too-far', distance,
            });
          }
        }
      }
      const r = await one('UPDATE staff SET presence = $2, presence_at = now() WHERE id = $1 RETURNING presence, presence_at', [s.id, state]);
      await query('INSERT INTO staff_presence (staff_id, state, changed_by, business_id) VALUES ($1, $2, $3, $4)', [s.id, state, note, s.business_id]);
      return { presence: r.presence, presenceAt: r.presence_at, distance };
    });
  });
}
