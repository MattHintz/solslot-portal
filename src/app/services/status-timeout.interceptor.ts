import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { catchError, throwError, timeout, TimeoutError } from 'rxjs';
import { environment } from '../../environments/environment';

/** Abort an unresponsive status read so its polling loop can recover.
 * Writes and wallet prompts have their own reviewed lifecycle and are never
 * timed out/repeated by this interceptor. RxJS unsubscription aborts the
 * Angular fetch request; a late result cannot overwrite a newer status.
 */
export const statusTimeoutInterceptor: HttpInterceptorFn = (request, next) => {
  if (request.method !== 'GET') return next(request);
  let url: URL, base: URL;
  try {
    const origin = typeof location === 'undefined' ? 'http://localhost' : location.origin;
    url = new URL(request.url, origin); base = new URL(environment.faucetApi, origin);
  } catch { return next(request); }
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname.replace(/\/$/, '') + '/')) {
    return next(request);
  }
  return next(request).pipe(timeout({each:20_000}), catchError(error => throwError(() =>
    error instanceof TimeoutError ? new HttpErrorResponse({status:0, url:request.url,
      statusText:'Status request timed out', error:{code:'STATUS_TIMEOUT',
        message:'The status check took too long. Your saved progress is unchanged; retrying automatically.'}}) : error)));
};
