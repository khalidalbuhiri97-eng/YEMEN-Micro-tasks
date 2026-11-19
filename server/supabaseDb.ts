/**
 * Kasb Yemen - Supabase Database Unified Service Layer
 * Direct, persistent Supabase PostgreSQL operations aligned with live double-entry
 * financial ledger (financial_accounts, ledger_transactions, ledger_entries, wallets),
 * escrow-backed tasks, and atomic RPC workflows.
 */

import crypto from 'node:crypto';
import {
  supabaseServer,
  getSupabaseAdminClient,
  getSupabaseUserClient,
  logSupabaseError,
} from './app.js';
import type {
  UserProfile,
  UserRole,
  AccountStatus,
  UserWallet,
  WalletTransaction,
  TransactionType,
  TaskItem,
  TaskSubmission,
  WithdrawalRequest,
  PayoutMethod,
  AppNotification,
  PlatformSettings,
  TreasurySummary,
  LedgerTransaction,
  TreasuryMovement,
  TaxDefinition,
  TaxSettlement,
  FinancialAuditLog,
  ComprehensiveFinancialReport,
  ReferralStat,
  ReferralRewardStatus,
  CampaignItem,
  CampaignStatus,
  CampaignFeePolicy,
  AdvertiserWalletSummary,
  ExternalAccount,
  ExternalAccountOwnerRole,
  ExternalAccountType,
  ExternalFundScope,
  ExternalDeposit,
  ExternalAccountTransfer,
  ExternalAccountReconciliation,
  FundSegregationSummary,
  GeoTargetSummary,
} from '../src/types/index';
import { geoService } from './geoService.js';
import {
  MONEY_SCALE,
  parseMoneyStrict,
  toMicros,
  fromMicros,
  fromMicrosFixed,
  microsToNumber,
  addMoney,
  subMoney,
  sumMoney,
  calcPercentageMicros,
  calcWalletTransferBreakdown,
  calculateCampaignFeePolicyCosts,
  calculateReferralNetProfitShare,
  assertBalancedLedgerEntries,
  normalizeCampaignFeePolicy,
  formatYer,
} from '../shared/money.js';

const AUTHORIZED_OWNER_EMAIL = (process.env.ADMIN_EMAIL || 'khalidalbuhiri97@gmail.com').trim().toLowerCase();
const AUTHORIZED_OWNER_ID = '00000000-0000-4000-8000-000000000001';

export function generateWalletAddress(userId: string): string {
  const hash = crypto.createHash('sha256').update(userId + '_kasb_wallet_salt_yemen_v1').digest('hex').toUpperCase();
  return `KY-${hash.slice(0, 12)}`;
}

export function generateReferralCode(userId: string): string {
  const hash = crypto.createHash('sha256').update(`${userId}:kasb_referral_v1`).digest('hex').toUpperCase();
  return `KY-${hash.slice(0, 8)}`;
}

export function computeReferralSummary(params: {
  ownReferralCode: string;
  referralBonus: number;
  referredProfiles: Array<{ id: string; full_name?: string; fullName?: string; created_at?: string; createdAt?: string }>;
  approvedSubmissions: Array<{ user_id: string; reward_transaction_id?: string | null; status?: string }>;
  referralRewards: Array<{
    referred_user_id: string;
    reward_amount: number;
    status: string;
    ledger_transaction_id?: string | null;
    paid_at?: string | null;
  }>;
}): ReferralStat {
  const code = params.ownReferralCode.trim();
  const approvedUserIds = new Set(
    (params.approvedSubmissions || [])
      .filter((s) => String(s.status || '').toLowerCase() === 'approved' && Boolean(s.reward_transaction_id))
      .map((s) => s.user_id)
  );
  const rewardByUser = new Map<string, any>();
  for (const rw of params.referralRewards || []) {
    rewardByUser.set(rw.referred_user_id, rw);
  }

  let qualifiedReferralsCount = 0;
  let paidRewardsCount = 0;
  let totalEarnedYer = 0;

  const referredUsers = (params.referredProfiles || []).map((p) => {
    const hasCompletedFirstTask = approvedUserIds.has(p.id);
    if (hasCompletedFirstTask) qualifiedReferralsCount += 1;

    const rw = rewardByUser.get(p.id);
    const rwStatus = rw?.status ? String(rw.status).toLowerCase() : null;
    const isActuallyPaid = rwStatus === 'paid' && Boolean(rw?.ledger_transaction_id);
    const rewardEarned = isActuallyPaid ? Number(rw.reward_amount || 0) : 0;

    if (isActuallyPaid) {
      paidRewardsCount += 1;
      totalEarnedYer = addMoney(totalEarnedYer, rewardEarned);
    }

    let rewardStatus: ReferralRewardStatus;
    if (rwStatus === 'paid' && rw?.ledger_transaction_id) {
      rewardStatus = 'paid';
    } else if (rwStatus === 'approved') {
      rewardStatus = 'approved';
    } else if (rwStatus === 'rejected') {
      rewardStatus = 'rejected';
    } else if (rwStatus === 'pending' || hasCompletedFirstTask) {
      rewardStatus = 'pending';
    } else {
      rewardStatus = 'awaiting_first_task';
    }

    return {
      id: p.id,
      fullName: p.full_name || p.fullName || 'مستخدم',
      createdAt: p.created_at || p.createdAt || new Date().toISOString(),
      hasCompletedFirstTask,
      rewardStatus,
      rewardEarned,
      paidAt: rw?.paid_at || null,
    };
  });

  return {
    code,
    shareUrl: code ? `https://kasbyemen.com/?ref=${encodeURIComponent(code)}` : 'https://kasbyemen.com/',
    referralBonus: Math.max(0, Number(params.referralBonus ?? 0)),
    totalReferred: referredUsers.length,
    qualifiedReferralsCount,
    paidRewardsCount,
    totalEarnedYer,
    referredUsers,
  };
}

function getDbClient() {
  try {
    return getSupabaseAdminClient();
  } catch {
    return supabaseServer;
  }
}

function getActorOrAdminClient(authToken?: string) {
  try {
    return getSupabaseAdminClient();
  } catch {
    if (authToken) {
      return getSupabaseUserClient(authToken);
    }
    return supabaseServer;
  }
}

function getRpcClient(authToken?: string) {
  if (authToken) {
    return getSupabaseUserClient(authToken);
  }
  return getDbClient();
}

export type OwnerFinancialOpType =
  | 'OWNER_CAPITAL_DEPOSIT'
  | 'OPERATIONAL_EXPENSE'
  | 'OWNER_WITHDRAWAL'
  | 'AD_REVENUE'
  | 'SUBSCRIPTION_REVENUE'
  | 'SERVICE_REVENUE';

export const MIGRATION_011_CORE_ACCOUNTS = [
  'PLATFORM-TREASURY',
  'VIRTUAL-ISSUANCE-CONTROL',
  'PLATFORM-CASH-VAULT',
  'PLATFORM-REVENUE-TASKS',
  'PLATFORM-REVENUE-ADS',
  'PLATFORM-REVENUE-SUBSCRIPTIONS',
  'PLATFORM-REVENUE-SERVICES',
  'PLATFORM-EXPENSES',
  'PLATFORM-EXPENSE-CLEARING',
  'PAYMENT-PROVIDER-FEES',
  'OWNER-CAPITAL',
  'OWNER-CURRENT-ACCOUNT',
  'OWNER-WITHDRAWALS',
  'RETAINED-EARNINGS',
  'TAX-PAYABLE',
  'WITHDRAWAL-RESERVED',
  'WITHDRAWAL-SETTLED',
  'TASK-ESCROW-POOL',
] as const;

export interface LedgerEntryDraft {
  account_id: string;
  side: 'debit' | 'credit';
  amount_units: number;
  memo: string;
}

/**
 * Pure double-entry builder used by both live server handlers and integration verification
 * to guarantee Debits === Credits and positive integer amounts for every financial operation.
 */
export function buildDoubleEntryForOperation(params: {
  operationType: OwnerFinancialOpType;
  amountUnits: number;
  description: string;
  accountIds: Record<string, string>;
  creditToTreasury?: boolean;
}): LedgerEntryDraft[] {
  const amt = parseMoneyStrict(params.amountUnits);
  if (!Number.isFinite(amt) || amt <= 0) {
    throw new Error('المبلغ يجب أن يكون عدداً موجباً أكبر من صفر.');
  }
  const memo = params.description.trim();
  if (!memo) {
    throw new Error('البيان المحاسبي مطلوب.');
  }

  const reqAcc = (code: string): string => {
    const id = params.accountIds[code];
    if (!id) {
      throw new Error(`الحساب المالي المطلوب (${code}) غير موجود. يرجى تنفيذ الترحيل 011 في قاعدة البيانات.`);
    }
    return id;
  };

  let entries: LedgerEntryDraft[];
  switch (params.operationType) {
    case 'OWNER_CAPITAL_DEPOSIT':
      entries = [
        { account_id: reqAcc('PLATFORM-CASH-VAULT'), side: 'debit', amount_units: amt, memo },
        { account_id: reqAcc('OWNER-CAPITAL'), side: 'credit', amount_units: amt, memo },
        { account_id: reqAcc('VIRTUAL-ISSUANCE-CONTROL'), side: 'debit', amount_units: amt, memo: `تغطية إصدار خزينة: ${memo}` },
        { account_id: reqAcc('PLATFORM-TREASURY'), side: 'credit', amount_units: amt, memo: `إيداع رأس مال بالخزينة: ${memo}` },
      ];
      break;
    case 'OPERATIONAL_EXPENSE':
      entries = [
        { account_id: reqAcc('PLATFORM-TREASURY'), side: 'debit', amount_units: amt, memo },
        { account_id: reqAcc('VIRTUAL-ISSUANCE-CONTROL'), side: 'credit', amount_units: amt, memo: `سحب من الخزينة لمصروف: ${memo}` },
        { account_id: reqAcc('PLATFORM-EXPENSES'), side: 'debit', amount_units: amt, memo },
        { account_id: reqAcc('PLATFORM-EXPENSE-CLEARING'), side: 'credit', amount_units: amt, memo: `تسوية مصروف تشغيلي: ${memo}` },
      ];
      break;
    case 'OWNER_WITHDRAWAL':
      entries = [
        { account_id: reqAcc('PLATFORM-TREASURY'), side: 'debit', amount_units: amt, memo },
        { account_id: reqAcc('VIRTUAL-ISSUANCE-CONTROL'), side: 'credit', amount_units: amt, memo: `سحب شخصي للمالك: ${memo}` },
        { account_id: reqAcc('OWNER-WITHDRAWALS'), side: 'debit', amount_units: amt, memo },
        { account_id: reqAcc('PLATFORM-EXPENSE-CLEARING'), side: 'credit', amount_units: amt, memo: `تسوية مسحوبات المالك: ${memo}` },
      ];
      break;
    case 'AD_REVENUE':
    case 'SUBSCRIPTION_REVENUE':
    case 'SERVICE_REVENUE': {
      const targetCode =
        params.operationType === 'AD_REVENUE'
          ? 'PLATFORM-REVENUE-ADS'
          : params.operationType === 'SUBSCRIPTION_REVENUE'
            ? 'PLATFORM-REVENUE-SUBSCRIPTIONS'
            : 'PLATFORM-REVENUE-SERVICES';
      entries = [
        { account_id: reqAcc('PLATFORM-CASH-VAULT'), side: 'debit', amount_units: amt, memo },
        { account_id: reqAcc(targetCode), side: 'credit', amount_units: amt, memo },
      ];
      if (params.creditToTreasury !== false) {
        entries.push(
          { account_id: reqAcc('VIRTUAL-ISSUANCE-CONTROL'), side: 'debit', amount_units: amt, memo: `تغطية خزينة من إيراد: ${memo}` },
          { account_id: reqAcc('PLATFORM-TREASURY'), side: 'credit', amount_units: amt, memo: `تغذية الخزينة من إيراد: ${memo}` }
        );
      }
      break;
    }
    default:
      throw new Error(`نوع العملية غير مدعوم: ${params.operationType}`);
  }

  const totalDebit = entries.filter((e) => e.side === 'debit').reduce((s, e) => s + e.amount_units, 0);
  const totalCredit = entries.filter((e) => e.side === 'credit').reduce((s, e) => s + e.amount_units, 0);
  if (totalDebit !== totalCredit || totalDebit <= 0) {
    throw new Error(`فشل توازن القيد المزدوج (مدين=${totalDebit}, دائن=${totalCredit}).`);
  }

  return entries;
}

export interface CampaignFundingBreakdown {
  rewardUnits: number;
  slots: number;
  feePercentage: number;
  budgetUnits: number;
  feeUnits: number;
  totalUnits: number;
  minFeeApplied?: boolean;
  policySnapshot?: Record<string, any>;
}

export function calculateCampaignFundingCosts(params: {
  rewardUnits: number;
  slots: number;
  feePercentage?: number;
  category?: string;
  policy?: CampaignFeePolicy | null;
}): CampaignFundingBreakdown {
  const result = calculateCampaignFeePolicyCosts({
    rewardUnits: params.rewardUnits,
    slots: params.slots,
    category: params.category,
    policy: params.policy || (params.feePercentage !== undefined ? { defaultFeePercentage: params.feePercentage } : undefined),
  });

  return {
    rewardUnits: result.rewardUnits,
    slots: result.slots,
    feePercentage: result.effectiveFeePercentage,
    budgetUnits: result.budgetUnits,
    feeUnits: result.feeUnits,
    totalUnits: result.totalUnits,
    minFeeApplied: result.minFeeApplied,
    policySnapshot: result.policySnapshot,
  };
}

export function checkCampaignBalanceSufficiency(availableBalance: number, totalRequired: number) {
  const safeAvailable = Math.max(0, Number(availableBalance || 0));
  const safeRequired = Math.max(0, Number(totalRequired || 0));
  const deficitUnits = Math.max(0, subMoney(safeRequired, safeAvailable));
  return {
    sufficient: safeAvailable >= safeRequired && safeRequired > 0,
    availableBalance: safeAvailable,
    totalRequired: safeRequired,
    deficitUnits,
  };
}

export function buildCampaignReserveEntries(params: {
  title: string;
  walletAccountId: string;
  budgetEscrowAccountId: string;
  feeEscrowAccountId: string;
  budgetUnits: number;
  feeUnits: number;
  feePercentage: number;
}): LedgerEntryDraft[] {
  const budget = parseMoneyStrict(params.budgetUnits);
  const fee = parseMoneyStrict(params.feeUnits);
  if (!Number.isFinite(budget) || budget <= 0) {
    throw new Error('ميزانية الحملة غير صالحة.');
  }
  if (!Number.isFinite(fee) || fee < 0) {
    throw new Error('قيمة رسوم المنصة غير صالحة.');
  }
  const total = addMoney(budget, fee);
  const entries: LedgerEntryDraft[] = [
    {
      account_id: params.walletAccountId,
      side: 'debit',
      amount_units: total,
      memo: `حجز إجمالي تمويل الحملة: ${params.title}`,
    },
    {
      account_id: params.budgetEscrowAccountId,
      side: 'credit',
      amount_units: budget,
      memo: `حجز ميزانية مكافآت الحملة: ${params.title}`,
    },
  ];
  if (fee > 0) {
    entries.push({
      account_id: params.feeEscrowAccountId,
      side: 'credit',
      amount_units: fee,
      memo: `حجز رسوم المنصة المعلقة (${params.feePercentage}%) قبل بدء الحملة: ${params.title}`,
    });
  }
  return entries;
}

export function buildCampaignFeeRecognitionEntries(params: {
  title: string;
  feeEscrowAccountId: string;
  adsRevenueAccountId: string;
  feeUnits: number;
}): LedgerEntryDraft[] {
  const fee = parseMoneyStrict(params.feeUnits);
  if (!Number.isFinite(fee) || fee <= 0) {
    return [];
  }
  return [
    {
      account_id: params.feeEscrowAccountId,
      side: 'debit',
      amount_units: fee,
      memo: `تحصيل رسوم المنصة عند بدء الحملة: ${params.title}`,
    },
    {
      account_id: params.adsRevenueAccountId,
      side: 'credit',
      amount_units: fee,
      memo: `إيراد إعلانات متحقق من الحملة: ${params.title}`,
    },
  ];
}

export function buildCampaignSettlementRefundEntries(params: {
  title: string;
  walletAccountId: string;
  budgetEscrowAccountId: string;
  feeEscrowAccountId: string;
  refundBudgetUnits: number;
  refundFeeUnits: number;
}): LedgerEntryDraft[] {
  const refundBudget = Math.max(0, parseMoneyStrict(params.refundBudgetUnits || 0));
  const refundFee = Math.max(0, parseMoneyStrict(params.refundFeeUnits || 0));
  const totalRefund = addMoney(refundBudget, refundFee);
  if (totalRefund <= 0) return [];

  const entries: LedgerEntryDraft[] = [];
  if (refundBudget > 0) {
    entries.push({
      account_id: params.budgetEscrowAccountId,
      side: 'debit',
      amount_units: refundBudget,
      memo: `استرجاع متبقي ميزانية الحملة: ${params.title}`,
    });
  }
  if (refundFee > 0) {
    entries.push({
      account_id: params.feeEscrowAccountId,
      side: 'debit',
      amount_units: refundFee,
      memo: `استرجاع رسوم منصة محتجزة لحملة لم تبدأ: ${params.title}`,
    });
  }
  entries.push({
    account_id: params.walletAccountId,
    side: 'credit',
    amount_units: totalRefund,
    memo: `إيداع مرتجع الحملة في محفظة المعلن: ${params.title}`,
  });
  return entries;
}

export function normalizeReceiptReference(ref: string): string {
  return String(ref || '')
    .trim()
    .replace(/[\s-]+/g, '')
    .toUpperCase();
}

