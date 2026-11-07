import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = (import.meta as any).env?.VITE_SUPABASE_URL || 'https://pevftfrgtzspiphibbla.supabase.co';
const SUPABASE_ANON_KEY =
  (import.meta as any).env?.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBldmZ0ZnJndHpzcGlwaGliYmxhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQwNTAxOTAsImV4cCI6MjEwOTYyNjE5MH0.OavlxMWS9mtCv8Ass3jM-Iz9CCSfT9FDx632gqBMvkA';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});
