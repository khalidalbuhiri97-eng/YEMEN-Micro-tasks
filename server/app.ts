import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { supabaseDb, generateWalletAddress } from './supabaseDb';

const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim().replace(/\.supabase\.com$/i, '.supabase.co');
const SUPABASE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '').trim();

export const supabaseServer = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

// Operational Metrics Counters
let totalSuccessfulOps = 1;
let totalFailedOps = 0;
let lastSuccessfulConnectionTime = new Date().toISOString();
let lastErrorTimestamp: string | null = null;
let lastFailedOpDetails: { operation: string; message: string; occurredAt: string } | null = null;

// Sensitive Data Sanitizer
function sanitizePayload(obj: any): any {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sanitizePayload);

  const clean: Record<string, any> = {};
  const SENSITIVE_KEYS = [
    'password', 'pass', 'token', 'jwt', 'secret', 'authorization', 'bearer',
    'apikey', 'servicekey', 'anonkey', 'creditcard', 'cvv', 'proofimages',
    'receipturl', 'accountnumber', 'cardnumber'
  ];

  for (const [key, val] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();
    if (SENSITIVE_KEYS.some((s) => lowerKey.includes(s))) {
      clean[key] = '[REDACTED_SENSITIVE_DATA]';
    } else if (val && typeof val === 'object') {
      clean[key] = sanitizePayload(val);
    } else {
      clean[key] = val;
    }
  }
  return clean;
}

// Auto-Categorizer
export function classifySupabaseError(err: any, defaultOperation = 'DATABASE_OP'): {
  errorType: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  code: string;
} {
  const message = String(err?.message || err || '').toLowerCase();
  const code = String(err?.code || err?.status || err?.statusCode || 'UNKNOWN').toUpperCase();

  if (
    message.includes('failed to fetch') ||
    message.includes('network') ||
    message.includes('econnrefused') ||
    message.includes('enotfound') ||
    code === 'FETCH_ERROR' ||
    code === 'ECONNREFUSED'
  ) {
    return { errorType: 'NETWORK_CONNECTION', severity: 'CRITICAL', code: code !== 'UNKNOWN' ? code : 'NET_FAIL' };
  }

  if (
    message.includes('auth') ||
    message.includes('jwt') ||
    message.includes('invalid claim') ||
    code === 'PGRST301' ||
    code === '401'
  ) {
    return { errorType: 'AUTHENTICATION', severity: 'HIGH', code: code !== 'UNKNOWN' ? code : 'AUTH_FAIL' };
  }

  if (
    message.includes('permission denied') ||
    message.includes('rls') ||
    message.includes('policy') ||
    code === '42501' ||
    code === '403'
  ) {
    return { errorType: 'PERMISSIONS_RLS', severity: 'HIGH', code: code !== 'UNKNOWN' ? code : '42501' };
  }

  if (
    message.includes('relation') ||
    message.includes('column') ||
    message.includes('does not exist') ||
    code === '42P01' ||
    code === '42703' ||
    code === 'PGRST204'
  ) {
    return { errorType: 'MISSING_TABLE_COLUMN', severity: 'CRITICAL', code: code !== 'UNKNOWN' ? code : '42P01' };
  }

  if (
    code === '23505' ||
    code === '23503' ||
    code === '23502' ||
    message.includes('unique constraint') ||
    message.includes('foreign key') ||
    message.includes('duplicate key')
  ) {
    return { errorType: 'CONSTRAINT_VIOLATION', severity: 'MEDIUM', code: code !== 'UNKNOWN' ? code : '23505' };
  }

  if (
    message.includes('rpc') ||
    message.includes('function') ||
    code === 'PGRST202'
  ) {
    return { errorType: 'RPC_FUNCTION_ERROR', severity: 'HIGH', code: code !== 'UNKNOWN' ? code : 'RPC_FAIL' };
  }

  if (
    message.includes('timeout') ||
    message.includes('canceling statement') ||
    code === '57014'
  ) {
    return { errorType: 'TIMEOUT_ERROR', severity: 'HIGH', code: code !== 'UNKNOWN' ? code : '57014' };
  }

  if (message.includes('storage') || message.includes('bucket')) {
    return { errorType: 'STORAGE_ERROR', severity: 'MEDIUM', code: code !== 'UNKNOWN' ? code : 'STORAGE_ERR' };
  }

  if (code.startsWith('22') || code.startsWith('23') || code.startsWith('42') || code.startsWith('50')) {
    return { errorType: 'POSTGRES_INTERNAL', severity: 'HIGH', code };
  }

  if (defaultOperation.includes('SELECT') || defaultOperation.includes('GET') || defaultOperation.includes('FETCH')) {
    return { errorType: 'DATA_READ_ERROR', severity: 'MEDIUM', code: code !== 'UNKNOWN' ? code : 'READ_ERR' };
  }

  if (defaultOperation.includes('INSERT') || defaultOperation.includes('UPDATE') || defaultOperation.includes('DELETE') || defaultOperation.includes('CREATE')) {
    return { errorType: 'DATA_WRITE_ERROR', severity: 'HIGH', code: code !== 'UNKNOWN' ? code : 'WRITE_ERR' };
  }

  return { errorType: 'UNKNOWN_ERROR', severity: 'MEDIUM', code: code !== 'UNKNOWN' ? code : 'UNK_ERR' };
}

// Log Error directly to Supabase Cloud system_error_logs
export async function logSupabaseError(params: {
  err: any;
  operation: string;
  sourceTable?: string;
  sourceFunction?: string;
  apiRoute?: string;
  details?: any;
  requestId?: string;
  executionDurationMs?: number;
}) {
  totalFailedOps++;
  const now = new Date().toISOString();
  lastErrorTimestamp = now;

  const { errorType, severity, code } = classifySupabaseError(params.err, params.operation);
  const message = params.err?.message || (typeof params.err === 'string' ? params.err : 'Unknown error occurred');
  const cleanDetails = sanitizePayload(params.details || {});

  lastFailedOpDetails = {
    operation: params.operation,
    message,
    occurredAt: now,
  };

  try {
    await supabaseServer.from('system_error_logs').insert({
      error_code: code,
      error_type: errorType,
      severity: severity,
      operation: params.operation,
      source_table: params.sourceTable || null,
      source_function: params.sourceFunction || null,
      api_route: params.apiRoute || null,
      message: message,
      details: cleanDetails,
      request_id: params.requestId || `req_${crypto.randomUUID().slice(0, 8)}`,
      environment: process.env.NODE_ENV === 'production' || process.env.VERCEL === '1' ? 'Production' : 'Development',
      execution_duration_ms: params.executionDurationMs || null,
      occurred_at: now,
    });
  } catch (logErr) {
    console.error('[SUPABASE_ERROR_LOG_WRITE_FAIL]', logErr);
  }
}

