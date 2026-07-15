import { environment } from '../../environments/environment';
import {
  clearVerifiedProtocolCoordinates,
  installVerifiedProtocolCoordinates,
  protocolCoordinateFromEnvironment,
  resolveProtocolCoordinate,
} from './protocol-coordinate-guard';

const originalStrict = environment.strictProtocolCoordinatePins;

describe('protocol coordinate guard', () => {
  afterEach(() => {
    environment.strictProtocolCoordinatePins = originalStrict;
    clearVerifiedProtocolCoordinates();
  });

  it('allows artifact fallback when strict pins are disabled', () => {
    environment.strictProtocolCoordinatePins = false;

    expect(
      resolveProtocolCoordinate({
        coordinateName: 'pool launcher id',
        pinned: '',
        candidate: '0x' + '11'.repeat(32),
        candidateLabel: 'offer artifact',
        errorPrefix: 'Offer acceptance',
      }),
    ).toBe('0x' + '11'.repeat(32));
  });

  it('rejects candidate fallback when no signed artifact is installed', () => {
    environment.strictProtocolCoordinatePins = true;

    expect(() =>
      resolveProtocolCoordinate({
        coordinateName: 'pool launcher id',
        pinned: '',
        candidate: '0x' + '11'.repeat(32),
        candidateLabel: 'offer artifact',
        errorPrefix: 'Offer acceptance',
      }),
    ).toThrowError(/pool launcher id is not present in the verified signed artifact/);
  });

  it('uses only coordinates installed by the verified artifact service', () => {
    environment.strictProtocolCoordinatePins = true;
    const pool = '0x' + '22'.repeat(32);
    installVerifiedProtocolCoordinates({ poolLauncherId: pool });

    expect(protocolCoordinateFromEnvironment('poolLauncherId')).toBe(pool);
    expect(
      resolveProtocolCoordinate({
        coordinateName: 'pool launcher id',
        pinned: protocolCoordinateFromEnvironment('poolLauncherId'),
        candidate: pool,
        candidateLabel: 'offer artifact',
        errorPrefix: 'Offer acceptance',
      }),
    ).toBe(pool);
  });

  it('rejects an offer coordinate that differs from the verified artifact', () => {
    const pool = '0x' + '22'.repeat(32);
    installVerifiedProtocolCoordinates({ poolLauncherId: pool });

    expect(() =>
      resolveProtocolCoordinate({
        coordinateName: 'pool launcher id',
        pinned: protocolCoordinateFromEnvironment('poolLauncherId'),
        candidate: '0x' + '33'.repeat(32),
        candidateLabel: 'offer artifact',
        errorPrefix: 'Offer acceptance',
      }),
    ).toThrowError(/does not match pinned protocol coordinate/);
  });
});
