import Decimal from 'decimal.js';

/**
 * YT Coin Canonical Integer Sub-Unit Engine
 * - Final Max Supply Cap: 100,000,000 YT
 * - Precision: 1 YT = 1,000 integer sub-units (BIGINT)
 * - Smallest Unit: 1 sub-unit = 0.001 YT
 * - Storage, ledger math, journal entries, and transfers inside yt_coin use BIGINT integer units only.
 */

export const YT_SUBUNITS_PER_YT = 1000;
export const YT_MAX_DECIMALS = 3;
export const YT_MAX_SUPPLY_YT = 100_000_000;
export const YT_MAX_SUPPLY_UNITS = 100_000_000_000; // 100M * 1000

export const YT_DEFAULT_DAILY_REWARD_UNITS = 500; // 0.5 YT
export const YT_DEFAULT_AD_CLICK_REWARD_UNITS = 10; // 0.01 YT
export const YT_DEFAULT_AD_VIEW_REWARD_UNITS = 10; // 0.01 YT
export const YT_DEFAULT_TAP_REWARD_UNITS = 10; // 0.01 YT

export type YtJournalSide = 'debit' | 'credit';

export interface YtJournalEntryDraft {
  accountScope: 'treasury' | 'user' | 'control';
  accountKey: string;
  userId?: string | null;
  treasuryKey?: string | null;
  side: YtJournalSide;
  amountUnits: number;
  memo?: string;
}

export interface YtTokenomicsAllocationSpec {
  key: string;
  labelAr: string;
  allocationYt: number;
  allocationUnits: number;
  percentage: number;
  locked: boolean;
  independentAccount: boolean;
  notesAr: string;
}

export const YT_TOKENOMICS_ALLOCATIONS: YtTokenomicsAllocationSpec[] = [
  {
    key: 'YT-USER-REWARDS',
    labelAr: 'مكافآت المستخدمين',
    allocationYt: 30_000_000,
    allocationUnits: 30_000_000_000,
    percentage: 30,
    locked: false,
    independentAccount: false,
    notesAr: 'مخصص لمكافآت الدخول اليومي، الإعلانات المؤهلة، ومكافآت النشاط',
  },
  {
    key: 'YT-TEAM-VESTING',
    labelAr: 'حصة الفريق',
    allocationYt: 10_000_000,
    allocationUnits: 10_000_000_000,
    percentage: 10,
    locked: true,
    independentAccount: true,
    notesAr: 'مقفلة ومجدولة للاستحقاق الزمني ولا تُحسب ضمن المتداول قبل الإفراج والتوزيع',
  },
  {
    key: 'YT-MARKET-LIQUIDITY',
    labelAr: 'سيولة السوق',
    allocationYt: 15_000_000,
    allocationUnits: 15_000_000_000,
    percentage: 15,
    locked: false,
    independentAccount: true,
    notesAr: 'محفوظة في حساب مستقل لسيولة السوق ولا تعتبر متداولة قبل الاعتماد والتوزيع',
  },
  {
    key: 'YT-GENERAL-CIRCULATION',
    labelAr: 'التداول والتوزيع العام',
    allocationYt: 45_000_000,
    allocationUnits: 45_000_000_000,
    percentage: 45,
    locked: false,
    independentAccount: true,
    notesAr: 'مخصصة للتداول والتوزيع العام ولا تُحسب إصداراً فعلياً قبل اعتمادها وتوزيعها',
  },
];

export function unitsToYt(units: number | string | bigint | null | undefined): number {
  if (units === null || units === undefined || units === '') return 0;
  try {
    const dec = new Decimal(typeof units === 'bigint' ? units.toString() : String(units).trim());
    if (!dec.isFinite()) return 0;
    return dec.div(YT_SUBUNITS_PER_YT).toDecimalPlaces(YT_MAX_DECIMALS, Decimal.ROUND_HALF_UP).toNumber();
  } catch {
    return 0;
  }
}

export function ytToUnitsStrict(
  input: unknown,
  options: {
    allowZero?: boolean;
    fieldLabel?: string;
    minUnits?: number;
    maxUnits?: number;
  } = {}
): number {
  const {
    allowZero = false,
    fieldLabel = 'كمية YT Coin',
    minUnits = allowZero ? 0 : 1,
    maxUnits = YT_MAX_SUPPLY_UNITS,
  } = options;

  if (input === null || input === undefined || String(input).trim() === '') {
    throw new Error(`${fieldLabel} مطلوبة.`);
  }

  let dec: Decimal;
  try {
    dec = new Decimal(String(input).trim().replace(/,/g, ''));
  } catch {
    throw new Error(`صيغة ${fieldLabel} غير صالحة.`);
  }

  if (!dec.isFinite()) {
    throw new Error(`${fieldLabel} غير صالحة.`);
  }
  if (dec.isNegative()) {
    throw new Error(`${fieldLabel} لا يمكن أن تكون سالبة.`);
  }
  if (!allowZero && dec.isZero()) {
    throw new Error(`${fieldLabel} يجب أن تكون أكبر من صفر.`);
  }

  const fixedCheck = dec.toDecimalPlaces(YT_MAX_DECIMALS, Decimal.ROUND_HALF_UP);
  if (!dec.equals(fixedCheck)) {
    throw new Error(`${fieldLabel} تقبل حتى 3 خانات عشرية فقط (أصغر وحدة 0.001 YT).`);
  }

  const unitsDec = fixedCheck.times(YT_SUBUNITS_PER_YT);
  if (!unitsDec.isInteger()) {
    throw new Error(`${fieldLabel} يجب أن تكون من مضاعفات 0.001 YT.`);
  }

  const units = unitsDec.toNumber();
  if (!Number.isSafeInteger(units) || units < minUnits || units > maxUnits) {
    throw new Error(`${fieldLabel} خارج النطاق المسموح.`);
  }

  return units;
}

