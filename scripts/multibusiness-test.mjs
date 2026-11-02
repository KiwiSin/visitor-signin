// Multi-business test. Run after scripts/smoke-test.mjs on the same (fresh) server:
//   node scripts/multibusiness-test.mjs http://localhost:8080
// The smoke test's admin (admin@acme.co.nz) is the Host Admin.
const base = process.argv[2] || 'http://localhost:8080';
const ok = (cond, msg) => { if (!cond) throw new Error(`FAILED: ${msg}`); console.log(`  ✓ ${msg}`); };
const SIG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

function client() {
  let cookie = '';
  return async (path, { method = 'GET', body, headers = {}, expect = 200 } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await res.text();
    const data = res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text;
    if (res.status !== expect) throw new Error(`${method} ${path} → ${res.status} (expected ${expect}): ${text.slice(0, 300)}`);
    return data;
  };
}

const host = client();
console.log('Host Admin');
const login = await host('/api/auth/login', { method: 'POST', body: { email: 'admin@acme.co.nz', password: 'correct-horse-battery' } });
ok(login.isHost && login.businessSlug, `existing admin is a Host Admin (business ${login.businessSlug})`);
const acme = login.businessSlug;
const list0 = await host('/api/host/businesses');
ok(list0.length === 1, 'one business to start with');
const sug = await host('/api/host/slug?name=' + encodeURIComponent('Beta & Co (Wellington)'));
ok(sug.slug === 'beta-and-co-wellington', `web address suggested from the name: ${sug.slug}`);
const created = await host('/api/host/businesses', { method: 'POST', body: { name: 'Beta Co' } });
ok(created.business.slug === 'beta-co' && created.setupUrl.includes('/b/beta-co/setup?token='), `business created with setup link ${created.setupUrl.replace(/token=.*/, 'token=…')}`);
await host('/api/host/businesses', { method: 'POST', body: { name: 'Beta Co', slug: 'beta-co' }, expect: 400 });
ok(true, 'duplicate web address refused');

console.log('Company setup link');
const token = created.setupUrl.split('token=')[1];
const beta = client();
const info = await beta('/api/business-setup?token=' + token);
ok(info.name === 'Beta Co', 'setup link shows the company name');
await beta('/api/business-setup', { method: 'POST', body: { token, name: 'Bea Admin', email: 'admin@acme.co.nz', password: 'x'.repeat(12) }, expect: 400 });
ok(true, 'an email already in use is refused');
const done = await beta('/api/business-setup', { method: 'POST', body: { token, name: 'Bea Admin', email: 'bea@beta.co.nz', password: 'beta-password-123' } });
ok(done.slug === 'beta-co', 'company admin created and signed in');
await client()('/api/business-setup?token=' + token, { expect: 404 });
ok(true, 'setup link only works once');

console.log('Each business has its own copy of everything');
const bs = await beta('/api/b/beta-co/admin/settings');
ok(bs.branding.companyName === 'Beta Co' && bs.safety.text.length > 50, 'Beta starts with its name and the default H&S text');
ok(bs.hours.autoSignOut.mode === 'time' && bs.hours.autoSignOut.time === '23:00', 'automatic sign-out defaults to 11:00 pm');
const bTypes = await beta('/api/b/beta-co/admin/visitor-types');
const bQs = await beta('/api/b/beta-co/admin/questions');
ok(bTypes.length === 4 && bQs.length === 3, 'Beta has its own visit types and safety questions');
await beta('/api/b/beta-co/admin/staff', { method: 'POST', body: { name: 'Bob Beta', email: 'bob@beta.co.nz' } });
await beta('/api/b/beta-co/admin/staff', { method: 'POST', body: { name: 'Jane Wilson', email: 'jane@acme.co.nz' } });
ok(true, 'the same email can be staff in two businesses');
const bStaff = await beta('/api/b/beta-co/admin/staff');
const aStaff = await host(`/api/b/${acme}/admin/staff`);
ok(bStaff.length === 2 && !aStaff.some((s) => s.name === 'Bob Beta'), 'staff lists are separate');

console.log('Isolation');
await beta(`/api/b/${acme}/admin/staff`, { expect: 403 });
ok(true, 'Beta admin cannot open the other business');
await beta('/api/admin/staff', { expect: 403 });
ok(true, 'Beta admin cannot use the default business either');
await beta('/api/host/businesses', { expect: 403 });
ok(true, 'Beta admin cannot open the Host console');
const hostSeesBeta = await host('/api/b/beta-co/admin/staff');
ok(hostSeesBeta.length === 2, 'Host Admin can open any business');
const aJane = aStaff.find((s) => s.name === 'Jane Wilson');
await beta(`/api/b/beta-co/admin/staff/${aJane.id}`, { method: 'PATCH', body: { presence: 'in' }, expect: 404 });
ok(true, 'cannot change another business’s staff by id');

