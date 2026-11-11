import express, { Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { db } from './db';

const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://pevftfrgtzspiphibbla.supabase.co').trim().replace(/\.supabase\.com$/i, '.supabase.co');
const SUPABASE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBldmZ0ZnJndHpzcGlwaGliYmxhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQwNTAxOTAsImV4cCI6MjEwOTYyNjE5MH0.OavlxMWS9mtCv8Ass3jM-Iz9CCSfT9FDx632gqBMvkA').trim();

export const supabaseServer = createClient(SUPABASE_URL, SUPABASE_KEY);

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

// Log Error directly to Supabase Cloud system_error_logs (NO local DB write)
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

interface AuthenticatedRequest extends Request {
  user?: any;
}

// User Authentication Middleware
const authMiddleware = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: 'غير مصرح: يجب تسجيل الدخول للوصول إلى هذه البيانات.' });
  }

  const token = authHeader.replace('Bearer ', '').trim();
  const user = db.findUserById(token);
  if (!user) {
    return res.status(401).json({ error: 'جلسة الدخول غير صالحة أو منتهية.' });
  }

  if (user.status === 'suspended') {
    return res.status(403).json({ error: 'الحساب مجمد من قبل الإدارة.' });
  }

  req.user = user;
  next();
};

// Strict Single Administrator Middleware
const adminMiddleware = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  authMiddleware(req, res, () => {
    if (!req.user || !db.isAuthorizedOwner(req.user.id)) {
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

    const result = await db.registerUser({
      fullName,
      phone,
      email,
      password,
      city,
      referralCode,
    });

    res.json({
      success: true,
      token: result.user.id,
      user: result.user,
      wallet: result.wallet,
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'فشل في إنشاء الحساب.' });
  }
});

app.post('/api/auth/login', (req: Request, res: Response) => {
  try {
    const { identifier, password } = req.body || {};
    if (!identifier || !password) {
      return res.status(400).json({ error: 'يرجى إدخال رقم الهاتف أو البريد وكلمة المرور.' });
    }

    const user = db.findUserByPhoneOrEmail(identifier);
    if (!user || !db.verifyPassword(user.id, password)) {
      return res.status(401).json({ error: 'بيانات الدخول غير صحيحة.' });
    }

    if (user.status === 'suspended') {
      return res.status(403).json({ error: 'تم تجميد هذا الحساب لمخالفة شروط الاستخدام.' });
    }

    const wallet = db.getWallet(user.id);
    return res.json({
      success: true,
      token: user.id,
      user,
      wallet,
    });
  } catch (err: any) {
    console.error('[AUTH_LOGIN_ERROR]', err?.message || err);
    return res.status(401).json({ error: err?.message || 'بيانات الدخول غير صحيحة أو تعذر التحقق.' });
  }
});

app.get('/api/auth/me', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'جلسة التوثيق غير صالحة.' });
    }
    const wallet = db.getWallet(req.user.id);
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
app.get('/api/system/status', (_req: Request, res: Response) => {
  const isSupabaseConfigured = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY);
  res.json({
    platformName: 'كسب اليمن',
    currency: 'YER',
    databaseEngine: isSupabaseConfigured ? 'Supabase Cloud PostgreSQL' : 'Local ACID Transactional Ledger',
    isSupabaseConfigured,
    ownerConfigured: true,
  });
});

// Real platform public statistics computed from actual database records (No hardcoded numbers)
app.get('/api/stats', (_req: Request, res: Response) => {
  const data = db.getData();
  const totalCompletedTasks = data.taskSubmissions.filter((s) => s.status === 'APPROVED').length;
  const totalWithdrawnYer = data.withdrawalRequests
    .filter((w) => w.status === 'PAID')
    .reduce((sum, w) => sum + w.amount, 0);
  const totalTaskRewardsPaidYer = data.walletTransactions
    .filter((t) => t.type === 'TASK_REWARD' && t.status === 'COMPLETED')
    .reduce((sum, t) => sum + t.amount, 0);
  const activeTasksCount = data.tasks.filter((t) => t.status === 'ACTIVE').length;
  const totalRegisteredUsers = data.profiles.filter((p) => p.role === 'user').length;

  res.json({
    totalCompletedTasks,
    totalWithdrawnYer,
    totalTaskRewardsPaidYer,
    activeTasksCount,
    totalRegisteredUsers,
    minWithdrawal: data.settings.minWithdrawal,
  });
});

