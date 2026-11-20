/**
 * Kasb Yemen - Core Domain Models & Types
 */

export type UserRole = 'user' | 'admin' | 'advertiser';
export type AccountStatus = 'active' | 'suspended' | 'under_review' | 'pending';

export interface CountryItem {
  id: string;
  iso2: string;
  iso3: string;
  nameAr: string;
  nameEn: string;
  phoneCode?: string | null;
  flagEmoji: string;
  isActive: boolean;
  sortOrder: number;
  dataSource?: string | null;
  dataLicense?: string | null;
  lastSyncedAt?: string | null;
}

export interface CountryAdminLevel {
  id: string;
  countryId: string;
  levelOrder: number;
  nameAr: string;
  nameEn: string;
  pluralAr?: string | null;
  isRequired: boolean;
  isActive: boolean;
}

export interface AdministrativeDivision {
  id: string;
  countryId: string;
  levelId: string;
  levelOrder?: number;
  levelNameAr?: string;
  levelNameEn?: string;
  parentId: string | null;
  code?: string | null;
  geonamesId?: number | null;
  wikidataId?: string | null;
  nameAr: string;
  nameEn: string;
  latitude?: number | null;
  longitude?: number | null;
  isActive: boolean;
  hasChildren?: boolean;
  dataSource?: string;
  dataLicense?: string;
  sourceUrl?: string | null;
  lastSyncedAt?: string | null;
}

export interface GeoPathItem {
  id: string;
  levelOrder: number;
  levelNameAr: string;
  levelNameEn?: string;
  nameAr: string;
  nameEn: string;
}

export interface GeoTargetSummary {
  id: string;
  countryId: string;
  nameAr: string;
  nameEn: string;
  levelNameAr?: string;
}

export interface AdminGeoOverviewCountry extends CountryItem {
  levels: CountryAdminLevel[];
  divisionsCount: number;
  level1Count: number;
  level2Count: number;
  level3Count: number;
  usersCount: number;
  tasksCount: number;
}

export interface AdminGeoOverview {
  geoTablesReady: boolean;
  tablesExist: boolean;
  seeded: boolean;
  sourceMode: 'supabase' | 'dataset_fallback';
  totalCountries: number;
  activeCountries: number;
  totalLevels: number;
  totalDivisions: number;
  countries: AdminGeoOverviewCountry[];
}

export interface GeoIntegrityReport {
  geoTablesReady: boolean;
  tablesExist: boolean;
  seeded: boolean;
  sourceMode: 'supabase' | 'dataset_fallback';
  isHealthy: boolean;
  totalCountries: number;
  activeCountries: number;
  totalLevels: number;
  totalDivisions: number;
  checks: {
    countriesMissingDivisions: string[];
    missingNamesCount: number;
    crossCountryParentCount: number;
    invalidLevelOrderCount: number;
    cyclesCount: number;
    duplicateCodeCount: number;
    duplicateSiblingCount: number;
    unlinkedProfilesCount: number;
    unlinkedTasksCount: number;
  };
  checkedAt: string;
}

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
  areaName?: string | null;
  countryId?: string | null;
  countryCode?: string | null;
  countryNameAr?: string | null;
  countryFlag?: string | null;
  administrativeDivisionId?: string | null;
  locationPath?: string | null;
  companyName?: string;
  contactPerson?: string;
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
  | 'CAMPAIGN_FUNDING_RESERVE'
  | 'CAMPAIGN_ESCROW_REFUND'
  | 'CLIXWALL_REWARD'
  | 'CLIXWALL_REVERSAL'
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
  metadata?: Record<string, any>;
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
  campaignBudgetReserved?: number;
  campaignFeeReserved?: number;
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
    clixwall: number;
    subscriptions: number;
    services: number;
    total: number;
  };
  migration011Ready?: boolean;
  missingMigration011Accounts?: string[];
  taxTablesReady?: boolean;
  auditLogsTableReady?: boolean;
  withdrawalsTableReady?: boolean;
  externalAccountsReady?: boolean;
  externalAccountsTotal?: number;
  externalPlatformBalance?: number;
  externalAdvertiserCustodyBalance?: number;
  advertiserWalletTotal?: number;
  workerWalletTotal?: number;
  pendingExternalDepositsCount?: number;
  pendingExternalDepositsAmount?: number;
  externalAdvertiserDepositsTotal?: number;
  fundSegregation?: FundSegregationSummary;
}

export type ExternalAccountOwnerRole = 'owner' | 'admin' | 'company';
export type ExternalAccountType = 'bank' | 'exchange' | 'ewallet' | 'cash';
export type ExternalFundScope = 'platform' | 'advertiser' | 'mixed';

