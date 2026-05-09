import {
  OfferDetail,
  OfferEligibilityState,
  classifyOfferEligibility,
} from './offer-domain';

const VAULT_LAUNCHER_ID = '0x' + '11'.repeat(32);
const OTHER_VAULT_LAUNCHER_ID = '0x' + '22'.repeat(32);
const DEED_LAUNCHER_ID = '0x' + '33'.repeat(32);

function offer(overrides: Partial<OfferDetail> = {}): OfferDetail {
  return {
    id: 'offer-1',
    title: 'Test deed offer',
    deedLauncherId: DEED_LAUNCHER_ID,
    state: 'OP:OFFER_READY',
    terms: {
      deedLauncherId: DEED_LAUNCHER_ID,
      tokenAmount: 100,
      priceMojos: 1_000_000,
      acceptedAsset: 'xch',
      expiresAt: null,
    },
    artifact: {
      artifactId: 'artifact-1',
      deedLauncherId: DEED_LAUNCHER_ID,
      artifactHash: '0x' + '44'.repeat(32),
      rawOffer: '0x' + '55'.repeat(32),
    },
    gatingPolicy: {
      requiresZkPassport: true,
    },
    ...overrides,
  };
}

describe('offer domain eligibility', () => {
  it('classifies unavailable offers before wallet or vault state', () => {
    expect(classifyOfferEligibility(null, { walletConnected: false })).toEqual({
      state: 'EM:OFFER_UNAVAILABLE',
      canAccept: false,
      requiredAction: 'none',
      reason: 'Offer is not available.',
    });
  });

  it('classifies unconnected wallets', () => {
    expect(classifyOfferEligibility(offer(), { walletConnected: false }).state).toBe('NM:UNCONNECTED');
    expect(classifyOfferEligibility(offer(), { walletConnected: false }).requiredAction).toBe('connect_wallet');
  });

  it('classifies missing vault separately from missing zkPassport proof', () => {
    const withoutVault = classifyOfferEligibility(offer(), { walletConnected: true });
    const withoutProof = classifyOfferEligibility(offer(), {
      walletConnected: true,
      vaultLauncherId: VAULT_LAUNCHER_ID,
      vaultConfirmed: true,
    });
    expect(withoutVault.state).toBe('NM:NO_VAULT');
    expect(withoutVault.requiredAction).toBe('create_vault');
    expect(withoutProof.state).toBe('NM:ZK_REQUIRED');
    expect(withoutProof.requiredAction).toBe('enroll_zkpassport');
  });

  it('classifies pending vault confirmation before zkPassport proof checks', () => {
    const result = classifyOfferEligibility(offer(), {
      walletConnected: true,
      vaultLauncherId: VAULT_LAUNCHER_ID,
      vaultConfirmed: false,
    });
    expect(result.state).toBe('NM:VAULT_PENDING');
    expect(result.requiredAction).toBe('wait_for_vault_confirmation');
  });

  it('classifies stale chain state before accepting', () => {
    const result = classifyOfferEligibility(offer(), {
      walletConnected: true,
      vaultLauncherId: VAULT_LAUNCHER_ID,
      vaultConfirmed: true,
      zkPassportProofConfirmed: true,
      chainStateFresh: false,
    });
    expect(result.state).toBe('EM:CHAIN_STALE');
    expect(result.requiredAction).toBe('refresh_chain_state');
  });

  it('classifies a confirmed vault with stored zkPassport proof as eligible', () => {
    const result = classifyOfferEligibility(offer(), {
      walletConnected: true,
      vaultLauncherId: VAULT_LAUNCHER_ID,
      vaultConfirmed: true,
      zkPassportProofConfirmed: true,
      chainStateFresh: true,
    });
    expect(result).toEqual({
      state: 'EM:ELIGIBLE',
      canAccept: true,
      requiredAction: 'none',
      reason: 'Vault is eligible to accept this offer.',
    });
  });

  it('does not require zkPassport proof for ungated offers', () => {
    const result = classifyOfferEligibility(
      offer({ gatingPolicy: { requiresZkPassport: false } }),
      {
        walletConnected: true,
        vaultLauncherId: VAULT_LAUNCHER_ID,
        vaultConfirmed: true,
        chainStateFresh: true,
      },
    );
    expect(result.state).toBe('EM:ELIGIBLE');
  });

  it('classifies offers without artifacts as unavailable', () => {
    const result = classifyOfferEligibility(offer({ artifact: null }), {
      walletConnected: true,
      vaultLauncherId: VAULT_LAUNCHER_ID,
      vaultConfirmed: true,
      zkPassportProofConfirmed: true,
    });
    expect(result.state).toBe('EM:OFFER_UNAVAILABLE');
    expect(result.reason).toBe('Offer artifact is not available.');
  });

  it('classifies expired offers as unavailable', () => {
    const result = classifyOfferEligibility(offer({ terms: { ...offer().terms, expiresAt: 100 } }), {
      walletConnected: true,
      vaultLauncherId: VAULT_LAUNCHER_ID,
      vaultConfirmed: true,
      zkPassportProofConfirmed: true,
      currentTimestamp: 101,
    });
    expect(result.state).toBe('EM:OFFER_UNAVAILABLE');
    expect(result.reason).toBe('Offer has expired.');
  });

  it('does not expire offers without a current timestamp', () => {
    const result = classifyOfferEligibility(offer({ terms: { ...offer().terms, expiresAt: 100 } }), {
      walletConnected: true,
      vaultLauncherId: VAULT_LAUNCHER_ID,
      vaultConfirmed: true,
      zkPassportProofConfirmed: true,
    });
    expect(result.state).toBe('EM:ELIGIBLE');
  });

  it('classifies vault allowlist misses as not eligible', () => {
    const result = classifyOfferEligibility(
      offer({
        gatingPolicy: {
          requiresZkPassport: true,
          allowedVaultLauncherIds: [OTHER_VAULT_LAUNCHER_ID],
        },
      }),
      {
        walletConnected: true,
        vaultLauncherId: VAULT_LAUNCHER_ID,
        vaultConfirmed: true,
        zkPassportProofConfirmed: true,
      },
    );
    expect(result.state).toBe('EM:NOT_ELIGIBLE');
  });

  it('matches vault allowlist entries case-insensitively and with bare hex input', () => {
    const result = classifyOfferEligibility(
      offer({
        gatingPolicy: {
          requiresZkPassport: true,
          allowedVaultLauncherIds: [VAULT_LAUNCHER_ID.slice(2).toUpperCase()],
        },
      }),
      {
        walletConnected: true,
        vaultLauncherId: VAULT_LAUNCHER_ID,
        vaultConfirmed: true,
        zkPassportProofConfirmed: true,
      },
    );
    expect(result.state).toBe('EM:ELIGIBLE');
  });

  it('keeps eligibility states constrained to the core-up notation', () => {
    const states: OfferEligibilityState[] = [
      'NM:UNCONNECTED',
      'NM:NO_VAULT',
      'NM:VAULT_PENDING',
      'NM:ZK_REQUIRED',
      'EM:CHAIN_STALE',
      'EM:OFFER_UNAVAILABLE',
      'EM:NOT_ELIGIBLE',
      'EM:ELIGIBLE',
    ];
    expect(states.every((state) => /^(NM|EM):[A-Z_]+$/.test(state))).toBeTrue();
  });
});
