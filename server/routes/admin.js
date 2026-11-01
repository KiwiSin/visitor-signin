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
import { onSite, signOut } from '../visits.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HEX_RE = /^#[0-9a-f]{6}$/i;
const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const bool = (v) => v === true || v === 'true' || v === 1;

function bad(reply, error) {
  return reply.code(400).send({ error });
}

/** Settings as sent to the admin page: secrets replaced by flags. */
function safeSettings(s) {
  const { passEnc, ...email } = s.email;
  return { ...s, email: { ...email, hasPassword: !!passEnc } };
}

export default async function adminRoutes(app) {
  app.register(async (a) => {
    a.addHook('preHandler', requireAdmin);

    a.get('/api/admin/me', async (request) => request.user);

    // ---------------------------------------------------------------- dashboard
    a.get('/api/admin/dashboard', async () => {
      const [onsite, today, staffIn, failed, kiosks] = await Promise.all([
        onSite(null),
        one(`SELECT count(*)::int AS n, count(*) FILTER (WHERE flagged)::int AS flagged FROM visits
              WHERE signed_in_at >= date_trunc('day', now())`),
        many(`SELECT s.id, s.name, t.name AS team, s.presence_at FROM staff s LEFT JOIN teams t ON t.id = s.team_id
               WHERE s.active AND s.presence = 'in' ORDER BY s.name`),
        many(`SELECT id, recipient, subject, last_error, created_at FROM notifications WHERE status = 'failed'
               AND created_at > now() - interval '3 days' ORDER BY id DESC LIMIT 10`),
        many(`SELECT id, name, last_seen_at, token_hash IS NOT NULL AS paired FROM kiosks ORDER BY name`),
      ]);
      return { onsite, today, staffIn: staffIn.length, staffInList: staffIn, failedEmails: failed, kiosks };
    });

    // ------------------------------------------------------------------- visits
    const visitQuery = async (q) => {
      const from = q.from && !Number.isNaN(Date.parse(q.from)) ? q.from : null;
      const to = q.to && !Number.isNaN(Date.parse(q.to)) ? q.to : null;
      return many(
        `SELECT v.id, v.signed_in_at, v.signed_out_at, v.signed_out_by, v.flagged, v.answers, v.extra, v.host_name,
                v.signature_file IS NOT NULL AS has_signature, v.agreed_hs, v.hs_version,
                vi.name, vi.company, vi.mobile, vi.email, t.name AS type, k.name AS kiosk
           FROM visits v
           LEFT JOIN visitors vi ON vi.id = v.visitor_id
           LEFT JOIN visitor_types t ON t.id = v.type_id
           LEFT JOIN kiosks k ON k.id = v.kiosk_id
          WHERE ($1::date IS NULL OR v.signed_in_at >= $1::date)
            AND ($2::date IS NULL OR v.signed_in_at < $2::date + 1)
            AND ($3 = '' OR vi.name ILIKE '%' || $3 || '%' OR vi.company ILIKE '%' || $3 || '%' OR v.host_name ILIKE '%' || $3 || '%')
          ORDER BY v.signed_in_at DESC LIMIT $4`,
        [from, to, str(q.q, 80), Math.min(Number(q.limit) || 300, 5000)],
      );
    };

    a.get('/api/admin/visits', async (request) => visitQuery(request.query));

    a.get('/api/admin/visits.csv', async (request, reply) => {
      const rows = await visitQuery({ ...request.query, limit: 5000 });
      const csv = toCsv(rows, [
        { label: 'Signed in', value: (r) => formatDateTime(r.signed_in_at) },
        { label: 'Signed out', value: (r) => (r.signed_out_at ? formatDateTime(r.signed_out_at) : '') },
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
      const ok = await signOut(request.params.id, 'admin');
      if (!ok) return reply.code(404).send({ error: 'Already signed out.' });
      await audit(request.user.id, 'visit.signout', { id: request.params.id });
      return { ok: true };
    });

    a.get('/api/admin/visits/:id/signature', async (request, reply) => {
      const v = await one('SELECT signature_file FROM visits WHERE id = $1', [request.params.id]);
      if (!v?.signature_file) return reply.code(404).send({ error: 'No signature.' });
      const file = path.join(config.uploadDir, 'private', path.basename(v.signature_file));
      const buf = await fs.readFile(file).catch(() => null);
      if (!buf) return reply.code(404).send({ error: 'Signature file missing.' });
      reply.header('Content-Type', 'image/png').header('Cache-Control', 'private, no-store');
      return buf;
    });

    // -------------------------------------------------------------- staff/teams
    a.get('/api/admin/teams', async () => many(
      `SELECT t.*, (SELECT count(*)::int FROM staff s WHERE s.team_id = t.id AND s.active) AS staff_count FROM teams t ORDER BY name`,
    ));

    a.post('/api/admin/teams', async (request, reply) => {
      const name = str(request.body?.name, 80);
      const email = str(request.body?.email, 160);
      if (!name) return bad(reply, 'Enter a team name.');
      if (email && !EMAIL_RE.test(email)) return bad(reply, 'That email address doesn’t look right.');
      try {
        return await one('INSERT INTO teams (name, email) VALUES ($1, nullif($2, \'\')) RETURNING *', [name, email]);
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
      return one('UPDATE teams SET name=$2, email=nullif($3, \'\') WHERE id=$1 RETURNING *', [Number(request.params.id), name, email]);
    });

    a.delete('/api/admin/teams/:id', async (request) => {
      await query('DELETE FROM teams WHERE id = $1', [Number(request.params.id)]);
      return { ok: true };
    });

    a.get('/api/admin/staff', async () => many(
      `SELECT s.id, s.name, s.email, s.mobile, s.team_id, t.name AS team, s.role, s.show_on_kiosk, s.presence, s.presence_at, s.source,
              s.rollcall_key_hash IS NOT NULL AS has_rollcall_link, s.rollcall_key_created_at
         FROM staff s LEFT JOIN teams t ON t.id = s.team_id WHERE s.active ORDER BY s.name`,
    ));

    const staffInput = (b) => ({
      name: str(b.name, 120),
      email: str(b.email, 160).toLowerCase(),
      mobile: str(b.mobile, 40),
      teamId: b.teamId ? Number(b.teamId) : null,
      role: b.role === 'warden' ? 'warden' : 'staff',
      showOnKiosk: b.showOnKiosk === undefined ? true : bool(b.showOnKiosk),
    });

    a.post('/api/admin/staff', async (request, reply) => {
      const s = staffInput(request.body || {});
      if (!s.name) return bad(reply, 'Enter a name.');
      if (s.email && !EMAIL_RE.test(s.email)) return bad(reply, 'That email address doesn’t look right.');
      try {
        const row = await one(
          `INSERT INTO staff (name, email, mobile, team_id, role, show_on_kiosk) VALUES ($1, nullif($2,''), nullif($3,''), $4, $5, $6) RETURNING id`,
          [s.name, s.email, s.mobile, s.teamId, s.role, s.showOnKiosk],
        );
        await audit(request.user.id, 'staff.add', { id: row.id, name: s.name });
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
          `UPDATE staff SET name=$2, email=nullif($3,''), mobile=nullif($4,''), team_id=$5, role=$6, show_on_kiosk=$7, updated_at=now() WHERE id=$1`,
          [Number(request.params.id), s.name, s.email, s.mobile, s.teamId, s.role, s.showOnKiosk],
        );
        await audit(request.user.id, 'staff.edit', { id: Number(request.params.id) });
        return { ok: true };
      } catch (e) {
        if (e.code === '23505') return bad(reply, 'Someone with that email is already in the list.');
        throw e;
      }
    });

    a.patch('/api/admin/staff/:id', async (request) => {
      const b = request.body || {};
      if (b.showOnKiosk !== undefined) await query('UPDATE staff SET show_on_kiosk=$2, updated_at=now() WHERE id=$1', [Number(request.params.id), bool(b.showOnKiosk)]);
      if (b.presence === 'in' || b.presence === 'out') {
        await query('UPDATE staff SET presence=$2, presence_at=now() WHERE id=$1', [Number(request.params.id), b.presence]);
        await query('INSERT INTO staff_presence (staff_id, state, changed_by) VALUES ($1, $2, $3)', [Number(request.params.id), b.presence, `Admin: ${request.user.name}`]);
        await audit(request.user.id, `staff.${b.presence === 'in' ? 'signin' : 'signout'}`, { id: Number(request.params.id) });
      }
      return one('SELECT id, presence, presence_at FROM staff WHERE id=$1', [Number(request.params.id)]);
    });

    a.delete('/api/admin/staff/:id', async (request) => {
      // Keep the row (past visits still show the host) but hide it everywhere.
      await query(`UPDATE staff SET active=false, email=NULL, show_on_kiosk=false, rollcall_key_hash=NULL, updated_at=now() WHERE id=$1`, [Number(request.params.id)]);
      await audit(request.user.id, 'staff.remove', { id: Number(request.params.id) });
      return { ok: true };
    });

    a.post('/api/admin/staff/import', async (request, reply) => {
      const rows = csvObjects(String(request.body?.csv || ''));
      if (!rows.length) return bad(reply, 'The file is empty. The first row must be headings: name, email, team, mobile.');
      if (!('name' in rows[0])) return bad(reply, 'Couldn’t find a "name" column. The first row must be headings: name, email, team, mobile.');
      const result = { added: 0, updated: 0, skipped: [] };
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
                `INSERT INTO teams (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id`, [teamName],
              )).rows[0];
              teamIds.set(teamName.toLowerCase(), t.id);
            }
            teamId = teamIds.get(teamName.toLowerCase());
          }
          const role = /warden/i.test(r.role || '') ? 'warden' : 'staff';
          const existing = email
            ? (await c.query('SELECT id FROM staff WHERE lower(email) = $1', [email])).rows[0]
            : (await c.query('SELECT id FROM staff WHERE lower(name) = lower($1) AND active', [name])).rows[0];
          if (existing) {
            await c.query(
              `UPDATE staff SET name=$2, email=coalesce(nullif($3,''), email), mobile=coalesce(nullif($4,''), mobile), team_id=coalesce($5, team_id), role=$6, active=true, updated_at=now() WHERE id=$1`,
              [existing.id, name, email, str(r.mobile || r.phone, 40), teamId, role],
            );
            result.updated++;
          } else {
            await c.query(
              `INSERT INTO staff (name, email, mobile, team_id, role, source) VALUES ($1, nullif($2,''), nullif($3,''), $4, $5, 'csv')`,
              [name, email, str(r.mobile || r.phone, 40), teamId, role],
            );
            result.added++;
          }
        }
      });
      await audit(request.user.id, 'staff.import', result);
      return result;
    });

    // ------------------------------------------------------------------ kiosks
    a.get('/api/admin/kiosks', async () => many(
      `SELECT id, name, default_type, pairing_code, pairing_expires, token_hash IS NOT NULL AS paired, paired_at, last_seen_at
         FROM kiosks ORDER BY name`,
    ));

    a.post('/api/admin/kiosks', async (request, reply) => {
      const name = str(request.body?.name, 80);
      if (!name) return bad(reply, 'Give the tablet a name, e.g. "Tablet 1 · Main entrance".');
      const row = await one(
        `INSERT INTO kiosks (site_id, name, default_type, pairing_code, pairing_expires) VALUES (1, $1, nullif($2,''), $3, now() + interval '30 minutes') RETURNING *`,
        [name, str(request.body?.defaultType, 40), pairingCode()],
      );
      await audit(request.user.id, 'kiosk.add', { id: row.id, name });
      return row;
    });

    a.put('/api/admin/kiosks/:id', async (request, reply) => {
      const name = str(request.body?.name, 80);
      if (!name) return bad(reply, 'Give the tablet a name.');
      await query(`UPDATE kiosks SET name=$2, default_type=nullif($3,'') WHERE id=$1`, [Number(request.params.id), name, str(request.body?.defaultType, 40)]);
      return { ok: true };
    });

    a.post('/api/admin/kiosks/:id/pair', async (request) => {
      // A new code also un-pairs whichever device held the old token.
      const row = await one(
        `UPDATE kiosks SET pairing_code=$2, pairing_expires=now() + interval '30 minutes', token_hash=NULL, paired_at=NULL WHERE id=$1 RETURNING *`,
        [Number(request.params.id), pairingCode()],
      );
      await audit(request.user.id, 'kiosk.repair', { id: row?.id });
      return row;
    });

    a.delete('/api/admin/kiosks/:id', async (request) => {
      await query('DELETE FROM kiosks WHERE id=$1', [Number(request.params.id)]);
      await audit(request.user.id, 'kiosk.remove', { id: Number(request.params.id) });
      return { ok: true };
    });

    // ----------------------------------------------------- visitor types & questions
    a.get('/api/admin/visitor-types', async () => many('SELECT * FROM visitor_types ORDER BY sort, id'));

    a.put('/api/admin/visitor-types/:id', async (request, reply) => {
      const b = request.body || {};
      const name = str(b.name, 60);
      if (!name) return bad(reply, 'Enter a name.');
      await query(
        `UPDATE visitor_types SET name=$2, ask_company=$3, ask_email=$4, ask_rego=$5, ask_induction_no=$6, require_host=$7, require_signature=$8, active=$9 WHERE id=$1`,
        [Number(request.params.id), name, bool(b.ask_company), bool(b.ask_email), bool(b.ask_rego), bool(b.ask_induction_no), bool(b.require_host), bool(b.require_signature), bool(b.active)],
      );
      return { ok: true };
    });

    a.get('/api/admin/questions', async () => many('SELECT * FROM safety_questions WHERE active ORDER BY sort, id'));

    a.put('/api/admin/questions', async (request, reply) => {
      const list = Array.isArray(request.body?.questions) ? request.body.questions : null;
      if (!list) return bad(reply, 'No questions sent.');
      await tx(async (c) => {
        await c.query('UPDATE safety_questions SET active=false');
        for (const [i, q] of list.entries()) {
          const text = str(q.text, 200);
          if (!text) continue;
          const flag = q.flag_answer === 'no' ? 'no' : 'yes';
          if (q.id) await c.query('UPDATE safety_questions SET text=$2, flag_answer=$3, sort=$4, active=true WHERE id=$1', [Number(q.id), text, flag, i]);
          else await c.query('INSERT INTO safety_questions (text, flag_answer, sort) VALUES ($1,$2,$3)', [text, flag, i]);
        }
      });
      await audit(request.user.id, 'questions.save');
      return many('SELECT * FROM safety_questions WHERE active ORDER BY sort, id');
    });

    // ----------------------------------------------------------------- settings
    a.get('/api/admin/settings', async () => safeSettings(await getSettings()));

    a.put('/api/admin/settings/:section', async (request, reply) => {
      const section = request.params.section;
      const current = await getSettings();
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
      } else if (section === 'privacy') {
        next = {
          notice: str(b.notice, 600),
          retentionMonths: Math.min(120, Math.max(1, Number(b.retentionMonths) || 12)),
        };
      } else {
        return reply.code(404).send({ error: 'Unknown settings section.' });
      }
      await saveSetting(section, next);
      await audit(request.user.id, `settings.${section}`);
      return safeSettings(await getSettings());
    });

    a.post('/api/admin/email/test', async (request, reply) => {
      const to = str(request.body?.to, 160);
      if (!EMAIL_RE.test(to)) return bad(reply, 'Enter the address to send the test to.');
      const { email, branding } = await getSettings();
      try {
        await sendMail(email, { to, ...testEmail(branding) });
        return { ok: true };
      } catch (err) {
        return bad(reply, `Couldn’t send: ${err.message}`);
      }
    });

    a.get('/api/admin/notifications', async () => many(
      `SELECT id, kind, recipient, subject, status, attempts, last_error, created_at, sent_at FROM notifications ORDER BY id DESC LIMIT 100`,
    ));

    a.post('/api/admin/notifications/:id/retry', async (request) => {
      await query(`UPDATE notifications SET status='pending', next_attempt_at=now(), created_at=now() WHERE id=$1`, [Number(request.params.id)]);
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
    a.get('/api/admin/users', async () => many('SELECT id, name, email, role, created_at, last_login_at FROM admin_users ORDER BY name'));

    a.post('/api/admin/users', async (request, reply) => {
      const { name, email, password } = request.body || {};
      if (!str(name) || !EMAIL_RE.test(email || '')) return bad(reply, 'Enter a name and a valid email.');
      if (!password || password.length < 10) return bad(reply, 'Use a password of at least 10 characters.');
      try {
        const row = await one('INSERT INTO admin_users (name, email, password_hash) VALUES ($1, lower($2), $3) RETURNING id, name, email',
          [str(name, 120), email.trim(), await hashPassword(password)]);
        await audit(request.user.id, 'user.add', { id: row.id });
        return row;
      } catch (e) {
        if (e.code === '23505') return bad(reply, 'That email already has an account.');
        throw e;
      }
    });

    a.delete('/api/admin/users/:id', async (request, reply) => {
      if (Number(request.params.id) === request.user.id) return bad(reply, 'You can’t remove your own account.');
      await query('DELETE FROM admin_users WHERE id=$1', [Number(request.params.id)]);
      await audit(request.user.id, 'user.remove', { id: Number(request.params.id) });
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