// Platform Settings & Payout Methods
app.get('/api/settings', (_req: Request, res: Response) => {
  const data = db.getData();
  res.json({
    settings: data.settings,
    payoutMethods: data.payoutMethods.filter((m) => m.isActive),
  });
});

// Tasks (Public / User) - Returns actual database tasks from Supabase Cloud or local DB
app.get('/api/tasks', async (req: Request, res: Response) => {
  const { category, search } = req.query;

  try {
    let query = supabaseServer.from('tasks').select('*').eq('status', 'ACTIVE').order('created_at', { ascending: false });
    if (category && category !== 'all') {
      query = query.eq('category', String(category));
    }
    const { data: supaTasks, error: supaErr } = await query;
    if (!supaErr && supaTasks && supaTasks.length > 0) {
      let filtered = supaTasks.map((t) => ({
        id: t.id,
        title: t.title,
        description: t.description,
        category: t.category,
        rewardYer: Number(t.reward_yer || t.rewardYer || 0),
        steps: t.steps || [],
        proofRequirements: t.proof_requirements || t.proofRequirements || { requireImage: true, requireText: true },
        timeEstimateMinutes: t.time_estimate_minutes || t.timeEstimateMinutes || 10,
        totalQuantity: t.total_quantity || t.totalQuantity || 1,
        completedQuantity: t.completed_quantity || t.completedQuantity || 0,
        maxPerUser: t.max_per_user || 1,
        budgetYer: Number(t.budget_yer || t.budgetYer || 0),
        budgetSpentYer: Number(t.budget_spent_yer || t.budgetSpentYer || 0),
        status: t.status,
        createdBy: t.created_by,
        createdAt: t.created_at,
      }));

      if (search && typeof search === 'string') {
        const q = search.toLowerCase();
        filtered = filtered.filter((t) => t.title.toLowerCase().includes(q) || t.description.toLowerCase().includes(q));
      }

      return res.json({ tasks: filtered });
    }
  } catch (err) {
    console.warn('[SUPABASE_FETCH_TASKS_WARN]', err);
  }

  // Local DB Fallback
  let tasks = db.getData().tasks.filter((t) => t.status === 'ACTIVE');
  if (category && category !== 'all') {
    tasks = tasks.filter((t) => t.category === category);
  }
  if (search && typeof search === 'string') {
    const q = search.toLowerCase();
    tasks = tasks.filter((t) => t.title.toLowerCase().includes(q) || t.description.toLowerCase().includes(q));
  }
  res.json({ tasks });
});

app.get('/api/tasks/:id', (req: Request, res: Response) => {
  const task = db.getData().tasks.find((t) => t.id === req.params.id);
  if (!task) {
    return res.status(404).json({ error: 'المهمة المطلوبة غير موجودة.' });
  }
  res.json({ task });
});

// Real Task Submission
app.post('/api/tasks/submit', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  try {
    const { taskId, proofText, proofImages, proofUrl } = req.body;
    const task = db.getData().tasks.find((t) => t.id === taskId);
    if (!task) {
      return res.status(404).json({ error: 'المهمة غير موجودة.' });
    }
    if (task.status !== 'ACTIVE') {
      return res.status(400).json({ error: 'هذه المهمة غير نشطة حالياً.' });
    }

    // Check duplicate
    const existing = db.getData().taskSubmissions.find(
      (s) => s.taskId === taskId && s.userId === req.user.id && s.status !== 'REJECTED'
    );
    if (existing) {
      return res.status(400).json({ error: 'لقد قمت بتقديم إثبات لهذه المهمة مسبقاً وهو قيد المراجعة أو معتمد.' });
    }

    const submissionId = crypto.randomUUID();
    const submission = {
      id: submissionId,
      taskId,
      userId: req.user.id,
      userFullName: req.user.fullName,
      userPhone: req.user.phone,
      taskTitle: task.title,
      taskRewardYer: task.rewardYer,
      proofText: proofText?.trim() || '',
      proofImages: Array.isArray(proofImages) ? proofImages : [],
      proofUrl: proofUrl?.trim() || '',
      status: 'PENDING' as const,
      createdAt: new Date().toISOString(),
    };

    db.getData().taskSubmissions.push(submission);
    db.save();

    res.json({ success: true, submission });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'فشل في إرسال الإثبات.' });
  }
});

