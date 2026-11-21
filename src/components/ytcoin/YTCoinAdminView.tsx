import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client.ts';
import { useAuth } from '../../context/AuthContext.tsx';
import { Coins, RefreshCw, ShieldCheck, Users, Pickaxe, Database } from 'lucide-react';

const fmt = (units: number | string | null | undefined) =>
  (Number(units || 0) / 1_000_000).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 });

export const YTCoinAdminView: React.FC = () => {
  const { showToast } = useAuth();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await api.getYtCoinAdminSummary()); }
    catch (error: any) { showToast(error?.message || 'تعذر تحميل لوحة YT Coin', 'error'); }
    finally { setLoading(false); }
  }, [showToast]);
  useEffect(() => { void load(); }, [load]);

  const metrics = [
    { label: 'إجمالي المعروض الأقصى', value: fmt(data?.maxSupplyUnits) + ' YT', icon: Coins },
    { label: 'أرصدة المستخدمين', value: fmt(data?.userBalancesUnits) + ' YT', icon: Users },
    { label: 'خزينة مكافآت التعدين', value: fmt(data?.treasuryUnits) + ' YT', icon: Database },
    { label: 'مطالبات اليوم', value: String(data?.claimsToday ?? 0), icon: Pickaxe },
  ];
  return <div className="space-y-6" dir="rtl">
    <div className="flex items-center justify-between gap-3"><div><h2 className="text-xl font-black flex items-center gap-2"><Coins className="w-6 h-6 text-emerald-600" /> مركز التحكم بعملة YT Coin</h2><p className="text-xs text-slate-500 mt-1">لوحة مستقلة عن الخزينة والدفاتر المالية بالريال اليمني</p></div><button onClick={load} className="p-2 rounded-xl border border-slate-200 dark:border-slate-700"><RefreshCw className="w-4 h-4" /></button></div>
    <div className="rounded-2xl p-4 border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30"><p className="font-bold text-sm text-amber-900 dark:text-amber-200">التعدين متوقف بأمان</p><p className="text-xs text-amber-800 dark:text-amber-300 mt-1">سقف التعدين اليومي لم يُعتمد بعد. لا توجد أزرار لإصدار العملة أو تغيير السقف من هذه الواجهة.</p></div>
    <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">{metrics.map((m) => <div key={m.label} className="rounded-2xl p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800"><m.icon className="w-5 h-5 text-emerald-600 mb-3" /><p className="text-[11px] text-slate-500">{m.label}</p><strong className="block mt-1 text-lg font-black tabular-nums">{loading ? '—' : m.value}</strong></div>)}</div>
    <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 space-y-3"><h3 className="font-bold">قواعد التعدين المعتمدة</h3><div className="grid sm:grid-cols-3 gap-3 text-sm"><p className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800">بداية المكافأة <b>0.50 YT</b></p><p className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800">زيادة كل يوم <b>0.01 YT</b></p><p className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800">الحد الأعلى <b>1.50 YT</b></p></div><p className="text-xs text-slate-500">التوقيت: {data?.timezone || 'Asia/Aden'} · سقف التعدين اليومي: {data?.dailyCapUnits ? fmt(data.dailyCapUnits) + ' YT' : 'غير معتمد'}</p><p className="text-xs text-slate-500">عدد حسابات YT Coin: {data?.accountCount ?? 0} · إجمالي سجل الحركات: {data?.ledgerCount ?? 0}</p></div>
    <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5"><h3 className="font-bold mb-3 flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-emerald-600" /> التخصيصات</h3>{!data?.allocations?.length ? <p className="text-xs text-slate-400">لم تُنشأ تخصيصات إصدار بعد؛ لن تُفعّل تلقائياً حتى اعتمادها.</p> : data.allocations.map((a: any) => <div key={a.key} className="py-2 border-b last:border-0 border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3 text-xs"><span>{a.label}</span><span className="font-mono">{fmt(a.spentUnits)} / {fmt(a.allocatedUnits)} YT</span></div>)}</div>
  </div>;
};
