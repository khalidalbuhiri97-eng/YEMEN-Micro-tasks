import React, { useCallback, useEffect, useState } from 'react';
import { Coins, RefreshCw, ShieldCheck } from 'lucide-react';
import { api } from '../../api/client.ts';

const fmt = (n: unknown) => (Number(n || 0) / 1_000_000).toLocaleString('en-US', { maximumFractionDigits: 2 });

export const YtCoinAdminView: React.FC = () => {
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const result = await api.getAdminYtCoinSummary();
      setSummary(result.summary);
    } catch (e: any) {
      setError(e?.message || 'تعذر تحميل بيانات YT Coin.');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const metrics = [
    ['رصيد خزينة التعدين', fmt(summary?.treasuryUnits), 'YT'],
    ['أرصدة المستخدمين', fmt(summary?.userBalancesUnits), 'YT'],
    ['إجمالي الإصدار الأقصى', fmt(summary?.maxSupplyUnits), 'YT'],
    ['السقف اليومي للمنصة', fmt(summary?.dailyCapUnits), 'YT'],
    ['المطالبات اليوم', Number(summary?.claimsToday || 0).toLocaleString('en-US'), 'مطالبة'],
    ['الموزع اليوم', fmt(summary?.minedTodayUnits), 'YT'],
    ['عدد الحسابات', Number(summary?.accountCount || 0).toLocaleString('en-US'), 'حساب'],
    ['سجلات دفتر YT', Number(summary?.ledgerCount || 0).toLocaleString('en-US'), 'سجل'],
  ];

  return (
    <section dir="rtl" className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Coins className="w-6 h-6 text-amber-500" />
          <div><h2 className="font-extrabold text-base text-slate-900 dark:text-white">خزينة وتعدين YT Coin</h2>
          <p className="text-[11px] text-slate-500">مراقبة مستقلة عن النظام المالي ومحافظ الريال اليمني</p></div>
        </div>
        <button onClick={load} disabled={loading} className="p-2 rounded-xl border border-slate-200 dark:border-slate-700"><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /></button>
      </div>
      {error && <p role="alert" className="text-xs text-rose-600">{error}</p>}
      {summary && <>
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/30 p-3 text-xs">
          <ShieldCheck className="w-4 h-4 text-emerald-600" />
          <strong>{summary.miningEnabled ? 'التعدين مفعّل' : 'التعدين متوقف'}</strong>
          <span className="text-slate-500">· المنطقة الزمنية: {summary.timezone}</span>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {metrics.map(([label,value,unit]) => <div key={label} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3">
            <span className="text-[11px] text-slate-500">{label}</span>
            <strong className="block mt-1 font-mono text-lg text-slate-900 dark:text-white">{value}</strong>
            <span className="text-[10px] text-slate-400">{unit}</span>
          </div>)}
        </div>
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <h3 className="font-bold text-sm mb-2">سياسة التعدين الفعالة</h3>
          <ul className="text-xs text-slate-600 dark:text-slate-300 space-y-1.5">
            <li>• بداية المكافأة: {fmt(summary.baseRewardUnits)} YT يومياً.</li>
            <li>• الزيادة اليومية المتتالية: {fmt(summary.incrementUnits)} YT.</li>
            <li>• الحد الأقصى للفرد: {fmt(summary.maxRewardUnits)} YT يومياً.</li>
            <li>• المطالبة مرة واحدة يومياً بتوقيت {summary.timezone}، مع شرط حساب نشط ومهمة معتمدة.</li>
          </ul>
        </div>
      </>}
    </section>
  );
};
