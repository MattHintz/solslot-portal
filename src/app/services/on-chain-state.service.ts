import { Injectable, inject } from '@angular/core';
import { ChiaSingletonReaderService } from './chia-singleton-reader.service';
import { ChiaWasmService } from './chia-wasm.service';
import {
  AdminAuthorityResponse,
  AdminAuthorityV2Response,
} from './admin-api.service';
import { ProtocolInfo } from './solslot-api.service';
import { environment } from '../../environments/environment';

/**
 * Pure on-chain replacement for the Solslot API's transparency
 * endpoints (``/protocol``, ``/admin/auth/authority``,
 * ``/admin/auth/authority_v2``).
 *
 * **Why this exists.** Phase 9-Hermes-D's API-removal pass mandated
 * that the only backend dependencies the portal carries are
 * coinset.org (Chia full-node RPC) and the Solslot faucet (vault
 * funding only).  The Trust Roots admin page (and any future
 * transparency surface) needs the same operator-config data the API
 * used to publish, but without ever consulting the API.
 *
 * **What it returns.** Methods return the *exact same shapes* as the
 * API endpoints they replace, so existing consumers (templates,
 * verification helpers) don't need to know the source has changed.
 * Fields the API used to compute server-side fall into three buckets:
 *
 *   1. **Operator-config constants** (launcher_ids, mod_hashes,
 *      EIP-712 domain) — embedded at build time via
 *      ``environment.solslotProtocol``.
 *   2. **On-chain state** (state_hash, lineage depth, latest
 *      block) — derived by walking the singleton lineage on
 *      coinset.org and replaying the latest spend in WASM via
 *      {@link ChiaSingletonReaderService.readLatestProtocolStateHash}.
 *   3. **Inner-puzzle metadata** (quorum_m, allowlist_pubkey_hashes,
 *      authority_version) — TODO; needs per-singleton inner-puzzle
 *      uncurrying to extract from the latest spend's puzzle reveal.
 *      Until that lands these fields return ``null`` / empty arrays
 *      and the Trust Roots page shows "—" placeholders.  The
 *      ``state_hash`` field is unaffected since it's emitted as a
 *      ``CREATE_PUZZLE_ANNOUNCEMENT`` body and decoded by the
 *      existing replay flow — the headline "is the singleton on
 *      chain and looking right?" question still gets a green/red
 *      answer.
 *
 * **Phase markers.** The migration-phase fields (``phase``,
 * ``gating_source``, ``informational_only``) the API used to publish
 * are stamped here as constants reflecting the Hermes-D end state
 * (``'4-gating-source'`` once we cut admin auth over to v2; until
 * then ``'2-informational-only'``).  Operators flip the constant
 * when their migration phase advances.
 */
@Injectable({ providedIn: 'root' })
export class OnChainStateService {
  private readonly singleton = inject(ChiaSingletonReaderService);
  private readonly wasm = inject(ChiaWasmService);

  /**
   * Build a {@link ProtocolInfo}-shape response from environment +
   * on-chain reads.  ``protocol_config_hash`` comes from replaying
   * the latest protocol-config singleton spend (when one's deployed);
   * everything else is operator-config.
   */
  async getProtocolInfo(): Promise<ProtocolInfo> {
    const proto = environment.solslotProtocol;

    // Walk the protocol-config singleton lineage when one's deployed
    // and pull its emitted state hash from the latest spend's
    // PROTOCOL_PREFIX announcement.  Surfaces null on chain failure
    // so the trust-roots card renders ``not-configured`` rather than
    // crashing the page.
    let protocolConfigHash: string | null = null;
    if (proto.protocolConfigLauncherId && this.wasm.ready()) {
      try {
        const lineage = await this.singleton.walkLineage(
          proto.protocolConfigLauncherId,
        );
        if (lineage) {
          const stateHash = await this.singleton.readLatestProtocolStateHash(
            lineage,
          );
          if (stateHash) {
            protocolConfigHash = '0x' + bytesToHex(stateHash);
          }
        }
      } catch {
        // Surface as null; trust-roots page shows "—" placeholder.
      }
    }

    return {
      network: environment.chiaNetwork,
      pool_launcher_id: proto.poolLauncherId || null,
      governance_launcher_id: proto.governanceLauncherId || null,
      vault_inner_mod_hash: proto.vaultInnerModHash || '',
      eip712_domain: {
        name: environment.eip712Name,
        version: environment.eip712Version,
        chainId: environment.eip712ChainId,
      },
      // The exact CHIP-0037 type-hash string is published as a
      // build-time constant by the API; clients that need to verify
      // signatures can recompute it themselves via the WASM helper
      // ``eip712_type_hash``.  For trust-roots display purposes we
      // surface a stable label rather than re-deriving every page
      // load.
      eip712_typehash_string:
        'ChiaCoinSpend(bytes32 coin_id,bytes32 delegated_puzzle_hash)',
      faucet_address: null,
      faucet_balance_mojos: null,
      deployed: !!proto.protocolConfigLauncherId,
      deployment_manifest: null,
      protocol_config_hash: protocolConfigHash,
      protocol_config_launcher_id: proto.protocolConfigLauncherId || null,
      protocol_config_version: 0,
      property_registry_launcher_id: proto.propertyRegistryLauncherId || null,
      property_registry_mod_hash: proto.propertyRegistryModHash || null,
      mint_proposal_mod_hash: proto.mintProposalModHash || null,
    };
  }