app.get('/api/submissions/my', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  const submissions = db.getData().taskSubmissions
    .filter((s) => s.userId === req.user.id)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  res.json({ submissions });
});

// Real Wallet & Transactions
app.get('/api/wallet/my', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  const wallet = db.getWallet(req.user.id);
  const transactions = db.getTransactions(req.user.id);
  res.json({ wallet, transactions });
});

// Wallet Address Lookup for Transfers (Pre-verification of recipient)
app.get('/api/wallet/lookup', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  const address = String(req.query.address || '').trim();
  if (!address) {
    return res.status(400).json({ error: 'يرجى تقديم عنوان المحفظة للتحقق.' });
  }

  const result = db.findWalletByAddress(address);
  if (!result) {
    return res.status(404).json({ exists: false, error: 'عنوان المحفظة غير مسجل في النظام.' });
  }

  res.json({
    exists: true,
    walletAddress: result.wallet.walletAddress,
    fullName: result.user.fullName,
    city: result.user.city,
    isSelf: result.wallet.userId === req.user.id,
  });
});

// Real Atomic Wallet-to-Wallet Transfer with Double-Entry Ledger
app.post('/api/wallet/transfer', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { recipientAddress, amount, note, idempotencyKey } = req.body;
    if (!recipientAddress || !amount) {
      return res.status(400).json({ error: 'يرجى تقديم عنوان المستلم والمبلغ المطلوب تحويله.' });
    }

    const numAmount = Math.floor(Number(amount));
    if (isNaN(numAmount) || numAmount <= 0) {
      return res.status(400).json({ error: 'مبلغ التحويل غير صالح (يجب أن يكون أكبر من 0 ر.ي).' });
    }

    const result = await db.transferWalletToWallet({
      senderId: req.user.id,
      recipientAddress: String(recipientAddress).trim(),
      amount: numAmount,
      note: note ? String(note).trim() : undefined,
      idempotencyKey,
    });

    const wallet = db.getWallet(req.user.id);
    res.json({
      success: true,
      transfer: result.transfer,
      wallet,
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'فشلت عملية التحويل.' });
  }
});

// Get Transfers History
app.get('/api/wallet/transfers', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  const transfers = db.getWalletTransfers(req.user.id);
  res.json({ transfers });
});

// Real Withdrawal Request
app.post('/api/withdrawals/request', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { method, amount, beneficiaryName, phoneNumber, accountNumber } = req.body;
    if (!method || !amount || !beneficiaryName || !phoneNumber) {
      return res.status(400).json({ error: 'يرجى استكمال جميع بيانات السحب المطلوبة.' });
    }

    const numericAmount = Math.floor(Number(amount));
    if (isNaN(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({ error: 'مبلغ السحب غير صحيح.' });
    }

    const result = await db.reserveWithdrawal({
      userId: req.user.id,
      method,
      amount: numericAmount,
      beneficiaryName,
      phoneNumber,
      accountNumber,
    });

    const wallet = db.getWallet(req.user.id);
    res.json({
      success: true,
      withdrawal: result.withdrawal,
      wallet,
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'فشل في تقديم طلب السحب.' });
  }
});

app.get('/api/withdrawals/my', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  const withdrawals = db.getData().withdrawalRequests
    .filter((w) => w.userId === req.user.id)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  res.json({ withdrawals });
});

// Notifications
app.get('/api/notifications', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  const notifs = db.getData().notifications
    .filter((n) => n.userId === req.user.id)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  res.json({ notifications: notifs });
});

app.post('/api/notifications/read-all', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  db.getData().notifications.forEach((n) => {
    if (n.userId === req.user.id) n.isRead = true;
  });
  db.save();
  res.json({ success: true });
});

