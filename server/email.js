const nodemailer = require('nodemailer');
const { decrypt } = require('./lib/crypto');

const APP_URL = (process.env.APP_URL || 'http://localhost:8080').replace(/\/$/, '');

// ─── Config loader ────────────────────────────────────────────────────────────

async function getConfig() {
  try {
    const db = require('./db');
    const result = await db.query(
      `SELECT key, value FROM settings WHERE key LIKE 'smtp_%' OR key = 'imap_user'`
    );
    const s = Object.fromEntries(result.rows.map(r => [r.key, r.value]));
    if (s.smtp_host) {
      const fromEmail = s.smtp_from_email || s.smtp_user || '';
      const fromName  = s.smtp_from_name  || '';
      return {
        host:    s.smtp_host,
        port:    parseInt(s.smtp_port || '587', 10),
        secure:  s.smtp_secure === 'true',
        user:    s.smtp_user || undefined,
        pass:    s.smtp_pass ? decrypt(s.smtp_pass) : undefined,
        from:    fromName ? `${fromName} <${fromEmail}>` : fromEmail,
        replyTo: s.imap_user || undefined,   // contacts reply here → inbound poller picks it up
      };
    }
  } catch {
    // DB unavailable — fall through to env vars
  }

  if (!process.env.SMTP_HOST) return null;
  return {
    host:    process.env.SMTP_HOST,
    port:    parseInt(process.env.SMTP_PORT || '587', 10),
    secure:  process.env.SMTP_SECURE === 'true',
    user:    process.env.SMTP_USER || undefined,
    pass:    process.env.SMTP_PASS || undefined,
    from:    process.env.SMTP_FROM || process.env.SMTP_USER,
    replyTo: process.env.IMAP_USER || undefined,
  };
}

// ─── Low-level send ───────────────────────────────────────────────────────────

async function sendMail({ to, subject, html, text, replyTo }) {
  const config = await getConfig();
  if (!config) return;

  const transporter = nodemailer.createTransport({
    host:   config.host,
    port:   config.port,
    secure: config.secure,
    auth:   config.user ? { user: config.user, pass: config.pass || '' } : undefined,
  });

  try {
    await transporter.sendMail({
      from:    config.from,
      to,
      subject,
      html,
      text,
      replyTo: replyTo || config.replyTo,   // per-call override, else global inbound address
    });
  } catch (err) {
    console.error('[email] Failed to send to', to, '—', err.message);
  }
}

// ─── Shared layout ────────────────────────────────────────────────────────────

