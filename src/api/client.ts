/**
 * Kasb Yemen - Frontend API Client (Connected to Real Backend with Session Refresh & Persistence)
 */

const BASE_URL = '/api';

export function getAuthToken(): string | null {
  return localStorage.getItem('kasb_auth_token');
}

export function getRefreshToken(): string | null {
  return localStorage.getItem('kasb_refresh_token');
}

export function setAuthTokens(token: string, refreshToken?: string): void {
  localStorage.setItem('kasb_auth_token', token);
  if (refreshToken) {
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

let isRefreshing = false;
let refreshSubscribers: Array<(token: string) => void> = [];

function subscribeTokenRefresh(cb: (token: string) => void) {
  refreshSubscribers.push(cb);
}

function onRefreshed(token: string) {
  refreshSubscribers.forEach((cb) => cb(token));
  refreshSubscribers = [];
}

async function refreshAccessToken(): Promise<string | null> {
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
      clearAuthToken();
      return null;
    }

    setAuthTokens(data.token, data.refreshToken || refreshToken);
    return data.token;
  } catch {
    clearAuthToken();
    return null;
  }
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

      // Handle 401 unauthorized with single token refresh attempt (prevent infinite loop)
      if (response.status === 401 && !endpoint.includes('/auth/login') && !endpoint.includes('/auth/refresh') && !endpoint.includes('/auth/register')) {
        if (!isRefreshing) {
          isRefreshing = true;
          const newToken = await refreshAccessToken();
          isRefreshing = false;

          if (newToken) {
            token = newToken;
            onRefreshed(newToken);
            // Retry request with fresh token
            const retryResponse = await fetch(`${BASE_URL}${endpoint}`, {
              ...options,
              headers: { ...headers, Authorization: `Bearer ${newToken}` },
            });
            const retryData = await retryResponse.json().catch(() => ({}));
            if (!retryResponse.ok) {
              throw new Error(retryData.error || `خطأ في الخادم (رمز ${retryResponse.status}): تعذر إكمال العملية.`);
            }
            return retryData as T;
          } else {
            clearAuthToken();
            window.dispatchEvent(new CustomEvent('kasb:auth_expired'));
            throw new Error('انتهت صلاحية الجلسة، يرجى تسجيل الدخول مجدداً.');
          }
        } else {
          // Wait for ongoing refresh
          return new Promise((resolve, reject) => {
            subscribeTokenRefresh(async (newToken) => {
              try {
                const retryResponse = await fetch(`${BASE_URL}${endpoint}`, {
                  ...options,
                  headers: { ...headers, Authorization: `Bearer ${newToken}` },
                });
                const retryData = await retryResponse.json().catch(() => ({}));
                if (!retryResponse.ok) reject(new Error(retryData.error));
                else resolve(retryData as T);
              } catch (e) {
                reject(e);
              }
            });
          });
        }
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

  // Tasks
  getTasks: (params?: { category?: string; search?: string }) => {
    const q = new URLSearchParams();
    if (params?.category) q.append('category', params.category);
    if (params?.search) q.append('search', params.search);
    return request<any>(`/tasks?${q.toString()}`);
  },
  getTaskById: (id: string) => request<any>(`/tasks/${id}`),
  submitTaskProof: (payload: { taskId: string; proofText?: string; proofImages?: string[]; proofUrl?: string }) =>
    request<any>('/tasks/submit', { method: 'POST', body: JSON.stringify(payload) }),
  uploadImage: (fileBase64: string, fileName: string, contentType: string) =>
    request<{ url: string }>('/upload', { method: 'POST', body: JSON.stringify({ fileBase64, fileName, contentType }) }),
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
  getLedger: (params?: { limit?: number; offset?: number }) => {
    const q = new URLSearchParams();
    if (params?.limit) q.append('limit', params.limit.toString());
    if (params?.offset) q.append('offset', params.offset.toString());
    return request<any>(`/admin/ledger?${q.toString()}`);
  },

  // Single Authorized Owner Admin APIs
  getAdminOverview: () => request<any>('/admin/overview'),
  getAdminTasks: () => request<any>('/admin/tasks'),
  createAdminTask: (payload: any) => request<any>('/admin/tasks', { method: 'POST', body: JSON.stringify(payload) }),
  updateAdminTask: (id: string, payload: any) =>
    request<any>(`/admin/tasks/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteAdminTask: (id: string) => request<any>(`/admin/tasks/${id}`, { method: 'DELETE' }),
  getAdminSubmissions: () => request<any>('/admin/submissions'),
  reviewSubmission: (id: string, action: 'APPROVE' | 'REJECT', reason?: string) =>
    request<any>(`/admin/submissions/${id}/review`, { method: 'POST', body: JSON.stringify({ action, reason }) }),
  getAdminWithdrawals: () => request<any>('/admin/withdrawals'),
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
};