// Referrals
app.get('/api/referrals/my', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  const code = req.user.referralCode;
  const referredUsers = db.getData().profiles.filter((p) => p.referredBy === req.user.id);
  const totalEarnedYer = referredUsers.length * (db.getData().settings.referralBonus || 300);

  const stats = {
    code,
    shareUrl: `${req.protocol}://${req.get('host') || 'kasbyemen.com'}/?ref=${code}`,
    totalReferred: referredUsers.length,
    totalEarnedYer,
    referredUsers: referredUsers.map((u) => ({
      id: u.id,
      fullName: u.fullName,
      createdAt: u.createdAt,
      hasCompletedFirstTask: false,
      rewardEarned: db.getData().settings.referralBonus || 300,
    })),
  };
  res.json({ referrals: stats });
});

// Support Tickets
app.get('/api/support/tickets', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  const tickets = db.getData().supportTickets
    .filter((t) => t.userId === req.user.id)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  res.json({ tickets });
});

app.post('/api/support/tickets', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  const { subject, message, priority } = req.body;
  if (!subject || !message) {
    return res.status(400).json({ error: 'يرجى كتابة عنوان ورسالة التذكرة.' });
  }

  const now = new Date().toISOString();
  const ticket = {
    id: crypto.randomUUID(),
    userId: req.user.id,
    subject: subject.trim(),
    status: 'OPEN' as const,
    priority: priority || 'MEDIUM',
    createdAt: now,
    updatedAt: now,
    messages: [
      {
        id: crypto.randomUUID(),
        senderId: req.user.id,
        senderRole: req.user.role,
        senderName: req.user.fullName,
        message: message.trim(),
        createdAt: now,
      },
    ],
  };

  db.getData().supportTickets.push(ticket);
  db.save();
  res.json({ success: true, ticket });
});

// ==============================================================================
// PRIVATE OWNER ADMINISTRATOR ONLY ROUTES
// Protected by adminMiddleware (rejects with 403 for any non-owner user)
// ==============================================================================

app.get('/api/admin/overview', adminMiddleware, (_req: AuthenticatedRequest, res: Response) => {
  const data = db.getData();
  const totalUsers = data.profiles.filter((p) => p.role === 'user').length;
  const activeUsers = data.profiles.filter((p) => p.role === 'user' && p.status === 'active').length;
  const suspendedUsers = data.profiles.filter((p) => p.status === 'suspended').length;

  const totalTasks = data.tasks.length;
  const activeTasks = data.tasks.filter((t) => t.status === 'ACTIVE').length;
  const pendingSubmissions = data.taskSubmissions.filter((s) => s.status === 'PENDING').length;
  const pendingWithdrawals = data.withdrawalRequests.filter((w) => w.status === 'PENDING').length;

  const totalAvailableLiabilities = data.wallets
    .filter((w) => w.userId !== data.profiles[0]?.id)
    .reduce((acc, w) => acc + w.availableBalance, 0);
  const totalPendingWithdrawalLiabilities = data.wallets
    .filter((w) => w.userId !== data.profiles[0]?.id)
    .reduce((acc, w) => acc + w.pendingBalance, 0);
  const totalCompletedWithdrawals = data.withdrawalRequests
    .filter((w) => w.status === 'PAID')
    .reduce((acc, w) => acc + w.amount, 0);
  const totalApprovedRewards = data.tasks.reduce((acc, t) => acc + t.budgetSpentYer, 0);

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
});

app.get('/api/admin/submissions', adminMiddleware, (_req: AuthenticatedRequest, res: Response) => {
  const submissions = [...db.getData().taskSubmissions].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  res.json({ submissions });
});

app.post('/api/admin/submissions/:id/review', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { action, reason } = req.body;
    const submissionId = req.params.id;

    if (action === 'APPROVE') {
      const result = await db.creditTaskReward(submissionId, req.user.id);
      return res.json({ success: true, result });
    } else if (action === 'REJECT') {
      if (!reason) {
        return res.status(400).json({ error: 'يجب ذكر سبب الرفض للتوضيح للمستخدم.' });
      }
      const submission = await db.rejectTaskSubmission(submissionId, req.user.id, reason);
      return res.json({ success: true, submission });
    } else {
      return res.status(400).json({ error: 'إجراء غير معروف.' });
    }
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'فشل في مراجعة الإثبات.' });
  }
});