console.log('Tablets and sign-in');
const k = await beta('/api/b/beta-co/admin/kiosks', { method: 'POST', body: { name: 'Beta front desk' } });
const pair = await client()('/api/kiosk/pair', { method: 'POST', body: { code: k.pairing_code } });
ok(pair.businessSlug === 'beta-co', 'tablet pairs to Beta');
const kh = { 'X-Kiosk-Token': pair.token };
const boot = await client()('/api/kiosk/bootstrap', { headers: kh });
ok(boot.branding.companyName === 'Beta Co' && boot.staff.length === 2, 'tablet gets Beta’s branding and staff only');
const bob = bStaff.find((s) => s.name === 'Bob Beta');
const answers = boot.questions.map((q) => ({ questionId: q.id, answer: 'no' }));
await client()('/api/kiosk/visits', { method: 'POST', headers: kh, body: { type: 'visitor', name: 'Vera Visitor', mobile: '021 999', hostId: aJane.id, answers, agreed: true, signature: SIG }, expect: 400 });
ok(true, 'a Beta tablet cannot choose a host from another business');
await client()('/api/kiosk/visits', { method: 'POST', headers: kh, body: { type: 'visitor', name: 'Vera Visitor', mobile: '021 999', hostId: bob.id, answers, agreed: true, signature: SIG } });
const bDash = await beta('/api/b/beta-co/admin/dashboard');
const aDash = await host(`/api/b/${acme}/admin/dashboard`);
ok(bDash.onsite.length === 1 && !aDash.onsite.some((v) => v.name === 'Vera Visitor'), 'visits are separate');

console.log('Roll call per business');
await beta('/api/b/beta-co/admin/staff/' + bob.id, { method: 'PATCH', body: { presence: 'in' } });
const bGroups = await beta('/api/b/beta-co/admin/groups');
ok(bGroups.map((g) => g.key).join() === 'fire_warden,first_aider,management', 'new business gets the three built-in groups');
await beta(`/api/b/beta-co/admin/staff/${bob.id}/groups`, { method: 'PUT', body: { groupIds: [bGroups[0].id] } });
const link = await beta(`/api/b/beta-co/admin/staff/${bob.id}/phone-link`, { method: 'POST', body: { send: false } });
ok(link.url.includes('/b/beta-co/me#invite='), 'phone link points at Beta');
const claimed = await client()('/api/me/claim', { method: 'POST', body: { invite: link.url.split('#invite=')[1] } });
ok(claimed.businessSlug === 'beta-co', 'claimed phone knows its business');
const wh = { 'X-Staff-Token': claimed.token };
const aGroups = await host(`/api/b/${acme}/admin/groups`);
await beta(`/api/b/beta-co/admin/staff/${bob.id}/groups`, { method: 'PUT', body: { groupIds: [bGroups[0].id, ...aGroups.map((g) => g.id)] } });
const bobNow = (await beta('/api/b/beta-co/admin/staff')).find((s) => s.id === bob.id);
ok(bobNow.group_ids.length === 1, 'groups from another business are ignored');
const st = await client()('/api/rollcall/state', { headers: wh });
ok(st.people.length === 2 && st.people.every((p) => ['Vera Visitor', 'Bob Beta'].includes(p.name)), 'Beta warden sees only Beta people');

console.log('Business hours and automatic sign-out');
await beta('/api/b/beta-co/admin/settings/hours', { method: 'PUT', body: { ...bs.hours, timezone: 'Mars/Olympus' }, expect: 400 });
ok(true, 'unknown time zone refused');
const hrs = await beta('/api/b/beta-co/admin/settings/hours', { method: 'PUT', body: { ...bs.hours, autoSignOut: { ...bs.hours.autoSignOut, mode: 'closing', afterClosingMins: 30 } } });
ok(hrs.hours.autoSignOut.mode === 'closing', 'hours saved');

console.log('Pause and links');
await host('/api/host/businesses/' + created.business.id, { method: 'PUT', body: { status: 'suspended' } });
await client()('/api/kiosk/bootstrap', { headers: kh, expect: 403 });
await beta('/api/b/beta-co/admin/staff', { expect: 403 });
ok(true, 'pausing a business stops its tablets and admins');
await host('/api/host/businesses/' + created.business.id, { method: 'PUT', body: { status: 'active' } });
await client()('/api/kiosk/bootstrap', { headers: kh });
ok(true, 'resuming brings it back');
const branding = await client()('/api/b/beta-co/public/branding');
ok(branding.companyName === 'Beta Co', 'public branding by address');
await client()('/api/b/no-such-business/public/branding', { expect: 404 });
ok(true, 'unknown business address gives 404');
const man = await client()('/api/b/beta-co/public/manifest/kiosk');
ok((typeof man === 'string' ? JSON.parse(man) : man).start_url === '/b/beta-co/kiosk', 'home-screen app opens Beta’s kiosk');

console.log('Delete');
await host('/api/host/businesses/' + created.business.id, { method: 'DELETE', body: { confirm: 'wrong' }, expect: 400 });
await host('/api/host/businesses/' + created.business.id, { method: 'DELETE', body: { confirm: 'beta-co' } });
await client()('/api/kiosk/bootstrap', { headers: kh, expect: 401 });
ok((await host('/api/host/businesses')).length === 1, 'business deleted with its tablets and data');

console.log('\nAll multi-business checks passed.');
