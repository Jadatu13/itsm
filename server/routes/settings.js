const express      = require('express');
const router       = express.Router();
const nodemailer   = require('nodemailer');
const db           = require('../db');
const { encrypt, decrypt } = require('../lib/crypto');
const requireAdmin = require('../middleware/requireAdmin');

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SMTP_KEYS = ['smtp_host', 'smtp_port', 'smtp_secure', 'smtp_user', 'smtp_pass', 'smtp_from_name', 'smtp_from_email'];
const PASS_SENTINEL = '__UNCHANGED__';

async function getSmtpSettings() {
  const result = await db.query(`SELECT key, value FROM settings WHERE key = ANY($1)`, [SMTP_KEYS]);
  return Object.fromEntries(result.rows.map(r => [r.key, r.value]));
}

/** Build a RFC-5321 from string: "Display Name <email>" or just "email" */
function buildFrom(name, email) {
  const e = (email || '').trim();
  const n = (name  || '').trim();
  if (!e) return null;
  return n ? `${n} <${e}>` : e;
}

// ─── GET /api/settings/smtp ───────────────────────────────────────────────────

router.get('/smtp', async (req, res) => {
  try {
    const raw = await getSmtpSettings();
    res.json({
      smtp_host:       raw.smtp_host       || '',
      smtp_port:       raw.smtp_port       || '587',
      smtp_secure:     raw.smtp_secure     || 'false',
      smtp_user:       raw.smtp_user       || '',
      smtp_pass:       PASS_SENTINEL,
      smtp_pass_set:   !!raw.smtp_pass,
      smtp_from_name:  raw.smtp_from_name  || '',
      smtp_from_email: raw.smtp_from_email || '',
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load settings' });
  }
});

// ─── PUT /api/settings/smtp ───────────────────────────────────────────────────

router.put('/smtp', requireAdmin, async (req, res) => {
  const { smtp_host, smtp_port, smtp_secure, smtp_user, smtp_pass, smtp_from_name, smtp_from_email } = req.body;

  try {
    const updates = {
      smtp_host:       smtp_host       || null,
      smtp_port:       smtp_port       || '587',
      smtp_secure:     smtp_secure     || 'false',
      smtp_user:       smtp_user       || null,
      smtp_from_name:  smtp_from_name  || null,
      smtp_from_email: smtp_from_email || null,
    };

    if (smtp_pass && smtp_pass !== PASS_SENTINEL) {
      updates.smtp_pass = encrypt(smtp_pass);
    }

    for (const [key, value] of Object.entries(updates)) {
      if (value === null) {
        await db.query(`DELETE FROM settings WHERE key = $1`, [key]);
      } else {
        await db.query(
          `INSERT INTO settings (key, value) VALUES ($1, $2)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
          [key, value]
        );
      }
    }

    const raw = await getSmtpSettings();
    res.json({
      smtp_host:       raw.smtp_host       || '',
      smtp_port:       raw.smtp_port       || '587',
      smtp_secure:     raw.smtp_secure     || 'false',
      smtp_user:       raw.smtp_user       || '',
      smtp_pass:       PASS_SENTINEL,
      smtp_pass_set:   !!raw.smtp_pass,
      smtp_from_name:  raw.smtp_from_name  || '',
      smtp_from_email: raw.smtp_from_email || '',
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save settings' });
  }
});

// ─── POST /api/settings/smtp/test ────────────────────────────────────────────

router.post('/smtp/test', async (req, res) => {
  const { to } = req.body;
  if (!to) return res.status(400).json({ error: 'to address is required' });

  try {
    const raw = await getSmtpSettings();
    if (!raw.smtp_host) {
      return res.status(400).json({ error: 'No SMTP host configured. Save your settings first.' });
    }

    const pass = raw.smtp_pass ? decrypt(raw.smtp_pass) : null;
    const from = buildFrom(raw.smtp_from_name, raw.smtp_from_email) || raw.smtp_user;

    const transporter = nodemailer.createTransport({
      host:   raw.smtp_host,
      port:   parseInt(raw.smtp_port || '587', 10),
      secure: raw.smtp_secure === 'true',
      auth:   raw.smtp_user ? { user: raw.smtp_user, pass: pass || '' } : undefined,
    });

    await transporter.verify();

    await transporter.sendMail({
      from,
      to,
      subject: 'ITSM — SMTP test email',
      text:    'Your SMTP configuration is working correctly. This is a test email from your ITSM system.',
      html: `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#f9f9f7;border-radius:10px;">
          <div style="background:#4F7FFF;color:#fff;padding:20px 24px;border-radius:8px 8px 0 0;">
            <strong style="font-size:16px;">✓ SMTP configuration working</strong>
          </div>
          <div style="background:#fff;border:1px solid #e5e5e0;border-top:none;padding:20px 24px;border-radius:0 0 8px 8px;">
            <p style="margin:0;color:#374151;font-size:14px;line-height:1.6;">
              Your SMTP settings are configured correctly. This test email was sent from your ITSM system.
            </p>
          </div>
        </div>
      `,
    });

    res.json({ ok: true, message: `Test email sent to ${to}` });
  } catch (err) {
    console.error('[smtp test]', err.message);
    res.status(400).json({ error: err.message });
  }
});

// ─── GET /api/settings/inbound ────────────────────────────────────────────────

router.get('/inbound', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT key, value FROM settings WHERE key LIKE 'imap_%'`
    );
    const s = Object.fromEntries(result.rows.map(r => [r.key, r.value]));
    res.json({
      imap_host:          s.imap_host          || '',
      imap_port:          s.imap_port          || '993',
      imap_tls:           s.imap_tls           || 'true',
      imap_folder:        s.imap_folder        || 'INBOX',
      imap_poll_interval: s.imap_poll_interval || '60',
      imap_user:          s.imap_user          || '',
      imap_pass_set:      !!s.imap_pass,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load inbound settings' });
  }
});

// ─── PUT /api/settings/inbound ────────────────────────────────────────────────

router.put('/inbound', requireAdmin, async (req, res) => {
  const { imap_host, imap_port, imap_tls, imap_folder, imap_poll_interval, imap_user, imap_pass } = req.body;
  try {
    const updates = {
      imap_host:          imap_host          || null,
      imap_port:          imap_port          || '993',
      imap_tls:           imap_tls           || 'true',
      imap_folder:        imap_folder        || 'INBOX',
      imap_poll_interval: imap_poll_interval || '60',
      imap_user:          imap_user          || null,
    };

    if (imap_pass && imap_pass !== PASS_SENTINEL) {
      updates.imap_pass = encrypt(imap_pass);
    }

    for (const [key, value] of Object.entries(updates)) {
      if (value === null) {
        await db.query(`DELETE FROM settings WHERE key = $1`, [key]);
      } else {
        await db.query(
          `INSERT INTO settings (key, value) VALUES ($1, $2)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
          [key, value]
        );
      }
    }

    const result = await db.query(`SELECT key, value FROM settings WHERE key LIKE 'imap_%'`);
    const s = Object.fromEntries(result.rows.map(r => [r.key, r.value]));
    res.json({
      imap_host:          s.imap_host          || '',
      imap_port:          s.imap_port          || '993',
      imap_tls:           s.imap_tls           || 'true',
      imap_folder:        s.imap_folder        || 'INBOX',
      imap_poll_interval: s.imap_poll_interval || '60',
      imap_user:          s.imap_user          || '',
      imap_pass_set:      !!s.imap_pass,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save inbound settings' });
  }
});

// ─── POST /api/settings/inbound/test ─────────────────────────────────────────

router.post('/inbound/test', async (req, res) => {
  try {
    const { poll } = require('../inbound');
    // Grab IMAP config to validate it's set first
    const cfg = await db.query(
      `SELECT key, value FROM settings WHERE key IN ('imap_host','imap_user')`
    );
    const s = Object.fromEntries(cfg.rows.map(r => [r.key, r.value]));
    if (!s.imap_host || !s.imap_user) {
      return res.status(400).json({ error: 'IMAP host and credentials must be configured first.' });
    }
    await poll();
    res.json({ ok: true, message: 'Poll completed — check your ticket list for any new tickets.' });
  } catch (err) {
    console.error('[inbound test]', err.message);
    res.status(400).json({ error: err.message });
  }
});

// ─── GET /api/settings/ai ─────────────────────────────────────────────────────

router.get('/ai', async (req, res) => {
  try {
    const result = await db.query(`SELECT key, value FROM settings WHERE key LIKE 'ai_%'`);
    const s = Object.fromEntries(result.rows.map(r => [r.key, r.value]));
    res.json({
      ai_provider: s.ai_provider || 'grok',
      ai_model:    s.ai_model    || '',
      ai_key_set:  !!s.ai_api_key,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load AI settings' });
  }
});

// ─── PUT /api/settings/ai ─────────────────────────────────────────────────────

router.put('/ai', requireAdmin, async (req, res) => {
  const { ai_provider, ai_model, ai_api_key } = req.body;
  try {
    const updates = {
      ai_provider: ai_provider || 'grok',
      ai_model:    ai_model    || null,
    };
    if (ai_api_key && ai_api_key !== PASS_SENTINEL) {
      updates.ai_api_key = encrypt(ai_api_key);
    }
    for (const [key, value] of Object.entries(updates)) {
      if (value === null) {
        await db.query(`DELETE FROM settings WHERE key = $1`, [key]);
      } else {
        await db.query(
          `INSERT INTO settings (key, value) VALUES ($1, $2)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
          [key, value]
        );
      }
    }
    const result = await db.query(`SELECT key, value FROM settings WHERE key LIKE 'ai_%'`);
    const s = Object.fromEntries(result.rows.map(r => [r.key, r.value]));
    res.json({ ai_provider: s.ai_provider || 'grok', ai_model: s.ai_model || '', ai_key_set: !!s.ai_api_key });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save AI settings' });
  }
});

// ─── POST /api/settings/ai/test ───────────────────────────────────────────────

router.post('/ai/test', async (req, res) => {
  try {
    const result = await db.query(`SELECT key, value FROM settings WHERE key LIKE 'ai_%'`);
    const s = Object.fromEntries(result.rows.map(r => [r.key, r.value]));
    if (!s.ai_api_key) return res.status(400).json({ error: 'No API key configured. Save your settings first.' });

    const provider = s.ai_provider || 'grok';
    const apiKey   = decrypt(s.ai_api_key);
    const model    = s.ai_model || (provider === 'claude' ? 'claude-haiku-4-5' : 'grok-3');

    let ok = false;
    if (provider === 'grok') {
      const r = await fetch('https://api.x.ai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Say "ok" and nothing else.' }], max_tokens: 5 }),
      });
      ok = r.ok;
      if (!ok) { const t = await r.text(); return res.status(400).json({ error: `Grok API error: ${t}` }); }
    } else if (provider === 'claude') {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model, max_tokens: 5, messages: [{ role: 'user', content: 'Say "ok" and nothing else.' }] }),
      });
      ok = r.ok;
      if (!ok) { const t = await r.text(); return res.status(400).json({ error: `Claude API error: ${t}` }); }
    }

    res.json({ ok: true, message: `${provider === 'claude' ? 'Claude' : 'Grok'} API key is working correctly.` });
  } catch (err) {
    console.error('[ai test]', err.message);
    res.status(400).json({ error: err.message });
  }
});

