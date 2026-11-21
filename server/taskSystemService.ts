/**
 * Yemen Task — Unified Service for Task Visual Metadata, Supabase Storage Assets,
 * Task Categories, User Favorites, Verified Smart Links (Postback-only), and Sequential Surveys.
 *
 * Dual-mode persistence:
 *  1) Primary: Dedicated PostgreSQL tables & RPCs from Migration 035.
 *  2) Seamless Fallback: Supabase `platform_settings` JSONB + existing `post_ledger_transaction` RPC
 *     (6-decimal NUMERIC(30,6) YER), guaranteeing zero LocalStorage reliance even before 035 runs.
 */

import crypto from 'node:crypto';
import {
  getSupabaseAdminClient,
  supabaseServer,
  logSupabaseError,
} from './app.js';
import { sendWebPushToUser } from './pushService.js';
import {
  parseMoneyStrict,
  roundYer6,
  formatYer,
} from '../shared/money.js';
import {
  SUPABASE_TASK_ASSET_URLS,
  TASK_KIND_OPTIONS,
  getDefaultTaskImageUrl,
  inferTaskKindFromCategory,
  normalizeProofRequirements,
  sanitizeSafeImageUrl,
  sanitizeTaskBuilderMeta,
  toCanonicalTaskKind,
} from '../shared/taskMeta.js';
import { evaluateSurveyPath } from '../shared/surveyLogic.js';
import type {
  SmartLinkAttempt,
  SurveyAttempt,
  SurveyItem,
  SurveyOption,
  SurveyQuestion,
  SurveyQuestionType,
  TaskAssetItem,
  TaskBuilderMeta,
  TaskCategory,
  TaskCategoryItem,
  TaskItem,
} from '../src/types/index.js';

const BUCKET_TASK_ASSETS = 'task-assets';
const KEY_ASSETS_REGISTRY = 'task_assets_registry';
const KEY_CATEGORIES_REGISTRY = 'task_categories_registry';
const KEY_SURVEYS_REGISTRY = 'surveys_registry';
const KEY_SMART_LINK_ATTEMPTS = 'smart_link_attempts_registry';

const VALID_QUESTION_TYPES: SurveyQuestionType[] = [
  'single_choice',
  'multiple_choice',
  'yes_no',
  'short_text',
  'long_text',
  'number',
  'rating_1_5',
];

function getDb() {
  try {
    return getSupabaseAdminClient();
  } catch {
    return supabaseServer;
  }
}

function isMissingSchemaError(err: any): boolean {
  const code = String(err?.code || '').toUpperCase();
  const msg = String(err?.message || '').toLowerCase();
  return (
    code === '42P01' ||
    code === 'PGRST205' ||
    code === '42703' ||
    code === 'PGRST204' ||
    code === 'PGRST202' ||
    code === '42883' ||
    msg.includes('does not exist') ||
    msg.includes('could not find') ||
    msg.includes('schema cache')
  );
}

async function readSetting<T>(key: string, fallback: T): Promise<T> {
  const db = getDb();
  try {
    const { data, error } = await db
      .from('platform_settings')
      .select('setting_value')
      .eq('setting_key', key)
      .maybeSingle();
    if (error || !data || data.setting_value === undefined || data.setting_value === null) {
      return fallback;
    }
    return data.setting_value as T;
  } catch {
    return fallback;
  }
}

async function writeSetting<T>(
  key: string,
  value: T,
  description = 'Yemen Task dynamic registry',
  actorId?: string | null
): Promise<void> {
  const db = getDb();
  const { error } = await db.from('platform_settings').upsert(
    {
      setting_key: key,
      setting_value: value as any,
      description,
      updated_by: actorId || null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'setting_key' }
  );
  if (error) {
    throw new Error(`فشل حفظ الإعدادات في Supabase (${key}): ${error.message}`);
  }
}

const DEFAULT_TASK_CATEGORIES: TaskCategoryItem[] = [
  { id: 'cat-all', slug: 'all', labelAr: 'جميع المهام', iconUrl: SUPABASE_TASK_ASSET_URLS.cat_all, badgeColor: '#059669', sortOrder: 0, isActive: true },
  { id: 'cat-popular', slug: 'popular', labelAr: 'الأكثر شعبية', iconUrl: SUPABASE_TASK_ASSET_URLS.cat_popular, badgeColor: '#D97706', sortOrder: 1, isActive: true },
  { id: 'cat-quick', slug: 'quick', labelAr: 'المهام السريعة', iconUrl: SUPABASE_TASK_ASSET_URLS.cat_quick, badgeColor: '#4F46E5', sortOrder: 2, isActive: true },
  { id: 'cat-featured', slug: 'featured', labelAr: 'مميزة', iconUrl: SUPABASE_TASK_ASSET_URLS.cat_featured, badgeColor: '#0EA5E9', sortOrder: 3, isActive: true },
  { id: 'cat-surveys', slug: 'surveys', labelAr: 'الاستبيانات', iconUrl: SUPABASE_TASK_ASSET_URLS.surveys, badgeColor: '#059669', sortOrder: 4, isActive: true },
  { id: 'cat-video-watch', slug: 'video_watch', labelAr: 'مشاهدة الفيديوهات', iconUrl: SUPABASE_TASK_ASSET_URLS.video_watch, badgeColor: '#0D9488', sortOrder: 5, isActive: true },
  { id: 'cat-website-visit', slug: 'website_visit', labelAr: 'زيارة المواقع والروابط', iconUrl: SUPABASE_TASK_ASSET_URLS.website_visit, badgeColor: '#4F46E5', sortOrder: 6, isActive: true },
  { id: 'cat-social-follow', slug: 'social_follow', labelAr: 'متابعة الحسابات', iconUrl: SUPABASE_TASK_ASSET_URLS.social_follow, badgeColor: '#2563EB', sortOrder: 7, isActive: true },
  { id: 'cat-social-engagement', slug: 'social_engagement', labelAr: 'الإعجاب والتفاعل', iconUrl: SUPABASE_TASK_ASSET_URLS.social_engagement, badgeColor: '#E11D48', sortOrder: 8, isActive: true },
  { id: 'cat-app-testing', slug: 'app_testing', labelAr: 'تطبيقات وألعاب', iconUrl: SUPABASE_TASK_ASSET_URLS.app_testing, badgeColor: '#D97706', sortOrder: 9, isActive: true },
  { id: 'cat-account-signup', slug: 'account_signup', labelAr: 'التسجيل والحسابات', iconUrl: SUPABASE_TASK_ASSET_URLS.account_signup, badgeColor: '#10B981', sortOrder: 10, isActive: true },
  { id: 'cat-custom-proof', slug: 'custom_proof', labelAr: 'إثباتات مخصصة', iconUrl: SUPABASE_TASK_ASSET_URLS.custom_proof, badgeColor: '#334155', sortOrder: 11, isActive: true },
  { id: 'cat-smart-links', slug: 'smart_links', labelAr: 'الروابط الذكية', iconUrl: SUPABASE_TASK_ASSET_URLS.smart_links, badgeColor: '#0D9488', sortOrder: 12, isActive: true },
  { id: 'cat-data-entry', slug: 'data_entry', labelAr: 'إدخال البيانات', iconUrl: SUPABASE_TASK_ASSET_URLS.quick_tasks, badgeColor: '#6366F1', sortOrder: 13, isActive: true },
  { id: 'cat-reviews', slug: 'review_ratings', labelAr: 'التقييمات والخرائط', iconUrl: SUPABASE_TASK_ASSET_URLS.external_offers, badgeColor: '#059669', sortOrder: 14, isActive: true },
  { id: 'cat-local', slug: 'local_services', labelAr: 'عروض الشركاء', iconUrl: SUPABASE_TASK_ASSET_URLS.external_offers, badgeColor: '#10B981', sortOrder: 15, isActive: true },
];

const DEFAULT_TASK_ASSETS: TaskAssetItem[] = [
  { id: 'def-featured', title: 'بطاقة مهمة مميزة', assetKind: 'task_illustration', taskKind: 'custom_proof', storagePath: 'defaults/task_featured_emerald.jpg', publicUrl: SUPABASE_TASK_ASSET_URLS.featured, createdAt: '2026-01-01T00:00:00.000Z' },
  { id: 'def-surveys', title: 'بطاقة استبيان تفاعلي', assetKind: 'task_illustration', taskKind: 'surveys', storagePath: 'defaults/task_survey_art.jpg', publicUrl: SUPABASE_TASK_ASSET_URLS.surveys, createdAt: '2026-01-01T00:00:00.000Z' },
  { id: 'def-video', title: 'بطاقة مشاهدة فيديو', assetKind: 'task_illustration', taskKind: 'video_watch', storagePath: 'defaults/task_video_watch.jpg', publicUrl: SUPABASE_TASK_ASSET_URLS.video_watch, createdAt: '2026-01-01T00:00:00.000Z' },
  { id: 'def-smartlinks', title: 'بطاقة زيارة مواقع وروابط', assetKind: 'task_illustration', taskKind: 'website_visit', storagePath: 'defaults/task_smartlink_art.jpg', publicUrl: SUPABASE_TASK_ASSET_URLS.website_visit, createdAt: '2026-01-01T00:00:00.000Z' },
  { id: 'def-social-follow', title: 'بطاقة متابعة حسابات', assetKind: 'task_illustration', taskKind: 'social_follow', storagePath: 'defaults/task_social_follow.jpg', publicUrl: SUPABASE_TASK_ASSET_URLS.social_follow, createdAt: '2026-01-01T00:00:00.000Z' },
  { id: 'def-social-engage', title: 'بطاقة إعجاب وتفاعل', assetKind: 'task_illustration', taskKind: 'social_engagement', storagePath: 'defaults/task_social_engagement.jpg', publicUrl: SUPABASE_TASK_ASSET_URLS.social_engagement, createdAt: '2026-01-01T00:00:00.000Z' },
  { id: 'def-apps', title: 'بطاقة تحميل وتجربة تطبيقات', assetKind: 'task_illustration', taskKind: 'app_testing', storagePath: 'defaults/task_app_testing.jpg', publicUrl: SUPABASE_TASK_ASSET_URLS.app_testing, createdAt: '2026-01-01T00:00:00.000Z' },
  { id: 'def-signup', title: 'بطاقة تسجيل وإنشاء حسابات', assetKind: 'task_illustration', taskKind: 'account_signup', storagePath: 'defaults/task_account_signup.jpg', publicUrl: SUPABASE_TASK_ASSET_URLS.account_signup, createdAt: '2026-01-01T00:00:00.000Z' },
  { id: 'def-quick', title: 'بطاقة إثبات مخصص', assetKind: 'task_illustration', taskKind: 'custom_proof', storagePath: 'defaults/task_quick_violet.jpg', publicUrl: SUPABASE_TASK_ASSET_URLS.custom_proof, createdAt: '2026-01-01T00:00:00.000Z' },
  { id: 'def-offers', title: 'بطاقة عروض الشركاء', assetKind: 'task_illustration', taskKind: 'external_offers', storagePath: 'defaults/task_external_offers.jpg', publicUrl: SUPABASE_TASK_ASSET_URLS.external_offers, createdAt: '2026-01-01T00:00:00.000Z' },
  { id: 'def-cat-all', title: 'أيقونة جميع المهام', assetKind: 'category_icon', taskKind: null, storagePath: 'defaults/cat_icon_all.jpg', publicUrl: SUPABASE_TASK_ASSET_URLS.cat_all, createdAt: '2026-01-01T00:00:00.000Z' },
  { id: 'def-cat-pop', title: 'أيقونة الأكثر شعبية', assetKind: 'category_icon', taskKind: null, storagePath: 'defaults/cat_icon_popular.jpg', publicUrl: SUPABASE_TASK_ASSET_URLS.cat_popular, createdAt: '2026-01-01T00:00:00.000Z' },
  { id: 'def-cat-quick', title: 'أيقونة المهام السريعة', assetKind: 'category_icon', taskKind: null, storagePath: 'defaults/cat_icon_quick.jpg', publicUrl: SUPABASE_TASK_ASSET_URLS.cat_quick, createdAt: '2026-01-01T00:00:00.000Z' },
  { id: 'def-cat-feat', title: 'أيقونة مميزة', assetKind: 'category_icon', taskKind: null, storagePath: 'defaults/cat_icon_featured.jpg', publicUrl: SUPABASE_TASK_ASSET_URLS.cat_featured, createdAt: '2026-01-01T00:00:00.000Z' },
];

