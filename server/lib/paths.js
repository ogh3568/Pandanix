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

/** 두 경로가 같은 위치인지 (OS 대소문자 규칙 반영) */
export function samePath(a, b) {
  return normalizeForCompare(a) === normalizeForCompare(b);
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

/** 파일 탐색기 API 가 절대 건드리면 안 되는 내부 폴더 (API 키·설정 파일) */
export const PROTECTED_DIRS = () => [DIRS.config];

/**
 * 사용자가 보낸 경로가 허용된 루트 중 하나 안에 있는지 검사하고 절대 경로를 돌려준다.
 * 아니면 오류를 던진다. (파일 탐색기 API 에서 사용)
 * - Windows 에서 끝에 점/공백이 붙은 구성요소(`Docs.`, `Docs `)는 OS 가 잘라내어 다른 경로가 되므로 거부한다.
 * - data/config (키·설정) 는 어떤 루트가 허용돼도 접근할 수 없다.
 */
export function resolveAllowed(userPath, allowedRoots) {
  if (typeof userPath !== 'string' || !userPath.trim()) throw httpError(400, '경로가 비어 있습니다.');
  if (userPath.includes('\u0000')) throw httpError(400, '잘못된 경로입니다.');
  const abs = path.resolve(userPath);
  if (IS_WINDOWS && abs.split(/[\\/]/).some((seg, i) => i > 0 && seg && /[. ]$/.test(seg))) {
    throw httpError(400, 'Windows 에서는 끝에 점(.)이나 공백이 붙은 폴더/파일 이름을 쓸 수 없습니다.');
  }
  for (const protectedDir of PROTECTED_DIRS()) {
    if (isInside(protectedDir, abs)) throw httpError(403, '설정·API 키 폴더(data/config)는 파일 탐색기로 접근할 수 없습니다.');
  }
  const roots = Array.isArray(allowedRoots) ? allowedRoots : [];
  for (const root of roots) {
    if (typeof root === 'string' && root && isInside(root, abs)) return abs;
  }
  throw httpError(403, `허용되지 않은 경로입니다: ${abs}\n설정 > 파일 접근 허용 폴더 에 이 폴더(또는 상위 폴더)를 추가하세요.`);
}

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/**
 * 안전한 파일/폴더 이름. 멱등(두 번 적용해도 같은 결과)이며 Windows 규칙을 지킨다:
 * 경로 구분자·제어문자 제거, 앞뒤 공백·점 제거, 예약 이름(CON 등) 접두사, 길이 제한.
 */
export function safeName(name, fallback = 'file') {
  let cleaned = String(name || '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .trim()
    .replace(/^\.+/, '')
    .replace(/[. ]+$/, '')
    .trim();
  if (WINDOWS_RESERVED.test(cleaned)) cleaned = '_' + cleaned;
  if (Buffer.byteLength(cleaned, 'utf8') > 200) {
    const ext = path.extname(cleaned);
    let base = path.basename(cleaned, ext);
    while (Buffer.byteLength(base + ext, 'utf8') > 200) base = base.slice(0, -1);
    cleaned = base + ext;
  }
  return cleaned || fallback;
}

export function httpError(status, message, extra = {}) {
  const err = new Error(message);
  err.status = status;
  Object.assign(err, extra);
  return err;
}

/** JSON 파일 읽기. 없거나(ENOENT) 폴더가 아니면(ENOTDIR) fallback. UTF-8 BOM 허용. */
export function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR' || err.code === 'EISDIR') return fallback;
    throw err;
  }
}

/** 깨진 JSON 도 fallback 으로 넘기고 콘솔에 경고만 남긴다 (목록 조회용) */
export function readJsonLenient(file, fallback = null) {
  try {
    return readJson(file, fallback);
  } catch (err) {
    console.warn(`[pandanix] JSON 읽기 실패 (건너뜀): ${file} - ${err.message}`);
    return fallback;
  }
}

/** 원자적 JSON 쓰기 (임시 파일 후 rename). Windows 파일 잠금(EPERM/EBUSY)은 잠깐 재시도. */
export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  renameWithRetry(tmp, file);
}

function renameWithRetry(from, to, attempts = 5) {
  for (let i = 0; ; i++) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (err) {
      if (i >= attempts - 1 || !['EPERM', 'EBUSY', 'EACCES'].includes(err.code)) throw err;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50 * (i + 1));
    }
  }
}

export function exists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

/** 디렉터리 항목 중 "폴더" 이름만 (desktop.ini, Thumbs.db 같은 잡파일 무시) */
export function listDirs(dir) {
  if (!exists(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
}

/**
 * 텍스트 파일을 읽는다. UTF-8 로 해석되지 않으면(한국어 Excel 의 CP949 CSV 등) EUC-KR 로 다시 시도한다.
 */
export function readTextSmart(file) {
  const buf = fs.readFileSync(file);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^﻿/, '');
  } catch {
    try {
      return new TextDecoder('euc-kr').decode(buf);
    } catch {
      return buf.toString('utf8');
    }
  }
}
