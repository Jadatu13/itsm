import DOMPurify from 'isomorphic-dompurify'

/**
 * HTML sanitization for untrusted content (inbound email bodies, KB articles).
 *
 * DOMPurify is the SECURITY boundary — it removes <script>, event handlers
 * (onerror/onload/…), javascript: URLs, <iframe>/<object>/<embed>, etc. that a
 * regex can never reliably catch. The regex pass below is purely COSMETIC: it
 * collapses the spacer cruft email clients (Outlook/Gmail) embed so the body
 * renders cleanly. Never rely on the regex pass for safety.
 */

// Force links to open safely in a new tab and prevent reverse-tabnabbing.
DOMPurify.addHook('afterSanitizeAttributes', node => {
  if (node.tagName === 'A' && node.getAttribute('href')) {
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noopener noreferrer nofollow')
  }
})

const PURIFY_CONFIG = {
  ALLOWED_TAGS: [
    'p', 'br', 'b', 'strong', 'i', 'em', 'u', 's', 'span', 'div',
    'a', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'table', 'thead', 'tbody', 'tr', 'td', 'th',
    'img', 'hr',
  ],
  ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'width', 'height', 'colspan', 'rowspan'],
  // Only allow http(s), mailto, and our own relative attachment URLs as image/link sources.
  ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|\/api\/attachments\/|\/portal\/|#)/i,
  FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed', 'form', 'input', 'svg', 'math'],
  FORBID_ATTR: ['style'],
}

/** Cosmetic-only pre-pass: strip email-client spacer cruft. NOT a security step. */
function cosmeticCleanup(html) {
  return String(html || '')
    .replace(/<head[\s\S]*?<\/head>/gi, '')
    .replace(/<!--\[if[\s\S]*?<!\[endif\]-->/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\/?\w+:\w+[^>]*>/gi, '')                                   // <o:p> etc
    .replace(/(<p[^>]*>\s*(?:<br\s*\/?>|&nbsp;|\s)*<\/p>\s*){2,}/gi, '')  // empty <p> spacers
    .replace(/(<div[^>]*>\s*(?:<br\s*\/?>|&nbsp;|\s)*<\/div>\s*){2,}/gi, '')
    .replace(/(\s*<br\s*\/?>\s*){3,}/gi, '<br>')
}

/** Sanitize untrusted HTML for safe rendering. The default export for all sinks. */
export function sanitizeHtml(html) {
  if (!html) return ''
  return DOMPurify.sanitize(html, PURIFY_CONFIG)
}

/** Sanitize an inbound email body: cosmetic cleanup + full DOMPurify. */
export function sanitizeEmailHtml(html) {
  if (!html) return ''
  return DOMPurify.sanitize(cosmeticCleanup(html), PURIFY_CONFIG).trim()
}
