import fs from 'node:fs/promises';
import path from 'node:path';
import * as webpush from 'web-push';
import { getSupabaseAdminClient } from './supabaseClient.js';

export interface StoredPushSubscription {
  id?: string;
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string;
  updatedAt: string;
}

const FALLBACK_SUBS_FILE = '/tmp/yemen_task_push_subscriptions.json';
let vapidInitializedForKeys: string | null = null;

function getVapidEnvConfig() {
  const publicKey = (process.env.VAPID_PUBLIC_KEY || '').trim();
  const privateKey = (process.env.VAPID_PRIVATE_KEY || '').trim();
  const subject = (process.env.VAPID_SUBJECT || 'mailto:support@kasbyemen.com').trim();

  if (!publicKey || !privateKey) {
    return {
      configured: false as const,
      publicKey: null,
      privateKey: null,
      subject,
      reason: 'مفاتيح VAPID غير مهيأة على الخادم (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY).',
    };
  }

  const cacheSig = `${subject}|${publicKey}|${privateKey}`;
  if (vapidInitializedForKeys !== cacheSig) {
    try {
      webpush.setVapidDetails(subject, publicKey, privateKey);
      vapidInitializedForKeys = cacheSig;
    } catch (err: any) {
      return {
        configured: false as const,
        publicKey: null,
        privateKey: null,
        subject,
        reason: `صيغة مفاتيح VAPID غير صالحة: ${err?.message || 'invalid key'}`,
      };
    }
  }

  return {
    configured: true as const,
    publicKey,
    privateKey,
    subject,
  };
}

export function getPushPublicStatus() {
  const cfg = getVapidEnvConfig();
  return {
    configured: cfg.configured,
    publicKey: cfg.publicKey,
    reason: cfg.configured ? undefined : cfg.reason,
  };
}

async function readFallbackSubscriptions(): Promise<StoredPushSubscription[]> {
  try {
    const raw = await fs.readFile(FALLBACK_SUBS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeFallbackSubscriptions(subs: StoredPushSubscription[]): Promise<void> {
  try {
    await fs.mkdir(path.dirname(FALLBACK_SUBS_FILE), { recursive: true });
    await fs.writeFile(FALLBACK_SUBS_FILE, JSON.stringify(subs, null, 2), 'utf8');
  } catch {
    // Non-blocking fallback write
  }
}

function isMissingPushTableError(err: any): boolean {
  const msg = String(err?.message || '').toLowerCase();
  return err?.code === '42P01' || err?.code === 'PGRST205' || msg.includes('push_subscriptions');
}

export async function saveUserPushSubscription(params: {
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string;
}): Promise<{ storageMode: 'supabase' | 'fallback' }> {
  const cleanUserId = String(params.userId || '').trim();
  const cleanEndpoint = String(params.endpoint || '').trim();
  const cleanP256dh = String(params.p256dh || '').trim();
  const cleanAuth = String(params.auth || '').trim();

  if (!cleanUserId || !cleanEndpoint || !cleanP256dh || !cleanAuth) {
    throw new Error('بيانات اشتراك إشعارات الدفع غير مكتملة.');
  }

  const now = new Date().toISOString();
  try {
    const db = getSupabaseAdminClient();
    const { error } = await db.from('push_subscriptions').upsert(
      {
        user_id: cleanUserId,
        endpoint: cleanEndpoint,
        p256dh: cleanP256dh,
        auth: cleanAuth,
        user_agent: params.userAgent ? String(params.userAgent).slice(0, 300) : null,
        updated_at: now,
      },
      { onConflict: 'user_id,endpoint' }
    );

    if (!error) {
      return { storageMode: 'supabase' };
    }
    if (!isMissingPushTableError(error)) {
      throw new Error(error.message);
    }
  } catch (err: any) {
    if (!isMissingPushTableError(err)) {
      // Fall through only for missing table or connection fallback
    }
  }

  const existing = await readFallbackSubscriptions();
  const filtered = existing.filter((s) => !(s.userId === cleanUserId && s.endpoint === cleanEndpoint));
  filtered.push({
    userId: cleanUserId,
    endpoint: cleanEndpoint,
    p256dh: cleanP256dh,
    auth: cleanAuth,
    userAgent: params.userAgent ? String(params.userAgent).slice(0, 300) : undefined,
    updatedAt: now,
  });
  await writeFallbackSubscriptions(filtered);
  return { storageMode: 'fallback' };
}

export async function removeUserPushSubscription(params: {
  userId: string;
  endpoint?: string;
}): Promise<void> {
  const cleanUserId = String(params.userId || '').trim();
  const cleanEndpoint = params.endpoint ? String(params.endpoint).trim() : undefined;
  if (!cleanUserId) return;

  try {
    const db = getSupabaseAdminClient();
    let q = db.from('push_subscriptions').delete().eq('user_id', cleanUserId);
    if (cleanEndpoint) q = q.eq('endpoint', cleanEndpoint);
    await q;
  } catch {
    // ignore
  }

  const existing = await readFallbackSubscriptions();
  const next = existing.filter((s) => {
    if (s.userId !== cleanUserId) return true;
    if (cleanEndpoint && s.endpoint !== cleanEndpoint) return true;
    return false;
  });
  if (next.length !== existing.length) {
    await writeFallbackSubscriptions(next);
  }
}

async function getUserPushSubscriptions(userId: string): Promise<StoredPushSubscription[]> {
  try {
    const db = getSupabaseAdminClient();
    const { data, error } = await db
      .from('push_subscriptions')
      .select('id, user_id, endpoint, p256dh, auth, user_agent, updated_at')
      .eq('user_id', userId);

    if (!error && Array.isArray(data) && data.length > 0) {
      return data.map((row: any) => ({
        id: row.id,
        userId: row.user_id,
        endpoint: row.endpoint,
        p256dh: row.p256dh,
        auth: row.auth,
        userAgent: row.user_agent || undefined,
        updatedAt: row.updated_at,
      }));
    }
    if (error && !isMissingPushTableError(error)) {
      return [];
    }
  } catch {
    // Fallback below
  }

  const fallback = await readFallbackSubscriptions();
  return fallback.filter((s) => s.userId === userId);
}

export async function sendWebPushToUser(
  userId: string,
  payload: {
    title: string;
    body: string;
    url?: string;
    tag?: string;
    type?: string;
  }
): Promise<{ sent: number; failed: number; configured: boolean }> {
  const cfg = getVapidEnvConfig();
  if (!cfg.configured) {
    return { sent: 0, failed: 0, configured: false };
  }

  const subs = await getUserPushSubscriptions(userId);
  if (subs.length === 0) {
    return { sent: 0, failed: 0, configured: true };
  }

  const notificationPayload = JSON.stringify({
    title: payload.title,
    body: payload.body,
    url: payload.url || '/dashboard',
    tag: payload.tag || payload.type || 'yemen-task-notif',
    icon: '/pwa-192x192.png?v=3',
    badge: '/pwa-192x192.png?v=3',
  });

  let sent = 0;
  let failed = 0;

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: {
              p256dh: sub.p256dh,
              auth: sub.auth,
            },
          },
          notificationPayload,
          { TTL: 86400 }
        );
        sent += 1;
      } catch (err: any) {
        failed += 1;
        const statusCode = Number(err?.statusCode || 0);
        if (statusCode === 404 || statusCode === 410) {
          await removeUserPushSubscription({ userId, endpoint: sub.endpoint }).catch(() => {});
        }
      }
    })
  );

  return { sent, failed, configured: true };
}
