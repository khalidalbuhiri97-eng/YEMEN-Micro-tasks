import Decimal from 'decimal.js';

/**
 * Kasb Yemen (كسب اليمن) - Exact Decimal Yemeni Rial (YER) Monetary Engine
 * Currency Base: 1 YER stored, calculated, and displayed directly (NUMERIC(30,6))
 * Precision: Up to 6 decimal places (0.000001 YER), zero floating-point drift, zero micro-unit scaling.
 */

Decimal.set({
  precision: 36,
  rounding: Decimal.ROUND_HALF_UP,
});

export const MONEY_DECIMALS = 6;
export const USD_TO_YER_RATE = 1600;

export type ParsedMoney = {
  decimal: Decimal;
  numericString: string;
  numberValue: number;
  valueOf(): number;
  [Symbol.toPrimitive](hint: string): number;
};

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
 * Safely converts an unknown numeric/string/Decimal input into a finite Decimal.
 * Returns Decimal(0) for empty/null/invalid read inputs (for display/aggregation).
 */
export function toYerDecimal(
  input: number | string | bigint | Decimal | undefined | null
): Decimal {
  if (input === null || input === undefined || input === '') {
    return new Decimal(0);
  }
  if (input instanceof Decimal) {
    return input.isFinite() ? input : new Decimal(0);
  }
  if (typeof input === 'bigint') {
    return new Decimal(input.toString());
  }
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return new Decimal(0);
    // String(input) in JS is exact for standard decimal literals without float noise when rounded cleanly
    return new Decimal(String(input));
  }
  const cleaned = String(input).trim().replace(/,/g, '');
  if (!cleaned) return new Decimal(0);
  try {
    const d = new Decimal(cleaned);
    return d.isFinite() ? d : new Decimal(0);
  } catch {
    return new Decimal(0);
  }
}

/**
 * Strictly parses and validates a user/API monetary value in YER (max 6 decimal places),
 * returning a rich ParsedMoney object with Decimal, fixed numericString, and numberValue.
 */
export function parseMoneyDecimal(
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
  if (input instanceof Decimal) {
    if (!input.isFinite()) throw new Error(`${fieldLabel} غير صالح.`);
    raw = input.toFixed();
  } else if (typeof input === 'bigint') {
    raw = input.toString();
  } else if (typeof input === 'number') {
    if (!Number.isFinite(input)) {
      throw new Error(`${fieldLabel} غير صالح.`);
    }
    raw = String(input);
  } else {
    raw = String(input).trim().replace(/,/g, '');
  }

  if (!raw) {
    throw new Error(`${fieldLabel} مطلوب.`);
  }

  let dec: Decimal;
  try {
    dec = new Decimal(raw);
  } catch {
    throw new Error(`صيغة ${fieldLabel} غير صالحة.`);
  }

  if (!dec.isFinite()) {
    throw new Error(`${fieldLabel} غير صالح.`);
  }

  // Normalize without trailing fractional zeros to verify max decimal precision
  const fixedCheck = dec.toDecimalPlaces(maxDecimals, Decimal.ROUND_HALF_UP);
  if (!dec.equals(fixedCheck)) {
    throw new Error(`${fieldLabel} يقبل بحد أقصى ${maxDecimals} منازل عشرية.`);
  }

  if (!allowNegative && dec.isNegative()) {
    throw new Error(`${fieldLabel} لا يمكن أن يكون سالباً.`);
  }
  if (!allowZero && dec.isZero()) {
    throw new Error(`${fieldLabel} يجب أن يكون أكبر من صفر.`);
  }

  const rounded = dec.toDecimalPlaces(MONEY_DECIMALS, Decimal.ROUND_HALF_UP);
  const numericString = rounded.toFixed(MONEY_DECIMALS);
  const numberValue = rounded.toNumber();

  return {
    decimal: rounded,
    numericString,
    numberValue,
    valueOf() {
      return numberValue;
    },
    [Symbol.toPrimitive]() {
      return numberValue;
    },
  };
}

/**
 * Strictly parses and validates a user/API monetary value in YER (max 6 decimal places),
 * returning a validated 6-decimal number.
 */
