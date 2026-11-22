import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { supabaseDb, generateWalletAddress, generateReferralCode } from './supabaseDb.js';
import { geoService } from './geoService.js';
import { createClixWallHandlers } from './clixwallHandlers.js';
import { createOfferwallGgHandlers } from './offerwallGgHandlers.js';
import {
  getPushPublicStatus,
  saveUserPushSubscription,
  removeUserPushSubscription,
} from './pushService.js';
import {
  assertNoSensitiveSignupFields,
  mapTaskKindToCategory,
  normalizeProofRequirements,
  sanitizeTaskBuilderMeta,
} from '../shared/taskMeta.js';
import { taskSystemService } from './taskSystemService.js';
import {
  parseMoneyStrict,
  addMoney,
  calcWalletTransferBreakdown,
  calculateCampaignFeePolicyCosts,
  formatYer,
} from '../shared/money.js';

const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim().replace(/\.supabase\.com$/i, '.supabase.co');
const AUTH_REDIRECT_URL = (process.env.APP_URL || process.env.FRONTEND_URL || 'https://yemen-microtasks.vip').trim().replace(/\/$/, '');
const SUPABASE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '').trim();

export const supabaseServer = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

// Dedicated Service Role Client for Sensitive Administrative / Ledger Operations
export const getSupabaseAdminClient = () => {
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!serviceKey) {
    throw new Error('SERVICE_ROLE_KEY_MISSING: مفتاح صلاحيات الخادم (SUPABASE_SERVICE_ROLE_KEY) غير مهيأ.');
  }
  return createClient(SUPABASE_URL, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
};