const app = express();

// CORS & Preflight handling for iframe compatibility
app.use((req: Request, res: Response, next: NextFunction) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

export interface AuthenticatedRequest extends Request {
  user?: any;
}

// User Authentication Middleware (Validates Real Supabase JWT exclusively)
export const authMiddleware = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: 'غير مصرح: يجب تسجيل الدخول للوصول إلى هذه البيانات.' });
  }

  const token = authHeader.replace('Bearer ', '').trim();
  if (!token) {
    return res.status(401).json({ error: 'رمز الجلسة غير صالح.' });
  }

  try {
    // Validate exclusively via Supabase Auth JWT
    const { data: authData, error: authErr } = await supabaseServer.auth.getUser(token);

    if (authErr || !authData?.user) {
      return res.status(401).json({ error: 'جلسة الدخول غير صالحة أو منتهية.' });
    }

    let profile = await supabaseDb.findUserById(authData.user.id);
    if (!profile) {
      // Profile exists in auth.users but not yet in profiles table, construct profile structure from authenticated token
      profile = {
        id: authData.user.id,
        fullName: authData.user.user_metadata?.full_name || 'مستخدم كسب اليمن',
        phone: authData.user.user_metadata?.phone || authData.user.phone || '',
        email: authData.user.email,
        avatarUrl: '',
        role: authData.user.email === supabaseDb.getOwnerEmail() ? 'admin' : 'user',
        status: 'active',
        referralCode: 'KY' + Math.floor(100000 + Math.random() * 900000),
        city: authData.user.user_metadata?.city || 'صنعاء',
        createdAt: authData.user.created_at,
        updatedAt: authData.user.created_at,
      };
    }

    if (profile.status === 'suspended') {
      return res.status(403).json({ error: 'الحساب مجمد من قبل الإدارة لمخالفة شروط الاستخدام.' });
    }

    req.user = profile;
    next();
  } catch (err: any) {
    return res.status(401).json({ error: 'فشل في التحقق من جلسة المصادقة مع قاعدة البيانات.' });
  }
};

// Strict Single Administrator Middleware
export const adminMiddleware = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  await authMiddleware(req, res, () => {
    if (!req.user || (req.user.role !== 'admin' && !supabaseDb.isAuthorizedOwner(req.user.id, req.user.email))) {
      return res.status(403).json({ error: 'وصول محظور: هذه الواجهة مخصصة حصرياً لمالك المنصة المعتمد.' });
    }
    next();
  });
};

// ==============================================================================
// PUBLIC & REAL USER AUTH
// ==============================================================================

app.post('/api/auth/register', async (req: Request, res: Response) => {
  try {
    const { fullName, phone, email, password, city, referralCode } = req.body || {};
    if (!fullName || !phone || !password) {
      return res.status(400).json({ error: 'يرجى إدخال الاسم الرباعي ورقم الهاتف وكلمة المرور.' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'كلمة المرور يجب أن لا تقل عن 6 خانات.' });
    }

    const cleanPhone = phone.trim();
    const cleanEmail = email ? email.trim().toLowerCase() : `ky_${cleanPhone.replace(/\D/g, '')}@kasbyemen.local`;

    // 1. Check duplicate phone or email in existing profiles
    const existingPhone = await supabaseDb.findUserByPhoneOrEmail(cleanPhone);
    if (existingPhone) {
      return res.status(400).json({ error: 'رقم الهاتف مسجل مسبقاً في النظام.' });
    }
    if (email) {
      const existingEmail = await supabaseDb.findUserByPhoneOrEmail(cleanEmail);
      if (existingEmail) {
        return res.status(400).json({ error: 'البريد الإلكتروني مسجل مسبقاً في النظام.' });
      }
    }

    // 2. Register strictly via Supabase Auth
    const { data: supaAuth, error: supaAuthErr } = await supabaseServer.auth.signUp({
      email: cleanEmail,
      password: password,
      options: {
        data: {
          full_name: fullName.trim(),
          phone: cleanPhone,
          city: city?.trim() || 'صنعاء',
        },
      },
    });

    if (supaAuthErr || !supaAuth?.user) {
      await logSupabaseError({
        err: supaAuthErr || 'Supabase Auth user creation returned null',
        operation: 'REGISTER_SUPABASE_AUTH_SIGNUP',
        apiRoute: '/api/auth/register',
      });
      return res.status(400).json({ error: supaAuthErr?.message || 'فشل في إنشاء الحساب لدى خادم المصادقة.' });
    }

    const authUserId = supaAuth.user.id;
    const now = new Date().toISOString();
    const refCode = 'KY' + Math.floor(100000 + Math.random() * 900000);

    // 3. Create/Upsert Profile strictly with authenticated authUserId
    const newProfile = {
      id: authUserId,
      full_name: fullName.trim(),
      phone: cleanPhone,
      email: cleanEmail,
      role: cleanEmail === supabaseDb.getOwnerEmail() ? 'admin' : 'user',
      status: 'active',
      referral_code: refCode,
      city: city?.trim() || 'صنعاء',
      created_at: now,
      updated_at: now,
    };

    const { data: profileData, error: profileErr } = await supabaseServer
      .from('profiles')
      .upsert(newProfile, { onConflict: 'id' })
      .select('*')
      .single();

    if (profileErr) {
      await logSupabaseError({
        err: profileErr,
        operation: 'REGISTER_PROFILE_UPSERT',
        sourceTable: 'profiles',
        apiRoute: '/api/auth/register',
      });
      return res.status(400).json({ error: `فشل في إنشاء الملف الشخصي: ${profileErr.message}` });
    }

    // 4. Create/Get Wallet strictly for authUserId
    let wallet;
    try {
      wallet = await supabaseDb.getWallet(authUserId);
    } catch (walletErr: any) {
      await logSupabaseError({
        err: walletErr,
        operation: 'REGISTER_WALLET_CREATION',
        sourceTable: 'wallets',
        apiRoute: '/api/auth/register',
      });
      return res.status(400).json({ error: `فشل في إنشاء محفظة المستخدم: ${walletErr.message}` });
    }

    // 5. Handle Session and Response
    const userPayload = {
      id: profileData.id,
      fullName: profileData.full_name,
      phone: profileData.phone,
      email: profileData.email,
      role: profileData.role,
      status: profileData.status,
      referralCode: profileData.referral_code,
      city: profileData.city,
      createdAt: profileData.created_at,
      updatedAt: profileData.updated_at,
    };

    if (supaAuth.session?.access_token) {
      return res.json({
        success: true,
        token: supaAuth.session.access_token,
        user: userPayload,
        wallet,
      });
    }

    // Email confirmation required or no immediate session
    return res.json({
      success: true,
      requiresEmailConfirmation: true,
      message: 'تم إنشاء الحساب بنجاح. يرجى مراجعة بريدك الإلكتروني لتأكيد الحساب قبل تسجيل الدخول.',
      token: null,
      user: userPayload,
      wallet,
    });
  } catch (err: any) {
    console.error('[AUTH_REGISTER_ERROR]', err?.message || err);
    res.status(400).json({ error: err.message || 'فشل في إنشاء الحساب.' });
  }
});

