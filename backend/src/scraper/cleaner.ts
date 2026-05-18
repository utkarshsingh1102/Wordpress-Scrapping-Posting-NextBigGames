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

export function cleanBodyHtml(html: string): string {
  if (!html) return html;
  const $ = load(`<div id="__cleanroot">${html}</div>`);
  const root = $('#__cleanroot');
  root.find(NOISE_SELECTORS).remove();
  return root.html() ?? html;
}
