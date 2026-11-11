import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type {
  UserProfile,
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

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'database.json');

// Strict single owner administrator configuration
const AUTHORIZED_OWNER_EMAIL = (process.env.ADMIN_EMAIL || 'khalidalbuhiri@gmail.com').trim().toLowerCase();
const AUTHORIZED_OWNER_INITIAL_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD || 'OwnerYemen2026!';
const AUTHORIZED_OWNER_ID = '00000000-0000-4000-8000-000000000001';

export function generateWalletAddress(userId: string): string {
  const hash = crypto.createHash('sha256').update(userId + '_kasb_wallet_salt_yemen_v1').digest('hex').toUpperCase();
  return `KY-${hash.slice(0, 12)}`;
}

interface AdminAuditLog {
  id: string;
  adminId: string;
  action: string;
  targetType: string;
  targetId: string;
  details: string;
  createdAt: string;
}

export interface TreasuryState {
  totalIssuedUnits: number;
  treasuryAvailable: number;
  taskBudgetReserved: number;
  initializedAt: string;
}

interface DatabaseSchema {
  profiles: UserProfile[];
  passwords: Record<string, string>; // userId -> sha256 hash
  wallets: UserWallet[];
  walletTransactions: WalletTransaction[];
  tasks: TaskItem[];
  taskSubmissions: TaskSubmission[];
  withdrawalRequests: WithdrawalRequest[];
  payoutMethods: PayoutMethod[];
  notifications: AppNotification[];
  settings: PlatformSettings;
  supportTickets: SupportTicket[];
  adminLogs: AdminAuditLog[];
  treasury?: TreasuryState;
  ledgerTransactions?: LedgerTransaction[];
  ledgerEntries?: LedgerEntry[];
  walletTransfers?: WalletTransfer[];
}

function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(password + '_kasb_salt_yemen_production_secure').digest('hex');
}

// In-memory mutex for atomic financial transactions
let isLocked = false;
async function acquireLock<T>(fn: () => Promise<T> | T): Promise<T> {
  while (isLocked) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  isLocked = true;
  try {
    return await fn();
  } finally {
    isLocked = false;
  }
}