export function sanitizeDepositReceiptUrl(raw?: string | null): string {
  const val = typeof raw === 'string' ? raw.trim() : '';
  if (!val || val.length > 400000) return '';
  if (val.includes('..')) return '';
  if (/^https?:\/\/[^\s<>"']+$/i.test(val)) return val;
  if (/^external-receipts\/[a-zA-Z0-9_./-]+$/i.test(val)) return val;
  if (/^task-proofs\/[a-zA-Z0-9_./-]+$/i.test(val)) return val;
  if (/^data:image\/(?:png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/i.test(val)) return val;
  return '';
}

export function buildExternalDepositApprovalEntries(params: {
  externalFinAccountId: string;
  targetFinAccountId: string;
  amountUnits: number;
  externalAccountName: string;
  referenceNumber: string;
  depositPurpose: 'advertiser_wallet' | 'platform_capital';
}): LedgerEntryDraft[] {
  const amt = parseMoneyStrict(params.amountUnits);
  if (!Number.isFinite(amt) || amt <= 0) {
    throw new Error('مبلغ الإيداع يجب أن يكون عدداً موجباً أكبر من صفر.');
  }
  const ref = String(params.referenceNumber || '').trim();
  if (!ref) {
    throw new Error('الرقم المرجعي للإيصال إلزامي.');
  }
  return [
    {
      account_id: params.externalFinAccountId,
      side: 'debit',
      amount_units: amt,
      memo: `تحصيل نقدي في الحساب الخارجي: ${params.externalAccountName} (${ref})`,
    },
    {
      account_id: params.targetFinAccountId,
      side: 'credit',
      amount_units: amt,
      memo:
        params.depositPurpose === 'advertiser_wallet'
          ? `شحن محفظة المعلن (التزام غير مُستحق كإيراد) - مرجع: ${ref}`
          : `إثبات رأس مال مضاف بالحساب الخارجي - مرجع: ${ref}`,
    },
  ];
}

export function buildInternalAccountTransferEntries(params: {
  fromFinAccountId: string;
  toFinAccountId: string;
  fromAccountCode: string;
  toAccountCode: string;
  amountUnits: number;
  reason: string;
}): LedgerEntryDraft[] {
  const amt = parseMoneyStrict(params.amountUnits);
  if (!Number.isFinite(amt) || amt <= 0) {
    throw new Error('مبلغ التحويل يجب أن يكون عدداً موجباً أكبر من صفر.');
  }
  if (!params.fromFinAccountId || !params.toFinAccountId || params.fromFinAccountId === params.toFinAccountId) {
    throw new Error('يجب اختيار حسابين مختلفين للتحويل الداخلي.');
  }
  return [
    {
      account_id: params.toFinAccountId,
      side: 'debit',
      amount_units: amt,
      memo: `استلام تحويل داخلي من ${params.fromAccountCode}: ${params.reason.trim()}`,
    },
    {
      account_id: params.fromFinAccountId,
      side: 'credit',
      amount_units: amt,
      memo: `تحويل داخلي صادر إلى ${params.toAccountCode}: ${params.reason.trim()}`,
    },
  ];
}

export function buildReconciliationAdjustmentEntries(params: {
  externalFinAccountId: string;
  contraFinAccountId: string;
  accountingBalance: number;
  actualBalance: number;
  reason: string;
  accountName: string;
}): { discrepancy: number; entries: LedgerEntryDraft[] } {
  const accounting = parseMoneyStrict(params.accountingBalance || 0);
  const actual = parseMoneyStrict(params.actualBalance || 0);
  const diff = subMoney(actual, accounting);
  if (diff === 0) {
    return { discrepancy: 0, entries: [] };
  }
  const absDiff = Math.abs(diff);
  const cleanReason = String(params.reason || '').trim();
  if (!cleanReason) {
    throw new Error('سبب التسوية إلزامي عند وجود فرق بالمطابقة.');
  }
  if (diff > 0) {
    return {
      discrepancy: diff,
      entries: [
        {
          account_id: params.externalFinAccountId,
          side: 'debit',
          amount_units: absDiff,
          memo: `قيد تسوية زيادة فعلية بالحساب الخارجي (${params.accountName}): ${cleanReason}`,
        },
        {
          account_id: params.contraFinAccountId,
          side: 'credit',
          amount_units: absDiff,
          memo: `مقابل تسوية مطابقة الحساب الخارجي (${params.accountName})`,
        },
      ],
    };
  }
  return {
    discrepancy: diff,
    entries: [
      {
        account_id: params.contraFinAccountId,
        side: 'debit',
        amount_units: absDiff,
        memo: `قيد تسوية عجز/عمولات بالمطابقة (${params.accountName}): ${cleanReason}`,
      },
      {
        account_id: params.externalFinAccountId,
        side: 'credit',
        amount_units: absDiff,
        memo: `تعديل رصيد الحساب الخارجي للرصيد الفعلي (${params.accountName})`,
      },
    ],
  };
}

export function computeFundSegregationSummary(params: {
  cashVaultTotal: number;
  externalPlatformBalance: number;
  externalAccountsTotal: number;
  externalActualTotal: number;
  activeExternalCount: number;
  realizedRevenuesTotal: number;
  operationalExpensesTotal: number;
  ownerCapitalTotal: number;
  ownerWithdrawalsTotal: number;
  virtualTreasuryAvailable: number;
  advertiserWalletsTotal: number;
  campaignBudgetEscrow: number;
  campaignFeeEscrow: number;
  pendingExternalDepositsCount: number;
  pendingExternalDepositsAmount: number;
  approvedExternalDepositsTotal: number;
  workerWalletsTotal: number;
  withdrawalReservedTotal: number;
  adminTaskEscrowTotal: number;
}): FundSegregationSummary {
  const netOwnerEquity =
    params.ownerCapitalTotal +
    (params.realizedRevenuesTotal - params.operationalExpensesTotal) -
    params.ownerWithdrawalsTotal;

  return {
    platformFunds: {
      cashVaultTotal: params.cashVaultTotal,
      externalPlatformBalance: params.externalPlatformBalance,
      realizedRevenuesTotal: params.realizedRevenuesTotal,
      operationalExpensesTotal: params.operationalExpensesTotal,
      ownerCapitalTotal: params.ownerCapitalTotal,
      ownerWithdrawalsTotal: params.ownerWithdrawalsTotal,
      netOwnerEquity,
      virtualTreasuryAvailable: params.virtualTreasuryAvailable,
    },
    advertiserFunds: {
      advertiserWalletsTotal: params.advertiserWalletsTotal,
      campaignBudgetEscrow: params.campaignBudgetEscrow,
      campaignFeeEscrow: params.campaignFeeEscrow,
      totalAdvertiserLiabilities:
        params.advertiserWalletsTotal + params.campaignBudgetEscrow + params.campaignFeeEscrow,
      pendingExternalDepositsCount: params.pendingExternalDepositsCount,
      pendingExternalDepositsAmount: params.pendingExternalDepositsAmount,
      approvedExternalDepositsTotal: params.approvedExternalDepositsTotal,
    },
    userFunds: {
      workerWalletsTotal: params.workerWalletsTotal,
      withdrawalReservedTotal: params.withdrawalReservedTotal,
      adminTaskEscrowTotal: params.adminTaskEscrowTotal,
      totalUserLiabilities:
        params.workerWalletsTotal + params.withdrawalReservedTotal + params.adminTaskEscrowTotal,
    },
    externalAccountsSummary: {
      totalAccountingBalance: params.externalAccountsTotal,
      totalActualBalance: params.externalActualTotal,
      totalDiscrepancy: params.externalActualTotal - params.externalAccountsTotal,
      activeAccountsCount: params.activeExternalCount,
    },
  };
}

function isMissingRelationError(err: any): boolean {
  const msg = String(err?.message || '').toLowerCase();
  const code = String(err?.code || '');
  return (
    code === '42P01' ||
    code === 'PGRST205' ||
    msg.includes('does not exist') ||
    msg.includes('could not find the table') ||
    msg.includes('schema cache')
  );
}

const advertiserCampaignLocks = new Map<string, Promise<void>>();
export async function withAdvertiserLock<T>(advertiserId: string, fn: () => Promise<T>): Promise<T> {
  const prev = advertiserCampaignLocks.get(advertiserId) || Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  advertiserCampaignLocks.set(advertiserId, prev.then(() => next));
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (advertiserCampaignLocks.get(advertiserId) === next) {
      advertiserCampaignLocks.delete(advertiserId);
    }
  }
}

function mapLedgerTxType(rawType: string, entrySide: 'debit' | 'credit'): TransactionType {
  const upper = String(rawType || '').trim().toUpperCase();
  if (upper.startsWith('REVERSAL_')) {
    return 'REVERSAL';
  }
  switch (upper) {
    case 'TASK_REWARD_PAYOUT':
    case 'TASK_REWARD':
      return 'TASK_REWARD';
    case 'TASK_COMMISSION_REVENUE':
      return 'TASK_COMMISSION_REVENUE';
    case 'WALLET_TRANSFER':
    case 'WALLET_TRANSFER_SENT':
    case 'WALLET_TRANSFER_RECEIVED':
      return entrySide === 'credit' ? 'WALLET_TRANSFER_RECEIVED' : 'WALLET_TRANSFER_SENT';
    case 'ADMIN_ADJUSTMENT':
      return 'ADMIN_ADJUSTMENT';
    case 'TREASURY_ISSUANCE':
      return 'TREASURY_ISSUANCE';
    case 'TASK_BUDGET_RESERVATION':
    case 'TASK_BUDGET_RESERVE':
      return 'TASK_BUDGET_RESERVE';
    case 'TASK_BUDGET_REFUND':
    case 'TASK_BUDGET_RETURN':
      return 'TASK_BUDGET_RETURN';
    case 'WITHDRAWAL_REQUEST':
      return 'WITHDRAWAL_REQUEST';
    case 'WITHDRAWAL_PAYOUT':
      return 'WITHDRAWAL_PAYOUT';
    case 'WITHDRAWAL_REFUND':
      return 'WITHDRAWAL_REFUND';
    case 'REFERRAL_REWARD':
      return 'REFERRAL_REWARD';
    case 'PROMOTIONAL_BONUS':
      return 'PROMOTIONAL_BONUS';
    case 'OWNER_CAPITAL_DEPOSIT':
      return 'OWNER_CAPITAL_DEPOSIT';
    case 'OPERATIONAL_EXPENSE':
      return 'OPERATIONAL_EXPENSE';
    case 'OWNER_WITHDRAWAL':
      return 'OWNER_WITHDRAWAL';
    case 'AD_REVENUE':
      return 'AD_REVENUE';
    case 'SUBSCRIPTION_REVENUE':
      return 'SUBSCRIPTION_REVENUE';
    case 'SERVICE_REVENUE':
      return 'SERVICE_REVENUE';
    case 'PAYMENT_PROVIDER_FEE':
      return 'PAYMENT_PROVIDER_FEE';
    case 'CAMPAIGN_FUNDING_RESERVE':
      return 'CAMPAIGN_FUNDING_RESERVE';
    case 'CAMPAIGN_ESCROW_REFUND':
      return 'CAMPAIGN_ESCROW_REFUND';
    case 'CLIXWALL_REWARD':
      return 'CLIXWALL_REWARD';
    case 'CLIXWALL_REVERSAL':
      return 'CLIXWALL_REVERSAL';
    default:
      return (entrySide === 'credit' ? 'TASK_REWARD' : 'ADMIN_ADJUSTMENT') as TransactionType;
  }
}

export function sanitizeAdvertiserLogoUrl(raw?: string | null): string | undefined {
  const val = typeof raw === 'string' ? raw.trim() : '';
  if (!val) return undefined;
  if (val.length > 350000) return undefined;
  if (/^https?:\/\/[^\s<>"']+$/i.test(val)) return val;
  if (!val.includes('..') && /^advertiser-logos\/[a-zA-Z0-9_./-]+$/i.test(val)) return val;
  if (/^data:image\/(?:png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/i.test(val)) return val;
  return undefined;
}

export function resolvePublicTaskAdvertiserIdentity(t: any, options?: { maskHiddenIdentity?: boolean }) {
  const rawReqs = t?.proof_requirements || {};
  const meta = rawReqs?._campaignMeta || {};
  const isExternalCampaign = Boolean(
    t?.campaign_id || t?.is_external_campaign || meta?.isExternalCampaign
  );
  const hideAdvertiserName = Boolean(
    t?.hide_advertiser_name ?? meta?.hideAdvertiserName ?? false
  );
  const rawDisplayName =
    typeof (t?.advertiser_display_name ?? meta?.advertiserDisplayName) === 'string'
      ? String(t?.advertiser_display_name ?? meta?.advertiserDisplayName).trim()
      : '';
  const rawLogoUrl = sanitizeAdvertiserLogoUrl(t?.advertiser_logo_url ?? meta?.advertiserLogoUrl);

  const mask = options?.maskHiddenIdentity !== false;

  if (!isExternalCampaign) {
    return {
      isExternalCampaign: false,
      hideAdvertiserName: false,
      advertiserDisplayName: undefined,
      advertiserLogoUrl: undefined,
      exposeCreatedBy: true,
    };
  }

  if (hideAdvertiserName && mask) {
    return {
      isExternalCampaign: true,
      hideAdvertiserName: true,
      advertiserDisplayName: 'معلن عبر يمن تاسك',
      advertiserLogoUrl: undefined,
      exposeCreatedBy: false,
    };
  }

  return {
    isExternalCampaign: true,
    hideAdvertiserName,
    advertiserDisplayName: rawDisplayName || 'معلن عبر يمن تاسك',
    advertiserLogoUrl: rawLogoUrl,
    exposeCreatedBy: true,
  };
}

function mapTaskRow(t: any, options?: { maskHiddenIdentity?: boolean }): TaskItem {
  const rewardYer = Number(t.reward_units ?? t.reward_yer ?? 0);
  const totalQuantity = Number(t.slots ?? t.total_quantity ?? 0);
  const completedQuantity = Number(t.approved_count ?? t.completed_quantity ?? 0);
  const budgetYer = Number(t.total_budget_units ?? t.budget_yer ?? rewardYer * totalQuantity);
  const budgetSpentYer = Number(t.budget_spent_yer ?? completedQuantity * rewardYer);
  const rawStatus = String(t.status || 'ACTIVE').toUpperCase();
  const status: TaskItem['status'] =
    rawStatus === 'PAUSED' || rawStatus === 'COMPLETED' || rawStatus === 'ARCHIVED'
      ? rawStatus
      : 'ACTIVE';

  const rawReqs = t.proof_requirements || {};
  const proofRequirements = {
    requireImage: rawReqs.requireImage ?? rawReqs.require_image ?? false,
    requireText: rawReqs.requireText ?? rawReqs.require_text ?? true,
    requireUrl: rawReqs.requireUrl ?? rawReqs.require_url ?? false,
    instructions: rawReqs.instructions,
  };

  const identity = resolvePublicTaskAdvertiserIdentity(t, options);
  const rawMetaGeo = t.proof_requirements?._campaignMeta?.geo || {};
  const countryId = t.country_id ?? rawMetaGeo.countryId ?? null;
  const administrativeDivisionId = t.administrative_division_id ?? null;
  const isNationwide = t.is_nationwide !== undefined ? Boolean(t.is_nationwide) : rawMetaGeo.isNationwide ?? true;
  const fastGeo = geoService.resolveFastGeoLabels({
    countryId,
    divisionId: administrativeDivisionId,
  });

  return {
    id: t.id,
    title: t.title || '',
    description: t.description || '',
    category: (t.category || 'app_testing') as TaskItem['category'],
    rewardYer,
    steps: Array.isArray(t.steps) ? t.steps : [],
    proofRequirements,
    timeEstimateMinutes: Number(t.time_estimate_minutes ?? 10),
    totalQuantity,
    completedQuantity,
    maxPerUser: Number(t.max_per_user ?? 1),
    budgetYer,
    budgetSpentYer,
    deadline: t.deadline_at ?? t.deadline ?? undefined,
    status,
    createdBy: identity.exposeCreatedBy ? t.created_by : undefined,
    campaignId: t.campaign_id || null,
    isExternalCampaign: identity.isExternalCampaign,
    hideAdvertiserName: identity.hideAdvertiserName,
    advertiserDisplayName: identity.advertiserDisplayName,
    advertiserLogoUrl: identity.advertiserLogoUrl,
    countryId,
    countryCode: fastGeo.countryCode || null,
    countryNameAr: fastGeo.countryNameAr || null,
    countryFlag: fastGeo.countryFlag || null,
    administrativeDivisionId,
    isNationwide,
    locationLabel: fastGeo.locationPath || fastGeo.countryNameAr || null,
    createdAt: t.created_at,
  };
}

async function hydrateTaskListGeo(tasks: TaskItem[], db: any): Promise<TaskItem[]> {
  if (!tasks || tasks.length === 0) return tasks;

  const taskIds = tasks.map((t) => t.id);
  const targetRowsByTask = new Map<string, string[]>();

  try {
    const { data, error } = await db
      .from('task_target_divisions')
      .select('task_id, division_id')
      .in('task_id', taskIds);

    if (!error && data) {
      for (const row of data) {
        const arr = targetRowsByTask.get(row.task_id) || [];
        arr.push(row.division_id);
        targetRowsByTask.set(row.task_id, arr);
      }
    }
  } catch {
    // Graceful when Migration 028 has not yet run on live Supabase
  }

  const allDivIds = new Set<string>();
  for (const t of tasks) {
    if (t.administrativeDivisionId) allDivIds.add(t.administrativeDivisionId);
    for (const dId of targetRowsByTask.get(t.id) || []) {
      allDivIds.add(dId);
    }
  }

  const summaryMap = await geoService.resolveTargetSummariesByIds(Array.from(allDivIds));
  const { countries } = await geoService.getCountries({ includeInactive: true });
  const countryMap = new Map(countries.map((c) => [c.id, c]));

  return tasks.map((t) => {
    const divIds = targetRowsByTask.get(t.id) || [];
    const targetDivisions: GeoTargetSummary[] = divIds
      .map((id) => summaryMap.get(id))
      .filter(Boolean) as GeoTargetSummary[];

    const inferredCountryId =
      t.countryId ||
      targetDivisions[0]?.countryId ||
      (t.administrativeDivisionId ? summaryMap.get(t.administrativeDivisionId)?.countryId : null) ||
      null;
    const country = inferredCountryId ? countryMap.get(inferredCountryId) : undefined;

    let locationLabel = t.locationLabel || country?.nameAr || null;
    if (targetDivisions.length > 0) {
      const divNames = targetDivisions.slice(0, 3).map((d) => d.nameAr).join('، ');
      const more = targetDivisions.length > 3 ? ` (+${targetDivisions.length - 3})` : '';
      locationLabel = country ? `${country.nameAr} · ${divNames}${more}` : `${divNames}${more}`;
    } else if (t.isNationwide && country) {
      locationLabel = `${country.nameAr} · كافة المناطق`;
    }

    return {
      ...t,
      countryId: inferredCountryId,
      countryCode: country?.iso2 || t.countryCode || null,
      countryNameAr: country?.nameAr || t.countryNameAr || null,
      countryFlag: country?.flagEmoji || t.countryFlag || null,
      targetDivisionIds: divIds,
      targetDivisions,
      locationLabel,
    };
  });
}

export const supabaseDb = {
  getOwnerEmail(): string {
    return AUTHORIZED_OWNER_EMAIL;
  },

  isAuthorizedOwner(userId: string, email?: string): boolean {
    const cleanEmail = email?.trim().toLowerCase();
    return Boolean(
      userId === AUTHORIZED_OWNER_ID ||
      cleanEmail === AUTHORIZED_OWNER_EMAIL ||
      cleanEmail === 'khalidalbuhiri@gmail.com' ||
      cleanEmail === 'khalidalbuhiri97@gmail.com'
    );
  },

  /**
   * 1. USERS & PROFILES
   */
  async findUserById(id: string): Promise<UserProfile | null> {
    const startTime = Date.now();
    const db = getDbClient();
    try {
      let { data: profileData, error: profileErr } = await db
        .from('profiles')
        .select('id, full_name, phone, city, area_name, country_id, administrative_division_id, avatar_url, account_status, referral_code, referred_by, company_name, contact_person, created_at, updated_at')
        .eq('id', id)
        .maybeSingle();

      // Backwards-compatible fallback if Migration 014/019/028 columns don't exist yet
      if (profileErr && profileErr.code === '42703') {
        const fallback = await db
          .from('profiles')
          .select('id, full_name, phone, city, area_name, avatar_url, account_status, referral_code, referred_by, company_name, contact_person, created_at, updated_at')
          .eq('id', id)
          .maybeSingle();
        if (fallback.error && fallback.error.code === '42703') {
          const minimal = await db
            .from('profiles')
            .select('id, full_name, phone, city, area_name, avatar_url, account_status, referral_code, created_at, updated_at')
            .eq('id', id)
            .maybeSingle();
          profileData = minimal.data as any;
          profileErr = minimal.error;
        } else {
          profileData = fallback.data as any;
          profileErr = fallback.error;
        }
      }

      if (profileErr) {
        await logSupabaseError({
          err: profileErr,
          operation: 'FIND_USER_BY_ID_PROFILE',
          sourceTable: 'profiles',
          executionDurationMs: Date.now() - startTime,
        });
        throw profileErr;
      }

      if (!profileData) return null;

      const { data: roleData, error: roleErr } = await db
        .from('user_roles')
        .select('role')
        .eq('user_id', id)
        .maybeSingle();

      if (roleErr) {
        await logSupabaseError({
          err: roleErr,
          operation: 'FIND_USER_BY_ID_ROLES',
          sourceTable: 'user_roles',
          executionDurationMs: Date.now() - startTime,
        });
        throw roleErr;
      }

      const userRole: UserRole = roleData?.role === 'admin' ? 'admin' : roleData?.role === 'advertiser' ? 'advertiser' : 'user';

      let userEmail = '';
      try {
        const adminClient = getSupabaseAdminClient();
        const { data: authUserData, error: authErr } = await adminClient.auth.admin.getUserById(id);

        if (authErr) {
          await logSupabaseError({
            err: authErr,
            operation: 'FIND_USER_BY_ID_AUTH_EMAIL',
            executionDurationMs: Date.now() - startTime,
          });
        } else if (authUserData?.user?.email) {
          userEmail = authUserData.user.email;
        }
      } catch (keyErr: any) {
        await logSupabaseError({
          err: keyErr,
          operation: 'FIND_USER_BY_ID_ADMIN_CLIENT_CHECK',
          executionDurationMs: Date.now() - startTime,
        });
      }

      const accountStatus: AccountStatus = (profileData.account_status as AccountStatus) || 'active';
      const rawCountryId = (profileData as any).country_id || null;
      const rawDivisionId = (profileData as any).administrative_division_id || null;
      const geoMeta = (rawCountryId || rawDivisionId)
        ? await geoService.resolveLocationMeta({
            countryId: rawCountryId,
            divisionId: rawDivisionId,
          }).catch(() => ({} as any))
        : {};

      return {
        id: profileData.id,
        fullName: profileData.full_name || '',
        phone: profileData.phone || '',
        email: userEmail,
        avatarUrl: profileData.avatar_url || '',
        role: userRole,
        status: accountStatus,
        referralCode: (profileData as any).referral_code || '',
        referredBy: (profileData as any).referred_by || undefined,
        city: profileData.city || profileData.area_name || 'صنعاء',
        areaName: profileData.area_name || null,
        countryId: geoMeta?.country?.id || rawCountryId,
        countryCode: geoMeta?.country?.iso2 || null,
        countryNameAr: geoMeta?.country?.nameAr || null,
        countryFlag: geoMeta?.country?.flagEmoji || null,
        administrativeDivisionId: rawDivisionId,
        locationPath: geoMeta?.locationPath || (geoMeta?.country?.nameAr ? `${geoMeta.country.nameAr} · ${profileData.city || ''}` : null),
        companyName: (profileData as any).company_name || undefined,
        contactPerson: (profileData as any).contact_person || undefined,
        createdAt: profileData.created_at || new Date().toISOString(),
        updatedAt: profileData.updated_at || new Date().toISOString(),
      };
    } catch (err: any) {
      console.error('[Supabase FIND_USER_BY_ID]', err.message);
      throw new Error(`فشل استعلام بيانات المستخدم من Supabase: ${err.message}`);
    }
  },

  async findUserByPhoneOrEmail(identifier: string): Promise<UserProfile | null> {
    const startTime = Date.now();
    const clean = identifier.trim().toLowerCase();
    const db = getDbClient();
    try {
      if (clean.includes('@')) {
        try {
          const adminClient = getSupabaseAdminClient();
          const { data: authList } = await adminClient.auth.admin.listUsers({ perPage: 1000 });
          const authUsers: any[] = (authList?.users as any[]) || [];
          const matchedUser = authUsers.find((u) => String(u.email || '').trim().toLowerCase() === clean);
          if (matchedUser?.id) {
            return this.findUserById(matchedUser.id);
          }
          return null;
        } catch {
          return null;
        }
      }

      const { data, error } = await db
        .from('profiles')
        .select('id')
        .eq('phone', identifier.trim())
        .maybeSingle();

      if (error) {
        await logSupabaseError({
          err: error,
          operation: 'FIND_USER_BY_IDENTIFIER',
          sourceTable: 'profiles',
          executionDurationMs: Date.now() - startTime,
        });
        throw error;
      }

      if (!data) return null;
      return this.findUserById(data.id);
    } catch (err: any) {
      console.error('[Supabase FIND_USER_BY_PHONE_OR_EMAIL]', err.message);
      throw new Error(`فشل البحث عن المستخدم في Supabase: ${err.message}`);
    }
  },

  async getAllUsers(): Promise<UserProfile[]> {
    const startTime = Date.now();
    const db = getDbClient();
    try {
      let profilesRes = await db
        .from('profiles')
        .select('id, full_name, phone, city, area_name, country_id, administrative_division_id, avatar_url, account_status, referral_code, referred_by, company_name, contact_person, created_at, updated_at')
        .order('created_at', { ascending: false });

      if (profilesRes.error && profilesRes.error.code === '42703') {
        profilesRes = (await db
          .from('profiles')
          .select('id, full_name, phone, city, area_name, avatar_url, account_status, referral_code, referred_by, company_name, contact_person, created_at, updated_at')
          .order('created_at', { ascending: false })) as any;
      }

      if (profilesRes.error && (profilesRes.error.code === '42703' || String(profilesRes.error.message || '').includes('referred_by'))) {
        profilesRes = (await db
          .from('profiles')
          .select('id, full_name, phone, city, area_name, avatar_url, account_status, referral_code, company_name, contact_person, created_at, updated_at')
          .order('created_at', { ascending: false })) as any;
      }

      const rolesRes = await db.from('user_roles').select('user_id, role');

      if (profilesRes.error) {
        await logSupabaseError({
          err: profilesRes.error,
          operation: 'GET_ALL_USERS',
          sourceTable: 'profiles',
          executionDurationMs: Date.now() - startTime,
        });
        throw profilesRes.error;
      }

      const roleMap = new Map<string, UserRole>();
      for (const r of rolesRes.data || []) {
        roleMap.set(r.user_id, r.role === 'admin' ? 'admin' : r.role === 'advertiser' ? 'advertiser' : 'user');
      }

      const emailMap = new Map<string, string>();
      try {
        const adminClient = getSupabaseAdminClient();
        const { data: authList } = await adminClient.auth.admin.listUsers({ perPage: 1000 });
        const authUsers: any[] = (authList?.users as any[]) || [];
        for (const u of authUsers) {
          if (u.email && u.id) emailMap.set(u.id, u.email);
        }
      } catch {
        // Ignore if service role key is unavailable
      }

      return (profilesRes.data || []).map((p: any) => {
        const fastGeo = geoService.resolveFastGeoLabels({
          countryId: p.country_id,
          divisionId: p.administrative_division_id,
        });
        return {
          id: p.id,
          fullName: p.full_name || '',
          phone: p.phone || '',
          email: emailMap.get(p.id) || '',
          avatarUrl: p.avatar_url || '',
          role: roleMap.get(p.id) || 'user',
          status: (p.account_status as AccountStatus) || 'active',
          referralCode: p.referral_code || '',
          referredBy: p.referred_by || undefined,
          city: p.city || p.area_name || 'صنعاء',
          areaName: p.area_name || null,
          countryId: p.country_id || null,
          countryCode: fastGeo.countryCode || null,
          countryNameAr: fastGeo.countryNameAr || null,
          countryFlag: fastGeo.countryFlag || null,
          administrativeDivisionId: p.administrative_division_id || null,
          locationPath: fastGeo.locationPath || null,
          companyName: p.company_name || undefined,
          contactPerson: p.contact_person || undefined,
          createdAt: p.created_at || new Date().toISOString(),
          updatedAt: p.updated_at || new Date().toISOString(),
        };
      });
    } catch (err: any) {
      console.error('[Supabase GET_ALL_USERS]', err.message);
      throw new Error(`فشل جلب قائمة المستخدمين من Supabase: ${err.message}`);
    }
  },

  async updateUserProfileLocation(
    userId: string,
    payload: { countryId: string; administrativeDivisionId?: string | null; areaName?: string; city?: string },
    authToken?: string
  ): Promise<UserProfile> {
    const validated = await geoService.validateGeoSelection({
      countryId: payload.countryId,
      divisionId: payload.administrativeDivisionId || null,
      requireActiveCountry: true,
      authToken,
    });

    const displayCity =
      payload.city?.trim() ||
      validated.division?.nameAr ||
      validated.country?.nameAr ||
      'صنعاء';
    const displayArea = payload.areaName?.trim() || validated.division?.nameAr || null;
    const db = getActorOrAdminClient(authToken);
    const now = new Date().toISOString();

    const { error } = await db
      .from('profiles')
      .update({
        country_id: validated.country?.id || payload.countryId,
        administrative_division_id: validated.division?.id || null,
        city: displayCity,
        area_name: displayArea,
        updated_at: now,
      })
      .eq('id', userId);

    if (error && error.code === '42703') {
      // Pre-028 fallback: still store clean resolved city/area_name
      const legacy = await db
        .from('profiles')
        .update({
          city: validated.locationPath || displayCity,
          area_name: displayArea,
          updated_at: now,
        })
        .eq('id', userId);
      if (legacy.error) throw new Error(legacy.error.message);
    } else if (error) {
      throw new Error(error.message);
    }

    const updated = await this.findUserById(userId);
    if (!updated) throw new Error('تعذر قراءة الملف الشخصي بعد التحديث.');
    return updated;
  },

  async updateUserStatus(userId: string, status: 'active' | 'suspended' | 'under_review' | 'pending'): Promise<void> {
    const startTime = Date.now();
    const db = getDbClient();
    try {
      const { error } = await db
        .from('profiles')
        .update({ account_status: status, updated_at: new Date().toISOString() })
        .eq('id', userId);

      if (error) {
        await logSupabaseError({
          err: error,
          operation: 'UPDATE_USER_STATUS',
          sourceTable: 'profiles',
          executionDurationMs: Date.now() - startTime,
        });
        throw error;
      }
    } catch (err: any) {
      throw new Error(`فشل تحديث حالة المستخدم في Supabase: ${err.message}`);
    }
  },

  /**
   * 2. WALLETS & FINANCIAL ACCOUNTS (Double-Entry Ledger Backed)
   */
  async ensureUserFinancialAccount(userId: string): Promise<{
    walletRow: any;
    accountRow: any;
  }> {
    const startTime = Date.now();
    const cleanUserId = userId.trim();
    const db = getDbClient();

    // 1. Fetch or create wallets row (live schema: id, user_id, wallet_address, status, created_at)
    const { data: walletList, error: walletFetchErr } = await db
      .from('wallets')
      .select('id, user_id, wallet_address, status, created_at')
      .eq('user_id', cleanUserId)
      .order('created_at', { ascending: true })
      .limit(1);

    if (walletFetchErr) {
      await logSupabaseError({
        err: walletFetchErr,
        operation: 'GET_WALLETS_FETCH',
        sourceTable: 'wallets',
        executionDurationMs: Date.now() - startTime,
      });
      throw walletFetchErr;
    }

    let walletRow = walletList && walletList.length > 0 ? walletList[0] : null;
    if (!walletRow) {
      const now = new Date().toISOString();
      const newWallet = {
        id: crypto.randomUUID(),
        user_id: cleanUserId,
        wallet_address: generateWalletAddress(cleanUserId),
        status: 'active',
        created_at: now,
      };
      const { data: insertedWallet, error: insertWalletErr } = await db
        .from('wallets')
        .insert(newWallet)
        .select('id, user_id, wallet_address, status, created_at')
        .maybeSingle();

      if (insertWalletErr) {
        const isDuplicate =
          insertWalletErr.code === '23505' ||
          String(insertWalletErr.message || '').toLowerCase().includes('duplicate');
        if (isDuplicate) {
          const { data: retryList } = await db
            .from('wallets')
            .select('id, user_id, wallet_address, status, created_at')
            .eq('user_id', cleanUserId)
            .order('created_at', { ascending: true })
            .limit(1);
          walletRow = retryList?.[0] || null;
        } else {
          await logSupabaseError({
            err: insertWalletErr,
            operation: 'CREATE_INITIAL_WALLET',
            sourceTable: 'wallets',
            executionDurationMs: Date.now() - startTime,
          });
          throw insertWalletErr;
        }
      } else {
        walletRow = insertedWallet;
      }
    }

    if (!walletRow) {
      throw new Error('تعذر تهيئة سجل المحفظة في قاعدة البيانات.');
    }

    // 2. Fetch or create matching financial_accounts row (WALLET-<wallet.id>)
    const { data: faList, error: faErr } = await db
      .from('financial_accounts')
      .select('id, account_code, account_type, owner_user_id, wallet_id, normal_side, balance_units, status, created_at')
      .eq('account_type', 'wallet')
      .or(`wallet_id.eq.${walletRow.id},owner_user_id.eq.${cleanUserId}`)
      .order('created_at', { ascending: true })
      .limit(1);

    if (faErr) {
      await logSupabaseError({
        err: faErr,
        operation: 'GET_FINANCIAL_ACCOUNT_FETCH',
        sourceTable: 'financial_accounts',
        executionDurationMs: Date.now() - startTime,
      });
      throw faErr;
    }

    let accountRow = faList && faList.length > 0 ? faList[0] : null;
    if (!accountRow) {
      const now = new Date().toISOString();
      const newFa = {
        id: crypto.randomUUID(),
        account_code: `WALLET-${walletRow.id}`,
        account_type: 'wallet',
        owner_user_id: cleanUserId,
        wallet_id: walletRow.id,
        normal_side: 'credit',
        balance_units: 0,
        status: 'active',
        created_at: now,
      };
      const { data: insertedFa, error: insertFaErr } = await db
        .from('financial_accounts')
        .insert(newFa)
        .select('id, account_code, account_type, owner_user_id, wallet_id, normal_side, balance_units, status, created_at')
        .maybeSingle();

      if (insertFaErr) {
        const isDuplicate =
          insertFaErr.code === '23505' ||
          String(insertFaErr.message || '').toLowerCase().includes('duplicate');
        if (isDuplicate) {
          const { data: retryFa } = await db
            .from('financial_accounts')
            .select('id, account_code, account_type, owner_user_id, wallet_id, normal_side, balance_units, status, created_at')
            .eq('account_type', 'wallet')
            .eq('wallet_id', walletRow.id)
            .limit(1);
          accountRow = retryFa?.[0] || null;
        } else {
          // If direct INSERT is blocked by Migration 013 privilege hardening, invoke SECURITY DEFINER RPC
          const { data: rpcAccId } = await db.rpc('ensure_own_financial_account');
          if (rpcAccId) {
            const { data: rpcFa } = await db
              .from('financial_accounts')
              .select('id, account_code, account_type, owner_user_id, wallet_id, normal_side, balance_units, status, created_at')
              .eq('id', String(rpcAccId))
              .maybeSingle();
            accountRow = rpcFa || null;
          }
          if (!accountRow) {
            await logSupabaseError({
              err: insertFaErr,
              operation: 'CREATE_FINANCIAL_ACCOUNT',
              sourceTable: 'financial_accounts',
              executionDurationMs: Date.now() - startTime,
            });
            throw insertFaErr;
          }
        }
      } else {
        accountRow = insertedFa;
      }
    }

    if (!accountRow) {
      throw new Error('تعذر تهيئة الحساب المالي المرتبط بالمحفظة.');
    }

    return { walletRow, accountRow };
  },

  async getWallet(userId: string): Promise<UserWallet> {
    if (!userId || typeof userId !== 'string' || !userId.trim()) {
      throw new Error('معرف المستخدم غير صالح للجلب من المحفظة.');
    }
    const cleanUserId = userId.trim();
    const db = getDbClient();

    try {
      const { walletRow, accountRow } = await this.ensureUserFinancialAccount(cleanUserId);
      const availableBalance = Number(accountRow.balance_units || 0);

      // Compute real earned & transferred totals from posted ledger_entries
      let totalEarned = 0;
      let totalTransferred = 0;
      let totalWithdrawn = 0;

      const { data: entries } = await db
        .from('ledger_entries')
        .select('entry_side, amount_units, ledger_transactions(transaction_type)')
        .eq('account_id', accountRow.id);

      for (const e of entries || []) {
        const txType = String((e as any).ledger_transactions?.transaction_type || '').toUpperCase();
        const amt = Number(e.amount_units || 0);
        if (
          e.entry_side === 'credit' &&
          (txType === 'TASK_REWARD_PAYOUT' ||
            txType === 'TASK_REWARD' ||
            txType === 'REFERRAL_REWARD' ||
            txType === 'PROMOTIONAL_BONUS' ||
            txType === 'CLIXWALL_REWARD')
        ) {
          totalEarned += amt;
        }
        if (e.entry_side === 'debit' && txType === 'CLIXWALL_REVERSAL') {
          totalEarned = Math.max(0, totalEarned - amt);
        }
        if (
          e.entry_side === 'debit' &&
          (txType === 'WALLET_TRANSFER' || txType === 'WALLET_TRANSFER_SENT')
        ) {
          totalTransferred += amt;
        }
        if (e.entry_side === 'debit' && txType === 'WITHDRAWAL_REQUEST') {
          totalWithdrawn += amt;
        }
      }

      const rawStatus = String(walletRow.status || 'active').toUpperCase();
      return {
        id: walletRow.id,
        userId: walletRow.user_id,
        walletAddress: walletRow.wallet_address || generateWalletAddress(cleanUserId),
        availableBalance,
        pendingBalance: 0,
        reservedBalance: 0,
        totalEarned,
        totalTransferred,
        totalWithdrawn,
        status: rawStatus === 'SUSPENDED' ? 'SUSPENDED' : 'ACTIVE',
        currency: 'YER',
        createdAt: walletRow.created_at,
        updatedAt: walletRow.created_at,
      };
    } catch (err: any) {
      console.error('[Supabase GET_WALLET Error]', err.message);
      throw new Error(`فشل جلب بيانات المحفظة من Supabase: ${err.message}`);
    }
  },

  async getTransactions(userId?: string): Promise<WalletTransaction[]> {
    const startTime = Date.now();
    const db = getDbClient();

    try {
      if (!userId) {
        const { data: entries, error } = await db
          .from('ledger_entries')
          .select('id, transaction_id, account_id, entry_side, amount_units, memo, created_at, ledger_transactions(*), financial_accounts(owner_user_id)')
          .order('created_at', { ascending: false })
          .limit(200);

        if (error) {
          await logSupabaseError({
            err: error,
            operation: 'GET_ALL_TRANSACTIONS',
            sourceTable: 'ledger_entries',
            executionDurationMs: Date.now() - startTime,
          });
          return [];
        }

        return (entries || []).map((e: any) => {
          const tx = e.ledger_transactions || {};
          const amt = Number(e.amount_units || 0);
          const signedAmount = e.entry_side === 'credit' ? amt : -amt;
          return {
            id: e.id,
            userId: e.financial_accounts?.owner_user_id || '',
            type: mapLedgerTxType(tx.transaction_type, e.entry_side),
            amount: signedAmount,
            previousBalance: 0,
            newBalance: 0,
            status: 'COMPLETED',
            referenceId: tx.reference || tx.id,
            idempotencyKey: tx.idempotency_key,
            description:
              e.memo ||
              tx.metadata?.description ||
              tx.metadata?.task_title ||
              tx.metadata?.note ||
              tx.transaction_type ||
              'عملية مالية',
            adminId: tx.created_by || undefined,
            metadata: tx.metadata || {},
            createdAt: e.created_at || tx.created_at,
          };
        });
      }

      const { accountRow } = await this.ensureUserFinancialAccount(userId);
      const currentBalance = Number(accountRow.balance_units || 0);

      const { data: entries, error } = await db
        .from('ledger_entries')
        .select('id, transaction_id, account_id, entry_side, amount_units, memo, created_at, ledger_transactions(*)')
        .eq('account_id', accountRow.id)
        .order('created_at', { ascending: false })
        .limit(200);

      if (error) {
        await logSupabaseError({
          err: error,
          operation: 'GET_USER_TRANSACTIONS',
          sourceTable: 'ledger_entries',
          executionDurationMs: Date.now() - startTime,
        });
        return [];
      }

      // Compute exact running previousBalance & newBalance backwards from current balance_units
      let runningBalance = currentBalance;
      return (entries || []).map((e: any) => {
        const tx = e.ledger_transactions || {};
        const amt = Number(e.amount_units || 0);
        const signedAmount = e.entry_side === 'credit' ? amt : -amt;
        const newBal = runningBalance;
        const prevBal = Math.max(0, runningBalance - signedAmount);
        runningBalance = prevBal;

        const mappedType = mapLedgerTxType(tx.transaction_type, e.entry_side);
        const desc =
          e.memo ||
          (tx.metadata?.task_title ? `مكافأة إنجاز مهمة: ${tx.metadata.task_title}` : undefined) ||
          tx.metadata?.description ||
          tx.metadata?.note ||
          tx.reference ||
          mappedType;

        return {
          id: e.id,
          userId,
          type: mappedType,
          amount: signedAmount,
          previousBalance: prevBal,
          newBalance: newBal,
          status: 'COMPLETED',
          referenceId: tx.reference || tx.metadata?.submission_id || tx.id,
          idempotencyKey: tx.idempotency_key,
          description: desc,
          adminId: tx.created_by || undefined,
          metadata: tx.metadata || {},
          createdAt: e.created_at || tx.created_at,
        };
      });
    } catch (err: any) {
      console.error('[Supabase GET_TRANSACTIONS]', err.message);
      return [];
    }
  },

  /**
   * 3. TASKS (Escrow-Backed Creation via create_funded_task)
   */
  async getTasks(params?: { category?: string; search?: string; countryId?: string; divisionId?: string }): Promise<TaskItem[]> {
    const startTime = Date.now();
    const db = getDbClient();

    const buildQuery = (applyCategoryFilter: boolean) => {
      let query = db
        .from('tasks')
        .select('*')
        .in('status', ['active', 'ACTIVE']);

      if (applyCategoryFilter && params?.category && params.category !== 'all') {
        query = query.eq('category', params.category);
      }
      if (params?.search) {
        query = query.ilike('title', `%${params.search}%`);
      }
      return query.order('created_at', { ascending: false });
    };

    try {
      const shouldFilterCategoryInSql = Boolean(params?.category && params.category !== 'all');
      let { data, error } = await buildQuery(shouldFilterCategoryInSql);

      if (
        error &&
        shouldFilterCategoryInSql &&
        (error.code === '42703' ||
          error.code === 'PGRST204' ||
          String(error.message || '').toLowerCase().includes('category'))
      ) {
        const fallbackRes = await buildQuery(false);
        data = fallbackRes.data;
        error = fallbackRes.error;
      }

      if (error) {
        await logSupabaseError({
          err: error,
          operation: 'GET_TASKS',
          sourceTable: 'tasks',
          executionDurationMs: Date.now() - startTime,
        });
        throw error;
      }

      let mapped = await hydrateTaskListGeo((data || []).map((t) => mapTaskRow(t)), db);
      if (params?.category && params.category !== 'all') {
        mapped = mapped.filter((t) => t.category === params.category);
      }

      if (params?.countryId || params?.divisionId) {
        let targetCountryId = params.countryId ? String(params.countryId).trim() : '';
        let matchDivisionIds = new Set<string>();

        if (params.divisionId) {
          const divId = String(params.divisionId).trim();
          const [descendants, pathInfo] = await Promise.all([
            geoService.expandDivisionAndDescendants(divId),
            geoService.getDivisionPath(divId),
          ]);
          for (const id of descendants) matchDivisionIds.add(id);
          for (const p of pathInfo.path) matchDivisionIds.add(p.id);
          if (!targetCountryId && pathInfo.division?.countryId) {
            targetCountryId = pathInfo.division.countryId;
          }
        }

        const resolvedCountry = targetCountryId ? await geoService.resolveCountry(targetCountryId) : null;
        const effectiveCountryId = resolvedCountry?.id || targetCountryId;
        const isYemenFilter = resolvedCountry?.iso2 === 'YE';

        mapped = mapped.filter((t) => {
          // Legacy tasks without country_id belong to YE or global platform tasks
          const taskCountry = t.countryId || null;
          if (effectiveCountryId) {
            if (taskCountry && taskCountry !== effectiveCountryId) return false;
            if (!taskCountry && !isYemenFilter) return false;
          }
          if (params.divisionId) {
            if (t.isNationwide && (!t.targetDivisionIds || t.targetDivisionIds.length === 0) && !t.administrativeDivisionId) {
              return true;
            }
            if (t.administrativeDivisionId && matchDivisionIds.has(t.administrativeDivisionId)) {
              return true;
            }
            if (t.targetDivisionIds && t.targetDivisionIds.some((id) => matchDivisionIds.has(id))) {
              return true;
            }
            return false;
          }
          return true;
        });
      }

      return mapped;
    } catch (err: any) {
      console.error('[Supabase GET_TASKS]', err.message);
      throw new Error(`فشل جلب قائمة المهام من Supabase: ${err.message}`);
    }
  },

  async getAllAdminTasks(): Promise<TaskItem[]> {
    const startTime = Date.now();
    const db = getDbClient();
    try {
      const { data, error } = await db
        .from('tasks')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        await logSupabaseError({
          err: error,
          operation: 'GET_ALL_ADMIN_TASKS',
          sourceTable: 'tasks',
          executionDurationMs: Date.now() - startTime,
        });
        throw error;
      }

      return hydrateTaskListGeo(
        (data || []).map((row) => mapTaskRow(row, { maskHiddenIdentity: false })),
        db
      );
    } catch (err: any) {
      throw new Error(`فشل جلب مهام المدير من Supabase: ${err.message}`);
    }
  },

  async getTaskById(id: string): Promise<TaskItem | null> {
    const db = getDbClient();
    try {
      const { data, error } = await db
        .from('tasks')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (error) throw error;
      if (!data) return null;

      const [hydrated] = await hydrateTaskListGeo([mapTaskRow(data)], db);
      return hydrated;
    } catch (err: any) {
      throw new Error(`فشل جلب تفاصيل المهمة من Supabase: ${err.message}`);
    }
  },

  async createTask(taskData: {
    title: string;
    description: string;
    category?: string;
    rewardYer: number;
    totalQuantity: number;
    deadline?: string;
    creationKey?: string;
    countryId?: string | null;
    administrativeDivisionId?: string | null;
    isNationwide?: boolean;
    targetDivisionIds?: string[];
    authToken?: string;
  }): Promise<TaskItem> {
    const startTime = Date.now();
    if (!taskData.authToken) {
      throw new Error('جلسة المدير المطلوبة لتمويل المهمة من الخزينة غير متوفرة.');
    }

    const rewardUnits = Math.round(Number(taskData.rewardYer));
    const slots = Math.round(Number(taskData.totalQuantity));
    if (!Number.isFinite(rewardUnits) || rewardUnits <= 0 || !Number.isFinite(slots) || slots <= 0) {
      throw new Error('يجب أن تكون مكافأة المهمة وعدد المقاعد أعداداً صحيحة أكبر من صفر.');
    }

    let geoValidated: Awaited<ReturnType<typeof geoService.validateGeoSelection>> | null = null;
    if (taskData.countryId || taskData.administrativeDivisionId || (taskData.targetDivisionIds && taskData.targetDivisionIds.length > 0)) {
      geoValidated = await geoService.validateGeoSelection({
        countryId: taskData.countryId,
        divisionId: taskData.administrativeDivisionId,
        divisionIds: taskData.targetDivisionIds,
        requireActiveCountry: true,
        authToken: taskData.authToken,
      });
    }

    const creationKey = taskData.creationKey?.trim() || `TASK-${crypto.randomUUID()}`;

    try {
      const userClient = getSupabaseUserClient(taskData.authToken);
      const { data: createdTaskId, error } = await userClient.rpc('create_funded_task', {
        p_title: taskData.title.trim(),
        p_description: taskData.description.trim(),
        p_reward_units: rewardUnits,
        p_slots: slots,
        p_creation_key: creationKey,
        p_deadline_at: taskData.deadline || null,
      });

      if (error || !createdTaskId) {
        await logSupabaseError({
          err: error || 'create_funded_task returned null',
          operation: 'CREATE_FUNDED_TASK_RPC',
          sourceTable: 'tasks',
          executionDurationMs: Date.now() - startTime,
        });
        throw new Error(error?.message || 'فشل إنشاء المهمة وحجز ميزانيتها في حساب الضمان (ESCROW).');
      }

      const db = getActorOrAdminClient(taskData.authToken);
      if (taskData.category) {
        try {
          await db.from('tasks').update({ category: taskData.category }).eq('id', String(createdTaskId));
        } catch {}
      }

      if (geoValidated?.country) {
        const isNationwide =
          taskData.isNationwide !== undefined
            ? Boolean(taskData.isNationwide)
            : geoValidated.divisions.length === 0 && !geoValidated.division;
        try {
          await db
            .from('tasks')
            .update({
              country_id: geoValidated.country.id,
              administrative_division_id: geoValidated.division?.id || null,
              is_nationwide: isNationwide,
            })
            .eq('id', String(createdTaskId));

          if (!isNationwide && geoValidated.divisions.length > 0) {
            await db.from('task_target_divisions').upsert(
              geoValidated.divisions.map((d) => ({
                task_id: String(createdTaskId),
                country_id: d.countryId,
                division_id: d.id,
              })),
              { onConflict: 'task_id,division_id' }
            );
          }
        } catch {
          // Safe fallback if pre-028 schema
        }
      }

      const task = await this.getTaskById(String(createdTaskId));
      if (!task) {
        throw new Error('تم إنشاء المهمة لكن تعذر قراءة بياناتها.');
      }
      return task;
    } catch (err: any) {
      throw new Error(`فشل إنشاء المهمة في Supabase: ${err.message}`);
    }
  },

  /**
   * 4. SUBMISSIONS
   */
  async submitTaskProof(payload: {
    taskId: string;
    userId: string;
    authToken?: string;
    proofText?: string;
    proofImages?: string[];
    proofUrl?: string;
  }): Promise<TaskSubmission> {
    const startTime = Date.now();
    const db = getDbClient();

    try {
      if (!payload.taskId || !payload.userId) {
        throw new Error('معرف المهمة ومعرف المستخدم مطلوبان لإرسال الإثبات.');
      }

      // 1. Verify task exists and is active & available
      const { data: taskData, error: taskError } = await db
        .from('tasks')
        .select('*')
        .eq('id', payload.taskId)
        .maybeSingle();

      if (taskError) {
        await logSupabaseError({
          err: taskError,
          operation: 'SUBMIT_TASK_PROOF_CHECK_TASK',
          sourceTable: 'tasks',
          executionDurationMs: Date.now() - startTime,
        });
        throw taskError;
      }

      if (!taskData) {
        throw new Error('المهمة المطلوبة غير موجودة.');
      }

      const taskStatus = String(taskData.status || '').toUpperCase();
      if (taskStatus !== 'ACTIVE') {
        throw new Error('هذه المهمة غير نشطة أو غير متاحة حالياً للتنفيذ.');
      }

      const totalQty = Number(taskData.total_quantity ?? taskData.slots ?? 0);
      const completedQty = Number(taskData.completed_quantity ?? taskData.approved_count ?? 0);
      if (totalQty > 0 && completedQty >= totalQty) {
        throw new Error('تم استيفاء العدد المطلوب لهذه المهمة ولم تعد متاحة.');
      }

      const deadline = taskData.deadline ?? taskData.deadline_at;
      if (deadline && new Date(deadline).getTime() < Date.now()) {
        throw new Error('انتهت مهلة تنفيذ هذه المهمة.');
      }

      // 2. Sanitize and validate proof fields
      const cleanProofText =
        typeof payload.proofText === 'string' && payload.proofText.trim().length > 0
          ? payload.proofText.trim()
          : undefined;

      const cleanProofImages: string[] = Array.isArray(payload.proofImages)
        ? payload.proofImages
            .filter((img): img is string => typeof img === 'string' && img.trim().length > 0)
            .map((img) => img.trim())
        : [];

      const cleanProofUrl =
        typeof payload.proofUrl === 'string' && payload.proofUrl.trim().length > 0
          ? payload.proofUrl.trim()
          : undefined;

      if (!cleanProofText && cleanProofImages.length === 0 && !cleanProofUrl) {
        throw new Error('يرجى تقديم نص الإثبات أو صورة أو رابط قبل الإرسال.');
      }

      // 3. Check duplicate submission (block pending/under_review/approved; allow resubmission if rejected)
      const { data: existingList, error: existingError } = await db
        .from('task_submissions')
        .select('id, status')
        .eq('task_id', payload.taskId)
        .eq('user_id', payload.userId)
        .order('created_at', { ascending: false });

      if (existingError) {
        await logSupabaseError({
          err: existingError,
          operation: 'SUBMIT_TASK_PROOF_CHECK_DUPLICATE',
          sourceTable: 'task_submissions',
          executionDurationMs: Date.now() - startTime,
        });
        throw existingError;
      }

      if (existingList && existingList.length > 0) {
        const statuses = existingList.map((row: any) => String(row.status || '').toUpperCase());
        if (statuses.includes('APPROVED')) {
          throw new Error('لقد أنجزت هذه المهمة بالفعل واستلمت مكافأتها مسبقاً.');
        }
        if (statuses.includes('PENDING') || statuses.includes('UNDER_REVIEW')) {
          throw new Error('لديك إثبات قيد المراجعة لهذه المهمة بالفعل.');
        }
      }

      // 4. Build JSONB proof payload matching live task_submissions.proof schema
      const proofPayload: Record<string, any> = {};
      if (cleanProofText) proofPayload.text = cleanProofText;
      if (cleanProofUrl) proofPayload.url = cleanProofUrl;
      if (cleanProofImages.length > 0) {
        proofPayload.images = cleanProofImages;
        proofPayload.storage_path = cleanProofImages[0];
      }

      let submissionId: string | null = null;

      if (payload.authToken) {
        const userClient = getSupabaseUserClient(payload.authToken);
        const { data: rpcId, error: rpcErr } = await userClient.rpc('submit_task_proof', {
          p_task_id: payload.taskId,
          p_proof: proofPayload,
        });

        if (rpcErr) {
          // Pre-migration 010 live DB rejects `images` key in submit_task_proof RPC;
          // insert directly into `task_submissions.proof` only for that exact legacy constraint.
          const msg = String(rpcErr.message || '');
          if (msg.includes('Unsupported proof field') && cleanProofImages.length > 0) {
            const { data: insertedSub, error: insertErr } = await db
              .from('task_submissions')
              .insert({
                task_id: payload.taskId,
                user_id: payload.userId,
                proof: proofPayload,
                status: 'pending',
                created_at: new Date().toISOString(),
              })
              .select('id')
              .single();

            if (insertErr) {
              await logSupabaseError({
                err: insertErr,
                operation: 'SUBMIT_TASK_PROOF_FALLBACK_INSERT',
                sourceTable: 'task_submissions',
                executionDurationMs: Date.now() - startTime,
              });
              throw insertErr;
            }
            submissionId = insertedSub.id;
          } else {
            await logSupabaseError({
              err: rpcErr,
              operation: 'SUBMIT_TASK_PROOF_RPC',
              sourceTable: 'task_submissions',
              executionDurationMs: Date.now() - startTime,
            });
            throw rpcErr;
          }
        } else {
          submissionId = String(rpcId);
        }
      } else {
        const { data: insertedSub, error: insertErr } = await db
          .from('task_submissions')
          .insert({
            task_id: payload.taskId,
            user_id: payload.userId,
            proof: proofPayload,
            status: 'pending',
            created_at: new Date().toISOString(),
          })
          .select('id')
          .single();

        if (insertErr) throw insertErr;
        submissionId = insertedSub.id;
      }

      const { data: createdRow, error: fetchErr } = await db
        .from('task_submissions')
        .select('*')
        .eq('id', submissionId!)
        .single();

      if (fetchErr || !createdRow) {
        throw fetchErr || new Error('تعذر جلب الإثبات بعد إنشائه.');
      }

      const proofObj = createdRow.proof && typeof createdRow.proof === 'object' ? createdRow.proof : {};
      return {
        id: createdRow.id,
        taskId: createdRow.task_id,
        userId: createdRow.user_id,
        taskTitle: taskData.title || 'مهمة مصغرة',
        taskRewardYer: Number(taskData.reward_units ?? taskData.reward_yer ?? 0),
        proofText: proofObj.text ?? createdRow.proof_text ?? undefined,
        proofImages: Array.isArray(proofObj.images)
          ? proofObj.images
          : Array.isArray(createdRow.proof_images)
            ? createdRow.proof_images
            : [],
        proofUrl: proofObj.url ?? createdRow.proof_url ?? undefined,
        status: String(createdRow.status || 'PENDING').toUpperCase() as TaskSubmission['status'],
        rejectionReason: createdRow.review_note ?? createdRow.rejection_reason ?? undefined,
        reviewedBy: createdRow.reviewed_by ?? undefined,
        reviewedAt: createdRow.reviewed_at ?? undefined,
        rewardTransactionId: createdRow.reward_transaction_id ?? undefined,
        createdAt: createdRow.created_at,
      };
    } catch (err: any) {
      throw new Error(`فشل إرسال إثبات المهمة إلى Supabase: ${err.message}`);
    }
  },

  async getMySubmissions(userId: string): Promise<TaskSubmission[]> {
    const db = getDbClient();
    try {
      const { data, error } = await db
        .from('task_submissions')
        .select('*, tasks(*)')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      return (data || []).map((s: any) => {
        const proofObj = s.proof && typeof s.proof === 'object' ? s.proof : {};
        return {
          id: s.id,
          taskId: s.task_id,
          userId: s.user_id,
          taskTitle: s.tasks?.title || 'مهمة مصغرة',
          taskRewardYer: Number(s.tasks?.reward_units ?? s.tasks?.reward_yer ?? 0),
          proofText: proofObj.text ?? s.proof_text ?? undefined,
          proofImages: Array.isArray(proofObj.images)
            ? proofObj.images
            : Array.isArray(s.proof_images)
              ? s.proof_images
              : [],
          proofUrl: proofObj.url ?? s.proof_url ?? undefined,
          status: String(s.status || 'PENDING').toUpperCase() as TaskSubmission['status'],
          rejectionReason: s.review_note ?? s.rejection_reason ?? undefined,
          reviewedBy: s.reviewed_by ?? undefined,
          reviewedAt: s.reviewed_at ?? undefined,
          rewardTransactionId: s.reward_transaction_id ?? undefined,
          createdAt: s.created_at,
        };
      });
    } catch (err: any) {
      console.error('[Supabase GET_MY_SUBMISSIONS]', err.message);
      return [];
    }
  },

  async getAllSubmissions(): Promise<TaskSubmission[]> {
    const db = getDbClient();
    try {
      const [subsRes, profilesRes] = await Promise.all([
        db
          .from('task_submissions')
          .select('*, tasks(*)')
          .order('created_at', { ascending: false }),
        db.from('profiles').select('id, full_name, phone'),
      ]);

      if (subsRes.error) throw subsRes.error;

      const profileMap = new Map<string, { fullName: string; phone: string }>();
      for (const p of profilesRes.data || []) {
        profileMap.set(p.id, {
          fullName: p.full_name || 'مستخدم',
          phone: p.phone || '',
        });
      }

      return (subsRes.data || []).map((s: any) => {
        const proofObj = s.proof && typeof s.proof === 'object' ? s.proof : {};
        const prof = profileMap.get(s.user_id);
        return {
          id: s.id,
          taskId: s.task_id,
          userId: s.user_id,
          userFullName: prof?.fullName || 'مستخدم',
          userPhone: prof?.phone || '',
          taskTitle: s.tasks?.title || 'مهمة مصغرة',
          taskRewardYer: Number(s.tasks?.reward_units ?? s.tasks?.reward_yer ?? 0),
          proofText: proofObj.text ?? s.proof_text ?? undefined,
          proofImages: Array.isArray(proofObj.images)
            ? proofObj.images
            : Array.isArray(s.proof_images)
              ? s.proof_images
              : [],
          proofUrl: proofObj.url ?? s.proof_url ?? undefined,
          status: String(s.status || 'PENDING').toUpperCase() as TaskSubmission['status'],
          rejectionReason: s.review_note ?? s.rejection_reason ?? undefined,
          reviewedBy: s.reviewed_by ?? undefined,
          reviewedAt: s.reviewed_at ?? undefined,
          rewardTransactionId: s.reward_transaction_id ?? undefined,
          createdAt: s.created_at,
        };
      });
    } catch (err: any) {
      console.error('[Supabase GET_ALL_SUBMISSIONS]', err.message);
      return [];
    }
  },

  /**
   * 5. TREASURY & DOUBLE-ENTRY LEDGER (Live financial_accounts & ledger_transactions)
   */
  async writeFinancialAuditLog(params: {
    actionType: string;
    actorId?: string | null;
    transactionId?: string | null;
    details?: Record<string, any>;
    ipAddress?: string | null;
    authToken?: string;
  }) {
    const db = getActorOrAdminClient(params.authToken);
    const now = new Date().toISOString();
    try {
      await db.from('financial_audit_logs').insert({
        id: crypto.randomUUID(),
        action_type: params.actionType,
        actor_id: params.actorId || null,
        transaction_id: params.transactionId || null,
        details: params.details || {},
        ip_address: params.ipAddress || null,
        created_at: now,
      });
    } catch {
      // financial_audit_logs awaits Migration 011
    }
    try {
      await db.from('admin_logs').insert({
        actor_id: params.actorId || null,
        action: params.actionType,
        entity_type: 'ledger_transaction',
        entity_id: params.transactionId || null,
        details: params.details || {},
        created_at: now,
      });
    } catch {
      // Ignore secondary log failure
    }
  },

  async getTreasurySummary(authToken?: string): Promise<TreasurySummary> {
    const db = getActorOrAdminClient(authToken);
    const adminClient = getSupabaseAdminClient();
    const [
      accountsRes,
      tasksRes,
      taxDefRes,
      taxSettleRes,
      auditRes,
      withdrawRes,
      profilesRolesRes,
      userRolesRes,
      extAccountsRes,
      extDepositsRes,
      extAdvLedgerRes,
    ] = await Promise.all([
      db
        .from('financial_accounts')
        .select('id, account_code, account_type, owner_user_id, balance_units, status'),
      db
        .from('tasks')
        .select('status, total_budget_units, approved_count, reward_units, budget_spent_yer'),
      db.from('tax_definitions').select('id', { count: 'exact', head: true }),
      db.from('tax_settlements').select('tax_amount, status'),
      db.from('financial_audit_logs').select('id', { count: 'exact', head: true }),
      db.from('withdrawal_requests').select('id', { count: 'exact', head: true }),
      adminClient.from('profiles').select('id, role'),
      adminClient.from('user_roles').select('user_id, role'),
      db.from('external_accounts').select('id, fund_scope, financial_account_id, actual_balance_units, status'),
      db.from('external_deposits').select('id, amount_units, status, deposit_purpose'),
      db
        .from('ledger_transactions')
        .select('id, transaction_type, ledger_entries(amount_units, entry_side, financial_accounts(account_type))')
        .in('transaction_type', ['EXTERNAL_ADVERTISER_DEPOSIT', 'REVERSAL_EXTERNAL_ADVERTISER_DEPOSIT']),
    ]);

    if (accountsRes.error) {
      throw new Error(`فشل قراءة حسابات الخزينة من Supabase: ${accountsRes.error.message}`);
    }

    const accounts = accountsRes.data || [];
    const byCode = new Map<string, any>();
    const byId = new Map<string, any>();
    for (const a of accounts) {
      if (a.account_code) byCode.set(String(a.account_code), a);
      if (a.id) byId.set(String(a.id), a);
    }

    const bal = (code: string) => Number(byCode.get(code)?.balance_units || 0);

    // Determine authoritative role per user (advertiser vs worker vs admin)
    const roleMap = new Map<string, string>();
    for (const p of profilesRolesRes.data || []) {
      if (p.id && p.role) roleMap.set(String(p.id), String(p.role).toLowerCase());
    }
    for (const ur of userRolesRes.data || []) {
      if (ur.user_id && ur.role) {
        const nextR = String(ur.role).toLowerCase();
        const prevR = roleMap.get(String(ur.user_id));
        if (!prevR || nextR === 'admin' || nextR === 'advertiser') {
          roleMap.set(String(ur.user_id), nextR);
        }
      }
    }

    const totalIssuedUnits = bal('VIRTUAL-ISSUANCE-CONTROL');
    const treasuryAvailable = bal('PLATFORM-TREASURY');
    const taskBudgetReserved = accounts
      .filter((a: any) => String(a.account_code || '').startsWith('TASK-ESCROW-'))
      .reduce((sum: number, a: any) => sum + Number(a.balance_units || 0), 0);
    const campaignBudgetReserved = accounts
      .filter((a: any) => String(a.account_code || '').startsWith('CAMPAIGN-ESCROW-'))
      .reduce((sum: number, a: any) => sum + Number(a.balance_units || 0), 0);
    const campaignFeeReserved = accounts
      .filter((a: any) => String(a.account_code || '').startsWith('CAMPAIGN-FEE-ESCROW-'))
      .reduce((sum: number, a: any) => sum + Number(a.balance_units || 0), 0);

    let advertiserWalletTotal = 0;
    let workerWalletTotal = 0;
    let userAvailableTotal = 0;
    for (const a of accounts) {
      if (a.account_type !== 'wallet') continue;
      const units = Number(a.balance_units || 0);
      userAvailableTotal += units;
      const ownerRole = a.owner_user_id ? roleMap.get(String(a.owner_user_id)) : 'user';
      if (ownerRole === 'advertiser') {
        advertiserWalletTotal += units;
      } else {
        workerWalletTotal += units;
      }
    }

    // External accounts & receipt-backed custody stats
    const externalAccountsReady = !extAccountsRes.error && !extDepositsRes.error;
    let externalAccountsTotal = 0;
    let externalActualTotal = 0;
    let externalPlatformBalance = 0;
    let externalAdvertiserCustodyBalance = 0;
    let activeExternalCount = 0;

    if (!extAccountsRes.error && Array.isArray(extAccountsRes.data)) {
      for (const ea of extAccountsRes.data) {
        const finAcc = byId.get(String(ea.financial_account_id));
        const accBal = Number(finAcc?.balance_units || 0);
        const actualBal = Number(ea.actual_balance_units || 0);
        externalAccountsTotal += accBal;
        externalActualTotal += actualBal;
        if (String(ea.status || 'active') === 'active') activeExternalCount += 1;
        if (ea.fund_scope === 'platform') {
          externalPlatformBalance += accBal;
        } else if (ea.fund_scope === 'advertiser') {
          externalAdvertiserCustodyBalance += accBal;
        } else {
          externalPlatformBalance += accBal;
        }
      }
    }

    let pendingExternalDepositsCount = 0;
    let pendingExternalDepositsAmount = 0;
    if (!extDepositsRes.error && Array.isArray(extDepositsRes.data)) {
      for (const dep of extDepositsRes.data) {
        if (dep.status === 'pending') {
          pendingExternalDepositsCount += 1;
          pendingExternalDepositsAmount += Number(dep.amount_units || 0);
        }
      }
    }

    let externalAdvertiserDepositsTotal = 0;
    if (!extAdvLedgerRes.error && Array.isArray(extAdvLedgerRes.data)) {
      for (const tx of extAdvLedgerRes.data) {
        const tType = String(tx.transaction_type || '').toUpperCase();
        for (const le of (tx as any).ledger_entries || []) {
          const isWallet = le.financial_accounts?.account_type === 'wallet';
          if (!isWallet) continue;
          const amt = Number(le.amount_units || 0);
          if (tType === 'EXTERNAL_ADVERTISER_DEPOSIT' && le.entry_side === 'credit') {
            externalAdvertiserDepositsTotal += amt;
          } else if (tType === 'REVERSAL_EXTERNAL_ADVERTISER_DEPOSIT' && le.entry_side === 'debit') {
            externalAdvertiserDepositsTotal -= amt;
          }
        }
      }
    }
    externalAdvertiserDepositsTotal = Math.max(0, externalAdvertiserDepositsTotal);

    const withdrawalReservedTotal = bal('WITHDRAWAL-RESERVED');
    const withdrawalSettledTotal = bal('WITHDRAWAL-SETTLED');
    const revTasks = bal('PLATFORM-REVENUE-TASKS');
    const revAds = bal('PLATFORM-REVENUE-ADS');
    const revSubscriptions = bal('PLATFORM-REVENUE-SUBSCRIPTIONS');
    const revServices = bal('PLATFORM-REVENUE-SERVICES');
    const cashVaultTotal = bal('PLATFORM-CASH-VAULT');
    const ownerCapitalTotal = bal('OWNER-CAPITAL');
    const ownerWithdrawalsTotal = bal('OWNER-WITHDRAWALS');
    const expensesTotal = bal('PLATFORM-EXPENSES');
    const providerFeesTotal = bal('PAYMENT-PROVIDER-FEES');
    const taxPayableTotal = bal('TAX-PAYABLE');
    const retainedEarningsTotal = bal('RETAINED-EARNINGS');

    const totalRevenue = revTasks + revAds + revSubscriptions + revServices;
    const totalOperationalExpenses = expensesTotal + providerFeesTotal;
    const netProfitLoss = totalRevenue - totalOperationalExpenses;
    const computedRetainedEarnings = retainedEarningsTotal + (netProfitLoss - ownerWithdrawalsTotal);
    const userLiabilitiesTotal =
      userAvailableTotal + withdrawalReservedTotal + campaignBudgetReserved + campaignFeeReserved;

    const taxTablesReady = !taxDefRes.error && !taxSettleRes.error;
    const taxesPaidTotal = !taxSettleRes.error
      ? (taxSettleRes.data || [])
          .filter((s: any) => String(s.status || '').toUpperCase() === 'SETTLED')
          .reduce((sum: number, s: any) => sum + Number(s.tax_amount || 0), 0)
      : 0;

    // Compute internal withdrawal fees that came from WITHDRAWAL-RESERVED (part of virtual supply loop)
    let withdrawalFeesFromSupply = 0;
    const revServicesAcc = byCode.get('PLATFORM-REVENUE-SERVICES');
    if (revServicesAcc?.id && revServices > 0) {
      const { data: feeEntries } = await db
        .from('ledger_entries')
        .select('amount_units, entry_side, ledger_transactions(transaction_type)')
        .eq('account_id', revServicesAcc.id);
      for (const fe of feeEntries || []) {
        const txType = String((fe as any).ledger_transactions?.transaction_type || '').toUpperCase();
        if (fe.entry_side === 'credit' && txType === 'WITHDRAWAL_PAYOUT') {
          withdrawalFeesFromSupply += Number(fe.amount_units || 0);
        } else if (fe.entry_side === 'debit' && txType === 'REVERSAL_WITHDRAWAL_PAYOUT') {
          withdrawalFeesFromSupply -= Number(fe.amount_units || 0);
        }
      }
    }

    // Compute campaign fees moved from CAMPAIGN-FEE-ESCROW-* into PLATFORM-REVENUE-ADS (part of virtual supply loop)
    let adFeesFromSupply = 0;
    const revAdsAcc = byCode.get('PLATFORM-REVENUE-ADS');
    if (revAdsAcc?.id && revAds > 0) {
      const { data: adFeeEntries } = await db
        .from('ledger_entries')
        .select('amount_units, entry_side, ledger_transactions(transaction_type, metadata)')
        .eq('account_id', revAdsAcc.id);
      for (const ae of adFeeEntries || []) {
        const tx = (ae as any).ledger_transactions;
        const txType = String(tx?.transaction_type || '').toUpperCase();
        const isCampaignFeeSource = tx?.metadata?.source === 'campaign_fee_escrow';
        if (ae.entry_side === 'credit' && txType === 'AD_REVENUE' && isCampaignFeeSource) {
          adFeesFromSupply += Number(ae.amount_units || 0);
        } else if (ae.entry_side === 'debit' && txType === 'REVERSAL_AD_REVENUE' && isCampaignFeeSource) {
          adFeesFromSupply -= Number(ae.amount_units || 0);
        }
      }
    }

    const activeTasksBudgetTotal = (tasksRes.data || [])
      .filter((t: any) => String(t.status || '').toLowerCase() === 'active')
      .reduce((sum: number, t: any) => {
        const spent = Number(t.budget_spent_yer ?? Number(t.approved_count || 0) * Number(t.reward_units || 0));
        return sum + Math.max(0, Number(t.total_budget_units || 0) - spent);
      }, 0);

    const reconciledSum =
      treasuryAvailable +
      taskBudgetReserved +
      campaignBudgetReserved +
      campaignFeeReserved +
      userAvailableTotal +
      withdrawalReservedTotal +
      withdrawalSettledTotal +
      revTasks +
      Math.max(0, withdrawalFeesFromSupply) +
      Math.max(0, adFeesFromSupply);

    const expectedSupplyBacking = totalIssuedUnits + externalAdvertiserDepositsTotal;

    const fundSegregation = computeFundSegregationSummary({
      cashVaultTotal,
      externalPlatformBalance,
      externalAccountsTotal,
      externalActualTotal,
      activeExternalCount,
      realizedRevenuesTotal: totalRevenue,
      operationalExpensesTotal: totalOperationalExpenses,
      ownerCapitalTotal,
      ownerWithdrawalsTotal,
      virtualTreasuryAvailable: treasuryAvailable,
      advertiserWalletsTotal: advertiserWalletTotal,
      campaignBudgetEscrow: campaignBudgetReserved,
      campaignFeeEscrow: campaignFeeReserved,
      pendingExternalDepositsCount,
      pendingExternalDepositsAmount,
      approvedExternalDepositsTotal: externalAdvertiserDepositsTotal,
      workerWalletsTotal: workerWalletTotal,
      withdrawalReservedTotal,
      adminTaskEscrowTotal: taskBudgetReserved,
    });

    const missingMigration011Accounts = MIGRATION_011_CORE_ACCOUNTS.filter((code) => !byCode.has(code));
    const migration011Ready = missingMigration011Accounts.length === 0;

    return {
      totalIssuedUnits,
      treasuryAvailable,
      taskBudgetReserved,
      campaignBudgetReserved,
      campaignFeeReserved,
      userAvailableTotal,
      advertiserWalletTotal,
      workerWalletTotal,
      userPendingTotal: withdrawalReservedTotal,
      withdrawalReservedTotal,
      withdrawalSettledTotal,
      cashVaultTotal,
      externalAccountsReady,
      externalAccountsTotal,
      externalPlatformBalance,
      externalAdvertiserCustodyBalance,
      pendingExternalDepositsCount,
      pendingExternalDepositsAmount,
      externalAdvertiserDepositsTotal,
      ownerCapitalTotal,
      ownerWithdrawalsTotal,
      expensesTotal,
      providerFeesTotal,
      totalOperationalExpenses,
      netProfitLoss,
      retainedEarningsTotal,
      computedRetainedEarnings,
      taxPayableTotal,
      taxesPaidTotal,
      userLiabilitiesTotal,
      fundSegregation,
      revenueTotals: {
        tasks: revTasks,
        ads: revAds,
        subscriptions: revSubscriptions,
        services: revServices,
        total: totalRevenue,
      },
      migration011Ready,
      missingMigration011Accounts,
      taxTablesReady,
      auditLogsTableReady: !auditRes.error,
      withdrawalsTableReady: !withdrawRes.error,
      isReconciled: expectedSupplyBacking > 0 ? reconciledSum === expectedSupplyBacking : true,
      activeTasksBudgetTotal,
    };
  },

  async getFinancialAccountsOverview(authToken?: string) {
    const db = getActorOrAdminClient(authToken);
    const { data: accounts, error } = await db
      .from('financial_accounts')
      .select('id, account_code, account_type, normal_side, balance_units, status, created_at')
      .order('account_code', { ascending: true });

    if (error) {
      throw new Error(`فشل جلب قائمة الحسابات المالية: ${error.message}`);
    }

    const existingCodes = new Set((accounts || []).map((a: any) => String(a.account_code || '')));
    const missingMigration011Accounts = MIGRATION_011_CORE_ACCOUNTS.filter((c) => !existingCodes.has(c));

    return {
      accounts: accounts || [],
      migration011Ready: missingMigration011Accounts.length === 0,
      missingMigration011Accounts,
    };
  },

  async releaseTaskEscrow(params: {
    taskId: string;
    reason?: string;
    actorId?: string;
    authToken?: string;
  }): Promise<{
    releasedUnits: number;
    transactionId: string | null;
    idempotent: boolean;
  }> {
    const cleanReason = (params.reason || 'إلغاء/إغلاق المهمة وتحرير المتبقي من الضمان للخزينة').trim();
    const adminClient = getSupabaseAdminClient();

    // 1. Try Migration 011 atomic RPC first using admin client
    const { data: rpcData, error: rpcErr } = await adminClient.rpc('release_task_escrow', {
      p_task_id: params.taskId,
      p_reason: cleanReason,
    });

    if (!rpcErr && rpcData) {
      return {
        releasedUnits: Number(rpcData.released_units || 0),
        transactionId: rpcData.transaction_id || null,
        idempotent: Boolean(rpcData.idempotent),
      };
    }

    const isMissingRpc =
      rpcErr?.code === 'PGRST202' ||
      String(rpcErr?.message || '').toLowerCase().includes('could not find the function');
    if (rpcErr && !isMissingRpc) {
      throw new Error(rpcErr.message || 'فشل تحرير أموال ضمان المهمة.');
    }

    // 2. Live Fallback using existing atomic post_ledger_transaction RPC with admin client
    const idempotencyKey = `TASK-ESCROW-RELEASE:${params.taskId}`;

    const { data: existingTx } = await adminClient
      .from('ledger_transactions')
      .select('id')
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle();

    if (existingTx?.id) {
      return { releasedUnits: 0, transactionId: existingTx.id, idempotent: true };
    }

    const { data: taskRow } = await adminClient
      .from('tasks')
      .select('id, title, escrow_account_id')
      .eq('id', params.taskId)
      .maybeSingle();

    const { data: escrowAcc } = await adminClient
      .from('financial_accounts')
      .select('id, account_code, balance_units')
      .or(
        taskRow?.escrow_account_id
          ? `id.eq.${taskRow.escrow_account_id},account_code.eq.TASK-ESCROW-${params.taskId}`
          : `account_code.eq.TASK-ESCROW-${params.taskId}`
      )
      .limit(1)
      .maybeSingle();

    const remaining = Number(escrowAcc?.balance_units || 0);
    if (!escrowAcc || remaining <= 0) {
      return { releasedUnits: 0, transactionId: null, idempotent: false };
    }

    const { data: treasuryAcc, error: tErr } = await adminClient
      .from('financial_accounts')
      .select('id')
      .eq('account_code', 'PLATFORM-TREASURY')
      .single();

    if (tErr || !treasuryAcc) {
      throw new Error('تعذر العثور على حساب خزينة المنصة لإرجاع رصيد المهمة.');
    }

    const { data: txId, error: postErr } = await adminClient.rpc('post_ledger_transaction', {
      p_transaction_type: 'TASK_BUDGET_REFUND',
      p_idempotency_key: idempotencyKey,
      p_reference: `TASK:${params.taskId}`,
      p_metadata: {
        task_id: params.taskId,
        task_title: taskRow?.title || '',
        released_units: remaining,
        reason: cleanReason,
        description: `استرجاع المتبقي من ضمان المهمة (${taskRow?.title || params.taskId}) إلى الخزينة`,
      },
      p_entries: [
        { account_id: escrowAcc.id, side: 'debit', amount_units: remaining, memo: cleanReason },
        { account_id: treasuryAcc.id, side: 'credit', amount_units: remaining, memo: cleanReason },
      ],
    });

    if (postErr) {
      throw new Error(postErr.message || 'فشل تسجيل قيد استرجاع ضمان المهمة.');
    }

    await adminClient.from('admin_logs').insert({
      actor_id: params.actorId || null,
      action: 'TASK_ESCROW_RELEASE',
      entity_type: 'task',
      entity_id: params.taskId,
      details: { released_units: remaining, transaction_id: txId, reason: cleanReason },
      created_at: new Date().toISOString(),
    });

    return { releasedUnits: remaining, transactionId: String(txId), idempotent: false };
  },

  async recordTaskCommission(params: {
    taskId: string;
    submissionId: string;
    commissionUnits: number;
    taskTitle?: string;
    actorId?: string;
    authToken?: string;
  }): Promise<{ recorded: boolean; transactionId?: string; pendingMigration?: boolean }> {
    const commission = Math.round(Number(params.commissionUnits || 0));
    if (!Number.isFinite(commission) || commission <= 0) {
      return { recorded: false };
    }

    const db = getActorOrAdminClient(params.authToken);
    const rpcClient = getRpcClient(params.authToken);
    const idempotencyKey = `TASK-COMMISSION:${params.submissionId}`;

    const { data: existingTx } = await db
      .from('ledger_transactions')
      .select('id')
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle();

    if (existingTx?.id) {
      return { recorded: true, transactionId: existingTx.id };
    }

    const [{ data: escrowAcc }, { data: revAcc }] = await Promise.all([
      db.from('financial_accounts').select('id, balance_units').eq('account_code', `TASK-ESCROW-${params.taskId}`).maybeSingle(),
      db.from('financial_accounts').select('id').eq('account_code', 'PLATFORM-REVENUE-TASKS').maybeSingle(),
    ]);

    if (!revAcc) {
      return { recorded: false, pendingMigration: true };
    }

    if (!escrowAcc || Number(escrowAcc.balance_units || 0) < commission) {
      throw new Error('رصيد ضمان المهمة غير كافٍ لتغطية عمولة المنصة.');
    }

    const memo = `عمولة المنصة من المهمة: ${params.taskTitle || params.taskId}`;
    const { data: txId, error: postErr } = await rpcClient.rpc('post_ledger_transaction', {
      p_transaction_type: 'TASK_COMMISSION_REVENUE',
      p_idempotency_key: idempotencyKey,
      p_reference: `TASK-SUBMISSION:${params.submissionId}`,
      p_metadata: {
        task_id: params.taskId,
        submission_id: params.submissionId,
        commission_units: commission,
        description: memo,
      },
      p_entries: [
        { account_id: escrowAcc.id, side: 'debit', amount_units: commission, memo },
        { account_id: revAcc.id, side: 'credit', amount_units: commission, memo },
      ],
    });

    if (postErr) {
      throw new Error(postErr.message || 'فشل تسجيل قيد عمولة المهمة.');
    }

    return { recorded: true, transactionId: String(txId) };
  },

  async reserveWithdrawal(params: {
    userId: string;
    method: string;
    amount: number;
    beneficiaryName: string;
    phoneNumber: string;
    accountNumber?: string | null;
    idempotencyKey?: string | null;
    authToken?: string;
  }) {
    const amountUnits = parseMoneyStrict(params.amount);
    if (!Number.isFinite(amountUnits) || amountUnits <= 0) {
      throw new Error('يرجى تحديد مبلغ محدد أكبر من صفر للسحب.');
    }

    const cleanMethod = params.method.trim().toUpperCase();
    const cleanKey = params.idempotencyKey?.trim() || `WITHDRAWAL-REQ:${crypto.randomUUID()}`;
    const rpcClient = getRpcClient(params.authToken);

    // 1. Try Migration 011 / 025 atomic RPC first
    const { data: rpcRes, error: rpcErr } = await rpcClient.rpc('reserve_withdrawal_ledger', {
      p_method: cleanMethod,
      p_amount_units: amountUnits,
      p_beneficiary_name: params.beneficiaryName.trim(),
      p_phone_number: params.phoneNumber.trim(),
      p_account_number: params.accountNumber?.trim() || null,
      p_idempotency_key: cleanKey,
    });

    if (!rpcErr && rpcRes) {
      return rpcRes;
    }

    const isMissingRpc =
      rpcErr?.code === 'PGRST202' ||
      String(rpcErr?.message || '').toLowerCase().includes('could not find the function');
    if (rpcErr && !isMissingRpc) {
      throw new Error(rpcErr.message || 'فشلت عملية حجز رصيد السحب.');
    }

    // 2. Fallback using live financial_accounts + post_ledger_transaction if tables/accounts exist
    const db = getActorOrAdminClient(params.authToken);
    const { data: existingReq, error: checkTableErr } = await db
      .from('withdrawal_requests')
      .select('id, amount, fee, net_amount, status, reservation_transaction_id')
      .eq('idempotency_key', cleanKey)
      .maybeSingle();

    if (checkTableErr && (checkTableErr.code === 'PGRST205' || checkTableErr.code === '42P01')) {
      throw new Error('ميزة طلبات السحب تتطلب تنفيذ الترحيل المالي 011 (جداول withdrawal_requests وحساب WITHDRAWAL-RESERVED) في Supabase SQL Editor أولاً.');
    }

    if (existingReq) {
      const wallet = await this.getWallet(params.userId);
      return {
        success: true,
        idempotent: true,
        withdrawalId: existingReq.id,
        transactionId: existingReq.reservation_transaction_id,
        amount: existingReq.amount,
        fee: existingReq.fee,
        netAmount: existingReq.net_amount,
        status: existingReq.status,
        newAvailableBalance: wallet.availableBalance,
      };
    }

    const [{ accountRow: walletAcc }, { data: reservedAcc }, methods] = await Promise.all([
      this.ensureUserFinancialAccount(params.userId),
      db.from('financial_accounts').select('id').eq('account_code', 'WITHDRAWAL-RESERVED').maybeSingle(),
      this.getPayoutMethods(),
    ]);

    if (!reservedAcc) {
      throw new Error('حساب حجز السحوبات (WITHDRAWAL-RESERVED) غير موجود في قاعدة البيانات. يرجى تطبيق الترحيل 011.');
    }

    const methodCfg = methods.find((m) => m.code === cleanMethod);
    const minLim = methodCfg?.minWithdrawal ?? 1000;
    const maxLim = methodCfg?.maxWithdrawal ?? 500000;
    if (amountUnits < minLim) {
      throw new Error(`المبلغ المطلوب أقل من الحد الأدنى المسموح به للسحب (${minLim.toLocaleString()} ر.ي).`);
    }
    if (amountUnits > maxLim) {
      throw new Error(`المبلغ المطلوب يتجاوز الحد الأقصى المسموح به للسحب (${maxLim.toLocaleString()} ر.ي).`);
    }
    if (Number(walletAcc.balance_units || 0) < amountUnits) {
      throw new Error('رصيدك المتاح غير كافٍ لطلب سحب هذا المبلغ.');
    }

    const fee = methodCfg
      ? addMoney(calcPercentageMicros(amountUnits.micros, methodCfg.feePercentage), methodCfg.feeFlat || 0)
      : calcPercentageMicros(amountUnits.micros, 1.5);
    const netAmount = subMoney(amountUnits, fee);
    if (netAmount <= 0) {
      throw new Error('صافي مبلغ السحب بعد الرسوم يجب أن يكون أكبر من صفر.');
    }

    const withdrawalId = crypto.randomUUID();
    const memo = `حجز رصيد طلب سحب عبر ${cleanMethod}`;

    const { data: txId, error: postErr } = await rpcClient.rpc('post_ledger_transaction', {
      p_transaction_type: 'WITHDRAWAL_REQUEST',
      p_idempotency_key: `WITHDRAWAL-RESERVE:${cleanKey}`,
      p_reference: `WITHDRAWAL:${withdrawalId}`,
      p_metadata: {
        withdrawal_id: withdrawalId,
        user_id: params.userId,
        method: cleanMethod,
        amount_units: amountUnits,
        fee_units: fee,
        net_units: netAmount,
        description: memo,
      },
      p_entries: [
        { account_id: walletAcc.id, side: 'debit', amount_units: amountUnits, memo },
        { account_id: reservedAcc.id, side: 'credit', amount_units: amountUnits, memo: `التزام سحب معلق #${withdrawalId}` },
      ],
    });

    if (postErr || !txId) {
      throw new Error(postErr?.message || 'فشل تسجيل قيد حجز السحب في دفتر الأستاذ.');
    }

    const { error: insertErr } = await db.from('withdrawal_requests').insert({
      id: withdrawalId,
      user_id: params.userId,
      method: cleanMethod,
      amount: amountUnits,
      fee,
      net_amount: netAmount,
      beneficiary_name: params.beneficiaryName.trim(),
      phone_number: params.phoneNumber.trim(),
      account_number: params.accountNumber?.trim() || null,
      status: 'PENDING',
      idempotency_key: cleanKey,
      reservation_transaction_id: String(txId),
      created_at: new Date().toISOString(),
    });

    if (insertErr) {
      // Compensating reversal if withdrawal row creation failed after ledger debit
      await this.reverseTransaction({
        transactionId: String(txId),
        reason: `تراجع تلقائي بسبب فشل إنشاء سجل السحب: ${insertErr.message}`,
        actorId: params.userId,
        authToken: params.authToken,
      }).catch(() => {});
      throw new Error(`فشل حفظ طلب السحب: ${insertErr.message}`);
    }

    const updatedWallet = await this.getWallet(params.userId);
    return {
      success: true,
      idempotent: false,
      withdrawalId,
      transactionId: String(txId),
      amount: amountUnits,
      fee,
      netAmount,
      status: 'PENDING',
      newAvailableBalance: updatedWallet.availableBalance,
    };
  },

  async reviewWithdrawal(params: {
    withdrawalId: string;
    action: 'PAY' | 'REJECT';
    transferReference?: string;
    receiptUrl?: string;
    reason?: string;
    providerFeeUnits?: number;
    actorId: string;
    authToken?: string;
  }) {
    const rpcClient = getRpcClient(params.authToken);

    // 1. Try Migration 011 / 025 atomic RPC first
    const { data: rpcRes, error: rpcErr } = await rpcClient.rpc('settle_withdrawal_ledger', {
      p_withdrawal_id: params.withdrawalId,
      p_decision: params.action,
      p_transfer_reference: params.transferReference?.trim() || null,
      p_receipt_url: params.receiptUrl?.trim() || null,
      p_reason: params.reason?.trim() || null,
      p_provider_fee_units: Math.max(0, parseMoneyStrict(params.providerFeeUnits || 0)),
    });

    if (!rpcErr && rpcRes) {
      return rpcRes;
    }

    const isMissingRpc =
      rpcErr?.code === 'PGRST202' ||
      String(rpcErr?.message || '').toLowerCase().includes('could not find the function');
    if (rpcErr && !isMissingRpc) {
      throw new Error(rpcErr.message || 'فشل معالجة تسوية السحب في قاعدة البيانات.');
    }

    // 2. Fallback using live post_ledger_transaction
    const db = getActorOrAdminClient(params.authToken);
    const { data: withData, error: fetchErr } = await db
      .from('withdrawal_requests')
      .select('*')
      .eq('id', params.withdrawalId)
      .maybeSingle();

    if (fetchErr && (fetchErr.code === 'PGRST205' || fetchErr.code === '42P01')) {
      throw new Error('جدول withdrawal_requests غير موجود في Supabase. يرجى تنفيذ الترحيل 011 أولاً.');
    }
    if (!withData) {
      throw new Error('طلب السحب غير موجود.');
    }
    if (withData.status === 'PAID' && params.action === 'PAY') {
      return { success: true, idempotent: true, withdrawalId: withData.id, status: 'PAID', transactionId: withData.settlement_transaction_id };
    }
    if (withData.status === 'REJECTED' && params.action === 'REJECT') {
      return { success: true, idempotent: true, withdrawalId: withData.id, status: 'REJECTED', transactionId: withData.refund_transaction_id };
    }
    if (withData.status !== 'PENDING') {
      throw new Error('تمت معالجة طلب السحب هذا مسبقاً.');
    }

    const now = new Date().toISOString();
    const { data: accounts } = await db
      .from('financial_accounts')
      .select('id, account_code')
      .in('account_code', ['WITHDRAWAL-RESERVED', 'WITHDRAWAL-SETTLED', 'PLATFORM-REVENUE-SERVICES']);

    const reservedAcc = (accounts || []).find((a: any) => a.account_code === 'WITHDRAWAL-RESERVED');
    const settledAcc = (accounts || []).find((a: any) => a.account_code === 'WITHDRAWAL-SETTLED');
    const revServicesAcc = (accounts || []).find((a: any) => a.account_code === 'PLATFORM-REVENUE-SERVICES');

    if (!reservedAcc) {
      throw new Error('حساب WITHDRAWAL-RESERVED غير موجود. يرجى تطبيق الترحيل 011.');
    }

    const totalAmount = parseMoneyStrict(withData.amount);
    const fee = parseMoneyStrict(withData.fee || 0);
    const netAmount = subMoney(totalAmount, fee);

    if (params.action === 'PAY') {
      if (!params.transferReference?.trim()) {
        throw new Error('يرجى إدخال رقم مرجع الحوالة البنكية.');
      }
      if (!params.receiptUrl?.trim()) {
        throw new Error('إرفاق صورة إشعار التحويل البنكي إلزامي لاعتماد صرف السحب.');
      }
      if (!settledAcc || (fee > 0 && !revServicesAcc)) {
        throw new Error('حسابات تسوية السحب (WITHDRAWAL-SETTLED / PLATFORM-REVENUE-SERVICES) غير مكتملة. يرجى تطبيق الترحيل 011.');
      }

      const entries: LedgerEntryDraft[] = [
        { account_id: reservedAcc.id, side: 'debit', amount_units: totalAmount, memo: `تسوية التزام سحب #${params.withdrawalId}` },
        { account_id: settledAcc.id, side: 'credit', amount_units: netAmount, memo: `صرف سحب بالمرجع ${params.transferReference.trim()}` },
      ];
      if (fee > 0 && revServicesAcc) {
        entries.push({ account_id: revServicesAcc.id, side: 'credit', amount_units: fee, memo: `رسوم خدمة سحب #${params.withdrawalId}` });
      }

      const { data: txId, error: postErr } = await rpcClient.rpc('post_ledger_transaction', {
        p_transaction_type: 'WITHDRAWAL_PAYOUT',
        p_idempotency_key: `WITHDRAWAL-PAY:${params.withdrawalId}`,
        p_reference: `WITHDRAWAL:${params.withdrawalId}`,
        p_metadata: {
          withdrawal_id: params.withdrawalId,
          transfer_reference: params.transferReference.trim(),
          amount: totalAmount,
          fee,
          net_amount: netAmount,
          description: `إتمام سحب وتسوية الالتزام النقدي بالمرجع ${params.transferReference.trim()}`,
        },
        p_entries: entries,
      });

      if (postErr) {
        throw new Error(postErr.message || 'فشل تسجيل قيد إتمام السحب.');
      }

      await db
        .from('withdrawal_requests')
        .update({
          status: 'PAID',
          transfer_reference: params.transferReference.trim(),
          receipt_url: params.receiptUrl?.trim() || null,
          admin_id: params.actorId,
          settlement_transaction_id: String(txId),
          processed_at: now,
        })
        .eq('id', params.withdrawalId);

      await db
        .from('notifications')
        .insert({
          id: crypto.randomUUID(),
          user_id: withData.user_id,
          title: 'تم تحويل مبلغ السحب بنجاح!',
          message: `تم إرسال ${netAmount.toLocaleString()} ر.ي بنجاح برقم الحوالة: ${params.transferReference.trim()}.`,
          type: 'WITHDRAWAL_COMPLETED',
          link: '/dashboard/withdrawals',
          created_at: now,
        })
        .then(() => {}, () => {});

      return { success: true, idempotent: false, withdrawalId: params.withdrawalId, status: 'PAID', transactionId: String(txId) };
    } else {
      if (!params.reason?.trim()) {
        throw new Error('يجب كتابة سبب رفض السحب لاسترجاع الرصيد.');
      }

      const { accountRow: walletAcc } = await this.ensureUserFinancialAccount(withData.user_id);
      const memo = `استرجاع رصيد لطلب سحب مرفوض: ${params.reason.trim()}`;

      const { data: txId, error: postErr } = await rpcClient.rpc('post_ledger_transaction', {
        p_transaction_type: 'WITHDRAWAL_REFUND',
        p_idempotency_key: `WITHDRAWAL-REFUND:${params.withdrawalId}`,
        p_reference: `WITHDRAWAL:${params.withdrawalId}`,
        p_metadata: {
          withdrawal_id: params.withdrawalId,
          user_id: withData.user_id,
          amount: totalAmount,
          reason: params.reason.trim(),
          description: memo,
        },
        p_entries: [
          { account_id: reservedAcc.id, side: 'debit', amount_units: totalAmount, memo: 'إلغاء حجز سحب مرفوض' },
          { account_id: walletAcc.id, side: 'credit', amount_units: totalAmount, memo },
        ],
      });

      if (postErr) {
        throw new Error(postErr.message || 'فشل تسجيل قيد استرجاع السحب.');
      }

      await db
        .from('withdrawal_requests')
        .update({
          status: 'REJECTED',
          rejection_reason: params.reason.trim(),
          admin_id: params.actorId,
          refund_transaction_id: String(txId),
          processed_at: now,
        })
        .eq('id', params.withdrawalId);

      await db
        .from('notifications')
        .insert({
          id: crypto.randomUUID(),
          user_id: withData.user_id,
          title: 'تم رفض طلب السحب واستعادة الرصيد',
          message: `تم استرجاع مبلغ ${totalAmount.toLocaleString()} ر.ي إلى محفظتك. السبب: ${params.reason.trim()}`,
          type: 'WITHDRAWAL_REJECTED',
          link: '/dashboard/wallet',
          created_at: now,
        })
        .then(() => {}, () => {});

      const updatedWallet = await this.getWallet(withData.user_id);
      return {
        success: true,
        idempotent: false,
        withdrawalId: params.withdrawalId,
        status: 'REJECTED',
        transactionId: String(txId),
        newBalance: updatedWallet.availableBalance,
      };
    }
  },

  async executeOwnerFinancialOperation(params: {
    operationType: OwnerFinancialOpType;
    amount: number;
    description: string;
    idempotencyKey?: string;
    creditToTreasury?: boolean;
    metadata?: Record<string, any>;
    actorId: string;
    authToken?: string;
  }) {
    const amountUnits = Math.round(Number(params.amount));
    if (!Number.isFinite(amountUnits) || amountUnits <= 0) {
      throw new Error('المبلغ يجب أن يكون عدداً صحيحاً موجباً أكبر من صفر.');
    }
    const cleanDesc = (params.description || '').trim();
    if (!cleanDesc) {
      throw new Error('البيان المحاسبي مطلوب.');
    }

    const cleanKey = params.idempotencyKey?.trim() || `${params.operationType}:${crypto.randomUUID()}`;
    const rpcClient = getRpcClient(params.authToken);

    // 1. Try Migration 011 atomic RPC first
    const { data: rpcRes, error: rpcErr } = await rpcClient.rpc('post_owner_financial_operation', {
      p_operation_type: params.operationType,
      p_amount_units: amountUnits,
      p_description: cleanDesc,
      p_idempotency_key: cleanKey,
      p_credit_to_treasury: params.creditToTreasury !== false,
      p_metadata: params.metadata || {},
    });

    if (!rpcErr && rpcRes) {
      return rpcRes;
    }

    const isMissingRpc =
      rpcErr?.code === 'PGRST202' ||
      String(rpcErr?.message || '').toLowerCase().includes('could not find the function');
    if (rpcErr && !isMissingRpc) {
      throw new Error(rpcErr.message || 'فشل تنفيذ العملية المالية.');
    }

    // 2. Fallback using live post_ledger_transaction
    const db = getActorOrAdminClient(params.authToken);
    const { data: existingTx } = await db
      .from('ledger_transactions')
      .select('id')
      .eq('idempotency_key', cleanKey)
      .maybeSingle();

    if (existingTx?.id) {
      return {
        success: true,
        idempotent: true,
        transactionId: existingTx.id,
        operationType: params.operationType,
        amountUnits,
      };
    }

    const { data: accounts, error: accErr } = await db
      .from('financial_accounts')
      .select('id, account_code, balance_units');

    if (accErr) {
      throw new Error(`فشل قراءة الحسابات المالية: ${accErr.message}`);
    }

    const accountIds: Record<string, string> = {};
    const balances: Record<string, number> = {};
    for (const a of accounts || []) {
      if (a.account_code) {
        accountIds[a.account_code] = a.id;
        balances[a.account_code] = Number(a.balance_units || 0);
      }
    }

    if (
      (params.operationType === 'OPERATIONAL_EXPENSE' || params.operationType === 'OWNER_WITHDRAWAL') &&
      ((balances['PLATFORM-TREASURY'] || 0) < amountUnits || (balances['VIRTUAL-ISSUANCE-CONTROL'] || 0) < amountUnits)
    ) {
      throw new Error('رصيد الخزينة التشغيلية المتاح غير كافٍ لتنفيذ هذه العملية.');
    }

    const entries = buildDoubleEntryForOperation({
      operationType: params.operationType,
      amountUnits,
      description: cleanDesc,
      accountIds,
      creditToTreasury: params.creditToTreasury,
    });

    const { data: txId, error: postErr } = await rpcClient.rpc('post_ledger_transaction', {
      p_transaction_type: params.operationType,
      p_idempotency_key: cleanKey,
      p_reference: params.operationType,
      p_metadata: {
        ...(params.metadata || {}),
        description: cleanDesc,
        amount_units: amountUnits,
        actor_id: params.actorId,
        credit_to_treasury: params.creditToTreasury !== false,
      },
      p_entries: entries,
    });

    if (postErr) {
      throw new Error(postErr.message || 'فشل تسجيل القيد المحاسبي في دفتر الأستاذ.');
    }

    await db.from('admin_logs').insert({
      actor_id: params.actorId,
      action: params.operationType,
      entity_type: 'ledger_transaction',
      entity_id: String(txId),
      details: { amount_units: amountUnits, description: cleanDesc, idempotency_key: cleanKey },
      created_at: new Date().toISOString(),
    });

    await this.writeFinancialAuditLog({
      actionType: params.operationType,
      actorId: params.actorId,
      transactionId: String(txId),
      details: { amount_units: amountUnits, description: cleanDesc, idempotency_key: cleanKey, ...(params.metadata || {}) },
      authToken: params.authToken,
    });

    return {
      success: true,
      idempotent: false,
      transactionId: String(txId),
      operationType: params.operationType,
      amountUnits,
    };
  },

  async reverseTransaction(params: {
    transactionId: string;
    reason: string;
    actorId: string;
    authToken?: string;
  }) {
    const cleanReason = (params.reason || '').trim();
    if (!cleanReason) {
      throw new Error('سبب القيد العكسي مطلوب.');
    }

    const rpcClient = getRpcClient(params.authToken);
    const { data: rpcRes, error: rpcErr } = await rpcClient.rpc('reverse_ledger_transaction', {
      p_transaction_id: params.transactionId,
      p_reason: cleanReason,
    });

    if (!rpcErr && rpcRes) {
      return rpcRes;
    }

    const isMissingRpc =
      rpcErr?.code === 'PGRST202' ||
      String(rpcErr?.message || '').toLowerCase().includes('could not find the function');
    if (rpcErr && !isMissingRpc) {
      throw new Error(rpcErr.message || 'فشل عكس المعاملة المالية.');
    }

    const db = getActorOrAdminClient(params.authToken);
    const revKey = `REVERSAL:${params.transactionId}`;

    const { data: existingRev } = await db
      .from('ledger_transactions')
      .select('id')
      .eq('idempotency_key', revKey)
      .maybeSingle();

    if (existingRev?.id) {
      return {
        success: true,
        idempotent: true,
        original_transaction_id: params.transactionId,
        reversal_transaction_id: existingRev.id,
      };
    }

    const { data: origTx, error: txErr } = await db
      .from('ledger_transactions')
      .select('id, transaction_type')
      .eq('id', params.transactionId)
      .maybeSingle();

    if (txErr || !origTx) {
      throw new Error('المعاملة الأصلية غير موجودة.');
    }

    if (String(origTx.transaction_type || '').toUpperCase().startsWith('REVERSAL_')) {
      throw new Error('لا يمكن عكس قيد عكسي.');
    }

    const { data: origEntries, error: entErr } = await db
      .from('ledger_entries')
      .select('account_id, entry_side, amount_units')
      .eq('transaction_id', params.transactionId);

    if (entErr || !origEntries || origEntries.length === 0) {
      throw new Error('تعذر العثور على قيود المعاملة لعكسها.');
    }

    const swappedEntries: LedgerEntryDraft[] = origEntries.map((e: any) => ({
      account_id: e.account_id,
      side: e.entry_side === 'debit' ? 'credit' : 'debit',
      amount_units: Number(e.amount_units),
      memo: `قيد عكسي: ${cleanReason}`,
    }));

    const { data: newTxId, error: postErr } = await rpcClient.rpc('post_ledger_transaction', {
      p_transaction_type: `REVERSAL_${origTx.transaction_type}`,
      p_idempotency_key: revKey,
      p_reference: `REVERSAL:${params.transactionId}`,
      p_metadata: {
        original_transaction_id: params.transactionId,
        original_type: origTx.transaction_type,
        reason: cleanReason,
        description: `قيد عكسي للمعاملة ${params.transactionId}: ${cleanReason}`,
        reversed_by: params.actorId,
      },
      p_entries: swappedEntries,
    });

    if (postErr) {
      throw new Error(postErr.message || 'فشل تسجيل القيد العكسي في دفتر الأستاذ.');
    }

    await this.writeFinancialAuditLog({
      actionType: 'REVERSE_TRANSACTION',
      actorId: params.actorId,
      transactionId: String(newTxId),
      details: { original_transaction_id: params.transactionId, reason: cleanReason },
      authToken: params.authToken,
    });

    return {
      success: true,
      idempotent: false,
      original_transaction_id: params.transactionId,
      reversal_transaction_id: String(newTxId),
    };
  },

  async getLedgerTransactions(
    limitOrOpts:
      | number
      | {
          limit?: number;
          offset?: number;
          transactionType?: string;
          accountCode?: string;
          from?: string;
          to?: string;
          search?: string;
          authToken?: string;
        } = 100,
    offsetArg = 0
  ): Promise<LedgerTransaction[]> {
    const opts =
      typeof limitOrOpts === 'number'
        ? { limit: limitOrOpts, offset: offsetArg }
        : limitOrOpts;

    const limit = Math.min(Math.max(Number(opts.limit) || 100, 1), 500);
    const offset = Math.max(Number(opts.offset) || 0, 0);
    const db = getActorOrAdminClient(opts.authToken);

    const [{ data: allAccounts }, { data: profiles }] = await Promise.all([
      db.from('financial_accounts').select('id, account_code, account_type, normal_side'),
      db.from('profiles').select('id, full_name, email'),
    ]);

    const accById = new Map<string, any>();
    const accByCode = new Map<string, any>();
    for (const a of allAccounts || []) {
      accById.set(a.id, a);
      if (a.account_code) accByCode.set(String(a.account_code), a);
    }

    const profileMap = new Map<string, string>();
    for (const p of profiles || []) {
      profileMap.set(p.id, p.full_name || p.email || p.id.slice(0, 8));
    }

    let filterTxIds: string[] | null = null;
    if (opts.accountCode && opts.accountCode !== 'ALL') {
      const targetAcc = accByCode.get(opts.accountCode);
      if (!targetAcc) return [];
      const { data: accEntries } = await db
        .from('ledger_entries')
        .select('transaction_id')
        .eq('account_id', targetAcc.id);
      filterTxIds = Array.from(new Set((accEntries || []).map((e: any) => e.transaction_id)));
      if (filterTxIds.length === 0) return [];
    }

    let query = db
      .from('ledger_transactions')
      .select('id, transaction_type, reference, idempotency_key, status, metadata, created_by, created_at')
      .order('created_at', { ascending: false });

    if (opts.transactionType && opts.transactionType !== 'ALL') {
      query = query.eq('transaction_type', opts.transactionType);
    }
    if (opts.from) {
      query = query.gte('created_at', new Date(opts.from).toISOString());
    }
    if (opts.to) {
      const end = new Date(opts.to);
      if (!opts.to.includes('T')) end.setHours(23, 59, 59, 999);
      query = query.lte('created_at', end.toISOString());
    }
    if (filterTxIds) {
      query = query.in('id', filterTxIds);
    }

    const { data: txs, error: txErr } = await query.range(offset, offset + limit - 1);

    if (txErr) {
      throw new Error(`فشل قراءة قيود دفتر الأستاذ من Supabase: ${txErr.message}`);
    }

    const txIds = (txs || []).map((t: any) => t.id);
    const entriesByTx = new Map<string, any[]>();
    if (txIds.length > 0) {
      const { data: entries } = await db
        .from('ledger_entries')
        .select('id, transaction_id, account_id, entry_side, amount_units, memo, created_at')
        .in('transaction_id', txIds);

      for (const e of entries || []) {
        const arr = entriesByTx.get(e.transaction_id) || [];
        arr.push(e);
        entriesByTx.set(e.transaction_id, arr);
      }
    }

    // Check which transactions have already been reversed
    const reversalMap = new Map<string, string>();
    if (txIds.length > 0) {
      const revKeys = txIds.map((id: string) => `REVERSAL:${id}`);
      const { data: revTxs } = await db
        .from('ledger_transactions')
        .select('id, idempotency_key')
        .in('idempotency_key', revKeys);
      for (const r of revTxs || []) {
        const origId = String(r.idempotency_key || '').replace(/^REVERSAL:/, '');
        if (origId) reversalMap.set(origId, r.id);
      }
    }

    let mapped: LedgerTransaction[] = (txs || []).map((tx: any) => {
      const txEntries = entriesByTx.get(tx.id) || [];
      const firstMemo = txEntries.find((e: any) => e.memo)?.memo;
      const metaDesc =
        tx.metadata?.description ||
        (tx.metadata?.task_title ? `${tx.transaction_type}: ${tx.metadata.task_title}` : undefined) ||
        tx.metadata?.note ||
        firstMemo ||
        tx.reference ||
        tx.transaction_type;

      const totalDebit = txEntries
        .filter((e: any) => e.entry_side === 'debit')
        .reduce((s: number, e: any) => s + Number(e.amount_units || 0), 0);

      const reversedByTxId = reversalMap.get(tx.id);

      return {
        id: tx.id,
        transactionType: tx.transaction_type,
        status: tx.status || 'posted',
        referenceId: tx.reference || tx.id,
        idempotencyKey: tx.idempotency_key,
        description: metaDesc,
        metadata: tx.metadata || {},
        createdBy: tx.created_by,
        createdByName: tx.created_by ? profileMap.get(tx.created_by) || tx.created_by.slice(0, 8) : 'النظام الآلي',
        createdAt: tx.created_at,
        isReversed: Boolean(reversedByTxId),
        reversedByTransactionId: reversedByTxId,
        totalAmount: totalDebit,
        entries: txEntries.map((e: any) => {
          const acc = accById.get(e.account_id);
          return {
            id: e.id,
            transactionId: e.transaction_id,
            accountId: e.account_id,
            accountCode: acc?.account_code || e.account_id.slice(0, 8),
            accountType: acc?.account_type || 'unknown',
            normalSide: acc?.normal_side,
            debitAmount: e.entry_side === 'debit' ? Number(e.amount_units || 0) : 0,
            creditAmount: e.entry_side === 'credit' ? Number(e.amount_units || 0) : 0,
            memo: e.memo || undefined,
            createdAt: e.created_at,
          };
        }),
      };
    });

    if (opts.search && opts.search.trim()) {
      const q = opts.search.trim().toLowerCase();
      mapped = mapped.filter(
        (tx) =>
          tx.id.toLowerCase().includes(q) ||
          tx.transactionType.toLowerCase().includes(q) ||
          (tx.description || '').toLowerCase().includes(q) ||
          (tx.referenceId || '').toLowerCase().includes(q) ||
          (tx.idempotencyKey || '').toLowerCase().includes(q) ||
          (tx.createdByName || '').toLowerCase().includes(q) ||
          (tx.entries || []).some((e) => (e.accountCode || '').toLowerCase().includes(q))
      );
    }

    return mapped;
  },

  async getTreasuryMovements(authToken?: string, limit = 60): Promise<TreasuryMovement[]> {
    const db = getActorOrAdminClient(authToken);
    const { data: targetAccounts, error: accErr } = await db
      .from('financial_accounts')
      .select('id, account_code, normal_side')
      .in('account_code', ['PLATFORM-TREASURY', 'PLATFORM-CASH-VAULT']);

    if (accErr || !targetAccounts || targetAccounts.length === 0) {
      return [];
    }

    const accIds = targetAccounts.map((a: any) => a.id);
    const accMap = new Map<string, any>();
    for (const a of targetAccounts) accMap.set(a.id, a);

    const { data: entries, error: entErr } = await db
      .from('ledger_entries')
      .select(
        'id, transaction_id, account_id, entry_side, amount_units, memo, created_at, ledger_transactions(transaction_type, reference, metadata, created_at)'
      )
      .in('account_id', accIds)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true });

    if (entErr || !entries) return [];

    const runningBalance = new Map<string, number>();
    const movements: TreasuryMovement[] = [];

    for (const e of entries) {
      const acc = accMap.get(e.account_id);
      if (!acc) continue;
      const code = String(acc.account_code) as 'PLATFORM-TREASURY' | 'PLATFORM-CASH-VAULT';
      const normalSide = String(acc.normal_side || 'credit').toLowerCase();
      const amt = Number(e.amount_units || 0);
      const side = String(e.entry_side || '').toLowerCase() as 'debit' | 'credit';
      const signedDelta = normalSide === side ? amt : -amt;

      const beforeBalance = runningBalance.get(code) || 0;
      const afterBalance = beforeBalance + signedDelta;
      runningBalance.set(code, afterBalance);

      const tx = (e as any).ledger_transactions || {};
      movements.push({
        transactionId: e.transaction_id,
        transactionType: tx.transaction_type || 'LEDGER_OP',
        accountCode: code,
        entrySide: side,
        amount: amt,
        signedDelta,
        beforeBalance,
        afterBalance,
        description: tx.metadata?.description || e.memo || tx.reference || tx.transaction_type || '',
        referenceId: tx.reference || undefined,
        createdAt: tx.created_at || e.created_at,
      });
    }

    return movements.reverse().slice(0, limit);
  },

  async getFinancialAuditLogs(authToken?: string, limit = 100): Promise<{ auditTableReady: boolean; logs: FinancialAuditLog[] }> {
    const db = getActorOrAdminClient(authToken);
    const [{ data: profiles }, auditRes] = await Promise.all([
      db.from('profiles').select('id, full_name, email'),
      db.from('financial_audit_logs').select('*').order('created_at', { ascending: false }).limit(limit),
    ]);

    const profileMap = new Map<string, string>();
    for (const p of profiles || []) {
      profileMap.set(p.id, p.full_name || p.email || p.id.slice(0, 8));
    }

    if (!auditRes.error && auditRes.data) {
      return {
        auditTableReady: true,
        logs: auditRes.data.map((l: any) => ({
          id: l.id,
          actionType: l.action_type,
          actorId: l.actor_id,
          actorName: l.actor_id ? profileMap.get(l.actor_id) || l.actor_id.slice(0, 8) : 'النظام',
          transactionId: l.transaction_id,
          details: l.details || {},
          ipAddress: l.ip_address,
          createdAt: l.created_at,
          source: 'financial_audit_logs',
        })),
      };
    }

    // Honest fallback to admin_logs when financial_audit_logs table is awaiting Migration 011
    const { data: adminLogs } = await db
      .from('admin_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    return {
      auditTableReady: false,
      logs: (adminLogs || []).map((l: any) => ({
        id: l.id,
        actionType: l.action,
        actorId: l.actor_id,
        actorName: l.actor_id ? profileMap.get(l.actor_id) || l.actor_id.slice(0, 8) : 'النظام',
        transactionId: l.entity_type === 'ledger_transaction' ? l.entity_id : null,
        details: l.details || {},
        ipAddress: null,
        createdAt: l.created_at,
        source: 'admin_logs',
      })),
    };
  },

  async getTaxesOverview(authToken?: string): Promise<{
    taxTablesReady: boolean;
    taxPayableTotal: number;
    definitions: TaxDefinition[];
    settlements: TaxSettlement[];
  }> {
    const db = getActorOrAdminClient(authToken);
    const [taxAccRes, defsRes, settleRes] = await Promise.all([
      db.from('financial_accounts').select('balance_units').eq('account_code', 'TAX-PAYABLE').maybeSingle(),
      db.from('tax_definitions').select('*').order('created_at', { ascending: false }),
      db.from('tax_settlements').select('*, tax_definitions(tax_type, tax_authority)').order('created_at', { ascending: false }),
    ]);

    const taxPayableTotal = Number(taxAccRes.data?.balance_units || 0);
    const missingTable =
      defsRes.error?.code === 'PGRST205' ||
      defsRes.error?.code === '42P01' ||
      settleRes.error?.code === 'PGRST205' ||
      settleRes.error?.code === '42P01';

    if (missingTable) {
      return {
        taxTablesReady: false,
        taxPayableTotal,
        definitions: [],
        settlements: [],
      };
    }

    return {
      taxTablesReady: true,
      taxPayableTotal,
      definitions: (defsRes.data || []).map((d: any) => ({
        id: d.id,
        taxType: d.tax_type,
        taxAuthority: d.tax_authority,
        region: d.region,
        taxBase: d.tax_base,
        ratePercentage: Number(d.rate_percentage || 0),
        flatAmount: Number(d.flat_amount || 0),
        validFrom: d.valid_from,
        validTo: d.valid_to,
        isActive: Boolean(d.is_active),
        exemptionsRules: d.exemptions_rules || {},
        createdAt: d.created_at,
        updatedAt: d.updated_at,
      })),
      settlements: (settleRes.data || []).map((s: any) => ({
        id: s.id,
        taxDefinitionId: s.tax_definition_id,
        taxType: s.tax_definitions?.tax_type,
        taxAuthority: s.tax_definitions?.tax_authority,
        taxableAmount: Number(s.taxable_amount || 0),
        taxAmount: Number(s.tax_amount || 0),
        status: s.status,
        ledgerTransactionId: s.ledger_transaction_id,
        settledAt: s.settled_at,
        referenceId: s.reference_id,
        createdAt: s.created_at,
      })),
    };
  },

  async createTaxDefinition(params: {
    taxType: string;
    taxAuthority: string;
    region?: string;
    countryId?: string | null;
    taxBase: string;
    ratePercentage: number;
    flatAmount?: number;
    validFrom?: string;
    validTo?: string | null;
    isActive?: boolean;
    actorId: string;
    authToken?: string;
  }): Promise<TaxDefinition> {
    const taxType = (params.taxType || '').trim();
    const taxAuthority = (params.taxAuthority || '').trim();
    const taxBase = (params.taxBase || '').trim();
    const rate = Number(params.ratePercentage ?? 0);
    const flat = Math.round(Number(params.flatAmount ?? 0));

    if (!taxType || !taxAuthority || !taxBase) {
      throw new Error('نوع الضريبة والجهة المختصة والوعاء الضريبي حقول مطلوبة.');
    }
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
      throw new Error('نسبة الضريبة يجب أن تكون بين 0% و 100%.');
    }
    if (!Number.isFinite(flat) || flat < 0) {
      throw new Error('المبلغ الثابت للضريبة لا يمكن أن يكون سالباً.');
    }

    const db = getActorOrAdminClient(params.authToken);
    const now = new Date().toISOString();
    let resolvedRegion = (params.region || '').trim();
    let resolvedCountryId: string | null = params.countryId || null;
    if (resolvedCountryId) {
      const c = await geoService.resolveCountry(resolvedCountryId, params.authToken);
      if (c) {
        resolvedCountryId = c.id;
        if (!resolvedRegion) resolvedRegion = c.nameEn.toUpperCase();
      }
    }
    if (!resolvedRegion) resolvedRegion = 'YEMEN';

    let insertRes = await db
      .from('tax_definitions')
      .insert({
        id: crypto.randomUUID(),
        tax_type: taxType,
        tax_authority: taxAuthority,
        region: resolvedRegion,
        country_id: resolvedCountryId,
        tax_base: taxBase,
        rate_percentage: rate,
        flat_amount: flat,
        valid_from: params.validFrom ? new Date(params.validFrom).toISOString() : now,
        valid_to: params.validTo ? new Date(params.validTo).toISOString() : null,
        is_active: Boolean(params.isActive), // Defaults to false unless explicitly activated by owner
        created_at: now,
        updated_at: now,
      })
      .select('*')
      .single();

    if (insertRes.error && insertRes.error.code === '42703') {
      insertRes = await db
        .from('tax_definitions')
        .insert({
          id: crypto.randomUUID(),
          tax_type: taxType,
          tax_authority: taxAuthority,
          region: resolvedRegion,
          tax_base: taxBase,
          rate_percentage: rate,
          flat_amount: flat,
          valid_from: params.validFrom ? new Date(params.validFrom).toISOString() : now,
          valid_to: params.validTo ? new Date(params.validTo).toISOString() : null,
          is_active: Boolean(params.isActive),
          created_at: now,
          updated_at: now,
        })
        .select('*')
        .single();
    }

    const { data, error } = insertRes;

    if (error) {
      if (error.code === 'PGRST205' || error.code === '42P01') {
        throw new Error('جدول تعريفات الضرائب (tax_definitions) غير موجود في قاعدة البيانات بعد. يرجى تنفيذ الترحيل المالي 011 أولاً.');
      }
      throw new Error(`فشل إنشاء تعريف الضريبة: ${error.message}`);
    }

    await this.writeFinancialAuditLog({
      actionType: 'TAX_DEFINITION_CREATED',
      actorId: params.actorId,
      details: { tax_id: data.id, tax_type: taxType, rate_percentage: rate, flat_amount: flat, is_active: Boolean(params.isActive) },
      authToken: params.authToken,
    });

    return {
      id: data.id,
      taxType: data.tax_type,
      taxAuthority: data.tax_authority,
      region: data.region,
      taxBase: data.tax_base,
      ratePercentage: Number(data.rate_percentage || 0),
      flatAmount: Number(data.flat_amount || 0),
      validFrom: data.valid_from,
      validTo: data.valid_to,
      isActive: Boolean(data.is_active),
      exemptionsRules: data.exemptions_rules || {},
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  },

  async updateTaxDefinition(params: {
    id: string;
    ratePercentage?: number;
    flatAmount?: number;
    isActive?: boolean;
    validTo?: string | null;
    taxAuthority?: string;
    actorId: string;
    authToken?: string;
  }): Promise<TaxDefinition> {
    const db = getActorOrAdminClient(params.authToken);
    const updates: Record<string, any> = { updated_at: new Date().toISOString() };
    if (params.ratePercentage !== undefined) {
      const rate = Number(params.ratePercentage);
      if (!Number.isFinite(rate) || rate < 0 || rate > 100) throw new Error('نسبة الضريبة غير صالحة.');
      updates.rate_percentage = rate;
    }
    if (params.flatAmount !== undefined) {
      const flat = Math.round(Number(params.flatAmount));
      if (!Number.isFinite(flat) || flat < 0) throw new Error('المبلغ الثابت غير صالح.');
      updates.flat_amount = flat;
    }
    if (params.isActive !== undefined) updates.is_active = Boolean(params.isActive);
    if (params.validTo !== undefined) updates.valid_to = params.validTo ? new Date(params.validTo).toISOString() : null;
    if (params.taxAuthority !== undefined) updates.tax_authority = params.taxAuthority.trim();

    const { data, error } = await db
      .from('tax_definitions')
      .update(updates)
      .eq('id', params.id)
      .select('*')
      .single();

    if (error) {
      if (error.code === 'PGRST205' || error.code === '42P01') {
        throw new Error('جدول تعريفات الضرائب (tax_definitions) غير موجود في قاعدة البيانات بعد. يرجى تنفيذ الترحيل المالي 011 أولاً.');
      }
      throw new Error(`فشل تحديث تعريف الضريبة: ${error.message}`);
    }

    await this.writeFinancialAuditLog({
      actionType: 'TAX_DEFINITION_UPDATED',
      actorId: params.actorId,
      details: { tax_id: params.id, updates },
      authToken: params.authToken,
    });

    return {
      id: data.id,
      taxType: data.tax_type,
      taxAuthority: data.tax_authority,
      region: data.region,
      taxBase: data.tax_base,
      ratePercentage: Number(data.rate_percentage || 0),
      flatAmount: Number(data.flat_amount || 0),
      validFrom: data.valid_from,
      validTo: data.valid_to,
      isActive: Boolean(data.is_active),
      exemptionsRules: data.exemptions_rules || {},
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  },

  async accrueTaxObligation(params: {
    taxDefinitionId: string;
    taxableAmount: number;
    referenceId?: string;
    note?: string;
    actorId: string;
    authToken?: string;
  }) {
    const db = getActorOrAdminClient(params.authToken);
    const rpcClient = getRpcClient(params.authToken);
    const taxable = Math.round(Number(params.taxableAmount));
    if (!Number.isFinite(taxable) || taxable <= 0) {
      throw new Error('الوعاء الضريبي الخاضع للحساب يجب أن يكون أكبر من صفر.');
    }

    const { data: def, error: defErr } = await db
      .from('tax_definitions')
      .select('*')
      .eq('id', params.taxDefinitionId)
      .maybeSingle();

    if (defErr && (defErr.code === 'PGRST205' || defErr.code === '42P01')) {
      throw new Error('جداول الضرائب غير مهيأة في قاعدة البيانات بعد. يرجى تنفيذ الترحيل 011.');
    }
    if (!def) {
      throw new Error('تعريف الضريبة غير موجود.');
    }
    if (!def.is_active) {
      throw new Error('لا يمكن احتساب التزام ضريبي لتعريف غير مفعل. قم بتفعيله أولاً من إعدادات الضرائب.');
    }

    const taxAmount = Math.round((taxable * Number(def.rate_percentage || 0)) / 100) + Math.round(Number(def.flat_amount || 0));
    if (taxAmount <= 0) {
      throw new Error('قيمة الضريبة المحتسبة تساوي صفراً (تحقق من النسبة أو المبلغ الثابت).');
    }

    const { data: accounts } = await db
      .from('financial_accounts')
      .select('id, account_code')
      .in('account_code', ['PLATFORM-EXPENSES', 'TAX-PAYABLE']);

    const expAcc = (accounts || []).find((a: any) => a.account_code === 'PLATFORM-EXPENSES');
    const taxAcc = (accounts || []).find((a: any) => a.account_code === 'TAX-PAYABLE');
    if (!expAcc || !taxAcc) {
      throw new Error('حسابات الضرائب (PLATFORM-EXPENSES / TAX-PAYABLE) غير موجودة. يرجى تنفيذ الترحيل 011.');
    }

    const settlementId = crypto.randomUUID();
    const cleanRef = (params.referenceId || `TAX-ACC-${settlementId.slice(0, 8)}`).trim();
    const memo = (params.note || `إثبات استحقاق ضريبي: ${def.tax_type} (${def.tax_authority})`).trim();

    const { data: txId, error: postErr } = await rpcClient.rpc('post_ledger_transaction', {
      p_transaction_type: 'TAX_ACCRUAL',
      p_idempotency_key: `TAX-ACCRUAL:${settlementId}`,
      p_reference: cleanRef,
      p_metadata: {
        tax_definition_id: def.id,
        tax_type: def.tax_type,
        taxable_amount: taxable,
        tax_amount: taxAmount,
        description: memo,
      },
      p_entries: [
        { account_id: expAcc.id, side: 'debit', amount_units: taxAmount, memo },
        { account_id: taxAcc.id, side: 'credit', amount_units: taxAmount, memo },
      ],
    });

    if (postErr) {
      throw new Error(postErr.message || 'فشل تسجيل قيد الاستحقاق الضريبي.');
    }

    const { error: insErr } = await db.from('tax_settlements').insert({
      id: settlementId,
      tax_definition_id: def.id,
      taxable_amount: taxable,
      tax_amount: taxAmount,
      status: 'PENDING',
      ledger_transaction_id: String(txId),
      reference_id: cleanRef,
      created_at: new Date().toISOString(),
    });

    if (insErr) {
      throw new Error(`تم تسجيل القيد ولكن تعذر حفظ سجل التسوية: ${insErr.message}`);
    }

    await this.writeFinancialAuditLog({
      actionType: 'TAX_OBLIGATION_ACCRUED',
      actorId: params.actorId,
      transactionId: String(txId),
      details: { settlement_id: settlementId, tax_type: def.tax_type, taxable_amount: taxable, tax_amount: taxAmount },
      authToken: params.authToken,
    });

    return { success: true, settlementId, transactionId: String(txId), taxAmount };
  },

  async settleTaxObligation(params: {
    settlementId: string;
    referenceId: string;
    actorId: string;
    authToken?: string;
  }) {
    const cleanRef = (params.referenceId || '').trim();
    if (!cleanRef) {
      throw new Error('رقم مرجع السداد الضريبي مطلوب.');
    }

    const db = getActorOrAdminClient(params.authToken);
    const rpcClient = getRpcClient(params.authToken);

    const { data: row, error: fetchErr } = await db
      .from('tax_settlements')
      .select('*, tax_definitions(tax_type, tax_authority)')
      .eq('id', params.settlementId)
      .maybeSingle();

    if (fetchErr && (fetchErr.code === 'PGRST205' || fetchErr.code === '42P01')) {
      throw new Error('جدول tax_settlements غير موجود في قاعدة البيانات بعد. يرجى تنفيذ الترحيل 011.');
    }
    if (!row) throw new Error('سجل الاستحقاق الضريبي غير موجود.');
    if (row.status === 'SETTLED') {
      return { success: true, idempotent: true, settlementId: row.id, transactionId: row.ledger_transaction_id };
    }
    if (row.status !== 'PENDING') {
      throw new Error('لا يمكن سداد سجل ضريبي ملغى.');
    }

    const taxAmount = Math.round(Number(row.tax_amount || 0));
    const { data: accounts } = await db
      .from('financial_accounts')
      .select('id, account_code, balance_units')
      .in('account_code', ['TAX-PAYABLE', 'PLATFORM-CASH-VAULT']);

    const taxAcc = (accounts || []).find((a: any) => a.account_code === 'TAX-PAYABLE');
    const cashAcc = (accounts || []).find((a: any) => a.account_code === 'PLATFORM-CASH-VAULT');
    if (!taxAcc || !cashAcc) {
      throw new Error('حسابات سداد الضريبة (TAX-PAYABLE / PLATFORM-CASH-VAULT) غير موجودة.');
    }
    if (Number(cashAcc.balance_units || 0) < taxAmount) {
      throw new Error('رصيد الخزينة النقدية (PLATFORM-CASH-VAULT) غير كافٍ لسداد هذه الضريبة.');
    }

    const memo = `سداد التزام ضريبي: ${row.tax_definitions?.tax_type || ''} بالمرجع ${cleanRef}`;
    const { data: txId, error: postErr } = await rpcClient.rpc('post_ledger_transaction', {
      p_transaction_type: 'TAX_SETTLEMENT',
      p_idempotency_key: `TAX-SETTLE:${row.id}`,
      p_reference: cleanRef,
      p_metadata: {
        settlement_id: row.id,
        tax_amount: taxAmount,
        payment_reference: cleanRef,
        description: memo,
      },
      p_entries: [
        { account_id: taxAcc.id, side: 'debit', amount_units: taxAmount, memo },
        { account_id: cashAcc.id, side: 'credit', amount_units: taxAmount, memo },
      ],
    });

    if (postErr) {
      throw new Error(postErr.message || 'فشل تسجيل قيد سداد الضريبة.');
    }

    const now = new Date().toISOString();
    await db
      .from('tax_settlements')
      .update({
        status: 'SETTLED',
        settled_at: now,
        reference_id: cleanRef,
        ledger_transaction_id: String(txId),
      })
      .eq('id', row.id);

    await this.writeFinancialAuditLog({
      actionType: 'TAX_OBLIGATION_SETTLED',
      actorId: params.actorId,
      transactionId: String(txId),
      details: { settlement_id: row.id, tax_amount: taxAmount, reference_id: cleanRef },
      authToken: params.authToken,
    });

    return { success: true, idempotent: false, settlementId: row.id, transactionId: String(txId) };
  },

  async getComprehensiveFinancialReports(params: {
    from?: string;
    to?: string;
    authToken?: string;
  }): Promise<ComprehensiveFinancialReport> {
    const db = getActorOrAdminClient(params.authToken);
    const fromIso = params.from ? new Date(params.from).toISOString() : null;
    const toDate = params.to ? new Date(params.to) : null;
    if (toDate && params.to && !params.to.includes('T')) {
      toDate.setHours(23, 59, 59, 999);
    }
    const toIso = toDate ? toDate.toISOString() : null;

    const [summary, accountsRes, tasksRes, profilesRes, taxesOverview] = await Promise.all([
      this.getTreasurySummary(params.authToken),
      db.from('financial_accounts').select('id, account_code, account_type, normal_side, owner_user_id, balance_units, status'),
      db.from('tasks').select('id, title, status, escrow_account_id'),
      db.from('profiles').select('id, full_name, phone, email'),
      this.getTaxesOverview(params.authToken),
    ]);

    const accounts = accountsRes.data || [];
    const accById = new Map<string, any>();
    const accByCode = new Map<string, any>();
    for (const a of accounts) {
      accById.set(a.id, a);
      if (a.account_code) accByCode.set(String(a.account_code), a);
    }

    const profileById = new Map<string, any>();
    for (const p of profilesRes.data || []) profileById.set(p.id, p);

    const taskByEscrowId = new Map<string, any>();
    const taskById = new Map<string, any>();
    for (const t of tasksRes.data || []) {
      taskById.set(t.id, t);
      if (t.escrow_account_id) taskByEscrowId.set(t.escrow_account_id, t);
    }

    // Fetch ledger_transactions + ledger_entries within requested period
    let txQuery = db
      .from('ledger_transactions')
      .select('id, transaction_type, reference, metadata, created_by, created_at')
      .order('created_at', { ascending: false })
      .limit(2000);
    if (fromIso) txQuery = txQuery.gte('created_at', fromIso);
    if (toIso) txQuery = txQuery.lte('created_at', toIso);

    const { data: periodTxs } = await txQuery;
    const txIds = (periodTxs || []).map((t: any) => t.id);
    const txMap = new Map<string, any>();
    for (const t of periodTxs || []) txMap.set(t.id, t);

    let periodEntries: any[] = [];
    if (txIds.length > 0) {
      const { data: ents } = await db
        .from('ledger_entries')
        .select('id, transaction_id, account_id, entry_side, amount_units, memo, created_at')
        .in('transaction_id', txIds);
      periodEntries = ents || [];
    }

    const revSourceMap: Record<string, { label: string; periodAmount: number; txSet: Set<string> }> = {
      'PLATFORM-REVENUE-TASKS': { label: 'إيرادات عمولات المهام', periodAmount: 0, txSet: new Set() },
      'PLATFORM-REVENUE-ADS': { label: 'إيرادات الإعلانات والرعاية', periodAmount: 0, txSet: new Set() },
      'PLATFORM-REVENUE-SUBSCRIPTIONS': { label: 'إيرادات الاشتراكات', periodAmount: 0, txSet: new Set() },
      'PLATFORM-REVENUE-SERVICES': { label: 'إيرادات الخدمات ورسوم السحب', periodAmount: 0, txSet: new Set() },
    };

    const expensesItems: ComprehensiveFinancialReport['expensesItems'] = [];
    const ownerWithdrawalsItems: ComprehensiveFinancialReport['ownerWithdrawalsReport']['items'] = [];
    const dailyMap = new Map<string, { revenues: number; expenses: number; taskRewards: number; withdrawals: number }>();

    const ensureDay = (iso: string) => {
      const d = String(iso || '').slice(0, 10) || 'unknown';
      if (!dailyMap.has(d)) dailyMap.set(d, { revenues: 0, expenses: 0, taskRewards: 0, withdrawals: 0 });
      return dailyMap.get(d)!;
    };

    let periodOpEx = 0;
    let periodProviderFees = 0;
    let periodTaxAccrued = 0;
    let periodTaxSettled = 0;
    let periodOwnerCapitalInflows = 0;
    let periodOwnerWithdrawals = 0;
    let periodOperatingCashIn = 0;
    let periodOperatingCashOut = 0;
    let periodTaskRewardsDisbursed = 0;

    for (const e of periodEntries) {
      const acc = accById.get(e.account_id);
      const tx = txMap.get(e.transaction_id);
      if (!acc || !tx) continue;
      const code = String(acc.account_code || '');
      const side = String(e.entry_side || '').toLowerCase();
      const normalSide = String(acc.normal_side || 'credit').toLowerCase();
      const amt = Number(e.amount_units || 0);
      const signed = normalSide === side ? amt : -amt;
      const txType = String(tx.transaction_type || '').toUpperCase();
      const day = ensureDay(tx.created_at || e.created_at);

      if (revSourceMap[code]) {
        revSourceMap[code].periodAmount += signed;
        revSourceMap[code].txSet.add(tx.id);
        day.revenues += signed;
      }

      if (code === 'PLATFORM-EXPENSES') {
        if (txType === 'TAX_ACCRUAL') {
          periodTaxAccrued += signed;
        } else {
          periodOpEx += signed;
        }
        day.expenses += signed;
        expensesItems.push({
          transactionId: tx.id,
          date: tx.created_at,
          category: tx.metadata?.expense_category || (txType === 'TAX_ACCRUAL' ? 'استحقاق ضريبي' : 'مصروف تشغيلي'),
          accountCode: code,
          amount: signed,
          description: tx.metadata?.description || e.memo || tx.reference || txType,
          referenceId: tx.reference,
        });
      }

      if (code === 'PAYMENT-PROVIDER-FEES') {
        periodProviderFees += signed;
        day.expenses += signed;
        expensesItems.push({
          transactionId: tx.id,
          date: tx.created_at,
          category: 'عمولات مزودي الدفع',
          accountCode: code,
          amount: signed,
          description: tx.metadata?.description || e.memo || tx.reference || txType,
          referenceId: tx.reference,
        });
      }

      if (code === 'TAX-PAYABLE' && txType === 'TAX_SETTLEMENT' && side === 'debit') {
        periodTaxSettled += amt;
      }

      if (code === 'OWNER-CAPITAL') {
        periodOwnerCapitalInflows += signed;
      }

      if (code === 'OWNER-WITHDRAWALS') {
        periodOwnerWithdrawals += signed;
        const actor = tx.created_by ? profileById.get(tx.created_by) : null;
        ownerWithdrawalsItems.push({
          transactionId: tx.id,
          date: tx.created_at,
          amount: signed,
          description: tx.metadata?.description || e.memo || 'سحب مالك المنصة',
          actorName: actor?.full_name || actor?.email || 'المالك',
        });
      }

      if (code === 'PLATFORM-CASH-VAULT') {
        if (txType === 'AD_REVENUE' || txType === 'SUBSCRIPTION_REVENUE' || txType === 'SERVICE_REVENUE') {
          periodOperatingCashIn += signed;
        } else if (txType === 'OPERATIONAL_EXPENSE' || txType === 'PAYMENT_PROVIDER_FEE' || txType === 'TAX_SETTLEMENT') {
          periodOperatingCashOut += Math.abs(signed);
        }
      }

      if (txType === 'TASK_REWARD_PAYOUT' && acc.account_type === 'wallet' && side === 'credit') {
        periodTaskRewardsDisbursed += amt;
        day.taskRewards += amt;
      }

      if (txType === 'WITHDRAWAL_PAYOUT' && code === 'WITHDRAWAL-SETTLED' && side === 'credit') {
        day.withdrawals += amt;
      }
    }

    const revenueTasks = revSourceMap['PLATFORM-REVENUE-TASKS'].periodAmount;
    const revenueAds = revSourceMap['PLATFORM-REVENUE-ADS'].periodAmount;
    const revenueSubscriptions = revSourceMap['PLATFORM-REVENUE-SUBSCRIPTIONS'].periodAmount;
    const revenueServices = revSourceMap['PLATFORM-REVENUE-SERVICES'].periodAmount;
    const totalPeriodRevenue = revenueTasks + revenueAds + revenueSubscriptions + revenueServices;
    const totalPeriodExpenses = periodOpEx + periodProviderFees + periodTaxAccrued;
    const periodNetProfitLoss = totalPeriodRevenue - totalPeriodExpenses;

    const netOperatingCashFlow = periodOperatingCashIn - periodOperatingCashOut;
    const netFinancingCashFlow = periodOwnerCapitalInflows - periodOwnerWithdrawals;
    const netCashChange = netOperatingCashFlow + netFinancingCashFlow;

    const walletUsersList = accounts
      .filter((a: any) => a.account_type === 'wallet')
      .map((a: any) => {
        const prof = a.owner_user_id ? profileById.get(a.owner_user_id) : null;
        return {
          userId: a.owner_user_id || a.id,
          fullName: prof?.full_name || 'مستخدم',
          phone: prof?.phone || '---',
          accountCode: a.account_code,
          balanceUnits: Number(a.balance_units || 0),
          status: a.status || 'active',
        };
      })
      .sort((a: any, b: any) => b.balanceUnits - a.balanceUnits);

    const escrowsList = accounts
      .filter((a: any) => String(a.account_code || '').startsWith('TASK-ESCROW-'))
      .map((a: any) => {
        const tId = String(a.account_code || '').replace(/^TASK-ESCROW-/, '');
        const taskRow = taskByEscrowId.get(a.id) || taskById.get(tId);
        return {
          accountCode: a.account_code,
          taskId: taskRow?.id || tId,
          taskTitle: taskRow?.title || (a.account_code === 'TASK-ESCROW-POOL' ? 'حوض ضمان المهام العام' : a.account_code),
          taskStatus: String(taskRow?.status || a.status || 'active').toUpperCase(),
          balanceUnits: Number(a.balance_units || 0),
        };
      })
      .filter((item: any) => item.balanceUnits > 0 || item.taskStatus === 'ACTIVE')
      .sort((a: any, b: any) => b.balanceUnits - a.balanceUnits);

    const expenseClearingBal = Number(accByCode.get('PLATFORM-EXPENSE-CLEARING')?.balance_units || 0);
    const totalCumulativeRevenue = summary.revenueTotals?.total || 0;
    const totalCumulativeExpenses = summary.totalOperationalExpenses || 0;
    const cumulativeNetIncome = totalCumulativeRevenue - totalCumulativeExpenses;
    const retainedAccBal = summary.retainedEarningsTotal || 0;
    const ownerCapitalBal = summary.ownerCapitalTotal || 0;
    const ownerWithdrawalsBal = summary.ownerWithdrawalsTotal || 0;

    return {
      period: {
        from: fromIso,
        to: toIso,
        generatedAt: new Date().toISOString(),
      },
      readiness: {
        migration011Ready: Boolean(summary.migration011Ready),
        missingMigration011Accounts: summary.missingMigration011Accounts || [],
        taxTablesReady: Boolean(summary.taxTablesReady),
        withdrawalsTableReady: Boolean(summary.withdrawalsTableReady),
        auditLogsTableReady: Boolean(summary.auditLogsTableReady),
      },
      profitAndLoss: {
        revenueTasks,
        revenueAds,
        revenueSubscriptions,
        revenueServices,
        totalRevenue: totalPeriodRevenue,
        operationalExpenses: periodOpEx,
        paymentProviderFees: periodProviderFees,
        taxExpenses: periodTaxAccrued,
        totalExpenses: totalPeriodExpenses,
        netProfitLoss: periodNetProfitLoss,
        taskRewardsDisbursedNote: periodTaskRewardsDisbursed,
      },
      cashFlow: {
        operatingCashInflows: periodOperatingCashIn,
        operatingCashOutflows: periodOperatingCashOut,
        netOperatingCashFlow,
        ownerCapitalInflows: periodOwnerCapitalInflows,
        ownerWithdrawalsOutflows: periodOwnerWithdrawals,
        netFinancingCashFlow,
        netCashChange,
        endingCashVaultBalance: summary.cashVaultTotal || 0,
        virtualTreasuryAvailable: summary.treasuryAvailable || 0,
      },
      balanceSheet: {
        assets: {
          cashVault: summary.cashVaultTotal || 0,
          externalAccounts: summary.externalAccountsTotal || 0,
          externalPlatformAccounts: summary.externalPlatformBalance || 0,
          externalAdvertiserCustodyAccounts: summary.externalAdvertiserCustodyBalance || 0,
          virtualIssuanceControl: summary.totalIssuedUnits || 0,
          totalRealAssets: (summary.cashVaultTotal || 0) + (summary.externalAccountsTotal || 0),
        },
        liabilities: {
          userWalletBalances: summary.userAvailableTotal || 0,
          advertiserWalletBalances: summary.advertiserWalletTotal || 0,
          workerWalletBalances: summary.workerWalletTotal || 0,
          withdrawalReserved: summary.withdrawalReservedTotal || 0,
          taskEscrowBalances: summary.taskBudgetReserved || 0,
          campaignBudgetEscrows: summary.campaignBudgetReserved || 0,
          campaignFeeEscrows: summary.campaignFeeReserved || 0,
          taxesPayable: summary.taxPayableTotal || 0,
          expenseClearing: expenseClearingBal,
          totalUserAndExternalLiabilities:
            (summary.userAvailableTotal || 0) +
            (summary.withdrawalReservedTotal || 0) +
            (summary.taskBudgetReserved || 0) +
            (summary.campaignBudgetReserved || 0) +
            (summary.campaignFeeReserved || 0) +
            (summary.taxPayableTotal || 0),
        },
        equity: {
          ownerCapital: ownerCapitalBal,
          ownerWithdrawals: ownerWithdrawalsBal,
          retainedEarningsAccount: retainedAccBal,
          currentNetIncome: cumulativeNetIncome,
          totalOwnerEquity: ownerCapitalBal + retainedAccBal + cumulativeNetIncome - ownerWithdrawalsBal,
        },
      },
      fundSegregation: summary.fundSegregation,
      revenueBySource: Object.entries(revSourceMap).map(([accountCode, v]) => ({
        accountCode,
        label: v.label,
        periodAmount: v.periodAmount,
        cumulativeBalance: Number(accByCode.get(accountCode)?.balance_units || 0),
        txCount: v.txSet.size,
      })),
      expensesItems: expensesItems.sort((a, b) => b.date.localeCompare(a.date)),
      taxesReport: {
        taxPayableBalance: summary.taxPayableTotal || 0,
        totalAccruedInPeriod: periodTaxAccrued,
        totalSettledInPeriod: periodTaxSettled || summary.taxesPaidTotal || 0,
        activeDefinitionsCount: taxesOverview.definitions.filter((d) => d.isActive).length,
        settlements: taxesOverview.settlements.filter((s) => {
          if (fromIso && s.createdAt < fromIso) return false;
          if (toIso && s.createdAt > toIso) return false;
          return true;
        }),
      },
      ownerWithdrawalsReport: {
        totalInPeriod: periodOwnerWithdrawals,
        cumulativeTotal: ownerWithdrawalsBal,
        items: ownerWithdrawalsItems.sort((a, b) => b.date.localeCompare(a.date)),
      },
      userBalancesAndEscrowsReport: {
        totalUserWallets: summary.userAvailableTotal || 0,
        totalWithdrawalReserved: summary.withdrawalReservedTotal || 0,
        totalTaskEscrows: summary.taskBudgetReserved || 0,
        users: walletUsersList,
        escrows: escrowsList,
      },
      dailyBreakdown: Array.from(dailyMap.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, vals]) => ({ date, ...vals })),
    };
  },

  /**
   * 6. PLATFORM SETTINGS
   */
  async getSettings(authToken?: string): Promise<PlatformSettings> {
    const defaultSettings: PlatformSettings = {
      id: 'settings-1',
      platformName: 'كسب اليمن',
      currency: 'YER',
      minWithdrawal: 1000,
      maxWithdrawal: 500000,
      dailyWithdrawalLimit: 1000000,
      defaultFeePercentage: 1.5,
      advertiserCampaignFeePercentage: 20,
      referralBonus: 30,
      taskSubmissionLimit: 10,
      isRegistrationOpen: true,
      maintenanceMode: false,
      contactPhone: '+967 739 701 293',
      contactEmail: 'khalidalbuhiri@gmail.com',
      updatedAt: new Date().toISOString(),
    };

    try {
      const db = getActorOrAdminClient(authToken);
      const { data, error } = await db.from('platform_settings').select('*');

      if (error || !data || data.length === 0) {
        return defaultSettings;
      }

      // Support single-row column-based platform_settings (Migration 005)
      const first = data[0] as any;
      if (first && first.setting_key === undefined && first.referral_bonus !== undefined) {
        const rawCampaignFee = Number(first.advertiser_campaign_fee_percentage);
        return {
          ...defaultSettings,
          id: String(first.id || defaultSettings.id),
          platformName: String(first.platform_name || defaultSettings.platformName),
          minWithdrawal: Number(first.min_withdrawal ?? defaultSettings.minWithdrawal),
          maxWithdrawal: Number(first.max_withdrawal ?? defaultSettings.maxWithdrawal),
          dailyWithdrawalLimit: Number(first.daily_withdrawal_limit ?? defaultSettings.dailyWithdrawalLimit),
          defaultFeePercentage: Number(first.default_fee_percentage ?? defaultSettings.defaultFeePercentage),
          advertiserCampaignFeePercentage:
            Number.isFinite(rawCampaignFee) && rawCampaignFee >= 0 && rawCampaignFee <= 50
              ? rawCampaignFee
              : defaultSettings.advertiserCampaignFeePercentage,
          referralBonus: Number(first.referral_bonus ?? defaultSettings.referralBonus),
          taskSubmissionLimit: Number(first.task_submission_limit ?? defaultSettings.taskSubmissionLimit),
          isRegistrationOpen: first.is_registration_open !== undefined ? Boolean(first.is_registration_open) : true,
          maintenanceMode: Boolean(first.maintenance_mode),
          contactPhone: String(first.contact_phone || defaultSettings.contactPhone),
          contactEmail: String(first.contact_email || defaultSettings.contactEmail),
          updatedAt: first.updated_at || defaultSettings.updatedAt,
        };
      }

      // Support key-value platform_settings
      const map = new Map<string, any>();
      let latestUpdate = defaultSettings.updatedAt;
      for (const row of data) {
        map.set(row.setting_key, row.setting_value);
        if (row.updated_at && row.updated_at > latestUpdate) {
          latestUpdate = row.updated_at;
        }
      }

      const rawKvCampaignFee = Number(map.get('advertiser_campaign_fee_percentage'));

      return {
        ...defaultSettings,
        platformName: String(map.get('platform_name') || defaultSettings.platformName),
        minWithdrawal: Number(map.get('min_withdrawal') ?? defaultSettings.minWithdrawal),
        maxWithdrawal: Number(map.get('max_withdrawal') ?? defaultSettings.maxWithdrawal),
        dailyWithdrawalLimit: Number(map.get('daily_withdrawal_limit') ?? defaultSettings.dailyWithdrawalLimit),
        defaultFeePercentage: Number(map.get('default_fee_percentage') ?? defaultSettings.defaultFeePercentage),
        advertiserCampaignFeePercentage:
          Number.isFinite(rawKvCampaignFee) && rawKvCampaignFee >= 0 && rawKvCampaignFee <= 50
            ? rawKvCampaignFee
            : defaultSettings.advertiserCampaignFeePercentage,
        referralBonus: Number(map.get('referral_bonus') ?? defaultSettings.referralBonus),
        taskSubmissionLimit: Number(map.get('task_submission_limit') ?? defaultSettings.taskSubmissionLimit),
        isRegistrationOpen: map.has('is_registration_open') ? Boolean(map.get('is_registration_open')) : true,
        maintenanceMode: Boolean(map.get('maintenance_mode')),
        contactPhone: String(map.get('contact_phone') || defaultSettings.contactPhone),
        contactEmail: String(map.get('contact_email') || defaultSettings.contactEmail),
        updatedAt: latestUpdate,
      };
    } catch {
      return defaultSettings;
    }
  },

  async updateSettings(payload: any): Promise<PlatformSettings> {
    const db = getDbClient();
    if (payload.advertiserCampaignFeePercentage !== undefined) {
      const pct = Number(payload.advertiserCampaignFeePercentage);
      if (!Number.isFinite(pct) || pct < 0 || pct > 50) {
        throw new Error('نسبة رسوم حملات المعلنين يجب أن تكون رقماً بين 0% و 50%.');
      }
    }

    try {
      const now = new Date().toISOString();
      const { data: rows } = await db.from('platform_settings').select('*').limit(1);
      const first = rows?.[0] as any;

      if (first && first.setting_key === undefined && first.referral_bonus !== undefined) {
        const updateColPayload: Record<string, any> = { updated_at: now };
        if (payload.platformName !== undefined) updateColPayload.platform_name = payload.platformName;
        if (payload.minWithdrawal !== undefined) updateColPayload.min_withdrawal = Number(payload.minWithdrawal);
        if (payload.maxWithdrawal !== undefined) updateColPayload.max_withdrawal = Number(payload.maxWithdrawal);
        if (payload.dailyWithdrawalLimit !== undefined) updateColPayload.daily_withdrawal_limit = Number(payload.dailyWithdrawalLimit);
        if (payload.defaultFeePercentage !== undefined) updateColPayload.default_fee_percentage = Number(payload.defaultFeePercentage);
        if (payload.referralBonus !== undefined) updateColPayload.referral_bonus = Number(payload.referralBonus);
        if (payload.isRegistrationOpen !== undefined) updateColPayload.is_registration_open = Boolean(payload.isRegistrationOpen);
        if (payload.maintenanceMode !== undefined) updateColPayload.maintenance_mode = Boolean(payload.maintenanceMode);
        if (payload.contactPhone !== undefined) updateColPayload.contact_phone = payload.contactPhone;
        if (payload.contactEmail !== undefined) updateColPayload.contact_email = payload.contactEmail;
        if (payload.advertiserCampaignFeePercentage !== undefined && first.advertiser_campaign_fee_percentage !== undefined) {
          updateColPayload.advertiser_campaign_fee_percentage = Number(payload.advertiserCampaignFeePercentage);
        }

        const { error: colErr } = await db.from('platform_settings').update(updateColPayload).eq('id', first.id);
        if (colErr) throw colErr;
        return this.getSettings();
      }

      const pairs: Array<[string, any]> = [
        ['platform_name', payload.platformName],
        ['min_withdrawal', payload.minWithdrawal],
        ['max_withdrawal', payload.maxWithdrawal],
        ['daily_withdrawal_limit', payload.dailyWithdrawalLimit],
        ['default_fee_percentage', payload.defaultFeePercentage],
        ['advertiser_campaign_fee_percentage', payload.advertiserCampaignFeePercentage],
        ['referral_bonus', payload.referralBonus],
        ['is_registration_open', payload.isRegistrationOpen],
        ['maintenance_mode', payload.maintenanceMode],
        ['contact_phone', payload.contactPhone],
        ['contact_email', payload.contactEmail],
      ];

      for (const [key, val] of pairs) {
        if (val !== undefined) {
          const { error: kvErr } = await db
            .from('platform_settings')
            .upsert({ setting_key: key, setting_value: val, updated_at: now }, { onConflict: 'setting_key' });
          if (kvErr) throw kvErr;
        }
      }

      return this.getSettings();
    } catch (err: any) {
      throw new Error(`فشل تحديث إعدادات المنصة في Supabase: ${err.message}`);
    }
  },

  /**
   * 7. PAYOUT METHODS
   */
  async getPayoutMethods(): Promise<PayoutMethod[]> {
    const fallbackMethods: PayoutMethod[] = [
      {
        id: 'pm-1',
        code: 'KURAIMI',
        name: 'Al-Kuraimi Microfinance Bank',
        nameAr: 'بنك الكريمي للتمويل الأصغر الإسلامي',
        minWithdrawal: 1000,
        maxWithdrawal: 500000,
        feePercentage: 1.0,
        feeFlat: 0,
        isActive: true,
        requiredFields: ['beneficiary_name', 'phone_number', 'account_number'],
      },
      {
        id: 'pm-2',
        code: 'NAJM',
        name: 'Al-Najm Financial Remittance',
        nameAr: 'شبكة النجم للحوالات المالية الفورية',
        minWithdrawal: 1000,
        maxWithdrawal: 500000,
        feePercentage: 1.5,
        feeFlat: 0,
        isActive: true,
        requiredFields: ['beneficiary_name', 'phone_number'],
      },
      {
        id: 'pm-3',
        code: 'JAWALI',
        name: 'Jawali Wallet (CAC Bank)',
        nameAr: 'محفظة جوالي كاك بنك',
        minWithdrawal: 1000,
        maxWithdrawal: 250000,
        feePercentage: 1.0,
        feeFlat: 0,
        isActive: true,
        requiredFields: ['beneficiary_name', 'phone_number'],
      },
      {
        id: 'pm-4',
        code: 'ONE_CASH',
        name: 'OneCash Wallet',
        nameAr: 'محفظة ون كاش (OneCash)',
        minWithdrawal: 1000,
        maxWithdrawal: 300000,
        feePercentage: 1.0,
        feeFlat: 0,
        isActive: true,
        requiredFields: ['beneficiary_name', 'phone_number'],
      },
    ];

    try {
      const db = getDbClient();
      const { data, error } = await db
        .from('payout_methods')
        .select('*')
        .eq('is_active', true);

      if (error || !data || data.length === 0) {
        return fallbackMethods;
      }

      return data.map((m: any) => ({
        id: m.id,
        code: m.code,
        name: m.name,
        nameAr: m.name_ar,
        minWithdrawal: Number(m.min_withdrawal || 1000),
        maxWithdrawal: Number(m.max_withdrawal || 500000),
        feePercentage: Number(m.fee_percentage || 1.5),
        feeFlat: Number(m.fee_flat || 0),
        isActive: m.is_active,
        requiredFields: m.required_fields || ['beneficiary_name', 'phone_number'],
      }));
    } catch {
      return fallbackMethods;
    }
  },

  /**
   * 8. WITHDRAWALS (Optional table in live schema)
   */
  async getWithdrawals(userId?: string): Promise<WithdrawalRequest[]> {
    try {
      const db = getDbClient();
      let query = db.from('withdrawal_requests').select('*').order('created_at', { ascending: false });
      if (userId) {
        query = query.eq('user_id', userId);
      }

      const { data, error } = await query;
      if (error) return [];

      return (data || []).map((w: any) => ({
        id: w.id,
        userId: w.user_id,
        userFullName: w.beneficiary_name,
        userPhone: w.phone_number,
        method: w.method,
        methodNameAr: w.method,
        amount: Number(w.amount || 0),
        fee: Number(w.fee || 0),
        netAmount: Number(w.net_amount || 0),
        beneficiaryName: w.beneficiary_name,
        phoneNumber: w.phone_number,
        accountNumber: w.account_number,
        status: w.status,
        rejectionReason: w.rejection_reason,
        transferReference: w.transfer_reference,
        receiptUrl: w.receipt_url,
        adminId: w.admin_id,
        processedAt: w.processed_at,
        createdAt: w.created_at,
      }));
    } catch {
      return [];
    }
  },

  /**
   * 9. NOTIFICATIONS (Optional table in live schema)
   */
  async getNotifications(userId: string): Promise<AppNotification[]> {
    try {
      const db = getDbClient();
      const { data, error } = await db
        .from('notifications')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (error) return [];

      return (data || []).map((n: any) => ({
        id: n.id,
        userId: n.user_id,
        title: n.title,
        message: n.message,
        type: n.type,
        link: n.link,
        isRead: n.is_read,
        createdAt: n.created_at,
      }));
    } catch {
      return [];
    }
  },

  async markNotificationsRead(userId: string): Promise<void> {
    try {
      const db = getDbClient();
      await db
        .from('notifications')
        .update({ is_read: true })
        .eq('user_id', userId);
    } catch {
      // Optional table
    }
  },

  /**
   * 10. REFERRAL SYSTEM (Validation, Ledger-Backed Summary & Reward Lookup)
   */
  async resolveReferralCode(code: string): Promise<{ referrerId: string; referralCode: string; phone?: string } | null> {
    const clean = String(code || '').trim().toUpperCase();
    if (!clean) return null;

    const db = getDbClient();
    const { data: profileRow, error } = await db
      .from('profiles')
      .select('id, phone, referral_code')
      .ilike('referral_code', clean)
      .maybeSingle();

    if (!error && profileRow?.id) {
      return {
        referrerId: profileRow.id,
        referralCode: profileRow.referral_code || clean,
        phone: profileRow.phone || undefined,
      };
    }

    // Fallback to SECURITY DEFINER RPC when service_role is absent & profiles RLS blocks anon
    const { data: rpcId, error: rpcErr } = await db.rpc('resolve_referral_code', { p_code: clean });
    if (!rpcErr && rpcId) {
      return { referrerId: String(rpcId), referralCode: clean };
    }

    return null;
  },

  async getMyReferrals(userId: string, authToken?: string): Promise<ReferralStat> {
    const settings = await this.getSettings(authToken);

    // 1. Prefer Migration 014 SECURITY DEFINER RPC when deployed (enforces auth.uid() & reads ledger-backed rewards)
    if (authToken) {
      const userClient = getSupabaseUserClient(authToken);
      const { data: rpcSummary, error: rpcErr } = await userClient.rpc('get_my_referral_summary');
      if (!rpcErr && rpcSummary && typeof rpcSummary === 'object') {
        const ownCode = String(rpcSummary.code || generateReferralCode(userId));
        return {
          code: ownCode,
          shareUrl: ownCode ? `https://kasbyemen.com/?ref=${encodeURIComponent(ownCode)}` : 'https://kasbyemen.com/',
          referralBonus: Number(rpcSummary.referralBonus ?? settings.referralBonus),
          totalReferred: Number(rpcSummary.totalReferred || 0),
          qualifiedReferralsCount: Number(rpcSummary.qualifiedReferralsCount || 0),
          paidRewardsCount: Number(rpcSummary.paidRewardsCount || 0),
          totalEarnedYer: Number(rpcSummary.totalEarnedYer || 0),
          referredUsers: Array.isArray(rpcSummary.referredUsers) ? rpcSummary.referredUsers : [],
        };
      }
    }

    // 2. Fallback query path (gracefully handles pre-Migration 014 live schema)
    const db = getActorOrAdminClient(authToken);
    let ownReferralCode = '';
    const { data: selfProf } = await db
      .from('profiles')
      .select('referral_code')
      .eq('id', userId)
      .maybeSingle();
    ownReferralCode = String(selfProf?.referral_code || '');

    let referredProfiles: any[] = [];
    const { data: refRows, error: refErr } = await db
      .from('profiles')
      .select('id, full_name, created_at')
      .eq('referred_by', userId)
      .order('created_at', { ascending: false });

    if (!refErr && Array.isArray(refRows)) {
      referredProfiles = refRows;
    }

    const referredIds = referredProfiles.map((r) => r.id);
    let approvedSubmissions: any[] = [];
    let referralRewards: any[] = [];

    if (referredIds.length > 0) {
      const [subsRes, rewardsRes] = await Promise.all([
        db
          .from('task_submissions')
          .select('user_id, status, reward_transaction_id')
          .in('user_id', referredIds)
          .not('reward_transaction_id', 'is', null),
        db
          .from('referral_rewards')
          .select('referred_user_id, reward_amount, status, ledger_transaction_id, paid_at')
          .eq('referrer_id', userId),
      ]);

      if (!subsRes.error && Array.isArray(subsRes.data)) {
        approvedSubmissions = subsRes.data;
      }
      if (!rewardsRes.error && Array.isArray(rewardsRes.data)) {
        referralRewards = rewardsRes.data;
      }
    }

    return computeReferralSummary({
      ownReferralCode,
      referralBonus: settings.referralBonus,
      referredProfiles,
      approvedSubmissions,
      referralRewards,
    });
  },

  async getReferralRewardForSubmission(submissionId: string, authToken?: string) {
    try {
      const db = getActorOrAdminClient(authToken);
      const { data, error } = await db
        .from('referral_rewards')
        .select('id, referrer_id, referred_user_id, reward_amount, status, ledger_transaction_id, paid_at, failure_reason')
        .eq('trigger_submission_id', submissionId)
        .maybeSingle();
      if (error || !data) return null;
      return data;
    } catch {
      return null;
    }
  },

  /**
   * 8. ADVERTISER CAMPAIGNS & ESCROW FUNDING (PHASE 3)
   */
  async getCampaignsForAdvertiser(advertiserId: string, authToken?: string): Promise<CampaignItem[]> {
    const db = getActorOrAdminClient(authToken);
    const { data, error } = await db
      .from('campaigns')
      .select('*')
      .eq('advertiser_id', advertiserId)
      .order('created_at', { ascending: false });

    if (error) {
      if (error.code === '42P01' || String(error.message || '').includes('does not exist')) {
        return [];
      }
      throw new Error(`فشل جلب حملات المعلن: ${error.message}`);
    }

    return this._hydrateCampaignRows(data || [], db);
  },

  async getAllAdminCampaigns(authToken?: string): Promise<CampaignItem[]> {
    const db = getActorOrAdminClient(authToken);
    const { data, error } = await db
      .from('campaigns')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      if (error.code === '42P01' || String(error.message || '').includes('does not exist')) {
        return [];
      }
      throw new Error(`فشل جلب جميع الحملات الإعلانية: ${error.message}`);
    }

    return this._hydrateCampaignRows(data || [], db);
  },

  async _hydrateCampaignRows(rows: any[], db: any): Promise<CampaignItem[]> {
    if (!rows || rows.length === 0) return [];
    const campIds = rows.map((r) => r.id);
    const advIds = Array.from(new Set(rows.map((r) => r.advertiser_id).filter(Boolean)));
    const accIds = Array.from(
      new Set(rows.flatMap((r) => [r.budget_escrow_account_id, r.fee_escrow_account_id]).filter(Boolean))
    );
    const taskIds = Array.from(new Set(rows.map((r) => r.linked_task_id).filter(Boolean)));

    const [profilesRes, accountsRes, tasksRes, targetsRes, countriesRes] = await Promise.all([
      advIds.length > 0
        ? db.from('profiles').select('id, full_name, company_name').in('id', advIds)
        : Promise.resolve({ data: [] }),
      accIds.length > 0
        ? db.from('financial_accounts').select('id, balance_units').in('id', accIds)
        : Promise.resolve({ data: [] }),
      taskIds.length > 0
        ? db.from('tasks').select('id, approved_count').in('id', taskIds)
        : Promise.resolve({ data: [] }),
      Promise.resolve(
        db.from('campaign_target_divisions').select('campaign_id, country_id, division_id').in('campaign_id', campIds)
      ).catch(() => ({ data: [] })),
      geoService.getCountries({ includeInactive: true }).catch(() => ({ countries: [] })),
    ]);

    const profileMap = new Map<string, any>();
    for (const p of profilesRes.data || []) profileMap.set(p.id, p);
    const accMap = new Map<string, number>();
    for (const a of accountsRes.data || []) accMap.set(a.id, Number(a.balance_units || 0));
    const taskMap = new Map<string, number>();
    for (const t of tasksRes.data || []) taskMap.set(t.id, Number(t.approved_count || 0));
    const countryMap = new Map((countriesRes.countries || []).map((c: any) => [c.id, c]));

    const targetIdsByCampaign = new Map<string, string[]>();
    const allDivIds = new Set<string>();
    for (const tr of (targetsRes as any)?.data || []) {
      const arr = targetIdsByCampaign.get(tr.campaign_id) || [];
      arr.push(tr.division_id);
      targetIdsByCampaign.set(tr.campaign_id, arr);
      allDivIds.add(tr.division_id);
    }
    for (const r of rows) {
      const metaGeo = r.proof_requirements?._campaignMeta?.geo;
      if (Array.isArray(metaGeo?.targetDivisionIds)) {
        for (const id of metaGeo.targetDivisionIds) allDivIds.add(id);
      }
    }
    const summaryMap = await geoService.resolveTargetSummariesByIds(Array.from(allDivIds));

    return rows.map((r) => {
      const prof = profileMap.get(r.advertiser_id);
      const rawReqs = r.proof_requirements || {};
      const campaignMeta = rawReqs._campaignMeta || {};
      const metaGeo = campaignMeta.geo || {};
      const { _campaignMeta: _strip, ...cleanProofReqs } = rawReqs;
      const hideAdvertiserName = Boolean(
        r.hide_advertiser_name ?? campaignMeta.hideAdvertiserName ?? false
      );
      const advertiserDisplayName =
        (typeof (r.advertiser_display_name ?? campaignMeta.advertiserDisplayName) === 'string' &&
          String(r.advertiser_display_name ?? campaignMeta.advertiserDisplayName).trim()) ||
        prof?.company_name ||
        prof?.full_name ||
        'معلن';
      const advertiserLogoUrl = sanitizeAdvertiserLogoUrl(
        r.advertiser_logo_url ?? campaignMeta.advertiserLogoUrl
      );

      const resolvedCountryId = r.country_id ?? metaGeo.countryId ?? null;
      const countryObj = resolvedCountryId ? countryMap.get(resolvedCountryId) : undefined;
      const targetIds = targetIdsByCampaign.get(r.id) || (Array.isArray(metaGeo.targetDivisionIds) ? metaGeo.targetDivisionIds : []);
      const targetDivisions = targetIds
        .map((id: string) => summaryMap.get(id))
        .filter(Boolean) as GeoTargetSummary[];
      const isNationwide = r.is_nationwide !== undefined ? Boolean(r.is_nationwide) : metaGeo.isNationwide ?? true;

      return {
        id: r.id,
        advertiserId: r.advertiser_id,
        advertiserName: prof?.full_name || 'معلن',
        advertiserCompany: prof?.company_name || undefined,
        hideAdvertiserName,
        advertiserDisplayName,
        advertiserLogoUrl,
        isExternalCampaign: true,
        title: r.title,
        description: r.description,
        category: (r.category || 'app_testing') as CampaignItem['category'],
        rewardUnits: Number(r.reward_units || 0),
        slots: Number(r.slots || 0),
        budgetUnits: Number(r.budget_units || 0),
        feePercentage: Number(r.fee_percentage ?? 20),
        feeUnits: Number(r.fee_units || 0),
        totalUnits: Number(r.total_units || 0),
        refundedUnits: Number(r.refunded_units || 0),
        budgetEscrowBalance: accMap.get(r.budget_escrow_account_id) ?? 0,
        feeEscrowBalance: accMap.get(r.fee_escrow_account_id) ?? 0,
        status: (r.status || 'pending_start') as CampaignStatus,
        creationKey: r.creation_key,
        fundingTransactionId: r.funding_transaction_id || null,
        feeRevenueTransactionId: r.fee_revenue_transaction_id || null,
        settlementTransactionId: r.settlement_transaction_id || null,
        linkedTaskId: r.linked_task_id || null,
        approvedCount: r.linked_task_id ? (taskMap.get(r.linked_task_id) ?? 0) : 0,
        timeEstimateMinutes: Number(r.time_estimate_minutes || 10),
        proofRequirements: {
          requireImage: cleanProofReqs.requireImage ?? true,
          requireText: cleanProofReqs.requireText ?? true,
          requireUrl: cleanProofReqs.requireUrl,
          instructions: cleanProofReqs.instructions,
        },
        deadlineAt: r.deadline_at || null,
        startedAt: r.started_at || null,
        settledAt: r.settled_at || null,
        countryId: resolvedCountryId,
        countryCode: countryObj?.iso2 || null,
        countryNameAr: countryObj?.nameAr || null,
        countryFlag: countryObj?.flagEmoji || null,
        isNationwide,
        targetDivisionIds: targetIds,
        targetDivisions,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      };
    });
  },

  async createAdvertiserCampaign(params: {
    advertiserId: string;
    title: string;
    description: string;
    category?: string;
    rewardUnits: number;
    slots: number;
    timeEstimateMinutes?: number;
    proofRequirements?: Record<string, any>;
    hideAdvertiserName?: boolean;
    advertiserDisplayName?: string;
    advertiserLogoUrl?: string | null;
    deadlineAt?: string | null;
    creationKey?: string;
    countryId?: string | null;
    isNationwide?: boolean;
    targetDivisionIds?: string[];
    authToken?: string;
  }) {
    const cleanTitle = String(params.title || '').trim();
    const cleanDesc = String(params.description || '').trim();
    if (!cleanTitle || !cleanDesc) {
      throw new Error('عنوان الحملة ووصف المهمة مطلوبان.');
    }

    let geoValidated: Awaited<ReturnType<typeof geoService.validateGeoSelection>> | null = null;
    if (params.countryId || (params.targetDivisionIds && params.targetDivisionIds.length > 0)) {
      geoValidated = await geoService.validateGeoSelection({
        countryId: params.countryId,
        divisionIds: params.targetDivisionIds,
        requireActiveCountry: true,
        authToken: params.authToken,
      });
    }

    const isNationwide =
      params.isNationwide !== undefined
        ? Boolean(params.isNationwide)
        : !geoValidated || geoValidated.divisions.length === 0;
    const validatedDivisionIds = !isNationwide && geoValidated ? geoValidated.divisions.map((d) => d.id) : [];

    const settings = await this.getSettings(params.authToken);
    const costs = calculateCampaignFundingCosts({
      rewardUnits: params.rewardUnits,
      slots: params.slots,
      category: params.category,
      policy: settings.campaignFeePolicy || { defaultFeePercentage: settings.advertiserCampaignFeePercentage },
    });
    const creationKey = String(params.creationKey || '').trim() || `CAMP-${crypto.randomUUID()}`;

    const advertiserProfile = await this.findUserById(params.advertiserId);
    if (!advertiserProfile || advertiserProfile.role !== 'advertiser') {
      throw new Error('هذا الإجراء متاح لحسابات المعلنين فقط.');
    }
    if (advertiserProfile.status !== 'active') {
      throw new Error('حساب المعلن قيد المراجعة ولم يتم اعتماده من الإدارة بعد.');
    }

    const hideAdvertiserName = Boolean(params.hideAdvertiserName);
    const cleanDisplayName =
      typeof params.advertiserDisplayName === 'string' && params.advertiserDisplayName.trim()
        ? params.advertiserDisplayName.trim().slice(0, 100)
        : advertiserProfile.companyName || advertiserProfile.fullName;
    const cleanLogoUrl = sanitizeAdvertiserLogoUrl(params.advertiserLogoUrl);
    const mergedProofRequirements = {
      ...(params.proofRequirements || { requireImage: true, requireText: true }),
      _campaignMeta: {
        isExternalCampaign: true,
        hideAdvertiserName,
        advertiserDisplayName: cleanDisplayName,
        advertiserLogoUrl: cleanLogoUrl || null,
        ...(geoValidated?.country
          ? {
              geo: {
                countryId: geoValidated.country.id,
                isNationwide,
                targetDivisionIds: validatedDivisionIds,
              },
            }
          : {}),
      },
    };

    // Check balance upfront for precise deficit message (still re-validated inside atomic lock/RPC)
    const preWallet = await this.getWallet(params.advertiserId);
    const preCheck = checkCampaignBalanceSufficiency(preWallet.availableBalance, costs.totalUnits);
    if (!preCheck.sufficient) {
      throw new Error(
        `رصيد محفظتك المتاح (${preCheck.availableBalance.toLocaleString()} ر.ي) لا يغطي إجمالي تكلفة الحملة (${preCheck.totalRequired.toLocaleString()} ر.ي). العجز المطلوب شحنه: ${preCheck.deficitUnits.toLocaleString()} ر.ي.`
      );
    }

    // 1. Try Migration 020 / 024 atomic PostgreSQL RPC first
    const rpcClient = getRpcClient(params.authToken);
    const { data: rpcRes, error: rpcErr } = await rpcClient.rpc('create_funded_campaign', {
      p_title: cleanTitle,
      p_description: cleanDesc,
      p_category: params.category || 'app_testing',
      p_reward_units: costs.rewardUnits,
      p_slots: costs.slots,
      p_creation_key: creationKey,
      p_time_estimate_minutes: Math.max(1, Math.round(Number(params.timeEstimateMinutes || 10))),
      p_proof_requirements: mergedProofRequirements,
      p_deadline_at: params.deadlineAt || null,
      p_advertiser_id: params.advertiserId,
    });

    if (!rpcErr && rpcRes) {
      // Ensure status is pending_approval and sync metadata + geo targeting
      if (rpcRes?.campaignId) {
        try {
          const adminClient = getSupabaseAdminClient();
          await adminClient
            .from('campaigns')
            .update({
              status: 'pending_approval',
              hide_advertiser_name: hideAdvertiserName,
              advertiser_display_name: cleanDisplayName,
              advertiser_logo_url: cleanLogoUrl || null,
              min_fee_applied: costs.minFeeApplied || false,
              fee_policy_snapshot: costs.policySnapshot || null,
            })
            .eq('id', rpcRes.campaignId);

          if (geoValidated?.country) {
            await adminClient
              .from('campaigns')
              .update({
                country_id: geoValidated.country.id,
                is_nationwide: isNationwide,
              })
              .eq('id', rpcRes.campaignId);
            if (!isNationwide && validatedDivisionIds.length > 0) {
              await adminClient.from('campaign_target_divisions').upsert(
                validatedDivisionIds.map((divId) => ({
                  campaign_id: rpcRes.campaignId,
                  country_id: geoValidated!.country!.id,
                  division_id: divId,
                })),
                { onConflict: 'campaign_id,division_id' }
              );
            }
          }
        } catch {}
        rpcRes.status = 'pending_approval';
      }
      return rpcRes;
    }

    const isMissingRpc =
      rpcErr?.code === 'PGRST202' ||
      String(rpcErr?.message || '').toLowerCase().includes('could not find the function');
    if (rpcErr && !isMissingRpc) {
      throw new Error(rpcErr.message || 'فشل إنشاء الحملة وتمويلها من المحفظة.');
    }

    // 2. Serialized Service-Role fallback if campaigns table exists without Migration 020 RPC
    return withAdvertiserLock(params.advertiserId, async () => {
      const adminClient = getSupabaseAdminClient();
      const { data: existingCamp, error: checkErr } = await adminClient
        .from('campaigns')
        .select('*')
        .eq('creation_key', creationKey)
        .maybeSingle();

      if (checkErr && (checkErr.code === '42P01' || String(checkErr.message || '').includes('does not exist'))) {
        throw new Error('جدول الحملات غير مهيأ بعد في قاعدة البيانات (يرجى تطبيق الترحيل 020).');
      }
      if (existingCamp) {
        const latestWallet = await this.getWallet(params.advertiserId);
        return {
          success: true,
          idempotent: true,
          campaignId: existingCamp.id,
          status: existingCamp.status,
          budgetUnits: Number(existingCamp.budget_units),
          feePercentage: Number(existingCamp.fee_percentage),
          feeUnits: Number(existingCamp.fee_units),
          totalUnits: Number(existingCamp.total_units),
          fundingTransactionId: existingCamp.funding_transaction_id,
          newAvailableBalance: latestWallet.availableBalance,
        };
      }

      const { accountRow: walletAcc } = await this.ensureUserFinancialAccount(params.advertiserId);
      const { data: freshWalletAcc } = await adminClient
        .from('financial_accounts')
        .select('id, balance_units')
        .eq('id', walletAcc.id)
        .single();

      const available = Number(freshWalletAcc?.balance_units || 0);
      const check = checkCampaignBalanceSufficiency(available, costs.totalUnits);
      if (!check.sufficient) {
        throw new Error(
          `رصيد محفظتك المتاح (${check.availableBalance.toLocaleString()} ر.ي) لا يغطي إجمالي تكلفة الحملة (${check.totalRequired.toLocaleString()} ر.ي). العجز المطلوب شحنه: ${check.deficitUnits.toLocaleString()} ر.ي.`
        );
      }

      const campaignId = crypto.randomUUID();
      const now = new Date().toISOString();

      const createEscrowAcc = async (code: string) => {
        const firstAttempt = await adminClient
          .from('financial_accounts')
          .insert({
            account_code: code,
            account_type: 'escrow',
            owner_user_id: null,
            wallet_id: null,
            normal_side: 'credit',
            balance_units: 0,
            status: 'active',
            created_at: now,
          })
          .select('id')
          .single();
        if (!firstAttempt.error && firstAttempt.data) return firstAttempt.data.id;
        // Pre-013 constraint compatibility fallback
        const compatAttempt = await adminClient
          .from('financial_accounts')
          .insert({
            account_code: code,
            account_type: 'treasury',
            owner_user_id: null,
            wallet_id: null,
            normal_side: 'credit',
            balance_units: 0,
            status: 'active',
            created_at: now,
          })
          .select('id')
          .single();
        if (compatAttempt.error || !compatAttempt.data) {
          throw new Error(compatAttempt.error?.message || firstAttempt.error?.message || 'تعذر إنشاء حساب الضمان.');
        }
        return compatAttempt.data.id;
      };

      const budgetEscrowId = await createEscrowAcc(`CAMPAIGN-ESCROW-${campaignId}`);
      const feeEscrowId = await createEscrowAcc(`CAMPAIGN-FEE-ESCROW-${campaignId}`);

      const entries = buildCampaignReserveEntries({
        title: cleanTitle,
        walletAccountId: walletAcc.id,
        budgetEscrowAccountId: budgetEscrowId,
        feeEscrowAccountId: feeEscrowId,
        budgetUnits: costs.budgetUnits,
        feeUnits: costs.feeUnits,
        feePercentage: costs.feePercentage,
      });

      const { data: txId, error: postErr } = await adminClient.rpc('post_ledger_transaction', {
        p_transaction_type: 'CAMPAIGN_FUNDING_RESERVE',
        p_idempotency_key: `CAMPAIGN-FUND-RESERVE:${campaignId}`,
        p_reference: `CAMPAIGN:${campaignId}`,
        p_metadata: {
          campaign_id: campaignId,
          advertiser_id: params.advertiserId,
          budget_units: costs.budgetUnits,
          fee_percentage: costs.feePercentage,
          fee_units: costs.feeUnits,
          total_units: costs.totalUnits,
          creation_key: creationKey,
          description: `حجز تمويل حملة إعلانية ورسوم المنصة لحين التشغيل: ${cleanTitle}`,
        },
        p_entries: entries,
      });

      if (postErr || !txId) {
        throw new Error(postErr?.message || 'فشل حجز تمويل الحملة في دفتر الأستاذ.');
      }

      const { error: insertErr } = await adminClient.from('campaigns').insert({
        id: campaignId,
        advertiser_id: params.advertiserId,
        title: cleanTitle,
        description: cleanDesc,
        category: params.category || 'app_testing',
        reward_units: costs.rewardUnits,
        slots: costs.slots,
        budget_units: costs.budgetUnits,
        fee_percentage: costs.feePercentage,
        fee_units: costs.feeUnits,
        total_units: costs.totalUnits,
        status: 'pending_approval',
        creation_key: creationKey,
        budget_escrow_account_id: budgetEscrowId,
        fee_escrow_account_id: feeEscrowId,
        funding_transaction_id: String(txId),
        time_estimate_minutes: Math.max(1, Math.round(Number(params.timeEstimateMinutes || 10))),
        proof_requirements: mergedProofRequirements,
        deadline_at: params.deadlineAt || null,
        created_at: now,
        updated_at: now,
      });

      if (insertErr) {
        throw new Error(insertErr.message);
      }

      // Best-effort sync of optional Migration 021, 024 & 028 columns without failing if older schema
      try {
        await adminClient
          .from('campaigns')
          .update({
            hide_advertiser_name: hideAdvertiserName,
            advertiser_display_name: cleanDisplayName,
            advertiser_logo_url: cleanLogoUrl || null,
            min_fee_applied: costs.minFeeApplied || false,
            fee_policy_snapshot: costs.policySnapshot || null,
          })
          .eq('id', campaignId);

        if (geoValidated?.country) {
          await adminClient
            .from('campaigns')
            .update({
              country_id: geoValidated.country.id,
              is_nationwide: isNationwide,
            })
            .eq('id', campaignId);
          if (!isNationwide && validatedDivisionIds.length > 0) {
            await adminClient.from('campaign_target_divisions').upsert(
              validatedDivisionIds.map((divId) => ({
                campaign_id: campaignId,
                country_id: geoValidated!.country!.id,
                division_id: divId,
              })),
              { onConflict: 'campaign_id,division_id' }
            );
          }
        }
      } catch {}

      const updatedWallet = await this.getWallet(params.advertiserId);
      return {
        success: true,
        idempotent: false,
        campaignId,
        status: 'pending_approval',
        budgetUnits: costs.budgetUnits,
        feePercentage: costs.feePercentage,
        feeUnits: costs.feeUnits,
        totalUnits: costs.totalUnits,
        minFeeApplied: costs.minFeeApplied,
        fundingTransactionId: String(txId),
        newAvailableBalance: updatedWallet.availableBalance,
      };
    });
  },

  async startAdvertiserCampaign(params: {
    campaignId: string;
    actorId: string;
    isAdmin?: boolean;
    authToken?: string;
  }) {
    const adminClient = getSupabaseAdminClient();
    const { data: camp, error: campErr } = await adminClient
      .from('campaigns')
      .select('id, advertiser_id, status, approved_at')
      .eq('id', params.campaignId)
      .maybeSingle();

    if (campErr) {
      throw new Error(campErr.message);
    }
    if (!camp) {
      throw new Error('الحملة الإعلانية غير موجودة.');
    }
    if (!params.isAdmin && camp.advertiser_id !== params.actorId) {
      throw new Error('ليست لديك صلاحية تشغيل هذه الحملة.');
    }
    if (camp.status === 'pending_approval' && !params.isAdmin) {
      throw new Error('الحملة الإعلانية بانتظار موافقة الإدارة قبل البدء. يرجى انتظار المراجعة والاعتماد.');
    }
    if (camp.status === 'rejected') {
      throw new Error('تم رفض هذه الحملة الإعلانية ولا يمكن تشغيلها.');
    }

    const rpcClient = getRpcClient(params.authToken);
    const { data: rpcRes, error: rpcErr } = await rpcClient.rpc('start_advertiser_campaign', {
      p_campaign_id: params.campaignId,
      p_actor_id: params.actorId,
    });

    if (!rpcErr && rpcRes) {
      // Ensure linked task reflects campaign identity metadata cleanly across pre-021 & 021 schemas
      if (rpcRes?.linkedTaskId) {
        try {
          const { data: campRow } = await adminClient
            .from('campaigns')
            .select('*')
            .eq('id', params.campaignId)
            .maybeSingle();
          const cMeta = campRow?.proof_requirements?._campaignMeta || {};
          const hideName = Boolean(campRow?.hide_advertiser_name ?? cMeta.hideAdvertiserName ?? false);
          const dispName = campRow?.advertiser_display_name ?? cMeta.advertiserDisplayName ?? null;
          const logoUrl = campRow?.advertiser_logo_url ?? cMeta.advertiserLogoUrl ?? null;
          await adminClient
            .from('tasks')
            .update({
              proof_requirements: campRow?.proof_requirements || undefined,
              time_estimate_minutes: campRow?.time_estimate_minutes || 10,
            })
            .eq('id', rpcRes.linkedTaskId);
          await adminClient
            .from('tasks')
            .update({
              is_external_campaign: true,
              hide_advertiser_name: hideName,
              advertiser_display_name: dispName,
              advertiser_logo_url: logoUrl,
            })
            .eq('id', rpcRes.linkedTaskId);

          // Sync geo targeting from campaign -> linked task (Migration 028)
          const cGeo = cMeta.geo || {};
          const targetCountryId = campRow?.country_id ?? cGeo.countryId ?? null;
          const targetNationwide = campRow?.is_nationwide !== undefined ? Boolean(campRow.is_nationwide) : cGeo.isNationwide ?? true;
          if (targetCountryId) {
            await adminClient
              .from('tasks')
              .update({
                country_id: targetCountryId,
                is_nationwide: targetNationwide,
              })
              .eq('id', rpcRes.linkedTaskId);
          }
          const { data: campTargets } = await adminClient
            .from('campaign_target_divisions')
            .select('country_id, division_id')
            .eq('campaign_id', params.campaignId);
          const divRows =
            campTargets && campTargets.length > 0
              ? campTargets
              : (cGeo.targetDivisionIds || []).map((divId: string) => ({
                  country_id: targetCountryId,
                  division_id: divId,
                }));
          if (!targetNationwide && divRows.length > 0 && targetCountryId) {
            await adminClient.from('task_target_divisions').upsert(
              divRows.map((d: any) => ({
                task_id: rpcRes.linkedTaskId,
                country_id: d.country_id || targetCountryId,
                division_id: d.division_id,
              })),
              { onConflict: 'task_id,division_id' }
            );
          }
        } catch {}
      }
      return rpcRes;
    }

    const isMissingRpc =
      rpcErr?.code === 'PGRST202' ||
      String(rpcErr?.message || '').toLowerCase().includes('could not find the function');
    if (rpcErr && !isMissingRpc) {
      throw new Error(rpcErr.message || 'فشل بدء الحملة الإعلانية.');
    }

    // Fallback via post_ledger_transaction
    const { data: fullCamp } = await adminClient
      .from('campaigns')
      .select('*')
      .eq('id', params.campaignId)
      .single();

    if (fullCamp.status === 'active') {
      return {
        success: true,
        idempotent: true,
        campaignId: fullCamp.id,
        status: 'active',
        feeRevenueTransactionId: fullCamp.fee_revenue_transaction_id,
        linkedTaskId: fullCamp.linked_task_id,
      };
    }
    if (fullCamp.status === 'pending_approval' && !params.isAdmin) {
      throw new Error('الحملة الإعلانية بانتظار موافقة الإدارة قبل البدء. يرجى انتظار المراجعة والاعتماد.');
    }
    if (fullCamp.status === 'rejected') {
      throw new Error('تم رفض هذه الحملة الإعلانية ولا يمكن تشغيلها.');
    }
    if (fullCamp.status === 'cancelled' || fullCamp.status === 'completed') {
      throw new Error('لا يمكن تشغيل حملة منتهية أو ملغاة.');
    }

    let revTxId: string | null = fullCamp.fee_revenue_transaction_id || null;
    if (Number(fullCamp.fee_units) > 0 && !fullCamp.started_at) {
      const { data: revAdsAcc } = await adminClient
        .from('financial_accounts')
        .select('id')
        .eq('account_code', 'PLATFORM-REVENUE-ADS')
        .single();
      if (!revAdsAcc) {
        throw new Error('حساب إيرادات الإعلانات PLATFORM-REVENUE-ADS غير مهيأ.');
      }

      const feeEntries = buildCampaignFeeRecognitionEntries({
        title: fullCamp.title,
        feeEscrowAccountId: fullCamp.fee_escrow_account_id,
        adsRevenueAccountId: revAdsAcc.id,
        feeUnits: Number(fullCamp.fee_units),
      });

      const { data: txId, error: postErr } = await adminClient.rpc('post_ledger_transaction', {
        p_transaction_type: 'AD_REVENUE',
        p_idempotency_key: `CAMPAIGN-FEE-REVENUE:${fullCamp.id}`,
        p_reference: `CAMPAIGN:${fullCamp.id}`,
        p_metadata: {
          campaign_id: fullCamp.id,
          advertiser_id: fullCamp.advertiser_id,
          source: 'campaign_fee_escrow',
          fee_percentage: Number(fullCamp.fee_percentage),
          fee_units: Number(fullCamp.fee_units),
          description: `إثبات إيراد رسوم منصة على بدء الحملة الإعلانية: ${fullCamp.title}`,
        },
        p_entries: feeEntries,
      });

      if (postErr) throw new Error(postErr.message);
      revTxId = String(txId);
    }

    let linkedTaskId: string | null = fullCamp.linked_task_id || null;
    if (!linkedTaskId) {
      const { data: insertedTask, error: taskErr } = await adminClient
        .from('tasks')
        .insert({
          title: fullCamp.title,
          description: fullCamp.description,
          category: fullCamp.category || 'app_testing',
          reward_units: Number(fullCamp.reward_units),
          slots: Number(fullCamp.slots),
          approved_count: 0,
          total_budget_units: Number(fullCamp.budget_units),
          budget_spent_yer: 0,
          commission_units: 0,
          escrow_account_id: fullCamp.budget_escrow_account_id,
          funding_transaction_id: fullCamp.funding_transaction_id,
          creation_key: `CAMPAIGN-TASK:${fullCamp.id}`,
          time_estimate_minutes: Number(fullCamp.time_estimate_minutes || 10),
          proof_requirements: fullCamp.proof_requirements || { requireImage: true, requireText: true },
          deadline_at: fullCamp.deadline_at,
          status: 'active',
          created_by: fullCamp.advertiser_id,
          campaign_id: fullCamp.id,
        })
        .select('id')
        .single();
      if (taskErr) throw new Error(taskErr.message);
      linkedTaskId = insertedTask.id;

      try {
        const cMeta = fullCamp.proof_requirements?._campaignMeta || {};
        await adminClient
          .from('tasks')
          .update({
            is_external_campaign: true,
            hide_advertiser_name: Boolean(fullCamp.hide_advertiser_name ?? cMeta.hideAdvertiserName ?? false),
            advertiser_display_name: fullCamp.advertiser_display_name ?? cMeta.advertiserDisplayName ?? null,
            advertiser_logo_url: fullCamp.advertiser_logo_url ?? cMeta.advertiserLogoUrl ?? null,
          })
          .eq('id', linkedTaskId);

        const cGeo = cMeta.geo || {};
        const targetCountryId = fullCamp.country_id ?? cGeo.countryId ?? null;
        const targetNationwide =
          fullCamp.is_nationwide !== undefined ? Boolean(fullCamp.is_nationwide) : cGeo.isNationwide ?? true;
        if (targetCountryId) {
          await adminClient
            .from('tasks')
            .update({ country_id: targetCountryId, is_nationwide: targetNationwide })
            .eq('id', linkedTaskId);
        }
        const { data: campTargets } = await adminClient
          .from('campaign_target_divisions')
          .select('country_id, division_id')
          .eq('campaign_id', fullCamp.id);
        const divRows =
          campTargets && campTargets.length > 0
            ? campTargets
            : (cGeo.targetDivisionIds || []).map((divId: string) => ({
                country_id: targetCountryId,
                division_id: divId,
              }));
        if (!targetNationwide && divRows.length > 0 && targetCountryId) {
          await adminClient.from('task_target_divisions').upsert(
            divRows.map((d: any) => ({
              task_id: linkedTaskId,
              country_id: d.country_id || targetCountryId,
              division_id: d.division_id,
            })),
            { onConflict: 'task_id,division_id' }
          );
        }
      } catch {}
    } else {
      await adminClient.from('tasks').update({ status: 'active' }).eq('id', linkedTaskId);
    }

    const now = new Date().toISOString();
    await adminClient
      .from('campaigns')
      .update({
        status: 'active',
        started_at: fullCamp.started_at || now,
        fee_revenue_transaction_id: revTxId,
        linked_task_id: linkedTaskId,
        updated_at: now,
      })
      .eq('id', fullCamp.id);

    return {
      success: true,
      idempotent: false,
      campaignId: fullCamp.id,
      status: 'active',
      feeRevenueTransactionId: revTxId,
      linkedTaskId,
    };
  },

  async settleAdvertiserCampaign(params: {
    campaignId: string;
    targetStatus?: 'cancelled' | 'completed';
    reason?: string;
    actorId: string;
    isAdmin?: boolean;
    authToken?: string;
  }) {
    const adminClient = getSupabaseAdminClient();
    const { data: camp, error: campErr } = await adminClient
      .from('campaigns')
      .select('id, advertiser_id, status')
      .eq('id', params.campaignId)
      .maybeSingle();

    if (campErr) throw new Error(campErr.message);
    if (!camp) throw new Error('الحملة الإعلانية غير موجودة.');
    if (!params.isAdmin && camp.advertiser_id !== params.actorId) {
      throw new Error('ليست لديك صلاحية تسوية هذه الحملة.');
    }

    const targetStatus = params.targetStatus === 'completed' ? 'completed' : 'cancelled';
    const cleanReason = String(params.reason || '').trim() || 'تسوية وإغلاق الحملة وإرجاع المتبقي لمحفظة المعلن';

    const rpcClient = getRpcClient(params.authToken);
    const { data: rpcRes, error: rpcErr } = await rpcClient.rpc('settle_advertiser_campaign', {
      p_campaign_id: params.campaignId,
      p_target_status: targetStatus,
      p_reason: cleanReason,
      p_actor_id: params.actorId,
    });

    if (!rpcErr && rpcRes) {
      return rpcRes;
    }

    const isMissingRpc =
      rpcErr?.code === 'PGRST202' ||
      String(rpcErr?.message || '').toLowerCase().includes('could not find the function');
    if (rpcErr && !isMissingRpc) {
      throw new Error(rpcErr.message || 'فشل تسوية الحملة وإرجاع الفائض.');
    }

    const { data: fullCamp } = await adminClient
      .from('campaigns')
      .select('*')
      .eq('id', params.campaignId)
      .single();

    if (fullCamp.status === 'cancelled' || fullCamp.status === 'completed') {
      return {
        success: true,
        idempotent: true,
        campaignId: fullCamp.id,
        status: fullCamp.status,
        refundedUnits: Number(fullCamp.refunded_units || 0),
        settlementTransactionId: fullCamp.settlement_transaction_id,
      };
    }

    const { accountRow: walletAcc } = await this.ensureUserFinancialAccount(fullCamp.advertiser_id);
    const [{ data: bEscrow }, { data: fEscrow }] = await Promise.all([
      adminClient.from('financial_accounts').select('id, balance_units').eq('id', fullCamp.budget_escrow_account_id).single(),
      adminClient.from('financial_accounts').select('id, balance_units').eq('id', fullCamp.fee_escrow_account_id).single(),
    ]);

    const refundBudget = Math.max(0, Number(bEscrow?.balance_units || 0));
    const refundFee = fullCamp.started_at ? 0 : Math.max(0, Number(fEscrow?.balance_units || 0));
    const totalRefund = refundBudget + refundFee;

    let settlementTxId: string | null = null;
    if (totalRefund > 0) {
      const entries = buildCampaignSettlementRefundEntries({
        title: fullCamp.title,
        walletAccountId: walletAcc.id,
        budgetEscrowAccountId: fullCamp.budget_escrow_account_id,
        feeEscrowAccountId: fullCamp.fee_escrow_account_id,
        refundBudgetUnits: refundBudget,
        refundFeeUnits: refundFee,
      });

      const { data: txId, error: postErr } = await adminClient.rpc('post_ledger_transaction', {
        p_transaction_type: 'CAMPAIGN_ESCROW_REFUND',
        p_idempotency_key: `CAMPAIGN-REFUND:${fullCamp.id}`,
        p_reference: `CAMPAIGN:${fullCamp.id}`,
        p_metadata: {
          campaign_id: fullCamp.id,
          advertiser_id: fullCamp.advertiser_id,
          refund_budget_units: refundBudget,
          refund_fee_units: refundFee,
          total_refund_units: totalRefund,
          reason: cleanReason,
          description: `استرجاع الفائض من الحملة الإعلانية لمحفظة المعلن: ${fullCamp.title}`,
        },
        p_entries: entries,
      });
      if (postErr) throw new Error(postErr.message);
      settlementTxId = String(txId);
    }

    if (fullCamp.linked_task_id) {
      await adminClient
        .from('tasks')
        .update({ status: targetStatus === 'completed' ? 'completed' : 'paused' })
        .eq('id', fullCamp.linked_task_id);
    }

    const now = new Date().toISOString();
    await adminClient
      .from('campaigns')
      .update({
        status: targetStatus,
        refunded_units: totalRefund,
        settlement_transaction_id: settlementTxId,
        settled_at: now,
        updated_at: now,
      })
      .eq('id', fullCamp.id);

    const updatedWallet = await this.getWallet(fullCamp.advertiser_id);
    return {
      success: true,
      idempotent: false,
      campaignId: fullCamp.id,
      status: targetStatus,
      refundedBudgetUnits: refundBudget,
      refundedFeeUnits: refundFee,
      refundedUnits: totalRefund,
      settlementTransactionId: settlementTxId,
      newAvailableBalance: updatedWallet.availableBalance,
    };
  },

  async syncCampaignCompletionAfterSubmissionApproval(params: {
    taskId: string;
    actorId: string;
    authToken?: string;
  }) {
    const adminClient = getSupabaseAdminClient();
    const { data: taskRow } = await adminClient
      .from('tasks')
      .select('id, campaign_id, slots, approved_count, status')
      .eq('id', params.taskId)
      .maybeSingle();

    if (!taskRow?.campaign_id) return null;
    const isTaskCompleted =
      String(taskRow.status || '').toLowerCase() === 'completed' ||
      Number(taskRow.approved_count || 0) >= Number(taskRow.slots || 0);

    if (!isTaskCompleted) return null;

    const { data: camp } = await adminClient
      .from('campaigns')
      .select('id, status')
      .eq('id', taskRow.campaign_id)
      .maybeSingle();

    if (!camp || camp.status === 'completed' || camp.status === 'cancelled') {
      return null;
    }

    return this.settleAdvertiserCampaign({
      campaignId: camp.id,
      targetStatus: 'completed',
      reason: 'اكتمال كافة مهام الحملة وصرف المكافآت المعتمدة',
      actorId: params.actorId,
      isAdmin: true,
      authToken: params.authToken,
    });
  },

  async approveAdvertiserCampaign(params: {
    campaignId: string;
    actorId: string;
    authToken?: string;
  }) {
    const adminClient = getSupabaseAdminClient();
    const { data: camp, error: fetchErr } = await adminClient
      .from('campaigns')
      .select('*')
      .eq('id', params.campaignId)
      .maybeSingle();

    if (fetchErr) throw new Error(fetchErr.message);
    if (!camp) throw new Error('الحملة الإعلانية غير موجودة.');

    if (camp.status !== 'pending_approval') {
      if (camp.status === 'pending_start' || camp.status === 'active') {
        return { success: true, idempotent: true, campaignId: camp.id, status: camp.status };
      }
      throw new Error(`لا يمكن اعتماد حملة حالتها الحالية (${camp.status}).`);
    }

    const now = new Date().toISOString();
    const { error: updErr } = await adminClient
      .from('campaigns')
      .update({
        status: 'pending_start',
        approved_at: now,
        approved_by: params.actorId,
        rejected_at: null,
        rejected_by: null,
        rejection_reason: null,
        updated_at: now,
      })
      .eq('id', camp.id);

    if (updErr) throw new Error(updErr.message);

    if (camp.advertiser_id) {
      await adminClient
        .from('notifications')
        .insert({
          id: crypto.randomUUID(),
          user_id: camp.advertiser_id,
          title: 'تمت الموافقة على حملتك الإعلانية',
          message: `وافقت الإدارة على حملتك "${camp.title}". يمكنك الآن بدء تشغيل الحملة لتصل للمستخدمين.`,
          type: 'CAMPAIGN_APPROVED',
          link: '/advertiser',
          created_at: now,
        })
        .then(() => {}, () => {});
    }

    await this.writeFinancialAuditLog({
      actionType: 'CAMPAIGN_APPROVED',
      actorId: params.actorId,
      details: {
        campaign_id: camp.id,
        advertiser_id: camp.advertiser_id,
        title: camp.title,
        budget_units: camp.budget_units,
        fee_units: camp.fee_units,
      },
      authToken: params.authToken,
    });

    return { success: true, campaignId: camp.id, status: 'pending_start' as const };
  },

  async rejectAdvertiserCampaign(params: {
    campaignId: string;
    reason: string;
    actorId: string;
    authToken?: string;
  }) {
    const cleanReason = String(params.reason || '').trim();
    if (!cleanReason) {
      throw new Error('يرجى تحديد سبب رفض الحملة الإعلانية.');
    }

    const adminClient = getSupabaseAdminClient();
    const { data: camp, error: fetchErr } = await adminClient
      .from('campaigns')
      .select('*')
      .eq('id', params.campaignId)
      .maybeSingle();

    if (fetchErr) throw new Error(fetchErr.message);
    if (!camp) throw new Error('الحملة الإعلانية غير موجودة.');

    if (camp.status === 'rejected') {
      return { success: true, idempotent: true, campaignId: camp.id, status: 'rejected' };
    }
    if (camp.status !== 'pending_approval') {
      throw new Error(`لا يمكن رفض حملة حالتها الحالية (${camp.status}).`);
    }

    // Refund 100% of reserved funds (budget + fee) from escrow back to advertiser wallet
    const { accountRow: advWalletAcc } = await this.ensureUserFinancialAccount(camp.advertiser_id);
    const refundBudget = parseMoneyStrict(camp.budget_units || 0);
    const refundFee = parseMoneyStrict(camp.fee_units || 0);
    const totalRefund = addMoney(refundBudget, refundFee);

    const refundEntries = buildCampaignSettlementRefundEntries({
      title: camp.title,
      walletAccountId: advWalletAcc.id,
      budgetEscrowAccountId: camp.budget_escrow_account_id,
      feeEscrowAccountId: camp.fee_escrow_account_id,
      refundBudgetUnits: refundBudget,
      refundFeeUnits: refundFee,
    });

    const idemKey = `CAMPAIGN-REJECT-REFUND:${camp.id}`;
    const { data: refundTxId, error: postErr } = await adminClient.rpc('post_ledger_transaction', {
      p_transaction_type: 'CAMPAIGN_ESCROW_REFUND',
      p_idempotency_key: idemKey,
      p_reference: `CAMPAIGN:${camp.id}`,
      p_metadata: {
        campaign_id: camp.id,
        advertiser_id: camp.advertiser_id,
        reason: cleanReason,
        refund_budget: refundBudget,
        refund_fee: refundFee,
        total_refund: totalRefund,
        description: `استرداد كامل ميزانية ورسوم الحملة المرفوضة: ${camp.title}`,
      },
      p_entries: refundEntries,
    });

    if (postErr) throw new Error(postErr.message);

    const now = new Date().toISOString();
    const { error: updErr } = await adminClient
      .from('campaigns')
      .update({
        status: 'rejected',
        rejection_reason: cleanReason,
        rejected_at: now,
        rejected_by: params.actorId,
        refunded_units: totalRefund,
        settlement_transaction_id: String(refundTxId),
        settled_at: now,
        updated_at: now,
      })
      .eq('id', camp.id);

    if (updErr) throw new Error(updErr.message);

    if (camp.advertiser_id) {
      await adminClient
        .from('notifications')
        .insert({
          id: crypto.randomUUID(),
          user_id: camp.advertiser_id,
          title: 'تم رفض الحملة الإعلانية واسترداد الرصيد',
          message: `تم رفض حملتك "${camp.title}" للسبب: ${cleanReason}. وقد تم إعادة كامل المبلغ المحجوز (${totalRefund.toLocaleString()} ر.ي) إلى محفظتك المتاحة.`,
          type: 'CAMPAIGN_REJECTED',
          link: '/advertiser',
          created_at: now,
        })
        .then(() => {}, () => {});
    }

    await this.writeFinancialAuditLog({
      actionType: 'CAMPAIGN_REJECTED',
      actorId: params.actorId,
      transactionId: String(refundTxId),
      details: {
        campaign_id: camp.id,
        advertiser_id: camp.advertiser_id,
        title: camp.title,
        reason: cleanReason,
        refund_total: totalRefund,
      },
      authToken: params.authToken,
    });

    return {
      success: true,
      campaignId: camp.id,
      status: 'rejected' as const,
      refundTransactionId: String(refundTxId),
      refundedUnits: totalRefund,
    };
  },

  async getAdvertiserWalletSummary(advertiserId: string, _authToken?: string): Promise<AdvertiserWalletSummary> {
    const adminClient = getSupabaseAdminClient();
    const wallet = await this.getWallet(advertiserId);

    let reservedBudgetEscrow = 0;
    let reservedFeeEscrow = 0;
    let totalSpent = 0;
    let totalRefunded = 0;

    try {
      const { data: camps } = await adminClient
        .from('campaigns')
        .select('status, budget_units, fee_units, refunded_units, fee_revenue_transaction_id')
        .eq('advertiser_id', advertiserId);

      if (camps) {
        for (const c of camps) {
          const budget = parseMoneyStrict(c.budget_units || 0);
          const fee = parseMoneyStrict(c.fee_units || 0);
          const refunded = parseMoneyStrict(c.refunded_units || 0);

          totalRefunded = addMoney(totalRefunded, refunded);

          if (c.status === 'pending_approval' || c.status === 'pending_start' || c.status === 'active') {
            reservedBudgetEscrow = addMoney(reservedBudgetEscrow, budget);
            if (!c.fee_revenue_transaction_id) {
              reservedFeeEscrow = addMoney(reservedFeeEscrow, fee);
            }
          }
          if (c.status === 'completed') {
            const spent = Math.max(0, subMoney(budget, refunded));
            totalSpent = addMoney(totalSpent, spent);
          }
        }
      }
    } catch {}

    let totalDeposited = 0;
    let pendingDepositsCount = 0;
    let pendingDepositsAmount = 0;
    let recentDeposits: ExternalDeposit[] = [];

    try {
      const { data: deps } = await adminClient
        .from('external_deposits')
        .select('*')
        .eq('advertiser_id', advertiserId)
        .order('created_at', { ascending: false })
        .limit(20);

      if (deps) {
        recentDeposits = deps.map((d: any) => ({
          id: d.id,
          externalAccountId: d.external_account_id,
          depositPurpose: d.deposit_purpose || 'advertiser_wallet',
          advertiserId: d.advertiser_id,
          amountUnits: parseMoneyStrict(d.amount_units || 0),
          referenceNumber: d.reference_number,
          receiptUrl: d.receipt_url,
          depositorName: d.depositor_name,
          depositorPhone: d.depositor_phone,
          status: d.status,
          reviewedBy: d.reviewed_by,
          reviewedAt: d.reviewed_at,
          rejectionReason: d.rejection_reason,
          ledgerTransactionId: d.ledger_transaction_id,
          notes: d.notes,
          createdAt: d.created_at,
          updatedAt: d.updated_at,
        }));

        for (const d of deps) {
          const amt = parseMoneyStrict(d.amount_units || 0);
          if (d.status === 'approved') {
            totalDeposited = addMoney(totalDeposited, amt);
          } else if (d.status === 'pending') {
            pendingDepositsCount += 1;
            pendingDepositsAmount = addMoney(pendingDepositsAmount, amt);
          }
        }
      }
    } catch {}

    const totalReserved = addMoney(reservedBudgetEscrow, reservedFeeEscrow);

    return {
      advertiserId,
      availableBalance: wallet.availableBalance,
      reservedBudgetEscrow,
      reservedFeeEscrow,
      totalReserved,
      totalDeposited,
      totalSpent,
      totalRefunded,
      pendingDepositsCount,
      pendingDepositsAmount,
      recentDeposits,
    };
  },

  async getAdvertiserExternalAccounts(): Promise<ExternalAccount[]> {
    const adminClient = getSupabaseAdminClient();
    const { data, error } = await adminClient
      .from('external_accounts')
      .select('*')
      .in('fund_scope', ['advertiser', 'mixed'])
      .eq('status', 'active')
      .order('created_at', { ascending: true });

    if (error) {
      if (error.code === '42P01' || error.message.includes('does not exist')) return [];
      throw new Error(error.message);
    }
    return (data || []).map((r: any) => ({
      id: r.id,
      accountName: r.account_name,
      ownerName: r.owner_name,
      ownerRole: r.owner_role,
      accountType: r.account_type,
      providerName: r.provider_name,
      accountNumber: r.account_number,
      currency: r.currency || 'YER',
      fundScope: r.fund_scope,
      financialAccountId: r.financial_account_id,
      accountCode: r.account_code || '',
      accountingBalance: Number(r.accounting_balance || 0),
      actualBalance: Number(r.actual_balance || 0),
      discrepancyUnits: Number(r.discrepancy_units || 0),
      status: r.status,
      notes: r.notes,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  },

  async getAdvertiserDeposits(advertiserId: string): Promise<ExternalDeposit[]> {
    const adminClient = getSupabaseAdminClient();
    const { data, error } = await adminClient
      .from('external_deposits')
      .select('*')
      .eq('advertiser_id', advertiserId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      if (error.code === '42P01' || error.message.includes('does not exist')) return [];
      throw new Error(error.message);
    }
    return (data || []).map((d: any) => ({
      id: d.id,
      externalAccountId: d.external_account_id,
      depositPurpose: d.deposit_purpose || 'advertiser_wallet',
      advertiserId: d.advertiser_id,
      amountUnits: parseMoneyStrict(d.amount_units || 0),
      referenceNumber: d.reference_number,
      receiptUrl: d.receipt_url,
      depositorName: d.depositor_name,
      depositorPhone: d.depositor_phone,
      status: d.status,
      reviewedBy: d.reviewed_by,
      reviewedAt: d.reviewed_at,
      rejectionReason: d.rejection_reason,
      ledgerTransactionId: d.ledger_transaction_id,
      notes: d.notes,
      createdAt: d.created_at,
      updatedAt: d.updated_at,
    }));
  },

  // ============================================================================
  // PHASE 5: EXTERNAL ACCOUNTS, DEPOSIT RECEIPT APPROVALS, INTERNAL TRANSFERS,
  // RECONCILIATION & 3-WAY FUND SEGREGATION
  // ============================================================================

  async getExternalAccountsOverview(authToken?: string): Promise<{
    externalAccountsReady: boolean;
    accounts: ExternalAccount[];
    deposits: ExternalDeposit[];
    transfers: ExternalAccountTransfer[];
    reconciliations: ExternalAccountReconciliation[];
    advertisers: Array<{ id: string; fullName: string; companyName?: string; phone: string; status: string }>;
    cashVaultAccount: { financialAccountId: string; accountCode: string; balanceUnits: number } | null;
    fundSegregation?: FundSegregationSummary;
  }> {
    const db = getActorOrAdminClient(authToken);
    const adminClient = getSupabaseAdminClient();

    const [
      treasurySummary,
      extAccRes,
      extDepRes,
      extXferRes,
      extRecRes,
      finAccRes,
      profilesRes,
      userRolesRes,
    ] = await Promise.all([
      this.getTreasurySummary(authToken),
      db.from('external_accounts').select('*').order('created_at', { ascending: false }),
      db.from('external_deposits').select('*').order('created_at', { ascending: false }).limit(200),
      db.from('external_account_transfers').select('*').order('created_at', { ascending: false }).limit(200),
      db.from('external_account_reconciliations').select('*').order('created_at', { ascending: false }).limit(200),
      db.from('financial_accounts').select('id, account_code, account_type, balance_units, status'),
      adminClient.from('profiles').select('id, full_name, company_name, phone, status, role'),
      adminClient.from('user_roles').select('user_id, role'),
    ]);

    const externalAccountsReady =
      !isMissingRelationError(extAccRes.error) &&
      !isMissingRelationError(extDepRes.error) &&
      !isMissingRelationError(extXferRes.error) &&
      !isMissingRelationError(extRecRes.error);

    const finById = new Map<string, any>();
    let cashVaultAccount: { financialAccountId: string; accountCode: string; balanceUnits: number } | null = null;
    for (const fa of finAccRes.data || []) {
      finById.set(String(fa.id), fa);
      if (fa.account_code === 'PLATFORM-CASH-VAULT') {
        cashVaultAccount = {
          financialAccountId: fa.id,
          accountCode: fa.account_code,
          balanceUnits: Number(fa.balance_units || 0),
        };
      }
    }

    const profById = new Map<string, any>();
    for (const p of profilesRes.data || []) {
      profById.set(String(p.id), p);
    }

    const advertiserIds = new Set<string>();
    for (const p of profilesRes.data || []) {
      if (String(p.role || '').toLowerCase() === 'advertiser') advertiserIds.add(String(p.id));
    }
    for (const ur of userRolesRes.data || []) {
      if (String(ur.role || '').toLowerCase() === 'advertiser') advertiserIds.add(String(ur.user_id));
    }

    const advertisers = Array.from(advertiserIds)
      .map((id) => profById.get(id))
      .filter(Boolean)
      .map((p: any) => ({
        id: p.id,
        fullName: p.full_name || 'معلن',
        companyName: p.company_name || undefined,
        phone: p.phone || '---',
        status: String(p.status || 'pending').toLowerCase(),
      }));

    if (!externalAccountsReady) {
      return {
        externalAccountsReady: false,
        accounts: [],
        deposits: [],
        transfers: [],
        reconciliations: [],
        advertisers,
        cashVaultAccount,
        fundSegregation: treasurySummary.fundSegregation,
      };
    }

    const extById = new Map<string, any>();
    const accounts: ExternalAccount[] = (extAccRes.data || []).map((row: any) => {
      extById.set(String(row.id), row);
      const fin = finById.get(String(row.financial_account_id));
      const accountingBalance = Number(fin?.balance_units || 0);
      const actualBalance = Number(row.actual_balance_units || 0);
      return {
        id: row.id,
        accountName: row.account_name,
        ownerName: row.owner_name,
        ownerRole: (row.owner_role || 'owner') as ExternalAccountOwnerRole,
        accountType: (row.account_type || 'bank') as ExternalAccountType,
        providerName: row.provider_name,
        accountNumber: row.account_number,
        currency: row.currency || 'YER',
        fundScope: (row.fund_scope || 'mixed') as ExternalFundScope,
        financialAccountId: row.financial_account_id,
        accountCode: fin?.account_code || `EXT-ACC-${String(row.id).slice(0, 8)}`,
        accountingBalance,
        actualBalance,
        discrepancyUnits: actualBalance - accountingBalance,
        lastReconciledAt: row.last_reconciled_at || null,
        status: (row.status || 'active') as 'active' | 'frozen',
        notes: row.notes || null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    });

    const deposits: ExternalDeposit[] = (extDepRes.data || []).map((d: any) => {
      const ext = extById.get(String(d.external_account_id));
      const fin = ext ? finById.get(String(ext.financial_account_id)) : null;
      const adv = d.advertiser_id ? profById.get(String(d.advertiser_id)) : null;
      const rev = d.reviewed_by ? profById.get(String(d.reviewed_by)) : null;
      return {
        id: d.id,
        externalAccountId: d.external_account_id,
        externalAccountName: ext?.account_name || 'حساب خارجي',
        externalAccountCode: fin?.account_code || '',
        depositPurpose: d.deposit_purpose || 'advertiser_wallet',
        advertiserId: d.advertiser_id || null,
        advertiserName: adv?.full_name || null,
        advertiserCompany: adv?.company_name || null,
        amountUnits: Number(d.amount_units || 0),
        referenceNumber: d.reference_number,
        receiptUrl: d.receipt_url,
        depositorName: d.depositor_name || null,
        depositorPhone: d.depositor_phone || null,
        notes: d.notes || null,
        status: d.status || 'pending',
        reviewedBy: d.reviewed_by || null,
        reviewedByName: rev?.full_name || null,
        reviewedAt: d.reviewed_at || null,
        rejectionReason: d.rejection_reason || null,
        ledgerTransactionId: d.ledger_transaction_id || null,
        createdAt: d.created_at,
      };
    });

    const transfers: ExternalAccountTransfer[] = (extXferRes.data || []).map((t: any) => {
      const fromExt = t.from_external_account_id ? extById.get(String(t.from_external_account_id)) : null;
      const toExt = t.to_external_account_id ? extById.get(String(t.to_external_account_id)) : null;
      const fromFin = finById.get(String(t.from_financial_account_id));
      const toFin = finById.get(String(t.to_financial_account_id));
      const actor = t.created_by ? profById.get(String(t.created_by)) : null;
      return {
        id: t.id,
        fromExternalAccountId: t.from_external_account_id || null,
        toExternalAccountId: t.to_external_account_id || null,
        fromFinancialAccountId: t.from_financial_account_id,
        toFinancialAccountId: t.to_financial_account_id,
        fromAccountName:
          fromExt?.account_name ||
          (fromFin?.account_code === 'PLATFORM-CASH-VAULT' ? 'الخزينة النقدية الرئيسية (Cash Vault)' : fromFin?.account_code || 'حساب'),
        fromAccountCode: fromFin?.account_code || '',
        toAccountName:
          toExt?.account_name ||
          (toFin?.account_code === 'PLATFORM-CASH-VAULT' ? 'الخزينة النقدية الرئيسية (Cash Vault)' : toFin?.account_code || 'حساب'),
        toAccountCode: toFin?.account_code || '',
        amountUnits: Number(t.amount_units || 0),
        referenceNumber: t.reference_number || null,
        reason: t.reason,
        ledgerTransactionId: t.ledger_transaction_id,
        createdBy: t.created_by || null,
        createdByName: actor?.full_name || 'النظام',
        createdAt: t.created_at,
      };
    });

    const reconciliations: ExternalAccountReconciliation[] = (extRecRes.data || []).map((r: any) => {
      const ext = extById.get(String(r.external_account_id));
      const actor = r.reconciled_by ? profById.get(String(r.reconciled_by)) : null;
      return {
        id: r.id,
        externalAccountId: r.external_account_id,
        externalAccountName: ext?.account_name || 'حساب خارجي',
        accountingBalanceUnits: Number(r.accounting_balance_units || 0),
        actualBalanceUnits: Number(r.actual_balance_units || 0),
        discrepancyUnits: Number(r.discrepancy_units || 0),
        adjustmentTransactionId: r.adjustment_transaction_id || null,
        adjustmentReason: r.adjustment_reason || null,
        status: r.status || 'matched',
        reconciledBy: r.reconciled_by || null,
        reconciledByName: actor?.full_name || 'النظام',
        createdAt: r.created_at,
      };
    });

    return {
      externalAccountsReady: true,
      accounts,
      deposits,
      transfers,
      reconciliations,
      advertisers,
      cashVaultAccount,
      fundSegregation: treasurySummary.fundSegregation,
    };
  },

  async createExternalAccount(params: {
    accountName: string;
    ownerName: string;
    ownerRole: ExternalAccountOwnerRole;
    accountType: ExternalAccountType;
    providerName: string;
    accountNumber: string;
    fundScope: ExternalFundScope;
    notes?: string;
    actorId: string;
    authToken?: string;
  }) {
    const cleanName = String(params.accountName || '').trim();
    const cleanOwner = String(params.ownerName || '').trim();
    const cleanProvider = String(params.providerName || '').trim();
    const cleanNumber = String(params.accountNumber || '').trim();
    if (!cleanName || !cleanOwner || !cleanProvider || !cleanNumber) {
      throw new Error('اسم الحساب، صاحب الحساب، اسم البنك/المزود، ورقم الحساب حقول إلزامية.');
    }

    const rpcClient = getRpcClient(params.authToken);
    const { data: rpcRes, error: rpcErr } = await rpcClient.rpc('create_external_account', {
      p_account_name: cleanName,
      p_owner_name: cleanOwner,
      p_owner_role: params.ownerRole || 'owner',
      p_account_type: params.accountType || 'bank',
      p_provider_name: cleanProvider,
      p_account_number: cleanNumber,
      p_fund_scope: params.fundScope || 'mixed',
      p_notes: params.notes ? String(params.notes).trim() : null,
      p_actor_id: params.actorId,
    });

    if (!rpcErr && rpcRes) {
      return rpcRes;
    }

    const isMissingRpc =
      rpcErr?.code === 'PGRST202' ||
      String(rpcErr?.message || '').toLowerCase().includes('could not find the function');
    if (rpcErr && !isMissingRpc) {
      throw new Error(rpcErr.message || 'فشل إنشاء الحساب الخارجي.');
    }

    const adminClient = getSupabaseAdminClient();
    const extId = crypto.randomUUID();
    const finId = crypto.randomUUID();
    const finCode = `EXT-ACC-${extId.replace(/-/g, '').slice(0, 10).toUpperCase()}`;
    const now = new Date().toISOString();

    const { error: finErr } = await adminClient.from('financial_accounts').insert({
      id: finId,
      account_code: finCode,
      account_type: 'asset',
      normal_side: 'debit',
      balance_units: 0,
      status: 'active',
      created_at: now,
    });
    if (finErr) throw new Error(finErr.message);

    const { error: extErr } = await adminClient.from('external_accounts').insert({
      id: extId,
      account_name: cleanName,
      owner_name: cleanOwner,
      owner_role: params.ownerRole || 'owner',
      account_type: params.accountType || 'bank',
      provider_name: cleanProvider,
      account_number: cleanNumber,
      currency: 'YER',
      fund_scope: params.fundScope || 'mixed',
      financial_account_id: finId,
      actual_balance_units: 0,
      status: 'active',
      notes: params.notes ? String(params.notes).trim() : null,
      created_by: params.actorId,
      created_at: now,
      updated_at: now,
    });
    if (extErr) throw new Error(extErr.message);

    await this.writeFinancialAuditLog({
      actionType: 'EXTERNAL_ACCOUNT_CREATED',
      actorId: params.actorId,
      details: { external_account_id: extId, account_code: finCode, owner_name: cleanOwner, fund_scope: params.fundScope },
      authToken: params.authToken,
    });

    return { success: true, id: extId, financialAccountId: finId, accountCode: finCode };
  },

  async createExternalDeposit(params: {
    externalAccountId: string;
    depositPurpose: 'advertiser_wallet' | 'platform_capital';
    advertiserId?: string | null;
    amountUnits: number;
    referenceNumber: string;
    receiptUrl: string;
    depositorName?: string;
    depositorPhone?: string;
    notes?: string;
    actorId: string;
    authToken?: string;
  }) {
    const amountUnits = Math.round(Number(params.amountUnits));
    if (!Number.isFinite(amountUnits) || amountUnits <= 0) {
      throw new Error('مبلغ الإيداع يجب أن يكون عدداً صحيحاً موجباً أكبر من صفر.');
    }
    const cleanRef = String(params.referenceNumber || '').trim();
    const normRef = normalizeReceiptReference(cleanRef);
    if (!normRef || normRef.length < 3) {
      throw new Error('الرقم المرجعي للإيصال إلزامي ويجب أن يحتوي على 3 خانات على الأقل.');
    }
    const safeReceipt = sanitizeDepositReceiptUrl(params.receiptUrl);
    if (!safeReceipt) {
      throw new Error('صورة الإيصال مطلوبة وبصيغة صورة آمنة صالحة.');
    }
    if (params.depositPurpose === 'advertiser_wallet' && !params.advertiserId) {
      throw new Error('يجب تحديد المعلن المستفيد عند تسجيل إيداع شحن محفظة معلن.');
    }

    const adminClient = getSupabaseAdminClient();
    const { data: extAcc, error: extErr } = await adminClient
      .from('external_accounts')
      .select('id, status')
      .eq('id', params.externalAccountId)
      .maybeSingle();

    if (extErr) {
      if (isMissingRelationError(extErr)) {
        throw new Error('جداول الحسابات الخارجية غير مُنشأة بعد. يرجى تنفيذ Migration 022 في Supabase أولاً.');
      }
      throw new Error(extErr.message);
    }
    if (!extAcc) throw new Error('الحساب الخارجي المختار غير موجود.');
    if (extAcc.status !== 'active') throw new Error('الحساب الخارجي المختار مجمد حالياً.');

    // Block duplicate active or previously approved receipt reference numbers
    const { data: dupRow } = await adminClient
      .from('external_deposits')
      .select('id, status, reference_number')
      .eq('reference_number_normalized', normRef)
      .neq('status', 'rejected')
      .maybeSingle();

    if (dupRow?.id) {
      throw new Error(
        `الرقم المرجعي (${cleanRef}) مستخدم مسبقاً في إيصال آخر بحالة (${
          dupRow.status === 'approved' ? 'معتمد' : 'قيد المراجعة'
        }) ولا يمكن تكراره.`
      );
    }

    if (params.depositPurpose === 'advertiser_wallet' && params.advertiserId) {
      const { data: advProf } = await adminClient
        .from('profiles')
        .select('id, role')
        .eq('id', params.advertiserId)
        .maybeSingle();
      if (!advProf) throw new Error('حساب المعلن المحدد غير موجود.');
    }

    const depositId = crypto.randomUUID();
    const now = new Date().toISOString();
    const { error: insErr } = await adminClient.from('external_deposits').insert({
      id: depositId,
      external_account_id: params.externalAccountId,
      deposit_purpose: params.depositPurpose,
      advertiser_id: params.depositPurpose === 'advertiser_wallet' ? params.advertiserId : null,
      amount_units: amountUnits,
      reference_number: cleanRef,
      reference_number_normalized: normRef,
      receipt_url: safeReceipt,
      depositor_name: params.depositorName ? String(params.depositorName).trim() : null,
      depositor_phone: params.depositorPhone ? String(params.depositorPhone).trim() : null,
      notes: params.notes ? String(params.notes).trim() : null,
      status: 'pending',
      created_by: params.actorId,
      created_at: now,
      updated_at: now,
    });

    if (insErr) {
      if (String(insErr.code) === '23505') {
        throw new Error(`الرقم المرجعي (${cleanRef}) مستخدم مسبقاً ولا يمكن تكراره.`);
      }
      throw new Error(insErr.message);
    }

    await this.writeFinancialAuditLog({
      actionType: 'EXTERNAL_DEPOSIT_RECORDED',
      actorId: params.actorId,
      details: {
        deposit_id: depositId,
        external_account_id: params.externalAccountId,
        deposit_purpose: params.depositPurpose,
        advertiser_id: params.advertiserId || null,
        amount_units: amountUnits,
        reference_number: cleanRef,
      },
      authToken: params.authToken,
    });

    return { success: true, depositId, status: 'pending' as const };
  },

  async approveExternalDeposit(params: {
    depositId: string;
    actorId: string;
    authToken?: string;
  }) {
    const adminClient = getSupabaseAdminClient();
    const rpcClient = getRpcClient(params.authToken);

    const { data: rpcRes, error: rpcErr } = await rpcClient.rpc('approve_external_deposit', {
      p_deposit_id: params.depositId,
      p_actor_id: params.actorId,
    });

    if (!rpcErr && rpcRes) {
      return rpcRes;
    }

    const isMissingRpc =
      rpcErr?.code === 'PGRST202' ||
      String(rpcErr?.message || '').toLowerCase().includes('could not find the function');
    if (rpcErr && !isMissingRpc) {
      throw new Error(rpcErr.message || 'فشل اعتماد الإيداع الخارجي.');
    }

    // Fallback atomic approval using post_ledger_transaction (NEVER touches PLATFORM-TREASURY or REVENUE)
    const { data: dep, error: depErr } = await adminClient
      .from('external_deposits')
      .select('*')
      .eq('id', params.depositId)
      .maybeSingle();

    if (depErr) throw new Error(depErr.message);
    if (!dep) throw new Error('سجل الإيداع غير موجود.');

    if (dep.status === 'approved' && dep.ledger_transaction_id) {
      return {
        success: true,
        idempotent: true,
        depositId: dep.id,
        status: 'approved',
        transactionId: dep.ledger_transaction_id,
      };
    }

    if (dep.status !== 'pending') {
      throw new Error(`لا يمكن اعتماد إيداع حالته الحالية (${dep.status}).`);
    }

    const { data: dupApproved } = await adminClient
      .from('external_deposits')
      .select('id')
      .eq('reference_number_normalized', dep.reference_number_normalized)
      .eq('status', 'approved')
      .neq('id', dep.id)
      .maybeSingle();

    if (dupApproved?.id) {
      throw new Error(`الرقم المرجعي (${dep.reference_number}) معتمد مسبقاً لإيصال آخر ولا يمكن اعتماده مرتين.`);
    }

    const { data: extAcc } = await adminClient
      .from('external_accounts')
      .select('id, account_name, financial_account_id, status')
      .eq('id', dep.external_account_id)
      .single();

    if (!extAcc || extAcc.status !== 'active') {
      throw new Error('الحساب الخارجي غير موجود أو مجمد.');
    }

    let targetFinId: string;
    let txType: string;
    if (dep.deposit_purpose === 'advertiser_wallet') {
      const { accountRow: advWalletAcc } = await this.ensureUserFinancialAccount(dep.advertiser_id);
      targetFinId = advWalletAcc.id;
      txType = 'EXTERNAL_ADVERTISER_DEPOSIT';
    } else {
      const { data: capAcc } = await adminClient
        .from('financial_accounts')
        .select('id')
        .eq('account_code', 'OWNER-CAPITAL')
        .single();
      if (!capAcc) throw new Error('حساب رأس مال المالك OWNER-CAPITAL غير موجود.');
      targetFinId = capAcc.id;
      txType = 'EXTERNAL_CAPITAL_DEPOSIT';
    }

    const entries = buildExternalDepositApprovalEntries({
      externalFinAccountId: extAcc.financial_account_id,
      targetFinAccountId: targetFinId,
      amountUnits: Number(dep.amount_units),
      externalAccountName: extAcc.account_name,
      referenceNumber: dep.reference_number,
      depositPurpose: dep.deposit_purpose,
    });

    const idemKey = `EXT-DEP-APPROVE:${dep.id}`;
    const { data: txId, error: postErr } = await adminClient.rpc('post_ledger_transaction', {
      p_transaction_type: txType,
      p_idempotency_key: idemKey,
      p_reference: dep.reference_number,
      p_metadata: {
        deposit_id: dep.id,
        external_account_id: extAcc.id,
        external_account_name: extAcc.account_name,
        advertiser_id: dep.advertiser_id,
        deposit_purpose: dep.deposit_purpose,
        reference_number: dep.reference_number,
        receipt_url: dep.receipt_url,
        accounting_classification:
          dep.deposit_purpose === 'advertiser_wallet' ? 'ADVERTISER_LIABILITY' : 'OWNER_EQUITY',
        description:
          dep.deposit_purpose === 'advertiser_wallet'
            ? `اعتماد تحصيل وشحن محفظة معلن (التزام للغير) عبر ${extAcc.account_name} - مرجع: ${dep.reference_number}`
            : `اعتماد إيداع رأسمالي بالحساب الخارجي ${extAcc.account_name} - مرجع: ${dep.reference_number}`,
      },
      p_entries: entries,
    });

    if (postErr) throw new Error(postErr.message);

    const now = new Date().toISOString();
    await adminClient
      .from('external_deposits')
      .update({
        status: 'approved',
        reviewed_by: params.actorId,
        reviewed_at: now,
        ledger_transaction_id: String(txId),
        idempotency_key: idemKey,
        updated_at: now,
      })
      .eq('id', dep.id);

    if (dep.deposit_purpose === 'advertiser_wallet' && dep.advertiser_id) {
      await adminClient
        .from('notifications')
        .insert({
          id: crypto.randomUUID(),
          user_id: dep.advertiser_id,
          title: 'تم اعتماد إيداعك وشحن محفظتك',
          message: `تم التحقق من الإيصال رقم (${dep.reference_number}) وشحن مبلغ ${Number(dep.amount_units).toLocaleString()} ر.ي في محفظتك.`,
          type: 'WALLET_DEPOSIT_APPROVED',
          link: '/advertiser',
          created_at: now,
        })
        .then(() => {}, () => {});
    }

    await this.writeFinancialAuditLog({
      actionType: txType,
      actorId: params.actorId,
      transactionId: String(txId),
      details: {
        deposit_id: dep.id,
        external_account_id: extAcc.id,
        advertiser_id: dep.advertiser_id,
        amount_units: Number(dep.amount_units),
        reference_number: dep.reference_number,
      },
      authToken: params.authToken,
    });

    return {
      success: true,
      idempotent: false,
      depositId: dep.id,
      status: 'approved',
      transactionId: String(txId),
    };
  },

  async rejectExternalDeposit(params: {
    depositId: string;
    reason: string;
    actorId: string;
    authToken?: string;
  }) {
    const cleanReason = String(params.reason || '').trim();
    if (!cleanReason) {
      throw new Error('يجب إدخال سبب رفض الإيصال.');
    }

    const adminClient = getSupabaseAdminClient();
    const { data: dep, error: depErr } = await adminClient
      .from('external_deposits')
      .select('id, status, reference_number, advertiser_id, amount_units')
      .eq('id', params.depositId)
      .maybeSingle();

    if (depErr) throw new Error(depErr.message);
    if (!dep) throw new Error('سجل الإيداع غير موجود.');
    if (dep.status !== 'pending') {
      throw new Error(`لا يمكن رفض إيداع حالته الحالية (${dep.status}).`);
    }

    const now = new Date().toISOString();
    const { error: updErr } = await adminClient
      .from('external_deposits')
      .update({
        status: 'rejected',
        rejection_reason: cleanReason,
        reviewed_by: params.actorId,
        reviewed_at: now,
        updated_at: now,
      })
      .eq('id', dep.id)
      .eq('status', 'pending');

    if (updErr) throw new Error(updErr.message);

    if (dep.advertiser_id) {
      await adminClient
        .from('notifications')
        .insert({
          id: crypto.randomUUID(),
          user_id: dep.advertiser_id,
          title: 'تم رفض إيصال الإيداع',
          message: `تم رفض الإيصال رقم (${dep.reference_number}) للسبب التالي: ${cleanReason}`,
          type: 'WALLET_DEPOSIT_REJECTED',
          link: '/advertiser',
          created_at: now,
        })
        .then(() => {}, () => {});
    }

    await this.writeFinancialAuditLog({
      actionType: 'EXTERNAL_DEPOSIT_REJECTED',
      actorId: params.actorId,
      details: {
        deposit_id: dep.id,
        reference_number: dep.reference_number,
        amount_units: dep.amount_units,
        reason: cleanReason,
      },
      authToken: params.authToken,
    });

    return { success: true, depositId: dep.id, status: 'rejected' as const };
  },

  async transferBetweenExternalAccounts(params: {
    fromFinancialAccountId: string;
    toFinancialAccountId: string;
    amountUnits: number;
    reason: string;
    referenceNumber?: string;
    idempotencyKey?: string;
    actorId: string;
    authToken?: string;
  }) {
    const amountUnits = Math.round(Number(params.amountUnits));
    const cleanReason = String(params.reason || '').trim();
    if (!Number.isFinite(amountUnits) || amountUnits <= 0) {
      throw new Error('مبلغ التحويل الداخلي يجب أن يكون عدداً صحيحاً موجباً.');
    }
    if (!cleanReason) {
      throw new Error('سبب التحويل الداخلي مطلوب.');
    }
    if (!params.fromFinancialAccountId || !params.toFinancialAccountId || params.fromFinancialAccountId === params.toFinancialAccountId) {
      throw new Error('يجب اختيار حسابين مختلفين للتحويل الداخلي.');
    }

    const rpcClient = getRpcClient(params.authToken);
    const cleanKey = params.idempotencyKey?.trim() || `INT-XFER:${crypto.randomUUID()}`;
    const { data: rpcRes, error: rpcErr } = await rpcClient.rpc('execute_internal_account_transfer', {
      p_from_financial_account_id: params.fromFinancialAccountId,
      p_to_financial_account_id: params.toFinancialAccountId,
      p_amount_units: amountUnits,
      p_reason: cleanReason,
      p_reference_number: params.referenceNumber ? String(params.referenceNumber).trim() : null,
      p_idempotency_key: cleanKey,
      p_actor_id: params.actorId,
    });

    if (!rpcErr && rpcRes) {
      return rpcRes;
    }

    const isMissingRpc =
      rpcErr?.code === 'PGRST202' ||
      String(rpcErr?.message || '').toLowerCase().includes('could not find the function');
    if (rpcErr && !isMissingRpc) {
      throw new Error(rpcErr.message || 'فشل تنفيذ التحويل الداخلي.');
    }

    const adminClient = getSupabaseAdminClient();
    const { data: accs } = await adminClient
      .from('financial_accounts')
      .select('id, account_code, account_type, balance_units')
      .in('id', [params.fromFinancialAccountId, params.toFinancialAccountId]);

    const fromAcc = (accs || []).find((a: any) => a.id === params.fromFinancialAccountId);
    const toAcc = (accs || []).find((a: any) => a.id === params.toFinancialAccountId);
    if (!fromAcc || !toAcc) throw new Error('أحد حسابي التحويل الداخلي غير موجود.');
    if (String(fromAcc.account_type).toLowerCase() !== 'asset' || String(toAcc.account_type).toLowerCase() !== 'asset') {
      throw new Error('التحويل الداخلي مسموح فقط بين حسابات الأصول النقدية والحسابات الخارجية.');
    }
    if (Number(fromAcc.balance_units || 0) < amountUnits) {
      throw new Error(`رصيد الحساب المصدر (${fromAcc.account_code}) غير كافٍ للتحويل.`);
    }

    const entries = buildInternalAccountTransferEntries({
      fromFinAccountId: fromAcc.id,
      toFinAccountId: toAcc.id,
      fromAccountCode: fromAcc.account_code,
      toAccountCode: toAcc.account_code,
      amountUnits,
      reason: cleanReason,
    });

    const { data: txId, error: postErr } = await adminClient.rpc('post_ledger_transaction', {
      p_transaction_type: 'INTERNAL_ACCOUNT_TRANSFER',
      p_idempotency_key: cleanKey,
      p_reference: params.referenceNumber ? String(params.referenceNumber).trim() : 'INT-TRANSFER',
      p_metadata: {
        from_account_code: fromAcc.account_code,
        to_account_code: toAcc.account_code,
        amount_units: amountUnits,
        reason: cleanReason,
        description: `تحويل داخلي بين حسابات المنصة: من ${fromAcc.account_code} إلى ${toAcc.account_code} — ${cleanReason}`,
      },
      p_entries: entries,
    });
    if (postErr) throw new Error(postErr.message);

    const [{ data: fromExt }, { data: toExt }] = await Promise.all([
      adminClient.from('external_accounts').select('id').eq('financial_account_id', fromAcc.id).maybeSingle(),
      adminClient.from('external_accounts').select('id').eq('financial_account_id', toAcc.id).maybeSingle(),
    ]);

    const transferId = crypto.randomUUID();
    const now = new Date().toISOString();
    await adminClient.from('external_account_transfers').insert({
      id: transferId,
      from_external_account_id: fromExt?.id || null,
      to_external_account_id: toExt?.id || null,
      from_financial_account_id: fromAcc.id,
      to_financial_account_id: toAcc.id,
      amount_units: amountUnits,
      reference_number: params.referenceNumber ? String(params.referenceNumber).trim() : null,
      reason: cleanReason,
      ledger_transaction_id: String(txId),
      idempotency_key: cleanKey,
      created_by: params.actorId,
      created_at: now,
    });

    await this.writeFinancialAuditLog({
      actionType: 'INTERNAL_ACCOUNT_TRANSFER',
      actorId: params.actorId,
      transactionId: String(txId),
      details: { transfer_id: transferId, from: fromAcc.account_code, to: toAcc.account_code, amount_units: amountUnits, reason: cleanReason },
      authToken: params.authToken,
    });

    return { success: true, idempotent: false, transferId, transactionId: String(txId) };
  },

  async reconcileExternalAccount(params: {
    externalAccountId: string;
    actualBalanceUnits: number;
    applyAdjustment: boolean;
    adjustmentReason?: string;
    actorId: string;
    authToken?: string;
  }) {
    const actualUnits = Math.round(Number(params.actualBalanceUnits));
    if (!Number.isFinite(actualUnits) || actualUnits < 0) {
      throw new Error('الرصيد الفعلي يجب أن يكون عدداً صحيحاً غير سالب.');
    }

    const rpcClient = getRpcClient(params.authToken);
    const { data: rpcRes, error: rpcErr } = await rpcClient.rpc('reconcile_external_account', {
      p_external_account_id: params.externalAccountId,
      p_actual_balance_units: actualUnits,
      p_apply_adjustment: Boolean(params.applyAdjustment),
      p_adjustment_reason: params.adjustmentReason ? String(params.adjustmentReason).trim() : null,
      p_actor_id: params.actorId,
    });

    if (!rpcErr && rpcRes) {
      return rpcRes;
    }

    const isMissingRpc =
      rpcErr?.code === 'PGRST202' ||
      String(rpcErr?.message || '').toLowerCase().includes('could not find the function');
    if (rpcErr && !isMissingRpc) {
      throw new Error(rpcErr.message || 'فشل تنفيذ مطابقة الحساب الخارجي.');
    }

    const adminClient = getSupabaseAdminClient();
    const { data: extAcc } = await adminClient
      .from('external_accounts')
      .select('*')
      .eq('id', params.externalAccountId)
      .maybeSingle();
    if (!extAcc) throw new Error('الحساب الخارجي غير موجود.');

    const { data: finAcc } = await adminClient
      .from('financial_accounts')
      .select('id, account_code, balance_units')
      .eq('id', extAcc.financial_account_id)
      .single();

    const accounting = Number(finAcc?.balance_units || 0);
    const diff = actualUnits - accounting;
    const recId = crypto.randomUUID();
    const now = new Date().toISOString();
    let status: 'matched' | 'discrepancy' | 'adjusted' = diff === 0 ? 'matched' : 'discrepancy';
    let txId: string | null = null;

    if (diff !== 0 && params.applyAdjustment) {
      const cleanReason = String(params.adjustmentReason || '').trim();
      if (!cleanReason) {
        throw new Error('يجب كتابة سبب التسوية المحاسبية عند تطبيق تسوية الفارق.');
      }
      const contraCode =
        diff > 0
          ? extAcc.fund_scope === 'platform'
            ? 'OWNER-CAPITAL'
            : 'PLATFORM-EXPENSE-CLEARING'
          : 'PLATFORM-EXPENSES';
      const { data: contraAcc } = await adminClient
        .from('financial_accounts')
        .select('id')
        .eq('account_code', contraCode)
        .single();
      if (!contraAcc) throw new Error(`حساب التسوية (${contraCode}) غير موجود.`);

      const built = buildReconciliationAdjustmentEntries({
        externalFinAccountId: finAcc.id,
        contraFinAccountId: contraAcc.id,
        accountingBalance: accounting,
        actualBalance: actualUnits,
        reason: cleanReason,
        accountName: extAcc.account_name,
      });

      const { data: postedTxId, error: postErr } = await adminClient.rpc('post_ledger_transaction', {
        p_transaction_type: 'EXTERNAL_RECONCILIATION_ADJUSTMENT',
        p_idempotency_key: `EXT-RECON:${recId}`,
        p_reference: `RECON:${recId}`,
        p_metadata: {
          reconciliation_id: recId,
          external_account_id: extAcc.id,
          accounting_before: accounting,
          actual_balance: actualUnits,
          discrepancy: diff,
          reason: cleanReason,
          description: `تسوية مطابقة حساب خارجي (${extAcc.account_name}): ${cleanReason}`,
        },
        p_entries: built.entries,
      });
      if (postErr) throw new Error(postErr.message);
      txId = String(postedTxId);
      status = 'adjusted';
    }

    await adminClient
      .from('external_accounts')
      .update({ actual_balance_units: actualUnits, last_reconciled_at: now, updated_at: now })
      .eq('id', extAcc.id);

    await adminClient.from('external_account_reconciliations').insert({
      id: recId,
      external_account_id: extAcc.id,
      accounting_balance_units: status === 'adjusted' ? actualUnits : accounting,
      actual_balance_units: actualUnits,
      discrepancy_units: diff,
      adjustment_transaction_id: txId,
      adjustment_reason: params.adjustmentReason ? String(params.adjustmentReason).trim() : null,
      status,
      reconciled_by: params.actorId,
      created_at: now,
    });

    await this.writeFinancialAuditLog({
      actionType: 'EXTERNAL_ACCOUNT_RECONCILED',
      actorId: params.actorId,
      transactionId: txId,
      details: {
        reconciliation_id: recId,
        external_account_id: extAcc.id,
        accounting_balance: accounting,
        actual_balance: actualUnits,
        discrepancy_units: diff,
        status,
      },
      authToken: params.authToken,
    });

    return {
      success: true,
      reconciliationId: recId,
      status,
      accountingBalanceUnits: status === 'adjusted' ? actualUnits : accounting,
      actualBalanceUnits: actualUnits,
      discrepancyUnits: diff,
      adjustmentTransactionId: txId,
    };
  },
};

