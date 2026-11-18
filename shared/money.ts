/**
 * Kasb Yemen - Deterministic 6-Decimal Fixed-Point Monetary Engine (BigInt Micro-Units)
 * Scale: 1 YER = 1,000,000 micro-units (NUMERIC(30,6))
 * Zero floating-point drift, zero Math.round/Math.ceil/Math.floor on money.
 */

export const MONEY_DECIMALS = 6;
export const MONEY_SCALE = 1_000_000n;

export type ParsedMoney = {
  micros: bigint;
  numericString: string;
  numberValue: number;
  valueOf(): number;
  [Symbol.toPrimitive](hint: string): number;
} & number;

export interface CampaignFeePolicy {
  defaultPercentage: number;
  defaultFeePercentage?: number;
  minFeeUnits?: number;
  categoryFees?: Record<string, number>;
}

export const DEFAULT_CAMPAIGN_FEE_POLICY: CampaignFeePolicy = {
  defaultPercentage: 20,
  minFeeUnits: 0,
  categoryFees: {},
};

/**
 * Normalizes a numeric/string input into a clean decimal string and validates
 * against invalid syntax, NaN, Infinity, negative values (unless allowed),
 * and fractional precision > 6 digits.
 */
export function parseMoneyStrict(
  input: unknown,
  options: {
    allowNegative?: boolean;
    allowZero?: boolean;
    fieldLabel?: string;
    maxDecimals?: number;
  } = {}
): ParsedMoney {
  const {
    allowNegative = false,
    allowZero = false,
    fieldLabel = 'المبلغ المالي',
    maxDecimals = MONEY_DECIMALS,
  } = options;

  if (input === null || input === undefined) {
    throw new Error(`${fieldLabel} مطلوب.`);
  }

  let raw = '';
  if (typeof input === 'bigint') {
    raw = input.toString();
  } else if (typeof input === 'number') {
    if (!Number.isFinite(input)) {
      throw new Error(`${fieldLabel} غير صالح.`);
    }
    // Avoid binary float noise like 0.1 + 0.2 = 0.30000000000000004 while preserving real up-to-6dp decimals
    raw = Number.isInteger(input) ? String(input) : input.toFixed(10).replace(/\.?0+$/, '');
  } else {
    raw = String(input).trim().replace(/,/g, '');
  }

  if (!raw) {
    throw new Error(`${fieldLabel} مطلوب.`);
  }

  // Handle scientific notation if somehow passed cleanly (e.g. 1e-6)
  if (/^[+-]?\d+(?:\.\d+)?[eE][+-]?\d+$/.test(raw)) {
    const asNum = Number(raw);
    if (!Number.isFinite(asNum)) {
      throw new Error(`${fieldLabel} غير صالح.`);
    }
    raw = asNum.toFixed(10).replace(/\.?0+$/, '');
  }

  const match = raw.match(/^([+-])?(\d+)(?:\.(\d+))?$/);
  if (!match) {
    throw new Error(`صيغة ${fieldLabel} غير صالحة.`);
  }

  const sign = match[1] === '-' ? -1n : 1n;
  const intPartStr = match[2];
  const fracRaw = match[3] || '';
  const fracTrimmed = fracRaw.replace(/0+$/, '');

  if (fracTrimmed.length > maxDecimals) {
    throw new Error(`${fieldLabel} يقبل بحد أقصى ${maxDecimals} منازل عشرية.`);
  }

  const fracPadded = fracTrimmed.padEnd(MONEY_DECIMALS, '0');
  const absMicros = BigInt(intPartStr) * MONEY_SCALE + BigInt(fracPadded || '0');
  const micros = sign * absMicros;

  if (!allowNegative && micros < 0n) {
    throw new Error(`${fieldLabel} لا يمكن أن يكون سالباً.`);
  }
  if (!allowZero && micros === 0n) {
    throw new Error(`${fieldLabel} يجب أن يكون أكبر من صفر.`);
  }

  const numericString = fromMicrosFixed(micros);
  const numberValue = Number(fromMicros(micros));
  return {
    micros,
    numericString,
    numberValue,
    valueOf() { return numberValue; },
    [Symbol.toPrimitive]() { return numberValue; },
  } as unknown as ParsedMoney;
}

