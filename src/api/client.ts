/**
 * Kasb Yemen - Frontend API Client (Connected to Real Backend with Session Refresh & Persistence)
 */

const BASE_URL = '/api';

export class SessionExpiredError extends Error {
  constructor(message = 'انتهت صلاحية الجلسة، يرجى تسجيل الدخول مجدداً.') {
    super(message);
    this.name = 'SessionExpiredError';
  }
}

export function getAuthToken(): string | null {
  const token = localStorage.getItem('kasb_auth_token');
  if (!token || token === 'null' || token === 'undefined') {
    if (token) localStorage.removeItem('kasb_auth_token');
    return null;
  }
  return token;
}

export function getRefreshToken(): string | null {
  const token = localStorage.getItem('kasb_refresh_token');
  if (!token || token === 'null' || token === 'undefined') {
    if (token) localStorage.removeItem('kasb_refresh_token');
    return null;
  }
  return token;
}

export function setAuthTokens(token?: string | null, refreshToken?: string | null): void {
  if (token && token !== 'null' && token !== 'undefined') {
    localStorage.setItem('kasb_auth_token', token);
  }
  if (refreshToken && refreshToken !== 'null' && refreshToken !== 'undefined') {
    localStorage.setItem('kasb_refresh_token', refreshToken);
  }
}

export function setAuthToken(token: string): void {
  setAuthTokens(token);
}

export function clearAuthToken(): void {
  localStorage.removeItem('kasb_auth_token');
  localStorage.removeItem('kasb_refresh_token');
}

let activeRefreshPromise: Promise<string | null> | null = null;
let authExpiredDispatched = false;

function dispatchSessionExpiredOnce(): void {
  clearAuthToken();
  if (!authExpiredDispatched && typeof window !== 'undefined') {
    authExpiredDispatched = true;
    window.dispatchEvent(new CustomEvent('kasb:auth_expired'));
    setTimeout(() => {
      authExpiredDispatched = false;
    }, 1000);
  }
}