async function ensureUserWalletAndFinancialAccount(db: any, userId: string): Promise<{
  walletId: string;
  walletFinancialAccountId: string;
}> {
  const hash = crypto
    .createHash('sha256')
    .update(userId + '_kasb_wallet_salt_yemen_v1')
    .digest('hex')
    .toUpperCase();
  const walletAddress = `KY-${hash.slice(0, 12)}`;

  await db
    .from('wallets')
    .upsert({ user_id: userId, wallet_address: walletAddress, status: 'active' }, { onConflict: 'user_id' })
    .select('id');

  const { data: walletRow, error: walletErr } = await db
    .from('wallets')
    .select('id')
    .eq('user_id', userId)
    .single();
  if (walletErr || !walletRow) {
    throw new Error('تعذر العثور على محفظة المستخدم في قاعدة البيانات.');
  }

  const { data: accRows } = await db
    .from('financial_accounts')
    .select('id')
    .eq('account_type', 'wallet')
    .or(`wallet_id.eq.${walletRow.id},owner_user_id.eq.${userId}`)
    .order('created_at', { ascending: true })
    .limit(1);

  if (accRows && accRows.length > 0) {
    return { walletId: walletRow.id, walletFinancialAccountId: accRows[0].id };
  }

  const { data: createdAcc, error: createAccErr } = await db
    .from('financial_accounts')
    .insert({
      account_code: `WALLET-${walletRow.id}`,
      account_type: 'wallet',
      normal_side: 'credit',
      balance_units: 0,
      owner_user_id: userId,
      wallet_id: walletRow.id,
      status: 'active',
    })
    .select('id')
    .single();

  if (createAccErr || !createdAcc) {
    throw new Error(`فشل إنشاء الحساب المالي للمحفظة: ${createAccErr?.message || 'خطأ غير معروف'}`);
  }

  return { walletId: walletRow.id, walletFinancialAccountId: createdAcc.id };
}

async function resolveTreasuryOrEscrowSource(db: any, escrowAccountId: string | null | undefined, amountYer: number): Promise<string> {
  if (escrowAccountId) {
    const { data: escrowAcc } = await db
      .from('financial_accounts')
      .select('id, balance_units')
      .eq('id', escrowAccountId)
      .maybeSingle();
    if (escrowAcc && Number(escrowAcc.balance_units || 0) >= amountYer) {
      return escrowAcc.id;
    }
  }
  const { data: treasuryAcc, error } = await db
    .from('financial_accounts')
    .select('id')
    .eq('account_code', 'PLATFORM-TREASURY')
    .maybeSingle();
  if (error || !treasuryAcc) {
    throw new Error('حساب خزينة المنصة (PLATFORM-TREASURY) غير موجود في الدفتر.');
  }
  return treasuryAcc.id;
}

