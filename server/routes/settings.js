import { Router } from 'express';
import { PROVIDERS, loadSettings, saveSettings, maskedCredentials, saveCredentials, getAllowedRoots } from '../config.js';
import { getProvider } from '../providers/index.js';
import { wrap } from '../lib/async.js';
import { DIRS, exists } from '../lib/paths.js';
import fs from 'node:fs';

export const settingsRouter = Router();

settingsRouter.get('/settings', (req, res) => {
  res.json({
    settings: loadSettings(),
    providers: Object.fromEntries(Object.entries(PROVIDERS).map(([k, v]) => [k, { label: v.label, kind: v.kind, keyUrl: v.keyUrl, note: v.note || '', defaultModel: v.defaultModel, keyOptional: Boolean(v.keyOptional) }])),
    credentials: maskedCredentials(),
    dataDir: DIRS.data,
    allowedRoots: getAllowedRoots(),
    platform: process.platform,
  });
});

settingsRouter.put('/settings', (req, res) => {
  const patch = req.body || {};
  if (Array.isArray(patch.allowedRoots)) {
    const missing = patch.allowedRoots.filter((p) => !exists(p) || !fs.statSync(p).isDirectory());
    if (missing.length) return res.status(400).json({ error: `존재하지 않는 폴더: ${missing.join(', ')}` });
  }
  res.json({ settings: saveSettings(patch), allowedRoots: getAllowedRoots() });
});

settingsRouter.get('/credentials', (req, res) => res.json(maskedCredentials()));

settingsRouter.put('/credentials', (req, res) => {
  res.json(saveCredentials(req.body || {}));
});

/** 키 유효성 테스트 (모델 목록 조회) */
settingsRouter.post(
  '/providers/:name/test',
  wrap(async (req, res) => {
    try {
      const p = getProvider(req.params.name);
      const r = await p.ping();
      res.json({ ok: true, ...r });
    } catch (err) {
      res.json({ ok: false, error: err.message });
    }
  }),
);

settingsRouter.get(
  '/providers/:name/models',
  wrap(async (req, res) => {
    const p = getProvider(req.params.name);
    res.json({ models: await p.listModels() });
  }),
);