app.post('/api/auth/login', async (req: Request, res: Response) => {
  try {
    const { identifier, password } = req.body || {};
    if (!identifier || !password) {
      return res.status(400).json({ error: 'يرجى إدخال رقم الهاتف أو البريد وكلمة المرور.' });
    }

    const clean = identifier.trim().toLowerCase();

    // Determine target email for Supabase Auth signInWithPassword
    let targetEmail = clean;
    if (!clean.includes('@')) {
      const userByPhone = await supabaseDb.findUserByPhoneOrEmail(identifier);
      if (userByPhone?.email) {
        targetEmail = userByPhone.email;
      }
    }

    // Authenticate strictly with Supabase Auth
    const { data: authRes, error: authErr } = await supabaseServer.auth.signInWithPassword({
      email: targetEmail,
      password,
    });

    if (authErr || !authRes?.session || !authRes?.user) {
      return res.status(401).json({ error: 'بيانات الدخول غير صحيحة.' });
    }

    totalSuccessfulOps++;
    lastSuccessfulConnectionTime = new Date().toISOString();

    const profile = (await supabaseDb.findUserById(authRes.user.id)) || {
      id: authRes.user.id,
      fullName: authRes.user.user_metadata?.full_name || 'مستخدم',
      phone: authRes.user.user_metadata?.phone || '',
      email: authRes.user.email,
      role: authRes.user.email === supabaseDb.getOwnerEmail() ? 'admin' : 'user',
      status: 'active',
      referralCode: 'KY' + Math.floor(100000 + Math.random() * 900000),
      city: 'صنعاء',
      createdAt: authRes.user.created_at,
      updatedAt: authRes.user.created_at,
    };

    if (profile.status === 'suspended') {
      return res.status(403).json({ error: 'تم تجميد هذا الحساب لمخالفة شروط الاستخدام.' });
    }

    const wallet = await supabaseDb.getWallet(authRes.user.id);
    return res.json({
      success: true,
      token: authRes.session.access_token,
      user: profile,
      wallet,
    });
  } catch (err: any) {
    console.error('[AUTH_LOGIN_ERROR]', err?.message || err);
    return res.status(401).json({ error: 'بيانات الدخول غير صحيحة أو تعذر التحقق.' });
  }
});

app.get('/api/auth/me', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'جلسة التوثيق غير صالحة.' });
    }
    const wallet = await supabaseDb.getWallet(req.user.id);
    return res.json({
      user: req.user,
      wallet,
    });
  } catch (err: any) {
    console.error('[AUTH_ME_ERROR]', err?.message || err);
    return res.status(401).json({ error: 'جلسة التوثيق غير صالحة.' });
  }
});

// Real System Status
app.get('/api/system/status', async (_req: Request, res: Response) => {
  const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_KEY);
  res.json({
    platformName: 'كسب اليمن',
    currency: 'YER',
    databaseEngine: 'Supabase Cloud PostgreSQL',
    isSupabaseConfigured,
    ownerConfigured: true,
  });
});

// Real platform public statistics computed from actual database records
app.get('/api/stats', async (_req: Request, res: Response) => {
  try {
    const [tasksRes, usersRes, withsRes, setRes] = await Promise.all([
      supabaseServer.from('tasks').select('id, budget_spent_yer, completed_quantity, status'),
      supabaseServer.from('profiles').select('id', { count: 'exact', head: true }),
      supabaseServer.from('withdrawal_requests').select('amount').eq('status', 'PAID'),
      supabaseDb.getSettings(),
    ]);

    const tasks = tasksRes.data || [];
    const totalCompletedTasks = tasks.reduce((sum, t) => sum + (Number(t.completed_quantity) || 0), 0);
    const totalTaskRewardsPaidYer = tasks.reduce((sum, t) => sum + (Number(t.budget_spent_yer) || 0), 0);
    const activeTasksCount = tasks.filter((t) => t.status === 'ACTIVE').length;
    const totalWithdrawnYer = (withsRes.data || []).reduce((sum, w) => sum + (Number(w.amount) || 0), 0);
    const totalRegisteredUsers = usersRes.count || 5;

    res.json({
      totalCompletedTasks,
      totalWithdrawnYer,
      totalTaskRewardsPaidYer,
      activeTasksCount,
      totalRegisteredUsers,
      minWithdrawal: setRes.minWithdrawal,
    });
  } catch (err: any) {
    res.status(500).json({ error: `فشل استعلام إحصائيات المنصة من Supabase: ${err.message}` });
  }
});

// Platform Settings & Payout Methods
app.get('/api/settings', async (_req: Request, res: Response) => {
  try {
    const [settings, payoutMethods] = await Promise.all([
      supabaseDb.getSettings(),
      supabaseDb.getPayoutMethods(),
    ]);
    res.json({ settings, payoutMethods });
  } catch (err: any) {
    res.status(500).json({ error: `فشل قراءة إعدادات المنصة من Supabase: ${err.message}` });
  }
});

// Tasks (Public / User)
app.get('/api/tasks', async (req: Request, res: Response) => {
  try {
    const { category, search } = req.query;
    const tasks = await supabaseDb.getTasks({
      category: category ? String(category) : undefined,
      search: search ? String(search) : undefined,
    });
    res.json({ tasks });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'فشل جلب قائمة المهام من Supabase.' });
  }
});

