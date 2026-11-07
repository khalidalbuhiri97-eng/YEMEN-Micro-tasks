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
  | 'WITHDRAWAL_REFUND'
  | 'REFERRAL_REWARD'
  | 'ADMIN_ADJUSTMENT'
  | 'PROMOTIONAL_BONUS'
  | 'WALLET_TRANSFER_SENT'
  | 'WALLET_TRANSFER_RECEIVED'
  | 'TREASURY_ISSUANCE'
  | 'TASK_BUDGET_RESERVE'
  | 'TASK_BUDGET_RETURN';

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
}

export interface LedgerTransaction {
  id: string;
  transactionType: string;
  referenceId?: string;
  idempotencyKey?: string;
  description: string;
  createdBy?: string;
  createdAt: string;
  entries?: LedgerEntry[];
}

export interface LedgerEntry {
  id: string;
  transactionId: string;
  accountId: string;
  debitAmount: number;
  creditAmount: number;
  createdAt: string;
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

export interface ReferralStat {
  code: string;
  shareUrl: string;
  totalReferred: number;
  totalEarnedYer: number;
  referredUsers: Array<{
    id: string;
    fullName: string;
    createdAt: string;
    hasCompletedFirstTask: boolean;
    rewardEarned: number;
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