// User-Scoped Supabase Client (passes caller's verified JWT so auth.uid() works inside PostgreSQL RPCs)
export const getSupabaseUserClient = (userToken: string) => {
  const anonKey = (process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '').trim();
  if (!anonKey) {
    throw new Error('SUPABASE_ANON_KEY_MISSING: مفتاح المصادقة العام غير مهيأ.');
  }
  return createClient(SUPABASE_URL, anonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${userToken}`,
      },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
};

// Privileged Database Client: uses Service Role if configured, otherwise falls back to caller's verified JWT (RLS + public.is_admin())
export const getPrivilegedDbClient = (req?: AuthenticatedRequest) => {
  try {
    return getSupabaseAdminClient();
  } catch {
    if (req?.authToken) {
      return getSupabaseUserClient(req.authToken);
    }
    return supabaseServer;
  }
};

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
    let logClient = supabaseServer;
    try {
      logClient = getSupabaseAdminClient();
    } catch {
      logClient = supabaseServer;
    }
    await logClient.from('system_error_logs').insert({
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

// Hardened CORS & Preflight handling (allowlist official domain, local dev, and preview origins)
const STATIC_ALLOWED_ORIGINS = new Set<string>([
  'https://yemen-microtasks.vip',
  'https://www.yemen-microtasks.vip',
  AUTH_REDIRECT_URL,
  'http://localhost:3000',
  'http://127.0.0.1:3000',
]);

function isAllowedCorsOrigin(origin: string, reqHost?: string): boolean {
  if (STATIC_ALLOWED_ORIGINS.has(origin)) return true;
  try {
    const parsed = new URL(origin);
    if (reqHost && parsed.host.toLowerCase() === reqHost.toLowerCase()) return true;
    const hostname = parsed.hostname.toLowerCase();
    if (
      parsed.protocol === 'https:' &&
      (hostname === 'yemen-microtasks.vip' ||
        hostname.endsWith('.yemen-microtasks.vip') ||
        hostname.endsWith('.run.app') ||
        hostname.endsWith('.vercel.app'))
    ) {
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

app.use((req: Request, res: Response, next: NextFunction) => {
  const origin = req.headers.origin;
  if (typeof origin === 'string' && isAllowedCorsOrigin(origin, req.headers.host)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

export interface AuthenticatedRequest extends Request {
  user?: any;
  authToken?: string;
}

// User Authentication Middleware (Validates Real Supabase JWT exclusively)
export const authMiddleware = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: 'غير مصرح: يجب تسجيل الدخول للوصول إلى هذه البيانات.' });
  }

  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
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
      profile = {
        id: authData.user.id,
        fullName: authData.user.user_metadata?.full_name || 'مستخدم كسب اليمن',
        phone: authData.user.user_metadata?.phone || authData.user.phone || '',
        email: authData.user.email,
        avatarUrl: '',
        role: supabaseDb.isAuthorizedOwner(authData.user.id, authData.user.email)
          ? 'admin'
          : authData.user.user_metadata?.role === 'advertiser'
          ? 'advertiser'
          : 'user',
        status: authData.user.user_metadata?.role === 'advertiser' ? 'pending' : 'active',
        referralCode: '',
        city: authData.user.user_metadata?.city || 'صنعاء',
        createdAt: authData.user.created_at,
        updatedAt: authData.user.created_at,
      };
    }

    if (profile.status === 'suspended') {
      return res.status(403).json({ error: 'الحساب مجمد من قبل الإدارة لمخالفة شروط الاستخدام.' });
    }

    const emailConfirmedAt = authData.user.email_confirmed_at || null;
    const isOwner = supabaseDb.isAuthorizedOwner(authData.user.id, authData.user.email);
    const emailVerified = Boolean(emailConfirmedAt) || isOwner;

    // Non-blocking best-effort sync of verified status into profiles table (if migration applied)
    if (emailConfirmedAt) {
      (async () => {
        try {
          const syncClient = getPrivilegedDbClient({ authToken: token } as AuthenticatedRequest);
          await syncClient
            .from('profiles')
            .update({
              email_verified: true,
              email_verified_at: emailConfirmedAt,
            })
            .eq('id', authData.user.id)
            .is('email_verified_at', null);
        } catch {
          // Silently ignore if profiles.email_verified columns are not yet migrated
        }
      })();
    }

    req.user = {
      ...profile,
      emailVerified,
      emailConfirmedAt,
    };
    req.authToken = token;
    next();
  } catch (err: any) {
    return res.status(401).json({ error: 'فشل في التحقق من جلسة المصادقة مع قاعدة البيانات.' });
  }
};

// Authoritative Server-Side Email Verification Enforcement (Real Supabase Auth email_confirmed_at)
const requireVerifiedEmail = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (!req.user) {
    return res.status(401).json({ error: 'غير مصرح: يرجى تسجيل الدخول.' });
  }
  if (req.user.role === 'admin' || req.user.emailVerified === true) {
    return next();
  }
  return res.status(403).json({
    error: 'يجب تأكيد بريدك الإلكتروني أولاً عبر رابط التفعيل المرسل من المنصة قبل تنفيذ هذه العملية.',
    code: 'EMAIL_NOT_VERIFIED',
  });
};

// In-memory resend cooldown map (60 seconds per email) to prevent abuse
const verificationResendCooldowns = new Map<string, number>();

// Strict Single Administrator Middleware
export const adminMiddleware = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  await authMiddleware(req, res, () => {
    if (!req.user || (req.user.role !== 'admin' && !supabaseDb.isAuthorizedOwner(req.user.id, req.user.email))) {
      return res.status(403).json({ error: 'وصول محظور: هذه الواجهة مخصصة حصرياً لمالك المنصة المعتمد.' });
    }
    next();
  });
};

// Advertiser Middleware
export const advertiserMiddleware = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  await authMiddleware(req, res, () => {
    if (!req.user || req.user.role !== 'advertiser') {
      return res.status(403).json({ error: 'وصول محظور: هذه الواجهة مخصصة للمعلنين فقط.' });
    }
    if (req.user.status !== 'active') {
      return res.status(403).json({ error: 'حساب المعلن الخاص بك قيد الانتظار ولم يتم اعتماده بعد من الإدارة.' });
    }
    next();
  });
};

// ==============================================================================
// PUBLIC & REAL USER AUTH
// ==============================================================================

app.post('/api/auth/register', async (req: Request, res: Response) => {
  try {
    const {
      fullName,
      phone,
      email,
      password,
      city,
      countryId,
      administrativeDivisionId,
      referralCode,
      role,
      companyName,
    } = req.body || {};
    if (!fullName || !phone || !password || typeof email !== 'string' || !email.trim()) {
      return res.status(400).json({ error: 'يرجى إدخال الاسم ورقم الهاتف والبريد الإلكتروني وكلمة المرور.' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'كلمة المرور يجب أن لا تقل عن 6 خانات.' });
    }

    // 0. Validate optional Arab League country / administrative division before account creation
    let geoValidated: Awaited<ReturnType<typeof geoService.validateGeoSelection>> | null = null;
    if (countryId || administrativeDivisionId) {
      try {
        geoValidated = await geoService.validateGeoSelection({
          countryId: countryId ? String(countryId) : null,
          divisionId: administrativeDivisionId ? String(administrativeDivisionId) : null,
          requireActiveCountry: true,
        });
      } catch (geoErr: any) {
        return res.status(400).json({ error: geoErr?.message || 'الموقع الجغرافي المحدد غير صالح.' });
      }
    }

    const resolvedCity =
      city?.trim() ||
      geoValidated?.division?.nameAr ||
      geoValidated?.country?.nameAr ||
      'صنعاء';

    const cleanPhone = phone.trim();
    const cleanEmail = email.trim().toLowerCase();
    const cleanReferralCode = typeof referralCode === 'string' ? referralCode.trim().toUpperCase() : '';

    // 1. Validate optional referral code strictly BEFORE creating auth user (reject nonexistent / self-referral)
    let resolvedReferrer: { referrerId: string; referralCode: string; phone?: string } | null = null;
    if (cleanReferralCode && role !== 'advertiser') {
      if (cleanReferralCode.length < 4 || cleanReferralCode.length > 32) {
        return res.status(400).json({ error: 'صيغة كود الإحالة غير صالحة.' });
      }
      resolvedReferrer = await supabaseDb.resolveReferralCode(cleanReferralCode);
      if (!resolvedReferrer) {
        return res.status(400).json({ error: 'كود الإحالة المدخل غير صحيح أو غير موجود في النظام.' });
      }
      if (resolvedReferrer.phone && resolvedReferrer.phone.trim() === cleanPhone) {
        return res.status(400).json({ error: 'لا يمكنك استخدام كود الإحالة الخاص بك.' });
      }
    }

    // 2. Check duplicate phone or email in existing profiles
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

    // 3. Register strictly via Supabase Auth (passing referred_by_code & geo metadata so DB trigger handles them atomically)
    const { data: supaAuth, error: supaAuthErr } = await supabaseServer.auth.signUp({
      email: cleanEmail,
      password: password,
      options: {
        emailRedirectTo: `${AUTH_REDIRECT_URL}/`,
        data: {
          full_name: fullName.trim(),
          phone: cleanPhone,
          city: resolvedCity,
          ...(geoValidated?.country ? { country_id: geoValidated.country.id } : {}),
          ...(geoValidated?.division ? { administrative_division_id: geoValidated.division.id } : {}),
          role: role === 'advertiser' ? 'advertiser' : 'user',
          ...(resolvedReferrer ? { referred_by_code: resolvedReferrer.referralCode } : {}),
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
    if (resolvedReferrer && resolvedReferrer.referrerId === authUserId) {
      return res.status(400).json({ error: 'لا يمكنك إحالة نفسك.' });
    }

    const now = new Date().toISOString();
    const assignedRole = cleanEmail === supabaseDb.getOwnerEmail() ? 'admin' : (role === 'advertiser' ? 'advertiser' : 'user');
    const initialStatus = assignedRole === 'advertiser' ? 'pending' : 'active';
    const generatedRefCode = generateReferralCode(authUserId);
    const dbClient = (() => {
      try {
        return getSupabaseAdminClient();
      } catch {
        if (supaAuth.session?.access_token) {
          return getSupabaseUserClient(supaAuth.session.access_token);
        }
        return supabaseServer;
      }
    })();

    // 4. Create/Update Profile safely without overwriting an existing referral_code or referred_by
    let existingProfile: any = null;
    const { data: existingWithRef, error: existingErr } = await dbClient
      .from('profiles')
      .select('id, referral_code, referred_by')
      .eq('id', authUserId)
      .maybeSingle();

    if (existingErr && (existingErr.code === '42703' || String(existingErr.message || '').includes('referred_by'))) {
      const { data: existingLegacy } = await dbClient
        .from('profiles')
        .select('id, referral_code')
        .eq('id', authUserId)
        .maybeSingle();
      existingProfile = existingLegacy;
    } else {
      existingProfile = existingWithRef;
    }

    const finalReferralCode = existingProfile?.referral_code || generatedRefCode;
    const baseProfileFields: Record<string, any> = {
      id: authUserId,
      full_name: fullName.trim(),
      phone: cleanPhone,
      email: cleanEmail,
      city: resolvedCity,
      ...(geoValidated?.country ? { country_id: geoValidated.country.id } : {}),
      ...(geoValidated?.division ? { administrative_division_id: geoValidated.division.id } : {}),
      ...(geoValidated?.division ? { area_name: geoValidated.division.nameAr } : {}),
      account_status: initialStatus,
      referral_code: finalReferralCode,
      updated_at: now,
      ...(assignedRole === 'advertiser' ? {
        company_name: companyName?.trim() || '',
        contact_person: fullName.trim(),
      } : {}),
    };

    if (!existingProfile) {
      baseProfileFields.created_at = now;
      if (resolvedReferrer) {
        baseProfileFields.referred_by = resolvedReferrer.referrerId;
      }
    } else if (resolvedReferrer && !existingProfile.referred_by) {
      // Only attach referred_by during initial registration if trigger didn't set it yet
      baseProfileFields.referred_by = resolvedReferrer.referrerId;
    }

    let profileData: any = null;
    let profileErr: any = null;
    const attemptUpsert = await dbClient
      .from('profiles')
      .upsert(baseProfileFields, { onConflict: 'id' })
      .select('id, full_name, phone, city, area_name, country_id, administrative_division_id, account_status, referral_code, referred_by, company_name, contact_person, created_at, updated_at')
      .single();

    profileData = attemptUpsert.data;
    profileErr = attemptUpsert.error;

    // Pre-Migration 014 / 028 fallback if columns aren't added yet, or trigger blocks updating referred_by
    if (
      profileErr &&
      (profileErr.code === '42703' ||
        String(profileErr.message || '').includes('referred_by') ||
        String(profileErr.message || '').includes('country_id') ||
        String(profileErr.message || '').includes('administrative_division_id') ||
        String(profileErr.message || '').includes('company_name') ||
        String(profileErr.message || '').includes('immutable'))
    ) {
      const {
        referred_by: _omit,
        company_name: _omitComp,
        contact_person: _omitContact,
        country_id: _omitCountry,
        administrative_division_id: _omitDiv,
        area_name: _omitArea,
        ...legacyFields
      } = baseProfileFields;
      const retry = await dbClient
        .from('profiles')
        .upsert(legacyFields, { onConflict: 'id' })
        .select('id, full_name, phone, city, account_status, referral_code, created_at, updated_at')
        .single();
      profileData = retry.data;
      profileErr = retry.error;
    }

    if (profileErr) {
      await logSupabaseError({
        err: profileErr,
        operation: 'REGISTER_PROFILE_UPSERT',
        sourceTable: 'profiles',
        apiRoute: '/api/auth/register',
      });
      return res.status(400).json({ error: `فشل في إنشاء الملف الشخصي: ${profileErr.message}` });
    }

    const { error: roleUpsertErr } = await dbClient
      .from('user_roles')
      .upsert({ user_id: authUserId, role: assignedRole }, { onConflict: 'user_id' });
    if (roleUpsertErr) {
      await logSupabaseError({
        err: roleUpsertErr,
        operation: 'REGISTER_USER_ROLE_UPSERT',
        sourceTable: 'user_roles',
        apiRoute: '/api/auth/register',
      });
      return res.status(400).json({
        error:
          assignedRole === 'advertiser'
            ? `تعذر تعيين صلاحية المعلن في قاعدة البيانات (تأكد من تشغيل الترحيل 019): ${roleUpsertErr.message}`
            : `فشل حفظ صلاحية المستخدم: ${roleUpsertErr.message}`,
      });
    }

    // 5. Create/Get Wallet & Financial Account strictly for authUserId
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

    // 6. Handle Session and Response
    const userPayload = {
      id: profileData.id,
      fullName: profileData.full_name,
      phone: profileData.phone,
      email: cleanEmail,
      role: assignedRole,
      status: profileData.account_status || initialStatus,
      referralCode: profileData.referral_code || finalReferralCode,
      referredBy: profileData.referred_by || resolvedReferrer?.referrerId || undefined,
      city: profileData.city || resolvedCity,
      areaName: profileData.area_name || geoValidated?.division?.nameAr || null,
      countryId: profileData.country_id || geoValidated?.country?.id || null,
      countryCode: geoValidated?.country?.iso2 || null,
      countryNameAr: geoValidated?.country?.nameAr || null,
      countryFlag: geoValidated?.country?.flagEmoji || null,
      administrativeDivisionId: profileData.administrative_division_id || geoValidated?.division?.id || null,
      locationPath: geoValidated?.locationPath || null,
      companyName: companyName?.trim() || undefined,
      contactPerson: fullName.trim(),
      emailVerified: Boolean(supaAuth.user.email_confirmed_at),
      emailConfirmedAt: supaAuth.user.email_confirmed_at || null,
      createdAt: profileData.created_at,
      updatedAt: profileData.updated_at,
    };

    if (supaAuth.session?.access_token) {
      return res.json({
        success: true,
        token: supaAuth.session.access_token,
        refreshToken: supaAuth.session.refresh_token,
        user: userPayload,
        wallet,
      });
    }

    return res.json({
      success: true,
      requiresEmailConfirmation: true,
      message: 'تم إنشاء الحساب بنجاح. يرجى مراجعة بريدك الإلكتروني لتأكيد الحساب قبل تسجيل الدخول.',
      token: null,
      refreshToken: null,
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
      const rawErrMsg = String(authErr?.message || '').toLowerCase();
      if (rawErrMsg.includes('email not confirmed') || rawErrMsg.includes('not confirmed')) {
        return res.status(403).json({
          error: 'يجب تأكيد بريدك الإلكتروني أولاً عبر رابط التفعيل المرسل إليك قبل تسجيل الدخول.',
          code: 'EMAIL_NOT_VERIFIED',
        });
      }
      return res.status(401).json({ error: 'بيانات الدخول غير صحيحة.' });
    }

    totalSuccessfulOps++;
    lastSuccessfulConnectionTime = new Date().toISOString();

    const baseProfile = (await supabaseDb.findUserById(authRes.user.id)) || {
      id: authRes.user.id,
      fullName: authRes.user.user_metadata?.full_name || 'مستخدم',
      phone: authRes.user.user_metadata?.phone || '',
      email: authRes.user.email,
      role:
        authRes.user.email === supabaseDb.getOwnerEmail()
          ? 'admin'
          : authRes.user.user_metadata?.role === 'advertiser'
          ? 'advertiser'
          : 'user',
      status: authRes.user.user_metadata?.role === 'advertiser' ? 'pending' : 'active',
      referralCode: generateReferralCode(authRes.user.id),
      city: 'صنعاء',
      createdAt: authRes.user.created_at,
      updatedAt: authRes.user.created_at,
    };

    if (baseProfile.status === 'suspended') {
      return res.status(403).json({ error: 'تم تجميد هذا الحساب لمخالفة شروط الاستخدام.' });
    }

    const emailConfirmedAt = authRes.user.email_confirmed_at || null;
    const isOwner = supabaseDb.isAuthorizedOwner(authRes.user.id, authRes.user.email);
    const profile = {
      ...baseProfile,
      emailVerified: Boolean(emailConfirmedAt) || isOwner,
      emailConfirmedAt,
    };

    const wallet = await supabaseDb.getWallet(authRes.user.id);
    return res.json({
      success: true,
      token: authRes.session.access_token,
      refreshToken: authRes.session.refresh_token,
      user: profile,
      wallet,
    });
  } catch (err: any) {
    console.error('[AUTH_LOGIN_ERROR]', err?.message || err);
    return res.status(401).json({ error: 'بيانات الدخول غير صحيحة أو تعذر التحقق.' });
  }
});

// Real Supabase Auth Email Verification Resend Endpoint (60s rate limit per email)
app.post('/api/auth/resend-verification', async (req: Request, res: Response) => {
  try {
    let targetEmail = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';

    // If caller is authenticated, prefer the verified auth token email
    const authHeader = req.headers.authorization;
    if (authHeader) {
      const token = authHeader.replace(/^Bearer\s+/i, '').trim();
      if (token) {
        const { data: authData } = await supabaseServer.auth.getUser(token);
        if (authData?.user?.email) {
          if (authData.user.email_confirmed_at) {
            return res.json({
              success: true,
              alreadyVerified: true,
              message: 'بريدك الإلكتروني مؤكد بالفعل.',
            });
          }
          targetEmail = authData.user.email.trim().toLowerCase();
        }
      }
    }

    if (!targetEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(targetEmail)) {
      return res.status(400).json({ error: 'يرجى إدخال بريد إلكتروني صحيح لإعادة إرسال رابط التفعيل.' });
    }

    const nowMs = Date.now();
    const lastSentMs = verificationResendCooldowns.get(targetEmail) || 0;
    const waitSec = Math.ceil((60_000 - (nowMs - lastSentMs)) / 1000);
    if (waitSec > 0) {
      return res.status(429).json({
        error: `يرجى الانتظار ${waitSec} ثانية قبل إعادة إرسال رابط التفعيل مجدداً.`,
      });
    }

    const { error: resendErr } = await supabaseServer.auth.resend({
      type: 'signup',
      email: targetEmail,
      options: {
        emailRedirectTo: `${AUTH_REDIRECT_URL}/`,
      },
    });

    if (resendErr) {
      return res.status(400).json({
        error: resendErr.message || 'تعذر إرسال رسالة التفعيل في الوقت الحالي. حاول لاحقاً.',
      });
    }

    verificationResendCooldowns.set(targetEmail, nowMs);
    return res.json({
      success: true,
      message: 'تم إرسال رابط التفعيل الرسمي إلى بريدك الإلكتروني. تحقق من الوارد والرسائل غير المرغوب فيها.',
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'تعذر إعادة إرسال رابط التفعيل.' });
  }
});

app.post('/api/auth/refresh', async (req: Request, res: Response) => {
  try {
    const refreshToken = typeof req.body?.refreshToken === 'string' ? req.body.refreshToken.trim() : '';
    if (!refreshToken) {
      return res.status(401).json({ error: 'رمز تحديث الجلسة مفقود.' });
    }

    const { data, error } = await supabaseServer.auth.refreshSession({ refresh_token: refreshToken });
    if (error || !data?.session?.access_token || !data?.user) {
      return res.status(401).json({ error: 'انتهت صلاحية الجلسة، يرجى تسجيل الدخول مجدداً.' });
    }

    const profile = await supabaseDb.findUserById(data.user.id);
    if (profile?.status === 'suspended') {
      return res.status(403).json({ error: 'تم تجميد هذا الحساب لمخالفة شروط الاستخدام.' });
    }

    return res.json({
      success: true,
      token: data.session.access_token,
      refreshToken: data.session.refresh_token || refreshToken,
    });
  } catch {
    return res.status(401).json({ error: 'تعذر تجديد الجلسة، يرجى تسجيل الدخول مجدداً.' });
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

// Health & System Status
app.get('/api', (_req: Request, res: Response) => {
  res.json({
    ok: true,
    service: 'yemen-task-api',
    currency: 'YER',
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({
    ok: true,
    service: 'yemen-task-api',
    isSupabaseConfigured: Boolean(SUPABASE_URL && SUPABASE_KEY),
    timestamp: new Date().toISOString(),
  });
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
    const dbClient = (() => {
      try {
        return getSupabaseAdminClient();
      } catch {
        return supabaseServer;
      }
    })();

    const [tasksRes, usersRes, setRes] = await Promise.all([
      dbClient.from('tasks').select('id, reward_units, approved_count, status'),
      dbClient.from('profiles').select('id', { count: 'exact', head: true }),
      supabaseDb.getSettings(),
    ]);

    const tasks = tasksRes.data || [];
    const totalCompletedTasks = tasks.reduce((sum, t: any) => sum + Number(t.approved_count ?? 0), 0);
    const totalTaskRewardsPaidYer = tasks.reduce(
      (sum, t: any) => sum + Number(t.approved_count ?? 0) * Number(t.reward_units ?? 0),
      0
    );
    const activeTasksCount = tasks.filter((t: any) => String(t.status || '').toUpperCase() === 'ACTIVE').length;
    const totalRegisteredUsers = usersRes.count || 0;

    res.json({
      totalCompletedTasks,
      totalWithdrawnYer: 0,
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

// Authenticated Profile Location Update
app.put('/api/profile/location', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { countryId, administrativeDivisionId, areaName, city } = req.body || {};
    if (!countryId) {
      return res.status(400).json({ error: 'يرجى تحديد الدولة العربية.' });
    }
    const updatedUser = await supabaseDb.updateUserProfileLocation(
      req.user.id,
      {
        countryId: String(countryId),
        administrativeDivisionId: administrativeDivisionId ? String(administrativeDivisionId) : null,
        areaName: areaName ? String(areaName) : undefined,
        city: city ? String(city) : undefined,
      },
      req.authToken
    );
    res.json({ success: true, user: updatedUser });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'تعذر تحديث الموقع الجغرافي للحساب.' });
  }
});

// Public Geographic Hierarchy Endpoints (22 Arab League Countries)
app.get('/api/geo/countries', async (req: Request, res: Response) => {
  try {
    const includeInactive = String(req.query.includeInactive || '').toLowerCase() === 'true';
    const result = await geoService.getCountries({ includeInactive });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'فشل جلب قائمة الدول العربية.' });
  }
});

app.get('/api/geo/countries/:countryId/levels', async (req: Request, res: Response) => {
  try {
    const levels = await geoService.getCountryLevels(req.params.countryId);
    res.json({ levels });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'فشل جلب المستويات الإدارية للدولة.' });
  }
});

app.get('/api/geo/divisions', async (req: Request, res: Response) => {
  try {
    const countryId = req.query.countryId ? String(req.query.countryId) : '';
    if (!countryId) {
      return res.status(400).json({ error: 'معرف الدولة (countryId) مطلوب.' });
    }
    const parentId = req.query.parentId === undefined ? null : req.query.parentId ? String(req.query.parentId) : null;
    const levelId = req.query.levelId ? String(req.query.levelId) : undefined;
    const search = req.query.search ? String(req.query.search) : undefined;
    const includeInactive = String(req.query.includeInactive || '').toLowerCase() === 'true';
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const divisions = await geoService.getDivisions({
      countryId,
      parentId: search && req.query.parentId === undefined ? undefined : parentId,
      levelId,
      search,
      includeInactive,
      limit,
    });
    res.json({ divisions });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'فشل جلب التقسيمات الإدارية.' });
  }
});

app.get('/api/geo/divisions/:id/children', async (req: Request, res: Response) => {
  try {
    const divisions = await geoService.getDivisionChildren(req.params.id);
    res.json({ divisions });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'فشل جلب التقسيمات الفرعية.' });
  }
});

app.get('/api/geo/divisions/:id/path', async (req: Request, res: Response) => {
  try {
    const result = await geoService.getDivisionPath(req.params.id);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'فشل جلب المسار الجغرافي الكامل.' });
  }
});

async function resolveOptionalUserId(req: Request): Promise<string | undefined> {
  const authHeader = req.headers.authorization;
  if (!authHeader) return undefined;
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return undefined;
  try {
    const { data } = await supabaseServer.auth.getUser(token);
    return data?.user?.id || undefined;
  } catch {
    return undefined;
  }
}

// Task Categories & Visual Assets
app.get('/api/task-categories', async (_req: Request, res: Response) => {
  try {
    const categories = await taskSystemService.getTaskCategories();
    res.json({ categories });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'فشل جلب تصنيفات المهام.' });
  }
});

app.get('/api/task-assets', async (_req: Request, res: Response) => {
  try {
    const assets = await taskSystemService.getTaskAssets();
    res.json({ assets });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'فشل جلب مكتبة صور المهام.' });
  }
});

// Tasks (Public / User)
app.get('/api/tasks', async (req: Request, res: Response) => {
  try {
    const { category, search, countryId, divisionId } = req.query;
    const userId = await resolveOptionalUserId(req);
    const tasks = await supabaseDb.getTasks({
      category: category ? String(category) : undefined,
      search: search ? String(search) : undefined,
      countryId: countryId ? String(countryId) : undefined,
      divisionId: divisionId ? String(divisionId) : undefined,
      userId,
    });
    res.json({ tasks });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'فشل جلب قائمة المهام من Supabase.' });
  }
});

app.get('/api/tasks/favorites', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const favoriteIds = await taskSystemService.getUserFavoriteTaskIds(req.user.id);
    res.json({ favoriteIds });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'تعذر جلب المهام المفضلة.' });
  }
});

app.post('/api/tasks/:id/favorite', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await taskSystemService.toggleUserFavoriteTask(req.user.id, req.params.id);
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'تعذر تحديث المفضلة.' });
  }
});

app.post('/api/tasks/:id/execution-session/start', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const mode = req.body?.mode === 'website_visit' ? 'website_visit' : 'video_watch';
    const task = await supabaseDb.getTaskById(req.params.id, { userId: req.user.id, maskSecrets: true });
    if (!task) {
      return res.status(404).json({ error: 'المهمة المطلوبة غير موجودة.' });
    }
    const session = await taskSystemService.startExecutionSession({
      task,
      userId: req.user.id,
      mode,
    });
    res.json({ success: true, session });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'تعذر بدء جلسة التحقق للمهمة.' });
  }
});

app.post('/api/tasks/:id/execution-session/ping', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { sessionId, deltaSeconds, playerActive, returnedFromVisit } = req.body || {};
    if (!sessionId) {
      return res.status(400).json({ error: 'معرف جلسة التنفيذ مطلوب.' });
    }
    const session = await taskSystemService.pingExecutionSession({
      taskId: req.params.id,
      sessionId: String(sessionId),
      userId: req.user.id,
      deltaSeconds: deltaSeconds !== undefined ? Number(deltaSeconds) : undefined,
      playerActive: playerActive !== undefined ? Boolean(playerActive) : undefined,
      returnedFromVisit: returnedFromVisit !== undefined ? Boolean(returnedFromVisit) : undefined,
    });
    res.json({ success: true, session });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'تعذر تحديث مدة التنفيذ.' });
  }
});

app.get('/api/tasks/:id', async (req: Request, res: Response) => {
  try {
    const userId = await resolveOptionalUserId(req);
    const task = await supabaseDb.getTaskById(req.params.id, { userId, maskSecrets: true });
    if (!task) {
      return res.status(404).json({ error: 'المهمة المطلوبة غير موجودة.' });
    }
    res.json({ task });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'فشل جلب تفاصيل المهمة.' });
  }
});

// Secure Signed Upload URL & Signed Read URL for Private "task-proofs" Bucket
app.post('/api/upload/signed-url', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { taskId, fileName, contentType, fileSize } = req.body || {};
    if (!taskId) {
      return res.status(400).json({ error: 'معرف المهمة مطلوب لرفع الإثبات' });
    }

    const cleanContentType = String(contentType || '').trim().toLowerCase();
    const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];
    if (!ALLOWED_MIME_TYPES.includes(cleanContentType)) {
      return res.status(400).json({ error: 'صيغة الملف غير مدعومة. يرجى اختيار صورة بصيغة JPEG أو PNG أو WEBP.' });
    }

    const numSize = Number(fileSize) || 0;
    if (numSize > 5 * 1024 * 1024) {
      return res.status(400).json({ error: 'حجم الصورة يتجاوز الحد الأقصى المسموح (5 ميجابايت).' });
    }

    // Verify task exists and is active
    const task = await supabaseDb.getTaskById(taskId);
    if (!task) {
      return res.status(404).json({ error: 'المهمة المطلوبة غير موجودة.' });
    }

    const adminClient = getSupabaseAdminClient();
    const safeFileName = (fileName || 'proof.jpg').replace(/[^a-zA-Z0-9_.-]/g, '_');
    const storagePath = `tasks/${taskId}/${req.user.id}/${Date.now()}_${crypto.randomUUID().slice(0, 6)}_${safeFileName}`;

    const { data, error } = await adminClient.storage
      .from('task-proofs')
      .createSignedUploadUrl(storagePath);

    if (error || !data?.signedUrl) {
      await logSupabaseError({
        err: error || 'createSignedUploadUrl returned null',
        operation: 'CREATE_SIGNED_UPLOAD_URL',
        sourceTable: 'task-proofs',
        apiRoute: '/api/upload/signed-url',
        details: { taskId, userId: req.user.id },
      });
      return res.status(500).json({ error: `فشل إنشاء رابط الرفع الآمن: ${error?.message || 'خطأ غير معروف'}` });
    }

    return res.json({
      signedUrl: data.signedUrl,
      token: data.token,
      path: storagePath,
    });
  } catch (err: any) {
    console.error('Signed upload error:', err);
    return res.status(500).json({ error: err.message || 'حدث خطأ أثناء إنشاء رابط الرفع الآمن' });
  }
});

app.post('/api/storage/signed-url', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { storagePath } = req.body || {};
    const cleanPath = typeof storagePath === 'string' ? storagePath.trim() : '';
    if (!cleanPath || cleanPath.includes('..')) {
      return res.status(400).json({ error: 'مسار التخزين مطلوب' });
    }

    const isAdmin = req.user?.role === 'admin';
    const userId = req.user?.id;

    if (!isAdmin) {
      if (cleanPath.startsWith('external-receipts/')) {
        const isOwnerPath = cleanPath.startsWith(`external-receipts/${userId}/`);
        if (!isOwnerPath) {
          const adminClient = getSupabaseAdminClient();
          const { data: dep } = await adminClient
            .from('external_deposits')
            .select('id')
            .eq('advertiser_id', userId)
            .eq('receipt_url', cleanPath)
            .maybeSingle();
          if (!dep) {
            return res.status(403).json({ error: 'صلاحية مرفوضة: لا يمكنك عرض إيصالات خاصة بمستخدمين آخرين.' });
          }
        }
      } else if (cleanPath.startsWith('withdrawal-receipts/')) {
        const isOwnerPath = cleanPath.startsWith(`withdrawal-receipts/${userId}/`);
        if (!isOwnerPath) {
          const adminClient = getSupabaseAdminClient();
          const { data: withReq } = await adminClient
            .from('withdrawal_requests')
            .select('id')
            .eq('user_id', userId)
            .eq('receipt_url', cleanPath)
            .maybeSingle();
          if (!withReq) {
            return res.status(403).json({ error: 'صلاحية مرفوضة: لا يمكنك عرض إشعارات صرف خاصة بمستخدمين آخرين.' });
          }
        }
      }
    }

    const adminClient = getSupabaseAdminClient();
    const { data, error } = await adminClient.storage
      .from('task-proofs')
      .createSignedUrl(cleanPath, 3600); // 1 hour validity

    if (error || !data?.signedUrl) {
      return res.status(404).json({ error: `تعذر إصدار رابط عرض الصورة: ${error?.message || 'الملف غير موجود'}` });
    }

    return res.json({ signedUrl: data.signedUrl });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'تعذر جلب رابط عرض الصورة' });
  }
});

app.post('/api/public/advertiser-logo-url', async (req: Request, res: Response) => {
  try {
    const cleanPath = typeof req.body?.storagePath === 'string' ? req.body.storagePath.trim() : '';
    if (!cleanPath || !/^advertiser-logos\/[a-zA-Z0-9_./-]+$/i.test(cleanPath) || cleanPath.includes('..')) {
      return res.status(400).json({ error: 'مسار شعار المعلن غير صالح.' });
    }
    const adminClient = getSupabaseAdminClient();
    const { data, error } = await adminClient.storage
      .from('task-proofs')
      .createSignedUrl(cleanPath, 3600);

    if (error || !data?.signedUrl) {
      return res.status(404).json({ error: 'تعذر عرض شعار المعلن.' });
    }
    return res.json({ signedUrl: data.signedUrl });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'تعذر جلب شعار المعلن.' });
  }
});

// Task Submission (creates pending submission only; zero payout until admin approval; requires verified email)
app.post('/api/tasks/submit', authMiddleware, requireVerifiedEmail, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const {
      taskId,
      proofText,
      proofImages,
      proofUrl,
      proofCodeNumber,
      proofChoiceAnswer,
      proofMultiAnswers,
      executionSessionId,
    } = req.body || {};
    if (!taskId) {
      return res.status(400).json({ error: 'معرف المهمة مطلوب.' });
    }

    const submission = await supabaseDb.submitTaskProof({
      taskId: String(taskId),
      userId: req.user.id,
      authToken: req.authToken,
      proofText,
      proofImages,
      proofUrl,
      proofCodeNumber,
      proofChoiceAnswer,
      proofMultiAnswers,
      executionSessionId,
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

app.get('/api/wallet/transfers', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const txs = await supabaseDb.getTransactions(req.user.id);
    const transfers = txs
      .filter((t) => t.type === 'WALLET_TRANSFER_SENT' || t.type === 'WALLET_TRANSFER_RECEIVED')
      .map((t) => ({
        id: t.id,
        senderId: t.type === 'WALLET_TRANSFER_SENT' ? req.user.id : '',
        senderWalletAddress: '',
        senderName: t.type === 'WALLET_TRANSFER_SENT' ? req.user.fullName : 'محفظة أخرى',
        recipientId: t.type === 'WALLET_TRANSFER_RECEIVED' ? req.user.id : '',
        recipientWalletAddress: '',
        recipientName: t.type === 'WALLET_TRANSFER_RECEIVED' ? req.user.fullName : 'محفظة أخرى',
        amount: Math.abs(t.amount),
        note: t.description,
        status: 'COMPLETED',
        createdAt: t.createdAt,
      }));
    res.json({ transfers });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'فشل جلب سجل التحويلات.' });
  }
});

app.post('/api/wallet/transfer', authMiddleware, requireVerifiedEmail, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { recipientAddress, amount, note, idempotencyKey } = req.body || {};

    if (!req.authToken) {
      return res.status(401).json({ error: 'رمز الجلسة غير صالح.' });
    }

    const numAmount = parseMoneyStrict(amount);
    if (!Number.isFinite(numAmount) || numAmount <= 0) {
      return res.status(400).json({ error: 'يرجى تحديد مبلغ محدد أكبر من صفر للتحويل.' });
    }

    if (!recipientAddress || typeof recipientAddress !== 'string' || !recipientAddress.trim()) {
      return res.status(400).json({ error: 'يرجى تحديد عنوان محفظة المستلم.' });
    }

    const cleanRecipientAddress = recipientAddress.trim().toUpperCase();
    const cleanIdempotencyKey = idempotencyKey ? String(idempotencyKey).trim() : `TX-${crypto.randomUUID()}`;
    const cleanNote = note ? String(note).trim() : null;

    const userClient = getSupabaseUserClient(req.authToken);
    const { data: rpcResult, error: rpcErr } = await userClient.rpc('transfer_wallet_units', {
      p_recipient_wallet_address: cleanRecipientAddress,
      p_amount_units: numAmount,
      p_idempotency_key: cleanIdempotencyKey,
      p_note: cleanNote,
    });

    if (rpcErr) {
      await logSupabaseError({
        err: rpcErr,
        operation: 'ATOMIC_WALLET_TRANSFER_RPC',
        sourceTable: 'financial_accounts',
        apiRoute: '/api/wallet/transfer',
        details: { senderId: req.user.id, recipientAddress: cleanRecipientAddress, amount: numAmount, idempotencyKey: cleanIdempotencyKey },
      });
      return res.status(400).json({ error: rpcErr.message || 'فشلت عملية التحويل المالي.' });
    }

    const updatedSenderWallet = await supabaseDb.getWallet(req.user.id);

    // Non-blocking notification to recipient (does not touch RPC/balances)
    (async () => {
      try {
        const dbClient = getPrivilegedDbClient(req);
        const { data: recWallet } = await dbClient
          .from('wallets')
          .select('user_id')
          .eq('wallet_address', cleanRecipientAddress)
          .maybeSingle();
        if (recWallet?.user_id) {
          await supabaseDb.createNotification({
            userId: recWallet.user_id,
            title: 'حوالة مالية واردة لمحفظتك',
            message: `تم استلام مبلغ ${formatYer(numAmount)} ر.ي من ${req.user.fullName || 'مستخدم'}${cleanNote ? ` — ${cleanNote}` : ''}.`,
            type: 'WALLET_TRANSFER_RECEIVED',
            link: '/wallet',
          });
        }
      } catch {
        // Non-blocking
      }
    })();

    return res.json({
      success: true,
      transferId: typeof rpcResult === 'string' ? rpcResult : (rpcResult?.transferId || rpcResult?.id),
      newAvailableBalance: updatedSenderWallet.availableBalance,
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

// Withdrawals (Double-Entry Ledger Reservation — requires verified email)
app.post('/api/withdrawals/request', authMiddleware, requireVerifiedEmail, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { method, amount, beneficiaryName, phoneNumber, accountNumber, idempotencyKey } = req.body || {};

    const numAmount = parseMoneyStrict(amount, {
      allowNegative: false,
      allowZero: false,
      fieldLabel: 'مبلغ السحب',
    });

    if (!method || typeof method !== 'string' || !method.trim()) {
      return res.status(400).json({ error: 'يرجى تحديد طريقة السحب.' });
    }

    if (!beneficiaryName || typeof beneficiaryName !== 'string' || !beneficiaryName.trim()) {
      return res.status(400).json({ error: 'اسم المستفيد التجاري أو الشخصي مطلوب.' });
    }

    if (!phoneNumber || typeof phoneNumber !== 'string' || !phoneNumber.trim()) {
      return res.status(400).json({ error: 'رقم كشف الحساب أو الهاتف المحول إليه مطلوب.' });
    }

    const result = await supabaseDb.reserveWithdrawal({
      userId: req.user.id,
      method: method.trim(),
      amount: numAmount,
      beneficiaryName: beneficiaryName.trim(),
      phoneNumber: phoneNumber.trim(),
      accountNumber: accountNumber ? String(accountNumber).trim() : null,
      idempotencyKey: idempotencyKey ? String(idempotencyKey).trim() : null,
      authToken: req.authToken,
    });

    const updatedWallet = await supabaseDb.getWallet(req.user.id);
    return res.json({
      success: true,
      idempotent: Boolean(result?.idempotent),
      withdrawalId: result?.withdrawalId,
      transactionId: result?.transactionId,
      newAvailableBalance: result?.newAvailableBalance ?? updatedWallet.availableBalance,
      wallet: updatedWallet,
      result,
    });
  } catch (err: any) {
    await logSupabaseError({
      err,
      operation: 'WITHDRAWAL_REQUEST_ROUTE_FAIL',
      sourceTable: 'withdrawal_requests',
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

app.post('/api/notifications/:id/read', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    await supabaseDb.markSingleNotificationRead(req.user.id, req.params.id, req.authToken);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'فشل تحديث حالة الإشعار.' });
  }
});

// Web Push Configuration & Per-User Subscription Management
app.get('/api/notifications/push-config', authMiddleware, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    res.json(getPushPublicStatus());
  } catch (err: any) {
    res.json({ configured: false, publicKey: null, reason: err?.message || 'تعذر التحقق من إعدادات الإشعارات.' });
  }
});

app.post('/api/notifications/push-subscribe', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const subscription = req.body?.subscription || req.body;
    const endpoint = subscription?.endpoint;
    const p256dh = subscription?.keys?.p256dh;
    const auth = subscription?.keys?.auth;
    if (!endpoint || !p256dh || !auth) {
      return res.status(400).json({ error: 'بيانات اشتراك المتصفح غير مكتملة.' });
    }
    const result = await saveUserPushSubscription({
      userId: req.user.id,
      endpoint: String(endpoint),
      p256dh: String(p256dh),
      auth: String(auth),
      userAgent: req.headers['user-agent'] ? String(req.headers['user-agent']) : undefined,
    });
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'تعذر حفظ اشتراك الإشعارات.' });
  }
});

app.delete('/api/notifications/push-subscribe', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const endpoint = req.body?.endpoint ? String(req.body.endpoint) : undefined;
    await removeUserPushSubscription({ userId: req.user.id, endpoint });
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'تعذر إلغاء اشتراك الإشعارات.' });
  }
});

app.post('/api/admin/notifications/broadcast', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { title, message, targetUserId, link } = req.body || {};
    const cleanTitle = String(title || '').trim();
    const cleanMessage = String(message || '').trim();
    if (!cleanTitle || !cleanMessage) {
      return res.status(400).json({ error: 'عنوان الإشعار ونصه مطلوبان.' });
    }

    const adminClient = getPrivilegedDbClient(req);
    let recipientIds: string[] = [];

    if (targetUserId && String(targetUserId).trim()) {
      recipientIds = [String(targetUserId).trim()];
    } else {
      const { data: profiles, error } = await adminClient
        .from('profiles')
        .select('id, status')
        .neq('id', req.user.id);
      if (error) throw new Error(error.message);
      recipientIds = (profiles || [])
        .filter((p: any) => !p.status || p.status === 'active')
        .map((p: any) => String(p.id));
    }

    const BATCH_SIZE = 25;
    for (let i = 0; i < recipientIds.length; i += BATCH_SIZE) {
      const batch = recipientIds.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map((uid) =>
          supabaseDb.createNotification({
            userId: uid,
            title: cleanTitle,
            message: cleanMessage,
            type: 'ADMIN_ANNOUNCEMENT',
            link: link ? String(link) : '/dashboard',
          })
        )
      );
    }

    res.json({ success: true, sentCount: recipientIds.length });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'فشل إرسال الإشعار الإداري.' });
  }
});

// Referrals (Real DB & Ledger-Backed — Zero Fake 300 Multiplier or Hardcoded Completion)
app.get('/api/referrals/my', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const stats = await supabaseDb.getMyReferrals(req.user.id, req.authToken);
    const code = stats.code || req.user.referralCode || '';
    res.json({
      ...stats,
      code,
      shareUrl: code ? `https://yemen-microtasks.vip/?ref=${encodeURIComponent(code)}` : 'https://yemen-microtasks.vip/',
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'فشل جلب بيانات الإحالة.' });
  }
});