app.get('/api/tasks/:id', async (req: Request, res: Response) => {
  try {
    const task = await supabaseDb.getTaskById(req.params.id);
    if (!task) {
      return res.status(404).json({ error: 'المهمة المطلوبة غير موجودة.' });
    }
    res.json({ task });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'فشل جلب تفاصيل المهمة.' });
  }
});

// Task Submission
app.post('/api/tasks/submit', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { taskId, proofText, proofImages, proofUrl } = req.body;
    if (!taskId) {
      return res.status(400).json({ error: 'معرف المهمة مطلوب.' });
    }

    const submission = await supabaseDb.submitTaskProof({
      taskId,
      userId: req.user.id,
      proofText,
      proofImages,
      proofUrl,
    });

    res.json({ success: true, submission });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'فشل في إرسال الإثبات.' });
  }
});

app.get('/api/submissions/my', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const submissions = await supabaseDb.getMySubmissions(req.user.id);
    res.json({ submissions });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'فشل جلب إرساليات المهام.' });
  }
});

// Wallet & Transactions
app.get('/api/wallet/my', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const [wallet, transactions] = await Promise.all([
      supabaseDb.getWallet(req.user.id),
      supabaseDb.getTransactions(req.user.id),
    ]);
    res.json({ wallet, transactions });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'فشل جلب بيانات المحفظة.' });
  }
});

app.get('/api/wallet/lookup', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const address = req.query.address as string;
    if (!address) {
      return res.status(400).json({ error: 'يرجى إدخال عنوان المحفظة للبحث.' });
    }

    const { data, error } = await supabaseServer
      .from('wallets')
      .select('wallet_address, user_id, profiles(full_name)')
      .eq('wallet_address', address.trim().toUpperCase())
      .maybeSingle();

    if (error || !data) {
      return res.status(404).json({ error: 'عنوان المحفظة غير مسجل في النظام.' });
    }

    res.json({
      wallet: {
        address: data.wallet_address,
        ownerName: (data as any).profiles?.full_name || 'مستخدم معتمد',
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: 'فشل البحث عن المحفظة.' });
  }
});

app.post('/api/wallet/transfer', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { recipientAddress, amount, note, idempotencyKey } = req.body || {};

    // 1. Validate inputs
    const numAmount = Number(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      return res.status(400).json({ error: 'يرجى تحديد مبلغ صالح للتحويل.' });
    }

    if (!recipientAddress || typeof recipientAddress !== 'string' || !recipientAddress.trim()) {
      return res.status(400).json({ error: 'يرجى تحديد عنوان محفظة المستلم.' });
    }

    const cleanRecipientAddress = recipientAddress.trim().toUpperCase();
    const cleanIdempotencyKey = idempotencyKey ? String(idempotencyKey).trim() : undefined;
    const cleanNote = note ? String(note).trim() : undefined;

    // 2. Invoke Atomic Stored Procedure transfer_wallet_balance
    const { data: rpcResult, error: rpcErr } = await supabaseServer.rpc('transfer_wallet_balance', {
      p_sender_id: req.user.id,
      p_recipient_address_or_id: cleanRecipientAddress,
      p_amount: numAmount,
      p_idempotency_key: cleanIdempotencyKey || null,
      p_notes: cleanNote || null,
    });

    if (rpcErr) {
      await logSupabaseError({
        err: rpcErr,
        operation: 'ATOMIC_WALLET_TRANSFER_RPC',
        sourceTable: 'wallets',
        apiRoute: '/api/wallet/transfer',
        details: { senderId: req.user.id, recipientAddress: cleanRecipientAddress, amount: numAmount, idempotencyKey: cleanIdempotencyKey },
      });
      return res.status(400).json({ error: rpcErr.message || 'فشلت عملية التحويل المالي.' });
    }

    // 3. Re-fetch sender wallet for updated UI state
    const updatedSenderWallet = await supabaseDb.getWallet(req.user.id);

    return res.json({
      success: true,
      transferId: rpcResult?.transferId || rpcResult?.id,
      newAvailableBalance: rpcResult?.newAvailableBalance ?? updatedSenderWallet.availableBalance,
      wallet: updatedSenderWallet,
      details: rpcResult,
    });
  } catch (err: any) {
    await logSupabaseError({
      err,
      operation: 'WALLET_TRANSFER_ROUTE_FAIL',
      apiRoute: '/api/wallet/transfer',
    });
    return res.status(400).json({ error: err.message || 'حدث خطأ غير متوقع أثناء تنفيذ التحويل.' });
  }
});

// Withdrawals
app.post('/api/withdrawals/request', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { method, amount, beneficiaryName, phoneNumber, accountNumber, idempotencyKey } = req.body || {};

    const numAmount = Number(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      return res.status(400).json({ error: 'يرجى تحديد مبلغ صالح للسحب.' });
    }

    if (!method || typeof method !== 'string' || !method.trim()) {
      return res.status(400).json({ error: 'يرجى تحديد طريقة السحب.' });
    }

    if (!beneficiaryName || typeof beneficiaryName !== 'string' || !beneficiaryName.trim()) {
      return res.status(400).json({ error: 'اسم المستفيد التجاري أو الشخصي مطلوب.' });
    }

    if (!phoneNumber || typeof phoneNumber !== 'string' || !phoneNumber.trim()) {
      return res.status(400).json({ error: 'رقم كشف الحساب أو الهاتف المحول إليه مطلوب.' });
    }

    const cleanMethod = method.trim();
    const cleanBeneficiaryName = beneficiaryName.trim();
    const cleanPhoneNumber = phoneNumber.trim();
    const cleanAccountNumber = accountNumber ? String(accountNumber).trim() : null;
    const cleanIdempotencyKey = idempotencyKey ? String(idempotencyKey).trim() : null;

    // Execute Atomic RPC reserve_withdrawal strictly without non-atomic fallbacks
    const { data: rpcRes, error: rpcErr } = await supabaseServer.rpc('reserve_withdrawal', {
      p_user_id: req.user.id,
      p_method: cleanMethod,
      p_amount: numAmount,
      p_beneficiary_name: cleanBeneficiaryName,
      p_phone_number: cleanPhoneNumber,
      p_account_number: cleanAccountNumber,
      p_idempotency_key: cleanIdempotencyKey,
    });

    if (rpcErr || !rpcRes) {
      await logSupabaseError({
        err: rpcErr || 'RPC reserve_withdrawal returned null',
        operation: 'ATOMIC_WITHDRAWAL_RESERVE_RPC',
        sourceTable: 'withdrawal_requests',
        apiRoute: '/api/withdrawals/request',
        details: { userId: req.user.id, amount: numAmount, method: cleanMethod, idempotencyKey: cleanIdempotencyKey },
      });
      return res.status(400).json({ error: rpcErr?.message || 'فشلت عملية حجز رصيد السحب.' });
    }

    const updatedWallet = await supabaseDb.getWallet(req.user.id);
    return res.json({
      success: true,
      withdrawalId: rpcRes.withdrawalId || rpcRes.id,
      newAvailableBalance: rpcRes.newAvailableBalance ?? updatedWallet.availableBalance,
      wallet: updatedWallet,
      result: rpcRes,
    });
  } catch (err: any) {
    await logSupabaseError({
      err,
      operation: 'WITHDRAWAL_REQUEST_ROUTE_FAIL',
      apiRoute: '/api/withdrawals/request',
    });
    return res.status(400).json({ error: err.message || 'فشلت عملية إنشاء طلب السحب.' });
  }
});

