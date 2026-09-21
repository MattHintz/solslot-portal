import { MAINNET_RECOVERY_DRILL } from './recovery-drill-mainnet.fixture';
import { RECOVERY_DRILL_API_FIXTURES } from './recovery-drill-api.fixture';
import { SigningKey, Wallet, getAddress, sha256, toUtf8Bytes } from 'ethers';

import {
  createAdminChiaRecoveryActionPackage,
  createAdminChiaRecoveryActionResult,
  createAdminLostRecoveryPackage,
  createAdminLostRecoveryResult,
  createAdminRecoveryDrillPackage,
  createAdminRecoveryDrillResult,
  createAdminRecoveryGuardianActionPackage,
  createAdminRecoveryGuardianActionResult,
  hashAdminKeyChangeIntent,
  parseAdminLostRecoveryPackage,
  parseAdminLostRecoveryResult,
  parseAdminChiaRecoveryActionPackage,
  parseAdminChiaRecoveryActionResult,
  parseAdminRecoveryDrillPackage,
  parseAdminRecoveryDrillResult,
  parseAdminRecoveryGuardianActionPackage,
  parseAdminRecoveryGuardianActionResult,
  recoveryIntentBlsDigest,
} from './admin-recovery-handoff';
import {
  AdminKeyChangeIntentV1,
  AdminRecoveryCase,
  EvmRecoveryAction,
  PreparedKeyChange,
  RecoveryDrillChallenge,
} from './admin-security.service';