// Support Tickets
app.get('/api/support/tickets', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const dbClient = req.authToken ? getSupabaseUserClient(req.authToken) : getPrivilegedDbClient(req);
    const { data: ticketRows, error: ticketsErr } = await dbClient
      .from('support_tickets')
      .select('id, user_id, subject, status, priority, created_at, updated_at')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });

    if (ticketsErr) {
      return res.status(500).json({ error: ticketsErr.message || 'فشل جلب تذاكر الدعم.' });
    }

    const ticketIds = (ticketRows || []).map((t: any) => t.id);
    let messagesByTicket: Record<string, any[]> = {};
    if (ticketIds.length > 0) {
      const { data: msgRows } = await dbClient
        .from('support_messages')
        .select('id, ticket_id, sender_id, sender_role, message, created_at')
        .in('ticket_id', ticketIds)
        .order('created_at', { ascending: true });

      for (const m of msgRows || []) {
        if (!messagesByTicket[m.ticket_id]) messagesByTicket[m.ticket_id] = [];
        messagesByTicket[m.ticket_id].push({
          id: m.id,
          senderId: m.sender_id,
          senderRole: m.sender_role,
          senderName: m.sender_role === 'admin' ? 'الدعم الفني' : req.user.fullName || 'أنا',
          message: m.message,
          createdAt: m.created_at,
        });
      }
    }

    const tickets = (ticketRows || []).map((t: any) => ({
      id: t.id,
      userId: t.user_id,
      subject: t.subject,
      status: t.status,
      priority: t.priority,
      createdAt: t.created_at,
      updatedAt: t.updated_at,
      messages: messagesByTicket[t.id] || [],
    }));

    return res.json({ tickets });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'فشل جلب تذاكر الدعم.' });
  }
});

app.post('/api/support/tickets', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const subject = typeof req.body?.subject === 'string' ? req.body.subject.trim() : '';
    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    const rawPriority = typeof req.body?.priority === 'string' ? req.body.priority.trim().toUpperCase() : 'MEDIUM';
    const priority = ['LOW', 'MEDIUM', 'HIGH'].includes(rawPriority) ? rawPriority : 'MEDIUM';

    if (!subject || !message) {
      return res.status(400).json({ error: 'يرجى إدخال عنوان التذكرة ونص الرسالة.' });
    }

    const dbClient = req.authToken ? getSupabaseUserClient(req.authToken) : getPrivilegedDbClient(req);
    const { data: ticketRow, error: ticketErr } = await dbClient
      .from('support_tickets')
      .insert({
        user_id: req.user.id,
        subject,
        priority,
        status: 'OPEN',
      })
      .select('id, user_id, subject, status, priority, created_at, updated_at')
      .single();

    if (ticketErr || !ticketRow) {
      return res.status(400).json({ error: ticketErr?.message || 'تعذر إنشاء تذكرة الدعم.' });
    }

    const { data: msgRow } = await dbClient
      .from('support_messages')
      .insert({
        ticket_id: ticketRow.id,
        sender_id: req.user.id,
        sender_role: 'user',
        message,
      })
      .select('id, sender_id, sender_role, message, created_at')
      .single();

    return res.json({
      success: true,
      ticket: {
        id: ticketRow.id,
        userId: ticketRow.user_id,
        subject: ticketRow.subject,
        status: ticketRow.status,
        priority: ticketRow.priority,
        createdAt: ticketRow.created_at,
        updatedAt: ticketRow.updated_at,
        messages: msgRow
          ? [
              {
                id: msgRow.id,
                senderId: msgRow.sender_id,
                senderRole: msgRow.sender_role,
                senderName: req.user.fullName || 'أنا',
                message: msgRow.message,
                createdAt: msgRow.created_at,
              },
            ]
          : [],
      },
    });
  } catch (err: any) {
    return res.status(400).json({ error: err.message || 'تعذر إنشاء تذكرة الدعم.' });
  }
});

// ==============================================================================
// SINGLE AUTHORIZED ADMIN APIS
// ==============================================================================

