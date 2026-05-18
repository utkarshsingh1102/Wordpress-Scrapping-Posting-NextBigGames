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

/**
 * Wrap every <img> so it renders centered, regardless of the surrounding
 * paragraph/text alignment.
 *
 * Strategy:
 *   - <figure>-wrapped image  -> add `aligncenter` class (WP-native)
 *   - <p>-wrapped image       -> add `text-align: center` to the <p>
 *   - bare <img>              -> wrap in <p style="text-align: center;">
 *
 * Idempotent: re-running on already-centered HTML is a no-op.
 */
export function centerAlignImages(html: string): string {
  if (!html) return html;
  const $ = load(`<div id="__alignroot">${html}</div>`);
  const root = $('#__alignroot');
  root.find('img').each((_, el) => {
    const $img = $(el);

    const $figure = $img.closest('figure');
    if ($figure.length > 0) {
      const cls = $figure.attr('class') ?? '';
      if (!/\baligncenter\b/.test(cls)) {
        $figure.attr('class', `${cls} aligncenter`.trim());
      }
      return;
    }

    const $p = $img.parent('p');
    if ($p.length > 0) {
      const style = $p.attr('style') ?? '';
      if (!/text-align\s*:\s*center/i.test(style)) {
        const next = style.trim().replace(/;$/, '');
        $p.attr('style', `${next ? next + '; ' : ''}text-align: center;`);
      }
      return;
    }

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
