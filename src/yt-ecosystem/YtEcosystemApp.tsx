import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowDownToLine, ArrowLeftRight, ArrowUpRight, BarChart3, CheckCircle2, ChevronLeft,
  CircleDollarSign, Copy, Gem, Loader2, LockKeyhole, Play, RefreshCw, ShieldCheck,
  Sparkles, Users, Wallet, X, QrCode, Plus, Trash2, TrendingUp,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import {
  ytClaimDaily, ytDepositRevenue, ytFormat, ytLiquidate, ytLoadDashboard,
  ytManageAd, ytSendPay, ytStartAd, type YtMetrics, type YtWallet,
} from './ytCoinService.ts';

type Props = { compact?: boolean; onOpen?: () => void; onExit?: () => void; onOpenEarnAds?: () => void };

const GOLD = 'border border-amber-400/40 shadow-[0_0_24px_rgba(212,175,55,.08)]';
const fmtUsd = (v: number) => '$' + Number(v || 0).toFixed(8);
const errorText = (e: any) => {
  const s = String(e?.message || e || '');
  if (s.includes('ALREADY_MINED_TODAY')) return 'أنجزت تعدين اليوم بالفعل.';
  if (s.includes('VERIFIED_MINING_AD_REQUIRED')) return 'أكمل إعلان التعدين وانتظر تأكيده من مزود الإعلان.';
  if (s.includes('VERIFIED_LIQUIDATION_AD_REQUIRED')) return 'أكمل إعلان التسييل وانتظر تأكيده أولاً.';
  if (s.includes('INSUFFICIENT_LIQUIDITY')) return 'السيولة الحالية لا تكفي لإتمام التسييل.';
  if (s.includes('ADMIN_REQUIRED')) return 'هذه الوظيفة متاحة للإدارة فقط.';
  return s;
};

