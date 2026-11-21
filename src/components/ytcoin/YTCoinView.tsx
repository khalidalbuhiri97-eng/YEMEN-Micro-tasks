import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client.ts';
import { useAuth } from '../../context/AuthContext.tsx';
import { Coins, Pickaxe, ShieldCheck, Clock3, History, RefreshCw } from 'lucide-react';

const fmt = (units: number | string | null | undefined) =>
  (Number(units || 0) / 1_000_000).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 });

export const YTCoinView: React.FC = () => {
  const { user, openAuthModal, showToast } = useAuth();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);

  const load = useCallback(async () => {
    if (!user) { setLoading(false); return; }
    setLoading(true);
    try { setData(await api.getMyYtCoin()); }
    catch (error: any) { showToast(error?.message || 'تعذر تحميل بيانات YT Coin', 'error'); }
    finally { setLoading(false); }
  }, [user, showToast]);

  useEffect(() => { void load(); }, [load]);

  const claim = async () => {
    if (!data?.miningEnabled || claiming) return;
    setClaiming(true);
    try {
      const result = await api.claimYtCoinDaily();
      showToast(result?.message || (result?.success ? 'تم استلام مكافأة التعدين' : 'لم يتم تنفيذ المطالبة'), result?.success ? 'success' : 'info');
      await load();
    } catch (error: any) { showToast(error?.message || 'تعذر تنفيذ التعدين', 'error'); }
    finally { setClaiming(false); }
  };

  if (!user) return (
    <div className="max-w-xl mx-auto rounded-3xl border border-emerald-200 dark:border-emerald-900 bg-white dark:bg-slate-900 p-8 text-center space-y-4">
      <Coins className="w-12 h-12 mx-auto text-emerald-600" />
      <h1 className="text-xl font-black">YT Coin</h1>
      <p className="text-sm text-slate-500">سجّل الدخول لعرض رصيد عملتك وسجل التعدين.</p>
      <button onClick={() => openAuthModal('login')} className="px-6 py-3 rounded-xl bg-emerald-600 text-white font-bold">تسجيل الدخول</button>
    </div>
  );

  return (
    <div className="max-w-5xl mx-auto space-y-6" dir="rtl">
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-700 via-teal-800 to-slate-950 p-6 sm:p-8 text-white shadow-xl">
        <div className="absolute -left-12 -top-12 w-48 h-48 rounded-full bg-white/5" />
        <div className="relative flex items-center justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 text-emerald-100 text-xs font-bold mb-3"><Coins className="w-4 h-4" /> العملة الرقمية الداخلية</div>
            <h1 className="text-3xl sm:text-4xl font-black tracking-tight">YT Coin</h1>
            <p className="text-sm text-emerald-100 mt-2">رصيدك وسجل المكافآت داخل Yemen Task</p>
          </div>
          <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-3xl bg-white/10 border border-white/20 flex items-center justify-center"><Coins className="w-10 h-10" /></div>
        </div>
        <div className="relative mt-8">
          <p className="text-xs text-emerald-100">رصيد YT Coin المتاح</p>
          <div className="text-4xl sm:text-5xl font-black font-mono mt-1 tabular-nums">{loading ? '—' : fmt(data?.balanceUnits)} <span className="text-xl">YT</span></div>
          <p className="text-[11px] text-emerald-100/80 mt-2">السعر المرجعي الداخلي: 1 YT = 0.01 ريال يمني، وليس وعداً بالاسترداد النقدي.</p>
        </div>
      </section>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="rounded-2xl p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800"><span className="text-xs text-slate-500">إجمالي ما كسبته</span><strong className="block mt-2 text-xl font-black text-emerald-600">{fmt(data?.lifetimeEarnedUnits)} YT</strong></div>
        <div className="rounded-2xl p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800"><span className="text-xs text-slate-500">التعدين المتتالي</span><strong className="block mt-2 text-xl font-black">{data?.streakDay || 0} يوم</strong></div>
        <div className="rounded-2xl p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 col-span-2 sm:col-span-1"><span className="text-xs text-slate-500">المكافأة التالية</span><strong className="block mt-2 text-xl font-black">{fmt(data?.nextRewardUnits)} YT</strong></div>
      </div>

      <section className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 sm:p-6 space-y-4">
        <div className="flex items-center gap-2"><Pickaxe className="w-5 h-5 text-emerald-600" /><h2 className="font-black">التعدين اليومي</h2></div>
        <div className="rounded-2xl p-4 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 flex gap-3">
          <Clock3 className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div><p className="font-bold text-sm text-amber-900 dark:text-amber-200">التعدين لم يُطلق بعد</p><p className="text-xs leading-6 text-amber-800 dark:text-amber-300 mt-1">سيبدأ بعد اعتماد سقف التعدين اليومي الثابت وإعلان الإطلاق. لن تُصرف أي مكافآت قبل ذلك.</p></div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs text-slate-600 dark:text-slate-300">
          <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800">البداية: <strong>0.50 YT</strong></div>
          <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800">الزيادة اليومية: <strong>0.01 YT</strong></div>
          <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800">الحد الأقصى: <strong>1.50 YT</strong></div>
        </div>
        <button disabled={!data?.miningEnabled || claiming || loading} onClick={claim} className="w-full py-3 rounded-xl bg-emerald-600 text-white font-bold disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"><Pickaxe className="w-4 h-4" />{claiming ? 'جارٍ التحقق...' : 'المطالبة بمكافأة اليوم'}</button>
        <p className="text-[11px] text-slate-400">الأهلية: حساب نشط ومهمة واحدة معتمدة على الأقل. يعتمد اليوم على توقيت الخادم Asia/Aden، ويعود التسلسل إلى 0.50 YT عند تفويت يوم.</p>
      </section>

      <section className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 sm:p-6">
        <div className="flex items-center justify-between mb-4"><div className="flex items-center gap-2"><History className="w-5 h-5 text-emerald-600" /><h2 className="font-black">سجل YT Coin</h2></div><button onClick={load} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="تحديث"><RefreshCw className="w-4 h-4" /></button></div>
        {loading ? <p className="text-sm text-slate-400">جارٍ تحميل السجل...</p> : !data?.history?.length ? <p className="text-sm text-slate-400 text-center py-8">لا توجد حركات بعد.</p> : <div className="divide-y divide-slate-100 dark:divide-slate-800">{data.history.map((item: any) => <div key={item.id} className="py-3 flex items-center justify-between gap-3"><div><p className="text-sm font-bold">{item.eventType === 'mining_reward' ? 'مكافأة تعدين' : item.eventType}</p><p className="text-[11px] text-slate-400">{new Date(item.createdAt).toLocaleString('ar-YE')}</p></div><strong className="text-emerald-600 font-mono">+{fmt(item.amountUnits)} YT</strong></div>)}</div>}
      </section>
      <p className="text-[11px] text-slate-400 flex items-center gap-2"><ShieldCheck className="w-4 h-4" /> YT Coin منفصلة عن محفظة الريال اليمني والدفاتر المالية الحالية.</p>
    </div>
  );
};