export const taskSystemService = {
  // ============================================================================
  // 1. TASK ASSETS & CATEGORY ICONS (SUPABASE STORAGE BUCKET: task-assets)
  // ============================================================================

  async getTaskAssets(): Promise<TaskAssetItem[]> {
    const db = getDb();
    try {
      const { data, error } = await db
        .from('task_assets')
        .select('*')
        .order('created_at', { ascending: false });

      if (!error && Array.isArray(data) && data.length > 0) {
        return data.map((row: any) => ({
          id: String(row.id),
          title: row.title || 'صورة مهمة',
          assetKind: row.asset_kind || 'task_illustration',
          taskKind: row.task_kind || null,
          storagePath: row.storage_path,
          publicUrl: row.public_url,
          createdAt: row.created_at,
        }));
      }
      if (error && !isMissingSchemaError(error)) {
        throw error;
      }
    } catch {
      // Fallback below
    }

    const reg = await readSetting<TaskAssetItem[]>(KEY_ASSETS_REGISTRY, []);
    const merged = [...reg];
    for (const def of DEFAULT_TASK_ASSETS) {
      if (!merged.some((a) => a.storagePath === def.storagePath)) {
        merged.push(def);
      }
    }
    return merged;
  },

  async uploadTaskAsset(params: {
    title: string;
    assetKind?: 'task_illustration' | 'category_icon' | 'provider_logo';
    taskKind?: string | null;
    fileName: string;
    contentType: string;
    base64Data: string;
    actorId?: string | null;
  }): Promise<TaskAssetItem> {
    const allowedMime = new Set([
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/webp',
      'image/svg+xml',
    ]);
    const cleanType = String(params.contentType || 'image/jpeg').trim().toLowerCase();
    if (!allowedMime.has(cleanType)) {
      throw new Error('صيغة الملف غير مدعومة. المسموح: JPG, PNG, WEBP, SVG.');
    }

    const rawBase64 = String(params.base64Data || '').replace(/^data:[^;]+;base64,/, '').trim();
    if (!rawBase64) {
      throw new Error('بيانات الصورة مطلوبة.');
    }
    const buffer = Buffer.from(rawBase64, 'base64');
    if (buffer.length === 0 || buffer.length > 5 * 1024 * 1024) {
      throw new Error('حجم الصورة يجب أن يكون أقل من 5 ميجابايت.');
    }

    const adminClient = getSupabaseAdminClient();
    const extMap: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/jpg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'image/svg+xml': 'svg',
    };
    const safeName = (params.fileName || 'asset')
      .replace(/\.[^.]+$/, '')
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .slice(0, 40);
    const assetKind = params.assetKind || 'task_illustration';
    const folder = assetKind === 'category_icon' ? 'categories' : assetKind === 'provider_logo' ? 'providers' : 'custom';
    const storagePath = `${folder}/${Date.now()}_${crypto.randomUUID().slice(0, 8)}_${safeName}.${extMap[cleanType] || 'jpg'}`;

    const { error: uploadErr } = await adminClient.storage
      .from(BUCKET_TASK_ASSETS)
      .upload(storagePath, buffer, {
        contentType: cleanType === 'image/jpg' ? 'image/jpeg' : cleanType,
        upsert: true,
        cacheControl: '31536000',
      });

    if (uploadErr) {
      throw new Error(`فشل رفع الصورة إلى Supabase Storage: ${uploadErr.message}`);
    }

    const { data: pubData } = adminClient.storage.from(BUCKET_TASK_ASSETS).getPublicUrl(storagePath);
    const publicUrl = pubData.publicUrl;
    const cleanTitle = String(params.title || safeName || 'صورة مخصصة').trim().slice(0, 100);
    const now = new Date().toISOString();

    const item: TaskAssetItem = {
      id: crypto.randomUUID(),
      title: cleanTitle,
      assetKind,
      taskKind: params.taskKind || null,
      storagePath,
      publicUrl,
      createdAt: now,
    };

    try {
      const { data: inserted, error: insErr } = await adminClient
        .from('task_assets')
        .insert({
          title: item.title,
          asset_kind: item.assetKind,
          task_kind: item.taskKind,
          storage_path: item.storagePath,
          public_url: item.publicUrl,
          created_by: params.actorId || null,
        })
        .select('*')
        .single();

      if (!insErr && inserted) {
        item.id = String(inserted.id);
        item.createdAt = inserted.created_at;
        return item;
      }
      if (insErr && !isMissingSchemaError(insErr)) {
        throw insErr;
      }
    } catch {
      // Fall back to platform_settings registry
    }

    const existing = await readSetting<TaskAssetItem[]>(KEY_ASSETS_REGISTRY, []);
    await writeSetting(KEY_ASSETS_REGISTRY, [item, ...existing], 'Task visual assets uploaded to Supabase Storage', params.actorId);
    return item;
  },

  async deleteTaskAsset(id: string, actorId?: string | null): Promise<void> {
    const db = getDb();
    let storagePathToRemove: string | null = null;

    try {
      const { data, error } = await db
        .from('task_assets')
        .select('id, storage_path')
        .eq('id', id)
        .maybeSingle();

      if (!error && data) {
        storagePathToRemove = data.storage_path;
        await db.from('task_assets').delete().eq('id', id);
      }
    } catch {
      // Ignore if table not yet migrated
    }

    const reg = await readSetting<TaskAssetItem[]>(KEY_ASSETS_REGISTRY, []);
    const found = reg.find((a) => a.id === id);
    if (found) {
      storagePathToRemove = storagePathToRemove || found.storagePath;
      const filtered = reg.filter((a) => a.id !== id);
      await writeSetting(KEY_ASSETS_REGISTRY, filtered, 'Task visual assets registry', actorId);
    }

    if (storagePathToRemove && !storagePathToRemove.startsWith('defaults/')) {
      try {
        await getSupabaseAdminClient().storage.from(BUCKET_TASK_ASSETS).remove([storagePathToRemove]);
      } catch {
        // Non-blocking storage cleanup
      }
    }
  },

  async getTaskCategories(): Promise<TaskCategoryItem[]> {
    const db = getDb();
    try {
      const { data, error } = await db
        .from('task_categories')
        .select('*')
        .order('sort_order', { ascending: true });
      if (!error && Array.isArray(data) && data.length > 0) {
        return data.map((row: any) => ({
          id: String(row.id),
          slug: row.slug,
          labelAr: row.label_ar,
          iconUrl: row.icon_url || null,
          badgeColor: row.badge_color || '#059669',
          sortOrder: Number(row.sort_order || 0),
          isActive: row.is_active !== false,
        }));
      }
    } catch {
      // Fallback below
    }

    const saved = await readSetting<TaskCategoryItem[]>(KEY_CATEGORIES_REGISTRY, []);
    if (Array.isArray(saved) && saved.length > 0) {
      const bySlug = new Map(saved.map((c) => [c.slug, c]));
      const merged: TaskCategoryItem[] = [];
      for (const def of DEFAULT_TASK_CATEGORIES) {
        merged.push(bySlug.get(def.slug) || def);
        bySlug.delete(def.slug);
      }
      for (const extra of bySlug.values()) {
        merged.push(extra);
      }
      return merged.sort((a, b) => a.sortOrder - b.sortOrder);
    }

    return DEFAULT_TASK_CATEGORIES;
  },

  async upsertTaskCategory(
    slug: string,
    payload: {
      labelAr?: string;
      iconUrl?: string | null;
      badgeColor?: string;
      sortOrder?: number;
      isActive?: boolean;
    },
    actorId?: string | null
  ): Promise<TaskCategoryItem> {
    const cleanSlug = String(slug || '').trim();
    if (!cleanSlug) throw new Error('معرف التصنيف مطلوب.');

    const currentList = await this.getTaskCategories();
    const existing = currentList.find((c) => c.slug === cleanSlug);
    const nextItem: TaskCategoryItem = {
      id: existing?.id || `cat-${cleanSlug}`,
      slug: cleanSlug,
      labelAr: payload.labelAr ? String(payload.labelAr).trim().slice(0, 50) : existing?.labelAr || cleanSlug,
      iconUrl:
        payload.iconUrl === null
          ? null
          : sanitizeSafeImageUrl(payload.iconUrl) || existing?.iconUrl || null,
      badgeColor: payload.badgeColor ? String(payload.badgeColor).trim().slice(0, 20) : existing?.badgeColor || '#059669',
      sortOrder: payload.sortOrder !== undefined ? Math.round(Number(payload.sortOrder) || 0) : existing?.sortOrder ?? 99,
      isActive: payload.isActive !== undefined ? Boolean(payload.isActive) : existing?.isActive ?? true,
    };

    const db = getDb();
    try {
      const { data, error } = await db
        .from('task_categories')
        .upsert(
          {
            slug: nextItem.slug,
            label_ar: nextItem.labelAr,
            icon_url: nextItem.iconUrl,
            badge_color: nextItem.badgeColor,
            sort_order: nextItem.sortOrder,
            is_active: nextItem.isActive,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'slug' }
        )
        .select('*')
        .single();
      if (!error && data) {
        nextItem.id = String(data.id);
      }
    } catch {
      // Fallback persisted below
    }

    const updated = currentList.some((c) => c.slug === cleanSlug)
      ? currentList.map((c) => (c.slug === cleanSlug ? nextItem : c))
      : [...currentList, nextItem];

    await writeSetting(KEY_CATEGORIES_REGISTRY, updated, 'Task category icons & colors registry', actorId);
    return nextItem;
  },

  // ============================================================================
  // 2. TASK METADATA ENRICHMENT (PRE-035 & POST-035 SAFE)
  // ============================================================================

  async saveTaskExtendedMeta(
    taskId: string,
    payload: {
      taskMeta: TaskBuilderMeta;
      category?: string;
      steps?: string[];
      timeEstimateMinutes?: number;
      proofRequirements?: Record<string, any>;
      maxPerUser?: number;
    },
    actorId?: string | null
  ): Promise<void> {
    const db = getDb();
    const meta = sanitizeTaskBuilderMeta(payload.taskMeta, payload.category);
    const virtualCategory =
      meta.taskKind === 'smart_links'
        ? 'smart_links'
        : meta.taskKind === 'surveys'
          ? 'surveys'
          : payload.category;

    // 1) Mirror into platform_settings (`task_meta_<taskId>`) so pre-035 databases persist everything reliably
    const mirrorDoc = {
      taskMeta: meta,
      virtualCategory,
      steps: Array.isArray(payload.steps) ? payload.steps : undefined,
      timeEstimateMinutes: payload.timeEstimateMinutes,
      proofRequirements: payload.proofRequirements,
      maxPerUser: payload.maxPerUser,
      updatedAt: new Date().toISOString(),
    };
    await writeSetting(`task_meta_${taskId}`, mirrorDoc, `Task visual/extended metadata for ${taskId}`, actorId);

    // 2) Best-effort sync to public.tasks extended columns when Migration 035 is applied
    try {
      const updateObj: Record<string, any> = {
        task_kind: meta.taskKind,
        is_featured: Boolean(meta.isFeatured),
        sort_order: Number(meta.sortOrder || 0),
        card_theme: meta.cardTheme || 'emerald',
        badge_label: meta.badgeLabel || null,
        badge_color: meta.badgeColor || null,
        image_url: meta.imageUrl || null,
        task_meta: meta,
        provider_name: meta.fields?.providerName || null,
        provider_logo_url: meta.fields?.providerLogoUrl || null,
        tracking_url: meta.fields?.trackingUrl || null,
        postback_secret: meta.fields?.postbackSecret || null,
      };
      if (payload.maxPerUser && payload.maxPerUser > 0) {
        updateObj.max_per_user = Math.round(payload.maxPerUser);
      }
      await db.from('tasks').update(updateObj).eq('id', taskId);
    } catch {
      // Gracefully ignored on pre-035 schema because mirrorDoc already persisted it in Supabase
    }
  },

  async deleteTaskExtendedMeta(taskId: string): Promise<void> {
    try {
      await getDb().from('platform_settings').delete().eq('setting_key', `task_meta_${taskId}`);
    } catch {
      // Ignore
    }
  },

  async enrichTasks(
    tasks: TaskItem[],
    options?: { userId?: string; maskSecrets?: boolean }
  ): Promise<TaskItem[]> {
    if (!tasks || tasks.length === 0) return tasks;
    const db = getDb();
    const maskSecrets = options?.maskSecrets !== false;
    const keys = tasks.map((t) => `task_meta_${t.id}`);

    const metaMap = new Map<string, any>();
    try {
      const { data } = await db
        .from('platform_settings')
        .select('setting_key, setting_value')
        .in('setting_key', keys);
      for (const row of data || []) {
        const tid = String(row.setting_key || '').replace(/^task_meta_/, '');
        if (tid && row.setting_value) {
          metaMap.set(tid, row.setting_value);
        }
      }
    } catch {
      // Ignore
    }

    let favSet = new Set<string>();
    const attemptsByTask = new Map<string, number>();

    if (options?.userId) {
      try {
        const favIds = await this.getUserFavoriteTaskIds(options.userId);
        favSet = new Set(favIds);
      } catch {}

      try {
        const { data: slRows, error: slErr } = await db
          .from('smart_link_attempts')
          .select('task_id, status')
          .eq('user_id', options.userId)
          .in('task_id', tasks.map((t) => t.id));
        if (!slErr && Array.isArray(slRows)) {
          for (const r of slRows) {
            if (r.status === 'completed') {
              attemptsByTask.set(r.task_id, (attemptsByTask.get(r.task_id) || 0) + 1);
            }
          }
        } else if (slErr && isMissingSchemaError(slErr)) {
          const allSl = await readSetting<SmartLinkAttempt[]>(KEY_SMART_LINK_ATTEMPTS, []);
          for (const a of allSl) {
            if (a.userId === options.userId && a.status === 'completed') {
              attemptsByTask.set(a.taskId, (attemptsByTask.get(a.taskId) || 0) + 1);
            }
          }
        }
      } catch {}
    }

    return tasks.map((t) => {
      const mirrored = metaMap.get(t.id);
      const rawMergedMeta = sanitizeTaskBuilderMeta(
        {
          ...(t.taskMeta || {}),
          ...(mirrored?.taskMeta || {}),
        },
        mirrored?.virtualCategory || t.category
      );

      if (maskSecrets && rawMergedMeta.fields?.postbackSecret) {
        rawMergedMeta.fields = { ...rawMergedMeta.fields, postbackSecret: undefined };
      }

      const taskKind = rawMergedMeta.taskKind || t.taskKind || inferTaskKindFromCategory(t.category);
      const canonicalKind = toCanonicalTaskKind(taskKind, t.category);
      const isFeatured = Boolean(rawMergedMeta.isFeatured ?? t.isFeatured);
      const effectiveCategory = (
        mirrored?.virtualCategory ||
        (taskKind === 'smart_links' || canonicalKind === 'website_visit' ? 'smart_links' : t.category)
      ) as TaskCategory;

      const defaultOpt = TASK_KIND_OPTIONS.find((o) => o.kind === canonicalKind);
      const imageUrl =
        sanitizeSafeImageUrl(t.imageUrl) ||
        rawMergedMeta.imageUrl ||
        getDefaultTaskImageUrl(taskKind, isFeatured, effectiveCategory);

      const isVerifiedAdvertiser = !t.isExternalCampaign
        ? true
        : Boolean(!t.hideAdvertiserName && t.advertiserDisplayName && t.advertiserDisplayName !== 'معلن عبر يمن تاسك');

      const mergedSteps =
        Array.isArray(t.steps) && t.steps.length > 0
          ? t.steps
          : Array.isArray(mirrored?.steps) && mirrored.steps.length > 0
            ? mirrored.steps
            : rawMergedMeta.fields?.steps || [];

      const mergedProofReqs = normalizeProofRequirements(
        {
          ...(t.proofRequirements || {}),
          ...(mirrored?.proofRequirements && typeof mirrored.proofRequirements === 'object'
            ? mirrored.proofRequirements
            : {}),
        },
        rawMergedMeta,
        taskKind
      );

      return {
        ...t,
        category: effectiveCategory,
        taskKind,
        difficulty: rawMergedMeta.difficulty || t.difficulty || 'easy',
        isFeatured,
        sortOrder: Number(t.sortOrder ?? rawMergedMeta.sortOrder ?? 0),
        imageUrl,
        cardTheme: t.cardTheme || rawMergedMeta.cardTheme || defaultOpt?.defaultTheme || 'emerald',
        badgeLabel: t.badgeLabel || rawMergedMeta.badgeLabel || (isFeatured ? 'مهمة مميزة' : defaultOpt?.defaultBadgeLabel),
        badgeColor: t.badgeColor || rawMergedMeta.badgeColor,
        isVerifiedAdvertiser,
        isFavorited: favSet.has(t.id),
        providerName: t.providerName || rawMergedMeta.fields?.providerName,
        providerLogoUrl: t.providerLogoUrl || rawMergedMeta.fields?.providerLogoUrl,
        trackingUrl: maskSecrets ? undefined : t.trackingUrl || rawMergedMeta.fields?.trackingUrl,
        linkedSurveyId: t.linkedSurveyId || rawMergedMeta.linkedSurveyId || rawMergedMeta.fields?.linkedSurveyId,
        userAttemptsCount: attemptsByTask.get(t.id) || 0,
        steps: mergedSteps,
        proofRequirements: mergedProofReqs,
        timeEstimateMinutes: Number(mirrored?.timeEstimateMinutes ?? t.timeEstimateMinutes ?? 10),
        maxPerUser: Number(mirrored?.maxPerUser ?? t.maxPerUser ?? 1),
        taskMeta: rawMergedMeta,
      };
    });
  },

  // ============================================================================
  // 3. USER TASK FAVORITES (SUPABASE-PERSISTED)
  // ============================================================================

  async getUserFavoriteTaskIds(userId: string): Promise<string[]> {
    const db = getDb();
    try {
      const { data, error } = await db
        .from('task_favorites')
        .select('task_id')
        .eq('user_id', userId);
      if (!error && Array.isArray(data)) {
        return data.map((r: any) => String(r.task_id));
      }
      if (error && !isMissingSchemaError(error)) {
        throw error;
      }
    } catch {
      // Fallback below
    }

    return readSetting<string[]>(`task_favorites_${userId}`, []);
  },

  async toggleUserFavoriteTask(userId: string, taskId: string): Promise<{ isFavorited: boolean; favoriteIds: string[] }> {
    const db = getDb();
    try {
      const { data: existing, error: selErr } = await db
        .from('task_favorites')
        .select('id')
        .eq('user_id', userId)
        .eq('task_id', taskId)
        .maybeSingle();

      if (!selErr) {
        if (existing) {
          await db.from('task_favorites').delete().eq('id', existing.id);
          const favoriteIds = await this.getUserFavoriteTaskIds(userId);
          return { isFavorited: false, favoriteIds };
        } else {
          await db.from('task_favorites').insert({ user_id: userId, task_id: taskId });
          const favoriteIds = await this.getUserFavoriteTaskIds(userId);
          return { isFavorited: true, favoriteIds };
        }
      }
      if (!isMissingSchemaError(selErr)) {
        throw selErr;
      }
    } catch (err: any) {
      if (!isMissingSchemaError(err)) throw err;
    }

    const current = await readSetting<string[]>(`task_favorites_${userId}`, []);
    const exists = current.includes(taskId);
    const next = exists ? current.filter((id) => id !== taskId) : [...current, taskId];
    await writeSetting(`task_favorites_${userId}`, next, 'User task favorites', userId);
    return { isFavorited: !exists, favoriteIds: next };
  },

  // ============================================================================
  // 4. SMART LINKS (CLICK TOKEN LOGGING + POSTBACK-ONLY VERIFIED PAYOUT)
  // ============================================================================

  async startSmartLinkAttempt(params: {
    task: TaskItem;
    userId: string;
  }): Promise<{ attempt: SmartLinkAttempt; launchUrl: string; userAttemptsCount: number }> {
    const db = getDb();
    const { task, userId } = params;

    if (task.status !== 'ACTIVE') {
      throw new Error('الرابط الذكي غير متاح حالياً.');
    }
    const remaining = Math.max(0, Number(task.totalQuantity || 0) - Number(task.completedQuantity || 0));
    if (task.totalQuantity > 0 && remaining <= 0) {
      throw new Error('تم استيفاء الحد الأقصى لهذا العرض.');
    }

    const rawTrackingUrl = task.trackingUrl || task.taskMeta?.fields?.trackingUrl || task.taskMeta?.fields?.offerUrl || '';
    if (!/^https?:\/\/[^\s<>"']+$/i.test(rawTrackingUrl.trim())) {
      throw new Error('رابط التتبع الخاص بمقدم الخدمة غير مضبوط بشكل صحيح.');
    }

    const maxPerUser = Math.max(1, Number(task.maxPerUser || 1));
    const providerName = task.providerName || task.taskMeta?.fields?.providerName || 'SmartLink';

    // Check completed attempts count
    let completedCount = 0;
    try {
      const { data: rows, error } = await db
        .from('smart_link_attempts')
        .select('id, status')
        .eq('task_id', task.id)
        .eq('user_id', userId);
      if (!error && Array.isArray(rows)) {
        completedCount = rows.filter((r: any) => r.status === 'completed').length;
      } else if (error && isMissingSchemaError(error)) {
        const reg = await readSetting<SmartLinkAttempt[]>(KEY_SMART_LINK_ATTEMPTS, []);
        completedCount = reg.filter((a) => a.taskId === task.id && a.userId === userId && a.status === 'completed').length;
      }
    } catch {}

    if (completedCount >= maxPerUser) {
      throw new Error(`لقد وصلت للحد الأقصى للمحاولات (${completedCount}/${maxPerUser}) لهذا الرابط الذكي.`);
    }

    const clickToken = `SL-${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
    const now = new Date().toISOString();
    const attempt: SmartLinkAttempt = {
      id: crypto.randomUUID(),
      taskId: task.id,
      userId,
      providerName,
      clickToken,
      status: 'started',
      rewardYer: Number(task.rewardYer || 0),
      startedAt: now,
    };

    try {
      const { data: ins, error: insErr } = await db
        .from('smart_link_attempts')
        .insert({
          task_id: task.id,
          user_id: userId,
          provider_name: providerName,
          click_token: clickToken,
          status: 'started',
          reward_yer: Number(task.rewardYer || 0),
        })
        .select('*')
        .single();
      if (!insErr && ins) {
        attempt.id = String(ins.id);
        attempt.startedAt = ins.started_at;
      } else if (insErr && !isMissingSchemaError(insErr)) {
        throw insErr;
      } else if (insErr) {
        const reg = await readSetting<SmartLinkAttempt[]>(KEY_SMART_LINK_ATTEMPTS, []);
        await writeSetting(KEY_SMART_LINK_ATTEMPTS, [attempt, ...reg.slice(0, 499)], 'Smart link attempts fallback', userId);
      }
    } catch (err: any) {
      if (!isMissingSchemaError(err)) throw err;
      const reg = await readSetting<SmartLinkAttempt[]>(KEY_SMART_LINK_ATTEMPTS, []);
      await writeSetting(KEY_SMART_LINK_ATTEMPTS, [attempt, ...reg.slice(0, 499)], 'Smart link attempts fallback', userId);
    }

    // Inject tracking parameters cleanly
    let launchUrl = rawTrackingUrl.trim();
    if (launchUrl.includes('{click_token}') || launchUrl.includes('{click_id}') || launchUrl.includes('{user_id}')) {
      launchUrl = launchUrl
        .replace(/\{click_token\}/g, encodeURIComponent(clickToken))
        .replace(/\{click_id\}/g, encodeURIComponent(clickToken))
        .replace(/\{user_id\}/g, encodeURIComponent(userId))
        .replace(/\{task_id\}/g, encodeURIComponent(task.id));
    } else {
      try {
        const parsed = new URL(launchUrl);
        parsed.searchParams.set('click_id', clickToken);
        parsed.searchParams.set('user_id', userId);
        parsed.searchParams.set('task_id', task.id);
        launchUrl = parsed.toString();
      } catch {
        // Use original URL if non-standard URL format
      }
    }

    return { attempt, launchUrl, userAttemptsCount: completedCount };
  },

  async handleSmartLinkPostback(params: {
    secret?: string;
    clickToken?: string;
    externalTxId?: string;
    userId?: string;
    taskId?: string;
    rewardYer?: number | string;
    status?: string;
    rawPayload?: Record<string, any>;
  }): Promise<{ ok: boolean; duplicate?: boolean; ignored?: boolean; message: string; transactionId?: string }> {
    const db = getSupabaseAdminClient();
    const cleanExtTx = String(params.externalTxId || '').trim();
    const cleanToken = String(params.clickToken || '').trim();
    const rawStatus = String(params.status || '1').trim().toLowerCase();

    if (!cleanExtTx) {
      throw new Error('معرف المعاملة الخارجي (tx_id) مطلوب للتحقق.');
    }

    if (['0', '2', 'rejected', 'reversed', 'chargeback', 'failed', 'cancelled'].includes(rawStatus)) {
      return { ok: true, ignored: true, message: 'Postback ignored for non-approved status.' };
    }

    // Resolve attempt/task/user BEFORE verifying task-specific secret
    let resolvedTaskId = params.taskId ? String(params.taskId).trim() : '';
    let resolvedUserId = params.userId ? String(params.userId).trim() : '';

    if (cleanToken && (!resolvedTaskId || !resolvedUserId)) {
      try {
        const { data: attRow, error } = await db
          .from('smart_link_attempts')
          .select('task_id, user_id')
          .eq('click_token', cleanToken)
          .maybeSingle();
        if (!error && attRow) {
          resolvedTaskId = resolvedTaskId || attRow.task_id;
          resolvedUserId = resolvedUserId || attRow.user_id;
        } else if (error && isMissingSchemaError(error)) {
          const reg = await readSetting<SmartLinkAttempt[]>(KEY_SMART_LINK_ATTEMPTS, []);
          const found = reg.find((a) => a.clickToken === cleanToken);
          if (found) {
            resolvedTaskId = resolvedTaskId || found.taskId;
            resolvedUserId = resolvedUserId || found.userId;
          }
        }
      } catch {}
    }

    if (!resolvedTaskId || !resolvedUserId) {
      throw new Error('لم يتم العثور على جلسة النقر أو المستخدم المستهدف.');
    }

    // Load task raw row + unmasked meta to verify postback_secret
    const { data: taskRow, error: taskErr } = await db
      .from('tasks')
      .select('*')
      .eq('id', resolvedTaskId)
      .maybeSingle();
    if (taskErr || !taskRow) {
      throw new Error('المهمة غير موجودة.');
    }

    const mirrorMeta = await readSetting<any>(`task_meta_${resolvedTaskId}`, null);
    const expectedSecret = String(
      taskRow.postback_secret ||
      mirrorMeta?.taskMeta?.fields?.postbackSecret ||
      taskRow.proof_requirements?._taskMeta?.fields?.postbackSecret ||
      process.env.SMART_LINK_POSTBACK_SECRET ||
      ''
    ).trim();

    const providedSecret = String(params.secret || '').trim();
    if (!expectedSecret || !providedSecret) {
      throw new Error('FORBIDDEN: توقيع التحقق السري (secret) مفقود.');
    }
    const aBuf = Buffer.from(expectedSecret);
    const bBuf = Buffer.from(providedSecret);
    if (aBuf.length !== bBuf.length || !crypto.timingSafeEqual(aBuf, bBuf)) {
      throw new Error('FORBIDDEN: توقيع التحقق السري (secret) غير مطابق.');
    }

    const parsedReward =
      params.rewardYer !== undefined && params.rewardYer !== null && String(params.rewardYer).trim() !== ''
        ? parseMoneyStrict(params.rewardYer, { allowNegative: false, allowZero: false, fieldLabel: 'المكافأة' })
        : parseMoneyStrict(taskRow.reward_units, { allowNegative: false, allowZero: false, fieldLabel: 'المكافأة' });

    // Primary: Atomic RPC from Migration 035
    try {
      const { data: rpcRes, error: rpcErr } = await db.rpc('process_smart_link_postback', {
        p_external_tx_id: cleanExtTx,
        p_click_token: cleanToken || null,
        p_user_id: resolvedUserId,
        p_task_id: resolvedTaskId,
        p_reward_yer: parsedReward,
        p_payload: params.rawPayload || {},
      });

      if (!rpcErr && rpcRes) {
        if (!rpcRes.duplicate) {
          await this.notifySmartLinkReward({
            userId: resolvedUserId,
            taskTitle: taskRow.title,
            rewardYer: parsedReward,
          });
        }
        return {
          ok: true,
          duplicate: Boolean(rpcRes.duplicate),
          transactionId: rpcRes.transaction_id ? String(rpcRes.transaction_id) : undefined,
          message: rpcRes.duplicate ? 'Duplicate postback already credited.' : 'Reward credited via verified postback.',
        };
      }
      if (rpcErr && !isMissingSchemaError(rpcErr)) {
        throw new Error(rpcErr.message);
      }
    } catch (err: any) {
      if (!isMissingSchemaError(err)) throw err;
    }

    // Fallback (Pre-035): Idempotent payout via existing canonical post_ledger_transaction RPC
    const reg = await readSetting<SmartLinkAttempt[]>(KEY_SMART_LINK_ATTEMPTS, []);
    const alreadyDone = reg.find((a) => a.externalTxId === cleanExtTx && a.status === 'completed');
    if (alreadyDone) {
      return {
        ok: true,
        duplicate: true,
        transactionId: alreadyDone.rewardTransactionId || undefined,
        message: 'Duplicate postback already credited.',
      };
    }

    const { walletFinancialAccountId } = await ensureUserWalletAndFinancialAccount(db, resolvedUserId);
    const sourceAccId = await resolveTreasuryOrEscrowSource(db, taskRow.escrow_account_id, parsedReward);

    const { data: txId, error: postErr } = await db.rpc('post_ledger_transaction', {
      p_transaction_type: 'TASK_REWARD_PAYOUT',
      p_idempotency_key: `SMARTLINK:${cleanExtTx}`,
      p_reference: `SMARTLINK:${resolvedTaskId}`,
      p_metadata: {
        task_id: resolvedTaskId,
        task_title: taskRow.title,
        performer_user_id: resolvedUserId,
        external_tx_id: cleanExtTx,
        click_token: cleanToken,
        reward_yer: parsedReward,
        source: 'smart_link_postback',
      },
      p_entries: [
        { account_id: sourceAccId, side: 'debit', amount_units: parsedReward, memo: `صرف مكافأة رابط ذكي: ${taskRow.title}` },
        { account_id: walletFinancialAccountId, side: 'credit', amount_units: parsedReward, memo: `مكافأة رابط ذكي: ${taskRow.title}` },
      ],
    });

    if (postErr) {
      await logSupabaseError({
        err: postErr,
        operation: 'SMART_LINK_POSTBACK_LEDGER',
        sourceTable: 'ledger_transactions',
      });
      throw new Error(postErr.message || 'فشل قيد مكافأة الرابط الذكي في الدفتر.');
    }

    const nextApproved = Number(taskRow.approved_count || 0) + 1;
    const nextSpent = roundYer6(Number(taskRow.budget_spent_yer || 0) + parsedReward);
    const slots = Number(taskRow.slots || 0);
    await db
      .from('tasks')
      .update({
        approved_count: nextApproved,
        budget_spent_yer: nextSpent,
        ...(slots > 0 && nextApproved >= slots ? { status: 'completed' } : {}),
      })
      .eq('id', resolvedTaskId);

    const now = new Date().toISOString();
    const matchedIdx = cleanToken ? reg.findIndex((a) => a.clickToken === cleanToken) : -1;
    if (matchedIdx >= 0) {
      reg[matchedIdx] = {
        ...reg[matchedIdx],
        status: 'completed',
        externalTxId: cleanExtTx,
        rewardYer: parsedReward,
        rewardTransactionId: String(txId),
        completedAt: now,
      };
    } else {
      reg.unshift({
        id: crypto.randomUUID(),
        taskId: resolvedTaskId,
        userId: resolvedUserId,
        providerName: mirrorMeta?.taskMeta?.fields?.providerName || 'SmartLink',
        clickToken: cleanToken || `DIRECT-${cleanExtTx}`,
        status: 'completed',
        externalTxId: cleanExtTx,
        rewardYer: parsedReward,
        rewardTransactionId: String(txId),
        startedAt: now,
        completedAt: now,
      });
    }
    await writeSetting(KEY_SMART_LINK_ATTEMPTS, reg.slice(0, 500), 'Smart link attempts fallback');

    await this.notifySmartLinkReward({
      userId: resolvedUserId,
      taskTitle: taskRow.title,
      rewardYer: parsedReward,
    });

    return {
      ok: true,
      duplicate: false,
      transactionId: String(txId),
      message: 'Reward credited via verified postback.',
    };
  },

  async notifySmartLinkReward(params: { userId: string; taskTitle: string; rewardYer: number }) {
    const db = getDb();
    const title = 'تم تأكيد مكافأة الرابط الذكي!';
    const message = `تم قيد ${formatYer(params.rewardYer)} ر.ي في محفظتك بعد تأكيد العرض "${params.taskTitle}".`;
    try {
      await db.from('notifications').insert({
        user_id: params.userId,
        title,
        message,
        type: 'TASK_REWARD',
        link: '/wallet',
        is_read: false,
      });
    } catch {}
    sendWebPushToUser(params.userId, { title, body: message, url: '/wallet' }).catch(() => {});
  },

  // ============================================================================
  // 5. SEQUENTIAL SURVEYS & ADMIN BUILDER (DUAL RELATIONAL + JSONB PERSISTENCE)
  // ============================================================================

  async listSurveys(options?: { userId?: string; includeDrafts?: boolean }): Promise<SurveyItem[]> {
    const db = getDb();
    let surveys: SurveyItem[] = [];

    try {
      let q = db
        .from('surveys')
        .select('*')
        .order('is_featured', { ascending: false })
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: false });

      if (!options?.includeDrafts) {
        q = q.eq('status', 'active');
      }

      const { data: surveyRows, error: surveyErr } = await q;
      if (!surveyErr && Array.isArray(surveyRows)) {
        const ids = surveyRows.map((s: any) => s.id);
        const questionsBySurvey = new Map<string, SurveyQuestion[]>();

        if (ids.length > 0) {
          const { data: qRows } = await db
            .from('survey_questions')
            .select('*')
            .in('survey_id', ids)
            .order('order_index', { ascending: true });

          const qIds = (qRows || []).map((r: any) => r.id);
          const optionsByQ = new Map<string, SurveyOption[]>();
          if (qIds.length > 0) {
            const { data: oRows } = await db
              .from('survey_options')
              .select('*')
              .in('question_id', qIds)
              .order('order_index', { ascending: true });
            for (const o of oRows || []) {
              const arr = optionsByQ.get(o.question_id) || [];
              arr.push({
                id: String(o.id),
                questionId: String(o.question_id),
                orderIndex: Number(o.order_index || 0),
                optionText: o.option_text,
                nextQuestionId: o.next_question_id || null,
              });
              optionsByQ.set(o.question_id, arr);
            }
          }

          for (const qr of qRows || []) {
            const arr = questionsBySurvey.get(qr.survey_id) || [];
            arr.push({
              id: String(qr.id),
              surveyId: String(qr.survey_id),
              orderIndex: Number(qr.order_index || 0),
              questionText: qr.question_text,
              questionType: qr.question_type,
              isRequired: qr.is_required !== false,
              imageUrl: sanitizeSafeImageUrl(qr.image_url) || null,
              options: optionsByQ.get(qr.id) || [],
              branchRules: Array.isArray(qr.branch_rules) ? qr.branch_rules : [],
            });
            questionsBySurvey.set(qr.survey_id, arr);
          }
        }

        surveys = surveyRows.map((s: any) => ({
          id: String(s.id),
          linkedTaskId: s.linked_task_id || null,
          title: s.title,
          description: s.description || '',
          imageUrl: s.image_url || SUPABASE_TASK_ASSET_URLS.surveys,
          rewardYer: roundYer6(Number(s.reward_yer || 0)),
          estimatedMinutes: Number(s.estimated_minutes || 5),
          maxParticipants: Number(s.max_participants || 100),
          completedParticipants: Number(s.completed_participants || 0),
          maxAttemptsPerUser: Number(s.max_attempts_per_user || 1),
          status: s.status || 'active',
          isFeatured: Boolean(s.is_featured),
          sortOrder: Number(s.sort_order || 0),
          questions: questionsBySurvey.get(s.id) || [],
          createdAt: s.created_at,
          updatedAt: s.updated_at,
        }));
      } else if (surveyErr && !isMissingSchemaError(surveyErr)) {
        throw surveyErr;
      } else if (surveyErr) {
        const reg = await readSetting<SurveyItem[]>(KEY_SURVEYS_REGISTRY, []);
        surveys = options?.includeDrafts ? reg : reg.filter((s) => s.status === 'active');
      }
    } catch (err: any) {
      if (!isMissingSchemaError(err)) throw err;
      const reg = await readSetting<SurveyItem[]>(KEY_SURVEYS_REGISTRY, []);
      surveys = options?.includeDrafts ? reg : reg.filter((s) => s.status === 'active');
    }

    if (options?.userId && surveys.length > 0) {
      const attemptsMap = await this.getUserSurveyAttemptsMap(options.userId, surveys.map((s) => s.id));
      surveys = surveys.map((s) => {
        const userAttempts = attemptsMap.get(s.id) || [];
        const activeAttempt = userAttempts.find((a) => a.status === 'in_progress') || null;
        const completedCount = userAttempts.filter((a) => a.status === 'submitted' || a.status === 'rewarded').length;
        return {
          ...s,
          userAttemptsCount: completedCount,
          userCompleted: completedCount >= Math.max(1, s.maxAttemptsPerUser || 1),
          activeAttempt,
        };
      });
    }

    return surveys.sort((a, b) => {
      const featDiff = Number(b.isFeatured) - Number(a.isFeatured);
      if (featDiff !== 0) return featDiff;
      const sortDiff = Number(a.sortOrder || 0) - Number(b.sortOrder || 0);
      if (sortDiff !== 0) return sortDiff;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  },

  async getSurveyById(surveyId: string, userId?: string): Promise<SurveyItem | null> {
    const all = await this.listSurveys({ userId, includeDrafts: true });
    return all.find((s) => s.id === surveyId) || null;
  },

  async getUserSurveyAttemptsMap(userId: string, surveyIds: string[]): Promise<Map<string, SurveyAttempt[]>> {
    const db = getDb();
    const map = new Map<string, SurveyAttempt[]>();

    try {
      const { data: attempts, error } = await db
        .from('survey_attempts')
        .select('*')
        .eq('user_id', userId)
        .in('survey_id', surveyIds)
        .order('attempt_number', { ascending: false });

      if (!error && Array.isArray(attempts)) {
        const attIds = attempts.map((a: any) => a.id);
        const ansByAttempt = new Map<string, Record<string, any>>();
        if (attIds.length > 0) {
          const { data: ansRows } = await db
            .from('survey_answers')
            .select('attempt_id, question_id, answer_value')
            .in('attempt_id', attIds);
          for (const ar of ansRows || []) {
            const obj = ansByAttempt.get(ar.attempt_id) || {};
            obj[ar.question_id] = ar.answer_value;
            ansByAttempt.set(ar.attempt_id, obj);
          }
        }
        for (const a of attempts) {
          const arr = map.get(a.survey_id) || [];
          arr.push({
            id: String(a.id),
            surveyId: String(a.survey_id),
            userId: String(a.user_id),
            attemptNumber: Number(a.attempt_number || 1),
            status: a.status,
            currentQuestionIndex: Number(a.current_question_index || 0),
            answers: ansByAttempt.get(a.id) || {},
            rewardTransactionId: a.reward_transaction_id || null,
            startedAt: a.started_at,
            submittedAt: a.submitted_at || null,
          });
          map.set(a.survey_id, arr);
        }
        return map;
      }
      if (error && !isMissingSchemaError(error)) {
        throw error;
      }
    } catch {}

    const reg = await readSetting<SurveyAttempt[]>(`survey_attempts_${userId}`, []);
    for (const a of reg) {
      if (surveyIds.includes(a.surveyId)) {
        const arr = map.get(a.surveyId) || [];
        arr.push(a);
        map.set(a.surveyId, arr);
      }
    }
    return map;
  },

  async adminSaveSurvey(
    payload: {
      id?: string;
      linkedTaskId?: string | null;
      title: string;
      description?: string;
      imageUrl?: string | null;
      rewardYer: number;
      estimatedMinutes?: number;
      maxParticipants?: number;
      maxAttemptsPerUser?: number;
      status?: 'draft' | 'active' | 'paused' | 'completed';
      isFeatured?: boolean;
      sortOrder?: number;
      questions: Array<{
        id?: string;
        questionText: string;
        questionType: SurveyQuestionType;
        isRequired?: boolean;
        imageUrl?: string | null;
        options?: Array<{ id?: string; optionText: string; nextQuestionId?: string | null }>;
        branchRules?: any[];
      }>;
    },
    actorId?: string | null
  ): Promise<SurveyItem> {
    const title = String(payload.title || '').trim();
    if (!title) throw new Error('عنوان الاستبيان مطلوب.');

    const rewardYer =
      Number(payload.rewardYer || 0) === 0
        ? 0
        : parseMoneyStrict(payload.rewardYer, { allowNegative: false, allowZero: true, fieldLabel: 'مكافأة الاستبيان' });

    const rawQuestions = Array.isArray(payload.questions) ? payload.questions : [];
    if (rawQuestions.length === 0) {
      throw new Error('يجب إضافة سؤال واحد على الأقل داخل الاستبيان.');
    }

    const surveyId = payload.id && /^[0-9a-f-]{36}$/i.test(payload.id) ? payload.id : crypto.randomUUID();
    const now = new Date().toISOString();

    // Pre-assign stable UUIDs so branching links (tempId -> UUID) stay valid
    const idMap = new Map<string, string>();
    const preparedQuestions: SurveyQuestion[] = rawQuestions.map((q, idx) => {
      const incomingId = q.id ? String(q.id) : `tmp_${idx}`;
      const realId = /^[0-9a-f-]{36}$/i.test(incomingId) ? incomingId : crypto.randomUUID();
      idMap.set(incomingId, realId);
      const qType: SurveyQuestionType = VALID_QUESTION_TYPES.includes(q.questionType)
        ? q.questionType
        : 'single_choice';

      let rawOpts = Array.isArray(q.options) ? q.options.filter((o) => String(o.optionText || '').trim()) : [];
      if (qType === 'yes_no' && rawOpts.length === 0) {
        rawOpts = [{ optionText: 'نعم' }, { optionText: 'لا' }];
      }

      const opts: SurveyOption[] = rawOpts.map((o, oIdx) => ({
        id: o.id && /^[0-9a-f-]{36}$/i.test(o.id) ? o.id : crypto.randomUUID(),
        questionId: realId,
        orderIndex: oIdx,
        optionText: String(o.optionText).trim().slice(0, 300),
        nextQuestionId: o.nextQuestionId || null,
      }));

      return {
        id: realId,
        surveyId,
        orderIndex: idx,
        questionText: String(q.questionText || '').trim(),
        questionType: qType,
        isRequired: q.isRequired !== false,
        imageUrl: sanitizeSafeImageUrl(q.imageUrl) || null,
        options: opts,
        branchRules: Array.isArray(q.branchRules) ? q.branchRules : [],
      };
    });

    if (preparedQuestions.some((q) => !q.questionText)) {
      throw new Error('نص جميع الأسئلة مطلوب ولا يمكن ترك سؤال فارغ.');
    }

    // Remap temp nextQuestionId references
    for (const q of preparedQuestions) {
      q.options = q.options.map((o) => ({
        ...o,
        nextQuestionId:
          o.nextQuestionId === 'END'
            ? 'END'
            : o.nextQuestionId
              ? idMap.get(o.nextQuestionId) || o.nextQuestionId
              : null,
      }));
      q.branchRules = (q.branchRules || []).map((r: any) => ({
        ...r,
        nextQuestionId:
          r.nextQuestionId === 'END'
            ? 'END'
            : r.nextQuestionId
              ? idMap.get(r.nextQuestionId) || r.nextQuestionId
              : null,
      }));
    }

    const surveyObj: SurveyItem = {
      id: surveyId,
      linkedTaskId: payload.linkedTaskId || null,
      title,
      description: String(payload.description || '').trim(),
      imageUrl: sanitizeSafeImageUrl(payload.imageUrl) || SUPABASE_TASK_ASSET_URLS.surveys,
      rewardYer,
      estimatedMinutes: Math.max(1, Math.round(Number(payload.estimatedMinutes || 5))),
      maxParticipants: Math.max(1, Math.round(Number(payload.maxParticipants || 100))),
      completedParticipants: 0,
      maxAttemptsPerUser: Math.max(1, Math.round(Number(payload.maxAttemptsPerUser || 1))),
      status: payload.status || 'active',
      isFeatured: Boolean(payload.isFeatured),
      sortOrder: Math.round(Number(payload.sortOrder || 0)),
      questions: preparedQuestions,
      createdAt: now,
      updatedAt: now,
    };

    const db = getDb();
    try {
      const { data: existingSurvey, error: selErr } = await db
        .from('surveys')
        .select('id, completed_participants, created_at')
        .eq('id', surveyId)
        .maybeSingle();

      if (!selErr) {
        if (existingSurvey) {
          surveyObj.completedParticipants = Number(existingSurvey.completed_participants || 0);
          surveyObj.createdAt = existingSurvey.created_at;
        }

        const { error: upErr } = await db.from('surveys').upsert(
          {
            id: surveyId,
            linked_task_id: surveyObj.linkedTaskId,
            title: surveyObj.title,
            description: surveyObj.description,
            image_url: surveyObj.imageUrl,
            reward_yer: surveyObj.rewardYer,
            estimated_minutes: surveyObj.estimatedMinutes,
            max_participants: surveyObj.maxParticipants,
            max_attempts_per_user: surveyObj.maxAttemptsPerUser,
            status: surveyObj.status,
            is_featured: surveyObj.isFeatured,
            sort_order: surveyObj.sortOrder,
            created_by: actorId || null,
            updated_at: now,
          },
          { onConflict: 'id' }
        );
        if (upErr) throw upErr;

        // Replace questions & options cleanly (insert questions first so FK self-refs work)
        await db.from('survey_questions').delete().eq('survey_id', surveyId);

        const qInserts = preparedQuestions.map((q) => ({
          id: q.id,
          survey_id: surveyId,
          order_index: q.orderIndex,
          question_text: q.questionText,
          question_type: q.questionType,
          is_required: q.isRequired,
          branch_rules: q.branchRules || [],
        }));
        const { error: qInsErr } = await db.from('survey_questions').insert(qInserts);
        if (qInsErr) throw qInsErr;

        const validQuestionIds = new Set(preparedQuestions.map((q) => q.id));
        const optInserts = preparedQuestions.flatMap((q) =>
          q.options.map((o) => ({
            id: o.id,
            question_id: q.id,
            order_index: o.orderIndex,
            option_text: o.optionText,
            next_question_id:
              o.nextQuestionId && o.nextQuestionId !== 'END' && validQuestionIds.has(o.nextQuestionId)
                ? o.nextQuestionId
                : null,
          }))
        );
        if (optInserts.length > 0) {
          const { error: optErr } = await db.from('survey_options').insert(optInserts);
          if (optErr) throw optErr;
        }
        return surveyObj;
      }
      if (!isMissingSchemaError(selErr)) throw selErr;
    } catch (err: any) {
      if (!isMissingSchemaError(err)) throw err;
    }

    // Fallback: Supabase platform_settings surveys_registry
    const reg = await readSetting<SurveyItem[]>(KEY_SURVEYS_REGISTRY, []);
    const idx = reg.findIndex((s) => s.id === surveyId);
    if (idx >= 0) {
      surveyObj.completedParticipants = reg[idx].completedParticipants || 0;
      surveyObj.createdAt = reg[idx].createdAt || now;
      reg[idx] = surveyObj;
    } else {
      reg.unshift(surveyObj);
    }
    await writeSetting(KEY_SURVEYS_REGISTRY, reg, 'Sequential surveys registry fallback', actorId);
    return surveyObj;
  },

  async adminDeleteSurvey(surveyId: string, actorId?: string | null): Promise<void> {
    const db = getDb();
    try {
      const { error } = await db.from('surveys').delete().eq('id', surveyId);
      if (error && !isMissingSchemaError(error)) {
        throw new Error(error.message);
      }
    } catch (err: any) {
      if (!isMissingSchemaError(err)) throw err;
    }

    const reg = await readSetting<SurveyItem[]>(KEY_SURVEYS_REGISTRY, []);
    if (reg.some((s) => s.id === surveyId)) {
      await writeSetting(
        KEY_SURVEYS_REGISTRY,
        reg.filter((s) => s.id !== surveyId),
        'Sequential surveys registry fallback',
        actorId
      );
    }
  },

  async startOrResumeSurveyAttempt(surveyId: string, userId: string): Promise<{ survey: SurveyItem; attempt: SurveyAttempt }> {
    const survey = await this.getSurveyById(surveyId, userId);
    if (!survey) throw new Error('الاستبيان المطلوب غير موجود.');
    if (survey.status !== 'active') throw new Error('هذا الاستبيان غير نشط حالياً.');
    if (survey.maxParticipants > 0 && survey.completedParticipants >= survey.maxParticipants) {
      throw new Error('اكتمل العدد المطلوب من المشاركين في هذا الاستبيان.');
    }

    const attemptsMap = await this.getUserSurveyAttemptsMap(userId, [surveyId]);
    const existingList = attemptsMap.get(surveyId) || [];
    const inProgress = existingList.find((a) => a.status === 'in_progress');
    if (inProgress) {
      return { survey, attempt: inProgress };
    }

    const completedCount = existingList.filter((a) => a.status === 'submitted' || a.status === 'rewarded').length;
    const maxAttempts = Math.max(1, Number(survey.maxAttemptsPerUser || 1));
    if (completedCount >= maxAttempts) {
      throw new Error('لقد أكملت هذا الاستبيان مسبقاً ولا يمكنك إعادة إرساله.');
    }

    const now = new Date().toISOString();
    const attempt: SurveyAttempt = {
      id: crypto.randomUUID(),
      surveyId,
      userId,
      attemptNumber: existingList.length + 1,
      status: 'in_progress',
      currentQuestionIndex: 0,
      answers: {},
      startedAt: now,
    };

    const db = getDb();
    try {
      const { data: ins, error } = await db
        .from('survey_attempts')
        .insert({
          id: attempt.id,
          survey_id: surveyId,
          user_id: userId,
          attempt_number: attempt.attemptNumber,
          status: 'in_progress',
          current_question_index: 0,
        })
        .select('*')
        .single();
      if (!error && ins) {
        attempt.id = String(ins.id);
        return { survey, attempt };
      }
      if (error && !isMissingSchemaError(error)) throw error;
    } catch (err: any) {
      if (!isMissingSchemaError(err)) throw err;
    }

    const userAttempts = await readSetting<SurveyAttempt[]>(`survey_attempts_${userId}`, []);
    await writeSetting(`survey_attempts_${userId}`, [attempt, ...userAttempts], 'User survey attempts', userId);
    return { survey, attempt };
  },

  async saveSurveyAttemptProgress(
    attemptId: string,
    userId: string,
    payload: { currentQuestionIndex: number; answers: Record<string, any> }
  ): Promise<SurveyAttempt> {
    const db = getDb();
    const cleanIdx = Math.max(0, Math.round(Number(payload.currentQuestionIndex || 0)));
    const cleanAnswers = payload.answers && typeof payload.answers === 'object' ? payload.answers : {};

    try {
      const { data: existing, error: selErr } = await db
        .from('survey_attempts')
        .select('*')
        .eq('id', attemptId)
        .eq('user_id', userId)
        .maybeSingle();

      if (!selErr && existing) {
        if (existing.status !== 'in_progress') {
          throw new Error('لا يمكن تعديل محاولة تم إرسالها مسبقاً.');
        }
        await db
          .from('survey_attempts')
          .update({ current_question_index: cleanIdx, updated_at: new Date().toISOString() })
          .eq('id', attemptId);

        const upserts = Object.entries(cleanAnswers).map(([questionId, val]) => ({
          attempt_id: attemptId,
          question_id: questionId,
          answer_value: val,
          updated_at: new Date().toISOString(),
        }));
        if (upserts.length > 0) {
          await db.from('survey_answers').upsert(upserts, { onConflict: 'attempt_id,question_id' });
        }

        return {
          id: String(existing.id),
          surveyId: String(existing.survey_id),
          userId: String(existing.user_id),
          attemptNumber: Number(existing.attempt_number || 1),
          status: existing.status,
          currentQuestionIndex: cleanIdx,
          answers: cleanAnswers,
          startedAt: existing.started_at,
        };
      }
      if (selErr && !isMissingSchemaError(selErr)) throw selErr;
    } catch (err: any) {
      if (!isMissingSchemaError(err)) throw err;
    }

    const reg = await readSetting<SurveyAttempt[]>(`survey_attempts_${userId}`, []);
    const idx = reg.findIndex((a) => a.id === attemptId && a.userId === userId);
    if (idx === -1) throw new Error('محاولة الاستبيان غير موجودة.');
    if (reg[idx].status !== 'in_progress') throw new Error('لا يمكن تعديل محاولة تم إرسالها مسبقاً.');

    reg[idx] = {
      ...reg[idx],
      currentQuestionIndex: cleanIdx,
      answers: { ...reg[idx].answers, ...cleanAnswers },
    };
    await writeSetting(`survey_attempts_${userId}`, reg, 'User survey attempts', userId);
    return reg[idx];
  },

  async submitSurveyAttempt(
    attemptId: string,
    userId: string
  ): Promise<{ ok: boolean; duplicate?: boolean; rewardYer: number; transactionId?: string }> {
    const db = getSupabaseAdminClient();

    // Load attempt from DB or fallback
    let attempt: SurveyAttempt | null = null;
    let useFallback = false;

    try {
      const { data: attRow, error: attErr } = await db
        .from('survey_attempts')
        .select('*')
        .eq('id', attemptId)
        .eq('user_id', userId)
        .maybeSingle();

      if (!attErr && attRow) {
        const { data: ansRows } = await db
          .from('survey_answers')
          .select('question_id, answer_value')
          .eq('attempt_id', attemptId);
        const answers: Record<string, any> = {};
        for (const r of ansRows || []) answers[r.question_id] = r.answer_value;

        attempt = {
          id: String(attRow.id),
          surveyId: String(attRow.survey_id),
          userId: String(attRow.user_id),
          attemptNumber: Number(attRow.attempt_number || 1),
          status: attRow.status,
          currentQuestionIndex: Number(attRow.current_question_index || 0),
          answers,
          rewardTransactionId: attRow.reward_transaction_id || null,
          startedAt: attRow.started_at,
          submittedAt: attRow.submitted_at || null,
        };
      } else if (attErr && isMissingSchemaError(attErr)) {
        useFallback = true;
      }
    } catch (err: any) {
      if (isMissingSchemaError(err)) useFallback = true;
      else throw err;
    }

    if (useFallback || !attempt) {
      const reg = await readSetting<SurveyAttempt[]>(`survey_attempts_${userId}`, []);
      attempt = reg.find((a) => a.id === attemptId && a.userId === userId) || null;
    }

    if (!attempt) {
      throw new Error('جلسة الاستبيان غير موجودة.');
    }
    if (attempt.status === 'rewarded' || attempt.status === 'submitted') {
      return {
        ok: true,
        duplicate: true,
        rewardYer: 0,
        transactionId: attempt.rewardTransactionId || undefined,
      };
    }

    const survey = await this.getSurveyById(attempt.surveyId, userId);
    if (!survey) throw new Error('الاستبيان غير موجود.');
    if (survey.status !== 'active') throw new Error('الاستبيان متوقف حالياً.');
    if (survey.maxParticipants > 0 && survey.completedParticipants >= survey.maxParticipants) {
      throw new Error('اكتمل عدد المشاركين المسموح به في هذا الاستبيان.');
    }

    // Enforce required questions along the active conditional branch
    const { missingRequiredQuestions } = evaluateSurveyPath(survey.questions, attempt.answers);
    if (missingRequiredQuestions.length > 0) {
      throw new Error(`يرجى الإجابة على السؤال الإلزامي: "${missingRequiredQuestions[0].questionText}"`);
    }

    const rewardYer = roundYer6(Number(survey.rewardYer || 0));

    // Primary: Atomic RPC from Migration 035
    if (!useFallback) {
      try {
        const { data: rpcRes, error: rpcErr } = await db.rpc('submit_survey_completion', {
          p_attempt_id: attemptId,
          p_user_id: userId,
        });
        if (!rpcErr && rpcRes) {
          if (!rpcRes.duplicate && rewardYer > 0) {
            await this.notifySurveyReward({ userId, surveyTitle: survey.title, rewardYer });
          }
          return {
            ok: true,
            duplicate: Boolean(rpcRes.duplicate),
            rewardYer: Number(rpcRes.reward_yer ?? rewardYer),
            transactionId: rpcRes.transaction_id ? String(rpcRes.transaction_id) : undefined,
          };
        }
        if (rpcErr && !isMissingSchemaError(rpcErr)) {
          throw new Error(rpcErr.message);
        }
      } catch (err: any) {
        if (!isMissingSchemaError(err)) throw err;
      }
    }

    // Fallback: Post atomic ledger reward via canonical post_ledger_transaction RPC
    let txId: string | undefined;
    if (rewardYer > 0) {
      const { walletFinancialAccountId } = await ensureUserWalletAndFinancialAccount(db, userId);
      const sourceAccId = await resolveTreasuryOrEscrowSource(db, null, rewardYer);

      const { data: postedTxId, error: postErr } = await db.rpc('post_ledger_transaction', {
        p_transaction_type: 'TASK_REWARD_PAYOUT',
        p_idempotency_key: `SURVEY-REWARD:${attemptId}`,
        p_reference: `SURVEY:${survey.id}`,
        p_metadata: {
          survey_id: survey.id,
          survey_title: survey.title,
          attempt_id: attemptId,
          performer_user_id: userId,
          reward_yer: rewardYer,
          source: 'survey_completion',
        },
        p_entries: [
          { account_id: sourceAccId, side: 'debit', amount_units: rewardYer, memo: `صرف مكافأة استبيان: ${survey.title}` },
          { account_id: walletFinancialAccountId, side: 'credit', amount_units: rewardYer, memo: `مكافأة إتمام استبيان: ${survey.title}` },
        ],
      });
      if (postErr) {
        throw new Error(postErr.message || 'تعذر قيد مكافأة الاستبيان في الدفتر.');
      }
      txId = String(postedTxId);
    }

    const now = new Date().toISOString();
    const attemptsReg = await readSetting<SurveyAttempt[]>(`survey_attempts_${userId}`, []);
    const aIdx = attemptsReg.findIndex((a) => a.id === attemptId);
    if (aIdx >= 0) {
      attemptsReg[aIdx] = {
        ...attemptsReg[aIdx],
        status: rewardYer > 0 ? 'rewarded' : 'submitted',
        rewardTransactionId: txId || null,
        submittedAt: now,
      };
      await writeSetting(`survey_attempts_${userId}`, attemptsReg, 'User survey attempts', userId);
    }

    const surveysReg = await readSetting<SurveyItem[]>(KEY_SURVEYS_REGISTRY, []);
    const sIdx = surveysReg.findIndex((s) => s.id === survey.id);
    if (sIdx >= 0) {
      const nextCount = Number(surveysReg[sIdx].completedParticipants || 0) + 1;
      surveysReg[sIdx] = {
        ...surveysReg[sIdx],
        completedParticipants: nextCount,
        status:
          surveysReg[sIdx].maxParticipants > 0 && nextCount >= surveysReg[sIdx].maxParticipants
            ? 'completed'
            : surveysReg[sIdx].status,
        updatedAt: now,
      };
      await writeSetting(KEY_SURVEYS_REGISTRY, surveysReg, 'Sequential surveys registry fallback');
    }

    if (rewardYer > 0) {
      await this.notifySurveyReward({ userId, surveyTitle: survey.title, rewardYer });
    }

    return { ok: true, duplicate: false, rewardYer, transactionId: txId };
  },

  async notifySurveyReward(params: { userId: string; surveyTitle: string; rewardYer: number }) {
    const db = getDb();
    const title = 'تم استلام مكافأة الاستبيان!';
    const message = `تم قيد ${formatYer(params.rewardYer)} ر.ي في محفظتك لإتمام استبيان "${params.surveyTitle}".`;
    try {
      await db.from('notifications').insert({
        user_id: params.userId,
        title,
        message,
        type: 'TASK_REWARD',
        link: '/wallet',
        is_read: false,
      });
    } catch {}
    sendWebPushToUser(params.userId, { title, body: message, url: '/wallet' }).catch(() => {});
  },

  // ============================================================================
  // 6. VERIFIED EXECUTION SESSIONS (VIDEO WATCH & WEBSITE VISIT ANTI-CHEAT)
  // ============================================================================

  async startExecutionSession(params: {
    task: TaskItem;
    userId: string;
    mode: 'video_watch' | 'website_visit';
  }): Promise<{
    id: string;
    taskId: string;
    userId: string;
    mode: 'video_watch' | 'website_visit';
    requiredSeconds: number;
    verifiedSeconds: number;
    completed: boolean;
    startedAt: string;
  }> {
    const { task, userId, mode } = params;
    const canonical = toCanonicalTaskKind(task.taskKind, task.category);
    const rawRequired =
      mode === 'video_watch'
        ? Number(task.taskMeta?.fields?.watchDurationSeconds || 15)
        : Number(task.taskMeta?.fields?.minVisitSeconds || (canonical === 'website_visit' ? 10 : 0));
    const requiredSeconds = Math.max(3, Math.min(3600, Math.round(rawRequired || 10)));
    const key = `exec_sess_${userId}_${task.id}`;
    const existing = await readSetting<any>(key, null);
    const nowIso = new Date().toISOString();

    if (
      existing &&
      existing.taskId === task.id &&
      existing.userId === userId &&
      existing.mode === mode &&
      !existing.consumed
    ) {
      return {
        id: String(existing.id),
        taskId: existing.taskId,
        userId: existing.userId,
        mode: existing.mode,
        requiredSeconds,
        verifiedSeconds: Number(existing.verifiedSeconds || 0),
        completed: Boolean(existing.completed || Number(existing.verifiedSeconds || 0) >= requiredSeconds),
        startedAt: existing.startedAt || nowIso,
      };
    }

    const session = {
      id: `EX-${crypto.randomUUID()}`,
      taskId: task.id,
      userId,
      mode,
      requiredSeconds,
      verifiedSeconds: 0,
      completed: false,
      consumed: false,
      startedAt: nowIso,
      lastPingMs: Date.now(),
    };
    await writeSetting(key, session, `Task execution session for ${task.id}`, userId);
    return {
      id: session.id,
      taskId: session.taskId,
      userId: session.userId,
      mode: session.mode,
      requiredSeconds: session.requiredSeconds,
      verifiedSeconds: 0,
      completed: false,
      startedAt: session.startedAt,
    };
  },

  async pingExecutionSession(params: {
    taskId: string;
    sessionId: string;
    userId: string;
    deltaSeconds?: number;
    playerActive?: boolean;
    returnedFromVisit?: boolean;
  }): Promise<{
    id: string;
    requiredSeconds: number;
    verifiedSeconds: number;
    completed: boolean;
  }> {
    const key = `exec_sess_${params.userId}_${params.taskId}`;
    const session = await readSetting<any>(key, null);
    if (!session || session.id !== params.sessionId || session.userId !== params.userId) {
      throw new Error('جلسة تنفيذ المهمة غير صالحة أو منتهية. يرجى إعادة فتح المهمة.');
    }

    const nowMs = Date.now();
    const lastPingMs = Number(session.lastPingMs || nowMs);
    const wallClockElapsedSec = Math.max(0, (nowMs - lastPingMs) / 1000);
    const requestedDelta = Math.max(0, Math.min(30, Number(params.deltaSeconds || 0)));

    // Anti-cheat: strictly cap credited gain to actual wall-clock elapsed time (+1.5s network jitter tolerance)
    let gain = 0;
    if (session.mode === 'video_watch') {
      if (params.playerActive !== false) {
        gain = Math.min(requestedDelta || wallClockElapsedSec, wallClockElapsedSec + 1.5, 15);
      }
    } else {
      // website_visit: allow time elapsed since session start/lastPing when returning from visit or actively timing
      gain = params.returnedFromVisit
        ? Math.min(wallClockElapsedSec + 1, Number(session.requiredSeconds || 60))
        : Math.min(requestedDelta || wallClockElapsedSec, wallClockElapsedSec + 1.5, 15);
    }

    const requiredSeconds = Math.max(1, Number(session.requiredSeconds || 10));
    const nextVerified = Math.min(
      requiredSeconds,
      Math.round((Number(session.verifiedSeconds || 0) + Math.max(0, gain)) * 10) / 10
    );
    const completed = nextVerified >= requiredSeconds;

    const updated = {
      ...session,
      verifiedSeconds: nextVerified,
      completed,
      lastPingMs: nowMs,
      completedAt: completed && !session.completedAt ? new Date().toISOString() : session.completedAt,
    };
    await writeSetting(key, updated, `Task execution session for ${params.taskId}`, params.userId);
    return {
      id: updated.id,
      requiredSeconds,
      verifiedSeconds: Math.floor(updated.verifiedSeconds),
      completed,
    };
  },

  async verifyExecutionSession(params: {
    taskId: string;
    userId: string;
    sessionId?: string;
    requiredSeconds: number;
  }): Promise<{ verified: boolean; verifiedSeconds: number; sessionId?: string }> {
    const key = `exec_sess_${params.userId}_${params.taskId}`;
    const session = await readSetting<any>(key, null);
    if (!session) {
      return { verified: false, verifiedSeconds: 0 };
    }
    if (params.sessionId && session.id !== params.sessionId) {
      return { verified: false, verifiedSeconds: 0 };
    }
    if (session.consumed) {
      return { verified: false, verifiedSeconds: Number(session.verifiedSeconds || 0) };
    }
    const verifiedSeconds = Math.floor(Number(session.verifiedSeconds || 0));
    const verified = Boolean(session.completed || verifiedSeconds >= params.requiredSeconds);
    return {
      verified,
      verifiedSeconds,
      sessionId: session.id,
    };
  },

  async markExecutionSessionConsumed(taskId: string, userId: string): Promise<void> {
    const key = `exec_sess_${userId}_${taskId}`;
    const session = await readSetting<any>(key, null);
    if (session && !session.consumed) {
      await writeSetting(
        key,
        { ...session, consumed: true, consumedAt: new Date().toISOString() },
        `Task execution session consumed for ${taskId}`,
        userId
      );
    }
  },
};