/**
 * Validates that a set of YT Coin journal entries is strictly balanced in integer sub-units (BIGINT).
 * Throws `'YT Coin journal transaction is not balanced'` on any mismatch, single-sided entry, or invalid sub-unit.
 */
export function assertBalancedYtJournalEntries(entries: YtJournalEntryDraft[]): {
  totalDebitUnits: number;
  totalCreditUnits: number;
  lineCount: number;
} {
  if (!Array.isArray(entries) || entries.length < 2) {
    throw new Error('YT Coin journal transaction is not balanced');
  }

  let totalDebitUnits = 0;
  let totalCreditUnits = 0;

  for (const entry of entries) {
    if (!entry || (entry.side !== 'debit' && entry.side !== 'credit')) {
      throw new Error('YT Coin journal transaction is not balanced');
    }
    if (!Number.isSafeInteger(entry.amountUnits) || entry.amountUnits <= 0) {
      throw new Error('YT Coin journal transaction is not balanced');
    }
    if (entry.side === 'debit') {
      totalDebitUnits += entry.amountUnits;
    } else {
      totalCreditUnits += entry.amountUnits;
    }
    if (!Number.isSafeInteger(totalDebitUnits) || !Number.isSafeInteger(totalCreditUnits)) {
      throw new Error('YT Coin journal transaction amount overflow.');
    }
  }

  if (totalDebitUnits <= 0 || totalCreditUnits <= 0 || totalDebitUnits !== totalCreditUnits) {
    throw new Error('YT Coin journal transaction is not balanced');
  }

  return {
    totalDebitUnits,
    totalCreditUnits,
    lineCount: entries.length,
  };
}

/**
 * Formats a YT numeric value naturally with no trailing zeros and max 3 decimal places.
 * Examples:
 * - 500 units -> "0.5"
 * - 10 units -> "0.01"
 * - 1 unit -> "0.001"
 * - 10000 units -> "10"
 * - 100000000 YT -> "100,000,000"
 */
export function formatYt(value: number | string | null | undefined, maxDecimals = YT_MAX_DECIMALS): string {
  if (value === null || value === undefined || value === '') return '0';
  let dec: Decimal;
  try {
    dec = new Decimal(String(value).trim());
  } catch {
    return '0';
  }
  if (!dec.isFinite()) return '0';

  const clampedDecimals = Math.min(YT_MAX_DECIMALS, Math.max(0, maxDecimals));
  const rounded = dec.toDecimalPlaces(clampedDecimals, Decimal.ROUND_HALF_UP);
  const fixed = rounded.toFixed(clampedDecimals);
  const neg = fixed.startsWith('-');
  const unsigned = neg ? fixed.slice(1) : fixed;
  const [intPart, fracRaw = ''] = unsigned.split('.');
  const fracTrimmed = fracRaw.replace(/0+$/, '');
  const groupedInt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const isZero = /^0+$/.test(intPart) && fracTrimmed.length === 0;
  return `${neg && !isZero ? '-' : ''}${groupedInt}${fracTrimmed ? `.${fracTrimmed}` : ''}`;
}

export function formatYtUnits(
  units: number | string | bigint | null | undefined,
  maxDecimals = YT_MAX_DECIMALS
): string {
  if (units === null || units === undefined || units === '') return '0';
  try {
    const dec = new Decimal(typeof units === 'bigint' ? units.toString() : String(units).trim());
    if (!dec.isFinite()) return '0';
    return formatYt(dec.div(YT_SUBUNITS_PER_YT).toFixed(YT_MAX_DECIMALS), maxDecimals);
  } catch {
    return '0';
  }
}

export function ytToIntegerParts(value: number | string | null | undefined): number {
  if (value === null || value === undefined || value === '') return 0;
  try {
    const dec = new Decimal(String(value).trim());
    if (!dec.isFinite()) return 0;
    return dec.times(YT_SUBUNITS_PER_YT).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
  } catch {
    return 0;
  }
}

export function formatPartsLabel(parts: number | string | bigint | null | undefined): string {
  if (parts === null || parts === undefined || parts === '') return '0 جزء';
  try {
    const dec = new Decimal(typeof parts === 'bigint' ? parts.toString() : String(parts).trim());
    if (!dec.isFinite()) return '0 جزء';
    const intVal = Math.trunc(dec.toNumber());
    const grouped = Math.abs(intVal).toLocaleString('en-US');
    const sign = intVal < 0 ? '-' : '';
    const unitWord = Math.abs(intVal) >= 3 && Math.abs(intVal) <= 10 ? 'أجزاء' : 'جزء';
    return `${sign}${grouped} ${unitWord}`;
  } catch {
    return '0 جزء';
  }
}