app.get('/api/admin/overview', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const dbClient = (() => {
      try {
        return getSupabaseAdminClient();
      } catch {
        return supabaseServer;
      }
    })();

    const [usersList, tasksRes, subsRes, treasury, withdrawalsList] = await Promise.all([
      supabaseDb.getAllUsers(),
      dbClient.from('tasks').select('id, status, reward_units, approved_count'),
      dbClient.from('task_submissions').select('id, status'),
      supabaseDb.getTreasurySummary(req.authToken),
      supabaseDb.getWithdrawals(),
    ]);

    const totalUsers = usersList.filter((u) => u.role === 'user').length;
    const activeUsers = usersList.filter((u) => u.role === 'user' && u.status === 'active').length;
    const suspendedUsers = usersList.filter((u) => u.status === 'suspended').length;

    const tasks = tasksRes.data || [];
    const totalTasks = tasks.length;
    const activeTasks = tasks.filter((t: any) => String(t.status || '').toUpperCase() === 'ACTIVE').length;

    const submissions = subsRes.data || [];
    const pendingSubmissions = submissions.filter((s: any) => String(s.status || '').toUpperCase() === 'PENDING').length;

    const totalApprovedRewards = tasks.reduce(
      (sum, t: any) => sum + Number(t.approved_count ?? 0) * Number(t.reward_units ?? 0),
      0
    );

    const pendingWithdrawals = withdrawalsList.filter((w) => w.status === 'PENDING').length;
    const totalCompletedWithdrawals = withdrawalsList
      .filter((w) => w.status === 'PAID')
      .reduce((sum, w) => sum + Number(w.amount || 0), 0);

    res.json({
      stats: {
        totalUsers,
        activeUsers,
        suspendedUsers,
        totalTasks,
        activeTasks,
        pendingSubmissions,
        pendingWithdrawals,
        totalAvailableLiabilities: treasury.userAvailableTotal,
        totalPendingWithdrawalLiabilities: treasury.withdrawalReservedTotal,
        totalCompletedWithdrawals: totalCompletedWithdrawals || treasury.withdrawalSettledTotal || 0,
        totalApprovedRewards,
        platformRevenue: treasury.revenueTotals?.total ?? 0,
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
    const { action, reason } = req.body || {};
    const submissionId = req.params.id;

    if (!req.authToken || !req.user?.id) {
      return res.status(401).json({ error: 'جلسة المدير غير صالحة.' });
    }

    if (action !== 'APPROVE' && action !== 'REJECT') {
      return res.status(400).json({ error: 'إجراء غير معروف. يجب أن يكون APPROVE أو REJECT.' });
    }

    if (action === 'REJECT' && (!reason || !String(reason).trim())) {
      return res.status(400).json({ error: 'يجب ذكر سبب الرفض للتوضيح للمستخدم.' });
    }

    const adminClient = getPrivilegedDbClient(req);
    const { data: existingSub, error: subErr } = await adminClient
      .from('task_submissions')
      .select('id, task_id, user_id, status, reward_transaction_id')
      .eq('id', submissionId)
      .maybeSingle();

    if (subErr) {
      await logSupabaseError({
        err: subErr,
        operation: 'REVIEW_SUBMISSION_PRECHECK',
        sourceTable: 'task_submissions',
        apiRoute: `/api/admin/submissions/${submissionId}/review`,
      });
      return res.status(400).json({ error: subErr.message || 'فشل قراءة بيانات الإثبات.' });
    }

    if (!existingSub) {
      return res.status(404).json({ error: 'إثبات المهمة غير موجود.' });
    }

    // Strict idempotency guard for already-approved submissions
    if (action === 'APPROVE' && String(existingSub.status || '').toLowerCase() === 'approved') {
      if (existingSub.reward_transaction_id) {
        const wallet = await supabaseDb.getWallet(existingSub.user_id);
        return res.json({
          success: true,
          idempotent: true,
          submissionId,
          transactionId: existingSub.reward_transaction_id,
          newBalance: wallet.availableBalance,
        });
      }
      return res.status(400).json({
        error: 'تمت الموافقة على هذا الإثبات تاريخياً بدون ربط معاملة صرف مالية. يرجى تنفيذ ترحيل 010 في Supabase SQL Editor لمطابقة الرصيد.',
      });
    }

    const decision = action === 'APPROVE' ? 'approve' : 'reject';
    const userClient = getSupabaseUserClient(req.authToken);
    const { data: rpcRes, error: rpcErr } = await userClient.rpc('review_task_submission', {
      p_submission_id: submissionId,
      p_decision: decision,
      p_review_note: reason ? String(reason).trim() : null,
    });

    if (rpcErr) {
      await logSupabaseError({
        err: rpcErr,
        operation: 'ATOMIC_REVIEW_TASK_SUBMISSION_RPC',
        sourceTable: 'task_submissions',
        apiRoute: `/api/admin/submissions/${submissionId}/review`,
        details: { submissionId, action, adminId: req.user.id },
      });

      const msg = String(rpcErr.message || 'فشل في مراجعة الإثبات.');
      if (rpcErr.code === '42501' || msg.toLowerCase().includes('administrator permission')) {
        return res.status(403).json({ error: msg });
      }
      if (msg.toLowerCase().includes('not found')) {
        return res.status(404).json({ error: msg });
      }
      return res.status(400).json({ error: msg });
    }

    if (action === 'REJECT') {
      const isIdempotent = Boolean(typeof rpcRes === 'object' && rpcRes?.idempotent);
      if (!isIdempotent && existingSub.user_id) {
        supabaseDb
          .createNotification({
            userId: existingSub.user_id,
            title: 'تم رفض إثبات المهمة',
            message: `يرجى مراجعة سبب الرفض: ${String(reason || '').trim()}`,
            type: 'TASK_REJECTED',
            link: '/dashboard',
          })
          .catch(() => {});
      }
      return res.json({
        success: true,
        idempotent: isIdempotent,
        submissionId,
        status: 'REJECTED',
        result: rpcRes,
      });
    }

    // Re-read authoritative submission & performer wallet after atomic commit
    const { data: updatedSub } = await adminClient
      .from('task_submissions')
      .select('id, status, reward_transaction_id, reviewed_by, reviewed_at')
      .eq('id', submissionId)
      .maybeSingle();

    // Record task platform commission if configured on task and not already posted by Migration 011 RPC
    let commissionResult: { recorded: boolean; transactionId?: string; pendingMigration?: boolean } = { recorded: false };
    const rpcCommissionTxId =
      typeof rpcRes === 'object' && rpcRes !== null ? rpcRes.commission_transaction_id : null;
    if (rpcCommissionTxId) {
      commissionResult = { recorded: true, transactionId: String(rpcCommissionTxId) };
    } else {
      const { data: taskRow } = await adminClient
        .from('tasks')
        .select('id, title, commission_units')
        .eq('id', existingSub.task_id)
        .maybeSingle();
      const commissionUnits = Number((taskRow as any)?.commission_units ?? req.body?.commissionUnits ?? 0);
      if (commissionUnits > 0) {
        commissionResult = await supabaseDb.recordTaskCommission({
          taskId: existingSub.task_id,
          submissionId,
          commissionUnits,
          taskTitle: taskRow?.title,
          actorId: req.user.id,
          authToken: req.authToken,
        });
      }
    }

    const [wallet, referralReward, campaignCompletion] = await Promise.all([
      supabaseDb.getWallet(existingSub.user_id),
      supabaseDb.getReferralRewardForSubmission(submissionId, req.authToken),
      supabaseDb
        .syncCampaignCompletionAfterSubmissionApproval({
          taskId: existingSub.task_id,
          actorId: req.user.id,
          authToken: req.authToken,
        })
        .catch(() => null),
    ]);
    const transactionId =
      (typeof rpcRes === 'string' && rpcRes.trim() ? rpcRes.trim() : null) ||
      (typeof rpcRes === 'object' && rpcRes !== null ? rpcRes.transaction_id : null) ||
      updatedSub?.reward_transaction_id ||
      null;

    const isIdempotentApproval = Boolean(typeof rpcRes === 'object' && rpcRes?.idempotent);
    if (!isIdempotentApproval && existingSub.user_id) {
      adminClient
        .from('tasks')
        .select('title, reward_units')
        .eq('id', existingSub.task_id)
        .maybeSingle()
        .then(({ data: tRow }) => {
          const rewardStr = tRow?.reward_units ? `${formatYer(Number(tRow.reward_units))} ر.ي` : 'المكافأة المعتمدة';
          return supabaseDb.createNotification({
            userId: existingSub.user_id,
            title: 'تم قبول إثبات المهمة وصرف المكافأة!',
            message: `تمت الموافقة على إثباتك${tRow?.title ? ` لمهمة "${tRow.title}"` : ''} وإيداع ${rewardStr} في محفظتك.`,
            type: 'TASK_APPROVED',
            link: '/wallet',
          });
        })
        .then(() => {}, () => {});
    }

    return res.json({
      success: true,
      idempotent: isIdempotentApproval,
      submissionId,
      transactionId,
      commissionTransactionId: commissionResult.transactionId || null,
      commissionPendingMigration: Boolean(commissionResult.pendingMigration),
      referralReward,
      campaignCompletion,
      newBalance: wallet.availableBalance,
      result: rpcRes,
    });
  } catch (err: any) {
    await logSupabaseError({
      err,
      operation: 'REVIEW_SUBMISSION_ROUTE_FAIL',
      apiRoute: `/api/admin/submissions/${req.params.id}/review`,
    });
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
    const { action, transferReference, receiptUrl, reason, providerFeeUnits } = req.body || {};
    const withdrawalId = req.params.id;

    if (action !== 'PAY' && action !== 'REJECT') {
      return res.status(400).json({ error: 'إجراء غير معروف. يجب أن يكون PAY أو REJECT.' });
    }

    const result = await supabaseDb.reviewWithdrawal({
      withdrawalId,
      action,
      transferReference,
      receiptUrl,
      reason,
      providerFeeUnits,
      actorId: req.user.id,
      authToken: req.authToken,
    });

    return res.json(result);
  } catch (err: any) {
    await logSupabaseError({
      err,
      operation: 'REVIEW_WITHDRAWAL_FAIL',
      sourceTable: 'withdrawal_requests',
      apiRoute: `/api/admin/withdrawals/${req.params.id}/review`,
    });
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
    const {
      title,
      description,
      category,
      taskKind,
      isFeatured,
      taskMeta,
      steps,
      proofRequirements,
      timeEstimateMinutes,
      rewardYer,
      totalQuantity,
      deadline,
      creationKey,
      countryId,
      administrativeDivisionId,
      isNationwide,
      targetDivisionIds,
    } = req.body || {};
    if (!title || !description || rewardYer === undefined || totalQuantity === undefined) {
      return res.status(400).json({ error: 'يرجى استكمال بيانات المهمة الأساسية.' });
    }

    const task = await supabaseDb.createTask({
      title,
      description,
      category,
      taskKind,
      isFeatured: Boolean(isFeatured),
      taskMeta,
      steps: Array.isArray(steps) ? steps : undefined,
      proofRequirements,
      timeEstimateMinutes,
      rewardYer,
      totalQuantity,
      deadline,
      creationKey,
      countryId: countryId || null,
      administrativeDivisionId: administrativeDivisionId || null,
      isNationwide,
      targetDivisionIds: Array.isArray(targetDivisionIds) ? targetDivisionIds : undefined,
      authToken: req.authToken,
    });

    res.json({ success: true, task });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'فشل إنشاء المهمة في Supabase.' });
  }
});

app.get('/api/admin/treasury', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const [summary, recentTransactions, movements] = await Promise.all([
      supabaseDb.getTreasurySummary(req.authToken),
      supabaseDb.getLedgerTransactions({ limit: 25, offset: 0, authToken: req.authToken }),
      supabaseDb.getTreasuryMovements(req.authToken, 60),
    ]);
    res.json({ treasury: summary, summary, recentTransactions, movements });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'فشل جلب بيانات الخزينة.' });
  }
});

app.post('/api/admin/treasury/issue', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { amount, reason, idempotencyKey } = req.body || {};
    const numAmount = parseMoneyStrict(amount, {
      allowNegative: false,
      allowZero: false,
      fieldLabel: 'مبلغ الإصدار',
    });
    if (!reason || !String(reason).trim()) {
      return res.status(400).json({ error: 'سبب الإصدار مطلوب للتدقيق المحاسبي.' });
    }

    const adminClient = getPrivilegedDbClient(req);
    const { data: accounts, error: accErr } = await adminClient
      .from('financial_accounts')
      .select('id, account_code')
      .in('account_code', ['VIRTUAL-ISSUANCE-CONTROL', 'PLATFORM-TREASURY']);

    if (accErr || !accounts || accounts.length < 2) {
      return res.status(500).json({ error: 'حسابات الخزينة السيادية غير مكتملة في قاعدة البيانات.' });
    }

    const issuanceAcc = accounts.find((a) => a.account_code === 'VIRTUAL-ISSUANCE-CONTROL');
    const treasuryAcc = accounts.find((a) => a.account_code === 'PLATFORM-TREASURY');
    if (!issuanceAcc || !treasuryAcc) {
      return res.status(500).json({ error: 'تعذر العثور على حساب الإصدار أو خزينة المنصة.' });
    }

    const cleanKey = idempotencyKey ? String(idempotencyKey).trim() : `TREASURY-ISSUE:${crypto.randomUUID()}`;
    const cleanReason = String(reason).trim();

    const { data: txId, error: rpcErr } = await adminClient.rpc('post_ledger_transaction', {
      p_transaction_type: 'TREASURY_ISSUANCE',
      p_idempotency_key: cleanKey,
      p_reference: 'TREASURY-ISSUE',
      p_metadata: {
        description: cleanReason,
        issued_by: req.user.id,
        amount_units: numAmount,
      },
      p_entries: [
        { account_id: issuanceAcc.id, side: 'debit', amount_units: numAmount, memo: cleanReason },
        { account_id: treasuryAcc.id, side: 'credit', amount_units: numAmount, memo: cleanReason },
      ],
    });

    if (rpcErr) {
      await logSupabaseError({
        err: rpcErr,
        operation: 'TREASURY_ISSUE_RPC',
        sourceTable: 'ledger_transactions',
        apiRoute: '/api/admin/treasury/issue',
      });
      return res.status(400).json({ error: rpcErr.message || 'فشل تسجيل قيد الإصدار.' });
    }

    await supabaseDb.writeFinancialAuditLog({
      actionType: 'TREASURY_ISSUANCE',
      actorId: req.user.id,
      transactionId: String(txId),
      details: { amount_units: numAmount, description: cleanReason, idempotency_key: cleanKey },
      authToken: req.authToken,
    });

    const summary = await supabaseDb.getTreasurySummary(req.authToken);
    res.json({ success: true, transactionId: txId, treasury: summary, summary });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/admin/ledger', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 150, 1), 500);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const transactionType = req.query.transactionType ? String(req.query.transactionType) : undefined;
    const accountCode = req.query.accountCode ? String(req.query.accountCode) : undefined;
    const from = req.query.from ? String(req.query.from) : undefined;
    const to = req.query.to ? String(req.query.to) : undefined;
    const search = req.query.search ? String(req.query.search) : undefined;

    const [transactions, summary] = await Promise.all([
      supabaseDb.getLedgerTransactions({
        limit,
        offset,
        transactionType,
        accountCode,
        from,
        to,
        search,
        authToken: req.authToken,
      }),
      supabaseDb.getTreasurySummary(req.authToken),
    ]);
    res.json({ transactions, summary });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'فشل جلب دفتر الأستاذ.' });
  }
});

