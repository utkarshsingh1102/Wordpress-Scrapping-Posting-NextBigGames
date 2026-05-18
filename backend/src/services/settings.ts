import { prisma } from '../db';
import { config } from '../config';
import { decrypt, encrypt, getKey } from '../crypto';

export type EffectiveSettings = {
  sourceUrl: string;
  wp: {
    url: string | null;
    username: string | null;
    appPassword: string | null;
    authorUsername: string | null;
  };
  rewrite: {
    anthropicApiKey: string | null;
    enabled: boolean;
    model: string;
  };
  imagegen: {
    openaiApiKey: string | null;
  };
  scrape: { cron: string; cronEnabled: boolean };
};

export type SettingsUpdate = {
  sourceUrl?: string;
  wp?: {
    url?: string | null;
    username?: string | null;
    appPassword?: string | null;
    authorUsername?: string | null;
  };
  rewrite?: {
    anthropicApiKey?: string | null;
    enabled?: boolean;
    model?: string | null;
  };
  imagegen?: {
    openaiApiKey?: string | null;
  };
  scrape?: { cron?: string; cronEnabled?: boolean };
};

let cache: EffectiveSettings | null = null;

function key(): Buffer {
  return getKey(config.credEncryptionKey);
}

export async function getEffectiveSettings(force = false): Promise<EffectiveSettings> {
  if (cache && !force) return cache;
  const row = await prisma.settings.findUnique({ where: { id: 1 } });

  const wpAppPassword = row?.wpAppPasswordEnc
    ? decrypt(row.wpAppPasswordEnc, key())
    : config.wp.appPassword ?? null;

  const anthropicApiKey = row?.anthropicApiKeyEnc
    ? decrypt(row.anthropicApiKeyEnc, key())
    : null;

  const openaiApiKey = row?.openaiApiKeyEnc
    ? decrypt(row.openaiApiKeyEnc, key())
    : process.env.OPENAI_API_KEY ?? null;

  const effective: EffectiveSettings = {
    sourceUrl: row?.sourceUrl ?? config.sourceUrl,
    wp: {
      url: row?.wpUrl ?? config.wp.url ?? null,
      username: row?.wpUsername ?? config.wp.username ?? null,
      appPassword: wpAppPassword,
      authorUsername: row?.wpAuthorUsername ?? null,
    },
    rewrite: {
      anthropicApiKey,
      enabled: row?.rewriteEnabled ?? false,
      model: row?.rewriteModel ?? 'claude-sonnet-4-6',
    },
    imagegen: {
      openaiApiKey,
    },
    scrape: {
      cron: row?.scrapeCron ?? config.scrape.cron,
      cronEnabled: row?.scrapeCronEnabled ?? config.scrape.cronEnabled,
    },
  };
  cache = effective;
  return effective;
}

export async function updateSettings(
  updates: SettingsUpdate,
): Promise<EffectiveSettings> {
  const data: Record<string, unknown> = {};
  if (updates.sourceUrl !== undefined) data.sourceUrl = updates.sourceUrl;
  if (updates.wp?.url !== undefined) data.wpUrl = updates.wp.url;
  if (updates.wp?.username !== undefined) data.wpUsername = updates.wp.username;
  if (updates.wp?.appPassword !== undefined) {
    data.wpAppPasswordEnc = updates.wp.appPassword
      ? encrypt(updates.wp.appPassword, key())
      : null;
  }
  if (updates.wp?.authorUsername !== undefined) {
    data.wpAuthorUsername = updates.wp.authorUsername;
  }
  if (updates.imagegen?.openaiApiKey !== undefined) {
    data.openaiApiKeyEnc = updates.imagegen.openaiApiKey
      ? encrypt(updates.imagegen.openaiApiKey, key())
      : null;
  }
  if (updates.scrape?.cron !== undefined) data.scrapeCron = updates.scrape.cron;
  if (updates.scrape?.cronEnabled !== undefined)
    data.scrapeCronEnabled = updates.scrape.cronEnabled;

  await prisma.settings.upsert({
    where: { id: 1 },
    update: data,
    create: { id: 1, ...data },
  });
  cache = null;
  return getEffectiveSettings(true);
}

export async function autoMigrateFromEnv(): Promise<void> {
  const existing = await prisma.settings.findUnique({ where: { id: 1 } });
  if (existing) return;

  const data: Record<string, unknown> = { id: 1 };
  data.sourceUrl = config.sourceUrl;
  if (config.wp.url) data.wpUrl = config.wp.url;
  if (config.wp.username) data.wpUsername = config.wp.username;
  if (config.wp.appPassword) {
    data.wpAppPasswordEnc = encrypt(config.wp.appPassword, key());
  }
  data.scrapeCron = config.scrape.cron;
  data.scrapeCronEnabled = config.scrape.cronEnabled;

  await prisma.settings.create({ data: data as never });
  console.log('[settings] migrated initial values from .env to encrypted DB');
}

export function invalidateCache(): void {
  cache = null;
}
