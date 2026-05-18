import Anthropic from '@anthropic-ai/sdk';
import { load, type CheerioAPI } from 'cheerio';

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const MAX_OUTPUT_TOKENS = 16000;

// Tag types we track for structural equivalence. If the rewriter adds or drops
// any of these we reject. <span>, <br>, <div> are excluded — they're too noisy
// and don't affect semantic structure.
const STRUCTURAL_TAGS = [
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'ul',
  'ol',
  'li',
  'a',
  'img',
  'strong',
  'em',
  'b',
  'i',
  'blockquote',
  'figure',
  'figcaption',
  'pre',
  'code',
];

export class RewriteValidationError extends Error {
  constructor(
    message: string,
    public readonly details: { reason: string; diff?: string },
  ) {
    super(message);
    this.name = 'RewriteValidationError';
  }
}

const SYSTEM_PROMPT = `You rewrite blog post HTML so it expresses the same information in different words while keeping the structure exactly the same.

RULES:
1. Output ONLY the rewritten HTML. No preamble, no explanation, no code fences, no Markdown.
2. Preserve every HTML tag, attribute, and value byte-for-byte EXCEPT visible text content.
3. Preserve every image URL (src and any data-* attributes) verbatim.
4. Preserve every link URL (href values) verbatim.
5. Tag types must match the input exactly: a <p> stays a <p>, a <h2> stays a <h2>, a <ul> with N <li>s stays a <ul> with N <li>s.
6. Do not add new HTML tags, attributes, or content. Do not remove tags.
7. Rewrite only the visible text inside elements — different phrasing, same meaning.
8. Preserve factual content (numbers, names, dates, quotes, URLs in text).
9. Keep the same tone and approximate length.
10. If a sentence is a direct quote ("..."), keep it verbatim — don't paraphrase quotes.`;

function countTags($: CheerioAPI): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const tag of STRUCTURAL_TAGS) {
    counts[tag] = $(tag).length;
  }
  return counts;
}

function collectImageUrls($: CheerioAPI): Set<string> {
  const urls = new Set<string>();
  $('img').each((_, el) => {
    const src = $(el).attr('src');
    if (src) urls.add(src);
  });
  return urls;
}

function collectLinkUrls($: CheerioAPI): Set<string> {
  const urls = new Set<string>();
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (href) urls.add(href);
  });
  return urls;
}

function stripCodeFences(html: string): string {
  // Defensive: if the model wraps output in ```html ... ```, strip it.
  const fenced = /^\s*```(?:html)?\s*\n?([\s\S]*?)\n?```\s*$/i.exec(html);
  return fenced ? fenced[1].trim() : html.trim();
}

function diffTagCounts(
  before: Record<string, number>,
  after: Record<string, number>,
): string | null {
  const diffs: string[] = [];
  for (const tag of STRUCTURAL_TAGS) {
    if (before[tag] !== after[tag]) {
      diffs.push(`<${tag}>: ${before[tag]} → ${after[tag]}`);
    }
  }
  return diffs.length > 0 ? diffs.join(', ') : null;
}

function diffUrlSets(
  before: Set<string>,
  after: Set<string>,
  kind: 'image' | 'link',
): string | null {
  const missing: string[] = [];
  for (const url of before) if (!after.has(url)) missing.push(url);
  if (missing.length === 0) return null;
  return `missing ${kind} URLs: ${missing.slice(0, 3).join(', ')}${
    missing.length > 3 ? ` (+${missing.length - 3} more)` : ''
  }`;
}

export function validateRewrite(
  originalHtml: string,
  rewrittenHtml: string,
): void {
  if (!rewrittenHtml.trim()) {
    throw new RewriteValidationError('Rewritten HTML is empty', {
      reason: 'empty_output',
    });
  }

  const $before = load(`<div id="__r">${originalHtml}</div>`);
  const $after = load(`<div id="__r">${rewrittenHtml}</div>`);

  const tagDiff = diffTagCounts(
    countTags($before),
    countTags($after),
  );
  if (tagDiff) {
    throw new RewriteValidationError(
      'Rewrite altered HTML structure',
      { reason: 'tag_count_mismatch', diff: tagDiff },
    );
  }

  const imgDiff = diffUrlSets(
    collectImageUrls($before),
    collectImageUrls($after),
    'image',
  );
  if (imgDiff) {
    throw new RewriteValidationError('Rewrite lost image URLs', {
      reason: 'image_urls_lost',
      diff: imgDiff,
    });
  }

  const linkDiff = diffUrlSets(
    collectLinkUrls($before),
    collectLinkUrls($after),
    'link',
  );
  if (linkDiff) {
    throw new RewriteValidationError('Rewrite lost link URLs', {
      reason: 'link_urls_lost',
      diff: linkDiff,
    });
  }
}

export type RewriteResult = {
  rewrittenBodyHtml: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
};

export async function rewriteBodyHtml(opts: {
  bodyHtml: string;
  apiKey: string;
  model?: string;
}): Promise<RewriteResult> {
  const model = opts.model ?? DEFAULT_MODEL;
  const client = new Anthropic({ apiKey: opts.apiKey });

  const response = await client.messages.create({
    model,
    max_tokens: MAX_OUTPUT_TOKENS,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: opts.bodyHtml }],
  });

  const textBlocks = response.content.filter(
    (b): b is Anthropic.TextBlock => b.type === 'text',
  );
  if (textBlocks.length === 0) {
    throw new RewriteValidationError(
      'Claude returned no text content',
      { reason: 'no_text_block' },
    );
  }

  const raw = textBlocks.map((b) => b.text).join('');
  const rewritten = stripCodeFences(raw);

  validateRewrite(opts.bodyHtml, rewritten);

  return {
    rewrittenBodyHtml: rewritten,
    model,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
}
