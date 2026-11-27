import { updateAttendance } from './lib/attendance';
import { requireFormationManager } from './lib/clubBackend';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import {
  analyzeFormationRequest,
  ApiHttpError,
} from './lib/formationAnalyzer';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: 'perspolis-vancouver' });
  });

  app.post('/api/attendance', async (req, res) => {
    try {
      await updateAttendance(req.headers.authorization, req.body);
      res.status(204).end();
    } catch (error) {
      if (error instanceof ApiHttpError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      console.error('Attendance update failed:', error);
      res.status(500).json({ error: 'Could not update attendance.' });
    }
  });

  app.post('/api/formation/analyze', async (req, res) => {
    try {
      await requireFormationManager(req.headers.authorization);
      const formation = await analyzeFormationRequest(req.body);
      res.json(formation);
    } catch (error) {
      if (error instanceof ApiHttpError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      console.error('Formation analysis failed:', error);
      res.status(500).json({ error: 'Failed to generate AI formation.' });
    }
  });

  // Serve local MediaPipe Vision WASM assets for fast, offline-safe portrait background removal
  const mediapipeWasmPath = path.resolve(
    __dirname,
    'node_modules',
    '@mediapipe',
    'tasks-vision',
    'wasm'
  );
  app.use('/mediapipe/wasm', express.static(mediapipeWasmPath, { maxAge: '7d' }));

  // Same-origin cached proxy for MediaPipe selfie multiclass model (segments background, hair, skin, face, clothes, accessories)
  let cachedMulticlassModel: Buffer | null = null;
  app.get('/api/mediapipe-model/selfie-multiclass', async (_req, res) => {
    try {
      if (!cachedMulticlassModel) {
        const modelResp = await fetch(
          'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite'
        );
        if (!modelResp.ok) {
          throw new Error(`Multiclass model download failed (${modelResp.status})`);
        }
        cachedMulticlassModel = Buffer.from(await modelResp.arrayBuffer());
      }
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.send(cachedMulticlassModel);
    } catch (err) {
      console.error('Failed to serve MediaPipe multiclass segmenter model:', err);
      res.status(502).json({ error: 'Could not load head-and-neck segmentation model.' });
    }
  });

  // Same-origin cached proxy for fallback MediaPipe selfie segmentation model
  let cachedSelfieModel: Buffer | null = null;
  app.get('/api/mediapipe-model/selfie-segmenter', async (_req, res) => {
    try {
      if (!cachedSelfieModel) {
        const modelResp = await fetch(
          'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite'
        );
        if (!modelResp.ok) {
          throw new Error(`Model download failed (${modelResp.status})`);
        }
        cachedSelfieModel = Buffer.from(await modelResp.arrayBuffer());
      }
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.send(cachedSelfieModel);
    } catch (err) {
      console.error('Failed to serve MediaPipe selfie segmenter model:', err);
      res.status(502).json({ error: 'Could not load background removal model.' });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Perspolis Vancouver server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
