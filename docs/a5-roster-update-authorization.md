# A.5 roster-update authorization model

A.5 roster updates are `admin_authority_v2` singleton spends with `SPEND_ADMIN_ROSTER_UPDATE = 0x07` and spend name `ADMIN_ROSTER_UPDATE`.

The only protocol authorizer for this add-admin path is the current `admin_authority_v2` MIPS quorum committed in `current.mips_root_hash`.

## Non-authorizers

The following are not authorizers for this A.5 add-admin path:

- The candidate admin wallet does not authorize its own addition.
- The Populis API backend is optional cross-check infrastructure only and is not an authority source for roster changes.
- PGT committee approval is not part of this A.5 add-admin path unless a future governance design explicitly adds a separate spend path.
- The bootstrap operator token cannot authorize post-genesis roster updates.

## Roster mutation rule

Each A.5 roster update must:

- append exactly one admin slot
- preserve existing admin records as a prefix
- preserve `pending_ops_hash`
- increment `authority_version` by one
- recompute the post-update MIPS root from the updated roster using the admin supermajority threshold

The initial second-admin update is authorized by the current `1-of-1` first-admin MIPS root and moves the authority to a `2-of-2` root. Later additions are authorized by whatever current supermajority root is live before the spend.

## Signer boundary

The unsigned package and review screen remain no-signing and no-broadcast boundaries until the local signer receives and hash-verifies:

- current MIPS puzzle reveal
- current MIPS quorum solution
- live singleton coin
- wallet signature over the final Chia spend bundle

## Local review hash verification

Before any future spend builder runs, the review screen verifies signer inputs locally:

- current MIPS puzzle reveal tree hash must match `current.mips_root_hash`
- current MIPS quorum solution must parse as serialized CLVM but is not executed
- current `admin_authority_v2` inner puzzle reveal tree hash must match the recomputed current inner puzzle hash
- live singleton coin metadata and puzzle hash must match the package

This local hash verification step does not execute MIPS, construct CLVM spends, collect wallet signatures, sign, broadcast, or call the backend.