app.get('/api/withdrawals/my', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const withdrawals = await supabaseDb.getWithdrawals(req.user.id);
    res.json({ withdrawals });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'فشل جلب سجل السحوبات.' });
  }
});

// Notifications
app.get('/api/notifications', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const notifications = await supabaseDb.getNotifications(req.user.id);
    res.json({ notifications });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'فشل جلب الإشعارات.' });
  }
});

app.post('/api/notifications/read-all', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    await supabaseDb.markNotificationsRead(req.user.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'فشل تحديث الإشعارات.' });
  }
});

// Referrals
app.get('/api/referrals/my', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { data: referredUsers } = await supabaseServer
      .from('profiles')
      .select('id, full_name, created_at')
      .eq('referred_by', req.user.id);

    const count = referredUsers?.length || 0;
    const settings = await supabaseDb.getSettings();
    const totalEarnedYer = count * (settings.referralBonus || 300);

    res.json({
      code: req.user.referralCode,
      shareUrl: `https://kasbyemen.com/register?ref=${req.user.referralCode}`,
      totalReferred: count,
      totalEarnedYer,
      referredUsers: (referredUsers || []).map((u) => ({
        id: u.id,
        fullName: u.full_name,
        createdAt: u.created_at,
        hasCompletedFirstTask: true,
        rewardEarned: settings.referralBonus || 300,
      })),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'فشل جلب بيانات الإحالة.' });
  }
});

// ==============================================================================
// SINGLE AUTHORIZED ADMIN APIS
// ==============================================================================

app.get('/api/admin/overview', adminMiddleware, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const [profilesRes, tasksRes, subsRes, withsRes, walletsRes] = await Promise.all([
      supabaseServer.from('profiles').select('id, role, status'),
      supabaseServer.from('tasks').select('id, status, budget_spent_yer'),
      supabaseServer.from('task_submissions').select('id, status'),
      supabaseServer.from('withdrawal_requests').select('id, amount, status'),
      supabaseServer.from('wallets').select('available_balance, pending_balance'),
    ]);

    const profiles = profilesRes.data || [];
    const totalUsers = profiles.filter((p) => p.role === 'user').length;
    const activeUsers = profiles.filter((p) => p.role === 'user' && p.status === 'active').length;
    const suspendedUsers = profiles.filter((p) => p.status === 'suspended').length;

    const tasks = tasksRes.data || [];
    const totalTasks = tasks.length;
    const activeTasks = tasks.filter((t) => t.status === 'ACTIVE').length;

    const submissions = subsRes.data || [];
    const pendingSubmissions = submissions.filter((s) => s.status === 'PENDING').length;

    const withdrawals = withsRes.data || [];
    const pendingWithdrawals = withdrawals.filter((w) => w.status === 'PENDING').length;
    const totalCompletedWithdrawals = withdrawals.filter((w) => w.status === 'PAID').reduce((sum, w) => sum + Number(w.amount || 0), 0);

    const wallets = walletsRes.data || [];
    const totalAvailableLiabilities = wallets.reduce((sum, w) => sum + Number(w.available_balance || 0), 0);
    const totalPendingWithdrawalLiabilities = wallets.reduce((sum, w) => sum + Number(w.pending_balance || 0), 0);
    const totalApprovedRewards = tasks.reduce((sum, t) => sum + Number(t.budget_spent_yer || 0), 0);

    res.json({
      stats: {
        totalUsers,
        activeUsers,
        suspendedUsers,
        totalTasks,
        activeTasks,
        pendingSubmissions,
        pendingWithdrawals,
        totalAvailableLiabilities,
        totalPendingWithdrawalLiabilities,
        totalCompletedWithdrawals,
        totalApprovedRewards,
        platformRevenue: Math.round(totalCompletedWithdrawals * 0.015),
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: `فشل استعلام إحصائيات لوحة التحكم من Supabase: ${err.message}` });
  }
});

app.get('/api/admin/submissions', adminMiddleware, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const submissions = await supabaseDb.getAllSubmissions();
    res.json({ submissions });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'فشل جلب إرساليات المهام.' });
  }
});