app.get('/api/admin/withdrawals', adminMiddleware, (_req: AuthenticatedRequest, res: Response) => {
  const withdrawals = [...db.getData().withdrawalRequests].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  res.json({ withdrawals });
});

app.post('/api/admin/withdrawals/:id/review', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { action, transferReference, receiptUrl, reason } = req.body;
    const withdrawalId = req.params.id;

    if (action === 'PAY') {
      if (!transferReference) {
        return res.status(400).json({ error: 'يرجى إدخال رقم مرجع الحوالة البنكية.' });
      }
      const updated = await db.confirmWithdrawalPayout(withdrawalId, req.user.id, transferReference, receiptUrl);
      return res.json({ success: true, withdrawal: updated });
    } else if (action === 'REJECT') {
      if (!reason) {
        return res.status(400).json({ error: 'يجب كتابة سبب رفض السحب لاسترجاع الرصيد.' });
      }
      const result = await db.refundWithdrawal(withdrawalId, req.user.id, reason);
      return res.json({ success: true, result });
    } else {
      return res.status(400).json({ error: 'إجراء غير معروف.' });
    }
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'فشل في معالجة طلب السحب.' });
  }
});

app.get('/api/admin/tasks', adminMiddleware, (_req: AuthenticatedRequest, res: Response) => {
  res.json({ tasks: db.getData().tasks });
});

app.post('/api/admin/tasks', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  const { title, description, category, rewardYer, steps, timeEstimateMinutes, totalQuantity, proofRequirements } = req.body;
  if (!title || !description || rewardYer === undefined || rewardYer === null || totalQuantity === undefined) {
    return res.status(400).json({ error: 'يرجى استكمال بيانات المهمة الأساسية.' });
  }

  const numReward = Number(rewardYer);
  const numQuantity = Number(totalQuantity);
  if (isNaN(numReward) || numReward <= 0) {
    return res.status(400).json({ error: 'يرجى تحديد مكافأة صالحة للمهمة (أكبر من 0 ريال).' });
  }
  if (isNaN(numQuantity) || numQuantity <= 0) {
    return res.status(400).json({ error: 'يرجى تحديد كمية صالحة للمهمة.' });
  }
  const budget = numReward * numQuantity;

  const treasurySummary = db.getTreasurySummary();
  if (treasurySummary.treasuryAvailable < budget) {
    return res.status(400).json({
      error: `رصيد الخزينة المتاح (${treasurySummary.treasuryAvailable.toLocaleString()} وحدة) غير كافٍ لحجز ميزانية المهمة (${budget.toLocaleString()} وحدة). يرجى إصدار وحدات إضافية للخزينة أولاً من تبويب الخزينة.`
    });
  }

  const taskId = 'task-' + crypto.randomUUID().slice(0, 8);
  const newTask = {
    id: taskId,
    title: title.trim(),
    description: description.trim(),
    category: category || 'app_testing',
    rewardYer: numReward,
    steps: Array.isArray(steps) && steps.length > 0 ? steps : ['اتبع تعليمات المهمة', 'قدم الإثبات المطلوب'],
    proofRequirements: proofRequirements || { requireImage: true, requireText: true },
    timeEstimateMinutes: Number(timeEstimateMinutes) || 10,
    totalQuantity: numQuantity,
    completedQuantity: 0,
    maxPerUser: 1,
    budgetYer: budget,
    budgetSpentYer: 0,
    status: 'ACTIVE' as const,
    createdBy: req.user.id,
    createdAt: new Date().toISOString(),
  };

  // 1. Attempt Atomic Supabase Cloud PostgreSQL RPC Insertion
  try {
    const { data: supaRes, error: supaErr } = await supabaseServer.rpc('create_task_with_ledger_transaction', {
      p_title: title.trim(),
      p_description: description.trim(),
      p_category: category || 'app_testing',
      p_reward_yer: numReward,
      p_total_quantity: numQuantity,
      p_time_estimate_minutes: Number(timeEstimateMinutes) || 10,
      p_steps: Array.isArray(steps) && steps.length > 0 ? steps : ['اتبع تعليمات المهمة', 'قدم الإثبات المطلوب'],
      p_proof_requirements: proofRequirements || { require_image: true, require_text: true },
      p_admin_id: req.user.id && req.user.id.includes('-') ? req.user.id : null,
      p_idempotency_key: `TASK_CREATE_${taskId}`
    });

    if (!supaErr && supaRes && supaRes.success && supaRes.task) {
      console.log('[SUPABASE_RPC_TASK_SUCCESS]', supaRes.task.id);
      newTask.id = supaRes.task.id || taskId;
    } else if (supaErr) {
      console.warn('[SUPABASE_RPC_TASK_WARN]', supaErr.message);
    }
  } catch (err) {
    console.warn('[SUPABASE_RPC_TASK_EXCEPTION]', err);
  }

  // 2. Local Database & Ledger Sync
  db.reserveTaskBudget(newTask.id, budget, newTask.title, req.user.id);
  db.getData().tasks.unshift(newTask);
  db.logAdminAction(req.user.id, 'CREATE_TASK', 'TASK', newTask.id, `إنشاء مهمة جديدة: "${newTask.title}" مع حجز ميزانية ${budget} ر.ي من الخزينة`);
  db.save();

  res.json({ success: true, task: newTask });
});

