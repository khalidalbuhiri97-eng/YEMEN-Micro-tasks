import crypto from 'node:crypto';
import { getSupabaseAdminClient } from './supabaseClient.js';

export interface UniversalTrackingSession {
  sessionId: string;
  userId: string;
  targetId: string; // taskId or adTemplateId
  targetType: 'task' | 'ad' | 'link';
  requiredSeconds: number;
  verifiedSeconds: number;
  completed: boolean;
  consumed: boolean;
  startedAt: string;
  lastPingMs: number;
}

/**
 * Universal Task & Ad Tracking Service (30s Automated Server-Side Dwell Tracking)
 * Fully automated background tracking without manual user intervention.
 */
export const universalTaskTrackingService = {
  async startSession(params: {
    userId: string;
    targetId: string;
    targetType?: 'task' | 'ad' | 'link';
    requiredSeconds?: number;
  }): Promise<UniversalTrackingSession> {
    const userId = params.userId;
    const targetId = params.targetId;
    const targetType = params.targetType || 'task';
    const requiredSeconds = Math.max(30, Number(params.requiredSeconds || 30)); // Enforce strict 30s minimum

    const client = getSupabaseAdminClient();
    const nowIso = new Date().toISOString();
    const sessionId = `UNIV-${crypto.randomUUID()}`;

    const session: UniversalTrackingSession = {
      sessionId,
      userId,
      targetId,
      targetType,
      requiredSeconds,
      verifiedSeconds: 0,
      completed: false,
      consumed: false,
      startedAt: nowIso,
      lastPingMs: Date.now(),
    };

    // Store session securely in user settings or tracking table
    const settingKey = `univ_track_${userId}_${targetId}`;
    await client.from('app_settings').upsert({
      key: settingKey,
      value: session,
      description: `Universal tracking session for ${targetType} ${targetId}`,
      updated_at: nowIso,
    }, { onConflict: 'key' }).select('key').maybeSingle();

    return session;
  },

  async pingSession(params: {
    userId: string;
    sessionId: string;
    targetId: string;
    deltaSeconds?: number;
    isActive?: boolean;
  }): Promise<UniversalTrackingSession> {
    const client = getSupabaseAdminClient();
    const settingKey = `univ_track_${params.userId}_${params.targetId}`;
    const { data: row } = await client.from('app_settings').select('value').eq('key', settingKey).maybeSingle();
    
    if (!row || !row.value || row.value.sessionId !== params.sessionId || row.value.userId !== params.userId) {
      throw new Error('جلسة التتبع التلقائي غير صالحة أو منتهية.');
    }

    const session: UniversalTrackingSession = row.value;
    if (session.consumed || session.completed) {
      return session;
    }

    const nowMs = Date.now();
    const lastPingMs = Number(session.lastPingMs || nowMs);
    const wallClockElapsedSec = Math.max(0, (nowMs - lastPingMs) / 1000);
    const requestedDelta = Math.max(0, Math.min(30, Number(params.deltaSeconds || 3)));

    let gain = 0;
    if (params.isActive !== false) {
      gain = Math.min(requestedDelta || wallClockElapsedSec, wallClockElapsedSec + 2.0, 15);
    }

    const nextVerified = Math.min(
      session.requiredSeconds,
      Math.round((session.verifiedSeconds + Math.max(0, gain)) * 10) / 10
    );
    const completed = nextVerified >= session.requiredSeconds;

    const updated: UniversalTrackingSession = {
      ...session,
      verifiedSeconds: nextVerified,
      completed,
      lastPingMs: nowMs,
    };

    await client.from('app_settings').upsert({
      key: settingKey,
      value: updated,
      description: `Universal tracking session for ${session.targetType} ${session.targetId}`,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'key' });

    return updated;
  },

  async verifyAndConsumeSession(params: {
    userId: string;
    targetId: string;
    sessionId: string;
  }): Promise<{ valid: boolean; verifiedSeconds: number }> {
    const client = getSupabaseAdminClient();
    const settingKey = `univ_track_${params.userId}_${params.targetId}`;
    const { data: row } = await client.from('app_settings').select('value').eq('key', settingKey).maybeSingle();

    if (!row || !row.value || row.value.sessionId !== params.sessionId || row.value.userId !== params.userId) {
      return { valid: false, verifiedSeconds: 0 };
    }

    const session: UniversalTrackingSession = row.value;
    if (session.consumed) {
      return { valid: session.completed, verifiedSeconds: session.verifiedSeconds };
    }

    const valid = session.completed || session.verifiedSeconds >= session.requiredSeconds;

    // Mark as consumed (idempotency lock)
    session.consumed = true;
    await client.from('app_settings').upsert({
      key: settingKey,
      value: session,
      description: `Universal tracking session consumed for ${session.targetId}`,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'key' });

    return { valid, verifiedSeconds: session.verifiedSeconds };
  },
};
