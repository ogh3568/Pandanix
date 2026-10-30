import { Router } from 'express';
import { runDoctor } from '../doctor.js';
import { wrap } from '../lib/async.js';

export const doctorRouter = Router();

doctorRouter.get(
  '/doctor',
  wrap(async (req, res) => {
    const live = req.query.live === '1' || req.query.live === 'true';
    res.json(await runDoctor({ live, serverRunning: true }));
  }),
);