app.put('/api/admin/tasks/:id', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const adminClient = getPrivilegedDbClient(req);
    const {
      title,
      description,
      status,
      category,
      taskKind,
      isFeatured,
      taskMeta,
      timeEstimateMinutes,
      steps,
      proofRequirements,
    } = req.body || {};

    // Preserve existing metadata like _campaignMeta when editing task fields
    const { data: existingRow, error: fetchErr } = await adminClient
      .from('tasks')
      .select('id, category, proof_requirements')
      .eq('id', req.params.id)
      .maybeSingle();

    if (fetchErr) throw fetchErr;
    if (!existingRow) {
      return res.status(404).json({ error: 'المهمة غير موجودة أو لا تملك صلاحية تعديلها.' });
    }

    const updates: Record<string, any> = {};
    if (title !== undefined) updates.title = String(title).trim();
    if (description !== undefined) updates.description = String(description).trim();
    const normalizedStatus = status !== undefined ? String(status).toUpperCase() : undefined;
    if (normalizedStatus !== undefined) updates.status = normalizedStatus.toLowerCase();

    const effectiveCategory =
      category !== undefined || taskKind !== undefined
        ? mapTaskKindToCategory(taskKind, category || existingRow.category)
        : existingRow.category;

    if (category !== undefined || taskKind !== undefined) {
      updates.category = effectiveCategory;
    }
    if (timeEstimateMinutes !== undefined && Number(timeEstimateMinutes) > 0) {
      updates.time_estimate_minutes = Math.max(1, Math.round(Number(timeEstimateMinutes)));
    }
    if (Array.isArray(steps)) {
      updates.steps = steps.map((s: any) => String(s || '').trim()).filter(Boolean);
    }

    let resolvedNextMeta: any = undefined;
    if (
      proofRequirements !== undefined ||
      taskMeta !== undefined ||
      taskKind !== undefined ||
      isFeatured !== undefined
    ) {
      const existingReqs = (existingRow as any).proof_requirements || {};
      resolvedNextMeta = sanitizeTaskBuilderMeta(
        {
          ...(existingReqs._taskMeta || {}),
          ...(taskMeta || {}),
          ...(taskKind ? { taskKind } : {}),
          ...(isFeatured !== undefined ? { isFeatured: Boolean(isFeatured) } : {}),
        },
        effectiveCategory
      );

      assertNoSensitiveSignupFields(resolvedNextMeta.taskKind, [
        title,
        description,
        resolvedNextMeta.proofConfig?.proofPromptText,
        resolvedNextMeta.fields?.signupRequirements,
        resolvedNextMeta.fields?.proofNotes,
        proofRequirements?.proofPromptText,
        proofRequirements?.instructions,
        ...(Array.isArray(steps) ? steps : []),
      ]);

      const normalizedReqs = normalizeProofRequirements(
        {
          ...existingReqs,
          ...(proofRequirements && typeof proofRequirements === 'object' ? proofRequirements : {}),
        },
        resolvedNextMeta,
        resolvedNextMeta.taskKind
      );

      updates.proof_requirements = {
        ...(existingReqs._campaignMeta ? { _campaignMeta: existingReqs._campaignMeta } : {}),
        ...normalizedReqs,
        _taskMeta: resolvedNextMeta,
      };
    }

    let { data, error } = await adminClient
      .from('tasks')
      .update(updates)
      .eq('id', req.params.id)
      .select('id');

    if (error && (error.code === '23514' || String(error.message || '').includes('tasks_category_check'))) {
      const safeUpdates = { ...updates, category: effectiveCategory === 'smart_links' ? 'local_services' : existingRow.category };
      const retry = await adminClient.from('tasks').update(safeUpdates).eq('id', req.params.id).select('id');
      data = retry.data;
      error = retry.error;
    }

    if (error) throw error;
    if (!data || data.length === 0) {
      return res.status(404).json({ error: 'المهمة غير موجودة أو لا تملك صلاحية تعديلها.' });
    }

    if (resolvedNextMeta) {
      await taskSystemService.saveTaskExtendedMeta(
        req.params.id,
        {
          taskMeta: resolvedNextMeta,
          category: effectiveCategory,
          steps: Array.isArray(steps) ? steps.map((s: any) => String(s || '').trim()).filter(Boolean) : undefined,
          timeEstimateMinutes:
            timeEstimateMinutes !== undefined && Number(timeEstimateMinutes) > 0
              ? Math.max(1, Math.round(Number(timeEstimateMinutes)))
              : undefined,
          proofRequirements: updates.proof_requirements,
        },
        req.user.id
      );
    }

    let escrowRelease: any = null;
    if (normalizedStatus === 'ARCHIVED' || normalizedStatus === 'CANCELLED') {
      escrowRelease = await supabaseDb.releaseTaskEscrow({
        taskId: req.params.id,
        reason: `تحرير الرصيد المتبقي عند تغيير حالة المهمة إلى ${normalizedStatus}`,
        actorId: req.user.id,
        authToken: req.authToken,
      });
    }

    const updatedTask = await supabaseDb.getTaskById(req.params.id, { maskSecrets: false }).catch(() => null);
    res.json({ success: true, escrowRelease, task: updatedTask });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/admin/tasks/:id', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  const taskId = req.params.id;
  try {
    if (!taskId) {
      return res.status(400).json({ error: 'معرف المهمة مطلوب للحذف.' });
    }

    const adminClient = getPrivilegedDbClient(req);

    // 1. Verify the task exists before deleting
    const { data: existingTask, error: fetchErr } = await adminClient
      .from('tasks')
      .select('id, title')
      .eq('id', taskId)
      .maybeSingle();

    if (fetchErr) {
      await logSupabaseError({
        err: fetchErr,
        operation: 'DELETE_TASK_LOOKUP',
        sourceTable: 'tasks',
        apiRoute: `/api/admin/tasks/${taskId}`,
        details: { taskId, adminId: req.user?.id },
      });
      return res.status(400).json({ error: `تعذر التحقق من المهمة في قاعدة البيانات: ${fetchErr.message}` });
    }

    if (!existingTask) {
      return res.status(404).json({ error: 'المهمة المطلوبة غير موجودة أو تم حذفها مسبقاً.' });
    }

    // 2. Release any remaining TASK-ESCROW balance back to PLATFORM-TREASURY before removing task
    const escrowRelease = await supabaseDb.releaseTaskEscrow({
      taskId,
      reason: `تحرير الرصيد المتبقي قبل حذف المهمة: ${existingTask.title || taskId}`,
      actorId: req.user?.id,
      authToken: req.authToken,
    });

    // 3. Clean up associated submissions if allowed; if RLS blocks direct delete on submissions, ON DELETE CASCADE on tasks handles it
    const { error: subDelErr } = await adminClient
      .from('task_submissions')
      .delete()
      .eq('task_id', taskId);

    if (subDelErr && subDelErr.code !== '42501') {
      await logSupabaseError({
        err: subDelErr,
        operation: 'DELETE_TASK_SUBMISSIONS',
        sourceTable: 'task_submissions',
        apiRoute: `/api/admin/tasks/${taskId}`,
        details: { taskId },
      });
    }

    // 3. Delete the task and verify an actual row was deleted
    const { data: deletedRows, error: delErr } = await adminClient
      .from('tasks')
      .delete()
      .eq('id', taskId)
      .select('id');

    if (delErr) {
      await logSupabaseError({
        err: delErr,
        operation: 'DELETE_TASK',
        sourceTable: 'tasks',
        apiRoute: `/api/admin/tasks/${taskId}`,
        details: { taskId, adminId: req.user?.id },
      });

      const code = String(delErr.code || '');
      if (code === '23503') {
        return res.status(400).json({
          error: 'تعذر حذف المهمة من قاعدة البيانات لوجود سجلات مرتبطة بها (إثباتات أو قيود مالية مرتبطة بالمهمة).',
        });
      }
      if (code === '42501') {
        return res.status(403).json({
          error: 'رفضت قاعدة البيانات حذف المهمة بسبب قيود الصلاحيات (RLS). يرجى التأكد من صلاحيات المدير أو مفتاح الخادم.',
        });
      }
      return res.status(400).json({ error: `فشل حذف المهمة من قاعدة البيانات: ${delErr.message}` });
    }

    if (!deletedRows || deletedRows.length === 0) {
      return res.status(403).json({
        error: 'لم يتم حذف المهمة في قاعدة البيانات (0 صفوف متأثرة). يرجى التحقق من سياسات الأمان (RLS) لجدول المهام.',
      });
    }

    await taskSystemService.deleteTaskExtendedMeta(taskId);
    res.json({ success: true, deletedId: deletedRows[0].id, escrowRelease });
  } catch (err: any) {
    console.error('Task deletion error:', err);
    await logSupabaseError({
      err,
      operation: 'DELETE_TASK_EXCEPTION',
      sourceTable: 'tasks',
      apiRoute: `/api/admin/tasks/${taskId}`,
    });
    res.status(400).json({ error: err.message || 'فشل حذف المهمة من قاعدة البيانات.' });
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
    const { amount, reason, idempotencyKey } = req.body || {};
    const numAmount = parseMoneyStrict(amount, {
      allowNegative: true,
      allowZero: false,
      fieldLabel: 'قيمة التسوية',
    });
    if (!reason || !String(reason).trim()) {
      return res.status(400).json({ error: 'سبب التسوية مطلوب للتدقيق المحاسبي.' });
    }

    const adminClient = getPrivilegedDbClient(req);
    const { accountRow: userAcc } = await supabaseDb.ensureUserFinancialAccount(req.params.id);
    const currentBal = Number(userAcc.balance_units || 0);
    if (addMoney(currentBal, numAmount) < 0) {
      return res.status(400).json({ error: 'لا يمكن أن ينتج عن العملية رصيد سالب.' });
    }

    const { data: treasuryAcc, error: treasuryErr } = await adminClient
      .from('financial_accounts')
      .select('id')
      .eq('account_code', 'PLATFORM-TREASURY')
      .single();

    if (treasuryErr || !treasuryAcc) {
      return res.status(500).json({ error: 'تعذر العثور على حساب خزينة المنصة.' });
    }

    const absAmount = Math.abs(numAmount);
    const cleanReason = `تسوية رصيد إدارية مدققة: ${String(reason).trim()}`;
    const entries =
      numAmount > 0
        ? [
            { account_id: treasuryAcc.id, side: 'debit', amount_units: absAmount, memo: cleanReason },
            { account_id: userAcc.id, side: 'credit', amount_units: absAmount, memo: cleanReason },
          ]
        : [
            { account_id: userAcc.id, side: 'debit', amount_units: absAmount, memo: cleanReason },
            { account_id: treasuryAcc.id, side: 'credit', amount_units: absAmount, memo: cleanReason },
          ];

    const { data: txId, error: rpcErr } = await adminClient.rpc('post_ledger_transaction', {
      p_transaction_type: 'ADMIN_ADJUSTMENT',
      p_idempotency_key: idempotencyKey ? String(idempotencyKey).trim() : `ADMIN-ADJ:${crypto.randomUUID()}`,
      p_reference: `USER:${req.params.id}`,
      p_metadata: {
        description: cleanReason,
        target_user_id: req.params.id,
        admin_id: req.user.id,
        signed_amount: numAmount,
      },
      p_entries: entries,
    });

    if (rpcErr) {
      return res.status(400).json({ error: rpcErr.message || 'فشل تسجيل التسوية الإدارية.' });
    }

    const updatedWallet = await supabaseDb.getWallet(req.params.id);
    res.json({ success: true, transactionId: txId, newBalance: updatedWallet.availableBalance });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/admin/users/:id/status', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const status = String(req.body?.status || '').trim().toLowerCase();
    if (!['active', 'suspended', 'under_review', 'pending'].includes(status)) {
      return res.status(400).json({ error: 'حالة الحساب غير صالحة.' });
    }
    await supabaseDb.updateUserStatus(req.params.id, status as 'active' | 'suspended' | 'under_review' | 'pending');
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Admin: Resend Verification Link for user
app.post('/api/admin/users/:id/resend-verification', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const adminClient = getSupabaseAdminClient();
    const { data: authUser, error: getErr } = await adminClient.auth.admin.getUserById(req.params.id);
    if (getErr || !authUser?.user?.email) {
      return res.status(404).json({ error: 'المستخدم غير موجود أو لا يملك بريداً إلكترونياً.' });
    }
    const email = authUser.user.email;
    const { error: resendErr } = await adminClient.auth.resend({
      type: 'signup',
      email,
      options: {
        emailRedirectTo: `${AUTH_REDIRECT_URL}/`,
      },
    });
    if (resendErr) throw resendErr;

    res.json({ success: true, message: `تم إرسال رابط التفعيل إلى ${email} بنجاح.` });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'فشل إرسال رابط التفعيل.' });
  }
});

// Admin: Generate Password Reset Link for user
app.post('/api/admin/users/:id/reset-password', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const adminClient = getSupabaseAdminClient();
    const { data: authUser, error: getErr } = await adminClient.auth.admin.getUserById(req.params.id);
    if (getErr || !authUser?.user?.email) {
      return res.status(404).json({ error: 'المستخدم غير موجود أو لا يملك بريداً إلكترونياً.' });
    }
    const email = authUser.user.email;
    const { data: linkData, error: linkErr } = await adminClient.auth.admin.generateLink({
      type: 'recovery',
      email,
      options: {
        redirectTo: `${AUTH_REDIRECT_URL}/`,
      },
    });
    if (linkErr) throw linkErr;

    res.json({
      success: true,
      message: `تم إنشاء رابط استعادة كلمة المرور للمستخدم ${email}.`,
      actionLink: linkData?.properties?.action_link || null,
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'فشل توليد رابط الاستعادة.' });
  }
});

// Admin: Permanent User Deletion with Strict Financial Ledger Protection
app.delete('/api/admin/users/:id', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const targetUserId = req.params.id;
    if (targetUserId === req.user.id) {
      return res.status(400).json({ error: 'لا يمكنك حذف حسابك الإداري الخاص.' });
    }

    const adminClient = getSupabaseAdminClient();

    // 1. Financial protection check: ensure user has zero active balance
    const wallet = await supabaseDb.getWallet(targetUserId).catch(() => null);
    if (wallet && (Number(wallet.availableBalance || 0) > 0 || Number(wallet.pendingBalance || 0) > 0)) {
      return res.status(400).json({
        error: 'لا يمكن حذف حساب لديه رصيد مالي نشط أو معلق. يرجى تسوية رصيده أولاً.',
      });
    }

    // 2. Delete user from Supabase Auth (cascades or archives profile while preserving financial ledger tables)
    const { error: deleteAuthErr } = await adminClient.auth.admin.deleteUser(targetUserId);
    if (deleteAuthErr) {
      throw deleteAuthErr;
    }

    // 3. Log audit event in system_error_logs
    await logSupabaseError({
      err: new Error(`Admin ${req.user.id} permanently deleted user ${targetUserId}`),
      operation: 'ADMIN_DELETE_USER_AUDIT',
      apiRoute: `/api/admin/users/${targetUserId}`,
    });

    res.json({ success: true, message: 'تم حذف حساب المستخدم بنجاح مع الحفاظ على السجلات المالية للتدقيق.' });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'فشل حذف المستخدم.' });
  }
});

