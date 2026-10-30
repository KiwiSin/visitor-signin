// End-to-end smoke test against a running server.
//   node scripts/smoke-test.mjs <base-url> <setup-token> [smtp-host] [smtp-port]
// Uses a fresh install: creates the admin, a team, staff, a tablet, signs a visitor in and out.
const [base = 'http://localhost:8080', setupToken, smtpHost = 'localhost', smtpPort = '2525'] = process.argv.slice(2);
let cookie = '';
let kioskToken = '';

async function call(path, { method = 'GET', body, kiosk = false, expect = 200 } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...(kiosk ? { 'X-Kiosk-Token': kioskToken } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  const text = await res.text();
  const data = res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text;
  if (res.status !== expect) throw new Error(`${method} ${path} → ${res.status} (expected ${expect}): ${text.slice(0, 300)}`);
  return data;
}
const ok = (cond, msg) => { if (!cond) throw new Error(`FAILED: ${msg}`); console.log(`  ✓ ${msg}`); };

// A tiny valid PNG (1x1) as the "signature".
const SIG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

console.log('Setup and login');
ok((await call('/api/auth/status')).needsSetup, 'fresh install needs setup');
await call('/api/auth/setup', { method: 'POST', body: { token: 'wrong', name: 'A', email: 'a@b.co', password: 'x'.repeat(12) }, expect: 403 });
ok(true, 'setup refuses a wrong token');
await call('/api/auth/setup', { method: 'POST', body: { token: setupToken, companyName: 'Acme Ltd', name: 'Test Admin', email: 'admin@acme.co.nz', password: 'correct-horse-battery' } });
ok((await call('/api/auth/status')).user?.email === 'admin@acme.co.nz', 'admin created and signed in');
await call('/api/admin/me');
cookie = '';
await call('/api/admin/me', { expect: 401 });
ok(true, 'admin API refuses without a session');
await call('/api/auth/login', { method: 'POST', body: { email: 'admin@acme.co.nz', password: 'nope-nope-nope' }, expect: 401 });
await call('/api/auth/login', { method: 'POST', body: { email: 'admin@acme.co.nz', password: 'correct-horse-battery' } });
ok(true, 'login works, wrong password refused');

console.log('Settings');
await call('/api/admin/settings/email', { method: 'PUT', body: { method: 'relay', host: smtpHost, port: smtpPort, security: 'none', from: 'reception@acme.co.nz', fromName: 'Acme Reception', allowSelfSigned: true } });
await call('/api/admin/settings/notify', { method: 'PUT', body: { hostOnSignIn: true, receptionMailbox: 'reception@acme.co.nz', copyReception: true, flaggedTo: 'hs@acme.co.nz' } });
await call('/api/admin/email/test', { method: 'POST', body: { to: 'it@acme.co.nz' } });
ok(true, 'test email sent through the relay');

console.log('Staff');
const team = await call('/api/admin/teams', { method: 'POST', body: { name: 'Warehouse', email: 'warehouse@acme.co.nz' } });
const imp = await call('/api/admin/staff/import', { method: 'POST', body: { csv: 'name,email,team,mobile,role\nJane Wilson,jane@acme.co.nz,Operations,021 111,warden\nMike Patel,mike@acme.co.nz,Finance,,\n"Smith, Dave",,Warehouse,,\n,bad,,,' } });
ok(imp.added === 3 && imp.skipped.length === 1, `CSV import: ${imp.added} added, ${imp.skipped.length} skipped`);
const staff = await call('/api/admin/staff');
const jane = staff.find((s) => s.name === 'Jane Wilson');
const dave = staff.find((s) => s.name === 'Smith, Dave');
ok(jane.role === 'warden' && dave.team_id === team.id, 'roles and teams applied from CSV');

console.log('Tablet pairing');
const kiosk = await call('/api/admin/kiosks', { method: 'POST', body: { name: 'Tablet 1 · Main entrance' } });
ok(/^\d{6}$/.test(kiosk.pairing_code), 'pairing code issued');
await call('/api/kiosk/pair', { method: 'POST', body: { code: '000000' }, expect: 400 });
const paired = await call('/api/kiosk/pair', { method: 'POST', body: { code: kiosk.pairing_code } });
kioskToken = paired.token;
const boot = await call('/api/kiosk/bootstrap', { kiosk: true });
ok(boot.staff.length === 3 && boot.types.length === 4 && boot.questions.length === 3, 'tablet gets staff, visit types and questions');
ok(!JSON.stringify(boot.staff).includes('@'), 'tablet never receives staff email addresses');
await call('/api/kiosk/bootstrap', { expect: 401 });
ok(true, 'kiosk API refuses without a token');

console.log('Visitor sign-in');
const answers = boot.questions.map((q, i) => ({ questionId: q.id, answer: i === 0 ? 'no' : 'yes' }));
await call('/api/kiosk/visits', { method: 'POST', kiosk: true, expect: 400, body: { type: 'visitor', name: 'Sarah', mobile: '021', hostId: jane.id, answers, agreed: true } });
ok(true, 'sign-in without a signature is refused');
const v = await call('/api/kiosk/visits', { method: 'POST', kiosk: true, body: {
  clientId: 'test-1', type: 'visitor', name: 'Sarah Thompson', company: 'Fletcher', mobile: '021 123 4567', email: 'sarah@example.com',
  hostId: jane.id, answers, agreed: true, signature: SIG,
} });
ok(v.hostName === 'Jane Wilson' && !v.flagged, 'visitor signed in, host recorded, not flagged');
const again = await call('/api/kiosk/visits', { method: 'POST', kiosk: true, body: { clientId: 'test-1', type: 'visitor', name: 'Sarah Thompson', mobile: '021 123 4567', hostId: jane.id, answers, agreed: true, signature: SIG } });
ok(again.duplicate && again.id === v.id, 'a retried sign-in is not duplicated');
const flaggedAnswers = boot.questions.map((q) => ({ questionId: q.id, answer: 'yes' }));
const v2 = await call('/api/kiosk/visits', { method: 'POST', kiosk: true, body: { type: 'contractor', name: 'Ben Carter', mobile: '022 555', hostId: dave.id, answers: flaggedAnswers, agreed: true, signature: SIG, inductionNo: 'SS-123' } });
ok(v2.flagged, 'unwell answer is flagged');
const v3 = await call('/api/kiosk/visits', { method: 'POST', kiosk: true, body: { type: 'delivery', name: 'NZ Post', mobile: '0800 501 501', noHost: true } });
ok(!!v3.id, 'delivery signs in without host or signature');

console.log('Email delivery (waiting for the queue)');
await new Promise((r) => setTimeout(r, 7000));
const sent = await call('/api/admin/notifications');
const summary = sent.map((n) => `${n.kind}:${n.recipient}:${n.status}`);
console.log('   ', summary.join('\n    '));
ok(sent.some((n) => n.kind === 'host' && n.recipient === 'jane@acme.co.nz' && n.status === 'sent'), 'host email sent to Jane');
ok(sent.some((n) => n.kind === 'team' && n.recipient === 'warehouse@acme.co.nz'), 'staff without email → team mailbox');
ok(sent.some((n) => n.kind === 'flagged' && n.recipient === 'hs@acme.co.nz'), 'safety flag emailed to H&S contact');
ok(sent.some((n) => n.kind === 'reception' && n.subject.includes('no host')), 'no-host delivery goes to reception');

console.log('On site, sign out, reports');
const onsite = await call('/api/kiosk/onsite', { kiosk: true });
ok(onsite.length === 3, '3 visitors on site');
await call(`/api/kiosk/visits/${v.id}/signout`, { method: 'POST', kiosk: true, body: {} });
await call(`/api/kiosk/visits/${v.id}/signout`, { method: 'POST', kiosk: true, body: {}, expect: 404 });
const dash = await call('/api/admin/dashboard');
ok(dash.onsite.length === 2 && dash.today.n === 3 && dash.today.flagged === 1, 'dashboard counts are right');
const csv = await call('/api/admin/visits.csv');
ok(csv.includes('Sarah Thompson') && csv.split('\n').length === 4, 'CSV export has 3 visits');
const sig = await fetch(`${base}/api/admin/visits/${v.id}/signature`, { headers: { Cookie: cookie } });
ok(sig.status === 200 && sig.headers.get('content-type') === 'image/png', 'signature viewable by admin');
const sigPublic = await fetch(`${base}/api/admin/visits/${v.id}/signature`);
ok(sigPublic.status === 401, 'signature hidden from the public');

console.log('Staff in/out');
await call(`/api/kiosk/staff/${jane.id}/presence`, { method: 'POST', kiosk: true, body: { state: 'in' } });
ok((await call('/api/admin/dashboard')).staffIn === 1, 'staff marked in');

console.log('\nAll checks passed.');
