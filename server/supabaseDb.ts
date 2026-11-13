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
} from '../src/types/index';

const AUTHORIZED_OWNER_EMAIL = (process.env.ADMIN_EMAIL || 'khalidalbuhiri97@gmail.com').trim().toLowerCase();
const AUTHORIZED_OWNER_ID = '00000000-0000-4000-8000-000000000001';

export function generateWalletAddress(userId: string): string {
  const hash = crypto.createHash('sha256').update(userId + '_kasb_wallet_salt_yemen_v1').digest('hex').toUpperCase();
  return `KY-${hash.slice(0, 12)}`;
}

function getDbClient() {
  try {
    return getSupabaseAdminClient();
  } catch {
    return supabaseServer;
  }
}

function mapLedgerTxType(rawType: string, entrySide: 'debit' | 'credit'): TransactionType {
  const upper = String(rawType || '').trim().toUpperCase();
  switch (upper) {
    case 'TASK_REWARD_PAYOUT':
    case 'TASK_REWARD':
      return 'TASK_REWARD';
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
    case 'WITHDRAWAL_REFUND':
      return 'WITHDRAWAL_REFUND';
    case 'REFERRAL_REWARD':
      return 'REFERRAL_REWARD';
    case 'PROMOTIONAL_BONUS':
      return 'PROMOTIONAL_BONUS';
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
      const { data: profileData, error: profileErr } = await db
        .from('profiles')
        .select('id, full_name, phone, city, area_name, avatar_url, account_status, created_at, updated_at')
        .eq('id', id)
        .maybeSingle();

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
        referralCode: '',
        referredBy: undefined,
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
      const [profilesRes, rolesRes] = await Promise.all([
        db
          .from('profiles')
          .select('id, full_name, phone, city, area_name, avatar_url, account_status, created_at, updated_at')
          .order('created_at', { ascending: false }),
        db.from('user_roles').select('user_id, role'),
      ]);

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
        referralCode: '',
        referredBy: undefined,
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
          await logSupabaseError({
            err: insertFaErr,
            operation: 'CREATE_FINANCIAL_ACCOUNT',
            sourceTable: 'financial_accounts',
            executionDurationMs: Date.now() - startTime,
          });
          throw insertFaErr;
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
      if (cleanProofImages.length > 0) proofPayload.images = cleanProofImages;

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
  async getTreasurySummary(): Promise<TreasurySummary> {
    const db = getDbClient();
    const [accountsRes, tasksRes] = await Promise.all([
      db
        .from('financial_accounts')
        .select('id, account_code, account_type, balance_units, status'),
      db
        .from('tasks')
        .select('status, total_budget_units, approved_count, reward_units, budget_spent_yer'),
    ]);

    if (accountsRes.error) {
      throw new Error(`فشل قراءة حسابات الخزينة من Supabase: ${accountsRes.error.message}`);
    }

    const accounts = accountsRes.data || [];
    const issuanceAcc = accounts.find((a: any) => a.account_code === 'VIRTUAL-ISSUANCE-CONTROL');
    const treasuryAcc = accounts.find((a: any) => a.account_code === 'PLATFORM-TREASURY');

    const totalIssuedUnits = Number(issuanceAcc?.balance_units || 0);
    const treasuryAvailable = Number(treasuryAcc?.balance_units || 0);
    const taskBudgetReserved = accounts
      .filter((a: any) => String(a.account_code || '').startsWith('TASK-ESCROW-'))
      .reduce((sum: number, a: any) => sum + Number(a.balance_units || 0), 0);
    const userAvailableTotal = accounts
      .filter((a: any) => a.account_type === 'wallet')
      .reduce((sum: number, a: any) => sum + Number(a.balance_units || 0), 0);

    const activeTasksBudgetTotal = (tasksRes.data || [])
      .filter((t: any) => String(t.status || '').toLowerCase() === 'active')
      .reduce((sum: number, t: any) => {
        const spent = Number(t.budget_spent_yer ?? Number(t.approved_count || 0) * Number(t.reward_units || 0));
        return sum + Math.max(0, Number(t.total_budget_units || 0) - spent);
      }, 0);

    const reconciledSum = treasuryAvailable + taskBudgetReserved + userAvailableTotal;

    return {
      totalIssuedUnits,
      treasuryAvailable,
      taskBudgetReserved,
      userAvailableTotal,
      userPendingTotal: 0,
      withdrawalReservedTotal: 0,
      isReconciled: totalIssuedUnits > 0 ? reconciledSum === totalIssuedUnits : true,
      activeTasksBudgetTotal,
    };
  },

  async getLedgerTransactions(limit = 100, offset = 0): Promise<LedgerTransaction[]> {
    const db = getDbClient();
    const { data: txs, error: txErr } = await db
      .from('ledger_transactions')
      .select('id, transaction_type, reference, idempotency_key, status, metadata, created_by, created_at')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

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

    return (txs || []).map((tx: any) => {
      const txEntries = entriesByTx.get(tx.id) || [];
      const firstMemo = txEntries.find((e: any) => e.memo)?.memo;
      const metaDesc =
        tx.metadata?.description ||
        (tx.metadata?.task_title ? `${tx.transaction_type}: ${tx.metadata.task_title}` : undefined) ||
        tx.metadata?.note ||
        firstMemo ||
        tx.reference ||
        tx.transaction_type;

      return {
        id: tx.id,
        transactionType: tx.transaction_type,
        referenceId: tx.reference || tx.id,
        idempotencyKey: tx.idempotency_key,
        description: metaDesc,
        createdBy: tx.created_by,
        createdAt: tx.created_at,
        entries: txEntries.map((e: any) => ({
          id: e.id,
          transactionId: e.transaction_id,
          accountId: e.account_id,
          debitAmount: e.entry_side === 'debit' ? Number(e.amount_units || 0) : 0,
          creditAmount: e.entry_side === 'credit' ? Number(e.amount_units || 0) : 0,
          createdAt: e.created_at,
        })),
      };
    });
  },

  /**
   * 6. PLATFORM SETTINGS
   */
  async getSettings(): Promise<PlatformSettings> {
    const defaultSettings: PlatformSettings = {
      id: 'settings-1',
      platformName: 'كسب اليمن',
      currency: 'YER',
      minWithdrawal: 1000,
      maxWithdrawal: 500000,
      dailyWithdrawalLimit: 1000000,
      defaultFeePercentage: 1.5,
      referralBonus: 300,
      taskSubmissionLimit: 10,
      isRegistrationOpen: true,
      maintenanceMode: false,
      contactPhone: '+967 739 701 293',
      contactEmail: 'khalidalbuhiri@gmail.com',
      updatedAt: new Date().toISOString(),
    };

    try {
      const db = getDbClient();
      const { data, error } = await db
        .from('platform_settings')
        .select('setting_key, setting_value, updated_at');

      if (error || !data || data.length === 0) {
        return defaultSettings;
      }

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
};
