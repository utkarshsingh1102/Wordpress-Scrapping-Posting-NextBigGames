import OpenAI from 'openai';
import { http } from '../scraper/http';

const VISION_MODEL = 'gpt-4o';

/**
 * OpenAI's vision endpoint fetches the URL server-side. If the URL is on our
 * own localhost (e.g. a previously-regenerated image we served at
 * /generated/...) OpenAI can't reach it. Inline the bytes as a data URL.
 *
 * Also useful for any internal / VPN-only URLs.
 */
async function toDataUrlIfLocal(imageUrl: string): Promise<string> {
  const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])/i.test(imageUrl);
  if (!isLocal) return imageUrl;
  const res = await http.get<ArrayBuffer>(imageUrl, {
    responseType: 'arraybuffer',
    headers: { Accept: 'image/*' },
  });
  const ct = res.headers['content-type'];
  const mime =
    (typeof ct === 'string' ? ct.split(';')[0].trim() : '') || 'image/png';
  const b64 = Buffer.from(res.data).toString('base64');
  return `data:${mime};base64,${b64}`;
}

const VISION_SYSTEM_PROMPT = `You are a visual analyst. You will be shown a single image that is the first image of a blog post. Your job is to describe what is in the image so that a downstream prompt-writer can generate a new editorial banner that preserves the same recognisable subjects.

Output plain prose, 4-8 short sentences. Cover, in this order:
1. The named subjects (characters, logos, products, people) — be specific. If you recognise an IP (e.g. "Angry Birds Red", "Snapchat ghost icon", "Sensor Tower wordmark"), name it. If you do not recognise it, describe it concretely (e.g. "a young woman in a maid's uniform").
2. Composition and pose (left/right placement, grouping, what they are doing).
3. Mood / lighting / setting (cinematic dark thriller, flat product render, photographic editorial, etc.).
4. Dominant colours.
5. Any visible text or logos with their exact wording.

Do NOT make up facts. If you cannot tell, say so. Do not editorialise. Do not output JSON or markdown.`;

export type VisionAnalysis = {
  description: string;
  model: string;
};

export async function analyzeImage(opts: {
  imageUrl: string;
  apiKey: string;
}): Promise<VisionAnalysis> {
  const client = new OpenAI({ apiKey: opts.apiKey });
  const imageUrl = await toDataUrlIfLocal(opts.imageUrl);
  const response = await client.chat.completions.create({
    model: VISION_MODEL,
    messages: [
      { role: 'system', content: VISION_SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Analyse this image.' },
          { type: 'image_url', image_url: { url: imageUrl } },
        ],
      },
    ],
  });
  const description = response.choices[0]?.message?.content?.trim() ?? '';
  if (!description) {
    throw new Error('Vision model returned empty analysis');
  }
  return { description, model: VISION_MODEL };
}
