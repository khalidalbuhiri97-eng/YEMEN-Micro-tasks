import { createClient } from '@supabase/supabase-js';

// Get Supabase URL and Anon Key from environment variables (Vite / Vercel compatible)
let rawUrl =
  (import.meta as any).env?.VITE_SUPABASE_URL ||
  (import.meta as any).env?.NEXT_PUBLIC_SUPABASE_URL ||
  'https://pevftfrgtzspiphibbla.supabase.co';

// Automatically fix typo if user enters .supabase.com instead of standard .supabase.co
const SUPABASE_URL = rawUrl.trim().replace(/\.supabase\.com$/i, '.supabase.co');

const SUPABASE_ANON_KEY =
  (import.meta as any).env?.VITE_SUPABASE_ANON_KEY ||
  (import.meta as any).env?.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBldmZ0ZnJndHpzcGlwaGliYmxhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQwNTAxOTAsImV4cCI6MjEwOTYyNjE5MH0.OavlxMWS9mtCv8Ass3jM-Iz9CCSfT9FDx632gqBMvkA';

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.warn('⚠️ تنبيه: تعذر قراءة متغيرات الاتصال بـ Supabase. يرجى ضبط VITE_SUPABASE_URL و VITE_SUPABASE_ANON_KEY في Vercel.');
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

/**
 * Diagnostic helper to verify Supabase connection state and return human-readable status
 */
export async function checkSupabaseConnection(): Promise<{ isConnected: boolean; message: string }> {
  try {
    const { error } = await supabase.from('platform_settings').select('id').limit(1);
    if (error && error.code !== 'PGRST116') {
      return {
        isConnected: false,
        message: `فشل الاتصال بقاعدة البيانات (${error.message}). تحقق من سياسات RLS والمتغيرات في Vercel.`,
      };
    }
    return {
      isConnected: true,
      message: 'تم الاتصال بقاعدة بيانات Supabase بنجاح.',
    };
  } catch (err: any) {
    return {
      isConnected: false,
      message: err?.message || 'تعذر الاتصال بـ Supabase. تحقق من الاتصال بالشبكة والمتغيرات.',
    };
  }
}
