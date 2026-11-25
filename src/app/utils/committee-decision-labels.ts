import valuation from '../../environments/eastmoreland-testnet-valuation.json';
import { GovernedBill, governedBillLabel } from './generation-governed-bill';

const chicagoClock = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago', month: 'short', day: 'numeric', year: 'numeric',
  hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
});

export function committeeDate(seconds: number): string {
  const date = new Date(seconds * 1000);
  return Number.isFinite(date.getTime()) ? chicagoClock.format(date) : `${seconds} chain seconds`;
}

export function committeeDollars(micros: number): string {
  const amount = BigInt(micros);
  const dollars = (amount / 1_000_000n).toLocaleString('en-US');
  const fraction = (amount % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  return '$' + dollars + (fraction ? '.' + fraction.padEnd(2, '0') : '');
}

export function isEastmorelandValuation(generation: string, bill: GovernedBill): boolean {
  const record = bill.statutes;
  return generation === valuation.generationId && record?.recordKind === 'COLLECTION' &&
    record.launcherId === valuation.statutes.launcherId && record.key === valuation.statutes.key;
}

export function committeeProposalTitle(generation: string, bill: GovernedBill): string {
  if (bill.statutes?.recordKind === 'COLLECTION') {
    const property = isEastmorelandValuation(generation, bill) ? '127 Eastmoreland St' : 'Collection valuation';
    return `${property} · ${committeeDollars(Number(bill.statutes.record[1]))}`;
  }
  if (bill.statutes) {
    return { ORACLE: 'Update the asset price', ROUTE: 'Update the payment route',
      LIQUIDITY: 'Update the liquidity venue' }[bill.statutes.recordKind];
  }
  if (bill.testMint) return `Create ${bill.testMint.deedCount.toLocaleString('en-US')} test SmartDeeds`;
  const label = governedBillLabel(bill.kind);
  return label.charAt(0).toUpperCase() + label.slice(1);
}
