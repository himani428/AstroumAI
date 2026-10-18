import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import type { Db } from '../db/connection.js';
import { config } from '../config.js';
import { log } from '../logger.js';
import { errorHandler } from './http.js';
import { drugRoutes } from './routes/drugs.js';
import { regSafetyRoutes } from './routes/regsafety.js';
import { qaRoutes } from './routes/qa.js';
import { systemRoutes } from './routes/system.js';

export function createApp(db: Db) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '256kb' }));
  app.use((req, res, next) => {
    const t = Date.now();
    res.on('finish', () => { if (req.path.startsWith('/api')) log.info('request', { method: req.method, path: req.path, status: res.statusCode, ms: Date.now() - t }); });
    next();
  });
  app.use('/api', drugRoutes(db), regSafetyRoutes(db), qaRoutes(db), systemRoutes(db));
  app.use('/api', (_req, res) => void res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Unknown API route', details: null } }));
  if (fs.existsSync(path.join(config.paths.webDist, 'index.html'))) {
    app.use(express.static(config.paths.webDist));
    app.get(/^\/(?!api).*/, (_req, res) => void res.sendFile(path.join(config.paths.webDist, 'index.html')));
  }
  app.use(errorHandler);
  return app;
}
