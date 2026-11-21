import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '')
  .trim()
  .replace(/\.supabase\.com$/i, '.supabase.co');
const SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const BUCKET = 'task-assets';

interface DefaultAssetDef {
  localFile: string;
  storagePath: string;
  title: string;
  assetKind: 'task_illustration' | 'category_icon' | 'provider_logo';
  taskKind?: string;
}

const DEFAULT_ASSETS: DefaultAssetDef[] = [
  {
    localFile: 'task_featured_emerald_1795253517096.jpg',
    storagePath: 'defaults/task_featured_emerald.jpg',
    title: 'تصميم المهمة المميزة (أخضر زمردي وذهبي)',
    assetKind: 'task_illustration',
    taskKind: 'featured',
  },
  {
    localFile: 'task_survey_art_1795253516916.jpg',
    storagePath: 'defaults/task_survey_art.jpg',
    title: 'رسم توضيحي لمهام الاستبيانات',
    assetKind: 'task_illustration',
    taskKind: 'surveys',
  },
  {
    localFile: 'task_smartlink_art_1795253516121.jpg',
    storagePath: 'defaults/task_smartlink_art.jpg',
    title: 'رسم توضيحي لمهام الروابط الذكية',
    assetKind: 'task_illustration',
    taskKind: 'smart_links',
  },
  {
    localFile: 'task_quick_violet_1795253516791.jpg',
    storagePath: 'defaults/task_quick_violet.jpg',
    title: 'رسم توضيحي للمهام السريعة',
    assetKind: 'task_illustration',
    taskKind: 'quick_tasks',
  },
  {
    localFile: 'task_app_testing_1795253516925.jpg',
    storagePath: 'defaults/task_app_testing.jpg',
    title: 'رسم توضيحي لتجربة التطبيقات والألعاب',
    assetKind: 'task_illustration',
    taskKind: 'app_testing',
  },
  {
    localFile: 'task_external_offers_1795253517040.jpg',
    storagePath: 'defaults/task_external_offers.jpg',
    title: 'رسم توضيحي للعروض الخارجية والشركاء',
    assetKind: 'task_illustration',
    taskKind: 'external_offers',
  },
  {
    localFile: 'cat_icon_all_1795253516607.jpg',
    storagePath: 'defaults/cat_icon_all.jpg',
    title: 'أيقونة تصنيف جميع المهام',
    assetKind: 'category_icon',
    taskKind: 'all',
  },
  {
    localFile: 'cat_icon_popular_1795253517535.jpg',
    storagePath: 'defaults/cat_icon_popular.jpg',
    title: 'أيقونة تصنيف الأكثر شعبية',
    assetKind: 'category_icon',
    taskKind: 'popular',
  },
  {
    localFile: 'cat_icon_quick_1795253516423.jpg',
    storagePath: 'defaults/cat_icon_quick.jpg',
    title: 'أيقونة تصنيف المهام السريعة',
    assetKind: 'category_icon',
    taskKind: 'quick',
  },
  {
    localFile: 'cat_icon_featured_1795253517783.jpg',
    storagePath: 'defaults/cat_icon_featured.jpg',
    title: 'أيقونة تصنيف المهام المميزة',
    assetKind: 'category_icon',
    taskKind: 'featured',
  },
];

async function ensureBucket() {
  const { data: buckets, error: listErr } = await supabase.storage.listBuckets();
  if (listErr) throw new Error(`listBuckets failed: ${listErr.message}`);
  const exists = (buckets || []).some((b) => b.name === BUCKET);
  if (!exists) {
    const { error: createErr } = await supabase.storage.createBucket(BUCKET, {
      public: true,
      fileSizeLimit: 5 * 1024 * 1024,
      allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'],
    });
    if (createErr) throw new Error(`createBucket failed: ${createErr.message}`);
    console.log(`Created public bucket: ${BUCKET}`);
  } else {
    await supabase.storage.updateBucket(BUCKET, {
      public: true,
      fileSizeLimit: 5 * 1024 * 1024,
      allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'],
    });
    console.log(`Verified public bucket: ${BUCKET}`);
  }
}