// Admin Treasury & Accounting Management
app.get('/api/admin/treasury', adminMiddleware, (_req: AuthenticatedRequest, res: Response) => {
  const summary = db.getTreasurySummary();
  const recentTransactions = db.getLedgerTransactions(25);
  res.json({ summary, recentTransactions });
});

app.post('/api/admin/treasury/issue', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { amount, reason, idempotencyKey } = req.body;
    if (!amount || !reason) {
      return res.status(400).json({ error: 'يرجى تحديد المبلغ وسبب الإصدار.' });
    }

    const numAmount = Math.floor(Number(amount));
    if (isNaN(numAmount) || numAmount <= 0) {
      return res.status(400).json({ error: 'مبلغ الإصدار غير صالح (يجب أن يكون أكبر من 0 وحدة).' });
    }

    const result = await db.issueTreasuryUnits(req.user.id, numAmount, String(reason).trim(), idempotencyKey);
    res.json({
      success: true,
      summary: result.summary,
      transaction: result.transaction,
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'فشلت عملية إصدار الرصيد للخزينة.' });
  }
});

app.get('/api/admin/ledger', adminMiddleware, (_req: AuthenticatedRequest, res: Response) => {
  const transactions = db.getLedgerTransactions(50);
  const summary = db.getTreasurySummary();
  res.json({ transactions, summary });
});

app.put('/api/admin/tasks/:id', adminMiddleware, (req: AuthenticatedRequest, res: Response) => {
  const task = db.getData().tasks.find((t) => t.id === req.params.id);
  if (!task) {
    return res.status(404).json({ error: 'المهمة غير موجودة.' });
  }

  const { title, description, rewardYer, totalQuantity, status } = req.body;
  if (title) task.title = title.trim();
  if (description) task.description = description.trim();
  if (rewardYer) {
    task.rewardYer = Number(rewardYer);
    task.budgetYer = task.rewardYer * task.totalQuantity;
  }
  if (totalQuantity) {
    task.totalQuantity = Number(totalQuantity);
    task.budgetYer = task.rewardYer * task.totalQuantity;
  }
  if (status) task.status = status;

  db.logAdminAction(req.user.id, 'UPDATE_TASK', 'TASK', task.id, `تحديث المهمة: "${task.title}"`);
  db.save();
  res.json({ success: true, task });
});

app.get('/api/admin/users', adminMiddleware, (_req: AuthenticatedRequest, res: Response) => {
  const data = db.getData();
  const usersWithWallets = data.profiles
    .filter((p) => p.role === 'user')
    .map((p) => {
      const wallet = db.getWallet(p.id);
      const submissionsCount = data.taskSubmissions.filter((s) => s.userId === p.id).length;
      const completedCount = data.taskSubmissions.filter((s) => s.userId === p.id && s.status === 'APPROVED').length;
      return {
        ...p,
        wallet,
        submissionsCount,
        completedCount,
      };
    });
  res.json({ users: usersWithWallets });
});

