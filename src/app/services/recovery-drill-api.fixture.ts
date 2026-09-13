// Public synthetic fixtures from isolated API admin_security.py, SHA256 d1c49516728527df7875c7bc90e39189d23a6af8e1e9aefa393858e0bb88f447.
// BIP39 all-zero 256-bit entropy vector; no live recovery identity.
import type { RecoveryDrillChallenge, PreparedKeyChange } from './admin-security.service';

export const RECOVERY_DRILL_API_FIXTURES: Array<{ payload: Record<string, unknown>; challenge: RecoveryDrillChallenge }> = [
  {
    "payload": {
      "schemaVersion": 1,
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
      "recoveryEvmPath": "m/44'/60'/0'/0/0"
    },
    "challenge": {
      "challengeId": "0x4444444444444444444444444444444444444444444444444444444444444444",
      "challengeHash": "0x07f4392def131078d192be0fcbbf8bacf5d53bc4d6eef1c29013aec7ba8d439e",
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
          "version": "1",
          "chainId": 84532
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
      "blsSigningDigest": "0xea21a65bc8c0bcfb03b079a7b2ee78617e66a272f9b0ec055c13dba6617b68a3",
      "recoveryBlsPath": "m/12381/8444/2/0-unhardened",
      "recoveryEvmPath": "m/44'/60'/0'/0/0"
    }
  },
  {
    "payload": {
      "schemaVersion": 1,
      "purpose": "Solslot administrator recovery drill",
      "ceremonyId": "0x1111111111111111111111111111111111111111111111111111111111111111",
      "slot": 1,
      "dailyWallet": "0x2222222222222222222222222222222222222222",
      "evmGuardian": "0xF278cF59F82eDcf871d630F28EcC8056f25C1cdb",
      "recoveryBlsPubkey": "0xaf6c8e1ade5f1e0fdf588d9fc5f7cb3fd587d45cad8f0d7d473220820d142cd2d6985c290f70420acbed80ba0b285860",
      "recoveryBlsCommitment": "0x1a8c5c9f366d6573c16eecc52cc914fe2dcb112930151ee8e411211b52479fa5",
      "revision": 128,
      "nonce": "0x3333333333333333333333333333333333333333333333333333333333333333",
      "expiresAt": 2147483648,
      "recoveryBlsPath": "m/12381/8444/2/0-unhardened",
      "recoveryEvmPath": "m/44'/60'/0'/0/0"
    },
    "challenge": {
      "challengeId": "0x4444444444444444444444444444444444444444444444444444444444444444",
      "challengeHash": "0xd7919b5061d5175373c5c1e8ce1fdb409f096554ea8292b979130f8d2b7e0e77",
      "expiresAt": 2147483648,
      "revision": 128,
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
          "version": "1",
          "chainId": 84532
        },
        "message": {
          "ceremonyId": "0x1111111111111111111111111111111111111111111111111111111111111111",
          "slot": 1,
          "dailyWallet": "0x2222222222222222222222222222222222222222",
          "evmGuardian": "0xF278cF59F82eDcf871d630F28EcC8056f25C1cdb",
          "recoveryBlsCommitment": "0x1a8c5c9f366d6573c16eecc52cc914fe2dcb112930151ee8e411211b52479fa5",
          "revision": 128,
          "nonce": "0x3333333333333333333333333333333333333333333333333333333333333333",
          "expiresAt": 2147483648
        }
      },
      "blsSigningDigest": "0x2313e40380d82b2100aa5c3e918d90f16eec7fcb2304b47a2fb0804c02146271",
      "recoveryBlsPath": "m/12381/8444/2/0-unhardened",
      "recoveryEvmPath": "m/44'/60'/0'/0/0"
    }
  },
  {
    "payload": {
      "schemaVersion": 1,
      "purpose": "Solslot administrator recovery drill",
      "ceremonyId": "0x1111111111111111111111111111111111111111111111111111111111111111",
      "slot": 2,
      "dailyWallet": "0x2222222222222222222222222222222222222222",
      "evmGuardian": "0xF278cF59F82eDcf871d630F28EcC8056f25C1cdb",
      "recoveryBlsPubkey": "0xaf6c8e1ade5f1e0fdf588d9fc5f7cb3fd587d45cad8f0d7d473220820d142cd2d6985c290f70420acbed80ba0b285860",
      "recoveryBlsCommitment": "0x1a8c5c9f366d6573c16eecc52cc914fe2dcb112930151ee8e411211b52479fa5",
      "revision": 255,
      "nonce": "0x3333333333333333333333333333333333333333333333333333333333333333",
      "expiresAt": 4102444800,
      "recoveryBlsPath": "m/12381/8444/2/0-unhardened",
      "recoveryEvmPath": "m/44'/60'/0'/0/0"
    },
    "challenge": {
      "challengeId": "0x4444444444444444444444444444444444444444444444444444444444444444",
      "challengeHash": "0xe48208cd08a03eb9ec2b225abc44c7200ee3c55e36fe23a25cc0c6255a8a8097",
      "expiresAt": 4102444800,
      "revision": 255,
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
          "version": "1",
          "chainId": 84532
        },
        "message": {
          "ceremonyId": "0x1111111111111111111111111111111111111111111111111111111111111111",
          "slot": 2,
          "dailyWallet": "0x2222222222222222222222222222222222222222",
          "evmGuardian": "0xF278cF59F82eDcf871d630F28EcC8056f25C1cdb",
          "recoveryBlsCommitment": "0x1a8c5c9f366d6573c16eecc52cc914fe2dcb112930151ee8e411211b52479fa5",
          "revision": 255,
          "nonce": "0x3333333333333333333333333333333333333333333333333333333333333333",
          "expiresAt": 4102444800
        }
      },
      "blsSigningDigest": "0x85ba3669aa6ea356c45116caf61d80cc0096cf4a84a9494d4b4ccbfa33fb1679",
      "recoveryBlsPath": "m/12381/8444/2/0-unhardened",
      "recoveryEvmPath": "m/44'/60'/0'/0/0"
    }
  }
];

