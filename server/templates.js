import { config } from './config.js';

export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatTime(date) {
  return new Intl.DateTimeFormat('en-NZ', {
    timeZone: config.timeZone, hour: 'numeric', minute: '2-digit',
  }).format(new Date(date));
}

export function formatDateTime(date) {
  return new Intl.DateTimeFormat('en-NZ', {
    timeZone: config.timeZone, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
  }).format(new Date(date));
}

function absolute(url) {
  if (!url) return null;
  return /^https?:\/\//.test(url) ? url : `${config.appUrl}${url.startsWith('/') ? '' : '/'}${url}`;
}

/**
 * The email a host (or reception) receives when a visitor signs in.
 * kind: host | team | reception | flagged
 */
export function arrivalEmail({ branding, visit, kind }) {
  const accent = /^#[0-9a-f]{6}$/i.test(branding.accent) ? branding.accent : '#0F766E';
  const logo = absolute(branding.logo);
  const first = (visit.hostName || '').split(' ')[0];
  const when = formatTime(visit.signedInAt);
  const flaggedRows = (visit.answers || []).filter((a) => a.flagged);

  let heading;
  let lead;
  let subject;
  if (kind === 'flagged') {
    subject = `Safety flag: ${visit.visitorName} answered a safety question`;
    heading = 'A visitor flagged a safety question';
    lead = `${visit.visitorName} signed in at ${branding.locationName} at ${when} and gave an answer that needs a check.`;
  } else if (kind === 'team') {
    subject = `${visit.visitorName} has arrived to see ${visit.hostName}`;
    heading = `${visit.visitorName} is here to see ${visit.hostName}`;
    lead = `Signed in at ${branding.locationName} at ${when}. ${visit.hostName} has no email address of their own, so this came to the team mailbox. Please let them know.`;
  } else if (kind === 'reception') {
    subject = visit.hostName
      ? `${visit.visitorName} has arrived to see ${visit.hostName}`
      : `${visit.visitorName} has arrived (no host chosen)`;
    heading = visit.hostName ? `${visit.visitorName} is here to see ${visit.hostName}` : `${visit.visitorName} is at reception`;
    lead = visit.hostName
      ? `Signed in at ${branding.locationName} at ${when}. This is the reception copy.`
      : `Signed in at ${branding.locationName} at ${when} without choosing a host. Please look after them.`;
  } else {
    subject = `Your visitor ${visit.visitorName} has arrived`;
    heading = `Kia ora ${esc(first) || 'there'}, your visitor is here`;
    lead = `${visit.visitorName} signed in at ${branding.locationName} at ${when} and is waiting for you.`;
  }

  const rows = [
    ['Name', visit.visitorName],
    ['Company', visit.company || '—'],
    ['Mobile', visit.mobile || '—'],
    ['Visit type', visit.typeName],
    ['Health & Safety', visit.agreedHs ? 'Agreed and signed' : 'Not required'],
  ];
  if (visit.extra?.rego) rows.push(['Vehicle', visit.extra.rego]);
  if (visit.extra?.inductionNo) rows.push(['Induction card', visit.extra.inductionNo]);

  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#F3F4F6;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111827">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:10px;overflow:hidden">
<tr><td style="background:${accent};padding:18px 24px;color:#ffffff;font-size:16px;font-weight:700">
${logo ? `<img src="${esc(logo)}" alt="${esc(branding.companyName)}" height="36" style="display:block;max-height:36px">` : esc(branding.companyName)}
</td></tr>
<tr><td style="padding:24px">
<h1 style="margin:0 0 10px;font-size:21px">${kind === 'host' ? heading : esc(heading)}</h1>
<p style="margin:0 0 18px;font-size:15px;line-height:1.55;color:#374151">${esc(lead)}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E5E7EB;border-radius:8px;font-size:14px">
${rows.map(([k, v]) => `<tr><td style="padding:8px 14px;color:#4B5563;width:40%;border-bottom:1px solid #F3F4F6">${esc(k)}</td><td style="padding:8px 14px;font-weight:600;border-bottom:1px solid #F3F4F6">${esc(v)}</td></tr>`).join('')}
</table>
${flaggedRows.length ? `<div style="margin-top:16px;padding:12px 14px;background:#FEF3C7;border-radius:8px;color:#78350F;font-size:14px"><strong>Flagged answers</strong><br>${flaggedRows.map((a) => `${esc(a.question)} — <strong>${esc(a.answer)}</strong>`).join('<br>')}</div>` : ''}
${kind === 'host' ? `<p style="margin:18px 0 0;font-size:15px;color:#374151">Please meet them at <strong>${esc(branding.locationName)}</strong>.</p>` : ''}
<p style="margin:20px 0 0;padding-top:14px;border-top:1px solid #E5E7EB;font-size:12px;color:#6B7280">${kind === 'host' ? 'You are receiving this because a visitor chose you as their host.' : 'Sent by'} ${esc(branding.appName)}.</p>
</td></tr></table></body></html>`;

  const text = [
    kind === 'host' ? `Kia ora ${first || 'there'}, your visitor is here.` : heading,
    lead,
    '',
    ...rows.map(([k, v]) => `${k}: ${v}`),
    ...(flaggedRows.length ? ['', 'Flagged answers:', ...flaggedRows.map((a) => `- ${a.question} ${a.answer}`)] : []),
    '',
    kind === 'host' ? `Please meet them at ${branding.locationName}.` : '',
  ].join('\n');

  return { subject, html, text };
}

export function rollCallEmail({ branding, rc, url }) {
  const total = rc.entries.length;
  const subject = `EMERGENCY ROLL CALL started at ${formatTime(rc.startedAt)} (${total} on site)`;
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#F3F4F6;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111827">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:10px;overflow:hidden">
<tr><td style="background:#B91C1C;padding:16px 24px;color:#ffffff;font-size:15px;font-weight:800;letter-spacing:1px">EVACUATION · ROLL CALL STARTED</td></tr>
<tr><td style="padding:24px">
<p style="margin:0 0 14px;font-size:16px;line-height:1.5">${esc(rc.startedBy)} started a roll call at ${esc(formatTime(rc.startedAt))}. <strong>${total}</strong> ${total === 1 ? 'person was' : 'people were'} on site.</p>
<p style="margin:0 0 18px"><a href="${esc(url)}" style="display:inline-block;background:#B91C1C;color:#ffffff;padding:12px 20px;border-radius:8px;font-weight:700;text-decoration:none">Open the roll call</a></p>
<p style="margin:0 0 8px;font-size:14px;font-weight:700">On site when it started</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;border:1px solid #E5E7EB;border-radius:8px">
${rc.entries.map((e) => `<tr><td style="padding:7px 12px;border-bottom:1px solid #F3F4F6"><strong>${esc(e.name)}</strong><br><span style="color:#4B5563">${esc(e.detail || '')}</span></td><td style="padding:7px 12px;border-bottom:1px solid #F3F4F6;white-space:nowrap">${esc(e.mobile || '')}</td></tr>`).join('') || '<tr><td style="padding:10px 12px;color:#4B5563">Nobody was signed in.</td></tr>'}
</table>
<p style="margin:18px 0 0;font-size:12px;color:#6B7280">This list is a copy in case phones or Wi-Fi are down. Sent by ${esc(branding.appName)}.</p>
</td></tr></table></body></html>`;
  const text = [
    `EMERGENCY ROLL CALL started by ${rc.startedBy} at ${formatTime(rc.startedAt)}. ${total} on site.`,
    `Open: ${url}`,
    '',
    ...rc.entries.map((e) => `- ${e.name} (${e.detail || ''}) ${e.mobile || ''}`),
  ].join('\n');
  return { subject, html, text };
}

export function testEmail(branding) {
  return {
    subject: `Test email from ${branding.appName}`,
    html: `<p>This is a test email from <strong>${esc(branding.appName)}</strong> for ${esc(branding.companyName)}.</p><p>If you can read this, host alerts will be delivered.</p>`,
    text: `This is a test email from ${branding.appName} for ${branding.companyName}. If you can read this, host alerts will be delivered.`,
  };
}