export function parseMoneyStrict(
  input: unknown,
  options: {
    allowNegative?: boolean;
    allowZero?: boolean;
    fieldLabel?: string;
    maxDecimals?: number;
  } = {}
): number {
  return parseMoneyDecimal(input, options).numberValue;
}

export function roundYer6(val: number | string | bigint | Decimal | undefined | null): number {
  return toYerDecimal(val).toDecimalPlaces(MONEY_DECIMALS, Decimal.ROUND_HALF_UP).toNumber();
}

export function formatYerFixed(
  val: number | string | bigint | Decimal | undefined | null,
  decimals = MONEY_DECIMALS
): string {
  return toYerDecimal(val).toDecimalPlaces(decimals, Decimal.ROUND_HALF_UP).toFixed(decimals);
}

export function addMoney(
  a: number | string | bigint | Decimal | undefined | null,
  b: number | string | bigint | Decimal | undefined | null
): number {
  return toYerDecimal(a)
    .plus(toYerDecimal(b))
    .toDecimalPlaces(MONEY_DECIMALS, Decimal.ROUND_HALF_UP)
    .toNumber();
}

export function subMoney(
  a: number | string | bigint | Decimal | undefined | null,
  b: number | string | bigint | Decimal | undefined | null
): number {
  return toYerDecimal(a)
    .minus(toYerDecimal(b))
    .toDecimalPlaces(MONEY_DECIMALS, Decimal.ROUND_HALF_UP)
    .toNumber();
}

export function mulMoney(
  a: number | string | bigint | Decimal | undefined | null,
  b: number | string | bigint | Decimal | undefined | null
): number {
  return toYerDecimal(a)
    .times(toYerDecimal(b))
    .toDecimalPlaces(MONEY_DECIMALS, Decimal.ROUND_HALF_UP)
    .toNumber();
}

export function sumMoney(
  values: Array<number | string | bigint | Decimal | undefined | null>
): number {
  let acc = new Decimal(0);
  for (const v of values) {
    acc = acc.plus(toYerDecimal(v));
  }
  return acc.toDecimalPlaces(MONEY_DECIMALS, Decimal.ROUND_HALF_UP).toNumber();
}

/**
 * Exact 6-decimal percentage computation: ROUND(amount * percentage / 100, 6)
 */
export function calcPercentageYer(
  amountInput: number | string | bigint | Decimal | undefined | null,
  percentageInput: number | string | Decimal
): number {
  const amt = toYerDecimal(amountInput);
  const pct = toYerDecimal(percentageInput);
  return amt
    .times(pct)
    .div(100)
    .toDecimalPlaces(MONEY_DECIMALS, Decimal.ROUND_HALF_UP)
    .toNumber();
}

/**
 * Wallet P2P Transfer breakdown in direct YER:
 * Exact 3% fee = ROUND(amount * 0.03, 6) with NO minimum 1-YER floor.
 * Examples:
 * - 15 YER -> fee 0.45 YER, net 14.55 YER
 * - 0.01 YER -> fee 0.0003 YER, net 0.0097 YER
 */