// Standalone LOST authorization generated with the same public synthetic identity.
export const RECOVERY_LOST_API_FIXTURE: PreparedKeyChange = {
  "intent": {
    "schemaVersion": 1,
    "slot": 0,
    "kind": "LOST",
    "oldDailyEvmKey": "0x77952Ce83Ca3cad9F7AdcFabeDA85Bd2F1f52008",
    "newDailyEvmKey": "0x17c5185167401eD00cF5F5b2fc97D9BBfDb7D025",
    "oldDailyChiaKey": "0x036930f46dd0b16d866d59d1054aa63298b357499cd1862ef16f3f55f1cafceb82",
    "newDailyChiaKey": "0x0324653eac434488002cc06bbfb7f10fe18991e35f9fe4302dbea6d2353dc0ab1c",
    "oldRecoveryGuardian": "0xF278cF59F82eDcf871d630F28EcC8056f25C1cdb",
    "newRecoveryGuardian": "0xF278cF59F82eDcf871d630F28EcC8056f25C1cdb",
    "oldRecoveryBlsKey": "0xaf6c8e1ade5f1e0fdf588d9fc5f7cb3fd587d45cad8f0d7d473220820d142cd2d6985c290f70420acbed80ba0b285860",
    "newRecoveryBlsKey": "0xaf6c8e1ade5f1e0fdf588d9fc5f7cb3fd587d45cad8f0d7d473220820d142cd2d6985c290f70420acbed80ba0b285860",
    "identityLauncherIds": [
      "0x0101010101010101010101010101010101010101010101010101010101010101",
      "0x0202020202020202020202020202020202020202020202020202020202020202",
      "0x0303030303030303030303030303030303030303030303030303030303030303"
    ],
    "identitySafes": [
      "0x0404040404040404040404040404040404040404",
      "0x0505050505050505050505050505050505050505",
      "0x0606060606060606060606060606060606060606"
    ],
    "authorityLauncherId": "0x0707070707070707070707070707070707070707070707070707070707070707",
    "coadminSafe": "0x0808080808080808080808080808080808080808",
    "rootSafe": "0x0909090909090909090909090909090909090909",
    "chiaNetwork": "testnet11",
    "evmChainId": 84532,
    "sourceManifestHash": "0x0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a",
    "nonce": 1,
    "expiresAt": 2000000000,
    "recoveryKeyRevision": 1
  },
  "intentHash": "0x2af4fa53d049b2f1cfd4f66598e076b28b3dd07d94cfc68017956579a6819710",
  "coordinator": "0x8484848484848484848484848484848484848484",
  "prepareTransaction": {
    "chainId": 84532,
    "to": "0x8484848484848484848484848484848484848484",
    "value": "0x0",
    "data": "0xfc0b41b100000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000200000000000000000000000077952ce83ca3cad9f7adcfabeda85bd2f1f5200800000000000000000000000017c5185167401ed00cf5f5b2fc97d9bbfdb7d02500000000000000000000000000000000000000000000000000000000000003200000000000000000000000000000000000000000000000000000000000000380000000000000000000000000f278cf59f82edcf871d630f28ecc8056f25c1cdb000000000000000000000000f278cf59f82edcf871d630f28ecc8056f25c1cdb00000000000000000000000000000000000000000000000000000000000003e0000000000000000000000000000000000000000000000000000000000000044001010101010101010101010101010101010101010101010101010101010101010202020202020202020202020202020202020202020202020202020202020202030303030303030303030303030303030303030303030303030303030303030300000000000000000000000004040404040404040404040404040404040404040000000000000000000000000505050505050505050505050505050505050505000000000000000000000000060606060606060606060606060606060606060607070707070707070707070707070707070707070707070707070707070707070000000000000000000000000808080808080808080808080808080808080808000000000000000000000000090909090909090909090909090909090909090900000000000000000000000000000000000000000000000000000000000004a00000000000000000000000000000000000000000000000000000000000014a340a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000007735940000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000021036930f46dd0b16d866d59d1054aa63298b357499cd1862ef16f3f55f1cafceb820000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000210324653eac434488002cc06bbfb7f10fe18991e35f9fe4302dbea6d2353dc0ab1c000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000030af6c8e1ade5f1e0fdf588d9fc5f7cb3fd587d45cad8f0d7d473220820d142cd2d6985c290f70420acbed80ba0b285860000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000030af6c8e1ade5f1e0fdf588d9fc5f7cb3fd587d45cad8f0d7d473220820d142cd2d6985c290f70420acbed80ba0b285860000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000009746573746e657431310000000000000000000000000000000000000000000000"
  },
  "clearSigning": {
    "title": "Recover lost administrator wallet",
    "slot": 0,
    "oldWallet": "0x77952Ce83Ca3cad9F7AdcFabeDA85Bd2F1f52008",
    "newWallet": "0x17c5185167401eD00cF5F5b2fc97D9BBfDb7D025",
    "oldRecoveryGuardian": "0xF278cF59F82eDcf871d630F28EcC8056f25C1cdb",
    "newRecoveryGuardian": "0xF278cF59F82eDcf871d630F28EcC8056f25C1cdb",
    "financialEffect": "No funds move.",
    "authorityEffect": "The replacement controls this administrator identity only after both chains match.",
    "delaySeconds": 604800,
    "expiresAt": 2000000000,
    "operationsFreeze": true,
    "oldKeyCanVeto": true
  },
  "recoveryBlsDigest": "0x302ad025f33b401eed4f2ce58987a81e7eb6be644755ef3e0871dee866a1a3f1",
  "guardianTypedData": {
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
        },
        {
          "name": "verifyingContract",
          "type": "address"
        }
      ],
      "SolslotLostKeyPrepare": [
        {
          "name": "intentHash",
          "type": "bytes32"
        }
      ]
    },
    "primaryType": "SolslotLostKeyPrepare",
    "domain": {
      "name": "Solslot Admin Recovery",
      "version": "1",
      "chainId": 84532,
      "verifyingContract": "0x8484848484848484848484848484848484848484"
    },
    "message": {
      "intentHash": "0x2af4fa53d049b2f1cfd4f66598e076b28b3dd07d94cfc68017956579a6819710"
    }
  }
};