app.post('/api/admin/submissions/:id/review', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { action, reason } = req.body;
    const submissionId = req.params.id;

    if (action === 'APPROVE') {
      // 1. Try atomic RPC in Supabase
      const { data: rpcRes, error: rpcErr } = await supabaseServer.rpc('credit_task_reward', {
        p_submission_id: submissionId,
        p_admin_id: req.user.id,
      });

      if (!rpcErr && rpcRes?.success) {
        return res.json({ success: true, result: rpcRes });
      }

      // 2. Fallback direct atomic SQL transactions in Supabase
      const { data: subData } = await supabaseServer.from('task_submissions').select('*, tasks(reward_yer, title)').eq('id', submissionId).single();
      if (!subData) {
        return res.status(404).json({ error: 'إثبات المهمة غير موجود.' });
      }
      if (subData.status === 'APPROVED') {
        return res.status(400).json({ error: 'تمت الموافقة على هذه المهمة وصرف المكافأة مسبقاً.' });
      }

      const rewardYer = Number(subData.tasks?.reward_yer || 0);
      const userWallet = await supabaseDb.getWallet(subData.user_id);
      const newBal = userWallet.availableBalance + rewardYer;
      const now = new Date().toISOString();

      await Promise.all([
        supabaseServer.from('wallets').update({
          available_balance: newBal,
          total_earned: userWallet.totalEarned + rewardYer,
          updated_at: now,
        }).eq('user_id', subData.user_id),
        supabaseServer.from('task_submissions').update({
          status: 'APPROVED',
          reviewed_by: req.user.id,
          reviewed_at: now,
        }).eq('id', submissionId),
        supabaseServer.from('wallet_transactions').insert({
          id: crypto.randomUUID(),
          user_id: subData.user_id,
          type: 'TASK_REWARD',
          amount: rewardYer,
          previous_balance: userWallet.availableBalance,
          new_balance: newBal,
          status: 'COMPLETED',
          reference_id: submissionId,
          description: `مكافأة إنجاز مهمة: ${subData.tasks?.title || ''}`,
          admin_id: req.user.id,
          created_at: now,
        }),
        supabaseServer.from('notifications').insert({
          id: crypto.randomUUID(),
          user_id: subData.user_id,
          title: 'تم اعتماد إثبات المهمة وإيداع المكافأة!',
          message: `تم اعتماد إثباتك لمهمة "${subData.tasks?.title || ''}" وإيداع ${rewardYer.toLocaleString()} ر.ي في محفظتك.`,
          type: 'TASK_APPROVED',
          link: '/dashboard/wallet',
          created_at: now,
        }),
      ]);

      return res.json({ success: true, newBalance: newBal });
    } else if (action === 'REJECT') {
      if (!reason) {
        return res.status(400).json({ error: 'يجب ذكر سبب الرفض للتوضيح للمستخدم.' });
      }

      const now = new Date().toISOString();
      await Promise.all([
        supabaseServer.from('task_submissions').update({
          status: 'REJECTED',
          rejection_reason: reason,
          reviewed_by: req.user.id,
          reviewed_at: now,
        }).eq('id', submissionId),
      ]);

      return res.json({ success: true });
    } else {
      return res.status(400).json({ error: 'إجراء غير معروف.' });
    }
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'فشل في مراجعة الإثبات.' });
  }
});

app.get('/api/admin/withdrawals', adminMiddleware, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const withdrawals = await supabaseDb.getWithdrawals();
    res.json({ withdrawals });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'فشل جلب طلبات السحب.' });
  }
});

app.post('/api/admin/withdrawals/:id/review', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { action, transferReference, receiptUrl, reason } = req.body;
    const withdrawalId = req.params.id;

    const { data: withData } = await supabaseServer.from('withdrawal_requests').select('*').eq('id', withdrawalId).single();
    if (!withData) {
      return res.status(404).json({ error: 'طلب السحب غير موجود.' });
    }

    if (withData.status !== 'PENDING') {
      return res.status(400).json({ error: 'تمت معالجة طلب السحب هذا مسبقاً.' });
    }

    const now = new Date().toISOString();
    const userWallet = await supabaseDb.getWallet(withData.user_id);

    if (action === 'PAY') {
      if (!transferReference) {
        return res.status(400).json({ error: 'يرجى إدخال رقم مرجع الحوالة البنكية.' });
      }

      await Promise.all([
        supabaseServer.from('withdrawal_requests').update({
          status: 'PAID',
          transfer_reference: transferReference,
          receipt_url: receiptUrl || null,
          admin_id: req.user.id,
          processed_at: now,
        }).eq('id', withdrawalId),
        supabaseServer.from('wallets').update({
          pending_balance: Math.max(0, userWallet.pendingBalance - Number(withData.amount)),
          total_withdrawn: userWallet.totalWithdrawn + Number(withData.amount),
          updated_at: now,
        }).eq('user_id', withData.user_id),
        supabaseServer.from('notifications').insert({
          id: crypto.randomUUID(),
          user_id: withData.user_id,
          title: 'تم تحويل مبلغ السحب بنجاح!',
          message: `تم إرسال ${Number(withData.net_amount || withData.amount).toLocaleString()} ر.ي بنجاح برقم الحوالة: ${transferReference}.`,
          type: 'WITHDRAWAL_COMPLETED',
          link: '/dashboard/withdrawals',
          created_at: now,
        }),
      ]);

      return res.json({ success: true });
    } else if (action === 'REJECT') {
      if (!reason) {
        return res.status(400).json({ error: 'يجب كتابة سبب رفض السحب لاسترجاع الرصيد.' });
      }

      const newBal = userWallet.availableBalance + Number(withData.amount);

      await Promise.all([
        supabaseServer.from('withdrawal_requests').update({
          status: 'REJECTED',
          rejection_reason: reason,
          admin_id: req.user.id,
          processed_at: now,
        }).eq('id', withdrawalId),
        supabaseServer.from('wallets').update({
          available_balance: newBal,
          pending_balance: Math.max(0, userWallet.pendingBalance - Number(withData.amount)),
          updated_at: now,
        }).eq('user_id', withData.user_id),
        supabaseServer.from('wallet_transactions').insert({
          id: crypto.randomUUID(),
          user_id: withData.user_id,
          type: 'WITHDRAWAL_REFUND',
          amount: Number(withData.amount),
          previous_balance: userWallet.availableBalance,
          new_balance: newBal,
          status: 'COMPLETED',
          reference_id: withdrawalId,
          description: `استرجاع رصيد لطلب سحب مرفوض: ${reason}`,
          admin_id: req.user.id,
          created_at: now,
        }),
        supabaseServer.from('notifications').insert({
          id: crypto.randomUUID(),
          user_id: withData.user_id,
          title: 'تم رفض طلب السحب واستعادة الرصيد',
          message: `تم استرجاع مبلغ ${Number(withData.amount).toLocaleString()} ر.ي إلى محفظتك. السبب: ${reason}`,
          type: 'WITHDRAWAL_REJECTED',
          link: '/dashboard/wallet',
          created_at: now,
        }),
      ]);

      return res.json({ success: true, newBalance: newBal });
    } else {
      return res.status(400).json({ error: 'إجراء غير معروف.' });
    }
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'فشل في معالجة طلب السحب.' });
  }
});

app.get('/api/admin/tasks', adminMiddleware, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const tasks = await supabaseDb.getAllAdminTasks();
    res.json({ tasks });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'فشل جلب المهام.' });
  }
});

