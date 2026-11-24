import {supabase} from '../api/supabase.ts';
import {syncSupabaseSession} from '../api/client.ts';

export type YtMetrics={price_usd_per_yt:number;price_yer_per_yt:number;ad_pool_usd:number;admin_revenue_usd:number;
 total_mined_units:number;total_mined_yt:number;daily_mining_reward_units:number;daily_mining_reward_yt:number;
 daily_mining_reward_usd:number;max_supply_units:number;max_supply_yt:number;mining_remaining_units:number;
 referral_remaining_units:number;yer_per_usd:number;admin_pay_id:number|null};
export type YtWallet={user_id:string;pay_id:number;mined_units:number;withdrawable_units:number;withdrawal_pending_units:number;
 referral_earned_units:number;last_daily_mine_date:string|null;wallet_status:string;is_frozen:boolean};
export type YtAd={id:string;title:string;description:string|null;ad_url:string;ad_type:'video'|'smart_link'|'banner_ad';
 reward_units:number;duration_seconds:number;is_active:boolean;ad_code:string|null};
export const YT_PRECISION=100000;
export const ytFormat=(raw:number)=>`${(Number(raw||0)/YT_PRECISION).toFixed(5)} YT`;
export const ytToRaw=(amount:string|number)=>{
 const n=Number(amount);
 if(!Number.isFinite(n)||n<0||Math.abs(n*YT_PRECISION-Math.round(n*YT_PRECISION))>1e-7)throw new Error('أدخل مبلغاً صحيحاً حتى خمس خانات عشرية.');
 return Math.round(n*YT_PRECISION);
};
export const ytTodayAden=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Aden',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());

