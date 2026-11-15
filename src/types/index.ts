/**
 * Kasb Yemen - Core Domain Models & Types
 */

export type UserRole = 'user' | 'admin';
export type AccountStatus = 'active' | 'suspended' | 'under_review';

export interface UserProfile {
  id: string;
  fullName: string;
  phone: string;
  email?: string;
  avatarUrl?: string;
  role: UserRole;
  status: AccountStatus;
  referralCode: string;
  referredBy?: string;
  city: string;
  createdAt: string;
  updatedAt: string;
}

export interface UserWallet {
  id: string;
  userId: string;
  walletAddress?: string; // Format: KY-XXXXXXXXXXXX
  availableBalance: number; // in YER (Yemeni Riyals)
  pendingBalance: number;
  reservedBalance?: number;
  totalEarned: number;
  totalTransferred?: number;
  totalWithdrawn: number;
  status?: 'ACTIVE' | 'SUSPENDED';
  currency: 'YER';
  createdAt: string;
  updatedAt: string;
}

export type TransactionType =
  | 'TASK_REWARD'
  | 'WITHDRAWAL_REQUEST'
  | 'WITHDRAWAL_PAYOUT'
  | 'WITHDRAWAL_REFUND'
  | 'REFERRAL_REWARD'
  | 'ADMIN_ADJUSTMENT'
  | 'PROMOTIONAL_BONUS'
  | 'WALLET_TRANSFER_SENT'
  | 'WALLET_TRANSFER_RECEIVED'
  | 'TREASURY_ISSUANCE'
  | 'TASK_BUDGET_RESERVE'
  | 'TASK_BUDGET_RETURN'
  | 'TASK_COMMISSION_REVENUE'
  | 'OWNER_CAPITAL_DEPOSIT'
  | 'OPERATIONAL_EXPENSE'
  | 'OWNER_WITHDRAWAL'
  | 'AD_REVENUE'
  | 'SUBSCRIPTION_REVENUE'
  | 'SERVICE_REVENUE'
  | 'PAYMENT_PROVIDER_FEE'
  | 'TAX_ACCRUAL'
  | 'TAX_SETTLEMENT'
  | 'REVERSAL';

export interface WalletTransaction {
  id: string;
  userId: string;
  type: TransactionType;
  amount: number; // Positive for credits, negative for debits
  previousBalance: number;
  newBalance: number;
  status: 'COMPLETED' | 'PENDING' | 'CANCELLED';
  referenceId?: string;
  idempotencyKey?: string;
  description: string;
  adminId?: string;
  createdAt: string;
}

export interface WalletTransfer {
  id: string;
  senderId: string;
  senderWalletAddress: string;
  senderName: string;
  recipientId: string;
  recipientWalletAddress: string;
  recipientName: string;
  amount: number;
  note?: string;
  status: 'COMPLETED' | 'FAILED';
  createdAt: string;
}

export interface TreasurySummary {
  treasuryAvailable: number;
  taskBudgetReserved: number;
  userAvailableTotal: number;
  userPendingTotal: number;
  withdrawalReservedTotal: number;
  totalIssuedUnits: number;
  isReconciled: boolean;
  activeTasksBudgetTotal: number;
  withdrawalSettledTotal?: number;
  cashVaultTotal?: number;
  ownerCapitalTotal?: number;
  ownerWithdrawalsTotal?: number;
  expensesTotal?: number;
  providerFeesTotal?: number;
  totalOperationalExpenses?: number;
  netProfitLoss?: number;
  retainedEarningsTotal?: number;
  computedRetainedEarnings?: number;
  taxPayableTotal?: number;
  taxesPaidTotal?: number;
  userLiabilitiesTotal?: number;
  revenueTotals?: {
    tasks: number;
    ads: number;
    subscriptions: number;
    services: number;
    total: number;
  };
  migration011Ready?: boolean;
  missingMigration011Accounts?: string[];
  taxTablesReady?: boolean;
  auditLogsTableReady?: boolean;
  withdrawalsTableReady?: boolean;
}