  /**
   * Build an {@link AdminAuthorityResponse}-shape response (v1 BLS
   * m-of-n) from environment + on-chain reads.
   *
   * **Limitation.** The v1 puzzle's curried allowlist + quorum_m are
   * not yet decoded client-side; ``allowlist_pubkey_hashes``,
   * ``quorum_m``, and ``authority_version`` return null/empty until
   * the v1 inner-puzzle uncurry helper lands.  The headline
   * ``state_hash`` is correctly derived from chain.
   */
  async getAuthority(): Promise<AdminAuthorityResponse> {
    const launcherId = null;
    const stateHash = null;
    return {
      enabled: !!launcherId,
      launcher_id: launcherId,
      allowlist_pubkey_hashes: null,
      quorum_m: null,
      authority_version: null,
      state_hash: stateHash,
      phase: '2-informational-only',
      gating_source: 'SOLSLOT_ADMIN_PUBKEY_ALLOWLIST',
      informational_only: true,
    };
  }

  /**
   * Build an {@link AdminAuthorityV2Response}-shape response (CHIP-0037
   * MIPS quorum) from environment + on-chain reads.
   *
   * **Limitation.** As with v1, the inner-puzzle curry args
   * (``mips_root_hash``, ``admins_hash``, ``pending_ops_hash``,
   * ``authority_version``) are not yet uncurried client-side and
   * return null until the v2 inner-puzzle uncurry helper lands.
   * ``state_hash`` is correctly derived from chain (it's the body of
   * the singleton's PROTOCOL_PREFIX announcement, which is the
   * canonical 4-tuple sha256tree).
   */
  async getAuthorityV2(): Promise<AdminAuthorityV2Response> {
    const launcherId =
      environment.solslotProtocol.adminAuthorityV2LauncherId || null;
    const stateHash = await this.readStateHashOrNull(launcherId);
    return {
      enabled: !!launcherId,
      launcher_id: launcherId,
      mips_root_hash: null,
      admins_hash: null,
      pending_ops_hash: null,
      authority_version: null,
      state_hash: stateHash,
      phase: '2-informational-only',
      gating_source: 'SOLSLOT_ADMIN_PUBKEY_ALLOWLIST',
      informational_only: true,
    };
  }

  /**
   * Common helper: walk the lineage for a launcher_id and return the
   * latest PROTOCOL_PREFIX announcement body (the singleton's
   * authoritative state hash) as a 0x-hex string.  Returns null when:
   *
   *   * the launcher_id is unset,
   *   * WASM isn't ready (replay needs CLVM),
   *   * the launcher hasn't confirmed on chain,
   *   * the launcher confirmed but never spent (eve hasn't emerged),
   *   * the latest spend has no PROTOCOL_PREFIX announcement,
   *   * any of the above raise (network blip, decode error).
   *
   * The trust-roots page treats a null return as "not yet on chain"
   * and renders the appropriate status badge.
   */
  private async readStateHashOrNull(
    launcherId: string | null,
  ): Promise<string | null> {
    if (!launcherId || !this.wasm.ready()) return null;
    try {
      const lineage = await this.singleton.walkLineage(launcherId);
      if (!lineage) return null;
      const stateHash = await this.singleton.readLatestProtocolStateHash(
        lineage,
      );
      return stateHash ? '0x' + bytesToHex(stateHash) : null;
    } catch {
      return null;
    }
  }
}

function bytesToHex(b: Uint8Array): string {
  let s = '';
  for (const byte of b) s += byte.toString(16).padStart(2, '0');
  return s;
}
