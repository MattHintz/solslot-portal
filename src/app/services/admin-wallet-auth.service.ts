import { Injectable, inject } from '@angular/core';
import { environment } from '../../environments/environment';
import { Eip712LeafHashService } from './eip712-leaf-hash.service';
import { Eip712TypedData } from './solslot-api.service';

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
 *      v2 admin authority's MIPS quorum.
 *   5. {@link AdminSessionService} persists the verified session in
 *      localStorage for the lifetime of the wallet's signed expiry.
 *
 * **Membership check (1-of-1, current).**  We compute the candidate
 * MIPS root from the user's pubkey via
 * {@link Eip712LeafHashService.computeMipsRoot1Of1} and compare it
 * to the env-pinned ``adminAuthorityV2MipsRootHash``.  Match means
 * the on-chain quorum's sole member is this user; mismatch means
 * either the user isn't an admin, the env constant is stale (admin
 * rotated), or the wrong quorum mode (bare vs mofn1of1) was
 * configured.
 *
 * **Fallback (env address allowlist).**  When no MIPS root is pinned
 * (typical during a launcher's first hours, before the eve has been
 * spent and its curry args become recoverable from chain), we fall
 * back to a literal check of ``evm.address()`` against
 * ``environment.solslotProtocol.adminAuthorityV2AdminAddresses``.
 * This is the direct equivalent of the legacy
 * ``SOLSLOT_ADMIN_PUBKEY_ALLOWLIST`` API env var (which despite its
 * name accepted EVM addresses too) — same trust surface, just
 * committed at frontend deploy time instead of at API deploy time.
 * Addresses are the natural fallback identifier because wallets
 * expose them directly, while the compressed pubkey only becomes
 * known after the user signs.
 *
 * **What's deferred (m-of-n MIPS verification).**  For multi-admin
 * quorums (m > 1 or n > 1) the simple ``mofn1of1(user_leaf) == root``
 * check no longer works — the user's leaf has to be reachable via a
 * valid Merkle path through the MIPS tree, and we'd also need the
 * full admin records to compute the path.  That work depends on the
 * inner-puzzle uncurry helper landing in ``ChiaSingletonReaderService``;
 * until then a portal pinning a multi-admin MIPS root will refuse
 * every login (degrades to "no admin can log in" — fail-closed,
 * which is the correct safety property).
 */