export interface LedgerTransaction {
  id: string;
  transactionType: string;
  status?: string;
  referenceId?: string;
  idempotencyKey?: string;
  description: string;
  metadata?: Record<string, any>;
  createdBy?: string;
  createdByName?: string;
  createdAt: string;
  isReversed?: boolean;
  reversedByTransactionId?: string;
  totalAmount?: number;
  entries?: LedgerEntry[];
}

export interface LedgerEntry {
  id: string;
  transactionId: string;
  accountId: string;
  accountCode?: string;
  accountType?: string;
  normalSide?: 'debit' | 'credit';
  debitAmount: number;
  creditAmount: number;
  memo?: string;
  createdAt: string;
}

export interface TreasuryMovement {
  transactionId: string;
  transactionType: string;
  accountCode: 'PLATFORM-TREASURY' | 'PLATFORM-CASH-VAULT';
  entrySide: 'debit' | 'credit';
  amount: number;
  signedDelta: number;
  beforeBalance: number;
  afterBalance: number;
  description: string;
  referenceId?: string;
  createdAt: string;
}

export interface FinancialAccountItem {
  id: string;
  accountCode: string;
  accountType: string;
  normalSide: string;
  balanceUnits: number;
  status: string;
  createdAt: string;
}

export interface TaxDefinition {
  id: string;
  taxType: string;
  taxAuthority: string;
  region: string;
  taxBase: string;
  ratePercentage: number;
  flatAmount: number;
  validFrom: string;
  validTo?: string | null;
  isActive: boolean;
  exemptionsRules?: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

export interface TaxSettlement {
  id: string;
  taxDefinitionId: string;
  taxType?: string;
  taxAuthority?: string;
  taxableAmount: number;
  taxAmount: number;
  status: 'PENDING' | 'SETTLED' | 'CANCELLED';
  ledgerTransactionId?: string | null;
  settledAt?: string | null;
  referenceId?: string | null;
  createdAt: string;
}

export interface FinancialAuditLog {
  id: string;
  actionType: string;
  actorId?: string | null;
  actorName?: string;
  transactionId?: string | null;
  details: Record<string, any>;
  ipAddress?: string | null;
  createdAt: string;
  source: 'financial_audit_logs' | 'admin_logs';
}

export interface ComprehensiveFinancialReport {
  period: {
    from: string | null;
    to: string | null;
    generatedAt: string;
  };
  readiness: {
    migration011Ready: boolean;
    missingMigration011Accounts: string[];
    taxTablesReady: boolean;
    withdrawalsTableReady: boolean;
    auditLogsTableReady: boolean;
  };
  profitAndLoss: {
    revenueTasks: number;
    revenueAds: number;
    revenueSubscriptions: number;
    revenueServices: number;
    totalRevenue: number;
    operationalExpenses: number;
    paymentProviderFees: number;
    taxExpenses: number;
    totalExpenses: number;
    netProfitLoss: number;
    taskRewardsDisbursedNote: number;
  };
  cashFlow: {
    operatingCashInflows: number;
    operatingCashOutflows: number;
    netOperatingCashFlow: number;
    ownerCapitalInflows: number;
    ownerWithdrawalsOutflows: number;
    netFinancingCashFlow: number;
    netCashChange: number;
    endingCashVaultBalance: number;
    virtualTreasuryAvailable: number;
  };
  balanceSheet: {
    assets: {
      cashVault: number;
      virtualIssuanceControl: number;
      totalRealAssets: number;
    };
    liabilities: {
      userWalletBalances: number;
      withdrawalReserved: number;
      taskEscrowBalances: number;
      taxesPayable: number;
      expenseClearing: number;
      totalUserAndExternalLiabilities: number;
    };
    equity: {
      ownerCapital: number;
      ownerWithdrawals: number;
      retainedEarningsAccount: number;
      currentNetIncome: number;
      totalOwnerEquity: number;
    };
  };
  revenueBySource: Array<{
    accountCode: string;
    label: string;
    periodAmount: number;
    cumulativeBalance: number;
    txCount: number;
  }>;
  expensesItems: Array<{
    transactionId: string;
    date: string;
    category: string;
    accountCode: string;
    amount: number;
    description: string;
    referenceId?: string;
  }>;
  taxesReport: {
    taxPayableBalance: number;
    totalAccruedInPeriod: number;
    totalSettledInPeriod: number;
    activeDefinitionsCount: number;
    settlements: TaxSettlement[];
  };
  ownerWithdrawalsReport: {
    totalInPeriod: number;
    cumulativeTotal: number;
    items: Array<{
      transactionId: string;
      date: string;
      amount: number;
      description: string;
      actorName?: string;
    }>;
  };
  userBalancesAndEscrowsReport: {
    totalUserWallets: number;
    totalWithdrawalReserved: number;
    totalTaskEscrows: number;
    users: Array<{
      userId: string;
      fullName: string;
      phone: string;
      accountCode: string;
      balanceUnits: number;
      status: string;
    }>;
    escrows: Array<{
      accountCode: string;
      taskId: string;
      taskTitle: string;
      taskStatus: string;
      balanceUnits: number;
    }>;
  };
  dailyBreakdown: Array<{
    date: string;
    revenues: number;
    expenses: number;
    taskRewards: number;
    withdrawals: number;
  }>;
}

export type TaskCategory =
  | 'app_testing'
  | 'surveys'
  | 'social_engagement'
  | 'content_writing'
  | 'data_entry'
  | 'review_ratings'
  | 'local_services';

export interface TaskItem {
  id: string;
  title: string;
  description: string;
  category: TaskCategory;
  rewardYer: number;
  steps: string[];
  proofRequirements: {
    requireImage: boolean;
    requireText: boolean;
    requireUrl?: boolean;
    instructions?: string;
  };
  timeEstimateMinutes: number;
  totalQuantity: number;
  completedQuantity: number;
  maxPerUser: number;
  budgetYer: number;
  budgetSpentYer: number;
  deadline?: string;
  status: 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'ARCHIVED';
  createdBy?: string;
  createdAt: string;
}

export type SubmissionStatus = 'PENDING' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED';

export interface TaskSubmission {
  id: string;
  taskId: string;
  userId: string;
  userFullName?: string;
  userPhone?: string;
  taskTitle?: string;
  taskRewardYer?: number;
  proofText?: string;
  proofImages: string[];
  proofUrl?: string;
  status: SubmissionStatus;
  rejectionReason?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  rewardTransactionId?: string;
  createdAt: string;
}

export type PayoutMethodCode = 'KURAIMI' | 'NAJM' | 'JAWALI' | 'ONE_CASH';

export interface PayoutMethod {
  id: string;
  code: PayoutMethodCode;
  name: string;
  nameAr: string;
  minWithdrawal: number;
  maxWithdrawal: number;
  feePercentage: number;
  feeFlat: number;
  isActive: boolean;
  requiredFields: string[];
}

export type WithdrawalStatus = 'PENDING' | 'PROCESSING' | 'PAID' | 'REJECTED' | 'CANCELLED';

export interface WithdrawalRequest {
  id: string;
  userId: string;
  userFullName?: string;
  userPhone?: string;
  method: PayoutMethodCode;
  methodNameAr?: string;
  amount: number;
  fee: number;
  netAmount: number;
  beneficiaryName: string;
  phoneNumber: string;
  accountNumber?: string;
  status: WithdrawalStatus;
  rejectionReason?: string;
  transferReference?: string;
  receiptUrl?: string;
  adminId?: string;
  processedAt?: string;
  createdAt: string;
}

export interface AppNotification {
  id: string;
  userId: string;
  title: string;
  message: string;
  type: string;
  link?: string;
  isRead: boolean;
  createdAt: string;
}

export interface PlatformSettings {
  id: string;
  platformName: string;
  currency: 'YER';
  minWithdrawal: number;
  maxWithdrawal: number;
  dailyWithdrawalLimit: number;
  defaultFeePercentage: number;
  referralBonus: number;
  taskSubmissionLimit: number;
  isRegistrationOpen: boolean;
  maintenanceMode: boolean;
  contactPhone: string;
  contactEmail: string;
  updatedAt: string;
}

export interface FinancialReportData {
  totalTaskExpenses: number;
  totalPaidWithdrawals: number;
  totalPendingWithdrawals: number;
  totalAvailableLiabilities: number;
  totalReferralExpenses: number;
  netPlatformVolume: number;
  dailyBreakdown: Array<{
    date: string;
    taskRewards: number;
    withdrawals: number;
    newUsers: number;
  }>;
}

export type ReferralRewardStatus = 'awaiting_first_task' | 'pending' | 'approved' | 'paid' | 'rejected';

export interface ReferralStat {
  code: string;
  shareUrl: string;
  referralBonus: number;
  totalReferred: number;
  qualifiedReferralsCount: number;
  paidRewardsCount: number;
  totalEarnedYer: number;
  referredUsers: Array<{
    id: string;
    fullName: string;
    createdAt: string;
    hasCompletedFirstTask: boolean;
    rewardStatus: ReferralRewardStatus;
    rewardEarned: number;
    paidAt?: string | null;
  }>;
}

export interface SupportTicket {
  id: string;
  userId: string;
  subject: string;
  status: 'OPEN' | 'ANSWERED' | 'CLOSED';
  priority: 'LOW' | 'MEDIUM' | 'HIGH';
  createdAt: string;
  updatedAt: string;
  messages: Array<{
    id: string;
    senderId: string;
    senderRole: UserRole;
    senderName: string;
    message: string;
    createdAt: string;
  }>;
}

export type ErrorType =
  | 'NETWORK_CONNECTION'
  | 'AUTHENTICATION'
  | 'PERMISSIONS_RLS'
  | 'MISSING_TABLE_COLUMN'
  | 'CONSTRAINT_VIOLATION'
  | 'POSTGRES_INTERNAL'
  | 'RPC_FUNCTION_ERROR'
  | 'DATA_WRITE_ERROR'
  | 'DATA_READ_ERROR'
  | 'STORAGE_ERROR'
  | 'TIMEOUT_ERROR'
  | 'UNKNOWN_ERROR';

export type SeverityLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface SystemErrorLog {
  id: string;
  errorCode?: string;
  errorType: ErrorType;
  severity: SeverityLevel;
  operation: string;
  sourceTable?: string;
  sourceFunction?: string;
  apiRoute?: string;
  message: string;
  details?: Record<string, any>;
  requestId?: string;
  environment: 'Production' | 'Development';
  executionDurationMs?: number;
  resolved: boolean;
  resolutionNote?: string;
  occurredAt: string;
  resolvedAt?: string;
}

export interface DatabaseMonitoringStats {
  isConnected: boolean;
  pingMs: number;
  lastSuccessfulConnection: string;
  lastErrorTimestamp: string | null;
  errors24h: number;
  errors7d: number;
  totalSuccessfulOps: number;
  totalFailedOps: number;
  lastFailedOp?: {
    operation: string;
    message: string;
    occurredAt: string;
  } | null;
  errorTypeBreakdown: Record<string, number>;
}

export interface ErrorAggregationGroup {
  errorType: ErrorType | string;
  sourceTable: string;
  count: number;
  unresolvedCount: number;
  lastOccurredAt: string;
  sampleMessage: string;
  sampleCode?: string;
}
