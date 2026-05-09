export function mojoAmountToSafeNumber(amount: number | bigint, fieldName = 'amount'): number {
  if (typeof amount === 'number') {
    if (!Number.isSafeInteger(amount) || amount < 0) {
      throw new Error(`${fieldName} must be a non-negative safe integer mojo amount`);
    }
    return amount;
  }
  const value = amount;
  if (value < 0n) {
    throw new Error(`${fieldName} must be non-negative mojos`);
  }
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${fieldName} exceeds JavaScript safe integer range`);
  }
  const asNumber = Number(value);
  if (!Number.isSafeInteger(asNumber)) {
    throw new Error(`${fieldName} must be a safe integer mojo amount`);
  }
  return asNumber;
}

export function parseMojoAmount(amount: number | bigint, fieldName = 'amount'): bigint {
  if (typeof amount === 'bigint') {
    if (amount < 0n) {
      throw new Error(`${fieldName} must be non-negative mojos`);
    }
    return amount;
  }
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new Error(`${fieldName} must be a non-negative safe integer mojo amount`);
  }
  return BigInt(amount);
}