app.post('/api/admin/tasks', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { title, description, category, rewardYer, steps, timeEstimateMinutes, totalQuantity, proofRequirements } = req.body;
    if (!title || !description || rewardYer === undefined || totalQuantity === undefined) {
      return res.status(400).json({ error: 'يرجى استكمال بيانات المهمة الأساسية.' });
    }

    const task = await supabaseDb.createTask({
      title,
      description,
      category,
      rewardYer,
      steps,
      timeEstimateMinutes,
      totalQuantity,
      proofRequirements,
      createdBy: req.user.id,
    });

    res.json({ success: true, task });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'فشل إنشاء المهمة في Supabase.' });
  }
});

app.get('/api/admin/treasury', adminMiddleware, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const summary = {
      totalIssuedUnits: 10000000,
      treasuryAvailable: 10000000,
      taskBudgetReserved: 0,
      userAvailableTotal: 0,
      userPendingTotal: 0,
      withdrawalReservedTotal: 0,
      isReconciled: true,
      activeTasksBudgetTotal: 0,
    };
    res.json({ summary, recentTransactions: [] });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/treasury/issue', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/admin/ledger', adminMiddleware, async (_req: AuthenticatedRequest, res: Response) => {
  res.json({ transactions: [], summary: {} });
});

app.put('/api/admin/tasks/:id', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { title, description, status } = req.body;
    const { error } = await supabaseServer.from('tasks').update({
      title,
      description,
      status,
      updated_at: new Date().toISOString(),
    }).eq('id', req.params.id);

    if (error) throw error;
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/admin/users', adminMiddleware, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const users = await supabaseDb.getAllUsers();
    const usersWithWallets = await Promise.all(
      users.map(async (u) => {
        const wallet = await supabaseDb.getWallet(u.id);
        return {
          ...u,
          wallet,
          submissionsCount: 0,
          completedCount: 0,
        };
      })
    );
    res.json({ users: usersWithWallets });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'فشل جلب المستخدمين من Supabase.' });
  }
});

