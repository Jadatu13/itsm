const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { decrypt } = require('../lib/crypto');

// ─── Config loader ────────────────────────────────────────────────────────────

async function getAiConfig() {
  const result = await db.query(
    `SELECT key, value FROM settings WHERE key LIKE 'ai_%'`
  );
  const s = Object.fromEntries(result.rows.map(r => [r.key, r.value]));
  if (!s.ai_api_key) return null;
  const provider = s.ai_provider || 'grok';
  return {
    provider,
    apiKey: decrypt(s.ai_api_key),
    model:  s.ai_model || (provider === 'claude' ? 'claude-haiku-4-5' : 'grok-3'),
  };
}

function stripTags(html) {
  return String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

// ─── POST /api/ai/draft-reply ─────────────────────────────────────────────────

router.post('/draft-reply', async (req, res) => {
  const { ticket_id } = req.body;
  if (!ticket_id) return res.status(400).json({ error: 'ticket_id is required' });

  try {
    const config = await getAiConfig();
    if (!config) {
      return res.status(400).json({
        error: 'AI assistant is not configured. Add an API key in Settings → AI Assistant.',
      });
    }

    // Ticket details
    const ticketResult = await db.query(
      `SELECT t.subject, t.description, t.priority, t.category,
              c.first_name || ' ' || c.last_name AS contact_name
       FROM tickets t JOIN contacts c ON c.id = t.contact_id
       WHERE t.id = $1`,
      [ticket_id]
    );
    if (!ticketResult.rows.length) return res.status(404).json({ error: 'Ticket not found' });
    const ticket = ticketResult.rows[0];

    // Non-internal conversation history
    const repliesResult = await db.query(
      `SELECT r.body, r.is_agent_reply,
              CASE WHEN r.is_agent_reply THEN COALESCE(r.sender_name, 'Support Agent')
                   ELSE c.first_name || ' ' || c.last_name
              END AS sender_name
       FROM ticket_replies r
       JOIN tickets t ON t.id = r.ticket_id
       JOIN contacts c ON c.id = t.contact_id
       WHERE r.ticket_id = $1 AND r.is_internal = false
       ORDER BY r.created_at ASC`,
      [ticket_id]
    );

    const history = repliesResult.rows
      .map(r => `${r.is_agent_reply ? `Support Agent (${r.sender_name})` : `Customer (${r.sender_name})`}: ${stripTags(r.body)}`)
      .join('\n\n');

    const systemPrompt = `You are a professional IT support agent composing replies to customer support tickets.
Write a helpful, friendly, and professional reply. Be concise but thorough.
Use simple HTML for formatting: <p> for paragraphs, <ul>/<li> for lists, <strong> for emphasis.
Do NOT include a greeting (e.g. "Hi [name]") or sign-off (e.g. "Kind regards") — those are handled by the system.
Output only the reply body HTML itself, nothing else.`;

    const userMessage = `Ticket subject: ${ticket.subject}
Priority: ${ticket.priority || 'unknown'}${ticket.category ? `\nCategory: ${ticket.category}` : ''}
Original description: ${stripTags(ticket.description || '(none)')}
${history ? `\nConversation so far:\n${history}` : ''}

Draft a helpful reply to this ticket.`;

    let draftHtml = '';

    // ── Grok (xAI) — OpenAI-compatible ────────────────────────────────────────
    if (config.provider === 'grok') {
      const response = await fetch('https://api.x.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model:       config.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user',   content: userMessage  },
          ],
          max_tokens:  1024,
          temperature: 0.7,
        }),
      });
      if (!response.ok) {
        const err = await response.text();
        console.error('[ai] Grok error:', err);
        return res.status(502).json({ error: 'Grok returned an error — check your API key.' });
      }
      const data = await response.json();
      draftHtml = data.choices?.[0]?.message?.content || '';

    // ── Claude (Anthropic) ─────────────────────────────────────────────────────
    } else if (config.provider === 'claude') {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type':      'application/json',
          'x-api-key':         config.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model:      config.model,
          max_tokens: 1024,
          system:     systemPrompt,
          messages: [{ role: 'user', content: userMessage }],
        }),
      });
      if (!response.ok) {
        const err = await response.text();
        console.error('[ai] Claude error:', err);
        return res.status(502).json({ error: 'Claude returned an error — check your API key.' });
      }
      const data = await response.json();
      draftHtml = data.content?.[0]?.text || '';

    } else {
      return res.status(400).json({ error: `Unknown AI provider: ${config.provider}` });
    }

    if (!draftHtml.trim()) {
      return res.status(502).json({ error: 'AI returned an empty response.' });
    }

    // If plain text was returned (no HTML tags), convert to paragraphs
    if (!/<[a-z][\s\S]*>/i.test(draftHtml)) {
      draftHtml = draftHtml
        .split(/\n\n+/)
        .map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`)
        .join('');
    }

    res.json({ html: draftHtml });
  } catch (err) {
    console.error('[ai] draft-reply error:', err);
    res.status(500).json({ error: 'Failed to generate draft reply.' });
  }
});

module.exports = router;