app.post('/api/admin/users/:id/adjust', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { amount, reason } = req.body;
    if (!amount || !reason) {
      return res.status(400).json({ error: 'يرجى تحديد مبلغ التعديل وسبب التدقيق الإداري.' });
    }
    const result = await db.adjustBalanceAudited(req.params.id, req.user.id, Number(amount), reason);
    res.json({ success: true, result });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'فشل في تعديل الرصيد.' });
  }
});

app.post('/api/admin/users/:id/status', adminMiddleware, (req: AuthenticatedRequest, res: Response) => {
  const user = db.findUserById(req.params.id);
  if (!user || user.role === 'admin') {
    return res.status(404).json({ error: 'المستخدم غير موجود أو غير قابل للتعديل.' });
  }
  const { status } = req.body;
  if (!['active', 'suspended', 'under_review'].includes(status)) {
    return res.status(400).json({ error: 'حالة غير صالحة.' });
  }
  user.status = status;
  db.logAdminAction(req.user.id, 'CHANGE_USER_STATUS', 'USER', user.id, `تغيير حالة المستخدم إلى ${status}`);
  db.save();
  res.json({ success: true, user });
});

app.get('/api/admin/financial-report', adminMiddleware, (_req: AuthenticatedRequest, res: Response) => {
  const data = db.getData();
  const totalTaskExpenses = data.tasks.reduce((sum, t) => sum + t.budgetSpentYer, 0);
  const totalPaidWithdrawals = data.withdrawalRequests
    .filter((w) => w.status === 'PAID')
    .reduce((sum, w) => sum + w.amount, 0);
  const totalPendingWithdrawals = data.withdrawalRequests
    .filter((w) => w.status === 'PENDING')
    .reduce((sum, w) => sum + w.amount, 0);
  const totalAvailableLiabilities = data.wallets
    .filter((w) => w.userId !== data.profiles[0]?.id)
    .reduce((sum, w) => sum + w.availableBalance, 0);
  const totalReferralExpenses = 300 * data.profiles.filter((p) => p.referredBy).length;

  const txs = data.walletTransactions;
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(Date.now() - (6 - i) * 86400000);
    const dateStr = d.toISOString().slice(0, 10);
    const dayTxs = txs.filter((t) => t.createdAt.startsWith(dateStr));
    const taskRewards = dayTxs.filter((t) => t.type === 'TASK_REWARD').reduce((s, t) => s + t.amount, 0);
    const withdrawals = dayTxs.filter((t) => t.type === 'WITHDRAWAL_REQUEST').reduce((s, t) => s + Math.abs(t.amount), 0);
    const newUsers = data.profiles.filter((p) => p.role === 'user' && p.createdAt.startsWith(dateStr)).length;
    return {
      date: dateStr,
      taskRewards,
      withdrawals,
      newUsers,
    };
  });

  res.json({
    report: {
      totalTaskExpenses,
      totalPaidWithdrawals,
      totalPendingWithdrawals,
      totalAvailableLiabilities,
      totalReferralExpenses,
      netPlatformVolume: totalTaskExpenses + totalPaidWithdrawals,
      dailyBreakdown: days,
    },
  });
});

app.get('/api/admin/financial-report/export', adminMiddleware, (_req: AuthenticatedRequest, res: Response) => {
  const transactions = db.getTransactions();
  let csv = 'رقم المعاملة,المستخدم,النوع,المبلغ_ريال,الرصيد_السابق,الرصيد_الجديد,الحالة,المرجع,التاريخ,البيان\n';
  transactions.forEach((t) => {
    csv += `"${t.id}","${t.userId}","${t.type}",${t.amount},${t.previousBalance},${t.newBalance},"${t.status}","${t.referenceId || ''}","${t.createdAt}","${t.description.replace(/"/g, '""')}"\n`;
  });

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="kasb_yemen_actual_ledger.csv"');
  res.send('\uFEFF' + csv);
});

