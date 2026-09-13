# Google Vault transaction policy — alpha containment

Google Vault coin-spend signing is unavailable in the operator portal, including
when Google sign-in is explicitly enabled on Testnet11. The shared
`GoogleBlsWalletService.signSpendBundle` throws before reading spend fields,
loading WASM, evaluating CLVM, or using either browser-held signing key. There is
no caller-supplied approval flag. The previous generic input-only confirmation
and unreviewed CLVM signing path have been removed. The exported aggregate
signature message helper also rejects `AGG_SIG_UNSAFE`.

For a BLS-authenticated vault, the governance vote service checks both the saved
wallet source and the current wallet connection before owner authorization and after each asynchronous
preparation step. The allocation page explains the unavailable state and disables
its vote button. The shared signer provides the final boundary if a different
caller, absent historical wallet marker, or wallet change reaches it. A previous
Google Chia connection does not block a subsequently selected EVM vault.

Unlock, deterministic key derivation, locking, backup operations, and CHIP-0002
owner authentication remain available under the existing Testnet activation gate.
External Goby, Sage, WalletConnect and EVM signing retain their existing paths and
wallet review requirements. This change does not validate their provider packages
or prove their transaction outcomes.

## Feature limitations and prerequisites

This is containment, not completed Google transaction integration. Every operator
caller using the generic Google spend entry point is gated, including vault-held
SGT votes, offer acceptance, upgrades, recovery marker publication, authority and
roster transactions, committee votes, and mint publication/execution. Some callers
are not mounted or already have other gates. None may be marked ready based on
this patch. Google sign-in and account recovery must not promise these actions.

Re-enabling coin spends requires a reviewed local policy that reconstructs the
action from independently reviewed intent, verifies canonical current inputs and
lineage, strict serialization and unsigned 64-bit amounts, puzzle reveal hashes,
exact outputs and fees, expected owner keys, network, and release coordinates.
Vote policy must also bind the original proposal, vault, SGT amount, operation,
tracker, deadline and complete fee package. Equality between two provider-supplied
descriptions does not establish those properties. The current API vote package
does not provide all independently verifiable information needed by such a policy.
No boolean or input-only dialog can replace this validation.

Coverage is local TypeScript/Chrome tests with synthetic SDK/wallet providers and
the repository's cryptographic vector check. Live signatures, chain holdings,
receipts, iOS wallet handoffs, and deployed activation remain separate evidence.
This gate is not a launch approval and does not satisfy the advertised-feature
transaction-outcome requirement.
