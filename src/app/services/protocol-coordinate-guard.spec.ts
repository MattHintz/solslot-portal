import { environment } from '../../environments/environment';
import { resolveProtocolCoordinate } from './protocol-coordinate-guard';

const originalStrict = environment.strictProtocolCoordinatePins;

describe('protocol coordinate guard', () => {
  afterEach(() => {
    environment.strictProtocolCoordinatePins = originalStrict;
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

  it('rejects artifact fallback when strict pins are enabled', () => {
    environment.strictProtocolCoordinatePins = true;

    expect(() =>
      resolveProtocolCoordinate({
        coordinateName: 'pool launcher id',
        pinned: '',
        candidate: '0x' + '11'.repeat(32),
        candidateLabel: 'offer artifact',
        errorPrefix: 'Offer acceptance',
      }),
    ).toThrowError(/pool launcher id is not pinned in this build/);
  });
});
