import { Injectable } from '@angular/core';

import { AssetDescriptorV1 } from './property-metadata/property-dossier';

export interface VerifiedMediaResult {
  objectUrl: string;
  sourceUri: string;
  byteSize: number;
  mimeType: string;
}

@Injectable({ providedIn: 'root' })
export class VerifiedMediaService {
  async fetchVerified(asset: AssetDescriptorV1, signal?: AbortSignal): Promise<VerifiedMediaResult> {
    // Match the API's maximum allowed upload size; never trust response length
    // or consume unbounded bytes from a historical mutable storage URL.
    if (!Number.isSafeInteger(asset.byteSize) || asset.byteSize < 1 || asset.byteSize > 250 * 1024 * 1024) {
      throw new Error('Asset byte size is invalid.');
    }
    const failures: string[] = [];
    for (const uri of orderedUris(asset.uris)) {
      if (signal?.aborted) throw new Error('File check cancelled.');
      const fetchUrl = toFetchUrl(uri);
      const controller = new AbortController();
      const cancel = () => controller.abort();
      signal?.addEventListener('abort', cancel, { once: true });
      const timeout = setTimeout(cancel, 30_000);
      let response: Response | undefined;
      try {
        response = await fetch(fetchUrl, {
          cache: 'no-store',
          credentials: 'omit',
          mode: 'cors',
          signal: controller.signal,
        });
        if (!response.ok) {
          failures.push(`${uri}: HTTP ${response.status}`);
          continue;
        }
        const length = response.headers.get('content-length');
        const encoding = response.headers.get('content-encoding');
        if (length !== null && (!encoding || encoding === 'identity') && Number(length) !== asset.byteSize) {
          throw new Error('byte-size mismatch');
        }
        const bytes = await readExactly(response, asset.byteSize, controller.signal);
        const digest = await sha256Hex(bytes);
        if (controller.signal.aborted) throw new Error('File check cancelled or timed out.');
        if (digest.toLowerCase() !== asset.sha256.toLowerCase()) {
          failures.push(`${uri}: SHA-256 mismatch`);
          continue;
        }
        if (bytes.byteLength !== asset.byteSize) {
          failures.push(`${uri}: byte-size mismatch`);
          continue;
        }
        const contentType = response.headers.get('content-type')?.split(';', 1)[0].toLowerCase();
        if (contentType && contentType !== asset.mimeType.toLowerCase()) {
          failures.push(`${uri}: MIME mismatch`);
          continue;
        }
        return {
          objectUrl: URL.createObjectURL(new Blob([bytes], { type: asset.mimeType })),
          sourceUri: uri,
          byteSize: bytes.byteLength,
          mimeType: asset.mimeType,
        };
      } catch (error) {
        if (signal?.aborted) throw new Error('File check cancelled.');
        failures.push(`${uri}: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', cancel);
        controller.abort();
        if (response?.body && !response.body.locked) {
          await response.body.cancel().catch(() => undefined);
        }
      }
    }
    throw new Error(failures.join(' | ') || 'No media URI was available.');
  }
}

async function readExactly(response: Response, expectedSize: number, signal: AbortSignal): Promise<ArrayBuffer> {
  if (!response.body) throw new Error('Streaming file response unavailable.');
  const reader = response.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', cancel, { once: true });
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    if (signal.aborted) throw new Error('File check cancelled or timed out.');
    while (true) {
      const { done, value } = await reader.read();
      if (signal.aborted) throw new Error('File check cancelled or timed out.');
      if (done) break;
      total += value.byteLength;
      if (total > expectedSize) {
        await reader.cancel();
        throw new Error('byte-size exceeds descriptor');
      }
      chunks.push(value);
    }
  } finally {
    signal.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
  if (total !== expectedSize) throw new Error('byte-size mismatch');
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result.buffer;
}

function orderedUris(uris: string[]): string[] {
  return [...uris].sort((left, right) => Number(left.startsWith('ipfs://')) - Number(right.startsWith('ipfs://')));
}

function toFetchUrl(uri: string): string {
  if (!uri.startsWith('ipfs://')) return uri;
  const path = uri.slice('ipfs://'.length).replace(/^ipfs\//, '');
  return `https://ipfs.io/ipfs/${path}`;
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
