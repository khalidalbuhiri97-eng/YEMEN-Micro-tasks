import type { IncomingMessage, ServerResponse } from 'node:http';
import app from '../server/app.js';

type VercelLikeRequest = IncomingMessage & {
  url?: string;
  originalUrl?: string;
  query?: Record<string, string | string[] | undefined>;
};

export function normalizeApiUrl(rawUrl?: string, queryFallback?: Record<string, string | string[] | undefined>): string {
  const url = rawUrl && rawUrl.trim() ? rawUrl : '/api';
  const parsed = new URL(url, 'http://localhost');

  const queryPathParam = parsed.searchParams.get('__path');
  const fallbackPathRaw = queryFallback?.__path;
  const fallbackPath = Array.isArray(fallbackPathRaw) ? fallbackPathRaw.join('/') : fallbackPathRaw;
  const rewrittenPath = queryPathParam !== null ? queryPathParam : typeof fallbackPath === 'string' ? fallbackPath : null;

  if (rewrittenPath !== null) {
    parsed.searchParams.delete('__path');
    const cleanedSubpath = rewrittenPath
      .replace(/^\/+/, '')
      .replace(/^api(?:\/|$)/i, '')
      .replace(/^index(?:\.ts|\.js)?(?:\/|$)/i, '')
      .replace(/^\/+/, '');
    const remainingQuery = parsed.searchParams.toString();
    const targetPath = cleanedSubpath ? `/api/${cleanedSubpath}` : '/api';
    return remainingQuery ? `${targetPath}?${remainingQuery}` : targetPath;
  }

  let pathname = parsed.pathname || '/api';
  if (pathname === '/' || pathname === '/index' || pathname === '/api/index' || pathname === '/api/index.ts' || pathname === '/api/index.js') {
    pathname = '/api';
  } else if (!pathname.startsWith('/api')) {
    pathname = `/api${pathname.startsWith('/') ? '' : '/'}${pathname}`;
  }

  const query = parsed.searchParams.toString();
  return query ? `${pathname}?${query}` : pathname;
}

export default function handler(req: VercelLikeRequest, res: ServerResponse) {
  const normalizedUrl = normalizeApiUrl(req.url, req.query);
  req.url = normalizedUrl;
  req.originalUrl = normalizedUrl;

  if ('query' in req) {
    try {
      delete req.query;
    } catch {
      // Ignore if getter is non-configurable
    }
  }

  return app(req as any, res as any);
}
