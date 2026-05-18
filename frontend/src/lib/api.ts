const BASE = `${import.meta.env.VITE_API_URL ?? ''}/api`;

export type Health = { ok: boolean; time: string };

export type Source = {
  id: number;
  name: string;
  homepageUrl: string;
  enabled: boolean;
  lastScrapedAt: string | null;
  createdAt: string;
};

export type ImageZipUploadResult = {
  postId: number;
  imageCount: number;
  title: string;
};

export type PostStatus = 'scraped' | 'published' | 'discarded';

export type PostSummary = {
  id: number;
  sourceUrl: string;
  sourceName: string | null;
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

export type LinkedinNewsletter = {
  id: number;
  name: string;
  url: string;
  lastScrapedAt: string | null;
  createdAt: string;
};

export type LinkedInEditionResult =
  | { url: string; ok: true; created: boolean; postId: number; title: string }
  | { url: string; ok: false; error: string };

export type LinkedInNewsletterScrapeResult = {
  newsletterId: number | null;
  newsletterUrl: string;
  ok: boolean;
  error?: string;
  editionsFound: number;
  results: LinkedInEditionResult[];
  summary: { total: number; created: number; existed: number; failed: number };
};

export type LinkedInScrapeAllResult = {
  newsletters: LinkedInNewsletterScrapeResult[];
  summary: {
    newsletters: number;
    total: number;
    created: number;
    existed: number;
    failed: number;
  };
};

export type LinkedInScrapeResult =
  | ({ mode: 'newsletter' } & LinkedInNewsletterScrapeResult)
  | {
      mode: 'article';
      created: boolean;
      post: { id: number; title: string; status: string };
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
  scrapeLinkedIn: (url: string) =>
    request<LinkedInScrapeResult>('/linkedin/scrape', {
      method: 'POST',
      body: JSON.stringify({ url }),
    }),
  listLinkedInNewsletters: () =>
    request<{ newsletters: LinkedinNewsletter[] }>('/linkedin/newsletters'),
  addLinkedInNewsletter: (url: string, name?: string) =>
    request<LinkedinNewsletter>('/linkedin/newsletters', {
      method: 'POST',
      body: JSON.stringify({ url, name }),
    }),
  deleteLinkedInNewsletter: (id: number) =>
    request<{ ok: boolean }>(`/linkedin/newsletters/${id}`, { method: 'DELETE' }),
  scrapeLinkedInNewsletter: (id: number) =>
    request<LinkedInNewsletterScrapeResult>(`/linkedin/newsletters/${id}/scrape`, {
      method: 'POST',
    }),
  scrapeAllLinkedInNewsletters: () =>
    request<LinkedInScrapeAllResult>('/linkedin/newsletters/scrape-all', { method: 'POST' }),
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
  listSources: () => request<Source[]>('/sources'),
  createSource: (name: string, homepageUrl: string) =>
    request<Source>('/sources', {
      method: 'POST',
      body: JSON.stringify({ name, homepageUrl }),
    }),
  updateSource: (id: number, updates: { name?: string; enabled?: boolean }) =>
    request<Source>(`/sources/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    }),
  deleteSource: (id: number) =>
    request<null>(`/sources/${id}`, { method: 'DELETE' }),
  uploadImageZip: async (file: File): Promise<ImageZipUploadResult> => {
    const form = new FormData();
    form.append('file', file);
    let res: Response;
    try {
      res = await fetch(`${BASE}/image-zip/upload`, { method: 'POST', body: form });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`/image-zip/upload: backend unreachable (${msg})`);
    }
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      /* non-JSON */
    }
    if (!res.ok) {
      if (
        data && typeof data === 'object' && 'error' in data &&
        typeof (data as { error: unknown }).error === 'string'
      ) {
        throw new Error((data as { error: string }).error);
      }
      throw new Error(`/image-zip/upload: HTTP ${res.status}`);
    }
    return data as ImageZipUploadResult;
  },
};
