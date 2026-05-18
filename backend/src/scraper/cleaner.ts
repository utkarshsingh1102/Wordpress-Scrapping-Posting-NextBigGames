import { load } from 'cheerio';

// Selectors for sections we never want in published WP content:
// share bars, social-reaction widgets, author bio boxes, "more posts" links,
// and stray script/style.
const NOISE_SELECTORS = [
  '.typify-single-post-footer',
  '.typify-sharerow',
  '.typify-author-section',
  '.typify-authorbox',
  '[class*="reaktions"]',
  '[class*="sharebox"]',
  'script',
  'style',
  'noscript',
].join(', ');

/**
 * Strip Gamigion's share row / author bio / social widgets from a body HTML
 * fragment. Safe to call on already-clean content (returns input unchanged).
 */
export function cleanBodyHtml(html: string): string {
  if (!html) return html;
  const $ = load(`<div id="__cleanroot">${html}</div>`);
  const root = $('#__cleanroot');
  root.find(NOISE_SELECTORS).remove();
  return root.html() ?? html;
}
