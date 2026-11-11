import express, { Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { db } from './db';

const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://pevftfrgtzspiphibbla.supabase.co').trim().replace(/\.supabase\.com$/i, '.supabase.co');
const SUPABASE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBldmZ0ZnJndHpzcGlwaGliYmxhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQwNTAxOTAsImV4cCI6MjEwOTYyNjE5MH0.OavlxMWS9mtCv8Ass3jM-Iz9CCSfT9FDx632gqBMvkA').trim();

export const supabaseServer = createClient(SUPABASE_URL, SUPABASE_KEY);

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

export default app;
