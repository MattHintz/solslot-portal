import { environment } from '../../environments/environment';

let verifiedProtocolCoordinates: Readonly<Record<string, unknown>> | null = null;

export interface ProtocolCoordinateResolutionInput {
  coordinateName: string;
  pinned?: unknown;
  candidate?: unknown;
  candidateLabel?: string;
  errorPrefix: string;
}

export function protocolCoordinateFromEnvironment(key: string): string | undefined {
  const value = verifiedProtocolCoordinates?.[key];
  return optionalHex32(value, `signed Solslot artifact ${key}`);
}

/** Install coordinates only after the signed ceremony artifact is verified. */
export function installVerifiedProtocolCoordinates(
  coordinates: Readonly<Record<string, unknown>>,
): void {
  verifiedProtocolCoordinates = Object.freeze({ ...coordinates });
}

/** Clear runtime authority before each artifact load and in focused tests. */
export function clearVerifiedProtocolCoordinates(): void {
  verifiedProtocolCoordinates = null;
}

export function resolveProtocolCoordinate(
  input: ProtocolCoordinateResolutionInput,
): string | undefined {
  const pinned = optionalHex32(input.pinned, `${input.coordinateName} pinned coordinate`);
  const candidate = optionalHex32(
    input.candidate,
    `${input.coordinateName} ${input.candidateLabel ?? 'candidate'}`,
  );
  if (pinned && candidate && pinned !== candidate) {
    throw new Error(
      `${input.errorPrefix}: ${input.coordinateName} ${input.candidateLabel ?? 'candidate'} ` +
        `does not match pinned protocol coordinate`,
    );
  }
  if (!pinned && environment.strictProtocolCoordinatePins) {
    throw new Error(
      `${input.errorPrefix}: ${input.coordinateName} is not present in the verified signed artifact`,
    );
  }
  return pinned ?? candidate;
}

function optionalHex32(value: unknown, name: string): string | undefined {
  if (typeof value !== 'string' || !value.trim()) {
    return undefined;
  }
  const raw = value.trim();
  const hex = raw.startsWith('0x') || raw.startsWith('0X') ? raw.slice(2) : raw;
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(`${name} must be 32-byte hex`);
  }
  return `0x${hex.toLowerCase()}`;
}
