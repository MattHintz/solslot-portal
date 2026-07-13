/**
 * Runtime environment configuration for the Populis Portal (development).
 *
 * All endpoints default to local dev services.  Override by creating
 * `environment.prod.ts` and selecting it via `ng build --configuration production`.
 */
export const environment = {
  production: false,

  /**
   * Populis faucet API endpoint.  After the Phase 9-Hermes-D
   * API-removal pass, the only remaining backend dependency is
   * faucet-funded vault registration:
   *
   *   * ``POST /auth/challenge``  — issues a one-time nonce + EIP-712
   *     envelope used during the vault-registration handshake (the
   *     faucet binds the to-be-launched vault to a real wallet
   *     signature so launcher coins can't be reassigned by a third
   *     party between request and on-chain confirmation).
   *   * ``POST /vault/register/evm``  — builds and broadcasts a
   *     launcher coin spend funded from the faucet's hot wallet,
   *     curried with the user's recovered EVM pubkey.
   *   * ``POST /vault/register/chia`` — same shape for native BLS
   *     vaults.
   *
   * Every other former API responsibility (admin auth, mint
   * proposals, trust roots, vault state reads) now lives on the
   * client (``OnChainStateService``, ``ChiaSingletonReaderService``,
   * ``VaultDiscoveryService``, ``MintDraftStorageService``,
   * ``AdminWalletAuthService``).  Coinset.org is read directly for
   * everything else.
   */
  faucetApi: 'http://127.0.0.1:8787',

  /**
   * Chia full-node RPC.  Defaults to coinset.org's public testnet11
   * endpoint.  Used for both reads (``get_coin_record_by_name``,
   * ``get_coin_records_by_parent_ids``, ``get_puzzle_and_solution``,
   * ``get_blockchain_state``) and writes (``push_tx`` for launch +
   * mint spend bundles built client-side).  No proxy in front —
   * post-Phase-D the portal talks to coinset.org directly.
   */
  coinsetRpc: 'https://testnet11.api.coinset.org',

  /**
   * Chain selection.  Must match the coinsetRpc endpoint.
   * 'testnet11' | 'mainnet'.
   */
  chiaNetwork: 'testnet11' as 'testnet11' | 'mainnet',

  /**
   * WalletConnect project ID.  Create one at https://cloud.walletconnect.com
   * and paste it here.  Required for EVM wallet connection via WalletConnect v2.
   */
  walletConnectProjectId: '3145bc617be2b491a8e6033b3b0fcf43',

  /**
   * Chain id that Populis EIP-712 signatures are bound to.
   * MUST match EIP712_DOMAIN_CHAIN_ID in populis_protocol/populis_puzzles/vault_driver.py.
   */
  eip712ChainId: 11155111,

  zkPassport: {
    /**
     * zkPassport hosted proof URL — paste the per-deployment URL from
     * the zkPassport developer dashboard (app.zkpassport.id) once the
     * integration is set up.  Must include ``?vault_launcher_id=`` as
     * a query param template that the portal fills at runtime.
     */
    verificationUrl: '/verify',

    /**
     * JSON-RPC endpoint for the EVM chain where the attestation emitter
     * is deployed.  Set to a Base Sepolia public endpoint once the
     * contract is deployed.
     *
     * Example: 'https://sepolia.base.org'
     */
    evmRpcUrl: 'https://ethereum-sepolia-rpc.publicnode.com',

    /**
     * Address of PopulisZkPassportAttestationEmitter on Base Sepolia.
     * Filled in after running:
     *   npx hardhat run populis_evm/scripts/deploy-emitter.js --network baseSepolia
     *
     * Leave empty until deployed; the portal shows a clear "not configured"
     * message when this is empty.
     */
    attestationEmitterAddress: '',

    /** Block number of the emitter's deployment transaction (gas optimisation).
     *  Set to the block returned by deploy-emitter.js after deploy. */
    attestationEmitterFromBlock: 0,

    /** ERC-2771 trusted forwarder for gasless meta-tx submission. Users sign an
     *  EIP-712 ForwardRequest (no gas); the operator relayer (POST
     *  {faucetApi}/zkpassport/relay) submits forwarder.execute() and pays gas. */
    trustedForwarderAddress: '',

    evmPollTimeoutMs: 120_000,

    /**
     * Chia-side bridge coin parent id.  This is the coin id of the
     * standard-puzzle coin that will be the parent of the ephemeral
     * bridge coin.  The operator creates and funds this coin once the
     * protocol is live; its puzzle hash must equal the bridge policy hash.
     *
     * Defaults to zero (not configured) — update after the bridge coin is
     * created on testnet11.
     */
    bridgeParentId: '',

    /** Amount in mojos for the bridge coin (1 mojo = standard minimum). */
    bridgeAmount: 1,

    /**
     * BLS G1 public keys of the validator nodes that countersign EVM
     * attestation events.  Order must match the order used when computing
     * the bridge policy hash.
     *
     * Testnet11 validator (1-of-1, pinned from populis_protocol):
     *   seed stored as POPULIS_ZKPASSPORT_VALIDATOR_SEED_HEX in populis_api/.env
     */
    validatorPubkeys: [] as string[],

    /** Minimum number of validator signatures required (1-of-1 for testnet11). */
    validatorThreshold: 1,

    /**
     * Enable zkPassport dev mode — allows mock/dev proofs from the ZKR
     * dev passport app.  Must be false on mainnet.
     */
    devMode: true,
  },

  /**
   * Populis Protocol on-chain singleton coordinates (operator-specific).
   *
   * Mirrors the ``POPULIS_PROTOCOL_*`` env vars the API reads at
   * startup.  Embedded at build time so the portal can read every
   * trust-critical singleton directly from coinset.org without ever
   * consulting the Populis API (Phase 9-Hermes-D follow-up: only
   * coinset + the faucet remain as backend dependencies).
   *
   * An empty launcher_id means "not yet deployed on this network" —
   * the corresponding card on the Trust Roots page renders as
   * ``not-configured``.  Mod hashes pin the uncurried puzzle hashes
   * so the trust-roots page can verify each lineage's leaves are the
   * canonical Populis puzzles, not a malicious lookalike.
   *
   * Update this object whenever the operator deploys a new singleton
   * on the active network.  Keep in sync with ``populis_api/.env``
   * and ``populis_protocol/scripts/dump_protocol_constants.py``.
   */
  populisProtocol: {
    /**
     * v1 admin authority singleton (BLS m-of-n).  Empty = not deployed.
     * On-chain state announces ``PROTOCOL_PREFIX || sha256tree(state)``.
     */
    adminAuthorityLauncherId: '',
    /**
     * v2 admin authority singleton (CHIP-0037 MIPS quorum, EIP-712-capable).
     * Live on testnet11 — see Phase 9-Hermes-D session summary.
     */
    adminAuthorityV2LauncherId: '',
    /**
     * MIPS root hash of the v2 admin authority's CHIP-0043 quorum, in
     * 0x-prefixed lowercase hex.  Pinned at frontend deploy time so
     * the wallet-signed admin auth flow can verify a logged-in user's
     * pubkey is in the quorum without first decoding the on-chain
     * inner puzzle's curry args.
     *
     * **How to update on rotation.**  If admins rotate (or the quorum
     * grows past 1-of-1), recompute the new MIPS root via the launch
     * wizard's "preview" step or via
     * ``Eip712LeafHashService.computeMipsRoot1Of1`` and paste the new
     * value here, then redeploy the portal.  The session service
     * cross-checks the env constant against the on-chain
     * ``state_hash`` so a stale env will refuse logins (it can't
     * silently keep authenticating a removed admin).
     *
     * Empty = "no on-chain v2 authority pinned" \u2014 the admin login
     * page falls back to the env-pubkey-allowlist
     * ({@link adminAuthorityV2AdminPubkeys}) for membership checks
     * (matches the legacy ``POPULIS_ADMIN_PUBKEY_ALLOWLIST``
     * semantics).
     */
    adminAuthorityV2MipsRootHash: '',
    /**
     * Quorum-tree mode used when the v2 launcher was created.
     *
     *   * ``'bare'``: MIPS root == bare ``Eip712Member`` leaf hash.
     *     Spending requires only the EIP-712 envelope; no
     *     ``index_wrapper`` / ``m_of_n`` outer dispatch.
     *
     *   * ``'mofn1of1'``: MIPS root == ``mOfNHash(topLevel, 1,
     *     [eip712MemberHash(child, ...)])``.  Production-shaped
     *     1-of-1 with the option to grow later.
     *
     * Must match the mode the launch wizard used \u2014 a mismatch makes
     * every login fail with "leaf doesn't match MIPS root".
     */
    adminAuthorityV2QuorumMode: 'mofn1of1' as 'bare' | 'mofn1of1',
    /**
     * Fallback admin allowlist for portals that haven't pinned a
     * MIPS root (or whose v2 launcher hasn't first-spent yet — the
     * eve's curry args, including the live MIPS root, only become
     * recoverable from chain after the eve is spent).  Each entry
     * is a 0x-prefixed lowercase hex of a 20-byte EVM address —
     * what wallets expose to the page directly.
     *
     * Membership semantics: the wallet-signed admin login flow
     * checks ``evm.address()`` against this list verbatim.  This is
     * the direct, name-preserving equivalent of the legacy
     * ``POPULIS_ADMIN_PUBKEY_ALLOWLIST`` API env var (which despite
     * its name accepted EVM addresses too).
     *
     * Empty + empty MIPS root means "no admin can log in" — every
     * sign-in attempt fails with a clear ``no-admins-configured``
     * message asking the operator to update the env.
     *
     * **Operator pin (testnet11).**  The address below is the
     * launcher of the v2 admin authority singleton at
     * ``adminAuthorityV2LauncherId`` — mirrored from
     * ``populis_api/.env``'s ``POPULIS_ADMIN_PUBKEY_ALLOWLIST``
     * to keep frontend and API auth in lockstep until the
     * MIPS-root path lands (Phase C2).
     */
    adminAuthorityV2AdminAddresses: [] as string[],
    /** A.3 protocol-config singleton.  Empty = not deployed. */
    protocolConfigLauncherId: '',
    /** A.4 property-registry singleton.  Empty = not deployed. */
    propertyRegistryLauncherId: '',
    /** Pool singleton launcher id (deeded-XCH pool).  Empty = not deployed. */
    poolLauncherId: '',
    /** Governance DID singleton launcher id.  Empty = not deployed. */
    governanceLauncherId: '',
    /**
     * Tree hash of ``protocol_config_inner.clsp`` — pinned so the
     * trust-roots page can verify it found the canonical puzzle.
     */
    protocolConfigModHash: '',
    /** Tree hash of ``property_registry_inner.clsp``. */
    propertyRegistryModHash: '',
    /** Tree hash of ``mint_proposal_inner.clsp``. */
    mintProposalModHash: '',
    /**
     * Tree hash of the uncurried vault inner puzzle. Updated to the
     * current vault code the registry publishes (Brick 3 migrate spend).
     */
    vaultInnerModHash:
      '0x4176b7fa966f4c4a0fe2609d69e0411046228b3fac7335e6695402bbf926fd4c',
    /** Vault-version registry singleton. Empty = not deployed yet. */
    vaultVersionRegistryLauncherId: '',
    /** Tree hash of vault_version_registry_inner.clsp — pinned to verify on-chain state. */
    vaultVersionRegistryModHash:
      '0x5cf39809296ad31bf906f7610912ac56fb8c339e0e98444f821f9e363df60d29',
  },
};
