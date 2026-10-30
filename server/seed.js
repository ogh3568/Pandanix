// 첫 실행 시 문제집이 하나도 없으면 샘플 문제집을 넣는다.
// 샘플 원본: server/seed/sample-workbook/ (가져오기 폴더 형식의 예시이기도 하다)
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listWorkbooks, importWorkbookFromDir } from './lib/store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const SAMPLE_DIR = path.join(__dirname, 'seed', 'sample-workbook');

export function seedIfEmpty() {
  try {
    if (listWorkbooks().length > 0) return false;
    const wb = importWorkbookFromDir(SAMPLE_DIR);
    console.log(`[pandanix] 샘플 문제집 생성: ${wb.title}`);
    return true;
  } catch (err) {
    console.warn('[pandanix] 샘플 문제집 생성 실패:', err.message);
    return false;
  }
}
