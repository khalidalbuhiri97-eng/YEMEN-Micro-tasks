
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = (
  process.env.SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  ''
).trim().replace(/\.supabase\.com$/i, '.supabase.co');

const SUPABASE_KEY = (
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  ''
).trim();

// Main Supabase Server Client
export const supabaseServer = createClient(
  SUPABASE_URL,
  SUPABASE_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  }
);

// Dedicated Service Role Client
export const getSupabaseAdminClient = () => {
  const serviceKey = (
    process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  ).trim();

  if (!serviceKey) {
    throw new Error(
      'SERVICE_ROLE_KEY_MISSING: مفتاح صلاحيات الخادم (SUPABASE_SERVICE_ROLE_KEY) غير مهيأ.'
    );
  }

  return createClient(SUPABASE_URL, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
};

// User-Scoped Supabase Client
export const getSupabaseUserClient = (userToken: string) => {
  const anonKey = (
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    ''
  ).trim();

  if (!anonKey) {
    throw new Error(
      'SUPABASE_ANON_KEY_MISSING: مفتاح المصادقة العام غير مهيأ.'
    );
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
