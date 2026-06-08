/**
 * sanitizeEmailHtml — strip email-client cruft before rendering in the UI.
 *
 * Handles:
 *  Outlook  — <head>, <style>, <script>, <html>/<body> wrappers,
 *             Office namespace tags (<o:p>, <w:…>, <m:…>),
 *             Outlook conditional comments (<!--[if …]>…<![endif]-->),
 *             runs of empty <p> tags
 *  Gmail    — <div dir="ltr"> wrapper (kept, just unwrapped of cruft),
 *             runs of consecutive empty <div> and <br> tags
 *  General  — <!DOCTYPE>, <meta>, <link>, <base> tags,
 *             any remaining 3+ consecutive blank lines
 */
export function sanitizeEmailHtml(html) {
  if (!html) return ''

  return html
    // ── Remove entire <head> block ──────────────────────────────────────────
    .replace(/<head[\s\S]*?<\/head>/gi, '')

    // ── Remove style / script block content ────────────────────────────────
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')

    // ── Outlook conditional comments <!--[if …]>…<![endif]--> ──────────────
    .replace(/<!--\[if[\s\S]*?<!\[endif\]-->/gi, '')
    // plain HTML comments
    .replace(/<!--[\s\S]*?-->/g, '')

    // ── Remove structural/meta tags (keep content) ──────────────────────────
    .replace(/<!DOCTYPE[^>]*>/gi, '')
    .replace(/<\/?(?:html|body)[^>]*>/gi, '')
    .replace(/<(?:meta|link|base)[^>]*\/?>/gi, '')

    // ── Office / Word namespace tags e.g. <o:p>, <w:sdt>, <m:oMath> ────────
    .replace(/<\/?\w+:\w+[^>]*>/gi, '')

    // ── Collapse blank paragraphs ───────────────────────────────────────────
    // 3+ consecutive empty <p> (Outlook signatures, spacers)
    .replace(/(<p[^>]*>\s*(?:<br\s*\/?>|&nbsp;|\s)*<\/p>\s*){3,}/gi, '<p style="margin:0"></p>')
    // 3+ consecutive empty <div> (Gmail spacers)
    .replace(/(<div[^>]*>\s*(?:<br\s*\/?>|&nbsp;|\s)*<\/div>\s*){3,}/gi, '<div></div>')
    // 3+ consecutive <br> tags
    .replace(/(\s*<br\s*\/?>\s*){3,}/gi, '<br>')

    .trim()
}
