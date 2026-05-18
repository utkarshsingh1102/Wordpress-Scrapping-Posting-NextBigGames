import OpenAI from 'openai';
import {
  META_SYSTEM_PROMPT,
  buildUserMessage,
  type PromptBuildInput,
} from './promptBuilder';

const PROMPT_WRITER_MODEL = 'gpt-4o';

export type WrittenPrompt = {
  prompt: string;
  model: string;
};

export async function writeImagePrompt(opts: {
  apiKey: string;
  input: PromptBuildInput;
}): Promise<WrittenPrompt> {
  const client = new OpenAI({ apiKey: opts.apiKey });
  const response = await client.chat.completions.create({
    model: PROMPT_WRITER_MODEL,
    messages: [
      { role: 'system', content: META_SYSTEM_PROMPT },
      { role: 'user', content: buildUserMessage(opts.input) },
    ],
    temperature: 0.7,
  });
  const prompt = response.choices[0]?.message?.content?.trim() ?? '';
  if (!prompt) {
    throw new Error('Prompt-writer returned empty output');
  }
  return { prompt, model: PROMPT_WRITER_MODEL };
}
