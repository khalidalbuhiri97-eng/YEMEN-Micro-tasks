import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
import app from './server/app.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const isProduction = process.env.NODE_ENV === 'production';

async function startServer() {
  const httpServer = process.env.VERCEL !== '1' ? http.createServer(app) : null;
  const disableHmr = process.env.DISABLE_HMR === 'true';

  app.get('/.well-known/assetlinks.json', (_req, res) => {
    const targetPath = isProduction
      ? path.resolve(__dirname, 'dist', '.well-known', 'assetlinks.json')
      : path.resolve(__dirname, 'public', '.well-known', 'assetlinks.json');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
    res.sendFile(targetPath);
  });

  if (!isProduction) {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: disableHmr ? false : httpServer ? { server: httpServer } : false,
        ...(disableHmr ? { ws: false as const } : {}),
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(
      express.static(distPath, {
        dotfiles: 'allow',
        setHeaders: (res, filePath) => {
          if (filePath.endsWith('assetlinks.json')) {
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
          } else if (filePath.endsWith('.apk')) {
            res.setHeader('Content-Type', 'application/vnd.android.package-archive');
            res.setHeader('Content-Disposition', 'attachment; filename="Yemen-Task.apk"');
          }
        },
      })
    );
    app.get('*', (req, res) => {
      if (req.path.startsWith('/.well-known/') || req.path.endsWith('.apk')) {
        return res.status(404).end();
      }
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  if (httpServer) {
    httpServer.listen(PORT, '0.0.0.0', () => {
      console.log(`[Yemen Micro-tasks] Local Dev Server running on http://localhost:${PORT}`);
    });
  }
}

startServer();

export default app;
