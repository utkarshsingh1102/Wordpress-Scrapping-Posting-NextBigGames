import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().default(3001),
  DATABASE_URL: z.string().default('file:./dev.db'),
  SOURCE_URL: z.string().url().default('https://www.gamigion.com/'),
  WP_URL: z.string().optional(),
  WP_USERNAME: z.string().optional(),
  WP_APP_PASSWORD: z.string().optional(),
  CRED_ENCRYPTION_KEY: z.string().optional(),
  SCRAPE_CRON: z.string().default('0 * * * *'),
  SCRAPE_CRON_ENABLED: z.string().default('true'),
  PUBLIC_BASE_URL: z.string().url().optional(),
  CORS_ORIGIN: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.format());
  process.exit(1);
}

export const config = {
  port: parsed.data.PORT,
  databaseUrl: parsed.data.DATABASE_URL,
  sourceUrl: parsed.data.SOURCE_URL,
  wp: {
    url: parsed.data.WP_URL,
    username: parsed.data.WP_USERNAME,
    appPassword: parsed.data.WP_APP_PASSWORD,
  },
  scrape: {
    cron: parsed.data.SCRAPE_CRON,
    cronEnabled: parsed.data.SCRAPE_CRON_ENABLED.toLowerCase() === 'true',
  },
  credEncryptionKey: parsed.data.CRED_ENCRYPTION_KEY,
  publicBaseUrl: parsed.data.PUBLIC_BASE_URL,
  corsOrigin: parsed.data.CORS_ORIGIN,
};
