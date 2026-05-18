const BASE = `${import.meta.env.VITE_API_URL ?? ''}/api`;

export type Health = { ok: boolean; time: string };

export type PostStatus = 'scraped' | 'published' | 'discarded';

export type PostSummary = {
  id: number;
  sourceUrl: string;
  title: string;
  slug: string;
  author: string | null;
  publishedAt: string | null;
  category: string | null;
  featuredImage: string | null;
  status: PostStatus;
  wpPostId: number | null;
  scrapedAt: string;
};

export type PostDetail = PostSummary & {
  bodyHtml: string;
  imagesJson: string;
  linksJson: string;
  images: string[];
  links: string[];
  wpPublishedAt: string | null;
};

export type Job = {
  id: number;
  type: 'manual' | 'scheduled';
  startedAt: string;
  finishedAt: string | null;
  status: 'running' | 'success' | 'failed';
  postsFound: number;
  postsScraped: number;
  postsPublished: number;
  postsSkipped: number;
  errorLog: string | null;
};

export type ScrapeResult = {
  jobId: number;
  postsFound: number;
  postsScraped: number;
  postsSkipped: number;
  errors: string[];
};

export type PublishResult = {
  postId: number;
  wpPostId: number;
  wpLink: string;
  featuredImageUploaded: boolean;
  bodyImagesUploaded: number;
  bodyImagesSkipped: number;
  bodyImageErrors: string[];
};

export type Settings = {
  sourceUrl: string;
  wp: {
    url: string | null;
    username: string | null;
    appPasswordMasked: string | null;
    authorUsername: string | null;
  };
  scrape: {
    cron: string;
    cronEnabled: boolean;
  };
};

export type WpTestResult = {
  ok: boolean;
  user?: { id: number; name: string };
  error?: string;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...init,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`${path}: backend unreachable (${msg})`);
  }

  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // Non-JSON response — likely a proxy error page.
  }

  if (!res.ok) {
    if (
      data && typeof data === 'object' && 'error' in data &&
      typeof (data as { error: unknown }).error === 'string'
    ) {
      throw new Error((data as { error: string }).error);
    }
    const snippet = text.slice(0, 200).trim() || 'no body';
    throw new Error(`${path}: HTTP ${res.status} — ${snippet}`);
  }
  return data as T;
}

export type BulkResultItem = {
  id: number;
  ok: boolean;
  wpPostId?: number;
  error?: string;
};

export type BulkResult = {
  results: BulkResultItem[];
  summary: { total: number; ok: number; failed: number };
};

export type SettingsUpdate = {
  sourceUrl?: string;
  wp?: {
    url?: string | null;
    username?: string | null;
    appPassword?: string | null;
    authorUsername?: string | null;
  };
  imagegen?: { openaiApiKey?: string | null };
  scrape?: { cron?: string; cronEnabled?: boolean };
};

export type RegenerateImageResult = {
  referenceImageUrl: string;
  visionAnalysis: string;
  generatedPrompt: string;
  models: { vision: string; promptWriter: string; image: string };
  persisted?: {
    publicUrl: string;
    diskPath: string;
    bodyImageReplaced: boolean;
  };
  image?: { mimeType: string; base64: string };
};

export const api = {
  health: () => request<Health>('/health'),
  scrapeAll: () => request<ScrapeResult>('/scrape', { method: 'POST' }),
  scrapeUrl: (url: string) =>
    request<{ created: boolean; post: { id: number; title: string; status: string } }>(
      '/scrape-url',
      { method: 'POST', body: JSON.stringify({ url }) },
    ),
  listPosts: (status?: string) =>
    request<{ posts: PostSummary[] }>(
      status ? `/posts?status=${encodeURIComponent(status)}` : '/posts',
    ),
  getPost: (id: number) => request<PostDetail>(`/posts/${id}`),
  discardPost: (id: number) =>
    request<{ ok: boolean }>(`/posts/${id}`, { method: 'DELETE' }),
  publishPost: (id: number) =>
    request<PublishResult>(`/posts/${id}/publish`, { method: 'POST' }),
  bulkPublish: (ids: number[]) =>
    request<BulkResult>('/posts/bulk-publish', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    }),
  bulkDiscard: (ids: number[]) =>
    request<BulkResult>('/posts/bulk-discard', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    }),
  cleanDbBodies: () =>
    request<{ total: number; cleaned: number; unchanged: number; errors: Array<{ id: number; error: string }> }>(
      '/posts/clean-bodies',
      { method: 'POST' },
    ),
  cleanWp: (id: number) =>
    request<{ ok: boolean; wpPostId: number; changed: boolean }>(`/posts/${id}/clean-wp`, {
      method: 'POST',
    }),
  bulkCleanWp: (ids: number[]) =>
    request<{
      results: Array<{ id: number; ok: boolean; wpPostId?: number; changed?: boolean; error?: string }>;
      summary: { total: number; ok: number; changed: number; failed: number };
    }>('/posts/bulk-clean-wp', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    }),
  regenerateImage: (id: number, size?: '1536x1024' | '1024x1536' | '1024x1024') =>
    request<RegenerateImageResult>(`/posts/${id}/regenerate-image`, {
      method: 'POST',
      body: JSON.stringify({ size, includeImage: true }),
    }),
  listJobs: () => request<{ jobs: Job[] }>('/jobs'),
  getSettings: () => request<Settings>('/settings'),
  saveSettings: (updates: SettingsUpdate) =>
    request<Settings>('/settings', {
      method: 'PUT',
      body: JSON.stringify(updates),
    }),
  testWp: () => request<WpTestResult>('/wp/test'),
};
