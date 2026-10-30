import nodemailer from 'nodemailer';
import { decrypt } from './security.js';

/** Build a nodemailer transport from the saved email settings. */
export function buildTransport(email) {
  if (!email || email.method === 'none' || !email.host) return null;
  const port = Number(email.port) || (email.method === 'relay' ? 25 : 587);
  const options = {
    host: email.host,
    port,
    secure: email.security === 'tls',
    ignoreTLS: email.security === 'none',
    requireTLS: email.security === 'starttls',
    tls: { rejectUnauthorized: !email.allowSelfSigned },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  };
  if (email.method === 'smtp' && email.user) {
    options.auth = { user: email.user, pass: decrypt(email.passEnc) };
  }
  return nodemailer.createTransport(options);
}

export function fromAddress(email) {
  const addr = email.from || email.user;
  if (!addr) return undefined;
  return email.fromName ? { name: email.fromName, address: addr } : addr;
}

export async function sendMail(email, { to, subject, html, text }) {
  const transport = buildTransport(email);
  if (!transport) throw new Error('Email is not set up (Admin › Settings › Email).');
  const from = fromAddress(email);
  if (!from) throw new Error('Set a "Send from" address in Admin › Settings › Email.');
  const info = await transport.sendMail({
    from,
    to,
    replyTo: email.replyTo || undefined,
    subject,
    html,
    text,
  });
  return info.messageId;
}
