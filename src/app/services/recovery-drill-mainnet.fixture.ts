// Public synthetic vector derived by the API; no live keys.
import type { RecoveryDrillChallenge } from './admin-security.service';
export const MAINNET_RECOVERY_DRILL: { payload: Record<string, unknown>; challenge: RecoveryDrillChallenge } = {
  "payload": {
    "schemaVersion": 2,
    "purpose": "Solslot administrator recovery drill",
    "ceremonyId": "0x1111111111111111111111111111111111111111111111111111111111111111",
    "slot": 0,
    "dailyWallet": "0x2222222222222222222222222222222222222222",
    "evmGuardian": "0xF278cF59F82eDcf871d630F28EcC8056f25C1cdb",
    "recoveryBlsPubkey": "0xaf6c8e1ade5f1e0fdf588d9fc5f7cb3fd587d45cad8f0d7d473220820d142cd2d6985c290f70420acbed80ba0b285860",
    "recoveryBlsCommitment": "0x1a8c5c9f366d6573c16eecc52cc914fe2dcb112930151ee8e411211b52479fa5",
    "revision": 1,
    "nonce": "0x3333333333333333333333333333333333333333333333333333333333333333",
    "expiresAt": 1900000000,
    "recoveryBlsPath": "m/12381/8444/2/0-unhardened",
    "recoveryEvmPath": "m/44'/60'/0'/0/0",
    "evmChainId": 8453
  },
  "challenge": {
    "challengeId": "0x4444444444444444444444444444444444444444444444444444444444444444",
    "challengeHash": "0x3245124c6ce39a49fa6ce7223a5c5f9b24be79653c49539103b7b25655d0f159",
    "expiresAt": 1900000000,
    "revision": 1,
    "evmTypedData": {
      "types": {
        "EIP712Domain": [
          {
            "name": "name",
            "type": "string"
          },
          {
            "name": "version",
            "type": "string"
          },
          {
            "name": "chainId",
            "type": "uint256"
          }
        ],
        "SolslotAdminRecoveryDrill": [
          {
            "name": "ceremonyId",
            "type": "bytes32"
          },
          {
            "name": "slot",
            "type": "uint8"
          },
          {
            "name": "dailyWallet",
            "type": "address"
          },
          {
            "name": "evmGuardian",
            "type": "address"
          },
          {
            "name": "recoveryBlsCommitment",
            "type": "bytes32"
          },
          {
            "name": "revision",
            "type": "uint64"
          },
          {
            "name": "nonce",
            "type": "bytes32"
          },
          {
            "name": "expiresAt",
            "type": "uint64"
          }
        ]
      },
      "primaryType": "SolslotAdminRecoveryDrill",
      "domain": {
        "name": "Solslot Admin Recovery",
        "version": "2",
        "chainId": 8453
      },
      "message": {
        "ceremonyId": "0x1111111111111111111111111111111111111111111111111111111111111111",
        "slot": 0,
        "dailyWallet": "0x2222222222222222222222222222222222222222",
        "evmGuardian": "0xF278cF59F82eDcf871d630F28EcC8056f25C1cdb",
        "recoveryBlsCommitment": "0x1a8c5c9f366d6573c16eecc52cc914fe2dcb112930151ee8e411211b52479fa5",
        "revision": 1,
        "nonce": "0x3333333333333333333333333333333333333333333333333333333333333333",
        "expiresAt": 1900000000
      }
    },
    "blsSigningDigest": "0x8001c335a7062b18940ff26801c2438003e6eb545f577b2e22260230f420b0e1",
    "recoveryBlsPath": "m/12381/8444/2/0-unhardened",
    "recoveryEvmPath": "m/44'/60'/0'/0/0"
  }
};
