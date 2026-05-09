import { mojoAmountToSafeNumber, parseMojoAmount } from './mojo-amount';

describe('mojo amount helpers', () => {
  it('converts safe mojo amounts without rounding', () => {
    expect(mojoAmountToSafeNumber(1n)).toBe(1);
    expect(mojoAmountToSafeNumber(Number.MAX_SAFE_INTEGER)).toBe(
      Number.MAX_SAFE_INTEGER,
    );
    expect(parseMojoAmount(Number.MAX_SAFE_INTEGER)).toBe(
      BigInt(Number.MAX_SAFE_INTEGER),
    );
  });

  it('rejects bigint amounts above JavaScript safe integer range', () => {
    expect(() => mojoAmountToSafeNumber(BigInt(Number.MAX_SAFE_INTEGER) + 1n))
      .toThrowError(/safe integer range/);
  });

  it('rejects unsafe number amounts before BigInt conversion can round them', () => {
    expect(() => parseMojoAmount(Number.MAX_SAFE_INTEGER + 1)).toThrowError(
      /safe integer mojo amount/,
    );
  });

  it('rejects negative mojo amounts', () => {
    expect(() => mojoAmountToSafeNumber(-1n)).toThrowError(/non-negative/);
    expect(() => parseMojoAmount(-1)).toThrowError(/non-negative/);
  });
});
