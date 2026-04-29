/**
 * Runtime environment configuration for the Populis Portal (development).
 *
 * All endpoints default to local dev services.  Override by creating
 * `environment.prod.ts` and selecting it via `ng build --configuration production`.
 */
export const environment = {
  production: false,

  /**
   * Populis FastAPI backend.  Handles secp256k1 pubkey recovery,
   * vault launcher bundle assembly, coinset.org broadcasting, and
   * faucet-funded launcher payments.
   */
  populisApi: 'http://localhost:8787',

  /**
   * Chia full-node RPC proxy.  We use coinset.org's public testnet RPC
   * (and mainnet later).  All direct calls from the frontend are read-only
   * queries (get_coin_record_by_name, etc.) — broadcasting happens via the
   * Populis API to avoid rate-limiting and CORS.
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
  walletConnectProjectId: '',

  /**
   * Chain id that Populis EIP-712 signatures are bound to.
   * MUST match EIP712_DOMAIN_CHAIN_ID in populis_protocol/populis_puzzles/vault_driver.py.
   */
  eip712ChainId: 1,
};
