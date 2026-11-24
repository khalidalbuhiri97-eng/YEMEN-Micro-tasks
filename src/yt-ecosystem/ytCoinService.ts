import { supabase } from '../api/supabase.ts';

export type YtMetrics = {
  price_usd_per_yt: number;
  price_yer_per_yt: number;
  ad_pool_usd: number;
  admin_revenue_usd: number;
  total_mined_units: number;
  total_mined_yt: number;
  daily_mining_reward_yt: number;
  daily_mining_reward_usd: number;
  daily_mining_reward_yer: number;
  max_supply_units: number;
  mining_remaining_units: number;
  referral_remaining_units: number;
  yer_per_usd: number;
};

export type YtWallet = {
  user_id: string;
  pay_id: number;
  mined_units: number;
  withdrawable_units: number;
  referral_earned_units: number;
  last_daily_mine_date: string | null;
  wallet_status: string;
};

export const ytFormat = (units: number) => `${(Number(units || 0) / 1000).toFixed(3)} YT`;

export async function ytLoadDashboard(userId: string) {
  const [metricsRes, walletRes, adsRes, allocationsRes, historyRes] = await Promise.all([
    supabase.rpc('yt_get_live_metrics'),
    supabase.from('yt_wallets').select('*').eq('user_id', userId).maybeSingle(),
    supabase.from('yt_mining_ads').select('id,title,description,ad_url,placement,duration_seconds,sort_order,is_active').eq('is_active', true).order('sort_order'),
    supabase.from('yt_token_allocations').select('*').order('percentage', { ascending: false }),
    supabase.from('yt_price_history').select('id,price_usd_per_yt,ad_pool_usd,total_mined_units,event_type,created_at').order('created_at', { ascending: false }).limit(24),
  ]);
  const error = metricsRes.error || walletRes.error || adsRes.error || allocationsRes.error || historyRes.error;
  if (error) throw error;
  const wallet = walletRes.data;
  if (!wallet) throw new Error('لم يتم إنشاء محفظة YT لهذا الحساب بعد.');
  return {
    metrics: (Array.isArray(metricsRes.data) ? metricsRes.data[0] : metricsRes.data) as YtMetrics,
    wallet: wallet as YtWallet,
    ads: adsRes.data || [],
    allocations: allocationsRes.data || [],
    history: (historyRes.data || []).reverse(),
  };
}

export async function ytStartAd(adId: string, purpose: 'mining' | 'liquidation') {
  const { data, error } = await supabase.rpc('yt_start_mining_ad', { p_ad_id: adId, p_purpose: purpose });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.session_id || !row?.ad_url) throw new Error('تعذر بدء جلسة الإعلان.');
  return row as { session_id: string; ad_url: string; duration_seconds: number };
}

export async function ytClaimDaily() {
  const { data, error } = await supabase.rpc('yt_claim_daily_mining');
  if (error) throw error;
  return data;
}

export async function ytLiquidate(units: number) {
  const { data, error } = await supabase.rpc('yt_liquidate_mined', { p_units: units });
  if (error) throw error;
  return data;
}

export async function ytSendPay(payId: number, units: number, note: string) {
  const { data, error } = await supabase.rpc('yt_send_pay', {
    p_receiver_pay_id: payId, p_amount_units: units, p_note: note || null,
  });
  if (error) throw error;
  return data;
}

export async function ytDepositRevenue(totalUsd: number) {
  const { data, error } = await supabase.rpc('yt_deposit_ad_revenue', { p_total_usd: totalUsd });
  if (error) throw error;
  return data;
}

export async function ytManageAd(payload: {
  action: 'upsert' | 'delete'; id?: string; title?: string; description?: string;
  ad_url?: string; placement?: 'mining' | 'liquidation' | 'both';
  duration_seconds?: number; is_active?: boolean; sort_order?: number;
}) {
  const { data, error } = await supabase.rpc('yt_admin_manage_mining_ad', {
    p_action: payload.action, p_id: payload.id || null, p_title: payload.title || '',
    p_description: payload.description || '', p_ad_url: payload.ad_url || '',
    p_placement: payload.placement || 'both', p_duration_seconds: payload.duration_seconds || 30,
    p_is_active: payload.is_active ?? false, p_sort_order: payload.sort_order || 0,
  });
  if (error) throw error;
  return data;
}
