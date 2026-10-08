import { HttpInterceptorFn, HttpErrorResponse, HttpResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { tap } from 'rxjs';
import { JourneyTelemetryService } from './journey-telemetry.service';
import { journeyError } from './journey-transport';
export const journeyHttpInterceptor: HttpInterceptorFn = (req, next) => {
  const events = inject(JourneyTelemetryService), started = performance.now();
  let url: URL;
  try { url = new URL(req.url, typeof location === 'undefined' ? 'http://localhost' : location.origin); } catch { return next(req); }
  if (!/(protocol-api|rehoboam)\//.test(url.pathname) || /\/alpha\//.test(url.pathname)) return next(req);
  const sameOrigin = typeof location !== 'undefined' && url.origin === location.origin;
  const flow = sameOrigin ? events.flowId : undefined;
  const request = flow ? req.clone({setHeaders: {'X-Solslot-Flow': flow}}) : req;
  return next(request).pipe(tap({
    next: response => {
      if (response instanceof HttpResponse && req.method !== 'GET') events.record({action:'api_request',phase:'completed',
        request_id: response.headers.get('X-Solslot-Request-Id') || undefined,
        http_status:response.status,latency_ms:performance.now()-started});
    },
    error: (error: unknown) => {
      if (!(error instanceof HttpErrorResponse)) return;
      if (req.method === 'GET' && ((error.status === 401 && /\/session(?:[?#]|$)/.test(req.url)) || (error.status === 404 && /\/(enrollments|presale)/.test(req.url)))) return;
      events.record({action: 'api_request', phase: 'failed', error_code: journeyError(error.status),
        request_id: error.headers.get('X-Solslot-Request-Id') || undefined,
        http_status: error.status || undefined, latency_ms: performance.now() - started});
    }
  }));
};