/**
 * Permissive conversion for existing DB read values -> exact BigInt micro-units.
 */
export function toMicros(input: string | number | bigint | undefined | null): bigint {
  if (input === null || input === undefined || input === '') return 0n;
  if (typeof input === 'bigint') return input * MONEY_SCALE;
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return 0n;
    const str = Number.isInteger(input) ? String(input) : input.toFixed(MONEY_DECIMALS);
    return toMicrosFromCleanString(str);
  }
  const str = String(input).trim().replace(/,/g, '');
  if (!str) return 0n;
  if (/^[+-]?\d+(?:\.\d+)?[eE][+-]?\d+$/.test(str)) {
    const asNum = Number(str);
    return Number.isFinite(asNum) ? toMicros(asNum) : 0n;
  }
  return toMicrosFromCleanString(str);
}

function toMicrosFromCleanString(str: string): bigint {
  const match = str.match(/^([+-])?(\d+)(?:\.(\d+))?$/);
  if (!match) return 0n;
  const sign = match[1] === '-' ? -1n : 1n;
  const intPart = BigInt(match[2]);
  const fracDigits = (match[3] || '').slice(0, MONEY_DECIMALS).padEnd(MONEY_DECIMALS, '0');
  // Half-up round if string came from >6 digits
  let absMicros = intPart * MONEY_SCALE + BigInt(fracDigits || '0');
  if ((match[3] || '').length > MONEY_DECIMALS && Number((match[3] || '')[MONEY_DECIMALS]) >= 5) {
    absMicros += 1n;
  }
  return sign * absMicros;
}

/**
 * Always emits exact 6 fractional digits e.g. "15.000000" or "0.450000" for SQL NUMERIC(30,6).
 */
export function fromMicrosFixed(micros: bigint): string {
  const neg = micros < 0n;
  const abs = neg ? -micros : micros;
  const intPart = abs / MONEY_SCALE;
  const fracPart = (abs % MONEY_SCALE).toString().padStart(MONEY_DECIMALS, '0');
  return `${neg ? '-' : ''}${intPart.toString()}.${fracPart}`;
}

/**
 * Formats micro-units trimming trailing zeros cleanly:
 * 15000000n -> "15", 450000n -> "0.45", 300n -> "0.0003"
 */
export function fromMicros(micros: bigint): string {
  const neg = micros < 0n;
  const abs = neg ? -micros : micros;
  const intPart = abs / MONEY_SCALE;
  const fracRaw = (abs % MONEY_SCALE).toString().padStart(MONEY_DECIMALS, '0').replace(/0+$/, '');
  const base = fracRaw.length > 0 ? `${intPart.toString()}.${fracRaw}` : intPart.toString();
  return neg && abs > 0n ? `-${base}` : base;
}

export function microsToNumber(micros: bigint): number {
  return Number(fromMicros(micros));
}

export function addMoney(a: number | string | bigint | undefined | null, b: number | string | bigint | undefined | null): number {
  return microsToNumber(toMicros(a) + toMicros(b));
}

export function subMoney(a: number | string | bigint | undefined | null, b: number | string | bigint | undefined | null): number {
  return microsToNumber(toMicros(a) - toMicros(b));
}

export function sumMoney(values: Array<number | string | bigint | undefined | null>): number {
  let acc = 0n;
  for (const v of values) acc += toMicros(v);
  return microsToNumber(acc);
}

/**
 * Exact half-up BigInt division: round(numerator / denominator)
 */
export function roundHalfUpMicros(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new Error('Division by zero in monetary calculation.');
  const neg = (numerator < 0n) !== (denominator < 0n);
  const absNum = numerator < 0n ? -numerator : numerator;
  const absDen = denominator < 0n ? -denominator : denominator;
  const q = absNum / absDen;
  const r = absNum % absDen;
  const rounded = r * 2n >= absDen ? q + 1n : q;
  return neg && rounded > 0n ? -rounded : rounded;
}

/**
 * Exact 6-decimal percentage computation: ROUND(amount * percentage / 100, 6)
 */