export type YtCoinService=ReturnType<typeof createYtCoinService>;
export function createYtCoinService(client:typeof supabase){
 const loadDashboard=async(userId:string,isAdmin=false)=>{
  await syncSupabaseSession();
  const [metricsRes,walletRes,adsRes,allocationsRes,historyRes,claimsRes,ledgerRes,withdrawalsRes]=await Promise.all([
   client.rpc('yt_get_live_metrics'),
   client.from('yt_wallets').select('user_id,pay_id,mined_units,withdrawable_units,withdrawal_pending_units,referral_earned_units,last_daily_mine_date,wallet_status,is_frozen').eq('user_id',userId).maybeSingle(),
   client.from('yt_mining_ads').select('id,title,description,ad_url,placement,duration_seconds,sort_order,is_active,ad_type,reward_units,ad_code').order('sort_order'),
   client.from('yt_token_allocations').select('allocation_code,name_ar,percentage,allocated_units').order('percentage',{ascending:false}),
   client.from('yt_price_history').select('id,price_usd_per_yt,ad_pool_usd,total_mined_units,event_type,created_at').order('created_at',{ascending:false}).limit(24),
   client.from('yt_user_ad_claims').select('ad_id,claimed_date,reward_units,referral_bonus_units').eq('user_id',userId).eq('claimed_date',ytTodayAden()),
   client.from('yt_ledger_transactions').select('id,transaction_type,balance_bucket,amount_units,balance_before_units,balance_after_units,description,created_at').eq('wallet_user_id',userId).order('created_at',{ascending:false}).limit(30),
   (isAdmin?client.from('yt_withdrawal_requests').select('id,user_id,amount_units,payout_method,payout_destination,status,receipt_url,admin_note,created_at,reviewed_at').order('created_at',{ascending:false}).limit(50):client.from('yt_withdrawal_requests').select('id,user_id,amount_units,payout_method,payout_destination,status,receipt_url,admin_note,created_at,reviewed_at').eq('user_id',userId).order('created_at',{ascending:false}).limit(30))
  ]);
  const error=metricsRes.error||walletRes.error||adsRes.error||allocationsRes.error||historyRes.error||claimsRes.error||ledgerRes.error||withdrawalsRes.error;
  if(error)throw error;
  if(!walletRes.data)throw new Error('لم يتم إنشاء محفظة YT لهذا الحساب بعد.');
  const metrics=(Array.isArray(metricsRes.data)?metricsRes.data[0]:metricsRes.data) as YtMetrics;
  return {metrics,wallet:walletRes.data as YtWallet,ads:(adsRes.data||[]) as YtAd[],allocations:allocationsRes.data||[],
   history:(historyRes.data||[]).reverse(),claims:claimsRes.data||[],ledger:ledgerRes.data||[],withdrawals:withdrawalsRes.data||[]};
 };
 const startAd=async(adId:string,purpose:'reward'|'liquidation'='reward')=>{
  await syncSupabaseSession();
  const {data,error}=await client.rpc(purpose==='reward'?'yt_start_link_session':'yt_start_liquidation_ad',{p_ad_id:adId,p_agent:typeof navigator!=='undefined'?navigator.userAgent:null});
  if(error)throw error;
  if(!data?.session_token||!data?.ad_url)throw new Error('تعذر بدء جلسة الإعلان.');
  return data as {session_token:string;ad_url:string;ad_code:string|null;ad_type:string;required_seconds:number};
 };
 const verifyAd=async(sessionToken:string)=>{await syncSupabaseSession();const {data,error}=await client.rpc('yt_verify_and_complete_link',{p_session_token:sessionToken});if(error)throw error;return data;};
 const setPin=async(newPin:string,currentPin?:string)=>{await syncSupabaseSession();const {data,error}=await client.rpc('yt_set_wallet_pin',{p_new_pin:newPin,p_current_pin:currentPin||null});if(error)throw error;return data;};
 const liquidate=async(amountYt:number,pin:string,sessionToken:string)=>{await syncSupabaseSession();const {data,error}=await client.rpc('yt_liquidate_mined',{p_amount_yt:amountYt,p_pin:pin,p_session_token:sessionToken});if(error)throw error;return data;};
 const sendPay=async(payId:number,amountYt:number,pin:string,note:string)=>{await syncSupabaseSession();const {data,error}=await client.rpc('yt_send_pay',{p_receiver_pay_id:payId,p_amount_yt:amountYt,p_pin:pin,p_note:note||null});if(error)throw error;return data;};
 const depositRevenue=async(totalUsd:number)=>{await syncSupabaseSession();const {data,error}=await client.rpc('yt_deposit_ad_revenue',{p_total_usd:totalUsd});if(error)throw error;return data;};
 const manageAd=async(payload:{action:'create'|'update'|'delete';id?:string;title?:string;ad_type?:'video'|'smart_link'|'banner_ad';ad_url?:string;reward_yt?:number;required_seconds?:number;is_active?:boolean;ad_code?:string})=>{
  await syncSupabaseSession();
  const {data,error}=await client.rpc('yt_admin_manage_mining_ad',{p_action:payload.action,p_id:payload.id||null,p_title:payload.title||'',
   p_ad_type:payload.ad_type||'video',p_ad_url:payload.ad_url||'',p_reward_yt:payload.reward_yt??0,
   p_required_seconds:payload.required_seconds??30,p_is_active:payload.is_active??false,p_ad_code:payload.ad_code||null});
  if(error)throw error;return data;
 };
 const requestWithdrawal=async(amountYt:number,method:string,destination:string,pin:string)=>{await syncSupabaseSession();const {data,error}=await client.rpc('yt_request_withdrawal',{p_amount_yt:amountYt,p_payout_method:method,p_payout_destination:destination,p_pin:pin});if(error)throw error;return data;};
 const reviewWithdrawal=async(id:string,action:'paid'|'reject',receiptUrl:string,note:string)=>{await syncSupabaseSession();const {data,error}=await client.rpc('yt_admin_review_withdrawal',{p_request_id:id,p_action:action,p_receipt_url:receiptUrl||null,p_admin_note:note||null});if(error)throw error;return data;};
 const setManager=async(payId:number)=>{await syncSupabaseSession();const {data,error}=await client.rpc('yt_admin_set_manager',{p_pay_id:payId});if(error)throw error;return data;};
 const freezeWallet=async(payId:number,frozen:boolean)=>{await syncSupabaseSession();const {data,error}=await client.rpc('yt_admin_freeze_wallet',{p_pay_id:payId,p_frozen:frozen});if(error)throw error;return data;};
 return {loadDashboard,startAd,verifyAd,setPin,liquidate,sendPay,depositRevenue,manageAd,setManager,freezeWallet,requestWithdrawal,reviewWithdrawal};
}
export const ytCoinService=createYtCoinService(supabase);
