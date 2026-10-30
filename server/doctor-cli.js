#!/usr/bin/env node
// 터미널용 doctor. 사용: npm run doctor  /  npm run doctor:live  /  node server/doctor-cli.js --json
import { runDoctor } from './doctor.js';
import { initConfigFiles } from './config.js';

const args = new Set(process.argv.slice(2));
const live = args.has('--live');
const json = args.has('--json');

initConfigFiles();
const result = await runDoctor({ live });

if (json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  const icon = { ok: '\x1b[32m✔\x1b[0m', warn: '\x1b[33m!\x1b[0m', fail: '\x1b[31m✘\x1b[0m' };
  console.log(`\nPandanix doctor ${live ? '(실시간 API 테스트 포함)' : '(--live 로 API 연결까지 테스트)'}\n`);
  for (const c of result.checks) {
    console.log(`${icon[c.status]} ${c.name}: ${c.detail}`);
    if (c.fix) console.log(`    → ${c.fix}`);
  }
  const s = result.summary;
  console.log(`\n정상 ${s.ok} · 주의 ${s.warn} · 실패 ${s.fail}\n`);
}
process.exit(result.summary.fail ? 1 : 0);
