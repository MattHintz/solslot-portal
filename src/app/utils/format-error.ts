import { HttpErrorResponse } from '@angular/common/http';

function httpFallback(status: number): string {
  if (status === 0) return 'The connection was interrupted. Check the saved action status before trying again.';
  if (status === 401) return 'Your sign-in has expired. Sign in again to continue with your saved progress.';
  if (status === 403) return 'Solslot could not open this section because access was denied. Your saved progress is unchanged. Retry, or report this issue if it continues.';
  if (status === 429) return 'Too many requests. Wait a moment, then try again.';
  if (status >= 500) return 'Solslot is temporarily unavailable. Check the saved action status before trying again.';
  return 'Solslot could not complete this request. Review the saved status, then try again.';
}

function isHtml(value: unknown): boolean {
  return typeof value === 'string' && /<!doctype\s+html|<\/?(?:html|head|body|title|script|style)\b/i.test(value);
}

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
    // Proxy/authentication failures may be HTML even when the API expects JSON.
    // Never suggest that a failed response proves the transaction was not sent.
    if (isHtml(body)) return httpFallback(e.status);
    // FastAPI returns `{ "detail": "string" }` for HTTPException.
    if (body && typeof body === 'object' && 'detail' in body) {
      const detail = (body as { detail: unknown }).detail;
      if (typeof detail === 'string') return isHtml(detail) ? httpFallback(e.status) : detail;
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
      if (detail && typeof detail === 'object' && 'message' in detail) {
        const message = (detail as { message: unknown }).message;
        if (typeof message === 'string' && message.trim() && !isHtml(message)) return message;
      }
      return httpFallback(e.status);
    }
    if (typeof body === 'string' && body.length > 0) return body;
    return httpFallback(e.status);
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