export interface ExternalAccount {
  id: string;
  accountName: string;
  ownerName: string;
  ownerRole: ExternalAccountOwnerRole;
  accountType: ExternalAccountType;
  providerName: string;
  accountNumber: string;
  currency: string;
  fundScope: ExternalFundScope;
  financialAccountId: string;
  accountCode: string;
  accountingBalance: number;
  actualBalance: number;
  discrepancyUnits: number;
  lastReconciledAt?: string | null;
  status: 'active' | 'frozen';
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExternalDeposit {
  id: string;
  externalAccountId: string;
  externalAccountName?: string;
  externalAccountCode?: string;
  depositPurpose: 'advertiser_wallet' | 'platform_capital';
  advertiserId?: string | null;
  advertiserName?: string | null;
  advertiserCompany?: string | null;
  amountUnits: number;
  referenceNumber: string;
  receiptUrl: string;
  depositorName?: string | null;
  depositorPhone?: string | null;
  notes?: string | null;
  status: 'pending' | 'approved' | 'rejected';
  reviewedBy?: string | null;
  reviewedByName?: string | null;
  reviewedAt?: string | null;
  rejectionReason?: string | null;
  ledgerTransactionId?: string | null;
  createdAt: string;
}

export interface ExternalAccountTransfer {
  id: string;
  fromExternalAccountId?: string | null;
  toExternalAccountId?: string | null;
  fromFinancialAccountId: string;
  toFinancialAccountId: string;
  fromAccountName: string;
  fromAccountCode: string;
  toAccountName: string;
  toAccountCode: string;
  amountUnits: number;
  referenceNumber?: string | null;
  reason: string;
  ledgerTransactionId: string;
  createdBy?: string | null;
  createdByName?: string | null;
  createdAt: string;
}

export interface ExternalAccountReconciliation {
  id: string;
  externalAccountId: string;
  externalAccountName?: string;
  accountingBalanceUnits: number;
  actualBalanceUnits: number;
  discrepancyUnits: number;
  adjustmentTransactionId?: string | null;
  adjustmentReason?: string | null;
  status: 'matched' | 'discrepancy' | 'adjusted';
  reconciledBy?: string | null;
  reconciledByName?: string | null;
  createdAt: string;
}

export interface FundSegregationSummary {
  platformFunds: {
    cashVaultTotal: number;
    externalPlatformBalance: number;
    realizedRevenuesTotal: number;
    operationalExpensesTotal: number;
    ownerCapitalTotal: number;
    ownerWithdrawalsTotal: number;
    netOwnerEquity: number;
    virtualTreasuryAvailable: number;
  };
  advertiserFunds: {
    advertiserWalletsTotal: number;
    campaignBudgetEscrow: number;
    campaignFeeEscrow: number;
    totalAdvertiserLiabilities: number;
    pendingExternalDepositsCount: number;
    pendingExternalDepositsAmount: number;
    approvedExternalDepositsTotal: number;
  };
  userFunds: {
    workerWalletsTotal: number;
    withdrawalReservedTotal: number;
    adminTaskEscrowTotal: number;
    totalUserLiabilities: number;
  };
  externalAccountsSummary: {
    totalAccountingBalance: number;
    totalActualBalance: number;
    totalDiscrepancy: number;
    activeAccountsCount: number;
  };
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
    revenueClixwall?: number;
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
      externalAccounts?: number;
      externalPlatformAccounts?: number;
      externalAdvertiserCustodyAccounts?: number;
      virtualIssuanceControl: number;
      totalRealAssets: number;
    };
    liabilities: {
      userWalletBalances: number;
      advertiserWalletBalances?: number;
      workerWalletBalances?: number;
      withdrawalReserved: number;
      taskEscrowBalances: number;
      campaignBudgetEscrows?: number;
      campaignFeeEscrows?: number;
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
  fundSegregation?: FundSegregationSummary;
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

export type TaskKind =
  | 'surveys'
  | 'ad_watch'
  | 'app_testing'
  | 'quick_tasks'
  | 'external_offers';

export interface TaskTypeSpecificFields {
  // surveys
  questions?: string[];
  optionsText?: string;
  // ad_watch
  adUrl?: string;
  watchDurationSeconds?: number;
  completionRule?: string;
  // app_testing
  appDownloadUrl?: string;
  testingInstructions?: string;
  requiredProofNote?: string;
  // quick_tasks
  steps?: string[];
  proofNotes?: string;
  // external_offers
  partnerName?: string;
  offerUrl?: string;
  offerConditions?: string;
}

export interface TaskBuilderMeta {
  taskKind: TaskKind;
  isFeatured?: boolean;
  featuredRequested?: boolean;
  priority?: number;
  fields?: TaskTypeSpecificFields;
}

export interface TaskItem {
  id: string;
  title: string;
  description: string;
  category: TaskCategory;
  taskKind?: TaskKind;
  isFeatured?: boolean;
  priority?: number;
  taskMeta?: TaskBuilderMeta;
  rewardYer: number;
  steps: string[];
  proofRequirements: {
    requireImage: boolean;
    requireText: boolean;
    requireUrl?: boolean;
    instructions?: string;
    _taskMeta?: TaskBuilderMeta;
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
  campaignId?: string | null;
  isExternalCampaign?: boolean;
  hideAdvertiserName?: boolean;
  advertiserDisplayName?: string;
  advertiserLogoUrl?: string;
  countryId?: string | null;
  countryCode?: string | null;
  countryNameAr?: string | null;
  countryFlag?: string | null;
  administrativeDivisionId?: string | null;
  isNationwide?: boolean;
  targetDivisionIds?: string[];
  targetDivisions?: GeoTargetSummary[];
  locationLabel?: string | null;
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

export type AdPartnerCodeType = 'html' | 'javascript' | 'iframe';
export type AdPartnerRotationMode = 'single' | 'rotate';

export interface AdPartner {
  id: string;
  partnerName: string;
  placementKey: string;
  codeType: AdPartnerCodeType;
  code: string;
  width: number;
  height: number;
  rotationMode: AdPartnerRotationMode;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CampaignFeePolicy {
  defaultFeePercentage: number;
  minFeeYer?: number;
  categoryFeePercentages?: Record<string, number>;
}

export interface PlatformSettings {
  id: string;
  platformName: string;
  currency: 'YER';
  minWithdrawal: number;
  maxWithdrawal: number;
  dailyWithdrawalLimit: number;
  defaultFeePercentage: number;
  advertiserCampaignFeePercentage: number;
  campaignFeePolicy?: CampaignFeePolicy;
  referralBonus: number;
  taskSubmissionLimit: number;
  isRegistrationOpen: boolean;
  maintenanceMode: boolean;
  contactPhone: string;
  contactEmail: string;
  updatedAt: string;
}

export type CampaignStatus =
  | 'pending_approval'
  | 'pending_start'
  | 'active'
  | 'paused'
  | 'completed'
  | 'cancelled'
  | 'rejected';

export interface CampaignItem {
  id: string;
  advertiserId: string;
  advertiserName?: string;
  advertiserCompany?: string;
  hideAdvertiserName?: boolean;
  advertiserDisplayName?: string;
  advertiserLogoUrl?: string;
  isExternalCampaign?: boolean;
  title: string;
  description: string;
  category: TaskCategory;
  rewardUnits: number;
  slots: number;
  budgetUnits: number;
  feePercentage: number;
  feeUnits: number;
  totalUnits: number;
  refundedUnits: number;
  budgetEscrowBalance?: number;
  feeEscrowBalance?: number;
  status: CampaignStatus;
  creationKey: string;
  fundingTransactionId?: string | null;
  feeRevenueTransactionId?: string | null;
  settlementTransactionId?: string | null;
  linkedTaskId?: string | null;
  approvedCount?: number;
  timeEstimateMinutes: number;
  proofRequirements: {
    requireImage: boolean;
    requireText: boolean;
    requireUrl?: boolean;
    instructions?: string;
    _taskMeta?: TaskBuilderMeta;
  };
  taskKind?: TaskKind;
  isFeatured?: boolean;
  taskMeta?: TaskBuilderMeta;
  deadlineAt?: string | null;
  approvedAt?: string | null;
  approvedBy?: string | null;
  rejectedAt?: string | null;
  rejectedBy?: string | null;
  rejectionReason?: string | null;
  minFeeApplied?: boolean;
  feePolicySnapshot?: Record<string, any> | null;
  startedAt?: string | null;
  settledAt?: string | null;
  countryId?: string | null;
  countryCode?: string | null;
  countryNameAr?: string | null;
  countryFlag?: string | null;
  isNationwide?: boolean;
  targetDivisionIds?: string[];
  targetDivisions?: GeoTargetSummary[];
  createdAt: string;
  updatedAt: string;
}

export interface AdvertiserWalletSummary {
  advertiserId: string;
  availableBalance: number;
  reservedBudgetEscrow: number;
  reservedFeeEscrow: number;
  totalReserved: number;
  totalDeposited: number;
  totalSpent: number;
  totalRefunded: number;
  pendingDepositsCount: number;
  pendingDepositsAmount: number;
  recentDeposits: ExternalDeposit[];
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
