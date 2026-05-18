import OpenAI from 'openai';

// ChatGPT Images 2.0 — OpenAI's editorial-quality image generation model.
const IMAGE_MODEL = 'gpt-image-2';

export type GeneratedImage = {
  binary: Buffer;
  mimeType: string;
  model: string;
  size: string;
};

export async function generateImage(opts: {
  apiKey: string;
  prompt: string;
  size?: '1536x1024' | '1024x1536' | '1024x1024';
}): Promise<GeneratedImage> {
  const client = new OpenAI({ apiKey: opts.apiKey });
  const size = opts.size ?? '1536x1024'; // ~3:2 landscape banner
  const response = await client.images.generate({
    model: IMAGE_MODEL,
    prompt: opts.prompt,
    size,
    n: 1,
  });
  const b64 = response.data?.[0]?.b64_json;
  if (!b64) {
    throw new Error('Image model returned no image data');
  }
  return {
    binary: Buffer.from(b64, 'base64'),
    mimeType: 'image/png',
    model: IMAGE_MODEL,
    size,
  };
}