@Injectable({ providedIn: 'root' })
export class AdminWalletAuthService {
  private readonly eip712Leaf = inject(Eip712LeafHashService);

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
   *   * ``chainId`` — always 1 (matches the EIP-712 chain binding the
   *     vault driver and Eip712Member puzzle use; signatures cannot
   *     replay across chains because the chainId is part of the
   *     keccak-prefixed domain separator).
   *
   * @param expiresAt Unix-seconds ceiling for the session.
   * @param nonce 0x-prefixed 32-byte hex (caller generates).
   */
  buildLoginTypedData(expiresAt: number, nonce: string): Eip712TypedData {
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
          { name: 'nonce', type: 'bytes32' },
          { name: 'expires_at', type: 'uint256' },
        ],
      },
      primaryType: 'SolslotAdminLogin',
      message: {
        app: AdminWalletAuthService.APP_NAME,
        nonce,
        expires_at: expiresAt,
      },
    };
  }

  /**
   * Build a Tangem-compatible admin-login proof message for wallets
   * that cannot sign EIP-712 on the staging/testnet EVM chain.
   *
   * This is intentionally not an on-chain credential.  It is a local
   * EIP-191 style proof of key possession whose recovered pubkey is
   * still checked against the env-pinned admin-authority MIPS root.
   * The message carries the same replay controls as the EIP-712
   * envelope: app/domain, chain id, nonce, expiry, and site origin.
   */
  buildLoginPersonalSignMessage(address: string, expiresAt: number, nonce: string): string {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'unknown-origin';
    return [
      AdminWalletAuthService.APP_NAME,
      `app=${AdminWalletAuthService.APP_NAME}`,
      `address=${normalizeHex(address)}`,
      `chain_id=${environment.eip712ChainId}`,
      `domain_name=${environment.eip712Name}`,
      `domain_version=${environment.eip712Version}`,
      `nonce=${normalizeHex(nonce)}`,
      `expires_at=${Math.trunc(expiresAt)}`,
      `origin=${origin}`,
      'local_only=true',
    ].join(' | ');
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
   * Verify a wallet's recovered identity is authorised to act as an
   * admin on this portal.  Returns a typed result so the caller can
   * route the user to a clear error message instead of a generic
   * "not authorised".
   *
   * Two strategies, tried in order:
   *
   *   1. **MIPS root** (uses ``pubkey``) — if
   *      {@link adminAuthorityV2MipsRootHash} is pinned, compute the
   *      candidate MIPS root from the pubkey via
   *      {@link Eip712LeafHashService.computeMipsRoot1Of1} and
   *      compare.  Hard requirement for the production-shaped
   *      authority because it binds the verification to the actual
   *      EIP-712-Member tree the on-chain singleton will recognise.
   *
   *   2. **Env address allowlist** (uses ``address``) — fallback for
   *      portals that haven't pinned a MIPS root.  Equivalent to
   *      the legacy API env var ``SOLSLOT_ADMIN_PUBKEY_ALLOWLIST``
   *      (which despite its name accepted EVM addresses too).
   *
   * If both env sources are empty, the method returns
   * ``{ ok: false, reason: 'no-admins-configured' }`` — a well-
   * formed "the operator hasn't set up admin auth yet" signal that
   * the login page surfaces verbatim.
   */
  verifyMembership(args: {
    /** 0x-hex 20-byte EVM address from ``evm.address()``. */
    address: string;
    /** 0x-hex 33-byte compressed secp256k1 pubkey from ``evm.recoverCompressedPubkey``. */
    pubkey: string;
  }): MembershipResult {
    const cfg = environment.solslotProtocol;
    const normalizedAddress = normalizeHex(args.address);
    const normalizedPubkey = normalizeHex(args.pubkey);

    // Strategy 1: MIPS root match (uses pubkey).
    const pinnedRoot = (cfg.adminAuthorityV2MipsRootHash || '').toLowerCase();
    if (pinnedRoot) {
      let candidateRoot: string;
      try {
        const { mips_root_hash } = this.eip712Leaf.computeMipsRoot1Of1(
          normalizedPubkey,
          environment.chiaNetwork,
          cfg.adminAuthorityV2QuorumMode,
        );
        candidateRoot = mips_root_hash.toLowerCase();
      } catch (e) {
        return {
          ok: false,
          reason: 'wasm-error',
          message:
            (e instanceof Error ? e.message : String(e)) ||
            'WASM compute of candidate MIPS root failed.',
        };
      }
      if (candidateRoot === pinnedRoot) {
        return {
          ok: true,
          strategy: 'mips-root',
          address: normalizedAddress,
          pubkey: normalizedPubkey,
        };
      }
      return {
        ok: false,
        reason: 'mips-root-mismatch',
        message:
          `Your wallet's pubkey hashes to MIPS root ${candidateRoot} but the ` +
          `portal is pinned to ${pinnedRoot}.  Either you're not an admin on ` +
          `this deployment, the portal's env constants are stale, or the ` +
          `quorum mode (bare vs mofn1of1) is misconfigured.`,
      };
    }

    // Strategy 2: env address allowlist (uses address).
    const allowlist = (cfg.adminAuthorityV2AdminAddresses || []).map(
      (s: string) => normalizeHex(s).toLowerCase(),
    );
    if (allowlist.length === 0) {
      return {
        ok: false,
        reason: 'no-admins-configured',
        message:
          'No admin auth source is configured on this portal: ' +
          '``adminAuthorityV2MipsRootHash`` is empty AND ' +
          '``adminAuthorityV2AdminAddresses`` is empty.  Update ' +
          'src/environments/environment.ts and redeploy.',
      };
    }
    if (allowlist.includes(normalizedAddress.toLowerCase())) {
      return {
        ok: true,
        strategy: 'address-allowlist',
        address: normalizedAddress,
        pubkey: normalizedPubkey,
      };
    }
    return {
      ok: false,
      reason: 'address-not-in-allowlist',
      message:
        `Your wallet address ${normalizedAddress} is not in the portal's ` +
        `admin allowlist (${allowlist.length} entr${allowlist.length === 1 ? 'y' : 'ies'}).  ` +
        `Ask the operator to add it to ` +
        `environment.solslotProtocol.adminAuthorityV2AdminAddresses.`,
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
      strategy: 'mips-root' | 'address-allowlist';
      /** Echoed normalised address (lowercase 0x-hex 20 bytes). */
      address: string;
      /** Echoed normalised pubkey (lowercase 0x-hex 33 bytes compressed secp256k1). */
      pubkey: string;
    }
  | {
      ok: false;
      reason:
        | 'mips-root-mismatch'
        | 'address-not-in-allowlist'
        | 'no-admins-configured'
        | 'wasm-error';
      /** Human-readable explanation surfaced in the UI. */
      message: string;
    };
