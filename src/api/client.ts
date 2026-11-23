/**
 * Kasb Yemen - Frontend API Client (Connected to Real Backend with Session Refresh & Persistence)
 */

import type {
  AdCenterComfortSettings,
  AdCompletionRule,
  AdPartner,
  AdPartnerCodeType,
  AdPartnerRotationMode,
  AdTrackingEventName,
  AdTrackingSessionRecord,
  AdminAdTrackingReport,
  MiningAdDeviceTarget,
  MiningAdFormat,
  MiningAdPageScope,
  MiningAdPlacement,
  MiningAdSlotType,
  MiningAdTemplate,
  MiningAdTemplateType,
  PushAdPreference,
  SmartLinkAttempt,
  SurveyAttempt,
  SurveyItem,
  TaskAssetItem,
  TaskCategoryItem,
} from '../types/index.ts';

const BASE_URL = '/api';

export class SessionExpiredError extends Error {
  readonly isAuthTerminal = true;
  constructor(message = 'انتهت صلاحية الجلسة، يرجى تسجيل الدخول مجدداً.') {
    super(message);
    this.name = 'SessionExpiredError';
  }
}

export class NetworkOfflineError extends Error {
  readonly isNetworkError = true;
  constructor(message = 'تعذر الاتصال بالخادم، يبدو أنك غير متصل بالإنترنت.') {
    super(message);
    this.name = 'NetworkOfflineError';
  }
}

export class ApiHttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiHttpError';
    this.status = status;
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

type RefreshOutcome =
  | { status: 'refreshed'; token: string }
  | { status: 'terminal_rejected' }
  | { status: 'transient_error' };

let activeRefreshPromise: Promise<RefreshOutcome> | null = null;
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