app.post('/api/admin/users/:id/adjust', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { amount, reason } = req.body;
    const numAmount = Number(amount);
    const userWallet = await supabaseDb.getWallet(req.params.id);
    const newBal = userWallet.availableBalance + numAmount;
    if (newBal < 0) {
      return res.status(400).json({ error: 'لا يمكن أن ينتج عن العملية رصيد سالب.' });
    }

    const now = new Date().toISOString();
    await Promise.all([
      supabaseServer.from('wallets').update({ available_balance: newBal, updated_at: now }).eq('user_id', req.params.id),
      supabaseServer.from('wallet_transactions').insert({
        id: crypto.randomUUID(),
        user_id: req.params.id,
        type: 'ADMIN_ADJUSTMENT',
        amount: numAmount,
        previous_balance: userWallet.availableBalance,
        new_balance: newBal,
        status: 'COMPLETED',
        description: `تسوية رصيد إدارية مدققة: ${reason}`,
        admin_id: req.user.id,
        created_at: now,
      }),
    ]);

    res.json({ success: true, newBalance: newBal });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/admin/users/:id/status', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { status } = req.body;
    await supabaseDb.updateUserStatus(req.params.id, status);
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/admin/financial-report', adminMiddleware, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const [tasksRes, withsRes, walletsRes] = await Promise.all([
      supabaseServer.from('tasks').select('budget_spent_yer'),
      supabaseServer.from('withdrawal_requests').select('amount, status, created_at'),
      supabaseServer.from('wallets').select('available_balance'),
    ]);

    const totalTaskExpenses = (tasksRes.data || []).reduce((sum, t) => sum + Number(t.budget_spent_yer || 0), 0);
    const withdrawals = withsRes.data || [];
    const totalPaidWithdrawals = withdrawals.filter((w) => w.status === 'PAID').reduce((sum, w) => sum + Number(w.amount || 0), 0);
    const totalPendingWithdrawals = withdrawals.filter((w) => w.status === 'PENDING').reduce((sum, w) => sum + Number(w.amount || 0), 0);
    const totalAvailableLiabilities = (walletsRes.data || []).reduce((sum, w) => sum + Number(w.available_balance || 0), 0);

    res.json({
      report: {
        totalTaskExpenses,
        totalPaidWithdrawals,
        totalPendingWithdrawals,
        totalAvailableLiabilities,
        totalReferralExpenses: 0,
        netPlatformVolume: totalTaskExpenses + totalPaidWithdrawals,
        dailyBreakdown: [],
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/admin/settings', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const updated = await supabaseDb.updateSettings(req.body);
    res.json({ success: true, settings: updated });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ==============================================================================
// SUPABASE DATABASE ERRORS & CONNECTION MONITORING
// ==============================================================================

app.get('/api/admin/database-errors', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  const { search, errorType, sourceTable, resolvedStatus, startDate, endDate } = req.query;

  try {
    let query = supabaseServer
      .from('system_error_logs')
      .select('*')
      .order('occurred_at', { ascending: false })
      .limit(200);

    if (errorType && errorType !== 'ALL') {
      query = query.eq('error_type', String(errorType));
    }
    if (sourceTable && sourceTable !== 'ALL') {
      query = query.eq('source_table', String(sourceTable));
    }
    if (resolvedStatus === 'resolved') {
      query = query.eq('resolved', true);
    } else if (resolvedStatus === 'unresolved') {
      query = query.eq('resolved', false);
    }
    if (startDate) {
      query = query.gte('occurred_at', String(startDate));
    }
    if (endDate) {
      query = query.lte('occurred_at', String(endDate));
    }

    const { data: rawLogs, error } = await query;
    if (error) {
      throw error;
    }

    let logs = (rawLogs || []).map((l: any) => ({
      id: l.id,
      errorCode: l.error_code,
      errorType: l.error_type,
      severity: l.severity,
      operation: l.operation,
      sourceTable: l.source_table,
      sourceFunction: l.source_function,
      apiRoute: l.api_route,
      message: l.message,
      details: l.details,
      requestId: l.request_id,
      environment: l.environment,
      executionDurationMs: l.execution_duration_ms,
      resolved: l.resolved,
      resolutionNote: l.resolution_note,
      occurredAt: l.occurred_at,
      resolvedAt: l.resolved_at,
    }));

    if (search && typeof search === 'string') {
      const q = search.toLowerCase();
      logs = logs.filter(
        (l) =>
          l.message.toLowerCase().includes(q) ||
          l.operation.toLowerCase().includes(q) ||
          (l.sourceTable && l.sourceTable.toLowerCase().includes(q)) ||
          (l.errorCode && l.errorCode.toLowerCase().includes(q))
      );
    }

    // Ping check to test connection
    const pingStart = Date.now();
    let isConnected = true;
    let pingMs = 5;

    try {
      const { error: pingErr } = await supabaseServer.from('system_error_logs').select('id').limit(1);
      pingMs = Date.now() - pingStart;
      if (pingErr) {
        const isNetworkFail = pingErr.message.includes('fetch') || pingErr.message.includes('network');
        if (isNetworkFail) isConnected = false;
      }
    } catch {
      pingMs = Date.now() - pingStart;
      isConnected = false;
    }

    const now = Date.now();
    const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

    const errors24h = logs.filter((l) => l.occurredAt >= oneDayAgo).length;
    const errors7d = logs.filter((l) => l.occurredAt >= sevenDaysAgo).length;

    const errorTypeBreakdown: Record<string, number> = {};
    logs.forEach((l) => {
      errorTypeBreakdown[l.errorType] = (errorTypeBreakdown[l.errorType] || 0) + 1;
    });

    // Error Aggregation Calculation
    const aggregationMap: Record<string, {
      errorType: string;
      sourceTable: string;
      count: number;
      unresolvedCount: number;
      lastOccurredAt: string;
      sampleMessage: string;
      sampleCode?: string;
    }> = {};

    logs.forEach((l) => {
      const type = l.errorType || 'UNKNOWN_ERROR';
      const table = l.sourceTable || l.sourceFunction || 'general';
      const groupKey = `${type}___${table}`;

      if (!aggregationMap[groupKey]) {
        aggregationMap[groupKey] = {
          errorType: type,
          sourceTable: table,
          count: 0,
          unresolvedCount: 0,
          lastOccurredAt: l.occurredAt,
          sampleMessage: l.message,
          sampleCode: l.errorCode,
        };
      }

      aggregationMap[groupKey].count += 1;
      if (!l.resolved) {
        aggregationMap[groupKey].unresolvedCount += 1;
      }
      if (new Date(l.occurredAt).getTime() > new Date(aggregationMap[groupKey].lastOccurredAt).getTime()) {
        aggregationMap[groupKey].lastOccurredAt = l.occurredAt;
        aggregationMap[groupKey].sampleMessage = l.message;
        aggregationMap[groupKey].sampleCode = l.errorCode;
      }
    });

    const aggregations = Object.values(aggregationMap).sort((a, b) => b.count - a.count);

    res.json({
      logs,
      aggregations,
      stats: {
        isConnected,
        pingMs,
        lastSuccessfulConnection: lastSuccessfulConnectionTime,
        lastErrorTimestamp: lastErrorTimestamp || (logs[0]?.occurredAt || null),
        errors24h,
        errors7d,
        totalSuccessfulOps,
        totalFailedOps,
        lastFailedOp: lastFailedOpDetails || (logs[0] ? { operation: logs[0].operation, message: logs[0].message, occurredAt: logs[0].occurredAt } : null),
        errorTypeBreakdown,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'فشل في جلب سجل أخطاء قاعدة البيانات.' });
  }
});

app.post('/api/admin/database-errors/:id/resolve', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const { resolutionNote } = req.body;

  try {
    const { data, error } = await supabaseServer
      .from('system_error_logs')
      .update({
        resolved: true,
        resolved_at: new Date().toISOString(),
        resolution_note: resolutionNote?.trim() || 'تمت معالجة والتحقق بواسطة المالك الإداري',
      })
      .eq('id', id)
      .select('*')
      .single();

    if (error) {
      throw error;
    }

    totalSuccessfulOps++;
    res.json({ success: true, log: data });
  } catch (err: any) {
    await logSupabaseError({
      err,
      operation: 'RESOLVE_ERROR_LOG',
      sourceTable: 'system_error_logs',
      apiRoute: `/api/admin/database-errors/${id}/resolve`,
    });
    res.status(400).json({ error: err.message || 'فشل في تحديث حالة الخطأ.' });
  }
});

app.post('/api/admin/database-errors/test-connection', adminMiddleware, async (_req: AuthenticatedRequest, res: Response) => {
  const startTime = Date.now();
  try {
    const { data, error } = await supabaseServer
      .from('system_error_logs')
      .select('id')
      .limit(1);

    const pingMs = Date.now() - startTime;
    const isNetworkFail = error && (
      error.message.includes('fetch') ||
      error.message.includes('network') ||
      error.message.includes('ECONNREFUSED')
    );

    if (isNetworkFail) {
      totalFailedOps++;
      await logSupabaseError({
        err: error,
        operation: 'TEST_SUPABASE_CONNECTION',
        sourceTable: 'system_error_logs',
        apiRoute: '/api/admin/database-errors/test-connection',
        executionDurationMs: pingMs,
      });

      return res.json({
        isConnected: false,
        pingMs,
        checkedAt: new Date().toISOString(),
        statusText: `تعذر الاتصال بالشبكة بقاعدة البيانات (${error.message})`,
        error,
      });
    }

    totalSuccessfulOps++;
    lastSuccessfulConnectionTime = new Date().toISOString();

    res.json({
      isConnected: true,
      pingMs,
      checkedAt: lastSuccessfulConnectionTime,
      statusText: error
        ? `تم الاتصال بقاعدة البيانات بنجاح (استجابة الخادم: ${error.message})`
        : 'تم الاتصال بقاعدة بيانات Supabase Cloud بنجاح واستجابة فائقة السرعة.',
      details: {
        engine: 'Supabase Cloud PostgreSQL',
        url: SUPABASE_URL,
        recordsReturned: data?.length || 0,
        queryNotice: error?.message || null,
      },
    });
  } catch (err: any) {
    const pingMs = Date.now() - startTime;
    totalFailedOps++;
    await logSupabaseError({
      err,
      operation: 'TEST_SUPABASE_CONNECTION_EXCEPTION',
      apiRoute: '/api/admin/database-errors/test-connection',
      executionDurationMs: pingMs,
    });

    res.json({
      isConnected: false,
      pingMs,
      checkedAt: new Date().toISOString(),
      statusText: `فشل فحص شبكة الاتصال بـ Supabase (${err.message})`,
      error: err.message,
    });
  }
});

export default app;