app.put('/api/admin/settings', adminMiddleware, (req: AuthenticatedRequest, res: Response) => {
  const { minWithdrawal, maxWithdrawal, defaultFeePercentage, referralBonus, maintenanceMode } = req.body;
  const s = db.getData().settings;
  if (minWithdrawal !== undefined) s.minWithdrawal = Number(minWithdrawal);
  if (maxWithdrawal !== undefined) s.maxWithdrawal = Number(maxWithdrawal);
  if (defaultFeePercentage !== undefined) s.defaultFeePercentage = Number(defaultFeePercentage);
  if (referralBonus !== undefined) s.referralBonus = Number(referralBonus);
  if (maintenanceMode !== undefined) s.maintenanceMode = Boolean(maintenanceMode);
  s.updatedAt = new Date().toISOString();

  db.logAdminAction(req.user.id, 'UPDATE_PLATFORM_SETTINGS', 'SETTINGS', s.id, 'تحديث إعدادات ورسوم المنصة');
  db.save();
  res.json({ success: true, settings: s });
});

// ==============================================================================
// DATABASE ERROR MONITORING & SUPABASE DIAGNOSTICS ENDPOINTS
// ==============================================================================

app.get('/api/admin/database-errors', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  const { search, errorType, sourceTable, resolvedStatus, startDate, endDate } = req.query;

  try {
    const startTime = Date.now();
    const { error: pingErr } = await supabaseServer.from('platform_settings').select('*').limit(1);
    const pingMs = Date.now() - startTime;
    const isNetworkFail = pingErr && (
      pingErr.message.includes('fetch') ||
      pingErr.message.includes('network') ||
      pingErr.message.includes('ECONNREFUSED')
    );
    const isConnected = !isNetworkFail;
    if (isConnected) {
      lastSuccessfulConnectionTime = new Date().toISOString();
      totalSuccessfulOps++;
    }

    let query = supabaseServer.from('system_error_logs').select('*').order('occurred_at', { ascending: false });

    if (errorType && errorType !== 'ALL') {
      query = query.eq('error_type', String(errorType));
    }
    if (sourceTable && sourceTable !== 'ALL') {
      query = query.eq('source_table', String(sourceTable));
    }
    if (resolvedStatus === 'unresolved') {
      query = query.eq('resolved', false);
    } else if (resolvedStatus === 'resolved') {
      query = query.eq('resolved', true);
    }
    if (startDate) {
      query = query.gte('occurred_at', String(startDate));
    }
    if (endDate) {
      query = query.lte('occurred_at', String(endDate));
    }

    const { data: rawLogs, error: fetchErr } = await query.limit(200);

    if (fetchErr) {
      await logSupabaseError({
        err: fetchErr,
        operation: 'FETCH_ERROR_LOGS',
        sourceTable: 'system_error_logs',
        apiRoute: '/api/admin/database-errors',
      });
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
      logs = logs.filter((l) =>
        (l.message && l.message.toLowerCase().includes(q)) ||
        (l.operation && l.operation.toLowerCase().includes(q)) ||
        (l.sourceTable && l.sourceTable.toLowerCase().includes(q)) ||
        (l.errorCode && l.errorCode.toLowerCase().includes(q))
      );
    }

    const nowMs = Date.now();
    const ms24h = 24 * 60 * 60 * 1000;
    const ms7d = 7 * ms24h;

    const errors24h = logs.filter((l) => nowMs - new Date(l.occurredAt).getTime() <= ms24h).length;
    const errors7d = logs.filter((l) => nowMs - new Date(l.occurredAt).getTime() <= ms7d).length;

    const errorTypeBreakdown: Record<string, number> = {};
    logs.forEach((l) => {
      errorTypeBreakdown[l.errorType] = (errorTypeBreakdown[l.errorType] || 0) + 1;
    });

    res.json({
      logs,
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
      .from('platform_settings')
      .select('*')
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
        sourceTable: 'platform_settings',
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

    if (error) {
      await logSupabaseError({
        err: error,
        operation: 'TEST_SUPABASE_CONNECTION_QUERY_NOTICE',
        sourceTable: 'platform_settings',
        apiRoute: '/api/admin/database-errors/test-connection',
        executionDurationMs: pingMs,
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