function layout({ headerColour = '#4F7FFF', title, reference, body, canReply = true }) {
  const footer = canReply
    ? `Reply directly to this email to respond to your ticket and it will be added to your request.`
    : `If you need further assistance, feel free to contact us and quote your reference number.`;

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:32px 16px;background:#f9f9f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e5e5e0;border-radius:10px;overflow:hidden;">
    <div style="background:${headerColour};padding:24px 32px;">
      <div style="color:#ffffff;font-size:17px;font-weight:700;">${title}</div>
      <div style="color:rgba(255,255,255,0.75);font-size:12px;margin-top:5px;font-family:'SF Mono','Fira Mono',monospace;">${reference}</div>
    </div>
    <div style="padding:28px 32px;">${body}</div>
    <div style="background:#f9f9f7;border-top:1px solid #e5e5e0;padding:14px 32px;">
      <p style="margin:0;color:#9ca3af;font-size:12px;">${footer}</p>
    </div>
  </div>
</body>
</html>`;
}

// ─── Templates ────────────────────────────────────────────────────────────────

function portalButton(reference) {
  const url = `${APP_URL}/portal/tickets/${encodeURIComponent(reference)}`;
  return `
    <div style="text-align:center;margin:24px 0 4px;">
      <a href="${url}" style="display:inline-block;background:#4F7FFF;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:11px 28px;border-radius:7px;">View in Portal</a>
    </div>`;
}

async function sendNewTicket({ to, firstName, reference, subject, description }) {
  const html = layout({
    headerColour: '#4F7FFF',
    title:     'Your support request has been received',
    reference,
    canReply:  true,
    body: `
      <p style="margin:0 0 16px;color:#374151;font-size:15px;">Hi ${esc(firstName)},</p>
      <p style="margin:0 0 20px;color:#6b7280;font-size:14px;line-height:1.6;">
        Thanks for reaching out. We've received your support request and one of our team
        members will be in touch with you shortly.
      </p>
      <div style="background:#f9f9f7;border:1px solid #e5e5e0;border-radius:8px;padding:16px 20px;margin-bottom:20px;">
        <div style="font-size:12px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px;">Subject</div>
        <div style="font-size:14px;color:#111827;font-weight:600;">${esc(subject)}</div>
        ${description ? `
        <div style="font-size:12px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:0.05em;margin:14px 0 8px;">Description</div>
        <div style="font-size:14px;color:#374151;line-height:1.6;white-space:pre-wrap;">${esc(description)}</div>` : ''}
      </div>
      ${portalButton(reference)}
      <p style="margin:8px 0 0;color:#6b7280;font-size:13px;text-align:center;">
        Or reply directly to this email to add more information.
      </p>`,
  });
  await sendMail({
    to,
    subject: `[${reference}] Your support request has been received`,
    html,
    text: `Hi ${firstName},\n\nWe've received your support request (${reference}).\n\nSubject: ${subject}\n\nWe'll be in touch shortly.\n\nView your request: ${APP_URL}/portal/tickets/${reference}\n\nOr reply to this email to add more information.`,
  });
}

async function sendAgentReply({ to, firstName, reference, ticketSubject, replyBody, history = [] }) {
  // replyBody is HTML from the rich text editor — render it directly, don't escape
  const historyHtml = history.length ? `
    <div style="margin-top:28px;border-top:1px solid #e5e5e0;padding-top:20px;">
      <div style="font-size:11px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:0.07em;margin-bottom:16px;">Previous conversation</div>
      ${history.map(r => `
        <div style="margin-bottom:16px;opacity:0.85;">
          <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
            <span style="font-size:12px;font-weight:600;color:${r.is_agent_reply ? '#4F7FFF' : '#374151'};">${esc(r.sender_name)}</span>
            <span style="font-size:11px;color:#9ca3af;">${new Date(r.created_at).toLocaleString('en-NZ', { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' })}</span>
          </div>
          <div style="font-size:13px;color:#6b7280;line-height:1.55;border-left:2px solid #e5e5e0;padding-left:10px;">${inlineEmailStyles(r.is_agent_reply ? r.body : esc(r.body))}</div>
        </div>`).join('')}
    </div>` : '';

  const html = layout({
    headerColour: '#4F7FFF',
    title:     'You have a new reply on your support request',
    reference,
    canReply:  true,
    body: `
      <p style="margin:0 0 16px;color:#374151;font-size:15px;">Hi ${esc(firstName)},</p>
      <p style="margin:0 0 20px;color:#6b7280;font-size:14px;line-height:1.6;">
        A member of our support team has replied to your request
        <strong style="color:#374151;">${esc(ticketSubject)}</strong>.
      </p>
      <div style="border-left:3px solid #4F7FFF;padding:12px 16px;background:#f5f8ff;border-radius:0 6px 6px 0;margin-bottom:20px;">
        <div style="font-size:12px;font-weight:700;color:#4F7FFF;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px;">Support Agent</div>
        <div style="font-size:14px;color:#374151;line-height:1.65;">${inlineEmailStyles(replyBody)}</div>
      </div>
      ${portalButton(reference)}
      <p style="margin:8px 0 0;color:#6b7280;font-size:13px;text-align:center;">
        Or reply directly to this email to respond.
      </p>
      ${historyHtml}`,
  });
  await sendMail({
    to,
    subject: `[${reference}] New reply on your support request`,
    html,
    text: `Hi ${firstName},\n\nA support agent has replied to your request (${reference}):\n\n${stripTags(replyBody)}\n\nView your request: ${APP_URL}/portal/tickets/${reference}\n\nOr reply to this email to respond.`,
  });
}

async function sendTicketResolved({ to, firstName, reference, ticketSubject }) {
  const html = layout({
    headerColour: '#16a34a',
    title:     'Your support request has been resolved',
    reference,
    canReply:  false,
    body: `
      <p style="margin:0 0 16px;color:#374151;font-size:15px;">Hi ${esc(firstName)},</p>
      <p style="margin:0 0 20px;color:#6b7280;font-size:14px;line-height:1.6;">
        We're happy to let you know that your support request
        <strong style="color:#374151;">${esc(ticketSubject)}</strong>
        has been marked as resolved.
      </p>
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px 20px;margin-bottom:20px;">
        <span style="color:#16a34a;font-size:14px;font-weight:600;">✓ Ticket ${esc(reference)} — Resolved</span>
      </div>
      ${portalButton(reference)}
      <p style="margin:8px 0 0;color:#6b7280;font-size:13px;text-align:center;">
        If you need further assistance, please don't hesitate to get in touch.
      </p>`,
  });
  await sendMail({
    to,
    subject: `[${reference}] Your support request has been resolved`,
    html,
    text: `Hi ${firstName},\n\nYour support request (${reference}) has been resolved.\n\nView your request: ${APP_URL}/portal/tickets/${reference}\n\nIf you need further assistance, please don't hesitate to get in touch.`,
  });
}

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function stripTags(html) {
  return String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function inlineEmailStyles(html) {
  return String(html || '')
    .replace(/<p>/g, '<p style="margin:0 0 10px;">')
    .replace(/<h1>/g, '<h1 style="font-size:18px;font-weight:700;margin:0 0 8px;">')
    .replace(/<h2>/g, '<h2 style="font-size:16px;font-weight:700;margin:0 0 8px;">')
    .replace(/<h3>/g, '<h3 style="font-size:14px;font-weight:700;margin:0 0 8px;">')
    .replace(/<ul>/g, '<ul style="padding-left:20px;margin:0 0 10px;">')
    .replace(/<ol>/g, '<ol style="padding-left:20px;margin:0 0 10px;">')
    .replace(/<table>/g, '<table style="border-collapse:collapse;width:100%;margin:0 0 10px;">')
    .replace(/<td>/g, '<td style="border:1px solid #e5e5e0;padding:6px 10px;vertical-align:top;">')
    .replace(/<th>/g, '<th style="border:1px solid #e5e5e0;padding:6px 10px;background:#f9f9f7;font-weight:700;">')
    .replace(/<a /g, '<a style="color:#4F7FFF;text-decoration:underline;" ');
}

module.exports = { sendNewTicket, sendAgentReply, sendTicketResolved };
