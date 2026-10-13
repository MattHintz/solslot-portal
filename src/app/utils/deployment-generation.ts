import { environment } from '../../environments/environment';

/** Frozen build input, never learned from a wallet request or API response. */
export function deploymentGeneration(): string | null {
  const value = (environment.solslotProtocol as {generationId?: string}).generationId;
  if (value === undefined || value === '') return null; // Historical generation.
  if (typeof value !== 'string' || !/^0x[0-9a-f]{64}$/.test(value) || /^0x0{64}$/.test(value)) {
    throw new Error('The reviewed deployment generation is not configured correctly.');
  }
  return value;
}