// ─── GET /api/settings/sla ────────────────────────────────────────────────────

router.get('/sla', async (req, res) => {
  try {
    const result = await db.query(`SELECT key, value FROM settings WHERE key LIKE 'sla_%'`);
    const s = Object.fromEntries(result.rows.map(r => [r.key, r.value]));
    res.json({
      sla_hours_high:   parseInt(s.sla_hours_high   || '4',  10),
      sla_hours_medium: parseInt(s.sla_hours_medium  || '24', 10),
      sla_hours_low:    parseInt(s.sla_hours_low     || '72', 10),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load SLA settings' });
  }
});

// ─── PUT /api/settings/sla ────────────────────────────────────────────────────

router.put('/sla', requireAdmin, async (req, res) => {
  const { sla_hours_high, sla_hours_medium, sla_hours_low } = req.body;
  try {
    const updates = {
      sla_hours_high:   String(Math.max(1, parseInt(sla_hours_high   || '4',  10))),
      sla_hours_medium: String(Math.max(1, parseInt(sla_hours_medium  || '24', 10))),
      sla_hours_low:    String(Math.max(1, parseInt(sla_hours_low     || '72', 10))),
    };
    for (const [key, value] of Object.entries(updates)) {
      await db.query(
        `INSERT INTO settings (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [key, value]
      );
    }
    res.json({ ok: true, ...updates });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save SLA settings' });
  }
});

// ─── GET /api/settings/notifications ─────────────────────────────────────────

router.get('/notifications', async (req, res) => {
  try {
    const result = await db.query(`SELECT key, value FROM settings WHERE key LIKE 'notifications_%'`);
    const s = Object.fromEntries(result.rows.map(r => [r.key, r.value]));
    res.json({
      notifications_agent_email: s.notifications_agent_email !== 'false', // default true
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load notification settings' });
  }
});

// ─── PUT /api/settings/notifications ─────────────────────────────────────────

router.put('/notifications', requireAdmin, async (req, res) => {
  const { notifications_agent_email } = req.body;
  try {
    const value = notifications_agent_email === false || notifications_agent_email === 'false' ? 'false' : 'true';
    await db.query(
      `INSERT INTO settings (key, value) VALUES ('notifications_agent_email', $1)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [value]
    );
    res.json({ notifications_agent_email: value !== 'false' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save notification settings' });
  }
});

module.exports = router;