export function calcWalletTransferBreakdown(amountInput: unknown): {
  amount: number;
  fee: number;
  net: number;
  amountDecimal: Decimal;
  feeDecimal: Decimal;
  netDecimal: Decimal;
  amountFixed: string;
  feeFixed: string;
  netFixed: string;
} {
  const parsed = parseMoneyDecimal(amountInput, {
    allowNegative: false,
    allowZero: false,
    fieldLabel: 'مبلغ التحويل',
  });
  const feeDecimal = parsed.decimal
    .times('0.03')
    .toDecimalPlaces(MONEY_DECIMALS, Decimal.ROUND_HALF_UP);
  const netDecimal = parsed.decimal
    .minus(feeDecimal)
    .toDecimalPlaces(MONEY_DECIMALS, Decimal.ROUND_HALF_UP);

  return {
    amount: parsed.numberValue,
    fee: feeDecimal.toNumber(),
    net: netDecimal.toNumber(),
    amountDecimal: parsed.decimal,
    feeDecimal,
    netDecimal,
    amountFixed: parsed.decimal.toFixed(MONEY_DECIMALS),
    feeFixed: feeDecimal.toFixed(MONEY_DECIMALS),
    netFixed: netDecimal.toFixed(MONEY_DECIMALS),
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
  const defaultPercentage =
    Number.isFinite(rawDefault) && rawDefault >= 0 && rawDefault <= 100 ? rawDefault : 20;

  const rawMin = Number(policy?.minFeeUnits ?? 0);
  const minFeeUnits = Number.isFinite(rawMin) && rawMin >= 0 ? roundYer6(rawMin) : 0;

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
 * and total required directly in YER using Decimal arithmetic.
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
  appliedPolicySnapshot: CampaignFeePolicy;
  policySnapshot: CampaignFeePolicy;
} {
  const parsedReward = parseMoneyDecimal(params.rewardUnits, {
    allowNegative: false,
    allowZero: false,
    fieldLabel: 'سعر المهمة',
  });
  const slotsNum = Number(params.slots);
  if (!Number.isInteger(slotsNum) || slotsNum <= 0) {
    throw new Error('عدد المهمات المطلوبة يجب أن يكون عدداً صحيحاً أكبر من صفر.');
  }

  const normalizedPolicy = normalizeCampaignFeePolicy(
    params.policy,
    params.fallbackFeePercentage ?? 20
  );
  const categoryKey = String(params.category || '').trim();
  const appliedPercentage =
    categoryKey &&
    normalizedPolicy.categoryFees &&
    normalizedPolicy.categoryFees[categoryKey] !== undefined
      ? normalizedPolicy.categoryFees[categoryKey]
      : normalizedPolicy.defaultPercentage;

  const budgetDecimal = parsedReward.decimal
    .times(slotsNum)
    .toDecimalPlaces(MONEY_DECIMALS, Decimal.ROUND_HALF_UP);
  const rawFeeDecimal = budgetDecimal
    .times(new Decimal(appliedPercentage))
    .div(100)
    .toDecimalPlaces(MONEY_DECIMALS, Decimal.ROUND_HALF_UP);
  const minFeeDecimal = toYerDecimal(normalizedPolicy.minFeeUnits || 0).toDecimalPlaces(
    MONEY_DECIMALS,
    Decimal.ROUND_HALF_UP
  );

  const minFeeApplied = minFeeDecimal.gt(0) && rawFeeDecimal.lt(minFeeDecimal);
  const feeDecimal = minFeeApplied ? minFeeDecimal : rawFeeDecimal;
  const totalDecimal = budgetDecimal
    .plus(feeDecimal)
    .toDecimalPlaces(MONEY_DECIMALS, Decimal.ROUND_HALF_UP);

  return {
    rewardUnits: parsedReward.numberValue,
    slots: slotsNum,
    budgetUnits: budgetDecimal.toNumber(),
    feePercentage: appliedPercentage,
    effectiveFeePercentage: appliedPercentage,
    minFeeApplied,
    feeUnits: feeDecimal.toNumber(),
    totalUnits: totalDecimal.toNumber(),
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
 * ClixWall 70% User / 30% Publisher revenue split directly in YER (1 USD = 1600 YER).
 * Example: total_usd = 0.00020 -> total_yer = 0.320, user_yer = 0.224, publisher_yer = 0.096.
 */
export function calculateClixWallRevenueSplit(params: {
  totalUsd?: number | string;
  userUsd?: number | string;
  publisherUsd?: number | string;
  exchangeRate?: number;
}): {
  totalUsd: number;
  userUsd: number;
  publisherUsd: number;
  totalYer: number;
  userYer: number;
  publisherYer: number;
  exchangeRate: number;
} {
  const rate = new Decimal(params.exchangeRate ?? USD_TO_YER_RATE);
  let totalUsdDec: Decimal;
  let userUsdDec: Decimal;
  let publisherUsdDec: Decimal;

  if (params.totalUsd !== undefined) {
    totalUsdDec = toYerDecimal(params.totalUsd);
    userUsdDec = totalUsdDec.times('0.70').toDecimalPlaces(8, Decimal.ROUND_HALF_UP);
    publisherUsdDec = totalUsdDec.minus(userUsdDec).toDecimalPlaces(8, Decimal.ROUND_HALF_UP);
  } else {
    userUsdDec = toYerDecimal(params.userUsd ?? 0);
    publisherUsdDec = toYerDecimal(params.publisherUsd ?? 0);
    totalUsdDec = userUsdDec.plus(publisherUsdDec);
  }

  const totalYerDec = totalUsdDec.times(rate).toDecimalPlaces(MONEY_DECIMALS, Decimal.ROUND_HALF_UP);
  const userYerDec = totalUsdDec
    .times(rate)
    .times('0.70')
    .toDecimalPlaces(MONEY_DECIMALS, Decimal.ROUND_HALF_UP);
  const publisherYerDec = totalYerDec
    .minus(userYerDec)
    .toDecimalPlaces(MONEY_DECIMALS, Decimal.ROUND_HALF_UP);

  return {
    totalUsd: totalUsdDec.toDecimalPlaces(8, Decimal.ROUND_HALF_UP).toNumber(),
    userUsd: userUsdDec.toDecimalPlaces(8, Decimal.ROUND_HALF_UP).toNumber(),
    publisherUsd: publisherUsdDec.toDecimalPlaces(8, Decimal.ROUND_HALF_UP).toNumber(),
    totalYer: totalYerDec.toNumber(),
    userYer: userYerDec.toNumber(),
    publisherYer: publisherYerDec.toNumber(),
    exchangeRate: rate.toNumber(),
  };
}

/**
 * Referral 5% recurring share strictly on platform net profit (in YER).
 */
export function calculateReferralNetProfitShare(netProfitInput: unknown): {
  netProfit: number;
  shareUnits: number;
} {
  const parsed = parseMoneyDecimal(netProfitInput, {
    allowNegative: true,
    allowZero: true,
    fieldLabel: 'صافي ربح المنصة',
  });
  if (parsed.decimal.lte(0)) {
    return { netProfit: parsed.numberValue, shareUnits: 0 };
  }
  const shareDecimal = parsed.decimal
    .times('0.05')
    .toDecimalPlaces(MONEY_DECIMALS, Decimal.ROUND_HALF_UP);
  return {
    netProfit: parsed.numberValue,
    shareUnits: shareDecimal.toNumber(),
  };
}

/**
 * Validates that debit sum === credit sum at exact 6-decimal YER precision.
 */
export function assertBalancedLedgerEntries(
  entries: Array<{ side: 'debit' | 'credit'; amount_units: unknown }>
): { totalDebit: string; totalCredit: string } {
  let debit = new Decimal(0);
  let credit = new Decimal(0);
  for (const e of entries) {
    const parsed = parseMoneyDecimal(e.amount_units, {
      allowNegative: false,
      allowZero: false,
      fieldLabel: 'مبلغ القيد المحاسبي',
    });
    if (e.side === 'debit') debit = debit.plus(parsed.decimal);
    else credit = credit.plus(parsed.decimal);
  }
  if (debit.lte(0) || !debit.equals(credit)) {
    throw new Error(
      `القيد غير متوازن محاسبياً: إجمالي المدين (${formatYer(debit)}) لا يساوي إجمالي الدائن (${formatYer(credit)}).`
    );
  }
  return {
    totalDebit: debit.toFixed(MONEY_DECIMALS),
    totalCredit: credit.toFixed(MONEY_DECIMALS),
  };
}

/**
 * Display formatter for Yemeni Rial supporting up to 6 decimal places without trailing zeros:
 * 25 -> "25", 0.224 -> "0.224", 0.000001 -> "0.000001", 10000 -> "10,000"
 */
export function formatYer(
  val: number | string | bigint | Decimal | undefined | null,
  options: { withCurrency?: boolean } = {}
): string {
  const dec = toYerDecimal(val).toDecimalPlaces(MONEY_DECIMALS, Decimal.ROUND_HALF_UP);
  const fixed = dec.toFixed(MONEY_DECIMALS);
  const neg = fixed.startsWith('-');
  const unsigned = neg ? fixed.slice(1) : fixed;
  const [intStr, fracRaw] = unsigned.split('.');
  const fracTrimmed = (fracRaw || '').replace(/0+$/, '');
  const formattedInt = intStr.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const isZero = /^0+$/.test(intStr) && fracTrimmed.length === 0;
  const numStr = `${neg && !isZero ? '-' : ''}${formattedInt}${fracTrimmed ? `.${fracTrimmed}` : ''}`;
  return options.withCurrency ? `${numStr} ر.ي` : numStr;
}