export function calcPercentageMicros(amountMicros: bigint, percentage: number | string): bigint {
  const pctParsed = parseMoneyStrict(percentage, {
    allowNegative: false,
    allowZero: true,
    fieldLabel: 'النسبة المئوية',
  });
  return roundHalfUpMicros(amountMicros * pctParsed.micros, 100n * MONEY_SCALE);
}

/**
 * Wallet P2P Transfer breakdown:
 * Exact 3% fee = ROUND(amount * 0.03, 6) with NO minimum 1-unit floor.
 * Examples:
 * - 15 -> fee 0.45, net 14.55
 * - 0.01 -> fee 0.0003, net 0.0097
 */
export function calcWalletTransferBreakdown(amountInput: unknown): {
  amount: number;
  amountMicros: bigint;
  fee: number;
  feeMicros: bigint;
  net: number;
  netMicros: bigint;
} {
  const parsed = parseMoneyStrict(amountInput, {
    allowNegative: false,
    allowZero: false,
    fieldLabel: 'مبلغ التحويل',
  });
  const feeMicros = roundHalfUpMicros(parsed.micros * 3n, 100n);
  const netMicros = parsed.micros - feeMicros;
  return {
    amount: parsed.numberValue,
    amountMicros: parsed.micros,
    fee: microsToNumber(feeMicros),
    feeMicros,
    net: microsToNumber(netMicros),
    netMicros,
  };
}

/**
 * Normalizes and validates campaign fee policy JSON.
 */
export function normalizeCampaignFeePolicy(
  policy: Partial<CampaignFeePolicy> | null | undefined,
  fallbackPercentage = 20
): CampaignFeePolicy {
  const rawDefault = Number(policy?.defaultPercentage ?? fallbackPercentage);
  const defaultPercentage = Number.isFinite(rawDefault) && rawDefault >= 0 && rawDefault <= 100 ? rawDefault : 20;

  const rawMin = Number(policy?.minFeeUnits ?? 0);
  const minFeeUnits = Number.isFinite(rawMin) && rawMin >= 0 ? microsToNumber(toMicros(rawMin)) : 0;

  const categoryFees: Record<string, number> = {};
  if (policy?.categoryFees && typeof policy.categoryFees === 'object') {
    for (const [k, v] of Object.entries(policy.categoryFees)) {
      const cleanKey = String(k || '').trim();
      const numVal = Number(v);
      if (cleanKey && Number.isFinite(numVal) && numVal >= 0 && numVal <= 100) {
        categoryFees[cleanKey] = numVal;
      }
    }
  }

  return {
    defaultPercentage,
    minFeeUnits,
    categoryFees,
  };
}

/**
 * Computes campaign budget, platform service fee (with optional category override & min fee floor),
 * and total required using exact BigInt 6-decimal arithmetic.
 */