async function performTokenRefresh(): Promise<RefreshOutcome> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { status: 'transient_error' };
  }

  const refreshToken = getRefreshToken();
  if (!refreshToken) {
    return { status: 'terminal_rejected' };
  }

  try {
    const response = await fetch(`${BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });

    const data = await response.json().catch(() => ({}));
    if (response.status === 401 || response.status === 403) {
      return { status: 'terminal_rejected' };
    }
    if (!response.ok || !data.token) {
      return { status: 'transient_error' };
    }

    setAuthTokens(data.token, data.refreshToken || refreshToken);
    return { status: 'refreshed', token: data.token };
  } catch {
    return { status: 'transient_error' };
  }
}

async function getOrRefreshAccessToken(): Promise<RefreshOutcome> {
  if (!activeRefreshPromise) {
    activeRefreshPromise = performTokenRefresh().finally(() => {
      activeRefreshPromise = null;
    });
  }
  return activeRefreshPromise;
}

async function request<T>(endpoint: string, options: RequestInit = {}, retries = 2): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new NetworkOfflineError();
  }

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
      if (
        response.status === 401 &&
        !endpoint.includes('/auth/login') &&
        !endpoint.includes('/auth/refresh') &&
        !endpoint.includes('/auth/register')
      ) {
        const outcome = await getOrRefreshAccessToken();
        if (outcome.status === 'refreshed') {
          token = outcome.token;
          const retryResponse = await fetch(`${BASE_URL}${endpoint}`, {
            ...options,
            headers: { ...headers, Authorization: `Bearer ${outcome.token}` },
          });
          const retryData = await retryResponse.json().catch(() => ({}));
          if (retryResponse.status === 401) {
            dispatchSessionExpiredOnce();
            throw new SessionExpiredError();
          }
          if (!retryResponse.ok) {
            throw new ApiHttpError(
              retryResponse.status,
              retryData.error || `خطأ في الخادم (رمز ${retryResponse.status}): تعذر إكمال العملية.`
            );
          }
          return retryData as T;
        }

        if (outcome.status === 'terminal_rejected') {
          dispatchSessionExpiredOnce();
          throw new SessionExpiredError();
        }

        // Transient failure during refresh (e.g. brief offline / 5xx) — preserve tokens!
        throw new NetworkOfflineError('تعذر تجديد الجلسة مؤقتاً بسبب انقطاع الشبكة.');
      }

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        if (response.status === 404) {
          throw new ApiHttpError(404, 'مسار الخادم المطلوب غير متوفر (404 Not Found). يرجى التأكد من تشغيل خادم الـ API.');
        }
        throw new ApiHttpError(
          response.status,
          data.error || `خطأ في الخادم (رمز ${response.status}): تعذر إكمال العملية.`
        );
      }

      return data as T;
    } catch (err: any) {
      if (err instanceof SessionExpiredError) {
        throw err;
      }

      const isNetworkError =
        err instanceof NetworkOfflineError ||
        !err.message ||
        err.message === 'Failed to fetch' ||
        err.message.includes('fetch') ||
        err.message.includes('NetworkError');

      if (!isNetworkError) {
        throw err;
      }

      if (attempt === retries) {
        throw new NetworkOfflineError();
      }

      await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
    }
  }

  throw new NetworkOfflineError();
}

export const api = {
  // Auth
  register: (payload: any) => request<any>('/auth/register', { method: 'POST', body: JSON.stringify(payload) }),
  login: (payload: any) => request<any>('/auth/login', { method: 'POST', body: JSON.stringify(payload) }),
  getMe: () => request<any>('/auth/me'),
  resendVerificationEmail: (email?: string) =>
    request<{ success: boolean; message?: string }>('/auth/resend-verification', {
      method: 'POST',
      body: JSON.stringify(email ? { email } : {}),
    }),

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
  submitTaskProof: (payload: {
    taskId: string;
    proofText?: string;
    proofImages?: string[];
    proofUrl?: string;
    proofCodeNumber?: string;
    proofChoiceAnswer?: string | string[];
    proofMultiAnswers?: Record<string, any> | Array<{ questionId: string; questionText?: string; answer: any }>;
    executionSessionId?: string;
  }) => request<any>('/tasks/submit', { method: 'POST', body: JSON.stringify(payload) }),
  startTaskExecutionSession: (taskId: string, mode: 'video_watch' | 'website_visit') =>
    request<{
      success: boolean;
      session: {
        id: string;
        taskId: string;
        mode: 'video_watch' | 'website_visit';
        requiredSeconds: number;
        verifiedSeconds: number;
        completed: boolean;
        startedAt: string;
      };
    }>(`/tasks/${encodeURIComponent(taskId)}/execution-session/start`, {
      method: 'POST',
      body: JSON.stringify({ mode }),
    }),
  pingTaskExecutionSession: (
    taskId: string,
    payload: {
      sessionId: string;
      deltaSeconds?: number;
      playerActive?: boolean;
      returnedFromVisit?: boolean;
    }
  ) =>
    request<{
      success: boolean;
      session: {
        id: string;
        requiredSeconds: number;
        verifiedSeconds: number;
        completed: boolean;
      };
    }>(`/tasks/${encodeURIComponent(taskId)}/execution-session/ping`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
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

  // Notifications & Web Push
  getNotifications: () => request<any>('/notifications'),
  readNotification: (id: string) => request<any>(`/notifications/${encodeURIComponent(id)}/read`, { method: 'POST' }),
  readAllNotifications: () => request<any>('/notifications/read-all', { method: 'POST' }),
  getPushConfig: () => request<{ configured: boolean; publicKey: string | null; reason?: string }>('/notifications/push-config'),
  subscribePush: (subscription: PushSubscriptionJSON | any) =>
    request<{ success: boolean; storageMode?: string }>('/notifications/push-subscribe', {
      method: 'POST',
      body: JSON.stringify({ subscription }),
    }),
  unsubscribePush: (endpoint?: string) =>
    request<{ success: boolean }>('/notifications/push-subscribe', {
      method: 'DELETE',
      body: JSON.stringify({ endpoint }),
    }),

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
      const outcome = await getOrRefreshAccessToken();
      if (outcome.status === 'refreshed') {
        token = outcome.token;
        res = await fetch(`${BASE_URL}/admin/financial-report/export?${q.toString()}`, {
          headers: { Authorization: `Bearer ${outcome.token}` },
        });
      } else if (outcome.status === 'terminal_rejected') {
        dispatchSessionExpiredOnce();
        throw new SessionExpiredError();
      } else {
        throw new NetworkOfflineError('تعذر تصدير التقرير بسبب انقطاع الاتصال مؤقتاً.');
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
  broadcastAdminNotification: (payload: { title: string; message: string; targetUserId?: string; link?: string }) =>
    request<{ success: boolean; sentCount: number }>('/admin/notifications/broadcast', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

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

  // Independent YT Coin mining, verified ad rewards & wallet (BIGINT 1 YT = 1,000 parts, 100M max supply)
  getMyYtCoinSummary: () => request<{ summary: any }>('/yt-coin/summary'),
  claimDailyYtCoin: () => request<{ result: any }>('/yt-coin/claim', { method: 'POST' }),
  claimTapYtCoin: (taps: number) =>
    request<{ result: any }>('/yt-coin/tap', {
      method: 'POST',
      body: JSON.stringify({ taps }),
    }),
  lookupYtCoinWallet: (address: string) =>
    request<{ wallet: any }>(`/yt-coin/lookup?address=${encodeURIComponent(address)}`),
  transferYtCoin: (payload: { recipientAddress: string; amountYt: number; note?: string }) =>
    request<{ result: any }>('/yt-coin/transfer', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // Verified Ad Rewards Center («اكسب من الإعلانات»)
  getYtCoinAdCenter: () =>
    request<{
      adCenter: {
        unitScale: number;
        adClickRewardUnits: number;
        adClickRewardYt: number;
        adViewRewardUnits: number;
        adViewRewardYt: number;
        dailyAdLimit: number;
        adsToday: number;
        totalAdEarnedUnits: number;
        totalAdEarnedYt: number;
        availableAdsCount: number;
        hasConnectedNetwork: boolean;
        connectedNetworks: Array<{
          id: string;
          networkKey: string;
          displayName: string;
          description?: string | null;
          adType: 'view' | 'click' | 'both';
          rewardClickUnits: number;
          rewardClickYt: number;
          rewardViewUnits: number;
          rewardViewYt: number;
          dailyUserLimit: number;
          isActive: boolean;
          isConnected: boolean;
        }>;
        recentEvents: Array<{
          id: string;
          networkKey: string;
          externalEventId: string;
          eventType: 'click' | 'view';
          amountUnits: number;
          amountYt: number;
          verificationSource: string;
          createdAt: string;
        }>;
      };
    }>('/yt-coin/ads'),
  createYtCoinAdSession: (payload: { networkKey: string; eventType: 'click' | 'view' }) =>
    request<{
      session: {
        sessionId: string;
        networkKey: string;
        eventType: 'click' | 'view';
        targetUrl: string;
        rewardGrantedOnOpen: boolean;
      };
    }>('/yt-coin/ads/session', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getAdminYtCoinSummary: () => request<{ summary: any }>('/admin/yt-coin/summary'),
  getAdminYtCoinIntegrity: () =>
    request<{ integrity: any; migrationRequired?: boolean; message?: string }>('/admin/yt-coin/integrity'),
  updateAdminYtCoinConfig: (payload: {
    miningEnabled?: boolean;
    maxSupplyYt?: number;
    baseRewardYt?: number;
    tapRewardYt?: number;
    adClickRewardYt?: number;
    adViewRewardYt?: number;
    dailyTapLimit?: number;
    dailyAdLimit?: number;
    dailyCapStartYt?: number;
    dailyCapMaxYt?: number;
    swapEnabled?: boolean;
    exchangeRateYerPerYt?: number;
  }) =>
    request<{ config: any }>('/admin/yt-coin/config', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  updateAdminYtCoinTreasury: (
    treasuryKey: string,
    payload: {
      labelAr?: string;
      allocatedYt?: number;
      isLocked?: boolean;
      approvedForDistribution?: boolean;
      vestingSchedule?: Record<string, any> | null;
    }
  ) =>
    request<{ treasury: any }>(`/admin/yt-coin/treasuries/${encodeURIComponent(treasuryKey)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  getAdminYtCoinAccounts: (search?: string, limit = 30) =>
    request<{ accounts: any[]; migrationRequired?: boolean }>(
      `/admin/yt-coin/accounts?limit=${encodeURIComponent(String(limit))}${search ? `&search=${encodeURIComponent(search)}` : ''}`
    ),
  adjustAdminYtCoinWallet: (payload: {
    userId: string;
    newBalanceYt: number;
    reason?: string;
    clearPendingAudit?: boolean;
  }) =>
    request<{ account: any }>('/admin/yt-coin/accounts/adjust', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  upsertAdminYtCoinAdNetwork: (payload: {
    id?: string | null;
    networkKey: string;
    displayName: string;
    description?: string | null;
    authMode: 'hmac_sha256' | 'shared_secret';
    secretEnvKey?: string;
    placementUrl?: string | null;
    adType: 'view' | 'click' | 'both';
    rewardClickYt: number;
    rewardViewYt: number;
    dailyUserLimit: number;
    isActive: boolean;
  }) =>
    request<{ network: any; secretConfigured: boolean }>('/admin/yt-coin/ad-networks', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  deleteAdminYtCoinAdNetwork: (id: string) =>
    request<{ result: any }>(`/admin/yt-coin/ad-networks/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  // Independent Offerwall.GG wall and YER rewards
  getOfferwallGgUrl: () => request<{ offerWallUrl: string; userId: string }>('/offerwall-gg/url'),
  getOfferwallGgRewards: () =>
    request<{
      rewards: Array<{
        id: string;
        transaction_id: string;
        status: 'credited' | 'reversed';
        offer_id?: string | null;
        offer_name?: string | null;
        goal_id?: string | null;
        currency_name: string;
        currency_amount: number;
        created_at: string;
      }>;
      summary: { totalYerCredited: number; offersCount: number; reversedCount: number };
    }>('/offerwall-gg/rewards'),

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

  // Isolated Ad Partners Registry (Public active + Owner Admin CRUD)
  getPublicAdPartners: (placement?: string) =>
    request<{ partners: AdPartner[] }>(
      placement ? `/ad-partners/public?placement=${encodeURIComponent(placement)}` : '/ad-partners/public'
    ),
  getAdminAdPartners: () =>
    request<{ partners: AdPartner[]; storageMode?: 'supabase' | 'fallback' }>('/admin/ad-partners'),
  createAdminAdPartner: (payload: {
    partnerName: string;
    placementKey?: string;
    codeType: AdPartnerCodeType;
    code: string;
    width?: number;
    height?: number;
    rotationMode?: AdPartnerRotationMode;
    sortOrder?: number;
    isActive?: boolean;
  }) => request<{ success: boolean; partner: AdPartner; storageMode?: string }>('/admin/ad-partners', {
    method: 'POST',
    body: JSON.stringify(payload),
  }),
  updateAdminAdPartner: (
    id: string,
    payload: Partial<{
      partnerName: string;
      placementKey: string;
      codeType: AdPartnerCodeType;
      code: string;
      width: number;
      height: number;
      rotationMode: AdPartnerRotationMode;
      sortOrder: number;
      isActive: boolean;
    }>
  ) =>
    request<{ success: boolean; partner: AdPartner; storageMode?: string }>(
      `/admin/ad-partners/${encodeURIComponent(id)}`,
      {
        method: 'PUT',
        body: JSON.stringify(payload),
      }
    ),
  deleteAdminAdPartner: (id: string) =>
    request<{ success: boolean; storageMode?: string }>(`/admin/ad-partners/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  // Mining Ad Center (Placements, Templates, Comfort Settings & Server-Side Tracking)
  getPublicMiningAds: (filters?: {
    placementKey?: string;
    pageScope?: string;
    templateType?: string;
    deviceType?: 'desktop' | 'mobile';
  }) => {
    const params = new URLSearchParams();
    if (filters?.placementKey) params.set('placementKey', filters.placementKey);
    if (filters?.pageScope) params.set('pageScope', filters.pageScope);
    if (filters?.templateType) params.set('templateType', filters.templateType);
    if (filters?.deviceType) params.set('deviceType', filters.deviceType);
    const qs = params.toString();
    return request<{
      placements: MiningAdPlacement[];
      templates: MiningAdTemplate[];
      comfortSettings?: AdCenterComfortSettings;
      storageMode?: 'supabase' | 'unmigrated';
    }>(`/mining-ads/public${qs ? `?${qs}` : ''}`);
  },
  trackMiningAdImpression: (templateId: string) =>
    request<{ tracked: boolean; impressionsCount: number }>('/mining-ads/impression', {
      method: 'POST',
      body: JSON.stringify({ templateId }),
    }),
  startAdTrackingSession: (payload: {
    templateId: string;
    deviceType: 'desktop' | 'mobile';
    ytAdSessionId?: string | null;
  }) =>
    request<{
      session: AdTrackingSessionRecord;
      sessionToken: string;
      trackingEnabled: boolean;
    }>('/ad-tracking/session/start', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  sendAdTrackingHeartbeat: (
    sessionId: string,
    payload: { sessionToken?: string; isVisible: boolean; clientElapsedSec: number }
  ) =>
    request<{ session: AdTrackingSessionRecord }>(
      `/ad-tracking/session/${encodeURIComponent(sessionId)}/heartbeat`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),
  sendAdTrackingEvent: (
    sessionId: string,
    payload: {
      sessionToken?: string;
      eventName: AdTrackingEventName;
      isVisible?: boolean;
      clientElapsedSec?: number;
      metadata?: Record<string, any>;
    }
  ) =>
    request<{ session: AdTrackingSessionRecord }>(
      `/ad-tracking/session/${encodeURIComponent(sessionId)}/event`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),
  completeAdTrackingSession: (
    sessionId: string,
    payload: { sessionToken?: string; isVisible?: boolean }
  ) =>
    request<{ completed: boolean; session: AdTrackingSessionRecord; message: string }>(
      `/ad-tracking/session/${encodeURIComponent(sessionId)}/complete`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),
  getMyAdTrackingHistory: () =>
    request<{ sessions: AdTrackingSessionRecord[]; storageMode?: 'supabase' | 'unmigrated' }>(
      '/ad-tracking/history'
    ),
  getMyPushAdPreference: () =>
    request<{ preference: PushAdPreference; storageMode?: 'supabase' | 'unmigrated' }>(
      '/ad-tracking/push-preference'
    ),
  updateMyPushAdPreference: (payload: { optedIn: boolean; frequencyPerDay?: number }) =>
    request<{ success: boolean; preference: PushAdPreference; storageMode?: 'supabase' }>(
      '/ad-tracking/push-preference',
      {
        method: 'PUT',
        body: JSON.stringify(payload),
      }
    ),
  getAdminMiningAds: () =>
    request<{
      placements: MiningAdPlacement[];
      templates: MiningAdTemplate[];
      comfortSettings?: AdCenterComfortSettings;
      completionRules?: AdCompletionRule[];
      storageMode?: 'supabase' | 'unmigrated';
    }>('/admin/mining-ads'),
  upsertAdminMiningAdPlacement: (payload: {
    id?: string;
    placementKey: string;
    titleAr: string;
    descriptionAr?: string | null;
    pageScope: MiningAdPageScope;
    slotType: MiningAdSlotType;
    defaultWidth?: number;
    defaultHeight?: number;
    maxAds?: number;
    sortOrder?: number;
    isActive?: boolean;
  }) =>
    request<{ success: boolean; placement: MiningAdPlacement; storageMode?: string }>(
      payload.id
        ? `/admin/mining-ads/placements/${encodeURIComponent(payload.id)}`
        : '/admin/mining-ads/placements',
      {
        method: payload.id ? 'PUT' : 'POST',
        body: JSON.stringify(payload),
      }
    ),
  deleteAdminMiningAdPlacement: (id: string) =>
    request<{ success: boolean; storageMode?: string }>(
      `/admin/mining-ads/placements/${encodeURIComponent(id)}`,
      { method: 'DELETE' }
    ),
  createAdminMiningAdTemplate: (payload: {
    title: string;
    placementKey: string;
    templateType: MiningAdTemplateType;
    adFormat?: MiningAdFormat;
    deviceTarget?: MiningAdDeviceTarget;
    sourceName?: string;
    codeContent?: string;
    targetUrl?: string | null;
    mediaUrl?: string | null;
    vastUrl?: string | null;
    ctaLabel?: string | null;
    width?: number;
    height?: number;
    priority?: number;
    sortOrder?: number;
    maxImpressions?: number;
    ytNetworkKey?: string | null;
    rewardEventType?: 'view' | 'click' | null;
    isDismissible?: boolean;
    trackingEnabled?: boolean;
    isActive?: boolean;
    completionRule?: Partial<AdCompletionRule> | null;
  }) =>
    request<{ success: boolean; template: MiningAdTemplate; storageMode?: string }>(
      '/admin/mining-ads/templates',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),
  updateAdminMiningAdTemplate: (
    id: string,
    payload: Partial<{
      title: string;
      placementKey: string;
      templateType: MiningAdTemplateType;
      adFormat: MiningAdFormat;
      deviceTarget: MiningAdDeviceTarget;
      sourceName: string;
      codeContent: string;
      targetUrl: string | null;
      mediaUrl: string | null;
      vastUrl: string | null;
      ctaLabel: string | null;
      width: number;
      height: number;
      priority: number;
      sortOrder: number;
      maxImpressions: number;
      ytNetworkKey: string | null;
      rewardEventType: 'view' | 'click' | null;
      isDismissible: boolean;
      trackingEnabled: boolean;
      isActive: boolean;
      completionRule: Partial<AdCompletionRule> | null;
    }>
  ) =>
    request<{ success: boolean; template: MiningAdTemplate; storageMode?: string }>(
      `/admin/mining-ads/templates/${encodeURIComponent(id)}`,
      {
        method: 'PUT',
        body: JSON.stringify(payload),
      }
    ),
  deleteAdminMiningAdTemplate: (id: string) =>
    request<{ success: boolean; storageMode?: string }>(
      `/admin/mining-ads/templates/${encodeURIComponent(id)}`,
      { method: 'DELETE' }
    ),
  saveAdminAdComfortSettings: (payload: Partial<AdCenterComfortSettings>) =>
    request<{ success: boolean; comfortSettings: AdCenterComfortSettings; storageMode?: string }>(
      '/admin/mining-ads/comfort-settings',
      {
        method: 'PUT',
        body: JSON.stringify(payload),
      }
    ),
  saveAdminAdFormatRule: (payload: Partial<AdCompletionRule> & { adFormat: MiningAdFormat }) =>
    request<{ success: boolean; rule: AdCompletionRule; storageMode?: string }>(
      '/admin/mining-ads/completion-rules/format',
      {
        method: 'PUT',
        body: JSON.stringify(payload),
      }
    ),
  getAdminAdTrackingReports: (filters?: {
    dateFrom?: string;
    dateTo?: string;
    networkKey?: string;
    adFormat?: string;
    userId?: string;
  }) => {
    const params = new URLSearchParams();
    if (filters?.dateFrom) params.set('dateFrom', filters.dateFrom);
    if (filters?.dateTo) params.set('dateTo', filters.dateTo);
    if (filters?.networkKey) params.set('networkKey', filters.networkKey);
    if (filters?.adFormat) params.set('adFormat', filters.adFormat);
    if (filters?.userId) params.set('userId', filters.userId);
    const qs = params.toString();
    return request<AdminAdTrackingReport>(`/admin/mining-ads/reports${qs ? `?${qs}` : ''}`);
  },

  // Task Visual Categories, Assets & Favorites
  getTaskCategories: () =>
    request<{ categories: TaskCategoryItem[] }>('/task-categories'),
  getTaskAssets: () =>
    request<{ assets: TaskAssetItem[] }>('/task-assets'),
  getFavoriteTaskIds: () =>
    request<{ favoriteIds: string[] }>('/tasks/favorites'),
  toggleFavoriteTask: (taskId: string) =>
    request<{ success: boolean; isFavorited: boolean; favoriteIds: string[] }>(
      `/tasks/${encodeURIComponent(taskId)}/favorite`,
      { method: 'POST' }
    ),

  // Smart Links (Postback-only reward flow)
  startSmartLink: (taskId: string) =>
    request<{ success: boolean; attempt: SmartLinkAttempt; launchUrl: string; userAttemptsCount: number }>(
      `/smart-links/${encodeURIComponent(taskId)}/start`,
      { method: 'POST' }
    ),

  // Sequential Surveys
  getSurveys: () =>
    request<{ surveys: SurveyItem[] }>('/surveys'),
  getSurveyById: (id: string) =>
    request<{ survey: SurveyItem }>(`/surveys/${encodeURIComponent(id)}`),
  startSurvey: (id: string) =>
    request<{ success: boolean; survey: SurveyItem; attempt: SurveyAttempt }>(
      `/surveys/${encodeURIComponent(id)}/start`,
      { method: 'POST' }
    ),
  saveSurveyProgress: (attemptId: string, payload: { currentQuestionIndex: number; answers: Record<string, any> }) =>
    request<{ success: boolean; attempt: SurveyAttempt }>(
      `/surveys/attempts/${encodeURIComponent(attemptId)}/progress`,
      { method: 'PUT', body: JSON.stringify(payload) }
    ),
  submitSurvey: (attemptId: string) =>
    request<{ success: boolean; ok: boolean; duplicate?: boolean; rewardYer: number; transactionId?: string }>(
      `/surveys/attempts/${encodeURIComponent(attemptId)}/submit`,
      { method: 'POST' }
    ),

  // Admin Survey Builder & Assets / Category Icons Management
  getAdminSurveys: () =>
    request<{ surveys: SurveyItem[] }>('/admin/surveys'),
  createAdminSurvey: (payload: any) =>
    request<{ success: boolean; survey: SurveyItem }>('/admin/surveys', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateAdminSurvey: (id: string, payload: any) =>
    request<{ success: boolean; survey: SurveyItem }>(`/admin/surveys/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  deleteAdminSurvey: (id: string) =>
    request<{ success: boolean }>(`/admin/surveys/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  getAdminAssets: () =>
    request<{ assets: TaskAssetItem[] }>('/admin/assets'),
  uploadAdminTaskAsset: (payload: {
    title: string;
    assetKind?: 'task_illustration' | 'category_icon' | 'provider_logo';
    taskKind?: string | null;
    fileName: string;
    contentType: string;
    base64Data: string;
  }) =>
    request<{ success: boolean; asset: TaskAssetItem }>('/admin/assets/upload', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  deleteAdminTaskAsset: (id: string) =>
    request<{ success: boolean }>(`/admin/assets/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  upsertAdminTaskCategory: (
    slug: string,
    payload: { labelAr?: string; iconUrl?: string | null; badgeColor?: string; sortOrder?: number; isActive?: boolean }
  ) =>
    request<{ success: boolean; category: TaskCategoryItem }>(
      `/admin/task-categories/${encodeURIComponent(slug)}`,
      {
        method: 'PUT',
        body: JSON.stringify(payload),
      }
    ),

  // Admin User Management (Resend verification, password reset, permanent delete with financial protection)
  adminResendVerification: (userId: string) =>
    request<{ success: boolean; message?: string }>(`/admin/users/${encodeURIComponent(userId)}/resend-verification`, { method: 'POST' }),
  adminResetPassword: (userId: string) =>
    request<{ success: boolean; message?: string; actionLink?: string }>(`/admin/users/${encodeURIComponent(userId)}/reset-password`, { method: 'POST' }),
  adminDeleteUser: (userId: string) =>
    request<{ success: boolean; message?: string }>(`/admin/users/${encodeURIComponent(userId)}`, { method: 'DELETE' }),
};

