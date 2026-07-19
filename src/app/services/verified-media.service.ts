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
  async fetchVerified(asset: AssetDescriptorV1): Promise<VerifiedMediaResult> {
    const failures: string[] = [];
    for (const uri of orderedUris(asset.uris)) {
      const fetchUrl = toFetchUrl(uri);
      try {
        const response = await fetch(fetchUrl, {
          cache: 'no-store',
          credentials: 'omit',
          mode: 'cors',
        });
        if (!response.ok) {
          failures.push(`${uri}: HTTP ${response.status}`);
          continue;
        }
        const bytes = await response.arrayBuffer();
        const digest = await sha256Hex(bytes);
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
        failures.push(`${uri}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    throw new Error(failures.join(' | ') || 'No media URI was available.');
  }
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
