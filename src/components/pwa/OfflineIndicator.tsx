import React, { useEffect, useRef, useState } from 'react';
import { WifiOff, Wifi, RefreshCw } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.tsx';

export const OfflineIndicator: React.FC = () => {
  const { isOnline } = useAuth();
  const [justReconnected, setJustReconnected] = useState(false);
  const wasOfflineRef = useRef(false);

  useEffect(() => {
    if (!isOnline) {
      wasOfflineRef.current = true;
      setJustReconnected(false);
    } else if (wasOfflineRef.current) {
      wasOfflineRef.current = false;
      setJustReconnected(true);
      const timer = window.setTimeout(() => setJustReconnected(false), 3500);
      return () => window.clearTimeout(timer);
    }
  }, [isOnline]);

  if (isOnline && !justReconnected) return null;

  if (justReconnected) {
    return (
      <div className="fixed bottom-16 md:bottom-5 left-4 right-4 sm:left-6 sm:right-auto z-[90] flex items-center gap-2.5 rounded-2xl bg-emerald-700 text-white px-4 py-3 shadow-xl max-w-sm border border-emerald-500/40">
        <Wifi className="w-4 h-4 shrink-0" />
        <div className="text-xs font-bold">تمت استعادة الاتصال بالشبكة ومزامنة بياناتك.</div>
      </div>
    );
  }

  return (
    <div className="fixed bottom-16 md:bottom-5 left-4 right-4 sm:left-6 sm:right-auto z-[90] flex items-center justify-between gap-3 rounded-2xl bg-slate-900 dark:bg-slate-800 text-white px-4 py-3 shadow-2xl max-w-md border border-amber-500/50">
      <div className="flex items-center gap-2.5 min-w-0">
        <WifiOff className="w-5 h-5 text-amber-400 shrink-0" />
        <div className="text-xs min-w-0">
          <div className="font-bold text-amber-300">أنت غير متصل بالإنترنت</div>
          <div className="text-slate-300 text-[11px] leading-snug">
            تُعرض آخر المهام المحفوظة مؤقتاً؛ العمليات المالية تتطلب اتصالاً نشطاً.
          </div>
        </div>
      </div>
      <button
        type="button"
        onClick={() => window.dispatchEvent(new CustomEvent('kasb:sync_online'))}
        className="min-h-[36px] px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-colors flex items-center gap-1.5 shrink-0 cursor-pointer"
      >
        <RefreshCw className="w-3.5 h-3.5" />
        <span>فحص الاتصال</span>
      </button>
    </div>
  );
};