app.get('/api/admin/financial-report', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const from = req.query.from ? String(req.query.from) : undefined;
    const to = req.query.to ? String(req.query.to) : undefined;
    const adminClient = getPrivilegedDbClient(req);
    const [tasksRes, treasury, comprehensive] = await Promise.all([
      adminClient.from('tasks').select('reward_units, approved_count'),
      supabaseDb.getTreasurySummary(req.authToken),
      supabaseDb.getComprehensiveFinancialReports({ from, to, authToken: req.authToken }),
    ]);

    const totalTaskExpenses = (tasksRes.data || []).reduce(
      (sum, t: any) => sum + Number(t.approved_count ?? 0) * Number(t.reward_units ?? 0),
      0
    );

    res.json({
      report: {
        totalTaskExpenses,
        totalPaidWithdrawals: treasury.withdrawalSettledTotal ?? 0,
        totalPendingWithdrawals: treasury.withdrawalReservedTotal ?? 0,
        totalAvailableLiabilities: treasury.userAvailableTotal,
        totalReferralExpenses: 0,
        platformRevenue: treasury.revenueTotals?.total ?? 0,
        revenueBreakdown: treasury.revenueTotals ?? { tasks: 0, ads: 0, subscriptions: 0, services: 0, clixwall: 0, total: 0 },
        ownerCapitalTotal: treasury.ownerCapitalTotal ?? 0,
        ownerWithdrawalsTotal: treasury.ownerWithdrawalsTotal ?? 0,
        operationalExpensesTotal: treasury.expensesTotal ?? 0,
        netPlatformVolume: totalTaskExpenses + (treasury.withdrawalSettledTotal ?? 0),
        isReconciled: treasury.isReconciled,
        migration011Ready: treasury.migration011Ready,
        dailyBreakdown: comprehensive.dailyBreakdown,
      },
      comprehensive,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/financial-report/export', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const reportType = String(req.query.reportType || 'ledger').toLowerCase();
    const from = req.query.from ? String(req.query.from) : undefined;
    const to = req.query.to ? String(req.query.to) : undefined;

    const csvEscape = (v: any) => {
      const s = v === null || v === undefined ? '' : String(v);
      return `"${s.replace(/"/g, '""')}"`;
    };
    const buildCsv = (headers: string[], rows: any[][]) => {
      const lines = [headers.map(csvEscape).join(','), ...rows.map((r) => r.map(csvEscape).join(','))];
      return '\uFEFF' + lines.join('\r\n');
    };

    let csvContent = '';
    const dateStamp = new Date().toISOString().slice(0, 10);

    if (reportType === 'ledger') {
      const txs = await supabaseDb.getLedgerTransactions({ limit: 500, from, to, authToken: req.authToken });
      csvContent = buildCsv(
        ['معرف القيد', 'التاريخ', 'نوع العملية', 'البيان', 'الحسابات المدينة', 'الحسابات الدائنة', 'المبلغ (ر.ي)', 'المنفذ', 'المرجع', 'الحالة'],
        txs.map((tx) => {
          const debits = (tx.entries || []).filter((e) => e.debitAmount > 0).map((e) => `${e.accountCode}:${e.debitAmount}`).join(' | ');
          const credits = (tx.entries || []).filter((e) => e.creditAmount > 0).map((e) => `${e.accountCode}:${e.creditAmount}`).join(' | ');
          return [
            tx.id,
            tx.createdAt,
            tx.transactionType,
            tx.description,
            debits,
            credits,
            tx.totalAmount || 0,
            tx.createdByName || tx.createdBy || '',
            tx.referenceId || '',
            tx.isReversed ? 'معكوس' : tx.status || 'posted',
          ];
        })
      );
    } else {
      const rep = await supabaseDb.getComprehensiveFinancialReports({ from, to, authToken: req.authToken });
      if (reportType === 'pnl') {
        csvContent = buildCsv(
          ['البند', 'التصنيف', 'المبلغ (ر.ي)'],
          [
            ['إيرادات عمولات المهام', 'إيراد', rep.profitAndLoss.revenueTasks],
            ['إيرادات الإعلانات', 'إيراد', rep.profitAndLoss.revenueAds],
            ['إيرادات الاشتراكات', 'إيراد', rep.profitAndLoss.revenueSubscriptions],
            ['إيرادات الخدمات ورسوم السحب', 'إيراد', rep.profitAndLoss.revenueServices],
            ['إجمالي الإيرادات المحققة', 'إجمالي', rep.profitAndLoss.totalRevenue],
            ['المصروفات التشغيلية', 'مصروف', rep.profitAndLoss.operationalExpenses],
            ['عمولات مزودي الدفع', 'مصروف', rep.profitAndLoss.paymentProviderFees],
            ['الضرائب المثبتة', 'مصروف', rep.profitAndLoss.taxExpenses],
            ['إجمالي المصروفات', 'إجمالي', rep.profitAndLoss.totalExpenses],
            ['صافي الربح / الخسارة', 'صافي', rep.profitAndLoss.netProfitLoss],
          ]
        );
      } else if (reportType === 'cashflow') {
        csvContent = buildCsv(
          ['بند التدفق النقدي', 'المبلغ (ر.ي)'],
          [
            ['التدفقات النقدية التشغيلية الداخلة', rep.cashFlow.operatingCashInflows],
            ['التدفقات النقدية التشغيلية الخارجة', rep.cashFlow.operatingCashOutflows],
            ['صافي التدفق النقدي التشغيلي', rep.cashFlow.netOperatingCashFlow],
            ['تدفقات إيداع رأس مال المالك', rep.cashFlow.ownerCapitalInflows],
            ['تدفقات مسحوبات المالك', rep.cashFlow.ownerWithdrawalsOutflows],
            ['صافي التدفق التمويلي', rep.cashFlow.netFinancingCashFlow],
            ['صافي التغير النقدي للفترة', rep.cashFlow.netCashChange],
            ['الرصيد النقدي الفعلي بالخزينة (PLATFORM-CASH-VAULT)', rep.cashFlow.endingCashVaultBalance],
            ['الوحدات الافتراضية المتاحة بالخزينة (PLATFORM-TREASURY)', rep.cashFlow.virtualTreasuryAvailable],
          ]
        );
      } else if (reportType === 'balance_sheet') {
        csvContent = buildCsv(
          ['القسم', 'الحساب / البند', 'الرصيد (ر.ي)'],
          [
            ['الأصول', 'النقد الفعلي في الخزينة (PLATFORM-CASH-VAULT)', rep.balanceSheet.assets.cashVault],
            ['الأصول', 'مراقبة الإصدار الافتراضي (منفصل)', rep.balanceSheet.assets.virtualIssuanceControl],
            ['الالتزامات', 'أرصدة محافظ المستخدمين (WALLET-*)', rep.balanceSheet.liabilities.userWalletBalances],
            ['الالتزامات', 'سحوبات قيد المعالجة (WITHDRAWAL-RESERVED)', rep.balanceSheet.liabilities.withdrawalReserved],
            ['الالتزامات', 'أموال ضمان المهام (TASK-ESCROW-*)', rep.balanceSheet.liabilities.taskEscrowBalances],
            ['الالتزامات', 'الضرائب المستحقة (TAX-PAYABLE)', rep.balanceSheet.liabilities.taxesPayable],
            ['الالتزامات', 'إجمالي التزامات المستخدمين والغير', rep.balanceSheet.liabilities.totalUserAndExternalLiabilities],
            ['حقوق الملكية', 'رأس مال المالك (OWNER-CAPITAL)', rep.balanceSheet.equity.ownerCapital],
            ['حقوق الملكية', 'الأرباح المحتجزة (RETAINED-EARNINGS)', rep.balanceSheet.equity.retainedEarningsAccount],
            ['حقوق الملكية', 'صافي دخل الفترة المتراكم', rep.balanceSheet.equity.currentNetIncome],
            ['حقوق الملكية', 'مسحوبات المالك (OWNER-WITHDRAWALS)', -rep.balanceSheet.equity.ownerWithdrawals],
            ['حقوق الملكية', 'صافي حقوق الملكية', rep.balanceSheet.equity.totalOwnerEquity],
          ]
        );
      } else if (reportType === 'revenue') {
        csvContent = buildCsv(
          ['كود الحساب', 'مصدر الإيراد', 'إيراد الفترة (ر.ي)', 'الرصيد التراكمي (ر.ي)', 'عدد القيود'],
          rep.revenueBySource.map((r) => [r.accountCode, r.label, r.periodAmount, r.cumulativeBalance, r.txCount])
        );
      } else if (reportType === 'expenses') {
        csvContent = buildCsv(
          ['التاريخ', 'القيد', 'التصنيف', 'كود الحساب', 'المبلغ (ر.ي)', 'البيان', 'المرجع'],
          rep.expensesItems.map((e) => [e.date, e.transactionId, e.category, e.accountCode, e.amount, e.description, e.referenceId || ''])
        );
      } else if (reportType === 'taxes') {
        csvContent = buildCsv(
          ['المعرف', 'نوع الضريبة', 'الجهة', 'الوعاء الخاضع', 'قيمة الضريبة', 'الحالة', 'المرجع', 'تاريخ السداد'],
          rep.taxesReport.settlements.map((s) => [s.id, s.taxType || '', s.taxAuthority || '', s.taxableAmount, s.taxAmount, s.status, s.referenceId || '', s.settledAt || ''])
        );
      } else if (reportType === 'withdrawals') {
        csvContent = buildCsv(
          ['التاريخ', 'القيد', 'المبلغ (ر.ي)', 'البيان', 'المنفذ'],
          rep.ownerWithdrawalsReport.items.map((w) => [w.date, w.transactionId, w.amount, w.description, w.actorName || ''])
        );
      } else if (reportType === 'liabilities') {
        csvContent = buildCsv(
          ['النوع', 'الاسم / المهمة', 'الكود', 'الرصيد المحجوز / المستحق (ر.ي)', 'الحالة'],
          [
            ...rep.userBalancesAndEscrowsReport.users.map((u) => ['محفظة مستخدم', `${u.fullName} (${u.phone})`, u.accountCode, u.balanceUnits, u.status]),
            ...rep.userBalancesAndEscrowsReport.escrows.map((e) => ['ضمان مهمة', e.taskTitle, e.accountCode, e.balanceUnits, e.taskStatus]),
          ]
        );
      } else {
        csvContent = buildCsv(
          ['التاريخ', 'الإيرادات', 'المصروفات', 'مكافآت المهام', 'السحوبات المدفوعة'],
          rep.dailyBreakdown.map((d) => [d.date, d.revenues, d.expenses, d.taskRewards, d.withdrawals])
        );
      }
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="kasb-finance-${reportType}-${dateStamp}.csv"`);
    res.send(csvContent);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'فشل تصدير التقرير المالي.' });
  }
});

// ==============================================================================
// SINGLE-OWNER FINANCIAL OPERATIONS (MIGRATION 011 DOUBLE-ENTRY LEDGER)
// ==============================================================================

app.get('/api/admin/finance/accounts', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const [overview, summary] = await Promise.all([
      supabaseDb.getFinancialAccountsOverview(req.authToken),
      supabaseDb.getTreasurySummary(req.authToken),
    ]);
    res.json({ ...overview, summary });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'فشل جلب الحسابات المالية.' });
  }
});

app.post('/api/admin/finance/capital', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { amount, reason, idempotencyKey } = req.body || {};
    const result = await supabaseDb.executeOwnerFinancialOperation({
      operationType: 'OWNER_CAPITAL_DEPOSIT',
      amount: Number(amount),
      description: String(reason || ''),
      idempotencyKey,
      actorId: req.user.id,
      authToken: req.authToken,
    });
    const summary = await supabaseDb.getTreasurySummary(req.authToken);
    res.json({ ...result, summary });
  } catch (err: any) {
    await logSupabaseError({ err, operation: 'OWNER_CAPITAL_DEPOSIT', apiRoute: '/api/admin/finance/capital' });
    res.status(400).json({ error: err.message || 'فشل تسجيل إيداع رأس المال.' });
  }
});

app.post('/api/admin/finance/expense', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { amount, reason, category, idempotencyKey } = req.body || {};
    const result = await supabaseDb.executeOwnerFinancialOperation({
      operationType: 'OPERATIONAL_EXPENSE',
      amount: Number(amount),
      description: String(reason || ''),
      idempotencyKey,
      metadata: category ? { expense_category: String(category).trim() } : {},
      actorId: req.user.id,
      authToken: req.authToken,
    });
    const summary = await supabaseDb.getTreasurySummary(req.authToken);
    res.json({ ...result, summary });
  } catch (err: any) {
    await logSupabaseError({ err, operation: 'OPERATIONAL_EXPENSE', apiRoute: '/api/admin/finance/expense' });
    res.status(400).json({ error: err.message || 'فشل تسجيل المصروف التشغيلي.' });
  }
});

app.post('/api/admin/finance/owner-withdrawal', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { amount, reason, idempotencyKey } = req.body || {};
    const result = await supabaseDb.executeOwnerFinancialOperation({
      operationType: 'OWNER_WITHDRAWAL',
      amount: Number(amount),
      description: String(reason || ''),
      idempotencyKey,
      actorId: req.user.id,
      authToken: req.authToken,
    });
    const summary = await supabaseDb.getTreasurySummary(req.authToken);
    res.json({ ...result, summary });
  } catch (err: any) {
    await logSupabaseError({ err, operation: 'OWNER_WITHDRAWAL', apiRoute: '/api/admin/finance/owner-withdrawal' });
    res.status(400).json({ error: err.message || 'فشل تسجيل السحب الشخصي للمالك.' });
  }
});

app.post('/api/admin/finance/revenue', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { source, amount, reason, creditToTreasury, idempotencyKey } = req.body || {};
    const cleanSource = String(source || '').trim().toUpperCase();
    const opMap: Record<string, 'AD_REVENUE' | 'SUBSCRIPTION_REVENUE' | 'SERVICE_REVENUE'> = {
      ADS: 'AD_REVENUE',
      AD_REVENUE: 'AD_REVENUE',
      SUBSCRIPTIONS: 'SUBSCRIPTION_REVENUE',
      SUBSCRIPTION_REVENUE: 'SUBSCRIPTION_REVENUE',
      SERVICES: 'SERVICE_REVENUE',
      SERVICE_REVENUE: 'SERVICE_REVENUE',
    };
    const operationType = opMap[cleanSource];
    if (!operationType) {
      return res.status(400).json({ error: 'مصدر الإيراد غير صالح. يجب أن يكون ADS أو SUBSCRIPTIONS أو SERVICES.' });
    }

    const result = await supabaseDb.executeOwnerFinancialOperation({
      operationType,
      amount: Number(amount),
      description: String(reason || ''),
      creditToTreasury: creditToTreasury !== false,
      idempotencyKey,
      actorId: req.user.id,
      authToken: req.authToken,
    });
    const summary = await supabaseDb.getTreasurySummary(req.authToken);
    res.json({ ...result, summary });
  } catch (err: any) {
    await logSupabaseError({ err, operation: 'PLATFORM_REVENUE_RECORD', apiRoute: '/api/admin/finance/revenue' });
    res.status(400).json({ error: err.message || 'فشل تسجيل الإيراد.' });
  }
});

app.post('/api/admin/finance/reverse', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { transactionId, reason } = req.body || {};
    if (!transactionId) {
      return res.status(400).json({ error: 'معرف المعاملة مطلوب للقيد العكسي.' });
    }
    const result = await supabaseDb.reverseTransaction({
      transactionId: String(transactionId),
      reason: String(reason || ''),
      actorId: req.user.id,
      authToken: req.authToken,
    });
    const summary = await supabaseDb.getTreasurySummary(req.authToken);
    res.json({ ...result, summary });
  } catch (err: any) {
    await logSupabaseError({ err, operation: 'REVERSE_LEDGER_TRANSACTION', apiRoute: '/api/admin/finance/reverse' });
    res.status(400).json({ error: err.message || 'فشل تنفيذ القيد العكسي.' });
  }
});

app.get('/api/admin/finance/treasury-movements', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 60, 1), 300);
    const movements = await supabaseDb.getTreasuryMovements(req.authToken, limit);
    res.json({ movements });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'فشل جلب حركات الخزينة.' });
  }
});

app.get('/api/admin/finance/reports', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const from = req.query.from ? String(req.query.from) : undefined;
    const to = req.query.to ? String(req.query.to) : undefined;
    const report = await supabaseDb.getComprehensiveFinancialReports({ from, to, authToken: req.authToken });
    res.json({ report });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'فشل إنشاء التقارير المالية.' });
  }
});

app.get('/api/admin/finance/audit-logs', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 300);
    const result = await supabaseDb.getFinancialAuditLogs(req.authToken, limit);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'فشل جلب سجل المراجعة المالية.' });
  }
});

app.get('/api/admin/finance/taxes', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await supabaseDb.getTaxesOverview(req.authToken);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'فشل جلب بيانات الضرائب.' });
  }
});

app.post('/api/admin/finance/taxes', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { taxType, taxAuthority, region, countryId, taxBase, ratePercentage, flatAmount, validFrom, validTo, isActive } = req.body || {};
    const definition = await supabaseDb.createTaxDefinition({
      taxType,
      taxAuthority,
      region,
      countryId: countryId || null,
      taxBase,
      ratePercentage: Number(ratePercentage ?? 0),
      flatAmount: Number(flatAmount ?? 0),
      validFrom,
      validTo: validTo || null,
      isActive: Boolean(isActive),
      actorId: req.user.id,
      authToken: req.authToken,
    });
    res.json({ success: true, definition });
  } catch (err: any) {
    await logSupabaseError({ err, operation: 'CREATE_TAX_DEFINITION', apiRoute: '/api/admin/finance/taxes' });
    res.status(400).json({ error: err.message || 'فشل إنشاء تعريف الضريبة.' });
  }
});

app.put('/api/admin/finance/taxes/:id', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { ratePercentage, flatAmount, isActive, validTo, taxAuthority } = req.body || {};
    const definition = await supabaseDb.updateTaxDefinition({
      id: req.params.id,
      ratePercentage,
      flatAmount,
      isActive,
      validTo,
      taxAuthority,
      actorId: req.user.id,
      authToken: req.authToken,
    });
    res.json({ success: true, definition });
  } catch (err: any) {
    await logSupabaseError({ err, operation: 'UPDATE_TAX_DEFINITION', apiRoute: `/api/admin/finance/taxes/${req.params.id}` });
    res.status(400).json({ error: err.message || 'فشل تحديث تعريف الضريبة.' });
  }
});

app.post('/api/admin/finance/taxes/accrue', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { taxDefinitionId, taxableAmount, referenceId, note } = req.body || {};
    const result = await supabaseDb.accrueTaxObligation({
      taxDefinitionId: String(taxDefinitionId || ''),
      taxableAmount: Number(taxableAmount),
      referenceId,
      note,
      actorId: req.user.id,
      authToken: req.authToken,
    });
    const summary = await supabaseDb.getTreasurySummary(req.authToken);
    res.json({ ...result, summary });
  } catch (err: any) {
    await logSupabaseError({ err, operation: 'ACCRUE_TAX_OBLIGATION', apiRoute: '/api/admin/finance/taxes/accrue' });
    res.status(400).json({ error: err.message || 'فشل احتساب الالتزام الضريبي.' });
  }
});

app.post('/api/admin/finance/taxes/settle', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { settlementId, referenceId } = req.body || {};
    const result = await supabaseDb.settleTaxObligation({
      settlementId: String(settlementId || ''),
      referenceId: String(referenceId || ''),
      actorId: req.user.id,
      authToken: req.authToken,
    });
    const summary = await supabaseDb.getTreasurySummary(req.authToken);
    res.json({ ...result, summary });
  } catch (err: any) {
    await logSupabaseError({ err, operation: 'SETTLE_TAX_OBLIGATION', apiRoute: '/api/admin/finance/taxes/settle' });
    res.status(400).json({ error: err.message || 'فشل تسوية الالتزام الضريبي.' });
  }
});

app.post('/api/admin/tasks/:id/release-escrow', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await supabaseDb.releaseTaskEscrow({
      taskId: req.params.id,
      reason: req.body?.reason,
      actorId: req.user.id,
      authToken: req.authToken,
    });
    const summary = await supabaseDb.getTreasurySummary(req.authToken);
    res.json({ success: true, ...result, summary });
  } catch (err: any) {
    await logSupabaseError({ err, operation: 'RELEASE_TASK_ESCROW', apiRoute: `/api/admin/tasks/${req.params.id}/release-escrow` });
    res.status(400).json({ error: err.message || 'فشل تحرير أموال ضمان المهمة.' });
  }
});

// ==============================================================================
// PHASE 5: EXTERNAL ACCOUNTS, DEPOSIT APPROVALS, INTERNAL TRANSFERS & RECONCILIATION
// ==============================================================================

app.get('/api/admin/finance/external-accounts', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const overview = await supabaseDb.getExternalAccountsOverview(req.authToken);
    res.json(overview);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'فشل جلب بيانات الحسابات الخارجية.' });
  }
});

app.post('/api/admin/finance/external-accounts', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const {
      accountName,
      ownerName,
      ownerRole,
      accountType,
      providerName,
      accountNumber,
      fundScope,
      notes,
    } = req.body || {};
    const result = await supabaseDb.createExternalAccount({
      accountName: String(accountName || ''),
      ownerName: String(ownerName || ''),
      ownerRole: ownerRole || 'owner',
      accountType: accountType || 'bank',
      providerName: String(providerName || ''),
      accountNumber: String(accountNumber || ''),
      fundScope: fundScope || 'mixed',
      notes,
      actorId: req.user.id,
      authToken: req.authToken,
    });
    const summary = await supabaseDb.getTreasurySummary(req.authToken);
    res.json({ ...result, summary });
  } catch (err: any) {
    await logSupabaseError({ err, operation: 'CREATE_EXTERNAL_ACCOUNT', apiRoute: '/api/admin/finance/external-accounts' });
    res.status(400).json({ error: err.message || 'فشل إنشاء الحساب الخارجي.' });
  }
});

app.post('/api/admin/finance/external-deposits/receipt-signed-url', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { fileName, contentType, fileSize } = req.body || {};
    const cleanContentType = String(contentType || '').trim().toLowerCase();
    const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];
    if (!ALLOWED_MIME_TYPES.includes(cleanContentType)) {
      return res.status(400).json({ error: 'صيغة صورة الإيصال غير مدعومة. يرجى اختيار PNG أو JPEG أو WEBP.' });
    }
    const numSize = Number(fileSize) || 0;
    if (numSize > 5 * 1024 * 1024) {
      return res.status(400).json({ error: 'حجم صورة الإيصال يجب أن لا يتجاوز 5 ميجابايت.' });
    }

    const adminClient = getSupabaseAdminClient();
    const safeFileName = (fileName || 'receipt.png').replace(/[^a-zA-Z0-9_.-]/g, '_');
    const storagePath = `external-receipts/${req.user.id}/${Date.now()}_${crypto.randomUUID().slice(0, 6)}_${safeFileName}`;

    const { data, error } = await adminClient.storage
      .from('task-proofs')
      .createSignedUploadUrl(storagePath);

    if (error || !data?.signedUrl) {
      return res.status(500).json({ error: error?.message || 'تعذر إنشاء رابط رفع صورة الإيصال.' });
    }

    return res.json({
      signedUrl: data.signedUrl,
      token: data.token,
      path: storagePath,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'تعذر تجهيز رفع الإيصال.' });
  }
});

app.post('/api/admin/finance/external-deposits', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const {
      externalAccountId,
      depositPurpose,
      advertiserId,
      amountUnits,
      referenceNumber,
      receiptUrl,
      depositorName,
      depositorPhone,
      notes,
    } = req.body || {};

    const result = await supabaseDb.createExternalDeposit({
      externalAccountId: String(externalAccountId || ''),
      depositPurpose: depositPurpose === 'platform_capital' ? 'platform_capital' : 'advertiser_wallet',
      advertiserId: advertiserId ? String(advertiserId) : null,
      amountUnits: Number(amountUnits),
      referenceNumber: String(referenceNumber || ''),
      receiptUrl: String(receiptUrl || ''),
      depositorName,
      depositorPhone,
      notes,
      actorId: req.user.id,
      authToken: req.authToken,
    });
    res.json(result);
  } catch (err: any) {
    await logSupabaseError({ err, operation: 'RECORD_EXTERNAL_DEPOSIT', apiRoute: '/api/admin/finance/external-deposits' });
    res.status(400).json({ error: err.message || 'فشل تسجيل الإيداع.' });
  }
});

app.post('/api/admin/finance/external-deposits/:id/approve', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await supabaseDb.approveExternalDeposit({
      depositId: req.params.id,
      actorId: req.user.id,
      authToken: req.authToken,
    });
    const summary = await supabaseDb.getTreasurySummary(req.authToken);
    res.json({ ...result, summary });
  } catch (err: any) {
    await logSupabaseError({ err, operation: 'APPROVE_EXTERNAL_DEPOSIT', apiRoute: `/api/admin/finance/external-deposits/${req.params.id}/approve` });
    res.status(400).json({ error: err.message || 'فشل اعتماد الإيداع وشحن المحفظة.' });
  }
});

app.post('/api/admin/finance/external-deposits/:id/reject', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await supabaseDb.rejectExternalDeposit({
      depositId: req.params.id,
      reason: String(req.body?.reason || ''),
      actorId: req.user.id,
      authToken: req.authToken,
    });
    res.json(result);
  } catch (err: any) {
    await logSupabaseError({ err, operation: 'REJECT_EXTERNAL_DEPOSIT', apiRoute: `/api/admin/finance/external-deposits/${req.params.id}/reject` });
    res.status(400).json({ error: err.message || 'فشل رفض الإيداع.' });
  }
});

app.post('/api/admin/finance/external-transfers', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const {
      fromFinancialAccountId,
      toFinancialAccountId,
      amountUnits,
      reason,
      referenceNumber,
      idempotencyKey,
    } = req.body || {};
    const result = await supabaseDb.transferBetweenExternalAccounts({
      fromFinancialAccountId: String(fromFinancialAccountId || ''),
      toFinancialAccountId: String(toFinancialAccountId || ''),
      amountUnits: Number(amountUnits),
      reason: String(reason || ''),
      referenceNumber,
      idempotencyKey,
      actorId: req.user.id,
      authToken: req.authToken,
    });
    const summary = await supabaseDb.getTreasurySummary(req.authToken);
    res.json({ ...result, summary });
  } catch (err: any) {
    await logSupabaseError({ err, operation: 'INTERNAL_ACCOUNT_TRANSFER', apiRoute: '/api/admin/finance/external-transfers' });
    res.status(400).json({ error: err.message || 'فشل التحويل الداخلي بين الحسابات.' });
  }
});

app.post('/api/admin/finance/external-accounts/:id/reconcile', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { actualBalanceUnits, applyAdjustment, adjustmentReason } = req.body || {};
    const result = await supabaseDb.reconcileExternalAccount({
      externalAccountId: req.params.id,
      actualBalanceUnits: Number(actualBalanceUnits),
      applyAdjustment: Boolean(applyAdjustment),
      adjustmentReason,
      actorId: req.user.id,
      authToken: req.authToken,
    });
    const summary = await supabaseDb.getTreasurySummary(req.authToken);
    res.json({ ...result, summary });
  } catch (err: any) {
    await logSupabaseError({ err, operation: 'RECONCILE_EXTERNAL_ACCOUNT', apiRoute: `/api/admin/finance/external-accounts/${req.params.id}/reconcile` });
    res.status(400).json({ error: err.message || 'فشل مطابقة الحساب الخارجي.' });
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
// ADVERTISER CAMPAIGN FUNDING & LIFECYCLE (PHASE 3)
// ==============================================================================

app.get('/api/advertiser/campaigns', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user || req.user.role !== 'advertiser') {
      return res.status(403).json({ error: 'وصول محظور: هذه الواجهة مخصصة للمعلنين فقط.' });
    }
    const [campaigns, settings, wallet] = await Promise.all([
      supabaseDb.getCampaignsForAdvertiser(req.user.id, req.authToken),
      supabaseDb.getSettings(req.authToken),
      supabaseDb.getWallet(req.user.id),
    ]);
    res.json({
      campaigns,
      feePercentage: settings.advertiserCampaignFeePercentage,
      walletBalance: wallet.availableBalance,
      accountStatus: req.user.status,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'فشل جلب حملات المعلن.' });
  }
});

app.post('/api/advertiser/logo/signed-url', advertiserMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { fileName, contentType, fileSize } = req.body || {};
    const cleanContentType = String(contentType || '').trim().toLowerCase();
    const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];
    if (!ALLOWED_MIME_TYPES.includes(cleanContentType)) {
      return res.status(400).json({ error: 'صيغة الشعار غير مدعومة. يرجى اختيار PNG أو JPEG أو WEBP.' });
    }
    const numSize = Number(fileSize) || 0;
    if (numSize > 2 * 1024 * 1024) {
      return res.status(400).json({ error: 'حجم الشعار يجب أن لا يتجاوز 2 ميجابايت.' });
    }

    const adminClient = getSupabaseAdminClient();
    const safeFileName = (fileName || 'logo.png').replace(/[^a-zA-Z0-9_.-]/g, '_');
    const storagePath = `advertiser-logos/${req.user.id}/${Date.now()}_${crypto.randomUUID().slice(0, 6)}_${safeFileName}`;

    const { data, error } = await adminClient.storage
      .from('task-proofs')
      .createSignedUploadUrl(storagePath);

    if (error || !data?.signedUrl) {
      return res.status(500).json({ error: error?.message || 'تعذر إنشاء رابط رفع الشعار.' });
    }

    return res.json({
      signedUrl: data.signedUrl,
      token: data.token,
      path: storagePath,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'تعذر تجهيز رفع شعار المعلن.' });
  }
});

app.post('/api/advertiser/campaigns', advertiserMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const {
      title,
      description,
      category,
      rewardUnits,
      rewardYer,
      slots,
      totalQuantity,
      timeEstimateMinutes,
      proofRequirements,
      hideAdvertiserName,
      advertiserDisplayName,
      advertiserLogoUrl,
      deadlineAt,
      creationKey,
      countryId,
      isNationwide,
      targetDivisionIds,
    } = req.body || {};

    const cleanReward = parseMoneyStrict(rewardUnits ?? rewardYer, {
      allowNegative: false,
      allowZero: false,
      fieldLabel: 'سعر المهمة',
    });
    const cleanSlots = Number(slots ?? totalQuantity);
    if (!title || !description) {
      return res.status(400).json({ error: 'يرجى إدخال عنوان الحملة ووصف المهمة المطلوبة.' });
    }
    if (!Number.isInteger(cleanSlots) || cleanSlots <= 0) {
      return res.status(400).json({ error: 'عدد المهمات المطلوبة يجب أن يكون عدداً صحيحاً أكبر من صفر.' });
    }

    const result = await supabaseDb.createAdvertiserCampaign({
      advertiserId: req.user.id,
      title: String(title),
      description: String(description),
      category: category ? String(category) : 'app_testing',
      rewardUnits: cleanReward,
      slots: cleanSlots,
      timeEstimateMinutes: Number(timeEstimateMinutes || 10),
      proofRequirements,
      hideAdvertiserName: Boolean(hideAdvertiserName),
      advertiserDisplayName: advertiserDisplayName ? String(advertiserDisplayName) : undefined,
      advertiserLogoUrl: advertiserLogoUrl ? String(advertiserLogoUrl) : undefined,
      deadlineAt: deadlineAt || null,
      creationKey: creationKey ? String(creationKey) : undefined,
      countryId: countryId ? String(countryId) : null,
      isNationwide: isNationwide !== undefined ? Boolean(isNationwide) : undefined,
      targetDivisionIds: Array.isArray(targetDivisionIds) ? targetDivisionIds.map(String) : undefined,
      authToken: req.authToken,
    });

    res.json({ success: true, ...result });
  } catch (err: any) {
    const msg = String(err?.message || 'فشل إنشاء الحملة وتمويلها.');
    const isInsufficient = msg.includes('INSUFFICIENT_FUNDS') || msg.includes('العجز المطلوب');
    res.status(400).json({
      error: msg.replace(/^INSUFFICIENT_FUNDS:\s*/i, ''),
      code: isInsufficient ? 'INSUFFICIENT_FUNDS' : undefined,
    });
  }
});

app.post('/api/advertiser/campaigns/:id/start', advertiserMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await supabaseDb.startAdvertiserCampaign({
      campaignId: req.params.id,
      actorId: req.user.id,
      isAdmin: false,
      authToken: req.authToken,
    });
    res.json({ success: true, ...result });
  } catch (err: any) {
    const isApprovalBlock = String(err?.message || '').includes('بانتظار موافقة الإدارة');
    res.status(isApprovalBlock ? 403 : 400).json({ error: err.message || 'فشل تشغيل الحملة الإعلانية.' });
  }
});

app.post('/api/advertiser/campaigns/:id/settle', advertiserMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await supabaseDb.settleAdvertiserCampaign({
      campaignId: req.params.id,
      targetStatus: req.body?.targetStatus === 'completed' ? 'completed' : 'cancelled',
      reason: req.body?.reason,
      actorId: req.user.id,
      isAdmin: false,
      authToken: req.authToken,
    });
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'فشل تسوية الحملة وإرجاع المتبقي.' });
  }
});

// Advertiser Wallet Summary & Deposits
app.get('/api/advertiser/wallet-summary', advertiserMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const summary = await supabaseDb.getAdvertiserWalletSummary(req.user.id, req.authToken);
    res.json(summary);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'فشل جلب تفاصيل محفظة المعلن.' });
  }
});

app.get('/api/advertiser/external-accounts', advertiserMiddleware, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const accounts = await supabaseDb.getAdvertiserExternalAccounts();
    res.json({ accounts });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'فشل جلب حسابات التحصيل الخارجية المتاحة.' });
  }
});

app.get('/api/advertiser/deposits', advertiserMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const deposits = await supabaseDb.getAdvertiserDeposits(req.user.id);
    res.json({ deposits });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'فشل جلب إيداعات المعلن.' });
  }
});

app.post('/api/advertiser/deposits', advertiserMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { externalAccountId, amountUnits, referenceNumber, receiptUrl, depositorName, depositorPhone, notes } = req.body || {};
    const amt = parseMoneyStrict(amountUnits);
    if (!Number.isFinite(amt) || amt <= 0) {
      return res.status(400).json({ error: 'يرجى إدخال مبلغ صحيح للإيداع.' });
    }
    if (!referenceNumber || !String(referenceNumber).trim()) {
      return res.status(400).json({ error: 'الرقم المرجعي للإيصال إلزامي.' });
    }
    if (!receiptUrl || !String(receiptUrl).trim()) {
      return res.status(400).json({ error: 'صورة أو مسار إشعار الإيداع إلزامي.' });
    }

    const result = await supabaseDb.createExternalDeposit({
      externalAccountId,
      depositPurpose: 'advertiser_wallet',
      advertiserId: req.user.id,
      amountUnits: amt,
      referenceNumber: String(referenceNumber).trim(),
      receiptUrl: String(receiptUrl).trim(),
      depositorName: depositorName ? String(depositorName).trim() : undefined,
      depositorPhone: depositorPhone ? String(depositorPhone).trim() : undefined,
      notes: notes ? String(notes).trim() : undefined,
      actorId: req.user.id,
      authToken: req.authToken,
    });

    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'فشل تسجيل إشعار الإيداع.' });
  }
});

app.post('/api/advertiser/deposits/receipt-signed-url', advertiserMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { fileName, contentType, fileSize } = req.body || {};
    const cleanType = String(contentType || '').trim().toLowerCase();
    const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg', 'application/pdf'];
    if (!ALLOWED.includes(cleanType)) {
      return res.status(400).json({ error: 'نوع الملف غير مدعوم. يرجى اختيار صورة أو PDF.' });
    }
    if (Number(fileSize || 0) > 5 * 1024 * 1024) {
      return res.status(400).json({ error: 'حجم الإيصال يجب أن لا يتجاوز 5 ميجابايت.' });
    }

    const adminClient = getSupabaseAdminClient();
    const safeName = (fileName || 'receipt.png').replace(/[^a-zA-Z0-9_.-]/g, '_');
    const storagePath = `external-receipts/${req.user.id}/${Date.now()}_${crypto.randomUUID().slice(0, 6)}_${safeName}`;

    const { data, error } = await adminClient.storage
      .from('task-proofs')
      .createSignedUploadUrl(storagePath);

    if (error || !data?.signedUrl) {
      return res.status(500).json({ error: error?.message || 'تعذر إنشاء رابط رفع الإيصال.' });
    }

    res.json({ signedUrl: data.signedUrl, token: data.token, path: storagePath });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'تعذر إنشاء رابط رفع الإيصال.' });
  }
});

// Admin Campaigns & Withdrawals
app.get('/api/admin/campaigns', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const campaigns = await supabaseDb.getAllAdminCampaigns(req.authToken);
    res.json({ campaigns });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'فشل جلب الحملات الإعلانية.' });
  }
});

app.post('/api/admin/campaigns/:id/approve', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await supabaseDb.approveAdvertiserCampaign({
      campaignId: req.params.id,
      actorId: req.user.id,
      authToken: req.authToken,
    });
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'فشل اعتماد الحملة الإعلانية.' });
  }
});

app.post('/api/admin/campaigns/:id/reject', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { reason } = req.body || {};
    const result = await supabaseDb.rejectAdvertiserCampaign({
      campaignId: req.params.id,
      reason: String(reason || ''),
      actorId: req.user.id,
      authToken: req.authToken,
    });
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'فشل رفض الحملة الإعلانية واسترجاع الرصيد.' });
  }
});

app.post('/api/admin/campaigns/:id/start', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await supabaseDb.startAdvertiserCampaign({
      campaignId: req.params.id,
      actorId: req.user.id,
      isAdmin: true,
      authToken: req.authToken,
    });
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'فشل تشغيل الحملة الإعلانية.' });
  }
});

app.post('/api/admin/campaigns/:id/settle', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await supabaseDb.settleAdvertiserCampaign({
      campaignId: req.params.id,
      targetStatus: req.body?.targetStatus === 'completed' ? 'completed' : 'cancelled',
      reason: req.body?.reason,
      actorId: req.user.id,
      isAdmin: true,
      authToken: req.authToken,
    });
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'فشل تسوية الحملة.' });
  }
});

app.post('/api/admin/withdrawals/receipt-signed-url', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { fileName, contentType, fileSize } = req.body || {};
    const cleanType = String(contentType || '').trim().toLowerCase();
    const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg', 'application/pdf'];
    if (!ALLOWED.includes(cleanType)) {
      return res.status(400).json({ error: 'نوع الملف غير مدعوم. يرجى اختيار صورة أو PDF.' });
    }
    if (Number(fileSize || 0) > 5 * 1024 * 1024) {
      return res.status(400).json({ error: 'حجم إشعار الصرف يجب أن لا يتجاوز 5 ميجابايت.' });
    }

    const adminClient = getSupabaseAdminClient();
    const safeName = (fileName || 'payout_receipt.png').replace(/[^a-zA-Z0-9_.-]/g, '_');
    const storagePath = `withdrawal-receipts/${Date.now()}_${crypto.randomUUID().slice(0, 6)}_${safeName}`;

    const { data, error } = await adminClient.storage
      .from('task-proofs')
      .createSignedUploadUrl(storagePath);

    if (error || !data?.signedUrl) {
      return res.status(500).json({ error: error?.message || 'تعذر إنشاء رابط رفع إشعار الصرف.' });
    }

    res.json({ signedUrl: data.signedUrl, token: data.token, path: storagePath });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'تعذر إنشاء رابط رفع إشعار الصرف.' });
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

// ==============================================================================
// ADMIN GEOGRAPHIC & ADMINISTRATIVE DIVISIONS MANAGEMENT (OWNER ONLY)
// ==============================================================================

app.get('/api/admin/geo/overview', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const overview = await geoService.getAdminGeoOverview(req.authToken);
    res.json(overview);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'فشل جلب لوحة البيانات الجغرافية.' });
  }
});

app.get('/api/admin/geo/integrity', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const report = await geoService.getAdminGeoIntegrity(req.authToken);
    res.json(report);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'فشل فحص سلامة البيانات الجغرافية.' });
  }
});

app.patch('/api/admin/geo/countries/:countryId', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const isActive = Boolean(req.body?.isActive);
    const country = await geoService.toggleCountryStatus(req.params.countryId, isActive, req.authToken);
    res.json({ success: true, country });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'فشل تحديث حالة الدولة.' });
  }
});

app.post('/api/admin/geo/countries/:countryId/levels', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { levelOrder, nameAr, nameEn, pluralAr, isRequired } = req.body || {};
    const level = await geoService.createCountryLevel(
      req.params.countryId,
      { levelOrder, nameAr, nameEn, pluralAr, isRequired },
      req.authToken
    );
    res.json({ success: true, level });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'فشل إضافة المستوى الإداري.' });
  }
});

app.post('/api/admin/geo/divisions', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const division = await geoService.createDivision(req.body || {}, req.authToken);
    res.json({ success: true, division });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'فشل إضافة التقسيم الإداري.' });
  }
});

app.put('/api/admin/geo/divisions/:divisionId', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const division = await geoService.updateDivision(req.params.divisionId, req.body || {}, req.authToken);
    res.json({ success: true, division });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'فشل تحديث التقسيم الإداري.' });
  }
});

app.post('/api/admin/geo/countries/:countryId/import', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await geoService.importCountryFromDataset(req.params.countryId, req.authToken);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'فشل مزامنة واستيراد بيانات الدولة.' });
  }
});

// ==============================================================================
// ISOLATED AD PARTNERS ENDPOINTS (STRICTLY SEPARATE FROM CLIXWALL & LEDGER)
// ==============================================================================

app.get('/api/ad-partners/public', async (req: Request, res: Response) => {
  try {
    const placementKey = req.query.placement ? String(req.query.placement).trim() : undefined;
    const result = await supabaseDb.getAdPartners({
      onlyActive: true,
      placementKey,
    });
    res.json({ partners: result.partners });
  } catch (err: any) {
    res.json({ partners: [] });
  }
});

app.get('/api/admin/ad-partners', adminMiddleware, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await supabaseDb.getAdPartners({ onlyActive: false });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'فشل جلب الشركاء الإعلانيين.' });
  }
});

app.post('/api/admin/ad-partners', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { partnerName, placementKey, codeType, code, width, height, rotationMode, sortOrder, isActive } =
      req.body || {};
    const result = await supabaseDb.createAdPartner({
      partnerName,
      placementKey,
      codeType,
      code,
      width,
      height,
      rotationMode,
      sortOrder,
      isActive,
      actorId: req.user.id,
      authToken: req.authToken,
    });
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'فشل إضافة الشريك الإعلاني.' });
  }
});

app.put('/api/admin/ad-partners/:id', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await supabaseDb.updateAdPartner(req.params.id, req.body || {}, req.authToken);
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'فشل تحديث بيانات الشريك الإعلاني.' });
  }
});

app.delete('/api/admin/ad-partners/:id', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await supabaseDb.deleteAdPartner(req.params.id, req.authToken);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'فشل حذف الشريك الإعلاني.' });
  }
});

// ==============================================================================
// CLIXWALL OFFER WALL & POSTBACK ENDPOINTS
// ==============================================================================

const clixwallHandlers = createClixWallHandlers({
  getAdminClient: getSupabaseAdminClient,
  onRewardCredited: async (info) => {
    await supabaseDb.createNotification({
      userId: info.userId,
      title: 'تمت إضافة مكافأة ClixWall إلى محفظتك!',
      message: `تم قيد مبلغ ${formatYer(info.rewardYer)} ر.ي بنجاح عن إتمام عرض "${info.offerName}".`,
      type: 'CLIXWALL_REWARD',
      link: '/wallet',
    });
  },
  onPostbackError: async (info) => {
    await logSupabaseError({
      err: new Error(info.reason),
      operation: 'CLIXWALL_POSTBACK',
      sourceTable: 'clixwall_postbacks',
      sourceFunction: 'process_clixwall_postback',
      apiRoute: info.route || '/api/postbacks/clixwall',
      details: {
        transaction_id: info.transactionId || null,
        user_id: info.userId || null,
        http_status: info.httpStatus,
        raw_status: info.rawStatus || null,
        reason: info.reason,
      },
    });
  },
});

const offerwallGgHandlers = createOfferwallGgHandlers({
  getAdminClient: getSupabaseAdminClient,
  onRewardCredited: async (info) => {
    await supabaseDb.createNotification({
      userId: info.userId,
      title: 'تمت إضافة مكافأة Offerwall.GG إلى محفظتك!',
      message: `تم قيد مبلغ ${formatYer(info.amountYer)} ر.ي عن إتمام عرض "${info.offerName}".`,
      type: 'OFFERWALL_GG_REWARD',
      link: '/wallet',
    });
  },
  onPostbackError: async (info) => {
    await logSupabaseError({
      err: new Error(info.reason),
      operation: 'OFFERWALL_GG_POSTBACK',
      sourceTable: 'offerwall_gg_postbacks',
      sourceFunction: 'process_offerwall_gg_postback',
      apiRoute: '/api/postbacks/offerwall-gg',
      details: { transaction_id: info.transactionId || null, user_id: info.userId || null },
    });
  },
});

// YT Coin mining: user-scoped JWT RPCs; independent from YER wallets and financial ledgers.
app.get('/api/yt-coin/summary', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.authToken) return res.status(401).json({ error: 'جلسة الدخول مطلوبة.' });
    const userClient = getSupabaseUserClient(req.authToken);
    const { data, error } = await userClient.rpc('get_my_yt_coin_summary');
    if (error) throw error;
    return res.json({ summary: data });
  } catch (err: any) {
    await logSupabaseError({ err, operation: 'YT_COIN_SUMMARY', apiRoute: '/api/yt-coin/summary' });
    return res.status(400).json({ error: err?.message || 'تعذر تحميل ملخص YT Coin.' });
  }
});
app.post('/api/yt-coin/claim', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.authToken) return res.status(401).json({ error: 'جلسة الدخول مطلوبة.' });
    const userClient = getSupabaseUserClient(req.authToken);
    const { data, error } = await userClient.rpc('claim_my_yt_coin_daily');
    if (error) throw error;
    return res.json({ result: data });
  } catch (err: any) {
    await logSupabaseError({ err, operation: 'YT_COIN_DAILY_CLAIM', apiRoute: '/api/yt-coin/claim' });
    return res.status(400).json({ error: err?.message || 'تعذر استلام مكافأة التعدين.' });
  }
});

app.get('/api/admin/yt-coin/summary', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.authToken) return res.status(401).json({ error: 'جلسة الإدارة مطلوبة.' });
    const { data, error } = await getSupabaseUserClient(req.authToken).rpc('get_yt_coin_admin_summary');
    if (error) throw error;
    return res.json({ summary: data });
  } catch (err: any) {
    await logSupabaseError({ err, operation: 'YT_COIN_ADMIN_SUMMARY', apiRoute: '/api/admin/yt-coin/summary' });
    return res.status(400).json({ error: err?.message || 'تعذر تحميل مؤشرات YT Coin.' });
  }
});

app.put('/api/admin/yt-coin/config', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.authToken) return res.status(401).json({ error: 'جلسة الإدارة مطلوبة.' });
    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;

    const toUnits = (raw: unknown, label: string, minUnits: number): number | null => {
      if (raw === undefined || raw === null || raw === '') return null;
      const num = Number(raw);
      if (!Number.isFinite(num) || num < 0) {
        throw new Error(`قيمة "${label}" غير صالحة.`);
      }
      if (Math.abs(num * 2 - Math.round(num * 2)) > 1e-6) {
        throw new Error(`قيمة "${label}" يجب أن تكون من مضاعفات 0.5 YT (خانة عشرية واحدة مثل 0.5 أو 1.5 أو 20).`);
      }
      const units = Math.round(num * 2);
      if (units < minUnits) {
        throw new Error(`قيمة "${label}" أقل من الحد الأدنى المسموح.`);
      }
      return units;
    };

    const miningEnabled =
      typeof body.miningEnabled === 'boolean' ? body.miningEnabled : null;
    const baseRewardUnits = toUnits(body.baseRewardYt, 'مكافأة اليوم الأول', 1);
    const dailyIncrementUnits = toUnits(body.dailyIncrementYt, 'الزيادة اليومية', 0);
    const maxDailyRewardUnits = toUnits(body.maxDailyRewardYt, 'مكافأة اليوم 20 وما بعده', 1);
    const dailyCapStartUnits = toUnits(body.dailyCapStartYt, 'السقف اليومي الابتدائي', 1);
    const dailyCapMaxUnits = toUnits(body.dailyCapMaxYt, 'الحد الأقصى للسقف اليومي', 1);

    const { data, error } = await getSupabaseUserClient(req.authToken).rpc('admin_update_yt_coin_config', {
      p_mining_enabled: miningEnabled,
      p_base_reward_units: baseRewardUnits,
      p_daily_increment_units: dailyIncrementUnits,
      p_max_daily_reward_units: maxDailyRewardUnits,
      p_daily_cap_start_units: dailyCapStartUnits,
      p_daily_cap_max_units: dailyCapMaxUnits,
    });
    if (error) throw error;
    return res.json({ config: data });
  } catch (err: any) {
    await logSupabaseError({ err, operation: 'YT_COIN_ADMIN_CONFIG_UPDATE', apiRoute: '/api/admin/yt-coin/config' });
    return res.status(400).json({ error: err?.message || 'تعذر تحديث إعدادات تعدين YT Coin.' });
  }
});

app.get('/api/clixwall/offerwall-url', authMiddleware, clixwallHandlers.getOfferWallUrl);
app.get('/api/clixwall/rewards', authMiddleware, clixwallHandlers.getRewards);
app.get('/api/offerwall-gg/url', authMiddleware, offerwallGgHandlers.getOfferWallUrl);
app.get('/api/offerwall-gg/rewards', authMiddleware, offerwallGgHandlers.getRewards);
app.all('/api/postbacks/offerwall-gg', offerwallGgHandlers.handlePostback);
app.all('/api/postbacks/clixwall', clixwallHandlers.handlePostback);
app.all('/api/clixwall/postback', clixwallHandlers.handlePostback);

// ==============================================================================
// SMART LINKS (VERIFIED POSTBACK-ONLY REWARDS) & SEQUENTIAL SURVEYS & ASSETS
// ==============================================================================

app.post('/api/smart-links/:id/start', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const task = await supabaseDb.getTaskById(req.params.id, { userId: req.user.id, maskSecrets: false });
    if (!task) {
      return res.status(404).json({ error: 'الرابط الذكي غير موجود.' });
    }
    const result = await taskSystemService.startSmartLinkAttempt({
      task,
      userId: req.user.id,
    });
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'تعذر بدء جلسة الرابط الذكي.' });
  }
});

app.all('/api/smart-links/postback', async (req: Request, res: Response) => {
  const payload = { ...(req.query || {}), ...(req.body && typeof req.body === 'object' ? req.body : {}) };
  try {
    const result = await taskSystemService.handleSmartLinkPostback({
      secret: payload.secret || payload.sig || payload.token,
      clickToken: payload.click_token || payload.click_id || payload.subid || payload.sub_id,
      externalTxId: payload.tx_id || payload.transaction_id || payload.txn_id || payload.txid,
      userId: payload.user_id || payload.uid,
      taskId: payload.task_id,
      rewardYer: payload.reward_yer ?? payload.payout ?? payload.amount,
      status: payload.status,
      rawPayload: payload,
    });
    res.json(result);
  } catch (err: any) {
    const msg = String(err?.message || 'Postback rejected');
    const code = msg.startsWith('FORBIDDEN') ? 403 : 400;
    res.status(code).json({ ok: false, error: msg });
  }
});

// Surveys (User Flow)
app.get('/api/surveys', async (req: Request, res: Response) => {
  try {
    const userId = await resolveOptionalUserId(req);
    const surveys = await taskSystemService.listSurveys({ userId, includeDrafts: false });
    res.json({ surveys });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'فشل جلب الاستبيانات.' });
  }
});

app.get('/api/surveys/:id', async (req: Request, res: Response) => {
  try {
    const userId = await resolveOptionalUserId(req);
    const survey = await taskSystemService.getSurveyById(req.params.id, userId);
    if (!survey) return res.status(404).json({ error: 'الاستبيان غير موجود.' });
    res.json({ survey });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'فشل جلب تفاصيل الاستبيان.' });
  }
});

app.post('/api/surveys/:id/start', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await taskSystemService.startOrResumeSurveyAttempt(req.params.id, req.user.id);
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'تعذر بدء الاستبيان.' });
  }
});

app.put('/api/surveys/attempts/:attemptId/progress', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { currentQuestionIndex, answers } = req.body || {};
    const attempt = await taskSystemService.saveSurveyAttemptProgress(req.params.attemptId, req.user.id, {
      currentQuestionIndex: Number(currentQuestionIndex || 0),
      answers: answers && typeof answers === 'object' ? answers : {},
    });
    res.json({ success: true, attempt });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'تعذر حفظ التقدم.' });
  }
});

app.post('/api/surveys/attempts/:attemptId/submit', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await taskSystemService.submitSurveyAttempt(req.params.attemptId, req.user.id);
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'تعذر إرسال الاستبيان.' });
  }
});

// Admin Survey Builder & Assets / Category Icons Management
app.get('/api/admin/surveys', adminMiddleware, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const surveys = await taskSystemService.listSurveys({ includeDrafts: true });
    res.json({ surveys });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'فشل جلب الاستبيانات للإدارة.' });
  }
});

app.post('/api/admin/surveys', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const survey = await taskSystemService.adminSaveSurvey(req.body || {}, req.user.id);
    res.json({ success: true, survey });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'فشل إنشاء الاستبيان.' });
  }
});

app.put('/api/admin/surveys/:id', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const survey = await taskSystemService.adminSaveSurvey({ ...(req.body || {}), id: req.params.id }, req.user.id);
    res.json({ success: true, survey });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'فشل تحديث الاستبيان.' });
  }
});

app.delete('/api/admin/surveys/:id', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    await taskSystemService.adminDeleteSurvey(req.params.id, req.user.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'فشل حذف الاستبيان.' });
  }
});

app.get('/api/admin/assets', adminMiddleware, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const assets = await taskSystemService.getTaskAssets();
    res.json({ assets });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'فشل جلب مكتبة الصور.' });
  }
});

app.post('/api/admin/assets/upload', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { title, assetKind, taskKind, fileName, contentType, base64Data } = req.body || {};
    const asset = await taskSystemService.uploadTaskAsset({
      title,
      assetKind,
      taskKind,
      fileName,
      contentType,
      base64Data,
      actorId: req.user.id,
    });
    res.json({ success: true, asset });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'فشل رفع الصورة إلى التخزين.' });
  }
});

app.delete('/api/admin/assets/:id', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    await taskSystemService.deleteTaskAsset(req.params.id, req.user.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'فشل حذف الصورة.' });
  }
});

app.put('/api/admin/task-categories/:slug', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const category = await taskSystemService.upsertTaskCategory(req.params.slug, req.body || {}, req.user.id);
    res.json({ success: true, category });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'فشل تحديث التصنيف.' });
  }
});

// Structured JSON 404 for unmatched API paths (prevents SPA HTML fallback on /api/*)
app.use('/api', (req: Request, res: Response) => {
  return res.status(404).json({
    error: 'المسار البرمجي المطلوب غير موجود.',
    path: req.originalUrl || req.url,
    method: req.method,
  });
});

export default app;