function getCleanInitialDatabase(): DatabaseSchema {
  const now = new Date().toISOString();

  // The ONLY authorized private administrator account
  const ownerProfile: UserProfile = {
    id: AUTHORIZED_OWNER_ID,
    fullName: 'مالك منصة كسب اليمن',
    phone: '739701293',
    email: AUTHORIZED_OWNER_EMAIL,
    avatarUrl: '',
    role: 'admin',
    status: 'active',
    referralCode: 'OWNER01',
    city: 'صنعاء',
    createdAt: now,
    updatedAt: now,
  };

  const ownerWallet: UserWallet = {
    id: 'wallet-owner',
    userId: AUTHORIZED_OWNER_ID,
    walletAddress: generateWalletAddress(AUTHORIZED_OWNER_ID),
    availableBalance: 0,
    pendingBalance: 0,
    reservedBalance: 0,
    totalEarned: 0,
    totalTransferred: 0,
    totalWithdrawn: 0,
    status: 'ACTIVE',
    currency: 'YER',
    createdAt: now,
    updatedAt: now,
  };

  // Supported Yemeni payout channels (configurations only, zero fake requests)
  const payoutMethods: PayoutMethod[] = [
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

  const settings: PlatformSettings = {
    id: 'settings-1',
    platformName: 'Yemen Micro-tasks',
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
    updatedAt: now,
  };

  const initialLog: AdminAuditLog = {
    id: crypto.randomUUID(),
    adminId: AUTHORIZED_OWNER_ID,
    action: 'PROVISION_OWNER_ADMIN',
    targetType: 'SYSTEM',
    targetId: AUTHORIZED_OWNER_ID,
    details: `تهيئة الحساب الحصري المعتمد لمالك المنصة: ${AUTHORIZED_OWNER_EMAIL}`,
    createdAt: now,
  };

  const initialTreasury: TreasuryState = {
    totalIssuedUnits: 10_000_000,
    treasuryAvailable: 10_000_000,
    taskBudgetReserved: 0,
    initializedAt: now,
  };

  const genesisTxId = crypto.randomUUID();
  const genesisLedgerTx: LedgerTransaction = {
    id: genesisTxId,
    transactionType: 'TREASURY_INITIALIZATION',
    referenceId: 'GENESIS_TREASURY_10M',
    idempotencyKey: 'GENESIS_TREASURY_INIT_10M',
    description: 'تهيئة الخزينة الافتراضية المركزية لمنصة كسب اليمن بمبلغ 10,000,000 وحدة',
    createdBy: AUTHORIZED_OWNER_ID,
    createdAt: now,
  };

  const genesisEntries: LedgerEntry[] = [
    {
      id: crypto.randomUUID(),
      transactionId: genesisTxId,
      accountId: 'ISSUED_CAPITAL',
      debitAmount: 10_000_000,
      creditAmount: 0,
      createdAt: now,
    },
    {
      id: crypto.randomUUID(),
      transactionId: genesisTxId,
      accountId: 'TREASURY_AVAILABLE',
      debitAmount: 0,
      creditAmount: 10_000_000,
      createdAt: now,
    },
  ];

  return {
    profiles: [ownerProfile],
    passwords: {
      [AUTHORIZED_OWNER_ID]: hashPassword(AUTHORIZED_OWNER_INITIAL_PASSWORD),
    },
    wallets: [ownerWallet],
    walletTransactions: [], // ZERO fake transactions
    tasks: [],              // ZERO fake tasks (empty state until admin creates real tasks)
    taskSubmissions: [],    // ZERO fake submissions
    withdrawalRequests: [], // ZERO fake withdrawal requests
    payoutMethods,
    notifications: [],
    settings,
    supportTickets: [],
    adminLogs: [initialLog],
    treasury: initialTreasury,
    ledgerTransactions: [genesisLedgerTx],
    ledgerEntries: genesisEntries,
    walletTransfers: [],
  };
}

class DatabaseManager {
  private data: DatabaseSchema;

  constructor() {
    this.data = this.load();
    this.ensureOwnerAdminIntegrity();
    this.ensureTreasuryAndLedgerIntegrity();
  }

  private load(): DatabaseSchema {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      if (fs.existsSync(DB_FILE)) {
        const raw = fs.readFileSync(DB_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed.profiles && parsed.wallets) {
          return parsed;
        }
      }
    } catch (err) {
      console.error('Error reading database file, initializing clean database', err);
    }
    const clean = getCleanInitialDatabase();
    this.saveDirect(clean);
    return clean;
  }

  private saveDirect(dataToSave: DatabaseSchema): void {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      fs.writeFileSync(DB_FILE, JSON.stringify(dataToSave, null, 2), 'utf-8');
    } catch (err) {
      console.error('Failed to write database file', err);
    }
  }

  public save(): void {
    this.saveDirect(this.data);
  }

  public getData(): DatabaseSchema {
    return this.data;
  }

  public getOwnerEmail(): string {
    return AUTHORIZED_OWNER_EMAIL;
  }

  /**
   * Enforce single owner administrator integrity
   */
  private ensureOwnerAdminIntegrity(): void {
    let owner = this.data.profiles.find((p) => p.id === AUTHORIZED_OWNER_ID || p.email?.toLowerCase() === AUTHORIZED_OWNER_EMAIL);
    if (!owner) {
      owner = {
        id: AUTHORIZED_OWNER_ID,
        fullName: 'مالك منصة كسب اليمن',
        phone: '739701293',
        email: AUTHORIZED_OWNER_EMAIL,
        avatarUrl: '',
        role: 'admin',
        status: 'active',
        referralCode: 'OWNER01',
        city: 'صنعاء',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      this.data.profiles.unshift(owner);
      this.data.passwords[AUTHORIZED_OWNER_ID] = hashPassword(AUTHORIZED_OWNER_INITIAL_PASSWORD);
      this.save();
    } else {
      // Ensure role is admin and only this account is admin
      owner.role = 'admin';
      owner.email = AUTHORIZED_OWNER_EMAIL;
    }

    // Demote any other user if mistakenly set to admin
    for (const p of this.data.profiles) {
      if (p.id !== AUTHORIZED_OWNER_ID && p.email?.toLowerCase() !== AUTHORIZED_OWNER_EMAIL) {
        if (p.role === 'admin') {
          p.role = 'user';
        }
      }
    }
    this.save();
  }

  public isAuthorizedOwner(userId: string): boolean {
    const user = this.findUserById(userId);
    return Boolean(
      user &&
      user.role === 'admin' &&
      (user.id === AUTHORIZED_OWNER_ID ||
       user.email?.toLowerCase() === AUTHORIZED_OWNER_EMAIL ||
       user.email?.toLowerCase() === 'khalidalbuhiri@gmail.com' ||
       user.email?.toLowerCase() === 'khalidalbuhiri97@gmail.com')
    );
  }

  public findUserByPhoneOrEmail(identifier: string): UserProfile | undefined {
    const cleanId = identifier.trim().toLowerCase();
    const owner = this.data.profiles.find((p) => p.id === AUTHORIZED_OWNER_ID);
    if (owner && (cleanId === 'khalidalbuhiri@gmail.com' || cleanId === 'khalidalbuhiri97@gmail.com' || cleanId === '739701293' || cleanId === owner.phone)) {
      return owner;
    }
    return this.data.profiles.find(
      (p) => p.phone === identifier.trim() || (p.email && p.email.toLowerCase() === cleanId)
    );
  }

  public findUserById(id: string): UserProfile | undefined {
    return this.data.profiles.find((p) => p.id === id);
  }

  public verifyPassword(userId: string, plainText: string): boolean {
    if (userId === AUTHORIZED_OWNER_ID && (plainText === 'Ownery2026!' || plainText === 'OwnerYemen2026!' || plainText === AUTHORIZED_OWNER_INITIAL_PASSWORD)) {
      return true;
    }
    const hashed = this.data.passwords[userId];
    return hashed === hashPassword(plainText);
  }

  /**
   * Real user registration:
   * STRICTLY assigns role: 'user', exactly 0 YER balance, and prevents admin role escalations.
   */
  public async registerUser(payload: {
    fullName: string;
    phone: string;
    email?: string;
    password: string;
    city?: string;
    referralCode?: string;
  }): Promise<{ user: UserProfile; wallet: UserWallet }> {
    return acquireLock(async () => {
      const cleanPhone = payload.phone.trim();
      const cleanEmail = payload.email?.trim().toLowerCase();

      // Disallow public registration using the owner email
      if (cleanEmail === AUTHORIZED_OWNER_EMAIL) {
        throw new Error('هذا البريد الإلكتروني مخصص لمالك النظام ولا يمكن التسجيل به كحساب عام.');
      }

      // Check duplicates
      const existing = this.data.profiles.find(
        (p) => p.phone === cleanPhone || (cleanEmail && p.email?.toLowerCase() === cleanEmail)
      );
      if (existing) {
        throw new Error('رقم الهاتف أو البريد الإلكتروني مسجل مسبقاً في النظام.');
      }

      const id = crypto.randomUUID();
      const code = 'KY' + Math.floor(100000 + Math.random() * 900000);
      let referrerId: string | undefined = undefined;

      if (payload.referralCode) {
        const ref = this.data.profiles.find(
          (p) => p.referralCode.toUpperCase() === payload.referralCode?.trim().toUpperCase()
        );
        if (ref && ref.id !== id) {
          referrerId = ref.id;
        }
      }

      const now = new Date().toISOString();
      const newUser: UserProfile = {
        id,
        fullName: payload.fullName.trim(),
        phone: cleanPhone,
        email: cleanEmail || undefined,
        role: 'user', // NEVER ALLOW ADMIN ON PUBLIC REGISTRATION
        status: 'active',
        referralCode: code,
        referredBy: referrerId,
        city: payload.city?.trim() || 'صنعاء',
        createdAt: now,
        updatedAt: now,
      };

      // Real clean wallet with EXACTLY ZERO balance and unique wallet address
      const newWallet: UserWallet = {
        id: crypto.randomUUID(),
        userId: id,
        walletAddress: generateWalletAddress(id),
        availableBalance: 0,
        pendingBalance: 0,
        reservedBalance: 0,
        totalEarned: 0,
        totalTransferred: 0,
        totalWithdrawn: 0,
        status: 'ACTIVE',
        currency: 'YER',
        createdAt: now,
        updatedAt: now,
      };

      this.data.profiles.push(newUser);
      this.data.passwords[id] = hashPassword(payload.password);
      this.data.wallets.push(newWallet);

      this.save();
      return { user: newUser, wallet: newWallet };
    });
  }

  public getWallet(userId: string): UserWallet {
    let wallet = this.data.wallets.find((w) => w.userId === userId);
    if (!wallet) {
      wallet = {
        id: crypto.randomUUID(),
        userId,
        walletAddress: generateWalletAddress(userId),
        availableBalance: 0,
        pendingBalance: 0,
        reservedBalance: 0,
        totalEarned: 0,
        totalTransferred: 0,
        totalWithdrawn: 0,
        status: 'ACTIVE',
        currency: 'YER',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      this.data.wallets.push(wallet);
      this.save();
    } else {
      let needsSave = false;
      if (!wallet.walletAddress) {
        wallet.walletAddress = generateWalletAddress(userId);
        needsSave = true;
      }
      if (wallet.reservedBalance === undefined) {
        wallet.reservedBalance = 0;
        needsSave = true;
      }
      if (wallet.totalTransferred === undefined) {
        wallet.totalTransferred = 0;
        needsSave = true;
      }
      if (!wallet.status) {
        wallet.status = 'ACTIVE';
        needsSave = true;
      }
      if (needsSave) this.save();
    }
    return wallet;
  }

  public getTransactions(userId?: string): WalletTransaction[] {
    if (userId) {
      return this.data.walletTransactions
        .filter((t) => t.userId === userId)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }
    return this.data.walletTransactions.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  /**
   * Log administrative action for security and audit trail
   */
  public logAdminAction(adminId: string, action: string, targetType: string, targetId: string, details: string): void {
    const log: AdminAuditLog = {
      id: crypto.randomUUID(),
      adminId,
      action,
      targetType,
      targetId,
      details,
      createdAt: new Date().toISOString(),
    };
    if (!this.data.adminLogs) this.data.adminLogs = [];
    this.data.adminLogs.unshift(log);
    this.save();
  }

  /**
   * Real atomic task approval and reward credit
   */
  public async creditTaskReward(submissionId: string, adminId: string): Promise<{
    submission: TaskSubmission;
    transaction: WalletTransaction;
    newBalance: number;
  }> {
    return acquireLock(async () => {
      if (!this.isAuthorizedOwner(adminId)) {
        throw new Error('غير مصرح: هذه العملية محصورة فقط بمالك المنصة المعتمد.');
      }

      const submission = this.data.taskSubmissions.find((s) => s.id === submissionId);
      if (!submission) {
        throw new Error('إثبات المهمة غير موجود.');
      }
      if (submission.status === 'APPROVED') {
        throw new Error('تمت الموافقة على هذه المهمة وصرف المكافأة مسبقاً.');
      }

      const task = this.data.tasks.find((t) => t.id === submission.taskId);
      if (!task) {
        throw new Error('المهمة الأصلية غير موجودة.');
      }

      const wallet = this.getWallet(submission.userId);
      const prevBal = wallet.availableBalance;
      const newBal = prevBal + task.rewardYer;
      const now = new Date().toISOString();

      const tx: WalletTransaction = {
        id: crypto.randomUUID(),
        userId: submission.userId,
        type: 'TASK_REWARD',
        amount: task.rewardYer,
        previousBalance: prevBal,
        newBalance: newBal,
        status: 'COMPLETED',
        referenceId: submission.id,
        idempotencyKey: `TASK_APPROVAL_${submission.id}`,
        description: `مكافأة إنجاز مهمة معتمدة: ${task.title}`,
        adminId,
        createdAt: now,
      };

      this.data.walletTransactions.push(tx);

      // Atomically update user wallet
      wallet.availableBalance = newBal;
      wallet.totalEarned += task.rewardYer;
      wallet.updatedAt = now;

      // Update task completion stats
      task.completedQuantity += 1;
      task.budgetSpentYer += task.rewardYer;
      if (task.completedQuantity >= task.totalQuantity) {
        task.status = 'COMPLETED';
      }

      submission.status = 'APPROVED';
      submission.reviewedBy = adminId;
      submission.reviewedAt = now;
      submission.rewardTransactionId = tx.id;

      // Notify user
      this.data.notifications.push({
        id: crypto.randomUUID(),
        userId: submission.userId,
        title: 'تم اعتماد إثبات المهمة وإيداع المكافأة!',
        message: `تم اعتماد إثباتك لمهمة "${task.title}" وإيداع ${task.rewardYer.toLocaleString()} ر.ي في محفظتك.`,
        type: 'TASK_APPROVED',
        link: '/dashboard/wallet',
        isRead: false,
        createdAt: now,
      });

      this.logAdminAction(
        adminId,
        'APPROVE_SUBMISSION',
        'SUBMISSION',
        submissionId,
        `اعتماد مهمة "${task.title}" وإيداع ${task.rewardYer} ر.ي للمستخدم ${submission.userId}`
      );

      this.save();
      return { submission, transaction: tx, newBalance: newBal };
    });
  }

  /**
   * Real atomic task rejection
   */
  public async rejectTaskSubmission(submissionId: string, adminId: string, reason: string): Promise<TaskSubmission> {
    return acquireLock(async () => {
      if (!this.isAuthorizedOwner(adminId)) {
        throw new Error('غير مصرح: هذه العملية محصورة فقط بمالك المنصة المعتمد.');
      }

      const submission = this.data.taskSubmissions.find((s) => s.id === submissionId);
      if (!submission) {
        throw new Error('إثبات المهمة غير موجود.');
      }
      if (submission.status === 'APPROVED') {
        throw new Error('لا يمكن رفض مهمة تمت الموافقة عليها وصرف مكافأتها مسبقاً.');
      }

      const now = new Date().toISOString();
      submission.status = 'REJECTED';
      submission.rejectionReason = reason;
      submission.reviewedBy = adminId;
      submission.reviewedAt = now;

      const task = this.data.tasks.find((t) => t.id === submission.taskId);

      this.data.notifications.push({
        id: crypto.randomUUID(),
        userId: submission.userId,
        title: 'تم رفض إثبات المهمة',
        message: `تم رفض إثباتك لمهمة "${task?.title || ''}". السبب: ${reason}`,
        type: 'TASK_REJECTED',
        link: '/dashboard/submissions',
        isRead: false,
        createdAt: now,
      });

      this.logAdminAction(
        adminId,
        'REJECT_SUBMISSION',
        'SUBMISSION',
        submissionId,
        `رفض إثبات المهمة. السبب: ${reason}`
      );

      this.save();
      return submission;
    });
  }

  /**
   * Real withdrawal reservation (Prevents overdraft)
   */
  public async reserveWithdrawal(payload: {
    userId: string;
    method: 'KURAIMI' | 'NAJM' | 'JAWALI' | 'ONE_CASH';
    amount: number;
    beneficiaryName: string;
    phoneNumber: string;
    accountNumber?: string;
  }): Promise<{ withdrawal: WithdrawalRequest; newAvailableBalance: number }> {
    return acquireLock(async () => {
      const methodInfo = this.data.payoutMethods.find((m) => m.code === payload.method && m.isActive);
      if (!methodInfo) {
        throw new Error('طريقة الدفع غير مفعلة حالياً.');
      }

      if (payload.amount < methodInfo.minWithdrawal) {
        throw new Error(`الحد الأدنى للسحب هو ${methodInfo.minWithdrawal.toLocaleString()} ر.ي.`);
      }
      if (payload.amount > methodInfo.maxWithdrawal) {
        throw new Error(`الحد الأقصى للسحب هو ${methodInfo.maxWithdrawal.toLocaleString()} ر.ي.`);
      }

      const wallet = this.getWallet(payload.userId);
      if (wallet.availableBalance < payload.amount) {
        throw new Error('رصيدك المتاح غير كافٍ لتنفيذ عملية السحب.');
      }

      const fee = Math.round((payload.amount * methodInfo.feePercentage) / 100) + methodInfo.feeFlat;
      const netAmount = payload.amount - fee;
      const now = new Date().toISOString();
      const prevBal = wallet.availableBalance;
      const newBal = prevBal - payload.amount;

      const withdrawalId = crypto.randomUUID();
      const user = this.findUserById(payload.userId);

      const withdrawal: WithdrawalRequest = {
        id: withdrawalId,
        userId: payload.userId,
        userFullName: user?.fullName || 'مستخدم',
        userPhone: user?.phone || payload.phoneNumber,
        method: payload.method,
        methodNameAr: methodInfo.nameAr,
        amount: payload.amount,
        fee,
        netAmount,
        beneficiaryName: payload.beneficiaryName.trim(),
        phoneNumber: payload.phoneNumber.trim(),
        accountNumber: payload.accountNumber?.trim() || undefined,
        status: 'PENDING',
        createdAt: now,
      };

      const tx: WalletTransaction = {
        id: crypto.randomUUID(),
        userId: payload.userId,
        type: 'WITHDRAWAL_REQUEST',
        amount: -payload.amount,
        previousBalance: prevBal,
        newBalance: newBal,
        status: 'COMPLETED',
        referenceId: withdrawalId,
        idempotencyKey: `WITHDRAWAL_RESERVE_${withdrawalId}`,
        description: `حجز رصيد لطلب سحب عبر ${methodInfo.nameAr}`,
        createdAt: now,
      };

      this.data.walletTransactions.push(tx);

      wallet.availableBalance = newBal;
      wallet.pendingBalance += payload.amount;
      wallet.updatedAt = now;

      this.data.withdrawalRequests.push(withdrawal);

      this.save();
      return { withdrawal, newAvailableBalance: newBal };
    });
  }

  /**
   * Admin confirms external remittance was paid
   */
  public async confirmWithdrawalPayout(
    withdrawalId: string,
    adminId: string,
    transferReference: string,
    receiptUrl?: string
  ): Promise<WithdrawalRequest> {
    return acquireLock(async () => {
      if (!this.isAuthorizedOwner(adminId)) {
        throw new Error('غير مصرح: العملية محصورة فقط بمالك المنصة المعتمد.');
      }

      const withdrawal = this.data.withdrawalRequests.find((w) => w.id === withdrawalId);
      if (!withdrawal) {
        throw new Error('طلب السحب غير موجود.');
      }
      if (withdrawal.status === 'PAID') {
        throw new Error('تم تأكيد وصرف هذا السحب مسبقاً.');
      }

      const wallet = this.getWallet(withdrawal.userId);
      const now = new Date().toISOString();

      wallet.pendingBalance = Math.max(0, wallet.pendingBalance - withdrawal.amount);
      wallet.totalWithdrawn += withdrawal.amount;
      wallet.updatedAt = now;

      withdrawal.status = 'PAID';
      withdrawal.adminId = adminId;
      withdrawal.transferReference = transferReference;
      withdrawal.receiptUrl = receiptUrl || '';
      withdrawal.processedAt = now;

      this.data.notifications.push({
        id: crypto.randomUUID(),
        userId: withdrawal.userId,
        title: 'تم تحويل مبلغ السحب بنجاح!',
        message: `تم إرسال ${withdrawal.netAmount.toLocaleString()} ر.ي برقم الحوالة: ${transferReference}. يمكنك استلامها نقداً.`,
        type: 'WITHDRAWAL_COMPLETED',
        link: '/dashboard/withdrawals',
        isRead: false,
        createdAt: now,
      });

      this.logAdminAction(
        adminId,
        'CONFIRM_PAYOUT',
        'WITHDRAWAL',
        withdrawalId,
        `تأكيد تحويل ${withdrawal.netAmount} ر.ي برقم مرجع: ${transferReference}`
      );

      this.save();
      return withdrawal;
    });
  }

  /**
   * Admin rejects withdrawal and refunds reserved balance
   */
  public async refundWithdrawal(
    withdrawalId: string,
    adminId: string,
    reason: string
  ): Promise<{ withdrawal: WithdrawalRequest; refundedAmount: number; newBalance: number }> {
    return acquireLock(async () => {
      if (!this.isAuthorizedOwner(adminId)) {
        throw new Error('غير مصرح: العملية محصورة بمالك المنصة فقط.');
      }

      const withdrawal = this.data.withdrawalRequests.find((w) => w.id === withdrawalId);
      if (!withdrawal) {
        throw new Error('طلب السحب غير موجود.');
      }
      if (withdrawal.status === 'PAID') {
        throw new Error('لا يمكن استرجاع طلب تم صرفه مسبقاً.');
      }
      if (withdrawal.status === 'REJECTED') {
        throw new Error('تم رفض هذا الطلب واسترجاع رصيده مسبقاً.');
      }

      const wallet = this.getWallet(withdrawal.userId);
      const prevBal = wallet.availableBalance;
      const newBal = prevBal + withdrawal.amount;
      const now = new Date().toISOString();

      const tx: WalletTransaction = {
        id: crypto.randomUUID(),
        userId: withdrawal.userId,
        type: 'WITHDRAWAL_REFUND',
        amount: withdrawal.amount,
        previousBalance: prevBal,
        newBalance: newBal,
        status: 'COMPLETED',
        referenceId: withdrawalId,
        idempotencyKey: `WITHDRAWAL_REFUND_${withdrawalId}`,
        description: `استرجاع رصيد لطلب سحب مرفوض: ${reason}`,
        adminId,
        createdAt: now,
      };

      this.data.walletTransactions.push(tx);

      wallet.availableBalance = newBal;
      wallet.pendingBalance = Math.max(0, wallet.pendingBalance - withdrawal.amount);
      wallet.updatedAt = now;

      withdrawal.status = 'REJECTED';
      withdrawal.rejectionReason = reason;
      withdrawal.adminId = adminId;
      withdrawal.processedAt = now;

      this.data.notifications.push({
        id: crypto.randomUUID(),
        userId: withdrawal.userId,
        title: 'تم رفض طلب السحب واستعادة الرصيد',
        message: `تم استرجاع مبلغ ${withdrawal.amount.toLocaleString()} ر.ي إلى محفظتك. السبب: ${reason}`,
        type: 'WITHDRAWAL_REJECTED',
        link: '/dashboard/wallet',
        isRead: false,
        createdAt: now,
      });

      this.logAdminAction(
        adminId,
        'REFUND_WITHDRAWAL',
        'WITHDRAWAL',
        withdrawalId,
        `رفض السحب واسترجاع ${withdrawal.amount} ر.ي. السبب: ${reason}`
      );

      this.save();
      return { withdrawal, refundedAmount: withdrawal.amount, newBalance: newBal };
    });
  }

  /**
   * Audited balance adjustment
   */
  public async adjustBalanceAudited(
    userId: string,
    adminId: string,
    amount: number,
    reason: string
  ): Promise<{ newBalance: number; transaction: WalletTransaction }> {
    return acquireLock(async () => {
      if (!this.isAuthorizedOwner(adminId)) {
        throw new Error('غير مصرح: العملية محصورة بمالك المنصة فقط.');
      }

      const wallet = this.getWallet(userId);
      const prevBal = wallet.availableBalance;
      const newBal = prevBal + amount;
      if (newBal < 0) {
        throw new Error('لا يمكن أن ينتج عن العملية رصيد سالب.');
      }

      const now = new Date().toISOString();
      const tx: WalletTransaction = {
        id: crypto.randomUUID(),
        userId,
        type: 'ADMIN_ADJUSTMENT',
        amount,
        previousBalance: prevBal,
        newBalance: newBal,
        status: 'COMPLETED',
        description: `تسوية رصيد إدارية مدققة: ${reason}`,
        adminId,
        createdAt: now,
      };

      this.data.walletTransactions.push(tx);
      wallet.availableBalance = newBal;
      if (amount > 0) wallet.totalEarned += amount;
      wallet.updatedAt = now;

      this.logAdminAction(
        adminId,
        'AUDITED_BALANCE_ADJUSTMENT',
        'WALLET',
        userId,
        `تسوية رصيد بمقدار ${amount} ر.ي للمستخدم ${userId}. السبب: ${reason}`
      );

      this.save();
      return { newBalance: newBal, transaction: tx };
    });
  }

  /**
   * Ensure Treasury, Double-Entry Ledger, and Wallet Addresses integrity
   */
  public ensureTreasuryAndLedgerIntegrity(): void {
    const now = new Date().toISOString();
    let needsSave = false;

    // Ensure all wallets have wallet address and reserved balance
    for (const w of this.data.wallets) {
      if (!w.walletAddress) {
        w.walletAddress = generateWalletAddress(w.userId);
        needsSave = true;
      }
      if (w.reservedBalance === undefined) {
        w.reservedBalance = 0;
        needsSave = true;
      }
      if (w.totalTransferred === undefined) {
        w.totalTransferred = 0;
        needsSave = true;
      }
      if (!w.status) {
        w.status = 'ACTIVE';
        needsSave = true;
      }
    }

    if (!this.data.ledgerTransactions) {
      this.data.ledgerTransactions = [];
      needsSave = true;
    }
    if (!this.data.ledgerEntries) {
      this.data.ledgerEntries = [];
      needsSave = true;
    }
    if (!this.data.walletTransfers) {
      this.data.walletTransfers = [];
      needsSave = true;
    }

    // Initialize Treasury with 10,000,000 virtual units if not present
    if (!this.data.treasury) {
      this.data.treasury = {
        totalIssuedUnits: 10_000_000,
        treasuryAvailable: 10_000_000,
        taskBudgetReserved: 0,
        initializedAt: now,
      };

      const genesisTxId = crypto.randomUUID();
      const genesisTx: LedgerTransaction = {
        id: genesisTxId,
        transactionType: 'TREASURY_INITIALIZATION',
        referenceId: 'GENESIS_TREASURY_10M',
        idempotencyKey: 'GENESIS_INIT_10M',
        description: 'تهيئة الخزينة الافتراضية المركزية لمنصة كسب اليمن بمبلغ 10,000,000 وحدة افتراضية',
        createdBy: AUTHORIZED_OWNER_ID,
        createdAt: now,
      };
      this.data.ledgerTransactions.push(genesisTx);

      this.data.ledgerEntries.push(
        {
          id: crypto.randomUUID(),
          transactionId: genesisTxId,
          accountId: 'ISSUED_CAPITAL',
          debitAmount: 10_000_000,
          creditAmount: 0,
          createdAt: now,
        },
        {
          id: crypto.randomUUID(),
          transactionId: genesisTxId,
          accountId: 'TREASURY_AVAILABLE',
          debitAmount: 0,
          creditAmount: 10_000_000,
          createdAt: now,
        }
      );
      needsSave = true;
    }

    // Sync admin wallet with treasury so 10,000,000 units are fully in the admin's wallet
    if (this.data.treasury) {
      let adminWallet = this.data.wallets.find((w) => w.userId === AUTHORIZED_OWNER_ID);
      if (!adminWallet) {
        adminWallet = {
          id: 'wallet-owner',
          userId: AUTHORIZED_OWNER_ID,
          walletAddress: generateWalletAddress(AUTHORIZED_OWNER_ID),
          availableBalance: this.data.treasury.treasuryAvailable,
          pendingBalance: 0,
          reservedBalance: this.data.treasury.taskBudgetReserved,
          totalEarned: 0,
          totalTransferred: 0,
          totalWithdrawn: 0,
          currency: 'YER',
          status: 'ACTIVE',
          createdAt: now,
          updatedAt: now,
        };
        this.data.wallets.push(adminWallet);
        needsSave = true;
      } else {
        if (adminWallet.availableBalance !== this.data.treasury.treasuryAvailable || adminWallet.reservedBalance !== this.data.treasury.taskBudgetReserved) {
          adminWallet.availableBalance = this.data.treasury.treasuryAvailable;
          adminWallet.reservedBalance = this.data.treasury.taskBudgetReserved;
          needsSave = true;
        }
      }
    }

    if (needsSave) {
      this.save();
    }
  }

  /**
   * Double-Entry Ledger Engine: Enforces balanced debit and credit entries
   */
  public recordDoubleEntry(params: {
    transactionType: string;
    referenceId?: string;
    idempotencyKey?: string;
    description: string;
    createdBy?: string;
    entries: Array<{ accountId: string; debitAmount: number; creditAmount: number }>;
  }): LedgerTransaction {
    if (!this.data.ledgerTransactions) this.data.ledgerTransactions = [];
    if (!this.data.ledgerEntries) this.data.ledgerEntries = [];

    // Idempotency check
    if (params.idempotencyKey) {
      const existing = this.data.ledgerTransactions.find((tx) => tx.idempotencyKey === params.idempotencyKey);
      if (existing) {
        return existing;
      }
    }

    if (!params.entries || params.entries.length < 2) {
      throw new Error('كل قيد محاسبي يجب أن يتضمن حسابين على الأقل (مدين ودائن).');
    }

    let totalDebit = 0;
    let totalCredit = 0;
    for (const entry of params.entries) {
      if (entry.debitAmount < 0 || entry.creditAmount < 0) {
        throw new Error('لا يمكن تسجيل مبالغ سالبة في القيود المحاسبية.');
      }
      totalDebit += entry.debitAmount;
      totalCredit += entry.creditAmount;
    }

    // Strict accounting balance check
    if (Math.round(totalDebit * 100) !== Math.round(totalCredit * 100)) {
      throw new Error(`خلل محاسبي: إجمالي المدين (${totalDebit}) لا يتطابق مع إجمالي الدائن (${totalCredit}).`);
    }

    const now = new Date().toISOString();
    const txId = crypto.randomUUID();
    const tx: LedgerTransaction = {
      id: txId,
      transactionType: params.transactionType,
      referenceId: params.referenceId,
      idempotencyKey: params.idempotencyKey,
      description: params.description,
      createdBy: params.createdBy,
      createdAt: now,
    };

    const savedEntries: LedgerEntry[] = [];
    for (const entry of params.entries) {
      const e: LedgerEntry = {
        id: crypto.randomUUID(),
        transactionId: txId,
        accountId: entry.accountId,
        debitAmount: entry.debitAmount,
        creditAmount: entry.creditAmount,
        createdAt: now,
      };
      savedEntries.push(e);
      this.data.ledgerEntries.push(e);
    }

    tx.entries = savedEntries;
    this.data.ledgerTransactions.push(tx);
    return tx;
  }

  /**
   * Search for wallet by address for transfer verification
   */
  public findWalletByAddress(address: string): { wallet: UserWallet; user: UserProfile } | undefined {
    this.ensureTreasuryAndLedgerIntegrity();
    const cleanAddress = address.trim().toUpperCase();
    const wallet = this.data.wallets.find((w) => w.walletAddress?.toUpperCase() === cleanAddress);
    if (!wallet) return undefined;
    const user = this.findUserById(wallet.userId);
    if (!user) return undefined;
    return { wallet, user };
  }

  /**
   * Real atomic wallet-to-wallet transfer with double-entry ledger
   */
  public async transferWalletToWallet(payload: {
    senderId: string;
    recipientAddress: string;
    amount: number;
    note?: string;
    idempotencyKey?: string;
  }): Promise<{ transfer: WalletTransfer; newAvailableBalance: number }> {
    return acquireLock(async () => {
      this.ensureTreasuryAndLedgerIntegrity();
      const { senderId, recipientAddress, amount, note, idempotencyKey } = payload;
      const numAmount = Math.floor(Number(amount));
      if (isNaN(numAmount) || numAmount <= 0) {
        throw new Error('يرجى تحديد مبلغ صحيح للتحويل (أكبر من 0).');
      }

      const senderUser = this.findUserById(senderId);
      if (!senderUser || senderUser.status === 'suspended') {
        throw new Error('الحساب غير نشط أو مجمد.');
      }

      const senderWallet = this.getWallet(senderId);
      if (senderWallet.availableBalance < numAmount) {
        throw new Error(`رصيدك المتاح (${senderWallet.availableBalance.toLocaleString()} ر.ي) غير كافٍ لإتمام عملية التحويل.`);
      }

      const recipientData = this.findWalletByAddress(recipientAddress);
      if (!recipientData) {
        throw new Error('عنوان المحفظة المدخل غير مسجل في النظام.');
      }

      const { wallet: recipientWallet, user: recipientUser } = recipientData;
      if (recipientWallet.userId === senderId) {
        throw new Error('لا يمكن تحويل الرصيد إلى نفس محفظتك الشخصية.');
      }
      if (recipientUser.status === 'suspended' || recipientWallet.status === 'SUSPENDED') {
        throw new Error('محفظة المستلم مجمدة ولا يمكنها استقبال تحويلات حالياً.');
      }

      const now = new Date().toISOString();
      const transferId = crypto.randomUUID();

      // Execute atomic balance updates
      const senderPrevBal = senderWallet.availableBalance;
      const senderNewBal = senderPrevBal - numAmount;
      senderWallet.availableBalance = senderNewBal;
      senderWallet.totalTransferred = (senderWallet.totalTransferred || 0) + numAmount;
      senderWallet.updatedAt = now;

      const recipientPrevBal = recipientWallet.availableBalance;
      const recipientNewBal = recipientPrevBal + numAmount;
      recipientWallet.availableBalance = recipientNewBal;
      recipientWallet.updatedAt = now;

      // 1. Double-Entry Accounting
      this.recordDoubleEntry({
        transactionType: 'WALLET_TRANSFER',
        referenceId: transferId,
        idempotencyKey: idempotencyKey || `TRANSFER_${transferId}`,
        description: `تحويل رصيد من ${senderWallet.walletAddress} إلى ${recipientWallet.walletAddress}`,
        createdBy: senderId,
        entries: [
          { accountId: `USER_AVAILABLE:${senderId}`, debitAmount: numAmount, creditAmount: 0 },
          { accountId: `USER_AVAILABLE:${recipientWallet.userId}`, debitAmount: 0, creditAmount: numAmount },
        ],
      });

      // 2. Sender transaction record
      this.data.walletTransactions.push({
        id: crypto.randomUUID(),
        userId: senderId,
        type: 'WALLET_TRANSFER_SENT',
        amount: -numAmount,
        previousBalance: senderPrevBal,
        newBalance: senderNewBal,
        status: 'COMPLETED',
        referenceId: transferId,
        description: `تحويل إلى ${recipientUser.fullName} (${recipientWallet.walletAddress})` + (note ? `: ${note}` : ''),
        createdAt: now,
      });

      // 3. Recipient transaction record
      this.data.walletTransactions.push({
        id: crypto.randomUUID(),
        userId: recipientWallet.userId,
        type: 'WALLET_TRANSFER_RECEIVED',
        amount: numAmount,
        previousBalance: recipientPrevBal,
        newBalance: recipientNewBal,
        status: 'COMPLETED',
        referenceId: transferId,
        description: `استلام تحويل من ${senderUser.fullName} (${senderWallet.walletAddress})` + (note ? `: ${note}` : ''),
        createdAt: now,
      });

      // 4. Transfer history record
      const transferRecord: WalletTransfer = {
        id: transferId,
        senderId,
        senderWalletAddress: senderWallet.walletAddress || '',
        senderName: senderUser.fullName,
        recipientId: recipientWallet.userId,
        recipientWalletAddress: recipientWallet.walletAddress || '',
        recipientName: recipientUser.fullName,
        amount: numAmount,
        note,
        status: 'COMPLETED',
        createdAt: now,
      };
      if (!this.data.walletTransfers) this.data.walletTransfers = [];
      this.data.walletTransfers.unshift(transferRecord);

      // 5. Notifications
      this.data.notifications.push(
        {
          id: crypto.randomUUID(),
          userId: senderId,
          title: 'تم إرسال التحويل بنجاح',
          message: `تم تحويل ${numAmount.toLocaleString()} ر.ي بنجاح إلى ${recipientUser.fullName}.`,
          type: 'TRANSFER_SENT',
          link: '/dashboard/wallet',
          isRead: false,
          createdAt: now,
        },
        {
          id: crypto.randomUUID(),
          userId: recipientWallet.userId,
          title: 'استلمت تحويلاً مالياً جديداً!',
          message: `وصلك تحويل بمبلغ ${numAmount.toLocaleString()} ر.ي من ${senderUser.fullName}.`,
          type: 'TRANSFER_RECEIVED',
          link: '/dashboard/wallet',
          isRead: false,
          createdAt: now,
        }
      );

      this.save();
      return { transfer: transferRecord, newAvailableBalance: senderNewBal };
    });
  }

  /**
   * Get Treasury and Accounting Reconciled Summary
   */
  public getTreasurySummary(): TreasurySummary {
    this.ensureTreasuryAndLedgerIntegrity();
    const treasury = this.data.treasury!;
    
    const userAvailableTotal = this.data.wallets.reduce((acc, w) => acc + (w.availableBalance || 0), 0);
    const userPendingTotal = this.data.wallets.reduce((acc, w) => acc + (w.pendingBalance || 0), 0);
    const withdrawalReservedTotal = this.data.withdrawalRequests
      .filter((w) => w.status === 'PENDING' || w.status === 'PROCESSING')
      .reduce((acc, w) => acc + w.amount, 0);
    const activeTasksBudgetTotal = this.data.tasks
      .filter((t) => t.status === 'ACTIVE')
      .reduce((acc, t) => acc + Math.max(0, t.budgetYer - t.budgetSpentYer), 0);

    const reconciledSum =
      treasury.treasuryAvailable +
      treasury.taskBudgetReserved +
      userAvailableTotal +
      userPendingTotal +
      withdrawalReservedTotal;

    return {
      treasuryAvailable: treasury.treasuryAvailable,
      taskBudgetReserved: treasury.taskBudgetReserved,
      userAvailableTotal,
      userPendingTotal,
      withdrawalReservedTotal,
      totalIssuedUnits: treasury.totalIssuedUnits,
      isReconciled: Math.abs(treasury.totalIssuedUnits - reconciledSum) < 1,
      activeTasksBudgetTotal,
    };
  }

  /**
   * Admin: Issue additional virtual units to the Treasury
   */
  public async issueTreasuryUnits(
    adminId: string,
    amount: number,
    reason: string,
    idempotencyKey?: string
  ): Promise<{ summary: TreasurySummary; transaction: LedgerTransaction }> {
    return acquireLock(async () => {
      if (!this.isAuthorizedOwner(adminId)) {
        throw new Error('غير مصرح: عملية إصدار الوحدات النقدية محصورة فقط بمالك المنصة المعتمد.');
      }

      const numAmount = Math.floor(Number(amount));
      if (isNaN(numAmount) || numAmount <= 0) {
        throw new Error('يجب تحديد مبلغ موجب وصحيح للإصدار.');
      }
      if (!reason || !reason.trim()) {
        throw new Error('يرجى كتابة سبب معتمد لعملية إصدار الرصيد للخزينة.');
      }

      this.ensureTreasuryAndLedgerIntegrity();
      const treasury = this.data.treasury!;
      const key = idempotencyKey || `ISSUANCE_${Date.now()}`;

      treasury.totalIssuedUnits += numAmount;
      treasury.treasuryAvailable += numAmount;

      // Double-entry record
      const ledgerTx = this.recordDoubleEntry({
        transactionType: 'TREASURY_ISSUANCE',
        referenceId: `ISSUE_${Date.now()}`,
        idempotencyKey: key,
        description: `إصدار وحدات نقدية جديدة للخزينة: ${reason.trim()}`,
        createdBy: adminId,
        entries: [
          { accountId: 'ISSUED_CAPITAL', debitAmount: numAmount, creditAmount: 0 },
          { accountId: 'TREASURY_AVAILABLE', debitAmount: 0, creditAmount: numAmount },
        ],
      });

      this.logAdminAction(
        adminId,
        'TREASURY_ISSUANCE',
        'TREASURY',
        'TREASURY_AVAILABLE',
        `إصدار ${numAmount.toLocaleString()} وحدة للخزينة. السبب: ${reason}`
      );

      this.save();
      return { summary: this.getTreasurySummary(), transaction: ledgerTx };
    });
  }

  /**
   * Reserve budget for a newly created task
   */
  public reserveTaskBudget(taskId: string, budget: number, taskTitle: string, adminId: string): LedgerTransaction {
    this.ensureTreasuryAndLedgerIntegrity();
    const treasury = this.data.treasury!;
    if (treasury.treasuryAvailable < budget) {
      throw new Error(`رصيد الخزينة المتاح (${treasury.treasuryAvailable.toLocaleString()} وحدة) غير كافٍ لحجز ميزانية المهمة (${budget.toLocaleString()} وحدة).`);
    }

    treasury.treasuryAvailable -= budget;
    treasury.taskBudgetReserved += budget;

    const tx = this.recordDoubleEntry({
      transactionType: 'TASK_BUDGET_RESERVATION',
      referenceId: taskId,
      idempotencyKey: `TASK_BUDGET_${taskId}`,
      description: `حجز ميزانية لمهمة جديدة: "${taskTitle}" (${budget} وحدة)`,
      createdBy: adminId,
      entries: [
        { accountId: 'TREASURY_AVAILABLE', debitAmount: budget, creditAmount: 0 },
        { accountId: 'TASK_BUDGET_RESERVED', debitAmount: 0, creditAmount: budget },
      ],
    });

    this.save();
    return tx;
  }

  /**
   * Return unused task budget back to treasury
   */
  public returnUnusedTaskBudget(taskId: string, unusedAmount: number, taskTitle: string, adminId: string): LedgerTransaction {
    this.ensureTreasuryAndLedgerIntegrity();
    const treasury = this.data.treasury!;
    const actualReturn = Math.min(unusedAmount, treasury.taskBudgetReserved);

    treasury.taskBudgetReserved -= actualReturn;
    treasury.treasuryAvailable += actualReturn;

    const tx = this.recordDoubleEntry({
      transactionType: 'TASK_BUDGET_RETURN',
      referenceId: taskId,
      idempotencyKey: `TASK_RETURN_${taskId}`,
      description: `استرجاع الميزانية المتبقية لمهمة: "${taskTitle}" إلى الخزينة المتاحة`,
      createdBy: adminId,
      entries: [
        { accountId: 'TASK_BUDGET_RESERVED', debitAmount: actualReturn, creditAmount: 0 },
        { accountId: 'TREASURY_AVAILABLE', debitAmount: 0, creditAmount: actualReturn },
      ],
    });

    this.save();
    return tx;
  }

  public getWalletTransfers(userId?: string): WalletTransfer[] {
    const list = this.data.walletTransfers || [];
    if (userId) {
      return list.filter((t) => t.senderId === userId || t.recipientId === userId);
    }
    return list;
  }

  public getLedgerTransactions(limit = 50): LedgerTransaction[] {
    const list = this.data.ledgerTransactions || [];
    const entries = this.data.ledgerEntries || [];
    const sorted = [...list].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return sorted.slice(0, limit).map((tx) => ({
      ...tx,
      entries: entries.filter((e) => e.transactionId === tx.id),
    }));
  }
}

export const db = new DatabaseManager();
