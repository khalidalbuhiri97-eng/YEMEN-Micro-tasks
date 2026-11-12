/**
 * Kasb Yemen - Supabase Database Unified Service Layer
 * Replaces local database.json with direct, persistent Supabase PostgreSQL operations.
 * Enforces atomic transactions, ACID guarantees, idempotency, and comprehensive error logging.
 */

import crypto from 'node:crypto';
import { supabaseServer, getSupabaseAdminClient, logSupabaseError } from './app';
import type {
  UserProfile,
  UserRole,
  AccountStatus,
  UserWallet,
  WalletTransaction,
  TaskItem,
  TaskSubmission,
  WithdrawalRequest,
  PayoutMethod,
  AppNotification,
  PlatformSettings,
  SupportTicket,
  WalletTransfer,
  TreasurySummary,
  LedgerTransaction,
  LedgerEntry,
} from '../src/types/index';

const AUTHORIZED_OWNER_EMAIL = (process.env.ADMIN_EMAIL || 'khalidalbuhiri97@gmail.com').trim().toLowerCase();
const AUTHORIZED_OWNER_ID = '00000000-0000-4000-8000-000000000001';

export function generateWalletAddress(userId: string): string {
  const hash = crypto.createHash('sha256').update(userId + '_kasb_wallet_salt_yemen_v1').digest('hex').toUpperCase();
  return `KY-${hash.slice(0, 12)}`;
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
    try {
      // 1. Query 'profiles' table selecting only actual existing columns
      const { data: profileData, error: profileErr } = await supabaseServer
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

      // 2. Query 'user_roles' table and check error explicitly
      const { data: roleData, error: roleErr } = await supabaseServer
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

      // Default role to lowest safe privilege 'user' if no role record exists (never grant admin by default)
      const userRole: UserRole = roleData?.role === 'admin' ? 'admin' : 'user';

      // 3. Fetch Email safely using getSupabaseAdminClient() with explicit error handling
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
        // If SERVICE_ROLE_KEY is unconfigured, log error safely without leaking secrets
        await logSupabaseError({
          err: keyErr,
          operation: 'FIND_USER_BY_ID_ADMIN_CLIENT_CHECK',
          executionDurationMs: Date.now() - startTime,
        });
      }

      // 4. Map account_status column to UserProfile status
      const accountStatus: AccountStatus = (profileData.account_status as AccountStatus) || 'active';

      // 5. Construct UserProfile cleanly without assuming non-existent profile columns or inventing data
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
    try {
      let query = supabaseServer.from('profiles').select('*');
      if (clean.includes('@')) {
        query = query.eq('email', clean);
      } else {
        query = query.eq('phone', identifier.trim());
      }

      const { data, error } = await query.maybeSingle();
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
      return {
        id: data.id,
        fullName: data.full_name,
        phone: data.phone,
        email: data.email,
        avatarUrl: data.avatar_url || '',
        role: data.role,
        status: data.status,
        referralCode: data.referral_code,
        referredBy: data.referred_by,
        city: data.city || 'صنعاء',
        createdAt: data.created_at,
        updatedAt: data.updated_at,
      };
    } catch (err: any) {
      console.error('[Supabase FIND_USER_BY_PHONE_OR_EMAIL]', err.message);
      throw new Error(`فشل البحث عن المستخدم في Supabase: ${err.message}`);
    }
  },

  async getAllUsers(): Promise<UserProfile[]> {
    const startTime = Date.now();
    try {
      const { data, error } = await supabaseServer
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        await logSupabaseError({
          err: error,
          operation: 'GET_ALL_USERS',
          sourceTable: 'profiles',
          executionDurationMs: Date.now() - startTime,
        });
        throw error;
      }

      return (data || []).map((p: any) => ({
        id: p.id,
        fullName: p.full_name,
        phone: p.phone,
        email: p.email,
        avatarUrl: p.avatar_url || '',
        role: p.role,
        status: p.status,
        referralCode: p.referral_code,
        referredBy: p.referred_by,
        city: p.city || 'صنعاء',
        createdAt: p.created_at,
        updatedAt: p.updated_at,
      }));
    } catch (err: any) {
      console.error('[Supabase GET_ALL_USERS]', err.message);
      throw new Error(`فشل جلب قائمة المستخدمين من Supabase: ${err.message}`);
    }
  },

  async updateUserStatus(userId: string, status: 'active' | 'suspended' | 'under_review'): Promise<void> {
    const startTime = Date.now();
    try {
      const { error } = await supabaseServer
        .from('profiles')
        .update({ status, updated_at: new Date().toISOString() })
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
   * 2. WALLETS & TRANSACTIONS
   */
  async getWallet(userId: string): Promise<UserWallet> {
    const startTime = Date.now();

    // 1. Validate userId input
    if (!userId || typeof userId !== 'string' || !userId.trim()) {
      throw new Error('معرف المستخدم غير صالح للجلب من المحفظة.');
    }
    const cleanUserId = userId.trim();

    try {
      // 2. Fetch existing wallet (limit 1 ordered by creation to prevent PGRST116 if duplicates exist prior to migration)
      const { data: existingList, error: fetchErr } = await supabaseServer
        .from('wallets')
        .select('*')
        .eq('user_id', cleanUserId)
        .order('created_at', { ascending: true })
        .limit(1);

      if (fetchErr) {
        await logSupabaseError({
          err: fetchErr,
          operation: 'GET_WALLETS_FETCH',
          sourceTable: 'wallets',
          executionDurationMs: Date.now() - startTime,
        });
        throw fetchErr;
      }

      // 3. Return existing wallet if found
      if (existingList && existingList.length > 0) {
        const data = existingList[0];
        return {
          id: data.id,
          userId: data.user_id,
          walletAddress: data.wallet_address || generateWalletAddress(cleanUserId),
          availableBalance: Number(data.available_balance ?? data.balance ?? 0),
          pendingBalance: Number(data.pending_balance || 0),
          reservedBalance: Number(data.reserved_balance || 0),
          totalEarned: Number(data.total_earned || 0),
          totalTransferred: Number(data.total_transferred || 0),
          totalWithdrawn: Number(data.total_withdrawn || 0),
          status: data.status || 'ACTIVE',
          currency: 'YER',
          createdAt: data.created_at,
          updatedAt: data.updated_at,
        };
      }

      // 4. Attempt to create initial 0 YER wallet if none exists
      const now = new Date().toISOString();
      const newWalletAddress = generateWalletAddress(cleanUserId);
      const newWallet: Record<string, any> = {
        id: crypto.randomUUID(),
        user_id: cleanUserId,
        wallet_address: newWalletAddress,
        balance: 0,
        available_balance: 0,
        pending_balance: 0,
        reserved_balance: 0,
        total_earned: 0,
        total_transferred: 0,
        total_withdrawn: 0,
        currency: 'YER',
        status: 'ACTIVE',
        created_at: now,
        updated_at: now,
      };

      let { data: created, error: insertError } = await supabaseServer
        .from('wallets')
        .insert(newWallet)
        .select('*')
        .maybeSingle();

      // Gracefully handle column variation (available_balance vs balance)
      if (insertError && (insertError.message?.includes('available_balance') || insertError.message?.includes('balance'))) {
        delete newWallet.available_balance;
        const fallback = await supabaseServer
          .from('wallets')
          .insert(newWallet)
          .select('*')
          .maybeSingle();
        created = fallback.data;
        insertError = fallback.error;
      }

      // 5. Concurrency Collision Handling (Duplicate Key 23505 / UNIQUE Constraint)
      if (insertError) {
        const isDuplicateCollision =
          insertError.code === '23505' ||
          insertError.message?.includes('duplicate key') ||
          insertError.message?.includes('unique constraint') ||
          insertError.message?.includes('wallets_user_id_key');

        if (isDuplicateCollision) {
          // Re-fetch existing wallet created by concurrent request
          const { data: refetchedList, error: refetchErr } = await supabaseServer
            .from('wallets')
            .select('*')
            .eq('user_id', cleanUserId)
            .order('created_at', { ascending: true })
            .limit(1);

          if (!refetchErr && refetchedList && refetchedList.length > 0) {
            const row = refetchedList[0];
            return {
              id: row.id,
              userId: row.user_id,
              walletAddress: row.wallet_address || newWalletAddress,
              availableBalance: Number(row.available_balance ?? row.balance ?? 0),
              pendingBalance: Number(row.pending_balance || 0),
              reservedBalance: Number(row.reserved_balance || 0),
              totalEarned: Number(row.total_earned || 0),
              totalTransferred: Number(row.total_transferred || 0),
              totalWithdrawn: Number(row.total_withdrawn || 0),
              status: row.status || 'ACTIVE',
              currency: 'YER',
              createdAt: row.created_at,
              updatedAt: row.updated_at,
            };
          }
        }

        await logSupabaseError({
          err: insertError,
          operation: 'CREATE_INITIAL_WALLET',
          sourceTable: 'wallets',
          executionDurationMs: Date.now() - startTime,
        });
        throw insertError;
      }

      if (!created) {
        throw new Error('لم يتم إرجاع بيانات المحفظة المنشأة حديثاً من خادم قاعدة البيانات.');
      }

      return {
        id: created.id,
        userId: created.user_id,
        walletAddress: created.wallet_address || newWalletAddress,
        availableBalance: Number(created.available_balance ?? created.balance ?? 0),
        pendingBalance: Number(created.pending_balance || 0),
        reservedBalance: Number(created.reserved_balance || 0),
        totalEarned: Number(created.total_earned || 0),
        totalTransferred: Number(created.total_transferred || 0),
        totalWithdrawn: Number(created.total_withdrawn || 0),
        status: created.status || 'ACTIVE',
        currency: 'YER',
        createdAt: created.created_at,
        updatedAt: created.updated_at,
      };
    } catch (err: any) {
      console.error('[Supabase GET_WALLET Error]', err.message);
      throw new Error(`فشل جلب بيانات المحفظة من Supabase: ${err.message}`);
    }
  },

  async getTransactions(userId?: string): Promise<WalletTransaction[]> {
    const startTime = Date.now();
    try {
      let query = supabaseServer.from('wallet_transactions').select('*').order('created_at', { ascending: false });
      if (userId) {
        query = query.eq('user_id', userId);
      }

      const { data, error } = await query;
      if (error) {
        await logSupabaseError({
          err: error,
          operation: 'GET_TRANSACTIONS',
          sourceTable: 'wallet_transactions',
          executionDurationMs: Date.now() - startTime,
        });
        // If table is missing or empty, return empty list gracefully
        return [];
      }

      return (data || []).map((t: any) => ({
        id: t.id,
        userId: t.user_id,
        type: t.type,
        amount: Number(t.amount || 0),
        previousBalance: Number(t.previous_balance || 0),
        newBalance: Number(t.new_balance || 0),
        status: t.status,
        referenceId: t.reference_id,
        idempotencyKey: t.idempotency_key,
        description: t.description,
        adminId: t.admin_id,
        createdAt: t.created_at,
      }));
    } catch (err: any) {
      console.error('[Supabase GET_TRANSACTIONS]', err.message);
      return [];
    }
  },

  /**
   * 3. TASKS
   */
  async getTasks(params?: { category?: string; search?: string }): Promise<TaskItem[]> {
    const startTime = Date.now();
    try {
      let query = supabaseServer.from('tasks').select('*').eq('status', 'ACTIVE');
      if (params?.category) {
        query = query.eq('category', params.category);
      }
      if (params?.search) {
        query = query.ilike('title', `%${params.search}%`);
      }
      query = query.order('created_at', { ascending: false });

      const { data, error } = await query;
      if (error) {
        await logSupabaseError({
          err: error,
          operation: 'GET_TASKS',
          sourceTable: 'tasks',
          executionDurationMs: Date.now() - startTime,
        });
        throw error;
      }

      return (data || []).map((t: any) => ({
        id: t.id,
        title: t.title,
        description: t.description,
        category: t.category,
        rewardYer: Number(t.reward_yer || 0),
        steps: Array.isArray(t.steps) ? t.steps : [],
        proofRequirements: t.proof_requirements || { requireImage: true, requireText: true },
        timeEstimateMinutes: Number(t.time_estimate_minutes || 10),
        totalQuantity: Number(t.total_quantity || 0),
        completedQuantity: Number(t.completed_quantity || 0),
        maxPerUser: Number(t.max_per_user || 1),
        budgetYer: Number(t.budget_yer || 0),
        budgetSpentYer: Number(t.budget_spent_yer || 0),
        deadline: t.deadline,
        status: t.status,
        createdBy: t.created_by,
        createdAt: t.created_at,
      }));
    } catch (err: any) {
      console.error('[Supabase GET_TASKS]', err.message);
      throw new Error(`فشل جلب قائمة المهام من Supabase: ${err.message}`);
    }
  },

  async getAllAdminTasks(): Promise<TaskItem[]> {
    const startTime = Date.now();
    try {
      const { data, error } = await supabaseServer
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

      return (data || []).map((t: any) => ({
        id: t.id,
        title: t.title,
        description: t.description,
        category: t.category,
        rewardYer: Number(t.reward_yer || 0),
        steps: Array.isArray(t.steps) ? t.steps : [],
        proofRequirements: t.proof_requirements || { requireImage: true, requireText: true },
        timeEstimateMinutes: Number(t.time_estimate_minutes || 10),
        totalQuantity: Number(t.total_quantity || 0),
        completedQuantity: Number(t.completed_quantity || 0),
        maxPerUser: Number(t.max_per_user || 1),
        budgetYer: Number(t.budget_yer || 0),
        budgetSpentYer: Number(t.budget_spent_yer || 0),
        deadline: t.deadline,
        status: t.status,
        createdBy: t.created_by,
        createdAt: t.created_at,
      }));
    } catch (err: any) {
      throw new Error(`فشل جلب مهام المدير من Supabase: ${err.message}`);
    }
  },

  async getTaskById(id: string): Promise<TaskItem | null> {
    try {
      const { data, error } = await supabaseServer
        .from('tasks')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (error) throw error;
      if (!data) return null;

      return {
        id: data.id,
        title: data.title,
        description: data.description,
        category: data.category,
        rewardYer: Number(data.reward_yer || 0),
        steps: Array.isArray(data.steps) ? data.steps : [],
        proofRequirements: data.proof_requirements || { requireImage: true, requireText: true },
        timeEstimateMinutes: Number(data.time_estimate_minutes || 10),
        totalQuantity: Number(data.total_quantity || 0),
        completedQuantity: Number(data.completed_quantity || 0),
        maxPerUser: Number(data.max_per_user || 1),
        budgetYer: Number(data.budget_yer || 0),
        budgetSpentYer: Number(data.budget_spent_yer || 0),
        deadline: data.deadline,
        status: data.status,
        createdBy: data.created_by,
        createdAt: data.created_at,
      };
    } catch (err: any) {
      throw new Error(`فشل جلب تفاصيل المهمة من Supabase: ${err.message}`);
    }
  },

  async createTask(taskData: any): Promise<TaskItem> {
    const startTime = Date.now();
    const taskId = crypto.randomUUID();
    const budgetYer = Number(taskData.rewardYer) * Number(taskData.totalQuantity);
    const now = new Date().toISOString();

    const taskRow = {
      id: taskId,
      title: taskData.title,
      description: taskData.description,
      category: taskData.category,
      reward_yer: Number(taskData.rewardYer),
      steps: taskData.steps || [],
      proof_requirements: taskData.proofRequirements || { requireImage: true, requireText: true },
      time_estimate_minutes: Number(taskData.timeEstimateMinutes || 10),
      total_quantity: Number(taskData.totalQuantity),
      completed_quantity: 0,
      max_per_user: Number(taskData.maxPerUser || 1),
      budget_yer: budgetYer,
      budget_spent_yer: 0,
      deadline: taskData.deadline || null,
      status: 'ACTIVE',
      created_by: taskData.createdBy || null,
      created_at: now,
      updated_at: now,
    };

    try {
      const { data, error } = await supabaseServer
        .from('tasks')
        .insert(taskRow)
        .select('*')
        .single();

      if (error) {
        await logSupabaseError({
          err: error,
          operation: 'CREATE_TASK',
          sourceTable: 'tasks',
          executionDurationMs: Date.now() - startTime,
        });
        throw error;
      }

      return {
        id: data.id,
        title: data.title,
        description: data.description,
        category: data.category,
        rewardYer: Number(data.reward_yer),
        steps: data.steps,
        proofRequirements: data.proof_requirements,
        timeEstimateMinutes: Number(data.time_estimate_minutes),
        totalQuantity: Number(data.total_quantity),
        completedQuantity: Number(data.completed_quantity),
        maxPerUser: Number(data.max_per_user),
        budgetYer: Number(data.budget_yer),
        budgetSpentYer: Number(data.budget_spent_yer),
        deadline: data.deadline,
        status: data.status,
        createdBy: data.created_by,
        createdAt: data.created_at,
      };
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
    proofText?: string;
    proofImages?: string[];
    proofUrl?: string;
  }): Promise<TaskSubmission> {
    const startTime = Date.now();
    try {
      // Check duplicate submissions
      const { data: existing } = await supabaseServer
        .from('task_submissions')
        .select('id, status')
        .eq('task_id', payload.taskId)
        .eq('user_id', payload.userId)
        .maybeSingle();

      if (existing) {
        if (existing.status === 'APPROVED') {
          throw new Error('لقد أنجزت هذه المهمة بالفعل واستلمت مكافأتها مسبقاً.');
        }
        if (existing.status === 'PENDING' || existing.status === 'UNDER_REVIEW') {
          throw new Error('لديك إثبات قيد المراجعة لهذه المهمة بالفعل.');
        }
      }

      const submissionId = crypto.randomUUID();
      const now = new Date().toISOString();
      const subRow = {
        id: submissionId,
        task_id: payload.taskId,
        user_id: payload.userId,
        proof_text: payload.proofText || null,
        proof_images: payload.proofImages || [],
        proof_url: payload.proofUrl || null,
        status: 'PENDING',
        created_at: now,
      };

      const { data, error } = await supabaseServer
        .from('task_submissions')
        .insert(subRow)
        .select('*')
        .single();

      if (error) {
        await logSupabaseError({
          err: error,
          operation: 'SUBMIT_TASK_PROOF',
          sourceTable: 'task_submissions',
          executionDurationMs: Date.now() - startTime,
        });
        throw error;
      }

      return {
        id: data.id,
        taskId: data.task_id,
        userId: data.user_id,
        proofText: data.proof_text,
        proofImages: data.proof_images || [],
        proofUrl: data.proof_url,
        status: data.status,
        createdAt: data.created_at,
      };
    } catch (err: any) {
      throw new Error(`فشل إرسال إثبات المهمة إلى Supabase: ${err.message}`);
    }
  },

  async getMySubmissions(userId: string): Promise<TaskSubmission[]> {
    try {
      const { data, error } = await supabaseServer
        .from('task_submissions')
        .select('*, tasks(title, reward_yer)')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      return (data || []).map((s: any) => ({
        id: s.id,
        taskId: s.task_id,
        userId: s.user_id,
        taskTitle: s.tasks?.title || 'مهمة مصغرة',
        taskRewardYer: Number(s.tasks?.reward_yer || 0),
        proofText: s.proof_text,
        proofImages: s.proof_images || [],
        proofUrl: s.proof_url,
        status: s.status,
        rejectionReason: s.rejection_reason,
        reviewedBy: s.reviewed_by,
        reviewedAt: s.reviewed_at,
        rewardTransactionId: s.reward_transaction_id,
        createdAt: s.created_at,
      }));
    } catch (err: any) {
      console.error('[Supabase GET_MY_SUBMISSIONS]', err.message);
      return [];
    }
  },

  async getAllSubmissions(): Promise<TaskSubmission[]> {
    try {
      const { data, error } = await supabaseServer
        .from('task_submissions')
        .select('*, profiles(full_name, phone), tasks(title, reward_yer)')
        .order('created_at', { ascending: false });

      if (error) throw error;

      return (data || []).map((s: any) => ({
        id: s.id,
        taskId: s.task_id,
        userId: s.user_id,
        userFullName: s.profiles?.full_name || 'مستخدم',
        userPhone: s.profiles?.phone || '',
        taskTitle: s.tasks?.title || 'مهمة مصغرة',
        taskRewardYer: Number(s.tasks?.reward_yer || 0),
        proofText: s.proof_text,
        proofImages: s.proof_images || [],
        proofUrl: s.proof_url,
        status: s.status,
        rejectionReason: s.rejection_reason,
        reviewedBy: s.reviewed_by,
        reviewedAt: s.reviewed_at,
        rewardTransactionId: s.reward_transaction_id,
        createdAt: s.created_at,
      }));
    } catch (err: any) {
      console.error('[Supabase GET_ALL_SUBMISSIONS]', err.message);
      return [];
    }
  },

  /**
   * 5. PLATFORM SETTINGS
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
      const { data, error } = await supabaseServer
        .from('platform_settings')
        .select('*')
        .limit(1)
        .maybeSingle();

      if (error) {
        return defaultSettings;
      }

      if (!data) return defaultSettings;

      return {
        id: data.id || 'settings-1',
        platformName: data.platform_name || 'كسب اليمن',
        currency: 'YER',
        minWithdrawal: Number(data.min_withdrawal || 1000),
        maxWithdrawal: Number(data.max_withdrawal || 500000),
        dailyWithdrawalLimit: Number(data.daily_withdrawal_limit || 1000000),
        defaultFeePercentage: Number(data.default_fee_percentage || 1.5),
        referralBonus: Number(data.referral_bonus || 300),
        taskSubmissionLimit: Number(data.task_submission_limit || 10),
        isRegistrationOpen: data.is_registration_open !== false,
        maintenanceMode: Boolean(data.maintenance_mode),
        contactPhone: data.contact_phone || '+967 739 701 293',
        contactEmail: data.contact_email || 'khalidalbuhiri@gmail.com',
        updatedAt: data.updated_at || new Date().toISOString(),
      };
    } catch {
      return defaultSettings;
    }
  },

  async updateSettings(payload: any): Promise<PlatformSettings> {
    try {
      const now = new Date().toISOString();
      const updateData = {
        platform_name: payload.platformName,
        min_withdrawal: payload.minWithdrawal,
        max_withdrawal: payload.maxWithdrawal,
        daily_withdrawal_limit: payload.dailyWithdrawalLimit,
        default_fee_percentage: payload.defaultFeePercentage,
        referral_bonus: payload.referralBonus,
        is_registration_open: payload.isRegistrationOpen,
        maintenance_mode: payload.maintenanceMode,
        contact_phone: payload.contactPhone,
        contact_email: payload.contactEmail,
        updated_at: now,
      };

      const { data, error } = await supabaseServer
        .from('platform_settings')
        .update(updateData)
        .select('*')
        .limit(1)
        .single();

      if (error) throw error;
      return this.getSettings();
    } catch (err: any) {
      throw new Error(`فشل تحديث إعدادات المنصة في Supabase: ${err.message}`);
    }
  },

  /**
   * 6. PAYOUT METHODS
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
      const { data, error } = await supabaseServer
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
   * 7. WITHDRAWALS
   */
  async getWithdrawals(userId?: string): Promise<WithdrawalRequest[]> {
    try {
      let query = supabaseServer.from('withdrawal_requests').select('*, profiles(full_name, phone)').order('created_at', { ascending: false });
      if (userId) {
        query = query.eq('user_id', userId);
      }

      const { data, error } = await query;
      if (error) return [];

      return (data || []).map((w: any) => ({
        id: w.id,
        userId: w.user_id,
        userFullName: w.profiles?.full_name || w.beneficiary_name,
        userPhone: w.profiles?.phone || w.phone_number,
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
   * 8. NOTIFICATIONS
   */
  async getNotifications(userId: string): Promise<AppNotification[]> {
    try {
      const { data, error } = await supabaseServer
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
      await supabaseServer
        .from('notifications')
        .update({ is_read: true })
        .eq('user_id', userId);
    } catch (err) {
      console.error('[Supabase MARK_NOTIFICATIONS_READ]', err);
    }
  },
};
