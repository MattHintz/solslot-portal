import { HttpErrorResponse } from '@angular/common/http';
import { formatError } from './format-error';

describe('API failure messages', () => {
  const apache = '<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01//EN"><html><head><title>403 Forbidden</title></head><body>Forbidden</body></html>';

  it('explains proxy access failures without presenting server HTML or asking for another wallet signature', () => {
    const result = formatError(new HttpErrorResponse({ status: 403, error: apache }));
    expect(result).toContain('access was denied');
    expect(result).toContain('saved progress is unchanged');
    expect(result).not.toContain('<');
    expect(result).not.toContain('sign');
  });

  it('handles HTML nested in an API detail', () => {
    expect(formatError(new HttpErrorResponse({ status: 503, error: { detail: apache } })))
      .toContain('Check the saved action status');
  });

  it('does not treat a lost response as proof a transaction failed', () => {
    const result = formatError(new HttpErrorResponse({ status: 0 }));
    expect(result).toContain('Check the saved action status');
    expect(result).not.toContain('not submitted');
  });

  it('preserves actionable typed API messages instead of dumping the receipt object', () => {
    expect(formatError(new HttpErrorResponse({ status: 409, error: { detail: {
      code: 'SOURCE_CHANGED', message: 'Review the source again.', receipt: { retained: true },
    } } }))).toBe('Review the source again.');
  });

  it('retains ordinary API validation details', () => {
    expect(formatError(new HttpErrorResponse({ status: 422, error: { detail: [
      { loc: ['body', 'title'], msg: 'Field required' },
    ] } }))).toBe('body.title: Field required');
  });

  it('distinguishes an expired session from a server permission failure', () => {
    expect(formatError(new HttpErrorResponse({ status: 401 }))).toContain('Sign in again');
    expect(formatError(new HttpErrorResponse({ status: 403 }))).not.toContain('Sign in again');
  });
});
