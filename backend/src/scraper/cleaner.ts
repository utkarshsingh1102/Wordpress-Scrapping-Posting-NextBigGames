import { load } from 'cheerio';

// Generic noise that survives Readability extraction.
const NOISE_SELECTORS = [
  'script',
  'style',
  'noscript',
  'iframe[src*="doubleclick"]',
  'iframe[src*="googlesyndication"]',
  '[class*="share"]',
  '[class*="social"]',
  '[class*="related-posts"]',
  '[id*="comments"]',
].join(', ');

// Inline styles that center an <img> reliably across WordPress themes,
// including block-editor themes that don't ship CSS for the legacy
// `aligncenter` class.
const IMG_CENTER_DECL = 'display: block; margin-left: auto; margin-right: auto;';
const WRAPPER_CENTER_DECL = 'text-align: center;';

function mergeStyle(existing: string | undefined, addition: string): string {
  const cur = (existing ?? '').trim().replace(/;$/, '');
  // Drop any conflicting declarations the addition will replace.
  const additionKeys = addition
    .split(';')
    .map((s) => s.split(':')[0]?.trim().toLowerCase())
    .filter(Boolean);
  const kept = cur
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s && !additionKeys.includes(s.split(':')[0].trim().toLowerCase()))
    .join('; ');
  return `${kept ? kept + '; ' : ''}${addition}`;
}

/**
 * Make every <img> render centered, regardless of theme.
 *
 * Strategy (belt and suspenders):
 *   1. Every <img> gets inline `display: block; margin: 0 auto;` so it centers
 *      even when wrapped in something the theme doesn't style.
 *   2. <figure>-wrapped: add the legacy `aligncenter` class for themes that
 *      use it + `text-align: center` inline as a fallback.
 *   3. <p>-wrapped: add `text-align: center` inline.
 *   4. Bare <img>: wrap in `<p style="text-align: center;">`.
 *
 * Idempotent: re-running on already-centered HTML is a no-op.
 */
export function centerAlignImages(html: string): string {
  if (!html) return html;
  const $ = load(`<div id="__alignroot">${html}</div>`);
  const root = $('#__alignroot');
  root.find('img').each((_, el) => {
    const $img = $(el);

    // (1) Inline-center the <img> itself.
    const imgStyle = $img.attr('style') ?? '';
    if (!/display\s*:\s*block/i.test(imgStyle) || !/margin(-left)?\s*:\s*auto/i.test(imgStyle)) {
      $img.attr('style', mergeStyle(imgStyle, IMG_CENTER_DECL));
    }

    // (2) Figure-wrapped → aligncenter class + inline text-align fallback.
    const $figure = $img.closest('figure');
    if ($figure.length > 0) {
      const cls = $figure.attr('class') ?? '';
      if (!/\baligncenter\b/.test(cls)) {
        $figure.attr('class', `${cls} aligncenter`.trim());
      }
      const fStyle = $figure.attr('style') ?? '';
      if (!/text-align\s*:\s*center/i.test(fStyle)) {
        $figure.attr('style', mergeStyle(fStyle, WRAPPER_CENTER_DECL));
      }
      return;
    }

    // (3) Paragraph-wrapped.
    const $p = $img.parent('p');
    if ($p.length > 0) {
      const style = $p.attr('style') ?? '';
      if (!/text-align\s*:\s*center/i.test(style)) {
        $p.attr('style', mergeStyle(style, WRAPPER_CENTER_DECL));
      }
      return;
    }

    // (4) Bare <img>.
    $img.wrap('<p style="text-align: center;"></p>');
  });
  return root.html() ?? html;
}

export function cleanBodyHtml(html: string): string {
  if (!html) return html;
  const $ = load(`<div id="__cleanroot">${html}</div>`);
  const root = $('#__cleanroot');
  root.find(NOISE_SELECTORS).remove();
  const noiseStripped = root.html() ?? html;
  return centerAlignImages(noiseStripped);
}