async function run() {
  await ensureBucket();

  const assetsRegistry: Array<any> = [];
  const iconByKind: Record<string, string> = {};
  const artByKind: Record<string, string> = {};

  for (const def of DEFAULT_ASSETS) {
    const absPath = path.resolve(process.cwd(), 'src/assets/images', def.localFile);
    const buffer = await fs.readFile(absPath);

    const { error: uploadErr } = await supabase.storage
      .from(BUCKET)
      .upload(def.storagePath, buffer, {
        contentType: 'image/jpeg',
        upsert: true,
        cacheControl: '31536000',
      });

    if (uploadErr) {
      throw new Error(`Upload failed for ${def.localFile}: ${uploadErr.message}`);
    }

    const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(def.storagePath);
    const publicUrl = urlData.publicUrl;

    // Verify public HTTP 200
    const resp = await fetch(publicUrl, { method: 'HEAD' });
    if (!resp.ok) {
      throw new Error(`Public URL verification failed (${resp.status}) for ${publicUrl}`);
    }

    const item = {
      id: crypto.createHash('md5').update(def.storagePath).digest('hex').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-4$3-8$4-$5').slice(0, 36),
      title: def.title,
      assetKind: def.assetKind,
      taskKind: def.taskKind || null,
      storagePath: def.storagePath,
      publicUrl,
      createdAt: new Date().toISOString(),
    };
    assetsRegistry.push(item);

    if (def.assetKind === 'category_icon' && def.taskKind) {
      iconByKind[def.taskKind] = publicUrl;
    }
    if (def.assetKind === 'task_illustration' && def.taskKind) {
      artByKind[def.taskKind] = publicUrl;
    }

    console.log(`Uploaded & verified: ${def.storagePath} -> ${publicUrl}`);
  }

  const defaultCategories = [
    {
      id: 'cat-all',
      slug: 'all',
      labelAr: 'جميع المهام',
      iconUrl: iconByKind.all,
      badgeColor: '#059669',
      sortOrder: 1,
      isActive: true,
    },
    {
      id: 'cat-popular',
      slug: 'popular',
      labelAr: 'الأكثر شعبية',
      iconUrl: iconByKind.popular,
      badgeColor: '#D97706',
      sortOrder: 2,
      isActive: true,
    },
    {
      id: 'cat-quick',
      slug: 'quick',
      labelAr: 'المهام السريعة',
      iconUrl: iconByKind.quick,
      badgeColor: '#6366F1',
      sortOrder: 3,
      isActive: true,
    },
    {
      id: 'cat-featured',
      slug: 'featured',
      labelAr: 'مميزة',
      iconUrl: iconByKind.featured,
      badgeColor: '#0F766E',
      sortOrder: 4,
      isActive: true,
    },
    {
      id: 'cat-surveys',
      slug: 'surveys',
      labelAr: 'الاستبيانات',
      iconUrl: artByKind.surveys,
      badgeColor: '#059669',
      sortOrder: 5,
      isActive: true,
    },
    {
      id: 'cat-smart-links',
      slug: 'smart_links',
      labelAr: 'الروابط الذكية',
      iconUrl: artByKind.smart_links,
      badgeColor: '#0284C7',
      sortOrder: 6,
      isActive: true,
    },
    {
      id: 'cat-app-testing',
      slug: 'app_testing',
      labelAr: 'تجربة التطبيقات',
      iconUrl: artByKind.app_testing,
      badgeColor: '#2563EB',
      sortOrder: 7,
      isActive: true,
    },
    {
      id: 'cat-social-engagement',
      slug: 'social_engagement',
      labelAr: 'التفاعل والإعلانات',
      iconUrl: artByKind.featured,
      badgeColor: '#10B981',
      sortOrder: 8,
      isActive: true,
    },
    {
      id: 'cat-local-services',
      slug: 'local_services',
      labelAr: 'العروض الخارجية',
      iconUrl: artByKind.external_offers,
      badgeColor: '#0D9488',
      sortOrder: 9,
      isActive: true,
    },
  ];

  const now = new Date().toISOString();
  await supabase.from('platform_settings').upsert(
    [
      {
        setting_key: 'task_assets_registry',
        setting_value: assetsRegistry,
        description: 'Official Supabase Storage task illustrations and category icons registry',
        updated_at: now,
      },
      {
        setting_key: 'task_categories_registry',
        setting_value: defaultCategories,
        description: 'Task category chips and icons registry',
        updated_at: now,
      },
    ],
    { onConflict: 'setting_key' }
  );

  // Also seed relational tables if Migration 035 is already applied
  const { error: catTableErr } = await supabase.from('task_categories').upsert(
    defaultCategories.map((c) => ({
      slug: c.slug,
      label_ar: c.labelAr,
      icon_url: c.iconUrl,
      badge_color: c.badgeColor,
      sort_order: c.sortOrder,
      is_active: c.isActive,
      updated_at: now,
    })),
    { onConflict: 'slug' }
  );
  if (!catTableErr) {
    console.log('Seeded public.task_categories table.');
  }

  const { error: assetTableErr } = await supabase.from('task_assets').upsert(
    assetsRegistry.map((a) => ({
      id: a.id,
      title: a.title,
      asset_kind: a.assetKind,
      task_kind: a.taskKind,
      storage_path: a.storagePath,
      public_url: a.publicUrl,
      created_at: a.createdAt,
    })),
    { onConflict: 'storage_path' }
  );
  if (!assetTableErr) {
    console.log('Seeded public.task_assets table.');
  }

  console.log('All 10 assets uploaded, verified, and registered in Supabase!');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
