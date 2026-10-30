// 사용자가 올린 파일(참고자료·첨부)을 브라우저에 보낼 때의 공통 규칙.
// HTML/SVG/JS 같은 "실행 가능한" 형식은 같은 출처에서 inline 으로 열리면 스크립트가 API 에 접근할 수 있으므로 다운로드로만 제공한다.
import path from 'node:path';

const INLINE_OK = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.pdf', '.txt', '.csv', '.md', '.json', '.tsv', '.yaml', '.yml', '.log', '.ini', '.xml']);

export function sendUserFile(res, file) {
  const ext = path.extname(file).toLowerCase();
  if (!INLINE_OK.has(ext)) return res.download(file);
  res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (ext === '.xml' || ext === '.md' || ext === '.csv' || ext === '.tsv' || ext === '.yaml' || ext === '.yml' || ext === '.log' || ext === '.ini') res.type('text/plain; charset=utf-8');
  res.sendFile(file);
}
