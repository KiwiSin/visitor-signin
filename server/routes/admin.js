import { setStaffGroups } from './phone.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import { audit, requireAdmin, SESSION_COOKIE } from '../auth.js';
import { config } from '../config.js';
import { csvObjects, toCsv } from '../csv.js';
import { many, one, query, tx } from '../db.js';
import { sendMail } from '../mailer.js';
import { encrypt, hashPassword, pairingCode, sha256, verifyPassword } from '../security.js';
import { DEFAULTS, getSettings, saveSetting } from '../settings.js';
import { formatDateTime, testEmail } from '../templates.js';
import { businessUrl } from '../business.js';
import { onSite, signOut } from '../visits.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HEX_RE = /^#[0-9a-f]{6}$/i;
const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const bool = (v) => v === true || v === 'true' || v === 1;

function bad(reply, error) {
  return reply.code(400).send({ error });
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

function validTimeZone(tz) {
  try { new Intl.DateTimeFormat('en-NZ', { timeZone: tz }); return true; } catch { return false; }
}

/** A 6-digit pairing code no other tablet (in any business) is waiting on. */
async function freePairingCode() {
  for (let i = 0; i < 20; i++) {
    const code = pairingCode();
    const taken = await one('SELECT 1 FROM kiosks WHERE pairing_code = $1 AND pairing_expires > now()', [code]);
    if (!taken) return code;
  }
  throw new Error('Could not make a pairing code. Try again.');
}

/** Settings as sent to the admin page: secrets replaced by flags. */
function safeSettings(s) {
  const { passEnc, ...email } = s.email;
  return { ...s, email: { ...email, hasPassword: !!passEnc } };
}

export default async function adminRoutes(app) {
  app.register(async (a) => {
    a.addHook('preHandler', requireAdmin);

    a.get('/api/admin/me', async (request) => ({ ...request.user, business: request.business }));

    // Web addresses for this business (shown on the Tablets page, in emails and setup steps).
    a.get('/api/admin/links', async (request) => ({
      admin: businessUrl(request.business, '/admin'),
      kiosk: businessUrl(request.business, '/kiosk'),
      rollcall: businessUrl(request.business, '/rollcall'),
    }));

    // ---------------------------------------------------------------- dashboard
    a.get('/api/admin/dashboard', async (request) => {
      const B = request.business.id;
      const tz = (await getSettings(B)).hours.timezone;
      const [onsite, today, staffIn, failed, kiosks] = await Promise.all([
        onSite(B),
        one(`SELECT count(*)::int AS n, count(*) FILTER (WHERE flagged)::int AS flagged FROM visits
              WHERE business_id = $1 AND signed_in_at >= (date_trunc('day', now() AT TIME ZONE $2) AT TIME ZONE $2)`, [B, tz]),
        many(`SELECT s.id, s.name, t.name AS team, s.presence_at FROM staff s LEFT JOIN teams t ON t.id = s.team_id
               WHERE s.business_id = $1 AND s.active AND s.presence = 'in' ORDER BY s.name`, [B]),
        many(`SELECT id, recipient, subject, last_error, created_at FROM notifications WHERE business_id = $1 AND status = 'failed'
               AND created_at > now() - interval '3 days' ORDER BY id DESC LIMIT 10`, [B]),
        many(`SELECT id, name, last_seen_at, token_hash IS NOT NULL AS paired FROM kiosks WHERE business_id = $1 ORDER BY name`, [B]),
      ]);
      return { onsite, today, staffIn: staffIn.length, staffInList: staffIn, failedEmails: failed, kiosks };
    });

    // ------------------------------------------------------------------- visits
    const visitQuery = async (B, q) => {
      const from = q.from && /^\d{4}-\d{2}-\d{2}$/.test(q.from) ? q.from : null;
      const to = q.to && /^\d{4}-\d{2}-\d{2}$/.test(q.to) ? q.to : null;
      const tz = (await getSettings(B)).hours.timezone;
      return many(
        `SELECT v.id, v.signed_in_at, v.signed_out_at, v.signed_out_by, v.flagged, v.answers, v.extra, v.host_name,
                v.signature_file IS NOT NULL AS has_signature, v.agreed_hs, v.hs_version,
                vi.name, vi.company, vi.mobile, vi.email, t.name AS type, k.name AS kiosk
           FROM visits v
           LEFT JOIN visitors vi ON vi.id = v.visitor_id
           LEFT JOIN visitor_types t ON t.id = v.type_id
           LEFT JOIN kiosks k ON k.id = v.kiosk_id
          WHERE v.business_id = $5
            AND ($1::date IS NULL OR v.signed_in_at >= ($1::date::timestamp AT TIME ZONE $6))
            AND ($2::date IS NULL OR v.signed_in_at < (($2::date + 1)::timestamp AT TIME ZONE $6))
            AND ($3 = '' OR vi.name ILIKE '%' || $3 || '%' OR vi.company ILIKE '%' || $3 || '%' OR v.host_name ILIKE '%' || $3 || '%')
          ORDER BY v.signed_in_at DESC LIMIT $4`,
        [from, to, str(q.q, 80), Math.min(Number(q.limit) || 300, 5000), B, tz],
      );
    };

    a.get('/api/admin/visits', async (request) => visitQuery(request.business.id, request.query));

    a.get('/api/admin/visits.csv', async (request, reply) => {
      const rows = await visitQuery(request.business.id, { ...request.query, limit: 5000 });
      const tz = (await getSettings(request.business.id)).hours.timezone;
      const csv = toCsv(rows, [
        { label: 'Signed in', value: (r) => formatDateTime(r.signed_in_at, tz) },
        { label: 'Signed out', value: (r) => (r.signed_out_at ? formatDateTime(r.signed_out_at, tz) : '') },
        { label: 'Name', value: (r) => r.name },
        { label: 'Company', value: (r) => r.company },
        { label: 'Mobile', value: (r) => r.mobile },
        { label: 'Email', value: (r) => r.email },
        { label: 'Type', value: (r) => r.type },
        { label: 'Host', value: (r) => r.host_name },
        { label: 'Vehicle', value: (r) => r.extra?.rego },
        { label: 'H&S agreed', value: (r) => (r.agreed_hs ? `Yes (v${r.hs_version})` : 'Not required') },
        { label: 'Flagged', value: (r) => (r.flagged ? 'Yes' : '') },
        { label: 'Tablet', value: (r) => r.kiosk },
        { label: 'Signed out by', value: (r) => r.signed_out_by },
      ]);
      reply.header('Content-Type', 'text/csv; charset=utf-8');
      reply.header('Content-Disposition', `attachment; filename="visits-${new Date().toISOString().slice(0, 10)}.csv"`);
      return `﻿${csv}`;
    });

    a.post('/api/admin/visits/:id/signout', async (request, reply) => {
      const ok = await signOut(request.business.id, request.params.id, 'admin');
      if (!ok) return reply.code(404).send({ error: 'Already signed out.' });
      await audit(request.user.id, 'visit.signout', { id: request.params.id }, request.business.id);
      return { ok: true };
    });

    a.get('/api/admin/visits/:id/signature', async (request, reply) => {
      if (!/^[0-9a-f-]{36}$/i.test(request.params.id)) return reply.code(404).send({ error: 'No signature.' });
      const v = await one('SELECT signature_file FROM visits WHERE id = $1 AND business_id = $2', [request.params.id, request.business.id]);
      if (!v?.signature_file) return reply.code(404).send({ error: 'No signature.' });
      const file = path.join(config.uploadDir, 'private', path.basename(v.signature_file));
      const buf = await fs.readFile(file).catch(() => null);
      if (!buf) return reply.code(404).send({ error: 'Signature file missing.' });
      reply.header('Content-Type', 'image/png').header('Cache-Control', 'private, no-store');
      return buf;
    });

    // -------------------------------------------------------------- staff/teams
    a.get('/api/admin/teams', async (request) => many(
      `SELECT t.*, (SELECT count(*)::int FROM staff s WHERE s.team_id = t.id AND s.active) AS staff_count FROM teams t WHERE t.business_id = $1 ORDER BY name`,
      [request.business.id],
    ));

    a.post('/api/admin/teams', async (request, reply) => {
      const name = str(request.body?.name, 80);
      const email = str(request.body?.email, 160);
      if (!name) return bad(reply, 'Enter a team name.');
      if (email && !EMAIL_RE.test(email)) return bad(reply, 'That email address doesn’t look right.');
      try {
        return await one('INSERT INTO teams (business_id, name, email) VALUES ($3, $1, nullif($2, \'\')) RETURNING *', [name, email, request.business.id]);
      } catch (e) {
        if (e.code === '23505') return bad(reply, 'A team with that name already exists.');
        throw e;
      }
    });

    a.put('/api/admin/teams/:id', async (request, reply) => {
      const name = str(request.body?.name, 80);
      const email = str(request.body?.email, 160);
      if (!name) return bad(reply, 'Enter a team name.');
      if (email && !EMAIL_RE.test(email)) return bad(reply, 'That email address doesn’t look right.');
      return one('UPDATE teams SET name=$2, email=nullif($3, \'\') WHERE id=$1 AND business_id=$4 RETURNING *', [Number(request.params.id), name, email, request.business.id]);
    });

    a.delete('/api/admin/teams/:id', async (request) => {
      await query('DELETE FROM teams WHERE id = $1 AND business_id = $2', [Number(request.params.id), request.business.id]);
      return { ok: true };
    });

    a.get('/api/admin/staff', async (request) => many(
      `SELECT s.id, s.name, s.email, s.mobile, s.team_id, t.name AS team, s.role, s.show_on_kiosk, s.presence, s.presence_at, s.source,
              s.phone_key_hash IS NOT NULL AS phone_linked, s.phone_linked_at, s.phone_device, s.phone_last_used_at,
              (s.phone_invite_hash IS NOT NULL AND s.phone_invite_expires > now()) AS phone_invited, s.phone_invite_expires,
              coalesce((SELECT array_agg(m.group_id ORDER BY m.group_id) FROM staff_group_members m WHERE m.staff_id = s.id), '{}') AS group_ids
         FROM staff s LEFT JOIN teams t ON t.id = s.team_id WHERE s.business_id = $1 AND s.active ORDER BY s.name`,
      [request.business.id],
    ));

    const staffInput = (b) => ({
      name: str(b.name, 120),
      email: str(b.email, 160).toLowerCase(),
      mobile: str(b.mobile, 40),
      teamId: b.teamId ? Number(b.teamId) : null,   // checked against the business below
      role: b.role === 'warden' ? 'warden' : 'staff',
      groupIds: Array.isArray(b.groupIds) ? b.groupIds : null,
      showOnKiosk: b.showOnKiosk === undefined ? true : bool(b.showOnKiosk),
    });

    a.post('/api/admin/staff', async (request, reply) => {
      const s = staffInput(request.body || {});
      if (!s.name) return bad(reply, 'Enter a name.');
      if (s.email && !EMAIL_RE.test(s.email)) return bad(reply, 'That email address doesn’t look right.');
      try {
        const row = await one(
          `INSERT INTO staff (business_id, name, email, mobile, team_id, role, show_on_kiosk)
           VALUES ($7, $1, nullif($2,''), nullif($3,''), (SELECT id FROM teams WHERE id = $4 AND business_id = $7), $5, $6) RETURNING id`,
          [s.name, s.email, s.mobile, s.teamId, s.role, s.showOnKiosk, request.business.id],
        );
        await tx((c) => setStaffGroups(c, row.id, request.business.id, s.groupIds ?? [], s.groupIds ? [] : (s.role === 'warden' ? ['fire_warden'] : [])));
        await audit(request.user.id, 'staff.add', { id: row.id, name: s.name }, request.business.id);
        return row;
      } catch (e) {
        if (e.code === '23505') return bad(reply, 'Someone with that email is already in the list.');
        throw e;
      }
    });

    a.put('/api/admin/staff/:id', async (request, reply) => {
      const s = staffInput(request.body || {});
      if (!s.name) return bad(reply, 'Enter a name.');
      if (s.email && !EMAIL_RE.test(s.email)) return bad(reply, 'That email address doesn’t look right.');
      try {
        await query(
          `UPDATE staff SET name=$2, email=nullif($3,''), mobile=nullif($4,''), team_id=(SELECT id FROM teams WHERE id = $5 AND business_id = $7),
                  show_on_kiosk=$6, updated_at=now() WHERE id=$1 AND business_id=$7`,
          [Number(request.params.id), s.name, s.email, s.mobile, s.teamId, s.showOnKiosk, request.business.id],
        );
        if (s.groupIds) await tx((c) => setStaffGroups(c, Number(request.params.id), request.business.id, s.groupIds));
        await audit(request.user.id, 'staff.edit', { id: Number(request.params.id) }, request.business.id);
        return { ok: true };
      } catch (e) {
        if (e.code === '23505') return bad(reply, 'Someone with that email is already in the list.');
        throw e;
      }
    });

    a.patch('/api/admin/staff/:id', async (request, reply) => {
      const b = request.body || {};
      const B = request.business.id;
      const id = Number(request.params.id);
      const s = await one('SELECT id FROM staff WHERE id=$1 AND business_id=$2 AND active', [id, B]);
      if (!s) return reply.code(404).send({ error: 'Staff member not found.' });
      if (b.showOnKiosk !== undefined) await query('UPDATE staff SET show_on_kiosk=$2, updated_at=now() WHERE id=$1', [id, bool(b.showOnKiosk)]);
      if (b.presence === 'in' || b.presence === 'out') {
        await query('UPDATE staff SET presence=$2, presence_at=now() WHERE id=$1', [id, b.presence]);
        await query('INSERT INTO staff_presence (staff_id, state, changed_by, business_id) VALUES ($1, $2, $3, $4)', [id, b.presence, `Admin: ${request.user.name}`, B]);
        await audit(request.user.id, `staff.${b.presence === 'in' ? 'signin' : 'signout'}`, { id }, B);
      }
      return one('SELECT id, presence, presence_at FROM staff WHERE id=$1', [id]);
    });

    a.delete('/api/admin/staff/:id', async (request) => {
      // Keep the row (past visits still show the host) but hide it everywhere.
      await query(`UPDATE staff SET active=false, email=NULL, show_on_kiosk=false, rollcall_key_hash=NULL,
                   phone_key_hash=NULL, phone_invite_hash=NULL, phone_invite_expires=NULL, updated_at=now() WHERE id=$1 AND business_id=$2`, [Number(request.params.id), request.business.id]);
      await audit(request.user.id, 'staff.remove', { id: Number(request.params.id) }, request.business.id);
      return { ok: true };
    });

    a.post('/api/admin/staff/import', async (request, reply) => {
      const rows = csvObjects(String(request.body?.csv || ''));
      if (!rows.length) return bad(reply, 'The file is empty. The first row must be headings: name, email, team, mobile.');
      if (!('name' in rows[0])) return bad(reply, 'Couldn’t find a "name" column. The first row must be headings: name, email, team, mobile.');
      const result = { added: 0, updated: 0, skipped: [] };
      const B = request.business.id;
      await tx(async (c) => {
        const teamIds = new Map();
        for (const [i, r] of rows.entries()) {
          const name = str(r.name, 120);
          const email = str(r.email, 160).toLowerCase();
          if (!name) { result.skipped.push(`Row ${i + 2}: no name`); continue; }
          if (email && !EMAIL_RE.test(email)) { result.skipped.push(`Row ${i + 2}: bad email "${email}"`); continue; }
          let teamId = null;
          const teamName = str(r.team || r.department, 80);
          if (teamName) {
            if (!teamIds.has(teamName.toLowerCase())) {
              const t = (await c.query(
                `INSERT INTO teams (business_id, name) VALUES ($2, $1) ON CONFLICT (business_id, name) DO UPDATE SET name = EXCLUDED.name RETURNING id`, [teamName, B],
              )).rows[0];
              teamIds.set(teamName.toLowerCase(), t.id);
            }
            teamId = teamIds.get(teamName.toLowerCase());
          }
          // Groups: "groups" column, separated by ; or | (e.g. "Fire warden; First aider"). "role: warden" also works.
          const groupNames = str(r.groups || r.group, 400).split(/[;|]/).map((g) => g.trim().toLowerCase()).filter(Boolean);
          if (/warden/i.test(r.role || '')) groupNames.push('fire warden');
          const role = groupNames.includes('fire warden') ? 'warden' : 'staff';
          let staffId;
          const existing = email
            ? (await c.query('SELECT id FROM staff WHERE business_id = $2 AND lower(email) = $1', [email, B])).rows[0]
            : (await c.query('SELECT id FROM staff WHERE business_id = $2 AND lower(name) = lower($1) AND active', [name, B])).rows[0];
          if (existing) {
            await c.query(
              `UPDATE staff SET name=$2, email=coalesce(nullif($3,''), email), mobile=coalesce(nullif($4,''), mobile), team_id=coalesce($5, team_id), active=true, updated_at=now() WHERE id=$1`,
              [existing.id, name, email, str(r.mobile || r.phone, 40), teamId],
            );
            staffId = existing.id;
            result.updated++;
          } else {
            staffId = (await c.query(
              `INSERT INTO staff (business_id, name, email, mobile, team_id, role, source) VALUES ($6, $1, nullif($2,''), nullif($3,''), $4, $5, 'csv') RETURNING id`,
              [name, email, str(r.mobile || r.phone, 40), teamId, role, B],
            )).rows[0].id;
            result.added++;
          }
          if (groupNames.length) {
            // Add to the named groups (existing ones only; unknown names are reported).
            await c.query(
              `INSERT INTO staff_group_members (staff_id, group_id) SELECT $1, id FROM staff_groups WHERE business_id = $2 AND lower(name) = ANY($3::text[])
               ON CONFLICT DO NOTHING`, [staffId, B, groupNames]);
            const known = (await c.query('SELECT lower(name) AS n FROM staff_groups WHERE business_id = $1', [B])).rows.map((g) => g.n);
            const unknown = [...new Set(groupNames.filter((g) => !known.includes(g)))];
            if (unknown.length) result.skipped.push(`Row ${i + 2}: no group called "${unknown.join('", "')}" (add it in Staff › Groups first)`);
            await c.query(`UPDATE staff SET role = 'warden' WHERE id = $1 AND EXISTS (SELECT 1 FROM staff_group_members m JOIN staff_groups g ON g.id = m.group_id
                             WHERE m.staff_id = $1 AND g.key = 'fire_warden')`, [staffId]);
          }
        }
      });
      await audit(request.user.id, 'staff.import', result, B);
      return result;
    });

    // ------------------------------------------------------------------ kiosks
    a.get('/api/admin/kiosks', async (request) => many(
      `SELECT id, name, default_type, pairing_code, pairing_expires, token_hash IS NOT NULL AS paired, paired_at, last_seen_at
         FROM kiosks WHERE business_id = $1 ORDER BY name`,
      [request.business.id],
    ));

    a.post('/api/admin/kiosks', async (request, reply) => {
      const name = str(request.body?.name, 80);
      if (!name) return bad(reply, 'Give the tablet a name, e.g. "Tablet 1 · Main entrance".');
      const row = await one(
        `INSERT INTO kiosks (business_id, site_id, name, default_type, pairing_code, pairing_expires)
         VALUES ($4, (SELECT id FROM sites WHERE business_id = $4 ORDER BY id LIMIT 1), $1, nullif($2,''), $3, now() + interval '30 minutes')
         RETURNING id, name, default_type, pairing_code, pairing_expires`,
        [name, str(request.body?.defaultType, 40), await freePairingCode(), request.business.id],
      );
      await audit(request.user.id, 'kiosk.add', { id: row.id, name }, request.business.id);
      return row;
    });

    a.put('/api/admin/kiosks/:id', async (request, reply) => {
      const name = str(request.body?.name, 80);
      if (!name) return bad(reply, 'Give the tablet a name.');
      await query(`UPDATE kiosks SET name=$2, default_type=nullif($3,'') WHERE id=$1 AND business_id=$4`, [Number(request.params.id), name, str(request.body?.defaultType, 40), request.business.id]);
      return { ok: true };
    });

    a.post('/api/admin/kiosks/:id/pair', async (request) => {
      // A new code also un-pairs whichever device held the old token.
      const row = await one(
        `UPDATE kiosks SET pairing_code=$2, pairing_expires=now() + interval '30 minutes', token_hash=NULL, paired_at=NULL
          WHERE id=$1 AND business_id=$3 RETURNING id, name, default_type, pairing_code, pairing_expires`,
        [Number(request.params.id), await freePairingCode(), request.business.id],
      );
      await audit(request.user.id, 'kiosk.repair', { id: row?.id }, request.business.id);
      return row;
    });

    a.delete('/api/admin/kiosks/:id', async (request) => {
      await query('DELETE FROM kiosks WHERE id=$1 AND business_id=$2', [Number(request.params.id), request.business.id]);
      await audit(request.user.id, 'kiosk.remove', { id: Number(request.params.id) }, request.business.id);
      return { ok: true };
    });

    // ----------------------------------------------------- visitor types & questions
    a.get('/api/admin/visitor-types', async (request) => many('SELECT * FROM visitor_types WHERE business_id = $1 ORDER BY sort, id', [request.business.id]));

    a.put('/api/admin/visitor-types/:id', async (request, reply) => {
      const b = request.body || {};
      const name = str(b.name, 60);
      if (!name) return bad(reply, 'Enter a name.');
      await query(
        `UPDATE visitor_types SET name=$2, ask_company=$3, ask_email=$4, ask_rego=$5, ask_induction_no=$6, require_host=$7, require_signature=$8, active=$9
          WHERE id=$1 AND business_id=$10`,
        [Number(request.params.id), name, bool(b.ask_company), bool(b.ask_email), bool(b.ask_rego), bool(b.ask_induction_no), bool(b.require_host), bool(b.require_signature), bool(b.active), request.business.id],
      );
      return { ok: true };
    });

    a.get('/api/admin/questions', async (request) => many('SELECT * FROM safety_questions WHERE business_id = $1 AND active ORDER BY sort, id', [request.business.id]));

    a.put('/api/admin/questions', async (request, reply) => {
      const list = Array.isArray(request.body?.questions) ? request.body.questions : null;
      if (!list) return bad(reply, 'No questions sent.');
      const B = request.business.id;
      await tx(async (c) => {
        await c.query('UPDATE safety_questions SET active=false WHERE business_id = $1', [B]);
        for (const [i, q] of list.entries()) {
          const text = str(q.text, 200);
          if (!text) continue;
          const flag = q.flag_answer === 'no' ? 'no' : 'yes';
          const upd = q.id ? await c.query('UPDATE safety_questions SET text=$2, flag_answer=$3, sort=$4, active=true WHERE id=$1 AND business_id=$5', [Number(q.id), text, flag, i, B]) : { rowCount: 0 };
          if (!upd.rowCount) await c.query('INSERT INTO safety_questions (business_id, text, flag_answer, sort) VALUES ($4,$1,$2,$3)', [text, flag, i, B]);
        }
      });
      await audit(request.user.id, 'questions.save', null, B);
      return many('SELECT * FROM safety_questions WHERE business_id = $1 AND active ORDER BY sort, id', [B]);
    });

    // ----------------------------------------------------------------- settings
    a.get('/api/admin/settings', async (request) => safeSettings(await getSettings(request.business.id)));

    a.put('/api/admin/settings/:section', async (request, reply) => {
      const section = request.params.section;
      const B = request.business.id;
      const current = await getSettings(B);
      const b = request.body || {};
      let next;
      if (section === 'branding') {
        const d = DEFAULTS.branding;
        next = {
          ...current.branding,
          appName: str(b.appName, 60) || d.appName,
          companyName: str(b.companyName, 80) || d.companyName,
          accent: HEX_RE.test(b.accent || '') ? b.accent : current.branding.accent,
          welcome: str(b.welcome, 80) || d.welcome,
          subtitle: str(b.subtitle, 160),
          locationName: str(b.locationName, 60) || d.locationName,
          assemblyPoint: str(b.assemblyPoint, 120),
          logo: typeof b.logo === 'string' && (b.logo === '' || b.logo.startsWith('/uploads/')) ? (b.logo || null) : current.branding.logo,
          logoOnLight: typeof b.logoOnLight === 'string' && (b.logoOnLight === '' || b.logoOnLight.startsWith('/uploads/')) ? (b.logoOnLight || null) : current.branding.logoOnLight,
          theme: str(b.theme, 40) || current.branding.theme,
          colors: Object.fromEntries(Object.entries(DEFAULTS.branding.colors).map(([k, def]) => {
            const v = b.colors?.[k];
            return [k, HEX_RE.test(v || '') ? v.toUpperCase() : (current.branding.colors?.[k] || def)];
          })),
          wallpapers: Array.isArray(b.wallpapers)
            ? b.wallpapers.filter((w) => typeof w === 'string' && (w.startsWith('/uploads/') || w.startsWith('/wallpapers/'))).slice(0, 12)
            : current.branding.wallpapers,
          wallpaper: Math.max(0, Number(b.wallpaper) || 0),
          rotateWallpapers: bool(b.rotateWallpapers),
          scrim: Math.min(0.8, Math.max(0, Number(b.scrim) || 0)),
        };
      } else if (section === 'email') {
        const method = ['none', 'relay', 'smtp'].includes(b.method) ? b.method : 'none';
        const from = str(b.from, 160);
        const replyTo = str(b.replyTo, 160);
        if (from && !EMAIL_RE.test(from)) return bad(reply, '"Send from" isn’t a valid email address.');
        if (replyTo && !EMAIL_RE.test(replyTo)) return bad(reply, '"Replies go to" isn’t a valid email address.');
        if (method !== 'none' && !str(b.host)) return bad(reply, 'Enter the mail server name or IP address.');
        next = {
          method,
          host: str(b.host, 200),
          port: Number(b.port) || (method === 'relay' ? 25 : 587),
          security: ['none', 'starttls', 'tls'].includes(b.security) ? b.security : 'none',
          allowSelfSigned: bool(b.allowSelfSigned),
          user: str(b.user, 160),
          passEnc: b.clearPassword ? '' : (typeof b.password === 'string' && b.password !== '' ? encrypt(b.password) : current.email.passEnc),
          from,
          fromName: str(b.fromName, 80),
          replyTo,
        };
      } else if (section === 'notify') {
        const receptionMailbox = str(b.receptionMailbox, 160);
        const flaggedTo = str(b.flaggedTo, 160);
        if (receptionMailbox && !EMAIL_RE.test(receptionMailbox)) return bad(reply, 'The reception mailbox isn’t a valid email address.');
        if (flaggedTo && !EMAIL_RE.test(flaggedTo)) return bad(reply, 'The safety contact isn’t a valid email address.');
        next = {
          hostOnSignIn: bool(b.hostOnSignIn),
          hostOnSignOut: bool(b.hostOnSignOut),
          receptionMailbox,
          copyReception: bool(b.copyReception),
          flaggedTo,
        };
      } else if (section === 'safety') {
        const text = typeof b.text === 'string' ? b.text.trim().slice(0, 8000) : current.safety.text;
        if (!text) return bad(reply, 'The Health & Safety text can’t be empty.');
        next = { text, version: text === current.safety.text ? current.safety.version : current.safety.version + 1 };
      } else if (section === 'hours') {
        const tz = str(b.timezone, 60) || current.hours.timezone;
        if (!validTimeZone(tz)) return bad(reply, 'That time zone isn’t recognised. Use a name like Pacific/Auckland.');
        const days = {};
        for (const d of DAYS) {
          const v = b.days?.[d] || current.hours.days[d];
          const start = TIME_RE.test(v.start || '') ? v.start : current.hours.days[d].start;
          const end = TIME_RE.test(v.end || '') ? v.end : current.hours.days[d].end;
          if (bool(v.open) && start >= end) return bad(reply, `Closing time must be after opening time (${d}).`);
          days[d] = { open: bool(v.open), start, end };
        }
        const a2 = b.autoSignOut || {};
        const mode = ['off', 'time', 'closing'].includes(a2.mode) ? a2.mode : 'time';
        if (mode === 'time' && !TIME_RE.test(a2.time || '')) return bad(reply, 'Enter the automatic sign-out time as HH:MM, e.g. 23:00.');
        next = {
          timezone: tz,
          days,
          autoSignOut: {
            mode,
            time: TIME_RE.test(a2.time || '') ? a2.time : current.hours.autoSignOut.time,
            afterClosingMins: Math.min(600, Math.max(0, Math.round(Number(a2.afterClosingMins) || 0))),
            visitors: bool(a2.visitors),
            staff: bool(a2.staff),
            emailReception: bool(a2.emailReception),
          },
        };
      } else if (section === 'phone') {
        const lat = b.lat === null || b.lat === '' ? null : Number(b.lat);
        const lng = b.lng === null || b.lng === '' ? null : Number(b.lng);
        if ((lat === null) !== (lng === null)) return bad(reply, 'Set both latitude and longitude, or neither.');
        if (lat !== null && (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180)) return bad(reply, 'That location isn’t valid.');
        if (bool(b.locationCheck) && lat === null) return bad(reply, 'Put the pin on your site first, or turn off the location check.');
        next = {
          enabled: bool(b.enabled),
          locationCheck: bool(b.locationCheck),
          lat: lat === null ? null : Math.round(lat * 1e6) / 1e6,
          lng: lng === null ? null : Math.round(lng * 1e6) / 1e6,
          address: str(b.address, 200),
          radius: Math.min(5000, Math.max(50, Math.round(Number(b.radius) || 200))),
          signOutAnywhere: bool(b.signOutAnywhere),
          noLocation: b.noLocation === 'allow' ? 'allow' : 'block',
        };
      } else if (section === 'privacy') {
        next = {
          notice: str(b.notice, 600),
          retentionMonths: Math.min(120, Math.max(1, Number(b.retentionMonths) || 12)),
        };
      } else {
        return reply.code(404).send({ error: 'Unknown settings section.' });
      }
      await saveSetting(B, section, next);
      if (section === 'branding' && next.companyName) await query('UPDATE businesses SET name = $2 WHERE id = $1', [B, next.companyName]);
      await audit(request.user.id, `settings.${section}`, null, B);
      return safeSettings(await getSettings(B));
    });

    a.post('/api/admin/email/test', async (request, reply) => {
      const to = str(request.body?.to, 160);
      if (!EMAIL_RE.test(to)) return bad(reply, 'Enter the address to send the test to.');
      const { email, branding } = await getSettings(request.business.id);
      try {
        await sendMail(email, { to, ...testEmail(branding) });
        return { ok: true };
      } catch (err) {
        return bad(reply, `Couldn’t send: ${err.message}`);
      }
    });

    a.get('/api/admin/notifications', async (request) => many(
      `SELECT id, kind, recipient, subject, status, attempts, last_error, created_at, sent_at FROM notifications WHERE business_id = $1 ORDER BY id DESC LIMIT 100`,
      [request.business.id],
    ));

    a.post('/api/admin/notifications/:id/retry', async (request) => {
      await query(`UPDATE notifications SET status='pending', next_attempt_at=now(), created_at=now() WHERE id=$1 AND business_id=$2`, [Number(request.params.id), request.business.id]);
      return { ok: true };
    });

    // ------------------------------------------------------------------ uploads
    a.post('/api/admin/uploads', async (request, reply) => {
      const file = await request.file();
      if (!file) return bad(reply, 'No file received.');
      const ext = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' }[file.mimetype];
      if (!ext) return bad(reply, 'Use a PNG, JPG or WebP image.');
      const dir = path.join(config.uploadDir, 'public');
      await fs.mkdir(dir, { recursive: true });
      const name = `${crypto.randomUUID()}${ext}`;
      await pipeline(file.file, createWriteStream(path.join(dir, name)));
      if (file.file.truncated) {
        await fs.rm(path.join(dir, name), { force: true });
        return bad(reply, 'That image is too big (max 8 MB).');
      }
      return { url: `/uploads/${name}` };
    });

    // -------------------------------------------------------------- admin users
    a.get('/api/admin/users', async (request) => many('SELECT id, name, email, role, is_host, created_at, last_login_at FROM admin_users WHERE business_id = $1 ORDER BY name', [request.business.id]));

    a.post('/api/admin/users', async (request, reply) => {
      const { name, email, password } = request.body || {};
      if (!str(name) || !EMAIL_RE.test(email || '')) return bad(reply, 'Enter a name and a valid email.');
      if (!password || password.length < 10) return bad(reply, 'Use a password of at least 10 characters.');
      try {
        const row = await one('INSERT INTO admin_users (name, email, password_hash, business_id) VALUES ($1, lower($2), $3, $4) RETURNING id, name, email',
          [str(name, 120), email.trim(), await hashPassword(password), request.business.id]);
        await audit(request.user.id, 'user.add', { id: row.id }, request.business.id);
        return row;
      } catch (e) {
        if (e.code === '23505') return bad(reply, 'That email already has an account.');
        throw e;
      }
    });

    a.delete('/api/admin/users/:id', async (request, reply) => {
      if (Number(request.params.id) === request.user.id) return bad(reply, 'You can’t remove your own account.');
      // Business admins can't remove a Host Admin; Host Admins are managed in the Host console.
      const r = await query('DELETE FROM admin_users WHERE id=$1 AND business_id=$2 AND (NOT is_host OR $3)', [Number(request.params.id), request.business.id, !!request.user.is_host]);
      if (!r.rowCount) return bad(reply, 'That account can’t be removed here.');
      await audit(request.user.id, 'user.remove', { id: Number(request.params.id) }, request.business.id);
      return { ok: true };
    });

    a.put('/api/admin/me/password', async (request, reply) => {
      const { current, password } = request.body || {};
      const u = await one('SELECT password_hash FROM admin_users WHERE id=$1', [request.user.id]);
      if (!(await verifyPassword(String(current || ''), u.password_hash))) return bad(reply, 'Your current password is wrong.');
      if (!password || password.length < 10) return bad(reply, 'Use a password of at least 10 characters.');
      await query('UPDATE admin_users SET password_hash=$2 WHERE id=$1', [request.user.id, await hashPassword(password)]);
      // Sign out this account everywhere else; keep the current session.
      await query('DELETE FROM sessions WHERE user_id=$1 AND token_hash <> $2', [request.user.id, sha256(request.cookies[SESSION_COOKIE] || '')]);
      return { ok: true };
    });
  });
}
