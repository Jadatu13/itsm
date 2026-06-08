/**
 * sanitizeEmailHtml — strip email-client cruft before rendering in the UI.
 *
 * Handles:
 *  Outlook  — <head>, <style>, <script>, <html>/<body> wrappers,
 *             Office namespace tags (<o:p>, <w:…>, <m:…>),
 *             Outlook conditional comments (<!--[if …]>…<![endif]-->),
 *             runs of empty <p> tags, signature <hr> separators
 *  Gmail    — <div dir="ltr"> wrapper, runs of consecutive empty <div>/<br>
 *  Apple    — similar div-based layout
 *  General  — <!DOCTYPE>, <meta>, <link>, <base> tags,
 *             inline background/color/font-size/margin/padding/height overrides
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
    .replace(/<!--[\s\S]*?-->/g, '')

    // ── Remove structural/meta tags (keep content) ──────────────────────────
    .replace(/<!DOCTYPE[^>]*>/gi, '')
    .replace(/<\/?(?:html|body)[^>]*>/gi, '')
    .replace(/<(?:meta|link|base)[^>]*\/?>/gi, '')

    // ── Office / Word namespace tags e.g. <o:p>, <w:sdt>, <m:oMath> ────────
    .replace(/<\/?\w+:\w+[^>]*>/gi, '')

    // ── Strip entire style="" attributes ───────────────────────────────────
    // Email clients embed font, background, color, margin etc. that clash
    // with the portal's own styling. Remove all inline styles completely.
    .replace(/\s+style\s*=\s*(?:"[^"]*"|'[^']*')/gi, '')

    // ── Signature separators ────────────────────────────────────────────────
    .replace(/<hr[^>]*\/?>/gi, '')

    // ── Collapse blank/spacer paragraphs ────────────────────────────────────
    // 2+ consecutive empty <p> (Outlook spacers between every line)
    .replace(/(<p[^>]*>\s*(?:<br\s*\/?>|&nbsp;|\s)*<\/p>\s*){2,}/gi, '')
    // 2+ consecutive empty <div> (Gmail spacers)
    .replace(/(<div[^>]*>\s*(?:<br\s*\/?>|&nbsp;|\s)*<\/div>\s*){2,}/gi, '')
    // 3+ consecutive <br> → single <br>
    .replace(/(\s*<br\s*\/?>\s*){3,}/gi, '<br>')

    .trim()
}
