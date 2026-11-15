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
} from '../src/types/index';

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
      totalEarnedYer += rewardEarned;
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
  const amt = Math.round(Number(params.amountUnits));
  if (!Number.isFinite(amt) || amt <= 0) {
    throw new Error('المبلغ يجب أن يكون عدداً صحيحاً موجباً أكبر من صفر.');
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
    default:
      return (entrySide === 'credit' ? 'TASK_REWARD' : 'ADMIN_ADJUSTMENT') as TransactionType;
  }
}

function mapTaskRow(t: any): TaskItem {
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
    createdBy: t.created_by,
    createdAt: t.created_at,
  };
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
        .select('id, full_name, phone, city, area_name, avatar_url, account_status, referral_code, referred_by, created_at, updated_at')
        .eq('id', id)
        .maybeSingle();

      // Pre-Migration 014 backwards-compatible fallback if referred_by doesn't exist yet
      if (profileErr && (profileErr.code === '42703' || String(profileErr.message || '').includes('referred_by'))) {
        const fallback = await db
          .from('profiles')
          .select('id, full_name, phone, city, area_name, avatar_url, account_status, referral_code, created_at, updated_at')
          .eq('id', id)
          .maybeSingle();
        profileData = fallback.data as any;
        profileErr = fallback.error;
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

      const userRole: UserRole = roleData?.role === 'admin' ? 'admin' : 'user';

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
        .select('id, full_name, phone, city, area_name, avatar_url, account_status, referral_code, referred_by, created_at, updated_at')
        .order('created_at', { ascending: false });

      if (profilesRes.error && (profilesRes.error.code === '42703' || String(profilesRes.error.message || '').includes('referred_by'))) {
        profilesRes = (await db
          .from('profiles')
          .select('id, full_name, phone, city, area_name, avatar_url, account_status, referral_code, created_at, updated_at')
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
        roleMap.set(r.user_id, r.role === 'admin' ? 'admin' : 'user');
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

      return (profilesRes.data || []).map((p: any) => ({
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
        createdAt: p.created_at || new Date().toISOString(),
        updatedAt: p.updated_at || new Date().toISOString(),
      }));
    } catch (err: any) {
      console.error('[Supabase GET_ALL_USERS]', err.message);
      throw new Error(`فشل جلب قائمة المستخدمين من Supabase: ${err.message}`);
    }
  },

  async updateUserStatus(userId: string, status: 'active' | 'suspended' | 'under_review'): Promise<void> {
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
            txType === 'PROMOTIONAL_BONUS')
        ) {
          totalEarned += amt;
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
  async getTasks(params?: { category?: string; search?: string }): Promise<TaskItem[]> {
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

      let mapped = (data || []).map(mapTaskRow);
      if (params?.category && params.category !== 'all') {
        mapped = mapped.filter((t) => t.category === params.category);
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

      return (data || []).map(mapTaskRow);
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

      return mapTaskRow(data);
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
    const [accountsRes, tasksRes, taxDefRes, taxSettleRes, auditRes, withdrawRes] = await Promise.all([
      db
        .from('financial_accounts')
        .select('id, account_code, account_type, balance_units, status'),
      db
        .from('tasks')
        .select('status, total_budget_units, approved_count, reward_units, budget_spent_yer'),
      db.from('tax_definitions').select('id', { count: 'exact', head: true }),
      db.from('tax_settlements').select('tax_amount, status'),
      db.from('financial_audit_logs').select('id', { count: 'exact', head: true }),
      db.from('withdrawal_requests').select('id', { count: 'exact', head: true }),
    ]);

    if (accountsRes.error) {
      throw new Error(`فشل قراءة حسابات الخزينة من Supabase: ${accountsRes.error.message}`);
    }

    const accounts = accountsRes.data || [];
    const byCode = new Map<string, any>();
    for (const a of accounts) {
      if (a.account_code) byCode.set(String(a.account_code), a);
    }

    const bal = (code: string) => Number(byCode.get(code)?.balance_units || 0);

    const totalIssuedUnits = bal('VIRTUAL-ISSUANCE-CONTROL');
    const treasuryAvailable = bal('PLATFORM-TREASURY');
    const taskBudgetReserved = accounts
      .filter((a: any) => String(a.account_code || '').startsWith('TASK-ESCROW-'))
      .reduce((sum: number, a: any) => sum + Number(a.balance_units || 0), 0);
    const userAvailableTotal = accounts
      .filter((a: any) => a.account_type === 'wallet')
      .reduce((sum: number, a: any) => sum + Number(a.balance_units || 0), 0);

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
    const userLiabilitiesTotal = userAvailableTotal + withdrawalReservedTotal;

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

    const activeTasksBudgetTotal = (tasksRes.data || [])
      .filter((t: any) => String(t.status || '').toLowerCase() === 'active')
      .reduce((sum: number, t: any) => {
        const spent = Number(t.budget_spent_yer ?? Number(t.approved_count || 0) * Number(t.reward_units || 0));
        return sum + Math.max(0, Number(t.total_budget_units || 0) - spent);
      }, 0);

    const reconciledSum =
      treasuryAvailable +
      taskBudgetReserved +
      userAvailableTotal +
      withdrawalReservedTotal +
      withdrawalSettledTotal +
      revTasks +
      Math.max(0, withdrawalFeesFromSupply);

    const missingMigration011Accounts = MIGRATION_011_CORE_ACCOUNTS.filter((code) => !byCode.has(code));
    const migration011Ready = missingMigration011Accounts.length === 0;

    return {
      totalIssuedUnits,
      treasuryAvailable,
      taskBudgetReserved,
      userAvailableTotal,
      userPendingTotal: withdrawalReservedTotal,
      withdrawalReservedTotal,
      withdrawalSettledTotal,
      cashVaultTotal,
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
      isReconciled: totalIssuedUnits > 0 ? reconciledSum === totalIssuedUnits : true,
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
    const rpcClient = getRpcClient(params.authToken);

    // 1. Try Migration 011 atomic RPC first
    const { data: rpcData, error: rpcErr } = await rpcClient.rpc('release_task_escrow', {
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

    // 2. Live Fallback using existing atomic post_ledger_transaction RPC
    const db = getActorOrAdminClient(params.authToken);
    const idempotencyKey = `TASK-ESCROW-RELEASE:${params.taskId}`;

    const { data: existingTx } = await db
      .from('ledger_transactions')
      .select('id')
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle();

    if (existingTx?.id) {
      return { releasedUnits: 0, transactionId: existingTx.id, idempotent: true };
    }

    const { data: taskRow } = await db
      .from('tasks')
      .select('id, title, escrow_account_id')
      .eq('id', params.taskId)
      .maybeSingle();

    const { data: escrowAcc } = await db
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

    const { data: treasuryAcc, error: tErr } = await db
      .from('financial_accounts')
      .select('id')
      .eq('account_code', 'PLATFORM-TREASURY')
      .single();

    if (tErr || !treasuryAcc) {
      throw new Error('تعذر العثور على حساب خزينة المنصة لإرجاع رصيد المهمة.');
    }

    const { data: txId, error: postErr } = await rpcClient.rpc('post_ledger_transaction', {
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

    await db.from('admin_logs').insert({
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
    const amountUnits = Math.round(Number(params.amount));
    if (!Number.isFinite(amountUnits) || amountUnits <= 0) {
      throw new Error('يرجى تحديد مبلغ صحيح أكبر من صفر للسحب.');
    }

    const cleanMethod = params.method.trim().toUpperCase();
    const cleanKey = params.idempotencyKey?.trim() || `WITHDRAWAL-REQ:${crypto.randomUUID()}`;
    const rpcClient = getRpcClient(params.authToken);

    // 1. Try Migration 011 atomic RPC first
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
      ? Math.round((amountUnits * methodCfg.feePercentage) / 100) + (methodCfg.feeFlat || 0)
      : Math.round(amountUnits * 0.015);
    const netAmount = amountUnits - fee;
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

    // 1. Try Migration 011 atomic RPC first
    const { data: rpcRes, error: rpcErr } = await rpcClient.rpc('settle_withdrawal_ledger', {
      p_withdrawal_id: params.withdrawalId,
      p_decision: params.action,
      p_transfer_reference: params.transferReference?.trim() || null,
      p_receipt_url: params.receiptUrl?.trim() || null,
      p_reason: params.reason?.trim() || null,
      p_provider_fee_units: Math.max(0, Math.round(Number(params.providerFeeUnits || 0))),
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

    const totalAmount = Math.round(Number(withData.amount));
    const fee = Math.round(Number(withData.fee || 0));
    const netAmount = totalAmount - fee;

    if (params.action === 'PAY') {
      if (!params.transferReference?.trim()) {
        throw new Error('يرجى إدخال رقم مرجع الحوالة البنكية.');
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
    const { data, error } = await db
      .from('tax_definitions')
      .insert({
        id: crypto.randomUUID(),
        tax_type: taxType,
        tax_authority: taxAuthority,
        region: (params.region || 'YEMEN').trim(),
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
          virtualIssuanceControl: summary.totalIssuedUnits || 0,
          totalRealAssets: summary.cashVaultTotal || 0,
        },
        liabilities: {
          userWalletBalances: summary.userAvailableTotal || 0,
          withdrawalReserved: summary.withdrawalReservedTotal || 0,
          taskEscrowBalances: summary.taskBudgetReserved || 0,
          taxesPayable: summary.taxPayableTotal || 0,
          expenseClearing: expenseClearingBal,
          totalUserAndExternalLiabilities:
            (summary.userAvailableTotal || 0) +
            (summary.withdrawalReservedTotal || 0) +
            (summary.taskBudgetReserved || 0) +
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
        return {
          ...defaultSettings,
          id: String(first.id || defaultSettings.id),
          platformName: String(first.platform_name || defaultSettings.platformName),
          minWithdrawal: Number(first.min_withdrawal ?? defaultSettings.minWithdrawal),
          maxWithdrawal: Number(first.max_withdrawal ?? defaultSettings.maxWithdrawal),
          dailyWithdrawalLimit: Number(first.daily_withdrawal_limit ?? defaultSettings.dailyWithdrawalLimit),
          defaultFeePercentage: Number(first.default_fee_percentage ?? defaultSettings.defaultFeePercentage),
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

      return {
        ...defaultSettings,
        platformName: String(map.get('platform_name') || defaultSettings.platformName),
        minWithdrawal: Number(map.get('min_withdrawal') ?? defaultSettings.minWithdrawal),
        maxWithdrawal: Number(map.get('max_withdrawal') ?? defaultSettings.maxWithdrawal),
        dailyWithdrawalLimit: Number(map.get('daily_withdrawal_limit') ?? defaultSettings.dailyWithdrawalLimit),
        defaultFeePercentage: Number(map.get('default_fee_percentage') ?? defaultSettings.defaultFeePercentage),
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
    try {
      const now = new Date().toISOString();
      const pairs: Array<[string, any]> = [
        ['platform_name', payload.platformName],
        ['min_withdrawal', payload.minWithdrawal],
        ['max_withdrawal', payload.maxWithdrawal],
        ['daily_withdrawal_limit', payload.dailyWithdrawalLimit],
        ['default_fee_percentage', payload.defaultFeePercentage],
        ['referral_bonus', payload.referralBonus],
        ['is_registration_open', payload.isRegistrationOpen],
        ['maintenance_mode', payload.maintenanceMode],
        ['contact_phone', payload.contactPhone],
        ['contact_email', payload.contactEmail],
      ];

      for (const [key, val] of pairs) {
        if (val !== undefined) {
          await db
            .from('platform_settings')
            .upsert({ setting_key: key, setting_value: val, updated_at: now }, { onConflict: 'setting_key' });
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
};
