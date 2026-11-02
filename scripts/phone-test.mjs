// Staff phone app test. Run after scripts/smoke-test.mjs on the same server:
//   node scripts/phone-test.mjs http://localhost:8080
const B = process.argv[2] || 'http://localhost:8080';
let cookie = '';
const j = async (p, { method = 'GET', body, h, expect = 200 } = {}) => {
  const r = await fetch(B + p, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(h ? {} : cookie ? { Cookie: cookie } : {}), ...(h || {}), 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const sc = r.headers.get('set-cookie');
  if (sc && !h) cookie = sc.split(';')[0];
  const t = await r.text();
  if (r.status !== expect) throw new Error(`${method} ${p} → ${r.status} (expected ${expect}): ${t.slice(0, 300)}`);
  return r.headers.get('content-type')?.includes('json') ? JSON.parse(t) : t;
};
const ok = (c, m) => { if (!c) throw new Error('FAIL ' + m); console.log('  ✓', m); };

// Site: Auckland Sky Tower, 200 m radius.
const SITE = { lat: -36.848461, lng: 174.762183 };
const near = { lat: -36.8490, lng: 174.7630, accuracy: 20 };   // ~90 m away
const far = { lat: -36.8600, lng: 174.7700, accuracy: 20 };    // ~1.4 km away

await j('/api/auth/login', { method: 'POST', body: { email: 'admin@acme.co.nz', password: 'correct-horse-battery' } });
const settings = await j('/api/admin/settings');
ok(settings.phone && settings.phone.enabled && settings.phone.noLocation === 'block', 'phone settings have defaults');
await j('/api/admin/settings/phone', { method: 'PUT', body: { ...settings.phone, locationCheck: true, lat: null, lng: null }, expect: 400 });
ok(true, 'location check needs a pin first');
await j('/api/admin/settings/phone', { method: 'PUT', body: { ...settings.phone, locationCheck: true, ...SITE, radius: 200, signOutAnywhere: true, noLocation: 'block' } });

// Groups
const groups = await j('/api/admin/groups');
ok(groups.map((g) => g.name).join() === 'Fire warden,First aider,Management', 'built-in groups: Fire warden, First aider, Management');
const g = await j('/api/admin/groups', { method: 'POST', body: { name: 'Forklift', color: '#B45309' } });
await j('/api/admin/groups', { method: 'POST', body: { name: 'forklift' }, expect: 400 });
ok(g.id, 'custom group added; duplicate name refused');
await j(`/api/admin/groups/${groups[0].id}`, { method: 'DELETE', expect: 400 });
ok(true, 'Fire warden group can’t be deleted');

const staff = await j('/api/admin/staff');
const mike = staff.find((s) => s.name === 'Mike Patel');
await j(`/api/admin/staff/${mike.id}/groups`, { method: 'PUT', body: { groupIds: [groups[1].id, g.id] } });
ok((await j('/api/admin/groups')).find((x) => x.id === g.id).members === 1, 'Mike added to First aider + Forklift');
await j(`/api/admin/groups/${g.id}`, { method: 'DELETE' });

// Link + claim
const link = await j(`/api/admin/staff/${mike.id}/phone-link`, { method: 'POST', body: { send: true } });
ok(link.emailed && link.url.includes('/me#invite='), 'phone link emailed');
const invite = link.url.split('#invite=')[1];
let st = (await j('/api/admin/staff')).find((s) => s.id === mike.id);
ok(st.phone_invited && !st.phone_linked, 'Staff list shows "invite sent"');
const claim = await j('/api/me/claim', { method: 'POST', body: { invite }, h: {} });
ok(claim.token && claim.name === 'Mike Patel', 'link opened on phone: device token issued');
await j('/api/me/claim', { method: 'POST', body: { invite }, h: {}, expect: 400 });
ok(true, 'the same link can’t be used on a second phone');
st = (await j('/api/admin/staff')).find((s) => s.id === mike.id);
ok(st.phone_linked && st.phone_device === 'iPhone', 'Staff list shows linked iPhone');

const P = { 'X-Staff-Token': claim.token };
const me = await j('/api/me', { h: P });
ok(me.name === 'Mike Patel' && me.isWarden === false && me.phone.locationCheck && me.branding.companyName, 'phone app loads (not a warden)');
await j('/api/rollcall/state', { h: P, expect: 401 });
ok(true, 'non-warden can’t open the roll call');

// Location rules
await j('/api/me/presence', { method: 'POST', h: P, body: { state: 'in' }, expect: 403 });
ok(true, 'no location shared → blocked (use the reception iPad)');
const tooFar = await j('/api/me/presence', { method: 'POST', h: P, body: { state: 'in', ...far }, expect: 403 });
ok(tooFar.code === 'too-far' && /km from the site/.test(tooFar.error), `too far: "${tooFar.error}"`);
const inn = await j('/api/me/presence', { method: 'POST', h: P, body: { state: 'in', ...near } });
ok(inn.presence === 'in' && inn.distance < 200, `signed in ${inn.distance} m from site`);
const out = await j('/api/me/presence', { method: 'POST', h: P, body: { state: 'out' } });
ok(out.presence === 'out', 'sign out works anywhere, no location needed');
const fuzzy = await j('/api/me/presence', { method: 'POST', h: P, body: { state: 'in', lat: -36.8505, lng: 174.7640, accuracy: 80 } });
ok(fuzzy.presence === 'in', `poor GPS accuracy is allowed for (${fuzzy.distance} m, ±80 m)`);
const today = (await j('/api/me', { h: P })).today;
ok(today.length === 3 && today.every((e) => e.changed_by === 'Phone'), 'today’s history recorded as "Phone"');

await j('/api/admin/settings/phone', { method: 'PUT', body: { ...settings.phone, locationCheck: true, ...SITE, signOutAnywhere: false, noLocation: 'allow' } });
await j('/api/me/presence', { method: 'POST', h: P, body: { state: 'out', ...far }, expect: 403 });
ok(true, 'with "sign out anywhere" off, signing out far away is refused');
const nl = await j('/api/me/presence', { method: 'POST', h: P, body: { state: 'out' } });
ok(nl.presence === 'out', 'with "allow" set, no location is accepted');



await j('/api/admin/settings/phone', { method: 'PUT', body: { ...settings.phone, ...SITE, enabled: false } });
await j('/api/me/presence', { method: 'POST', h: P, body: { state: 'in', ...near }, expect: 403 });
ok(true, 'phone sign-in turned off → refused');
await j('/api/admin/settings/phone', { method: 'PUT', body: { ...settings.phone, locationCheck: true, ...SITE } });

// Bulk + revoke
const bulk = await j('/api/admin/staff/phone-links', { method: 'POST', body: {} });
ok(bulk.sent >= 1 && !(await j('/api/admin/staff')).find((s) => s.id === mike.id).phone_invited, `bulk send: ${bulk.sent} sent, skips people already set up`);
await j(`/api/admin/staff/${mike.id}/phone`, { method: 'DELETE' });
await j('/api/me', { h: P, expect: 401 });
ok(true, 'removed phone stops working');

const mf = await j('/api/public/manifest/me');
const mfi = await j('/api/public/manifest/me?invite=abcdefghijkl12');
ok(mf.start_url === '/me' && mfi.start_url === '/me#invite=abcdefghijkl12', 'home-screen manifest for the staff app (carries an unused link for iPhone)');
console.log('staff phone app OK');
