// 단위 테스트: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { htmlToMarkdown, htmlToText, countChars } from '../server/lib/html2md.js';
import { extractJson, buildWorkbookGenerationPrompt } from '../server/lib/prompt.js';
import { isInside, resolveAllowed, safeName } from '../server/lib/paths.js';

test('htmlToMarkdown: 제목/굵게/표 변환', () => {
  const md = htmlToMarkdown('<h2>개요</h2><p>테스트 <b>굵게</b></p><table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>');
  assert.match(md, /^## 개요/m);
  assert.match(md, /\*\*굵게\*\*/);
  assert.match(md, /\| A \| B \|\n\| --- \| --- \|\n\| 1 \| 2 \|/);
});

test('htmlToText / countChars', () => {
  const t = htmlToText('<p>안녕 하세요</p><p>둘째&nbsp;줄</p>');
  assert.equal(t, '안녕 하세요\n\n둘째 줄');
  assert.deepEqual(countChars(t), { withSpaces: 10, withoutSpaces: 8 });
});

test('extractJson: 코드펜스와 후행 콤마 허용', () => {
  assert.deepEqual(extractJson('```json\n{"a": 1, "b": [1,2,],}\n```'), { a: 1, b: [1, 2] });
  assert.deepEqual(extractJson('설명 문장 {"title":"x"} 끝'), { title: 'x' });
  assert.throws(() => extractJson('json 없음'));
});

test('buildWorkbookGenerationPrompt 는 count 를 반영', () => {
  const { user, system } = buildWorkbookGenerationPrompt({ topic: '마케팅', count: 4 });
  assert.match(user, /문제 수: 4/);
  assert.match(system, /JSON 스키마/);
});

test('경로 보호: 허용 루트 밖은 거부', () => {
  assert.equal(isInside('/data', '/data/a/b'), true);
  assert.equal(isInside('/data', '/database'), false);
  assert.equal(resolveAllowed('/data/x/../y', ['/data']).endsWith('y'), true);
  assert.throws(() => resolveAllowed('/data/../etc/passwd', ['/data']), /허용되지 않은 경로/);
});

test('safeName 은 경로 구분자를 제거', () => {
  assert.equal(safeName('../a/b\\c:d.txt'), '_a_b_c_d.txt');
  assert.equal(safeName(''), 'file');
});
