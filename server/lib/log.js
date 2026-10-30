// 콘솔 로그를 data/logs/pandanix.log 에도 남긴다 (서버가 혼자 꺼졌을 때 원인 추적용).
// 파일은 5MB 를 넘으면 .1 로 한 번 회전한다.
import fs from 'node:fs';
import path from 'node:path';
import { DIRS } from './paths.js';

const LOG_DIR = path.join(DIRS.data, 'logs');
export const LOG_FILE = path.join(LOG_DIR, 'pandanix.log');
let installed = false;

export function installFileLogging() {
  if (installed) return;
  installed = true;
  try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch { return; }
  const write = (level, args) => {
    try {
      if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > 5 * 1024 * 1024) fs.renameSync(LOG_FILE, LOG_FILE + '.1');
      const line = args.map((a) => (a instanceof Error ? a.stack || a.message : typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
      fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} [${level}] ${line}\n`);
    } catch {
      /* 로그 실패는 무시 */
    }
  };
  for (const level of ['log', 'warn', 'error']) {
    const orig = console[level].bind(console);
    console[level] = (...args) => {
      orig(...args);
      write(level, args);
    };
  }
}