describe('administrator recovery handoff', () => {
  it('checksums and parses the independent API mainnet restore vector', () => {
    const created = createAdminRecoveryDrillPackage(structuredClone(MAINNET_RECOVERY_DRILL.challenge));
    const parsed = parseAdminRecoveryDrillPackage(JSON.stringify(created));
    expect(parsed.challenge.evmTypedData.domain.chainId).toBe(8453);
    expect(parsed).toEqual(created);
  });

  it('checksums and parses the exact second-device package', () => {
    const created = createAdminRecoveryDrillPackage(challenge());
    const parsed = parseAdminRecoveryDrillPackage(JSON.stringify(created));

    expect(parsed).toEqual(created);
    expect(parsed.checksum).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('rejects a changed challenge even when the JSON remains valid', () => {
    const created = createAdminRecoveryDrillPackage(challenge());
    created.challenge.revision = 2;

    expect(() => parseAdminRecoveryDrillPackage(JSON.stringify(created))).toThrowError(
      /checksum does not match/i,
    );
  });

  it('rejects malformed and oversized packages', () => {
    expect(() => parseAdminRecoveryDrillPackage('{"schemaVersion":1}')).toThrowError(
      /unexpected shape/i,
    );
    expect(() => parseAdminRecoveryDrillPackage('x'.repeat(32 * 1024 + 1))).toThrowError(
      /too large/i,
    );
  });

  it('binds the returned signatures to the one-time challenge', () => {
    const result = createAdminRecoveryDrillResult(`0x${'11'.repeat(32)}`, {
      evmSignature: `0x${'22'.repeat(65)}`,
      blsSignature: `0x${'33'.repeat(96)}`,
    });

    expect(
      parseAdminRecoveryDrillResult(JSON.stringify(result), `0x${'11'.repeat(32)}`),
    ).toEqual(result);
    expect(() =>
      parseAdminRecoveryDrillResult(JSON.stringify(result), `0x${'44'.repeat(32)}`),
    ).toThrowError(/does not match/i);
  });

  it('matches the Python Authority V3 intent and BLS digest fixture', () => {
    const intent = pythonFixtureIntent();
    const intentHash = hashAdminKeyChangeIntent(intent);

    expect(intentHash).toBe(
      '0x7340fd68f52984e3ac038f8d21aff57dc8f0ca205e017382521d4c46adb6a329',
    );
    expect(recoveryIntentBlsDigest(intentHash)).toBe(
      '0xb6026a2619c3b2d0fbe207ceb41e2f2d9d1d9520843a08390db214df907e1988',
    );
  });

  it('recomputes and checksums the exact lost-wallet recovery package', () => {
    const prepared = lostPrepared();
    const created = createAdminLostRecoveryPackage(prepared);
    const parsed = parseAdminLostRecoveryPackage(JSON.stringify(created));

    expect(parsed).toEqual(created);
    expect(parsed.intentHash).toBe(hashAdminKeyChangeIntent(parsed.intent));
    expect(parsed.recoveryBlsDigest).toBe(
      recoveryIntentBlsDigest(parsed.intentHash),
    );
  });

  it('rejects altered lost-wallet intent, domain, and returned signatures', () => {
    const prepared = lostPrepared();
    prepared.guardianTypedData = {
      ...prepared.guardianTypedData!,
      domain: {
        ...prepared.guardianTypedData!.domain,
        verifyingContract: getAddress(`0x${'99'.repeat(20)}`),
      },
    };
    expect(() => createAdminLostRecoveryPackage(prepared)).toThrowError(
      /does not match/i,
    );

    const result = createAdminLostRecoveryResult(`0x${'11'.repeat(32)}`, {
      guardianSignature: `0x${'22'.repeat(65)}`,
      recoveryBlsSignature: `0x${'33'.repeat(96)}`,
    });
    expect(() =>
      parseAdminLostRecoveryResult(JSON.stringify(result), `0x${'44'.repeat(32)}`),
    ).toThrowError(/does not match/i);
  });

  it('checksums and verifies exact offline recovery-kit actions', () => {
    const { recovery, action } = recoveryKitAction('ACCEPT');
    const created = createAdminRecoveryGuardianActionPackage(recovery, action);
    const parsed = parseAdminRecoveryGuardianActionPackage(
      JSON.stringify(created),
    );

    expect(parsed).toEqual(created);
    expect(parsed.expectedGuardian).toBe(
      recovery.intent.newRecoveryGuardian,
    );
    expect(parsed.guardianTypedData.primaryType).toBe(
      'SolslotRecoveryGuardianAccept',
    );

    const result = createAdminRecoveryGuardianActionResult(
      parsed,
      `0x${'66'.repeat(65)}`,
    );
    expect(
      parseAdminRecoveryGuardianActionResult(JSON.stringify(result), parsed),
    ).toEqual(result);
  });

  it('rejects recovery-kit guardian action and domain substitution', () => {
    const { recovery, action } = recoveryKitAction('VETO');
    const created = createAdminRecoveryGuardianActionPackage(recovery, action);
    created.guardianTypedData = {
      ...created.guardianTypedData,
      primaryType: 'SolslotRecoveryGuardianAccept',
    };
    expect(() =>
      parseAdminRecoveryGuardianActionPackage(JSON.stringify(created)),
    ).toThrowError(/checksum does not match/i);

    const valid = createAdminRecoveryGuardianActionPackage(
      recovery,
      action,
    );
    const result = createAdminRecoveryGuardianActionResult(
      valid,
      `0x${'67'.repeat(65)}`,
    );
    expect(() =>
      parseAdminRecoveryGuardianActionResult(JSON.stringify(result), {
        ...valid,
        action: 'ACCEPT',
      }),
    ).toThrowError(/does not match/i);
  });

  it('rejects current message-only Chia recovery packages before they can be signed', () => {
    const recovery = lostRecoveryCase();
    const action = lostChiaAction(recovery);
    expect(() => createAdminChiaRecoveryActionPackage(recovery, action)).toThrowError(/Chia recovery signing is unavailable/);
    const body = { schemaVersion: 1 as const, purpose: 'Solslot administrator Testnet11 recovery action' as const,
      caseId: recovery.caseId, intent: recovery.intent, intentHash: recovery.intentHash, action };
    for (const message of [action.blsPairs[0].message, '0x' + '99'.repeat(32)]) {
      body.action.blsPairs[0].message = message;
      const envelope = { ...body, checksum: stableHash(body) };
      expect(() => parseAdminChiaRecoveryActionPackage(JSON.stringify(envelope))).toThrowError(/Chia recovery signing is unavailable/);
    }
    // Historical result parsing still binds the receipt to the original action.
    const envelope = { ...body, checksum: stableHash(body) };
    const result = createAdminChiaRecoveryActionResult(envelope, '0x' + 'ac'.repeat(96));
    expect(parseAdminChiaRecoveryActionResult(JSON.stringify(result), envelope)).toEqual(result);
    result.actionId = '0x' + '01'.repeat(32);
    expect(() => parseAdminChiaRecoveryActionResult(JSON.stringify(result), envelope)).toThrowError(/does not match/i);
  });

  it('rejects a substituted restore digest even when the outer checksum is recomputed', () => {
    const altered = challenge();
    altered.blsSigningDigest = '0x' + '99'.repeat(32);
    const envelope = createAdminRecoveryDrillPackage(altered);
    expect(() => parseAdminRecoveryDrillPackage(JSON.stringify(envelope))).toThrowError(/signing digest does not match/);
  });

  it('rejects extra typed-data fields even with a new public checksum', () => {
    const altered = challenge();
    altered.evmTypedData.message['recipient'] = '0x' + '99'.repeat(20);
    expect(() => parseAdminRecoveryDrillPackage(JSON.stringify(createAdminRecoveryDrillPackage(altered)))).toThrowError(/altered administrator recovery drill/);
  });

});

function challenge(): RecoveryDrillChallenge {
  return structuredClone(RECOVERY_DRILL_API_FIXTURES[0].challenge);
}

function lostPrepared(): PreparedKeyChange {
  const oldKey = `0x${'31'.repeat(32)}`;
  const newKey = `0x${'42'.repeat(32)}`;
  const oldCompressed = SigningKey.computePublicKey(oldKey, true);
  const newCompressed = SigningKey.computePublicKey(newKey, true);
  const guardian = new Wallet(`0x${'53'.repeat(32)}`).address;
  const coordinator = getAddress(`0x${'84'.repeat(20)}`);
  const intent: AdminKeyChangeIntentV1 = {
    schemaVersion: 1,
    slot: 0,
    kind: 'LOST',
    oldDailyEvmKey: new Wallet(oldKey).address,
    newDailyEvmKey: new Wallet(newKey).address,
    oldDailyChiaKey: oldCompressed,
    newDailyChiaKey: newCompressed,
    oldRecoveryGuardian: guardian,
    newRecoveryGuardian: guardian,
    oldRecoveryBlsKey: `0x${'65'.repeat(48)}`,
    newRecoveryBlsKey: `0x${'65'.repeat(48)}`,
    identityLauncherIds: [
      `0x${'01'.repeat(32)}`,
      `0x${'02'.repeat(32)}`,
      `0x${'03'.repeat(32)}`,
    ],
    identitySafes: [
      getAddress(`0x${'04'.repeat(20)}`),
      getAddress(`0x${'05'.repeat(20)}`),
      getAddress(`0x${'06'.repeat(20)}`),
    ],
    authorityLauncherId: `0x${'07'.repeat(32)}`,
    coadminSafe: getAddress(`0x${'08'.repeat(20)}`),
    rootSafe: getAddress(`0x${'09'.repeat(20)}`),
    chiaNetwork: 'testnet11',
    evmChainId: 84532,
    sourceManifestHash: `0x${'0a'.repeat(32)}`,
    nonce: 1,
    expiresAt: 2_000_000_000,
    recoveryKeyRevision: 1,
  };
  const intentHash = hashAdminKeyChangeIntent(intent);
  return {
    intent,
    intentHash,
    coordinator,
    prepareTransaction: {
      chainId: 84532,
      to: coordinator,
      value: '0x0',
      data: '0x1234',
    },
    clearSigning: {
      title: 'Recover lost administrator wallet',
      slot: 0,
      oldWallet: intent.oldDailyEvmKey,
      newWallet: intent.newDailyEvmKey,
      oldRecoveryGuardian: guardian,
      newRecoveryGuardian: guardian,
      financialEffect: 'No funds move.',
      authorityEffect: 'Replacement identity only.',
      delaySeconds: 604800,
      expiresAt: intent.expiresAt,
      operationsFreeze: true,
      oldKeyCanVeto: true,
    },
    recoveryBlsDigest: recoveryIntentBlsDigest(intentHash),
    guardianTypedData: {
      types: {
        EIP712Domain: [
          { name: 'name', type: 'string' },
          { name: 'version', type: 'string' },
          { name: 'chainId', type: 'uint256' },
          { name: 'verifyingContract', type: 'address' },
        ],
        SolslotLostKeyPrepare: [{ name: 'intentHash', type: 'bytes32' }],
      },
      primaryType: 'SolslotLostKeyPrepare',
      domain: {
        name: 'Solslot Admin Recovery',
        version: '1',
        chainId: 84532,
        verifyingContract: coordinator,
      },
      message: { intentHash },
    },
  };
}

function lostRecoveryCase(): AdminRecoveryCase {
  const prepared = lostPrepared();
  return {
    caseId: `recovery-${prepared.intentHash.slice(2)}`,
    ceremonyId: `0x${'91'.repeat(32)}`,
    slot: prepared.intent.slot,
    kind: 'LOST',
    state: 'AWAITING_APPROVALS',
    intentHash: prepared.intentHash,
    intent: prepared.intent,
    executeAfter: 2_000_000_000,
    expiresAt: 2_000_604_800,
    preparedBy: prepared.intent.oldRecoveryGuardian,
    chiaTransactionId: null,
    evmTransactionHash: null,
    chiaReceiptHash: null,
    evmReceiptHash: null,
    failureReason: null,
    approvals: [],
    receipts: [],
    chiaSignatures: [],
    evmSubmissions: [],
    createdAt: 1_900_000_000,
    updatedAt: 1_900_000_000,
    approvalsComplete: false,
    delayComplete: false,
    actions: [],
    policy: {
      operationsFrozen: true,
      crossChainConvergenceRequired: true,
      oldKeyVetoUntilExecution: true,
      totalLossBypass: false,
    },
  };
}

function lostChiaAction(recovery: AdminRecoveryCase) {
  const pairs = [
    {
      publicKey: recovery.intent.oldRecoveryBlsKey,
      message: `0x${'72'.repeat(32)}`,
    },
  ];
  const wirePairs = pairs.map((pair) => [pair.publicKey, pair.message]);
  const messageHash = stableHash({
    schemaVersion: 1,
    kind: 'AuthorityV3BlsMessages',
    pairs: wirePairs,
  });
  return {
    actionId: stableHash({
      schemaVersion: 1,
      phase: 'PREPARE',
      role: 'lost-key-recovery',
      slot: recovery.slot,
      publicKey: recovery.intent.oldRecoveryBlsKey,
      messageHash,
      pairs: wirePairs,
    }),
    phase: 'PREPARE' as const,
    signerKind: 'BLS_RECOVERY' as const,
    signerSlot: recovery.slot,
    signerPublicKey: recovery.intent.oldRecoveryBlsKey,
    messageHash,
    title: 'Authorize lost-wallet recovery',
    summary: 'Exact recovery only.',
    network: 'Testnet11' as const,
    financialEffect: 'No administrator or protocol funds move.',
    coinId: null,
    delegatedPuzzleHash: null,
    typedData: null,
    blsPairs: pairs,
    signed: false,
  };
}

function stableHash(value: unknown): string {
  return sha256(toUtf8Bytes(stableJson(value)));
}

function stableJson(value: unknown): string {
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'string' ||
    typeof value === 'number'
  ) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(',')}}`;
}

function recoveryKitAction(actionType: 'ACCEPT' | 'VETO'): {
  recovery: AdminRecoveryCase;
  action: EvmRecoveryAction;
} {
  const dailyKey = `0x${'31'.repeat(32)}`;
  const dailyCompressed = SigningKey.computePublicKey(dailyKey, true);
  const oldGuardian = new Wallet(`0x${'53'.repeat(32)}`).address;
  const newGuardian = new Wallet(`0x${'54'.repeat(32)}`).address;
  const coordinator = getAddress(`0x${'84'.repeat(20)}`);
  const intent: AdminKeyChangeIntentV1 = {
    schemaVersion: 1,
    slot: 0,
    kind: 'RECOVERY_KIT',
    oldDailyEvmKey: new Wallet(dailyKey).address,
    newDailyEvmKey: new Wallet(dailyKey).address,
    oldDailyChiaKey: dailyCompressed,
    newDailyChiaKey: dailyCompressed,
    oldRecoveryGuardian: oldGuardian,
    newRecoveryGuardian: newGuardian,
    oldRecoveryBlsKey: `0x${'65'.repeat(48)}`,
    newRecoveryBlsKey: `0x${'66'.repeat(48)}`,
    identityLauncherIds: [
      `0x${'01'.repeat(32)}`,
      `0x${'02'.repeat(32)}`,
      `0x${'03'.repeat(32)}`,
    ],
    identitySafes: [
      getAddress(`0x${'04'.repeat(20)}`),
      getAddress(`0x${'05'.repeat(20)}`),
      getAddress(`0x${'06'.repeat(20)}`),
    ],
    authorityLauncherId: `0x${'07'.repeat(32)}`,
    coadminSafe: getAddress(`0x${'08'.repeat(20)}`),
    rootSafe: getAddress(`0x${'09'.repeat(20)}`),
    chiaNetwork: 'testnet11',
    evmChainId: 84532,
    sourceManifestHash: `0x${'0a'.repeat(32)}`,
    nonce: 1,
    expiresAt: 2_000_000_000,
    recoveryKeyRevision: 1,
  };
  const intentHash = hashAdminKeyChangeIntent(intent);
  const caseId = `recovery-${intentHash.slice(2)}`;
  const primaryType =
    actionType === 'ACCEPT'
      ? 'SolslotRecoveryGuardianAccept'
      : 'SolslotRecoveryGuardianVeto';
  const expectedGuardian =
    actionType === 'ACCEPT' ? newGuardian : oldGuardian;
  const typedData = {
    types: {
      EIP712Domain: [
        { name: 'name', type: 'string' },
        { name: 'version', type: 'string' },
        { name: 'chainId', type: 'uint256' },
        { name: 'verifyingContract', type: 'address' },
      ],
      [primaryType]: [{ name: 'intentHash', type: 'bytes32' }],
    },
    primaryType,
    domain: {
      name: 'Solslot Admin Recovery',
      version: '1',
      chainId: 84532,
      verifyingContract: coordinator,
    },
    message: { intentHash },
  };
  return {
    recovery: {
      caseId,
      ceremonyId: `0x${'10'.repeat(32)}`,
      slot: 0,
      kind: 'RECOVERY_KIT',
      state: 'AWAITING_APPROVALS',
      intentHash,
      intent,
      executeAfter: 1_999_000_000,
      expiresAt: intent.expiresAt,
      preparedBy: intent.oldDailyEvmKey,
      chiaTransactionId: null,
      evmTransactionHash: null,
      chiaReceiptHash: null,
      evmReceiptHash: null,
      failureReason: null,
      approvals: [],
      receipts: [],
      chiaSignatures: [],
      evmSubmissions: [],
      createdAt: 1_998_000_000,
      updatedAt: 1_998_000_000,
      approvalsComplete: false,
      delayComplete: false,
      actions: [],
      policy: {
        operationsFrozen: true,
        crossChainConvergenceRequired: true,
        oldKeyVetoUntilExecution: true,
        totalLossBypass: false,
      },
    },
    action: {
      actionId:
        actionType === 'ACCEPT'
          ? 'replacement-acceptance'
          : 'old-recovery-veto',
      title: 'Offline recovery-kit action',
      network: 'Base Sepolia',
      financialEffect: 'No funds move.',
      to: coordinator,
      value: '0',
      data: '0x',
      signer: expectedGuardian,
      execution: 'OFFLINE_RELAY',
      typedData,
      authorizationAction: actionType,
    },
  };
}

function pythonFixtureIntent(): AdminKeyChangeIntentV1 {
  return {
    schemaVersion: 1,
    slot: 0,
    kind: 'ROUTINE',
    oldDailyEvmKey: '0x1111111111111111111111111111111111111111',
    newDailyEvmKey: '0x2222222222222222222222222222222222222222',
    oldDailyChiaKey:
      '0x023333333333333333333333333333333333333333333333333333333333333333',
    newDailyChiaKey:
      '0x034444444444444444444444444444444444444444444444444444444444444444',
    oldRecoveryGuardian: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    newRecoveryGuardian: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    oldRecoveryBlsKey:
      '0x8f336467f057b373bb3c43815a10ec131119d1bf50c14fa3f9ad86c0ec074f920f936a5315a8365a37fee0afa34c32c6',
    newRecoveryBlsKey:
      '0x8f336467f057b373bb3c43815a10ec131119d1bf50c14fa3f9ad86c0ec074f920f936a5315a8365a37fee0afa34c32c6',
    identityLauncherIds: [
      `0x${'01'.repeat(32)}`,
      `0x${'02'.repeat(32)}`,
      `0x${'03'.repeat(32)}`,
    ],
    identitySafes: [
      '0x0404040404040404040404040404040404040404',
      '0x0505050505050505050505050505050505050505',
      '0x0606060606060606060606060606060606060606',
    ],
    authorityLauncherId: `0x${'07'.repeat(32)}`,
    coadminSafe: '0x0808080808080808080808080808080808080808',
    rootSafe: '0x0909090909090909090909090909090909090909',
    chiaNetwork: 'testnet11',
    evmChainId: 84532,
    sourceManifestHash: `0x${'0a'.repeat(32)}`,
    nonce: 1,
    expiresAt: 2_000_000_000,
    recoveryKeyRevision: 1,
  };
}
