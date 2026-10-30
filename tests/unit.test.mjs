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

test('htmlToMarkdown: pre 안 태그 보존, 이중 엔티티 1회 디코드, 중첩 목록, 숫자 엔티티', () => {
  const md = htmlToMarkdown('<pre>&lt;div&gt;</pre><p>&amp;lt;tag&amp;gt;</p><ul><li>a<ul><li>b</li></ul></li><li>c</li></ul><p>&#8361;100</p>');
  assert.match(md, /```\n<div>\n```/);
  assert.match(md, /&lt;tag&gt;/);
  assert.match(md, /- a\n  - b\n- c/);
  assert.match(md, /₩100/);
});

test('htmlToText 는 사용자 문자(_ # * >)를 보존한다', () => {
  assert.equal(htmlToText('<p>file_name C# a &gt; b 2*3=6</p>'), 'file_name C# a > b 2*3=6');
});

test('extractJson: 산문 속 중괄호, 문자열 안 개행, 잘린 출력', () => {
  assert.deepEqual(extractJson('설명 {참고} 입니다. ```json\n{"a":"줄1\n줄2",}\n``` 끝'), { a: '줄1\n줄2' });
  assert.throws(() => extractJson('{"a": 1, "b": {"c"'), /끊겼습니다/);
});

test('safeName: 멱등, Windows 예약 이름·끝 점 처리', () => {
  assert.equal(safeName(safeName(' .env')), safeName(' .env'));
  assert.equal(safeName('CON.txt'), '_CON.txt');
  assert.equal(safeName('trail. '), 'trail');
  assert.ok(Buffer.byteLength(safeName('가'.repeat(300) + '.md')) <= 200);
});
