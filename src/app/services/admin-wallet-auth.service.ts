import { Injectable, inject } from '@angular/core';
import { computeAddress, SigningKey } from 'ethers';
import { environment } from '../../environments/environment';
import { Eip712TypedData } from './solslot-api.service';
import { SolslotProtocolArtifactService } from './solslot-protocol-artifact.service';

/**
 * Wallet-signed admin auth verifier.
 *
 * **Why this exists.**  Phase 9-Hermes-D's API-removal pass replaced
 * the JWT-based admin login (challenge \u2192 sign \u2192 ``/admin/auth/login``
 * \u2192 JWT) with a fully client-side wallet-signed handshake:
 *
 *   1. Browser builds a SolslotAdminLogin EIP-712 envelope with a
 *      fresh nonce + expiry.
 *   2. User signs it with their EVM wallet (Goby / MetaMask / WC).
 *   3. Browser recovers the 33-byte compressed secp256k1 pubkey from
 *      the signature via {@link EvmWalletService.recoverCompressedPubkey}.
 *   4. **This service** verifies the recovered pubkey is in the
 *      administrator roster committed by the signed V2 artifact.
 *   5. {@link AdminSessionService} re-verifies and caches the envelope in
 *      sessionStorage for the lifetime of the wallet's signed expiry.
 *
 * There is no environment allowlist or 1-of-1 fallback. The artifact's
 * 2-of-3 roster is available only after its hash, source commit, ceremony
 * confirmation, and two administrator signatures have been verified.
 */
@Injectable({ providedIn: 'root' })
export class AdminWalletAuthService {
  private readonly protocolArtifact = inject(SolslotProtocolArtifactService);

  /** Max session lifetime, in seconds.  Mirrors a typical JWT TTL. */
  static readonly SESSION_TTL_SECONDS = 12 * 60 * 60; // 12 hours

  /**
   * App-name baked into the EIP-712 domain so a signed admin login
   * envelope can never be replayed against any other Solslot surface
   * (vault registration, faucet drip, etc.).
   */
  static readonly APP_NAME = 'Solslot Admin Login';

  /**
   * Build the EIP-712 envelope the user signs to prove possession of
   * their admin wallet.
   *
   * The envelope binds:
   *   * ``app`` — prevents cross-app replay.
   *   * ``nonce`` — prevents replay of an old session credential.
   *   * ``expires_at`` — caps the credential's useful lifetime.
   *
   * Domain pins:
   *   * ``name`` — the human-readable scope (rendered by the wallet).
   *   * ``version`` — lets us evolve the envelope without confusing
   *     signatures across versions.
   *   * ``chainId`` - Sepolia 11155111 for the fresh Alpha ceremony.
   *
   * @param expiresAt Unix-seconds ceiling for the session.
   * @param nonce 0x-prefixed 32-byte hex (caller generates).
   */
  buildLoginTypedData(expiresAt: number, nonce: string): Eip712TypedData {
    const artifactHash = this.protocolArtifact.artifact?.artifactHash;
    if (!this.protocolArtifact.isReady || !artifactHash) {
      throw new Error(this.protocolArtifact.failure);
    }
    return {
      domain: {
        name: environment.eip712Name,
        version: environment.eip712Version,
        chainId: environment.eip712ChainId,
      },
      types: {
        EIP712Domain: [
          { name: 'name', type: 'string' },
          { name: 'version', type: 'string' },
          { name: 'chainId', type: 'uint256' },
        ],
        SolslotAdminLogin: [
          { name: 'app', type: 'string' },
          { name: 'artifactHash', type: 'bytes32' },
          { name: 'nonce', type: 'bytes32' },
          { name: 'expires_at', type: 'uint256' },
        ],
      },
      primaryType: 'SolslotAdminLogin',
      message: {
        app: AdminWalletAuthService.APP_NAME,
        artifactHash,
        nonce,
        expires_at: expiresAt,
      },
    };
  }

  /**
   * Generate a fresh 32-byte nonce as a 0x-prefixed lowercase hex
   * string.  Uses ``crypto.getRandomValues`` (constant-time, CSPRNG)
   * so the nonce can't be predicted by the page that issued it.
   */
  newNonce(): string {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    let s = '';
    for (const b of bytes) s += b.toString(16).padStart(2, '0');
    return '0x' + s;
  }

  /**
   * Default expiry: now + {@link SESSION_TTL_SECONDS}.  Exposed as a
   * helper so the login component doesn't have to import the TTL
   * constant separately.
   */
  defaultExpiresAt(): number {
    return Math.floor(Date.now() / 1_000) + AdminWalletAuthService.SESSION_TTL_SECONDS;
  }

  /**
   * Verify that the recovered key and wallet address are the same identity
   * and that the compressed key belongs to the signed 2-of-3 roster.
   */
  verifyMembership(args: {
    /** 0x-hex 20-byte EVM address from ``evm.address()``. */
    address: string;
    /** 0x-hex 33-byte compressed secp256k1 pubkey from ``evm.recoverCompressedPubkey``. */
    pubkey: string;
  }): MembershipResult {
    const normalizedAddress = normalizeHex(args.address);
    const normalizedPubkey = normalizeHex(args.pubkey);
    if (!this.protocolArtifact.isReady) {
      return {
        ok: false,
        reason: 'artifact-unavailable',
        message: this.protocolArtifact.failure,
      };
    }

    let derivedAddress: string;
    try {
      derivedAddress = computeAddress(
        SigningKey.computePublicKey(normalizedPubkey, false),
      ).toLowerCase();
    } catch {
      return {
        ok: false,
        reason: 'invalid-pubkey',
        message: 'The wallet signature did not recover a valid compressed secp256k1 key.',
      };
    }
    if (derivedAddress !== normalizedAddress.toLowerCase()) {
      return {
        ok: false,
        reason: 'identity-mismatch',
        message: 'The recovered administrator key does not belong to the connected wallet.',
      };
    }

    const roster = new Set(
      this.protocolArtifact.adminRoster.map((value) => value.toLowerCase()),
    );
    if (roster.has(normalizedPubkey.toLowerCase())) {
      return {
        ok: true,
        strategy: 'signed-artifact-roster',
        address: normalizedAddress,
        pubkey: normalizedPubkey,
      };
    }
    return {
      ok: false,
      reason: 'pubkey-not-in-roster',
      message: `The connected wallet is not in the signed Solslot genesis administrator roster.`,
    };
  }
}

/**
 * Normalise a hex string to ``0x``-prefixed lowercase form, leaving
 * the data intact.  Mirrors the convention every other Solslot hex
 * field uses; lets the membership check accept either ``0x...`` or
 * bare hex inputs without surprise.
 */
function normalizeHex(s: string): string {
  const lower = s.toLowerCase();
  return lower.startsWith('0x') ? lower : '0x' + lower;
}

/** Result of {@link AdminWalletAuthService.verifyMembership}. */
export type MembershipResult =
  | {
      ok: true;
      /** Which strategy matched (debug / observability). */
      strategy: 'signed-artifact-roster';
      /** Echoed normalised address (lowercase 0x-hex 20 bytes). */
      address: string;
      /** Echoed normalised pubkey (lowercase 0x-hex 33 bytes compressed secp256k1). */
      pubkey: string;
    }
  | {
      ok: false;
      reason:
        | 'artifact-unavailable'
        | 'invalid-pubkey'
        | 'identity-mismatch'
        | 'pubkey-not-in-roster';
      /** Human-readable explanation surfaced in the UI. */
      message: string;
    };
