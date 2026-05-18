import axios, { type AxiosInstance } from 'axios';
import { getEffectiveSettings } from '../services/settings';
import { withRetry } from '../util/retry';

export type WpMedia = {
  id: number;
  source_url: string;
  mime_type: string;
};

export type WpPost = {
  id: number;
  link: string;
  status: string;
};

async function makeClient(): Promise<AxiosInstance> {
  const s = await getEffectiveSettings();
  if (!s.wp.url || !s.wp.username || !s.wp.appPassword) {
    throw new Error(
      'WordPress credentials missing. Set them via the Settings page or in backend/.env',
    );
  }
  return axios.create({
    baseURL: `${s.wp.url.replace(/\/$/, '')}/wp-json/wp/v2`,
    auth: { username: s.wp.username, password: s.wp.appPassword },
    timeout: 60000,
  });
}

export async function testWpConnection(): Promise<{ id: number; name: string }> {
  const client = await makeClient();
  const res = await client.get('/users/me?context=edit');
  return { id: res.data.id, name: res.data.name };
}

const authorIdCache = new Map<string, number>();

export async function resolveAuthorId(username: string): Promise<number> {
  const key = username.toLowerCase();
  const cached = authorIdCache.get(key);
  if (cached) return cached;

  const client = await makeClient();
  const res = await client.get<Array<{ id: number; slug: string; name: string }>>(
    `/users?slug=${encodeURIComponent(username)}&context=edit`,
  );
  const match = res.data.find((u) => u.slug.toLowerCase() === key);
  if (!match) {
    throw new Error(
      `WP user with slug '${username}' not found. Create the user in WP admin, or change/clear the author setting.`,
    );
  }
  authorIdCache.set(key, match.id);
  return match.id;
}

export function clearAuthorCache(): void {
  authorIdCache.clear();
}

export async function uploadMedia(opts: {
  binary: Buffer;
  filename: string;
  mimeType: string;
}): Promise<WpMedia> {
  return withRetry(
    async () => {
      const client = await makeClient();
      const res = await client.post('/media', opts.binary, {
        headers: {
          'Content-Type': opts.mimeType,
          'Content-Disposition': `attachment; filename="${opts.filename}"`,
        },
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      });
      return {
        id: res.data.id,
        source_url: res.data.source_url,
        mime_type: res.data.mime_type,
      };
    },
    { label: `wp uploadMedia(${opts.filename})`, idempotent: false },
  );
}

export async function getWpPostContent(wpPostId: number): Promise<string> {
  return withRetry(
    async () => {
      const client = await makeClient();
      const res = await client.get(`/posts/${wpPostId}?context=edit`);
      // raw is the editable source; rendered is post-processed.
      const raw = res.data?.content?.raw;
      const rendered = res.data?.content?.rendered;
      return typeof raw === 'string' && raw.length > 0
        ? raw
        : typeof rendered === 'string'
          ? rendered
          : '';
    },
    { label: `wp getPost(${wpPostId})` },
  );
}

export async function updateWpPost(opts: {
  wpPostId: number;
  content?: string;
  title?: string;
  status?: 'draft' | 'publish';
}): Promise<WpPost> {
  return withRetry(
    async () => {
      const client = await makeClient();
      const body: Record<string, unknown> = {};
      if (opts.content !== undefined) body.content = opts.content;
      if (opts.title !== undefined) body.title = opts.title;
      if (opts.status !== undefined) body.status = opts.status;
      const res = await client.post(`/posts/${opts.wpPostId}`, body);
      return { id: res.data.id, link: res.data.link, status: res.data.status };
    },
    { label: `wp updatePost(${opts.wpPostId})`, idempotent: false },
  );
}

export async function createPost(opts: {
  title: string;
  content: string;
  status: 'draft' | 'publish';
  featuredMedia?: number;
  date?: Date | null;
  authorId?: number;
}): Promise<WpPost> {
  return withRetry(
    async () => {
      const client = await makeClient();
      const body: Record<string, unknown> = {
        title: opts.title,
        content: opts.content,
        status: opts.status,
      };
      if (opts.featuredMedia) body.featured_media = opts.featuredMedia;
      if (opts.authorId) body.author = opts.authorId;
      if (opts.date) {
        body.date_gmt = opts.date.toISOString().replace(/\.\d+Z$/, '');
      }
      const res = await client.post('/posts', body);
      return { id: res.data.id, link: res.data.link, status: res.data.status };
    },
    { label: `wp createPost`, idempotent: false },
  );
}