export const YtEcosystemApp: React.FC<Props> = ({ compact = false, onOpen, onExit }) => {
  const { user, isAdmin, openAuthModal, showToast } = useAuth();
  const [tab, setTab] = useState<'market'|'wallet'|'mine'|'admin'>('market');
  const [metrics, setMetrics] = useState<YtMetrics | null>(null);
  const [wallet, setWallet] = useState<YtWallet | null>(null);
  const [ads, setAds] = useState<any[]>([]);
  const [allocations, setAllocations] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [payId, setPayId] = useState('');
  const [payAmount, setPayAmount] = useState('');
  const [payNote, setPayNote] = useState('');
  const [deposit, setDeposit] = useState('');
  const [liquidateAmount, setLiquidateAmount] = useState('10');
  const [adDraft, setAdDraft] = useState({ title:'', description:'', ad_url:'', placement:'both', duration_seconds:30, is_active:false });
  const [adMode, setAdMode] = useState<'mining'|'liquidation'>('mining');

  const refresh = useCallback(async () => {
    if (!user?.id) return;
    const data = await ytLoadDashboard(user.id);
    setMetrics(data.metrics); setWallet(data.wallet); setAds(data.ads);
    setAllocations(data.allocations); setHistory(data.history);
  }, [user?.id]);

  useEffect(() => { refresh().catch((e) => setNotice(errorText(e))); }, [refresh]);

  const run = async (fn: () => Promise<any>, success: string) => {
    setBusy(true); setNotice('');
    try { await fn(); await refresh(); setNotice(success); }
    catch (e) { setNotice(errorText(e)); }
    finally { setBusy(false); }
  };

  const startAd = async (purpose: 'mining'|'liquidation') => {
    const ad = ads.find((x) => x.placement === purpose || x.placement === 'both');
    if (!ad) { setNotice('لا يوجد إعلان نشط لهذا القسم حالياً.'); return; }
    await run(async () => {
      const session = await ytStartAd(ad.id, purpose);
      const target = new URL(session.ad_url);
      target.searchParams.set('yt_session_id', session.session_id);
      target.searchParams.set('yt_user_id', user!.id);
      window.open(target.toString(), '_blank', 'noopener,noreferrer');
      setNotice('بدأ الإعلان. ستُعتمد المكافأة فقط بعد وصول تأكيد موثّق من مزود الإعلان.');
    }, 'تم فتح الإعلان. انتظر التحقق قبل المطالبة.');
  };

  const dailyRewardUsd = metrics?.daily_mining_reward_usd || 0;
  const price = metrics?.price_usd_per_yt || 0;

  if (compact) return (
    <button type="button" onClick={onOpen} className={`w-full rounded-2xl bg-gradient-to-br from-slate-950 via-slate-900 to-amber-950 text-white p-4 text-right ${GOLD}`}>
      <div className="flex items-center justify-between"><span className="flex items-center gap-2 font-black"><Gem className="w-5 h-5 text-amber-300"/> منظومة YT Coin</span><ChevronLeft className="w-5 h-5 text-amber-300"/></div>
      <div className="mt-3 flex items-end justify-between"><div><div className="text-xs text-amber-100/70">السعر الحي</div><div className="text-xl font-black" dir="ltr">{fmtUsd(price)} / YT</div></div><div className="text-left"><div className="text-xs text-amber-100/70">مكافأة اليوم</div><div className="font-bold text-amber-300">0.010 YT</div></div></div>
    </button>
  );

  if (!user) return <div dir="rtl" className="min-h-[70dvh] bg-slate-950 text-white p-6 flex flex-col items-center justify-center gap-4"><Gem className="w-12 h-12 text-amber-300"/><h2 className="text-xl font-black">YT Coin</h2><p className="text-sm text-slate-400">سجّل الدخول لفتح محفظتك.</p><button onClick={() => openAuthModal('login')} className="rounded-xl bg-amber-400 text-slate-950 px-6 py-3 font-bold">تسجيل الدخول</button></div>;

  return (
    <main dir="rtl" className="min-h-[100dvh] w-full max-w-full overflow-x-hidden bg-[#080b12] text-slate-100 pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto w-full max-w-5xl px-3 pt-3 pb-8 sm:px-5">
        <header className="flex items-center justify-between gap-3 py-3">
          <div className="flex items-center gap-3 min-w-0"><div className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-amber-200 to-amber-700 text-slate-950"><Gem/></div><div className="min-w-0"><h1 className="font-black text-lg">YT Coin</h1><p className="text-[11px] text-slate-400">محفظة رقمية مستقلة · YTC</p></div></div>
          <div className="flex items-center gap-2"><button onClick={() => refresh().catch(e=>setNotice(errorText(e)))} className="rounded-xl border border-white/10 p-2"><RefreshCw size={17}/></button>{onExit && <button onClick={onExit} className="rounded-xl border border-white/10 p-2"><X size={17}/></button>}</div>
        </header>

        <nav className="grid grid-cols-4 gap-1 rounded-2xl bg-white/[0.04] p-1 mb-4">
          {([{id:'market',label:'السوق',icon:TrendingUp},{id:'wallet',label:'المحفظة',icon:Wallet},{id:'mine',label:'التعدين',icon:Play},{id:'admin',label:'الإدارة',icon:ShieldCheck}] as const).filter(x=>x.id!=='admin'||isAdmin).map(item=><button key={item.id} onClick={()=>setTab(item.id)} className={`rounded-xl py-2.5 text-[11px] font-bold flex flex-col items-center gap-1 ${tab===item.id?'bg-gradient-to-r from-amber-300 to-yellow-600 text-slate-950':'text-slate-400'}`}><item.icon size={16}/>{item.label}</button>)}
        </nav>

        {notice && <div role="status" className="mb-3 rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 text-xs leading-6 text-amber-100">{notice}</div>}
        {busy && <div className="mb-3 flex items-center gap-2 text-xs text-amber-300"><Loader2 size={14} className="animate-spin"/> جارٍ تنفيذ العملية والتحقق من قاعدة البيانات…</div>}

        {tab==='market' && <section className="space-y-3">
          <div className={`rounded-3xl bg-gradient-to-br from-[#171a22] to-[#11131a] p-5 ${GOLD}`}>
            <div className="flex justify-between gap-3"><div><p className="text-xs text-slate-400">السعر اللحظي لكل YT</p><p className="mt-1 text-3xl font-black text-amber-300" dir="ltr">{fmtUsd(price)}</p><p className="mt-1 text-xs text-slate-400">{(metrics?.price_yer_per_yt||0).toLocaleString('en-US',{maximumFractionDigits:4})} ر.ي</p></div><div className="text-left"><p className="text-xs text-slate-500">إجمالي المتداول</p><p className="mt-2 font-black">{(metrics?.total_mined_yt||0).toLocaleString('en-US',{minimumFractionDigits:3,maximumFractionDigits:3})} YT</p></div></div>
            <div className="mt-5 grid grid-cols-2 gap-2"><div className="rounded-2xl bg-black/25 p-3"><p className="text-[10px] text-slate-400">صندوق السيولة الإعلانية</p><p className="mt-1 text-lg font-extrabold" dir="ltr">{fmtUsd(metrics?.ad_pool_usd||0)}</p></div><div className="rounded-2xl bg-black/25 p-3"><p className="text-[10px] text-slate-400">عائد التعدين اليومي</p><p className="mt-1 text-lg font-extrabold text-amber-300">0.010 YT</p><p className="text-[11px] text-slate-400" dir="ltr">= {fmtUsd(dailyRewardUsd)}</p></div></div>
          </div>
          <div className={`rounded-2xl bg-[#11151e] p-4 ${GOLD}`}><div className="mb-3 flex items-center justify-between"><h2 className="font-bold">منحنى السعر والسيولة</h2><BarChart3 className="text-amber-300"/></div><div className="flex h-32 items-end gap-1 border-b border-white/10 px-1">{history.length>0?history.map((p:any,i:number)=><div key={p.id} title={new Date(p.created_at).toLocaleString('ar')} className="flex-1 rounded-t bg-gradient-to-t from-amber-700 to-yellow-300 opacity-90" style={{height:`${Math.max(5,Math.min(100,(Number(p.price_usd_per_yt)/(Math.max(...history.map((h:any)=>Number(h.price_usd_per_yt)),0.00000001))*100)))}%`}}/>):<p className="m-auto text-xs text-slate-500">لا توجد نقاط سعر مسجلة بعد</p>}</div></div>
          <div className={`rounded-2xl bg-[#11151e] p-4 ${GOLD}`}><h2 className="mb-3 font-bold">التوزيع الثابت · 100,000,000 YT</h2><div className="space-y-3">{allocations.map((a:any)=><div key={a.allocation_code}><div className="mb-1 flex justify-between text-xs"><span>{a.name_ar}</span><b className="text-amber-300">{a.percentage}% · {(a.allocated_units/1000).toLocaleString('en-US')} YT</b></div><div className="h-2 rounded-full bg-white/10"><div className="h-full rounded-full bg-gradient-to-l from-amber-700 to-yellow-300" style={{width:`${a.percentage}%`}}/></div></div>)}</div></div>
        </section>}

        {tab==='wallet' && <section className="space-y-3">
          <div className={`rounded-3xl bg-gradient-to-br from-amber-950/50 to-slate-900 p-5 ${GOLD}`}><p className="text-xs text-amber-100/70">رصيد التعدين</p><p className="my-2 text-3xl font-black text-amber-300">{ytFormat(wallet?.mined_units||0)}</p><p className="text-[11px] text-slate-400">رصيد غير قابل للسحب حتى إتمام إعلان التسييل</p><div className="mt-4 flex gap-2"><input value={liquidateAmount} onChange={e=>setLiquidateAmount(e.target.value)} inputMode="decimal" className="min-w-0 flex-1 rounded-xl bg-black/30 p-3 text-sm outline-none" placeholder="الوحدات الخام"/><button disabled={busy} onClick={()=>{const n=Math.round(Number(liquidateAmount)*1000);run(()=>ytLiquidate(n),'تم التسييل بنجاح.');}} className="rounded-xl bg-amber-400 px-3 text-xs font-black text-slate-950">تسييل</button></div><button disabled={busy} onClick={()=>startAd('liquidation')} className="mt-2 w-full rounded-xl border border-amber-300/40 py-3 text-xs font-bold text-amber-200"><Play size={14} className="inline ml-2"/>مشاهدة إعلان التسييل</button></div>
          <div className={`rounded-3xl bg-slate-900 p-5 ${GOLD}`}><p className="text-xs text-slate-400">الرصيد القابل للسحب وYT Pay</p><p className="my-2 text-3xl font-black text-emerald-300">{ytFormat(wallet?.withdrawable_units||0)}</p><div className="rounded-xl bg-black/20 p-3 text-xs"><span className="text-slate-400">Pay ID</span><div className="mt-1 flex items-center justify-between"><b className="text-lg tracking-widest">{wallet?.pay_id}</b><button onClick={()=>navigator.clipboard?.writeText(String(wallet?.pay_id))}><Copy size={15}/></button></div></div><img className="mx-auto mt-3 h-36 w-36 rounded-xl bg-white p-2" alt="YT Pay QR" src={`https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent('YTPAY:'+wallet?.pay_id)}`}/><div className="mt-4 grid grid-cols-2 gap-2"><input value={payId} onChange={e=>setPayId(e.target.value)} inputMode="numeric" placeholder="Pay ID المستلم" className="min-w-0 rounded-xl bg-black/30 p-3 text-xs"/><input value={payAmount} onChange={e=>setPayAmount(e.target.value)} inputMode="decimal" placeholder="المبلغ بـ YT" className="min-w-0 rounded-xl bg-black/30 p-3 text-xs"/></div><input value={payNote} onChange={e=>setPayNote(e.target.value)} placeholder="ملاحظة اختيارية" className="mt-2 w-full rounded-xl bg-black/30 p-3 text-xs"/><button disabled={busy} onClick={()=>run(()=>ytSendPay(Number(payId),Math.round(Number(payAmount)*1000),payNote),'تم تحويل YT Pay بنجاح.')} className="mt-2 w-full rounded-xl bg-emerald-500 py-3 text-sm font-black text-slate-950">إرسال مجاني عبر YT Pay</button></div>
          <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-4 text-xs text-slate-400">طلبات السحب النقدي تُربط بإجراءات السحب المعتمدة في المنصة بعد اعتماد قابلية السحب وسياسة الصرف.</div>
        </section>}

        {tab==='mine' && <section className="space-y-3">
          <div className={`rounded-3xl bg-[#171a22] p-5 ${GOLD}`}><div className="flex items-center gap-2"><Sparkles className="text-amber-300"/><h2 className="font-black">التعدين الإعلاني اليومي</h2></div><p className="my-3 text-sm text-slate-300">شاهد إعلاناً من إعلانات YT Coin المستقلة، وبعد التحقق تحصل على مكافأة يومية ثابتة.</p><div className="text-3xl font-black text-amber-300">0.010 YT</div><p className="mt-1 text-xs text-slate-500">مرة واحدة يومياً · بونص إحالة 0.001 YT</p><button disabled={busy||wallet?.last_daily_mine_date===new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Aden'})} onClick={()=>startAd('mining')} className="mt-4 w-full rounded-xl bg-amber-400 py-3 font-black text-slate-950"><Play className="inline ml-2" size={16}/>ابدأ إعلان التعدين</button><button disabled={busy} onClick={()=>run(ytClaimDaily,'تم إضافة مكافأة التعدين اليومية.')} className="mt-2 w-full rounded-xl border border-amber-300/40 py-3 font-bold text-amber-200">تحقق واستلام المكافأة</button></div>
          <div className={`rounded-2xl bg-[#11151e] p-4 ${GOLD}`}><h3 className="mb-2 font-bold"><Users className="inline ml-2 text-amber-300"/>الإحالات</h3><p className="text-xs leading-6 text-slate-400">يحصل المُحيل على 10% من مكافأة تعدينك اليومية، أي 0.001 YT، من مخصص التسويق والإحالات.</p><div className="mt-3 rounded-xl bg-black/30 p-3 text-xs break-all" dir="ltr">{user.referralCode? `${window.location.origin}/?ref=${user.referralCode}`:'كود الإحالة غير متاح في الملف الشخصي'}</div></div>
          <div className={`rounded-2xl bg-[#11151e] p-4 ${GOLD}`}><h3 className="mb-2 font-bold">الإعلانات المستقلة</h3>{ads.filter(a=>a.placement==='mining'||a.placement==='both').map(a=><div key={a.id} className="border-t border-white/10 py-3"><b className="text-sm">{a.title}</b><p className="text-xs text-slate-400">{a.description}</p></div>)}{ads.length===0&&<p className="text-xs text-slate-500">لا توجد إعلانات مفعّلة حالياً.</p>}</div>
        </section>}

        {tab==='admin' && isAdmin && <section className="space-y-3">
          <div className={`rounded-2xl bg-[#151923] p-4 ${GOLD}`}><h2 className="font-black">توزيع إيرادات الإعلانات</h2><p className="mt-1 text-xs text-slate-400">70% لصندوق سيولة المستخدمين · 30% لإيرادات الإدارة</p><input value={deposit} onChange={e=>setDeposit(e.target.value)} inputMode="decimal" placeholder="إجمالي الإيراد بالدولار" className="mt-3 w-full rounded-xl bg-black/30 p-3"/><div className="mt-2 grid grid-cols-2 gap-2 text-xs"><div className="rounded-xl bg-black/30 p-3">السيولة 70%<b className="block mt-1 text-emerald-300">{fmtUsd(Number(deposit||0)*.7)}</b></div><div className="rounded-xl bg-black/30 p-3">الإدارة 30%<b className="block mt-1 text-amber-300">{fmtUsd(Number(deposit||0)*.3)}</b></div></div><button disabled={busy||Number(deposit)<=0} onClick={()=>run(()=>ytDepositRevenue(Number(deposit)),'تم تسجيل الإيراد وتقسيمه 70/30.')} className="mt-3 w-full rounded-xl bg-amber-400 py-3 font-black text-slate-950">تسجيل إيرادات الإعلانات</button></div>
          <div className={`rounded-2xl bg-[#151923] p-4 ${GOLD}`}><h2 className="font-black">إدارة إعلانات YT Coin</h2><div className="mt-3 space-y-2"><input value={adDraft.title} onChange={e=>setAdDraft({...adDraft,title:e.target.value})} placeholder="عنوان الإعلان" className="w-full rounded-xl bg-black/30 p-3 text-sm"/><input value={adDraft.ad_url} onChange={e=>setAdDraft({...adDraft,ad_url:e.target.value})} placeholder="رابط الإعلان HTTPS" className="w-full rounded-xl bg-black/30 p-3 text-sm"/><textarea value={adDraft.description} onChange={e=>setAdDraft({...adDraft,description:e.target.value})} placeholder="وصف الإعلان" className="w-full rounded-xl bg-black/30 p-3 text-sm"/><select value={adDraft.placement} onChange={e=>setAdDraft({...adDraft,placement:e.target.value})} className="w-full rounded-xl bg-slate-800 p-3 text-sm"><option value="both">التعدين والتسييل</option><option value="mining">التعدين</option><option value="liquidation">التسييل</option></select><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={adDraft.is_active} onChange={e=>setAdDraft({...adDraft,is_active:e.target.checked})}/> تفعيل الإعلان</label><button disabled={busy} onClick={()=>run(async()=>{await ytManageAd({action:'upsert',...adDraft,placement:adDraft.placement as any});setAdDraft({title:'',description:'',ad_url:'',placement:'both',duration_seconds:30,is_active:false});},'تم حفظ الإعلان.')} className="w-full rounded-xl bg-amber-400 py-3 font-black text-slate-950"><Plus className="inline ml-2" size={16}/>حفظ الإعلان</button></div>{ads.map(a=><div key={a.id} className="flex items-center justify-between gap-2 border-t border-white/10 py-3"><div className="min-w-0"><b className="block truncate text-xs">{a.title}</b><span className="text-[10px] text-slate-500">{a.placement} · {a.is_active?'نشط':'متوقف'}</span></div><button onClick={()=>run(()=>ytManageAd({action:'delete',id:a.id}),'تم حذف الإعلان.')} className="rounded-lg p-2 text-rose-400"><Trash2 size={16}/></button></div>)}</div>
        </section>}

        <footer className="mt-5 flex items-center justify-center gap-2 text-[10px] text-slate-600"><LockKeyhole size={12}/> بيانات المحافظ تُدار حصرياً عبر قاعدة البيانات الآمنة</footer>
      </div>
    </main>
  );
};
