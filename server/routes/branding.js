const express = require('express');
const router = express.Router();
const db = require('../db');
const requireAuth = require('../middleware/auth');

const DEFAULTS = {
  id: 1,
  brand_name: 'Help Centre',
  logo_url: null,
  primary_color: '#4F46E5',
  nav_bg: '#FFFFFF',
  nav_text: '#111827',
  nav_active_bg: '#EEF2FF',
  nav_active_text: '#4F46E5',
  page_bg: '#F8F9FB',
  button_bg: '#4F46E5',
  button_text: '#FFFFFF',
  login_title: 'Welcome to the Help Centre',
  login_subtitle: 'Sign in with your work email address',
  footer_text: null,
};

// GET /api/branding — public, no auth required
router.get('/', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM portal_branding WHERE id = 1');
    if (!result.rows.length) {
      return res.json(DEFAULTS);
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.json(DEFAULTS);
  }
});

// PUT /api/branding — requires agent auth
router.put('/', requireAuth, async (req, res) => {
  const {
    brand_name,
    logo_url,
    primary_color,
    nav_bg,
    nav_text,
    nav_active_bg,
    nav_active_text,
    page_bg,
    button_bg,
    button_text,
    login_title,
    login_subtitle,
    footer_text,
  } = req.body;

  try {
    const result = await db.query(
      `INSERT INTO portal_branding (
        id, brand_name, logo_url, primary_color, nav_bg, nav_text,
        nav_active_bg, nav_active_text, page_bg, button_bg, button_text,
        login_title, login_subtitle, footer_text, updated_at
      ) VALUES (
        1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW()
      )
      ON CONFLICT (id) DO UPDATE SET
        brand_name     = EXCLUDED.brand_name,
        logo_url       = EXCLUDED.logo_url,
        primary_color  = EXCLUDED.primary_color,
        nav_bg         = EXCLUDED.nav_bg,
        nav_text       = EXCLUDED.nav_text,
        nav_active_bg  = EXCLUDED.nav_active_bg,
        nav_active_text = EXCLUDED.nav_active_text,
        page_bg        = EXCLUDED.page_bg,
        button_bg      = EXCLUDED.button_bg,
        button_text    = EXCLUDED.button_text,
        login_title    = EXCLUDED.login_title,
        login_subtitle = EXCLUDED.login_subtitle,
        footer_text    = EXCLUDED.footer_text,
        updated_at     = NOW()
      RETURNING *`,
      [
        brand_name    ?? DEFAULTS.brand_name,
        logo_url      ?? null,
        primary_color ?? DEFAULTS.primary_color,
        nav_bg        ?? DEFAULTS.nav_bg,
        nav_text      ?? DEFAULTS.nav_text,
        nav_active_bg ?? DEFAULTS.nav_active_bg,
        nav_active_text ?? DEFAULTS.nav_active_text,
        page_bg       ?? DEFAULTS.page_bg,
        button_bg     ?? DEFAULTS.button_bg,
        button_text   ?? DEFAULTS.button_text,
        login_title   ?? DEFAULTS.login_title,
        login_subtitle ?? DEFAULTS.login_subtitle,
        footer_text   ?? null,
      ]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save branding' });
  }
});

module.exports = router;
