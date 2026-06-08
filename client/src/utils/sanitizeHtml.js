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
 *             inline style attributes that force large margins/padding/heights,
 *             multiple consecutive blank lines
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

    // ── Strip inline styles that force large heights / margins ──────────────
    // Replace any margin-top / margin-bottom / padding-top / padding-bottom
    // values > 0 in inline styles with 0 so email spacer elements collapse.
    .replace(/\bmargin-(top|bottom)\s*:\s*[1-9][^;'"]*/gi, 'margin-$1:0')
    .replace(/\bpadding-(top|bottom)\s*:\s*[1-9][^;'"]*/gi, 'padding-$1:0')
    // Strip min-height / height on block elements used as spacers
    .replace(/\b(?:min-)?height\s*:\s*[1-9][^;'"]*/gi, '')

    // ── Signature separators ────────────────────────────────────────────────
    // Remove <hr> elements that are email signature dividers
    .replace(/<hr[^>]*>/gi, '')

    // ── Collapse blank/spacer paragraphs ────────────────────────────────────
    // 2+ consecutive empty <p> (Outlook spacers between every line)
    .replace(/(<p[^>]*>\s*(?:<br\s*\/?>|&nbsp;|\s)*<\/p>\s*){2,}/gi, '')
    // 2+ consecutive empty <div> (Gmail spacers)
    .replace(/(<div[^>]*>\s*(?:<br\s*\/?>|&nbsp;|\s)*<\/div>\s*){2,}/gi, '')
    // 3+ consecutive <br> → single <br>
    .replace(/(\s*<br\s*\/?>\s*){3,}/gi, '<br>')

    .trim()
}
