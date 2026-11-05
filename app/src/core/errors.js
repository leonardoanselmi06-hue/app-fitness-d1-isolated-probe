export class AppError extends Error {
  constructor(status, code, extra = {}) { super(code); this.status = status; this.code = code; this.extra = extra; }
}
export const insist = (ok, status, code) => { if (!ok) throw new AppError(status, code); };