export function calculateCampaignFeePolicyCosts(params: {
  rewardUnits: unknown;
  slots: unknown;
  category?: string | null;
  policy?: Partial<CampaignFeePolicy> | null;
  fallbackFeePercentage?: number;
}): {
  rewardUnits: number;
  slots: number;
  budgetUnits: number;
  feePercentage: number;
  effectiveFeePercentage: number;
  minFeeApplied: boolean;
  feeUnits: number;
  totalUnits: number;
  budgetMicros: bigint;
  feeMicros: bigint;
  totalMicros: bigint;
  appliedPolicySnapshot: CampaignFeePolicy;
  policySnapshot: CampaignFeePolicy;
} {
  const parsedReward = parseMoneyStrict(params.rewardUnits, {
    allowNegative: false,
    allowZero: false,
    fieldLabel: 'سعر المهمة',
  });
  const slotsNum = Number(params.slots);
  if (!Number.isInteger(slotsNum) || slotsNum <= 0) {
    throw new Error('عدد المهمات المطلوبة يجب أن يكون عدداً صحيحاً أكبر من صفر.');
  }

  const normalizedPolicy = normalizeCampaignFeePolicy(params.policy, params.fallbackFeePercentage ?? 20);
  const categoryKey = String(params.category || '').trim();
  const appliedPercentage =
    categoryKey && normalizedPolicy.categoryFees && normalizedPolicy.categoryFees[categoryKey] !== undefined
      ? normalizedPolicy.categoryFees[categoryKey]
      : normalizedPolicy.defaultPercentage;

  const budgetMicros = parsedReward.micros * BigInt(slotsNum);
  const rawFeeMicros = calcPercentageMicros(budgetMicros, appliedPercentage);
  const minFeeMicros = toMicros(normalizedPolicy.minFeeUnits || 0);

  const minFeeApplied = minFeeMicros > 0n && rawFeeMicros < minFeeMicros;
  const feeMicros = minFeeApplied ? minFeeMicros : rawFeeMicros;
  const totalMicros = budgetMicros + feeMicros;

  return {
    rewardUnits: parsedReward.numberValue,
    slots: slotsNum,
    budgetUnits: microsToNumber(budgetMicros),
    feePercentage: appliedPercentage,
    effectiveFeePercentage: appliedPercentage,
    minFeeApplied,
    feeUnits: microsToNumber(feeMicros),
    totalUnits: microsToNumber(totalMicros),
    budgetMicros,
    feeMicros,
    totalMicros,
    appliedPolicySnapshot: {
      defaultPercentage: normalizedPolicy.defaultPercentage,
      minFeeUnits: normalizedPolicy.minFeeUnits || 0,
      categoryFees: normalizedPolicy.categoryFees || {},
    },
    policySnapshot: {
      defaultPercentage: normalizedPolicy.defaultPercentage,
      minFeeUnits: normalizedPolicy.minFeeUnits || 0,
      categoryFees: normalizedPolicy.categoryFees || {},
    },
  };
}

/**
 * Referral 5% recurring share strictly on platform net profit.
 * Returns 0 if net profit <= 0.
 */
export function calculateReferralNetProfitShare(netProfitInput: unknown): {
  netProfit: number;
  shareUnits: number;
  shareMicros: bigint;
} {
  const parsed = parseMoneyStrict(netProfitInput, {
    allowNegative: true,
    allowZero: true,
    fieldLabel: 'صافي ربح المنصة',
  });
  if (parsed.micros <= 0n) {
    return { netProfit: parsed.numberValue, shareUnits: 0, shareMicros: 0n };
  }
  const shareMicros = roundHalfUpMicros(parsed.micros * 5n, 100n);
  return {
    netProfit: parsed.numberValue,
    shareUnits: microsToNumber(shareMicros),
    shareMicros,
  };
}

/**
 * Validates that debit sum === credit sum at exact 6-decimal micro-unit scale.
 */
export function assertBalancedLedgerEntries(
  entries: Array<{ side: 'debit' | 'credit'; amount_units: unknown }>
): { totalDebitMicros: bigint; totalCreditMicros: bigint } {
  let debit = 0n;
  let credit = 0n;
  for (const e of entries) {
    const parsed = parseMoneyStrict(e.amount_units, {
      allowNegative: false,
      allowZero: false,
      fieldLabel: 'مبلغ القيد المحاسبي',
    });
    if (e.side === 'debit') debit += parsed.micros;
    else credit += parsed.micros;
  }
  if (debit <= 0n || debit !== credit) {
    throw new Error(
      `القيد غير متوازن محاسبياً: إجمالي المدين (${fromMicros(debit)}) لا يساوي إجمالي الدائن (${fromMicros(credit)}).`
    );
  }
  return { totalDebitMicros: debit, totalCreditMicros: credit };
}

/**
 * Display formatter supporting up to 6 decimals without trailing zeros:
 * 15 -> "15", 0.45 -> "0.45", 0.0003 -> "0.0003", 10000 -> "10,000"
 */
export function formatYer(
  val: number | string | bigint | undefined | null,
  options: { withCurrency?: boolean } = {}
): string {
  const micros = toMicros(val);
  const str = fromMicros(micros);
  const neg = str.startsWith('-');
  const unsigned = neg ? str.slice(1) : str;
  const [intStr, fracStr] = unsigned.split('.');
  const formattedInt = intStr.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const numStr = `${neg ? '-' : ''}${formattedInt}${fracStr ? `.${fracStr}` : ''}`;
  return options.withCurrency ? `${numStr} ر.ي` : numStr;
}
