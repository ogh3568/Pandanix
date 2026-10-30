// 내장 문제집 라이브러리 (server/seed/library/<slug>/) 와 첫 실행 시드.
// 각 폴더는 "가져오기 폴더 형식" 과 동일하다 (docs/dev/data-model.md).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listWorkbooks, importWorkbookFromDir } from './lib/store.js';
import { readJson, readJsonLenient, httpError, DIRS, listDirs } from './lib/paths.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const LIBRARY_DIR = path.join(__dirname, 'seed', 'library');

/** 내장 문제집 목록 + 설치 여부 (설치된 문제집의 libraryId 로 판별) */
export function listLibrary() {
  if (!fs.existsSync(LIBRARY_DIR)) return [];
  const installed = new Map();
  for (const wb of listWorkbooks()) if (wb.libraryId) installed.set(wb.libraryId, wb.id);
  const out = [];
  for (const slug of listDirs(LIBRARY_DIR).sort()) {
    const dir = path.join(LIBRARY_DIR, slug);
    const wb = readJsonLenient(path.join(dir, 'workbook.json'), null);
    if (!wb) continue;
    const problems = (wb.problemOrder || [])
      .filter((pid) => /^[A-Za-z0-9_-]{1,64}$/.test(String(pid)))
      .map((pid) => readJsonLenient(path.join(dir, 'problems', pid, 'problem.json'), null))
      .filter(Boolean)
      .map((p) => ({ id: p.id, title: p.title }));
    out.push({
      id: slug,
      title: wb.title,
      description: wb.description || '',
      category: wb.category || '',
      difficulty: wb.difficulty || '',
      problems,
      installedId: installed.get(slug) || null,
    });
  }
  // 기초 문제집이 맨 앞에 오도록
  out.sort((a, b) => (a.id === 'lib-basics' ? -1 : b.id === 'lib-basics' ? 1 : a.title.localeCompare(b.title)));
  return out;
}

/** 내장 문제집 설치(복사). 이미 설치돼 있어도 force 면 한 번 더 복사한다. */
export function installLibraryWorkbook(slug, { force = false } = {}) {
  if (!/^[A-Za-z0-9_-]+$/.test(slug)) throw httpError(400, '잘못된 라이브러리 ID');
  const dir = path.join(LIBRARY_DIR, slug);
  if (!fs.existsSync(path.join(dir, 'workbook.json'))) throw httpError(404, `내장 문제집이 없습니다: ${slug}`);
  const existing = listLibrary().find((l) => l.id === slug)?.installedId;
  if (existing && !force) throw httpError(409, '이미 설치된 문제집입니다. 다시 설치하려면 "복사본 추가" 를 선택하세요.');
  return importWorkbookFromDir(dir, { libraryId: slug, source: 'library' });
}

/**
 * 첫 실행이면 내장 문제집을 모두 설치한다.
 * "첫 실행" 판정은 data/.seeded 마커 파일로 한다 (사용자가 문제집을 전부 지운 뒤 재시작해도 다시 깔지 않도록).
 */
export function seedIfEmpty() {
  const marker = path.join(DIRS.data, '.seeded');
  if (fs.existsSync(marker)) return false;
  if (listWorkbooks().length > 0) {
    fs.writeFileSync(marker, new Date().toISOString());
    return false;
  }
  let n = 0;
  for (const lib of listLibrary()) {
    try {
      installLibraryWorkbook(lib.id);
      n++;
    } catch (err) {
      console.warn(`[pandanix] 내장 문제집 설치 실패 (${lib.id}): ${err.message}`);
    }
  }
  try { fs.writeFileSync(marker, new Date().toISOString()); } catch {}
  console.log(`[pandanix] 내장 문제집 ${n}개 설치`);
  return n > 0;
}
