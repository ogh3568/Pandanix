/** express 4 용 async 핸들러 래퍼 */
export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
