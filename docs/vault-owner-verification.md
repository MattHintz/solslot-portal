# Vault discovery ownership verification

Public hints identify candidates. They do not establish ownership.
Before returning a confirmed vault, discovery checks the launcher coin ID,
one-mojo singleton continuation, atomic parent-spend/child-confirmation heights,
and the complete single-owner vault puzzle commitment.

The browser reconstructs the singleton wrapper and inner puzzle from the
connected authentication type and public key, its one-leaf members root, the
launcher, and the pool/bridge coordinates from the already verified release
artifact. The inner module hash is bound to the protocol source in this
coordinated release. Python protocol vectors cover BLS, passkey and EVM keys.

The empty identity root is known at ordinary registration. For a later state,
the parent's puzzle/solution supplies possible identity-root preimages. The
bounded reader never executes those programs. A supplied root is accepted only
when the full locally reconstructed puzzle equals the current coin's hash;
presence in a response is not authentication. An actual protocol identity-update
fixture also checks its CLVM-generated successor.

Restore supplies the wallet key again. Refresh clears the prior ready flag
before asynchronous work and checks the captured session before applying a
result. API creation responses and caller snapshots cannot mark a vault ready.
Google restore prefers an already bound backup launcher. Saving a launcher
requires a fresh owner-checked state and rechecks it after encryption. An
unconfirmed creation leaves its backup unbound and explains how to reconnect.

## Remaining compatibility and outcome evidence

This verifier currently recognizes the exact nine-argument
vault_singleton_inner module in the release source. It does not establish
support for other module versions, other canonical parameter generations,
multi-member vaults, or a newly launched migrated vault whose nonempty identity
root is absent from its launcher's reveal/solution. Such states need sufficient
preimage evidence and an independently verified version/parameter policy before
they can be accepted. Do not claim complete migration/legacy recovery coverage.

The customer artifact verifier's historical schema and empty deployment pins
remain a separate integration limitation. This candidate does not invent signed
deployment evidence or enable a production gate.

Coin records still come from the configured provider; these checks are not a
consensus light-client proof. Backend owner authentication and credential receipt
checks remain independent. Synthetic/browser tests do not establish actual
Google Drive writes, wallet handoffs, signed transactions, or iOS outcomes.