async function performTokenRefresh(): Promise<string | null> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return null;

  try {
    const response = await fetch(`${BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.token) {
      return null;
    }

    setAuthTokens(data.token, data.refreshToken || refreshToken);
    return data.token;
  } catch {
    return null;
  }
}

async function getOrRefreshAccessToken(): Promise<string | null> {
  if (!activeRefreshPromise) {
    activeRefreshPromise = performTokenRefresh().finally(() => {
      activeRefreshPromise = null;
    });
  }
  return activeRefreshPromise;
}

async function request<T>(endpoint: string, options: RequestInit = {}, retries = 2): Promise<T> {
  let token = getAuthToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(`${BASE_URL}${endpoint}`, {
        ...options,
        headers: token ? { ...headers, Authorization: `Bearer ${token}` } : headers,
      });

      // Handle 401 unauthorized with single-flight shared token refresh attempt
      if (response.status === 401 && !endpoint.includes('/auth/login') && !endpoint.includes('/auth/refresh') && !endpoint.includes('/auth/register')) {
        const newToken = await getOrRefreshAccessToken();
        if (newToken) {
          token = newToken;
          const retryResponse = await fetch(`${BASE_URL}${endpoint}`, {
            ...options,
            headers: { ...headers, Authorization: `Bearer ${newToken}` },
          });
          const retryData = await retryResponse.json().catch(() => ({}));
          if (retryResponse.status === 401) {
            dispatchSessionExpiredOnce();
            throw new SessionExpiredError();
          }
          if (!retryResponse.ok) {
            throw new Error(retryData.error || `خطأ في الخادم (رمز ${retryResponse.status}): تعذر إكمال العملية.`);
          }
          return retryData as T;
        }

        dispatchSessionExpiredOnce();
        throw new SessionExpiredError();
      }

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error('مسار الخادم المطلوب غير متوفر (404 Not Found). يرجى التأكد من تشغيل خادم الـ API.');
        }
        throw new Error(data.error || `خطأ في الخادم (رمز ${response.status}): تعذر إكمال العملية.`);
      }

      return data as T;
    } catch (err: any) {
      const isNetworkError =
        !err.message ||
        err.message === 'Failed to fetch' ||
        err.message.includes('fetch') ||
        err.message.includes('NetworkError');

      if (!isNetworkError || attempt === retries) {
        throw err;
      }

      await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
    }
  }

  throw new Error('تعذر الاتصال بالخادم.');
}

export const api = {
  // Auth
  register: (payload: any) => request<any>('/auth/register', { method: 'POST', body: JSON.stringify(payload) }),
  login: (payload: any) => request<any>('/auth/login', { method: 'POST', body: JSON.stringify(payload) }),
  getMe: () => request<any>('/auth/me'),

  // Public Stats & System Status
  getStats: () => request<any>('/stats'),
  getSystemStatus: () => request<any>('/system/status'),
  getSettings: () => request<any>('/settings'),

  // Geo & Locations (Arab League Countries & Administrative Divisions)
  getGeoCountries: (includeInactive = false) =>
    request<{ countries: any[]; geoTablesReady?: boolean }>(`/geo/countries${includeInactive ? '?includeInactive=true' : ''}`),
  getGeoCountryLevels: (countryId: string) =>
    request<{ levels: any[] }>(`/geo/countries/${encodeURIComponent(countryId)}/levels`),
  getGeoDivisions: (params: {
    countryId: string;
    parentId?: string | null;
    levelId?: string;
    search?: string;
    includeInactive?: boolean;
    limit?: number;
  }) => {
    const q = new URLSearchParams({ countryId: params.countryId });
    if (params.parentId) q.append('parentId', params.parentId);
    if (params.levelId) q.append('levelId', params.levelId);
    if (params.search) q.append('search', params.search);
    if (params.includeInactive) q.append('includeInactive', 'true');
    if (params.limit) q.append('limit', String(params.limit));
    return request<{ divisions: any[] }>(`/geo/divisions?${q.toString()}`);
  },
  getGeoDivisionChildren: (divisionId: string) =>
    request<{ divisions: any[] }>(`/geo/divisions/${encodeURIComponent(divisionId)}/children`),
  getGeoDivisionPath: (divisionId: string) =>
    request<{ path: any[]; division?: any }>(`/geo/divisions/${encodeURIComponent(divisionId)}/path`),

  // Profile Location Update
  updateMyProfileLocation: (payload: {
    countryId: string;
    administrativeDivisionId?: string | null;
    areaName?: string;
    city?: string;
  }) => request<{ success: boolean; user: any }>('/profile/location', { method: 'PUT', body: JSON.stringify(payload) }),

  // Tasks
  getTasks: (params?: { category?: string; search?: string; countryId?: string; divisionId?: string }) => {
    const q = new URLSearchParams();
    if (params?.category) q.append('category', params.category);
    if (params?.search) q.append('search', params.search);
    if (params?.countryId) q.append('countryId', params.countryId);
    if (params?.divisionId) q.append('divisionId', params.divisionId);
    return request<any>(`/tasks?${q.toString()}`);
  },
  getTaskById: (id: string) => request<any>(`/tasks/${id}`),
  submitTaskProof: (payload: { taskId: string; proofText?: string; proofImages?: string[]; proofUrl?: string }) =>
    request<any>('/tasks/submit', { method: 'POST', body: JSON.stringify(payload) }),
  getUploadSignedUrl: (payload: { taskId: string; fileName: string; contentType: string; fileSize: number }) =>
    request<{ signedUrl: string; token: string; path: string }>('/upload/signed-url', { method: 'POST', body: JSON.stringify(payload) }),
  getViewSignedUrl: (storagePath: string) =>
    request<{ signedUrl: string }>('/storage/signed-url', { method: 'POST', body: JSON.stringify({ storagePath }) }),
  getPublicAdvertiserLogoUrl: (storagePath: string) =>
    request<{ signedUrl: string }>('/public/advertiser-logo-url', { method: 'POST', body: JSON.stringify({ storagePath }) }),
  getMySubmissions: () => request<any>('/submissions/my'),

  // Wallet & Withdrawals
  getMyWallet: () => request<any>('/wallet/my'),
  requestWithdrawal: (payload: {
    method: string;
    amount: number;
    beneficiaryName: string;
    phoneNumber: string;
    accountNumber?: string;
  }) => request<any>('/withdrawals/request', { method: 'POST', body: JSON.stringify(payload) }),
  getMyWithdrawals: () => request<any>('/withdrawals/my'),

  // Notifications
  getNotifications: () => request<any>('/notifications'),
  readAllNotifications: () => request<any>('/notifications/read-all', { method: 'POST' }),

  // Referrals
  getMyReferrals: () => request<any>('/referrals/my'),

  // Support
  getSupportTickets: () => request<any>('/support/tickets'),
  createSupportTicket: (payload: { subject: string; message: string; priority?: string }) =>
    request<any>('/support/tickets', { method: 'POST', body: JSON.stringify(payload) }),

  // Wallet Transfers & Ledger
  lookupWallet: (address: string) =>
    request<{ wallet: { address: string; ownerName: string } }>(`/wallet/lookup?address=${encodeURIComponent(address)}`),
  transferWallet: (payload: { recipientAddress: string; amount: number; note?: string; idempotencyKey?: string }) =>
    request<any>('/wallet/transfer', { method: 'POST', body: JSON.stringify(payload) }),
  getWalletTransfers: () => request<any>('/wallet/transfers'),

  // Treasury & Double-Entry Accounting
  getTreasury: () => request<any>('/admin/treasury'),
  issueTreasuryUnits: (payload: { amount: number; reason: string; idempotencyKey?: string }) =>
    request<any>('/admin/treasury/issue', { method: 'POST', body: JSON.stringify(payload) }),
  getLedger: (params?: {
    limit?: number;
    offset?: number;
    transactionType?: string;
    accountCode?: string;
    from?: string;
    to?: string;
    search?: string;
  }) => {
    const q = new URLSearchParams();
    if (params?.limit) q.append('limit', params.limit.toString());
    if (params?.offset) q.append('offset', params.offset.toString());
    if (params?.transactionType && params.transactionType !== 'ALL') q.append('transactionType', params.transactionType);
    if (params?.accountCode && params.accountCode !== 'ALL') q.append('accountCode', params.accountCode);
    if (params?.from) q.append('from', params.from);
    if (params?.to) q.append('to', params.to);
    if (params?.search) q.append('search', params.search);
    return request<any>(`/admin/ledger?${q.toString()}`);
  },
  getFinancialAccounts: () => request<any>('/admin/finance/accounts'),
  postOwnerCapital: (payload: { amount: number; reason: string; idempotencyKey?: string }) =>
    request<any>('/admin/finance/capital', { method: 'POST', body: JSON.stringify(payload) }),
  postOperationalExpense: (payload: { amount: number; reason: string; category?: string; idempotencyKey?: string }) =>
    request<any>('/admin/finance/expense', { method: 'POST', body: JSON.stringify(payload) }),
  postOwnerWithdrawal: (payload: { amount: number; reason: string; idempotencyKey?: string }) =>
    request<any>('/admin/finance/owner-withdrawal', { method: 'POST', body: JSON.stringify(payload) }),
  postPlatformRevenue: (payload: {
    source: 'ADS' | 'SUBSCRIPTIONS' | 'SERVICES';
    amount: number;
    reason: string;
    creditToTreasury?: boolean;
    idempotencyKey?: string;
  }) => request<any>('/admin/finance/revenue', { method: 'POST', body: JSON.stringify(payload) }),
  reverseLedgerTransaction: (payload: { transactionId: string; reason: string }) =>
    request<any>('/admin/finance/reverse', { method: 'POST', body: JSON.stringify(payload) }),
  getTreasuryMovements: (limit = 60) => request<any>(`/admin/finance/treasury-movements?limit=${limit}`),
  getComprehensiveFinancialReports: (params?: { from?: string; to?: string }) => {
    const q = new URLSearchParams();
    if (params?.from) q.append('from', params.from);
    if (params?.to) q.append('to', params.to);
    return request<{ report: any }>(`/admin/finance/reports?${q.toString()}`);
  },
  getFinancialAuditLogs: (limit = 100) => request<any>(`/admin/finance/audit-logs?limit=${limit}`),
  getTaxesOverview: () => request<any>('/admin/finance/taxes'),
  createTaxDefinition: (payload: {
    taxType: string;
    taxAuthority: string;
    region?: string;
    countryId?: string | null;
    taxBase: string;
    ratePercentage: number;
    flatAmount?: number;
    validFrom?: string;
    validTo?: string | null;
    isActive?: boolean;
  }) => request<any>('/admin/finance/taxes', { method: 'POST', body: JSON.stringify(payload) }),
  updateTaxDefinition: (
    id: string,
    payload: {
      ratePercentage?: number;
      flatAmount?: number;
      isActive?: boolean;
      validTo?: string | null;
      taxAuthority?: string;
    }
  ) => request<any>(`/admin/finance/taxes/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  accrueTaxObligation: (payload: {
    taxDefinitionId: string;
    taxableAmount: number;
    referenceId?: string;
    note?: string;
  }) => request<any>('/admin/finance/taxes/accrue', { method: 'POST', body: JSON.stringify(payload) }),
  settleTaxObligation: (payload: { settlementId: string; referenceId: string }) =>
    request<any>('/admin/finance/taxes/settle', { method: 'POST', body: JSON.stringify(payload) }),
  downloadFinancialCsv: async (reportType: string, params?: { from?: string; to?: string }) => {
    const q = new URLSearchParams({ reportType });
    if (params?.from) q.append('from', params.from);
    if (params?.to) q.append('to', params.to);
    let token = getAuthToken();
    let res = await fetch(`${BASE_URL}/admin/financial-report/export?${q.toString()}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (res.status === 401) {
      const refreshed = await getOrRefreshAccessToken();
      if (refreshed) {
        token = refreshed;
        res = await fetch(`${BASE_URL}/admin/financial-report/export?${q.toString()}`, {
          headers: { Authorization: `Bearer ${refreshed}` },
        });
      } else {
        dispatchSessionExpiredOnce();
        throw new SessionExpiredError();
      }
    }
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'فشل تصدير التقرير المالي.');
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kasb-finance-${reportType}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  // Advertiser Campaign Funding & Lifecycle (Phase 3 & 4)
  getAdvertiserLogoUploadUrl: (payload: { fileName: string; contentType: string; fileSize: number }) =>
    request<{ signedUrl: string; token: string; path: string }>('/advertiser/logo/signed-url', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  getAdvertiserCampaigns: () =>
    request<{ campaigns: any[]; feePercentage: number; walletBalance: number; accountStatus: string }>('/advertiser/campaigns'),
  createAdvertiserCampaign: (payload: {
    title: string;
    description: string;
    category: string;
    rewardUnits: number;
    slots: number;
    timeEstimateMinutes?: number;
    proofRequirements?: Record<string, any>;
    hideAdvertiserName?: boolean;
    advertiserDisplayName?: string;
    advertiserLogoUrl?: string;
    deadlineAt?: string | null;
    creationKey: string;
    countryId?: string | null;
    isNationwide?: boolean;
    targetDivisionIds?: string[];
  }) => request<any>('/advertiser/campaigns', { method: 'POST', body: JSON.stringify(payload) }),
  startAdvertiserCampaign: (id: string) =>
    request<any>(`/advertiser/campaigns/${id}/start`, { method: 'POST' }),
  settleAdvertiserCampaign: (id: string, payload?: { targetStatus?: 'cancelled' | 'completed'; reason?: string }) =>
    request<any>(`/advertiser/campaigns/${id}/settle`, { method: 'POST', body: JSON.stringify(payload || {}) }),
  getAdvertiserWalletSummary: () => request<any>('/advertiser/wallet-summary'),
  getAdvertiserExternalAccounts: () => request<{ accounts: any[] }>('/advertiser/external-accounts'),
  getAdvertiserDeposits: () => request<{ deposits: any[] }>('/advertiser/deposits'),
  createAdvertiserDeposit: (payload: {
    externalAccountId: string;
    amountUnits: number;
    referenceNumber: string;
    receiptUrl: string;
    depositorName?: string;
    depositorPhone?: string;
    notes?: string;
  }) => request<any>('/advertiser/deposits', { method: 'POST', body: JSON.stringify(payload) }),
  getAdvertiserDepositReceiptUploadUrl: (payload: { fileName: string; contentType: string; fileSize: number }) =>
    request<{ signedUrl: string; token: string; path: string }>('/advertiser/deposits/receipt-signed-url', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // Single Authorized Owner Admin APIs
  getAdminOverview: () => request<any>('/admin/overview'),
  getAdminCampaigns: () => request<{ campaigns: any[] }>('/admin/campaigns'),
  approveAdminCampaign: (id: string) =>
    request<any>(`/admin/campaigns/${id}/approve`, { method: 'POST' }),
  rejectAdminCampaign: (id: string, reason: string) =>
    request<any>(`/admin/campaigns/${id}/reject`, { method: 'POST', body: JSON.stringify({ reason }) }),
  startAdminCampaign: (id: string) =>
    request<any>(`/admin/campaigns/${id}/start`, { method: 'POST' }),
  settleAdminCampaign: (id: string, payload?: { targetStatus?: 'cancelled' | 'completed'; reason?: string }) =>
    request<any>(`/admin/campaigns/${id}/settle`, { method: 'POST', body: JSON.stringify(payload || {}) }),
  getAdminTasks: () => request<any>('/admin/tasks'),
  createAdminTask: (payload: any) => request<any>('/admin/tasks', { method: 'POST', body: JSON.stringify(payload) }),
  updateAdminTask: (id: string, payload: any) =>
    request<any>(`/admin/tasks/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteAdminTask: (id: string) => request<any>(`/admin/tasks/${id}`, { method: 'DELETE' }),
  getAdminSubmissions: () => request<any>('/admin/submissions'),
  reviewSubmission: (id: string, action: 'APPROVE' | 'REJECT', reason?: string) =>
    request<any>(`/admin/submissions/${id}/review`, { method: 'POST', body: JSON.stringify({ action, reason }) }),
  getAdminWithdrawals: () => request<any>('/admin/withdrawals'),
  getAdminWithdrawalReceiptUploadUrl: (payload: { fileName: string; contentType: string; fileSize: number }) =>
    request<{ signedUrl: string; token: string; path: string }>('/admin/withdrawals/receipt-signed-url', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  reviewWithdrawal: (id: string, action: 'PAY' | 'REJECT', payload?: { transferReference?: string; receiptUrl?: string; reason?: string }) =>
    request<any>(`/admin/withdrawals/${id}/review`, { method: 'POST', body: JSON.stringify({ action, ...payload }) }),
  getAdminUsers: () => request<any>('/admin/users'),
  adjustUserBalance: (id: string, amount: number, reason: string) =>
    request<any>(`/admin/users/${id}/adjust`, { method: 'POST', body: JSON.stringify({ amount, reason }) }),
  updateUserStatus: (id: string, status: string) =>
    request<any>(`/admin/users/${id}/status`, { method: 'POST', body: JSON.stringify({ status }) }),
  getFinancialReport: () => request<any>('/admin/financial-report'),
  updateAdminSettings: (payload: any) =>
    request<any>('/admin/settings', { method: 'PUT', body: JSON.stringify(payload) }),

  // Supabase Database Error Monitoring & Connection Testing
  getDatabaseErrors: (params?: {
    search?: string;
    errorType?: string;
    sourceTable?: string;
    resolvedStatus?: string;
    startDate?: string;
    endDate?: string;
  }) => {
    const q = new URLSearchParams();
    if (params?.search) q.append('search', params.search);
    if (params?.errorType) q.append('errorType', params.errorType);
    if (params?.sourceTable) q.append('sourceTable', params.sourceTable);
    if (params?.resolvedStatus) q.append('resolvedStatus', params.resolvedStatus);
    if (params?.startDate) q.append('startDate', params.startDate);
    if (params?.endDate) q.append('endDate', params.endDate);
    return request<{ logs: any[]; aggregations?: any[]; stats: any }>(`/admin/database-errors?${q.toString()}`);
  },
  resolveDatabaseError: (id: string, resolutionNote?: string) =>
    request<any>(`/admin/database-errors/${id}/resolve`, { method: 'POST', body: JSON.stringify({ resolutionNote }) }),
  testSupabaseConnection: () => request<any>('/admin/database-errors/test-connection', { method: 'POST' }),

  // Phase 5: External Accounts, Receipt-Backed Deposits, Internal Transfers & Reconciliation
  getExternalAccountsOverview: () => request<any>('/admin/finance/external-accounts'),
  createExternalAccount: (payload: {
    accountName: string;
    ownerName: string;
    ownerRole: 'owner' | 'admin' | 'company';
    accountType: 'bank' | 'exchange' | 'ewallet' | 'cash';
    providerName: string;
    accountNumber: string;
    fundScope: 'platform' | 'advertiser' | 'mixed';
    notes?: string;
  }) => request<any>('/admin/finance/external-accounts', { method: 'POST', body: JSON.stringify(payload) }),
  getExternalDepositReceiptUploadUrl: (payload: { fileName: string; contentType: string; fileSize: number }) =>
    request<{ signedUrl: string; token: string; path: string }>('/admin/finance/external-deposits/receipt-signed-url', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  createExternalDeposit: (payload: {
    externalAccountId: string;
    depositPurpose: 'advertiser_wallet' | 'platform_capital';
    advertiserId?: string | null;
    amountUnits: number;
    referenceNumber: string;
    receiptUrl: string;
    depositorName?: string;
    depositorPhone?: string;
    notes?: string;
  }) => request<any>('/admin/finance/external-deposits', { method: 'POST', body: JSON.stringify(payload) }),
  approveExternalDeposit: (depositId: string) =>
    request<any>(`/admin/finance/external-deposits/${depositId}/approve`, { method: 'POST' }),
  rejectExternalDeposit: (depositId: string, reason: string) =>
    request<any>(`/admin/finance/external-deposits/${depositId}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
  executeInternalAccountTransfer: (payload: {
    fromFinancialAccountId: string;
    toFinancialAccountId: string;
    amountUnits: number;
    reason: string;
    referenceNumber?: string;
    idempotencyKey?: string;
  }) => request<any>('/admin/finance/external-transfers', { method: 'POST', body: JSON.stringify(payload) }),
  reconcileExternalAccount: (
    externalAccountId: string,
    payload: { actualBalanceUnits: number; applyAdjustment: boolean; adjustmentReason?: string }
  ) =>
    request<any>(`/admin/finance/external-accounts/${externalAccountId}/reconcile`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // Admin Geographic & Administrative Divisions Management
  getAdminGeoOverview: () => request<any>('/admin/geo/overview'),
  getAdminGeoIntegrity: () => request<any>('/admin/geo/integrity'),
  toggleAdminGeoCountry: (countryId: string, isActive: boolean) =>
    request<any>(`/admin/geo/countries/${encodeURIComponent(countryId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive }),
    }),
  createAdminGeoLevel: (
    countryId: string,
    payload: { levelOrder: number; nameAr: string; nameEn: string; pluralAr?: string; isRequired?: boolean }
  ) =>
    request<any>(`/admin/geo/countries/${encodeURIComponent(countryId)}/levels`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  createAdminGeoDivision: (payload: {
    countryId: string;
    levelId: string;
    parentId?: string | null;
    nameAr: string;
    nameEn: string;
    code?: string;
    latitude?: number | null;
    longitude?: number | null;
    isActive?: boolean;
  }) => request<any>('/admin/geo/divisions', { method: 'POST', body: JSON.stringify(payload) }),
  updateAdminGeoDivision: (
    divisionId: string,
    payload: {
      nameAr?: string;
      nameEn?: string;
      code?: string | null;
      latitude?: number | null;
      longitude?: number | null;
      isActive?: boolean;
    }
  ) =>
    request<any>(`/admin/geo/divisions/${encodeURIComponent(divisionId)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  importAdminGeoCountry: (countryId: string) =>
    request<any>(`/admin/geo/countries/${encodeURIComponent(countryId)}/import`, { method: 'POST' }),

  // ClixWall Offer Wall & Rewards
  getClixWallOfferWallUrl: () => request<{ offerWallUrl: string; userId: string }>('/clixwall/offerwall-url'),
  getClixWallRewards: () =>
    request<{
      rewards: Array<{
        id: string;
        transaction_id: string;
        offer_id?: string | null;
        offer_name?: string;
        user_payout_usd: number;
        reward_usd?: number;
        publisher_payout_usd?: number;
        exchange_rate: number;
        reward_yer: number;
        status: string;
        created_at: string;
      }>;
      summary: {
        totalUsdEarned: number;
        totalYerCredited: number;
        offersCount: number;
        reversedCount?: number;
        walletBalanceYer?: number;
      };
    }>('/clixwall/rewards'),
};

