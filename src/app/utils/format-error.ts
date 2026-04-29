import { HttpErrorResponse } from '@angular/common/http';

/**
 * Produce a human-readable string for any thrown value.
 *
 * Handles the shapes we actually encounter:
 *   - `HttpErrorResponse` from Angular HttpClient (with FastAPI `{detail: string}`
 *     or `{detail: Array<{msg,type,loc}>}` payloads from pydantic validation)
 *   - `Error` subclasses
 *   - Plain strings
 *   - Everything else (JSON-stringified so the user never sees `[object Object]`)
 */
export function formatError(e: unknown): string {
  if (e instanceof HttpErrorResponse) {
    const body = e.error;
    // FastAPI returns `{ "detail": "string" }` for HTTPException.
    if (body && typeof body === 'object' && 'detail' in body) {
      const detail = (body as { detail: unknown }).detail;
      if (typeof detail === 'string') return detail;
      if (Array.isArray(detail)) {
        // pydantic v2 validation error list
        return detail
          .map((d) => {
            if (typeof d === 'object' && d && 'msg' in d) {
              const dd = d as { msg?: string; loc?: unknown[]; type?: string };
              const where = Array.isArray(dd.loc) ? dd.loc.join('.') : '';
              return where ? `${where}: ${dd.msg}` : dd.msg ?? JSON.stringify(d);
            }
            return typeof d === 'string' ? d : JSON.stringify(d);
          })
          .join('; ');
      }
      return JSON.stringify(detail);
    }
    if (typeof body === 'string' && body.length > 0) return body;
    return `${e.status} ${e.statusText} — ${e.message}`;
  }
  if (e instanceof Error) return e.message || e.toString();
  if (typeof e === 'string') return e;
  if (e && typeof e === 'object') {
    try {
      return JSON.stringify(e);
    } catch {
      return Object.prototype.toString.call(e);
    }
  }
  return String(e);
}
