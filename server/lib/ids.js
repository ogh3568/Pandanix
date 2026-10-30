import crypto from 'node:crypto';

/** 짧고 파일명에 안전한 ID. 예: wb_k3f9a2, p_8dj2ks */
export function newId(prefix) {
  return `${prefix}_${crypto.randomBytes(4).toString('hex')}`;
}

export function nowIso() {
  return new Date().toISOString();
}
