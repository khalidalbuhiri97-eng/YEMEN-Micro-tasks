import type { IncomingMessage, ServerResponse } from 'node:http';
import app from '../server/app.js';

export default function handler(req: IncomingMessage & { url?: string }, res: ServerResponse) {
  if (!req.url || req.url === '/') {
    req.url = '/api';
  } else if (!req.url.startsWith('/api')) {
    req.url = `/api${req.url.startsWith('/') ? '' : '/'}${req.url}`;
  }

  return app(req as any, res as any);
}
