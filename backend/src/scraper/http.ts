import axios from 'axios';
import { withRetry } from '../util/retry';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export const http = axios.create({
  timeout: 45000,
  headers: {
    'User-Agent': USER_AGENT,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
  },
  maxRedirects: 5,
});

export async function fetchHtml(url: string): Promise<string> {
  return withRetry(
    async () => {
      const res = await http.get<string>(url, { responseType: 'text' });
      return res.data;
    },
    { label: `GET ${url}` },
  );
}
