import 'dotenv/config';

const API_KEY = process.env.TAVILY_API_KEY;
const BASE = 'https://api.tavily.com';

if (!API_KEY) {
  throw new Error('Missing TAVILY_API_KEY in environment');
}

export interface SearchResult {
  title: string;
  url: string;
  content: string; // snippet
  score: number;
}

async function post(path: string, body: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: API_KEY, ...body }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Tavily ${path} error ${res.status}: ${text}`);
  }

  return res.json();
}

export async function search(query: string, maxResults = 20): Promise<SearchResult[]> {
  const data = (await post('/search', {
    query,
    search_depth: 'advanced',
    max_results: maxResults,
    include_answer: false,
    include_raw_content: false,
    include_images: false,
  })) as { results: SearchResult[] };

  return data.results ?? [];
}

export async function extract(url: string): Promise<string | null> {
  try {
    const data = (await post('/extract', { urls: [url] })) as {
      results: Array<{ url: string; raw_content: string; failed?: boolean }>;
    };
    const result = data.results?.[0];
    if (!result || result.failed) return null;
    return result.raw_content ?? null;
  } catch {
    return null;
  }
}
