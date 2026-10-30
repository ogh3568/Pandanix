// 경로 유틸리티: 데이터 디렉터리 위치와 "허용된 루트" 안에서만 파일 접근을 허용하는 검사.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** 프로젝트 루트 (package.json 이 있는 폴더) */
export const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

/** 데이터 루트. 환경변수 PANDANIX_DATA_DIR 로 바꿀 수 있다. 기본값: <프로젝트>/data */
export const DATA_DIR = path.resolve(process.env.PANDANIX_DATA_DIR || path.join(PROJECT_ROOT, 'data'));

export const DIRS = {
  data: DATA_DIR,
  config: path.join(DATA_DIR, 'config'),
  workbooks: path.join(DATA_DIR, 'workbooks'),
  answers: path.join(DATA_DIR, 'answers'),
  tmp: path.join(DATA_DIR, 'tmp'),
};

export const FILES = {
  settings: path.join(DIRS.config, 'settings.json'),
  credentials: path.join(DIRS.config, 'credentials.json'),
  credentialsExample: path.join(DIRS.config, 'credentials.example.json'),
};

export const IS_WINDOWS = process.platform === 'win32';

export function ensureDirs() {
  for (const dir of Object.values(DIRS)) fs.mkdirSync(dir, { recursive: true });
}

/** Windows 는 대소문자를 구분하지 않으므로 비교용으로 정규화한다. */
export function normalizeForCompare(p) {
  const abs = path.resolve(p);
  return IS_WINDOWS ? abs.toLowerCase() : abs;
}

/**
 * target 이 root 디렉터리 안(또는 root 자신)인지 검사한다.
 * 경로 순회(..) 공격을 막기 위해 반드시 resolve 후 비교한다.
 */
export function isInside(root, target) {
  const r = normalizeForCompare(root);
  const t = normalizeForCompare(target);
  if (t === r) return true;
  const withSep = r.endsWith(path.sep) ? r : r + path.sep;
  return t.startsWith(withSep);
}

/**
 * 사용자가 보낸 경로가 허용된 루트 중 하나 안에 있는지 검사하고 절대 경로를 돌려준다.
 * 아니면 오류를 던진다. (파일 탐색기 API 에서 사용)
 */
export function resolveAllowed(userPath, allowedRoots) {
  if (typeof userPath !== 'string' || !userPath.trim()) throw httpError(400, '경로가 비어 있습니다.');
  const abs = path.resolve(userPath);
  for (const root of allowedRoots) {
    if (isInside(root, abs)) return abs;
  }
  throw httpError(403, `허용되지 않은 경로입니다: ${abs}\n설정 > 파일 접근 허용 폴더 에 이 폴더(또는 상위 폴더)를 추가하세요.`);
}

/** 안전한 파일/폴더 이름(경로 구분자, 제어문자 제거) */
export function safeName(name, fallback = 'file') {
  const cleaned = String(name || '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/^\.+/, '')
    .trim();
  return cleaned || fallback;
}

export function httpError(status, message, extra = {}) {
  const err = new Error(message);
  err.status = status;
  Object.assign(err, extra);
  return err;
}

export function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
}

export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

export function exists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}
