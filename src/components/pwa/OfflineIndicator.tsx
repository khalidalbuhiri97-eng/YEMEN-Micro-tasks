import React, { useEffect, useState } from 'react';
import { WifiOff, RefreshCw } from 'lucide-react';

export const OfflineIndicator: React.FC = () => {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  if (isOnline) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 sm:left-6 sm:right-auto z-[90] flex items-center justify-between gap-3 rounded-2xl bg-amber-500 text-white px-4 py-3 shadow-2xl max-w-sm animate-in fade-in slide-in-from-bottom duration-200">
      <div className="flex items-center gap-2.5">
        <WifiOff className="w-5 h-5 shrink-0 animate-pulse" />
        <div className="text-xs">
          <div className="font-bold">أنت غير متصل بالإنترنت</div>
          <div className="opacity-90 text-[11px]">بعض الميزات تتطلب اتصالاً بالشبكة.</div>
        </div>
      </div>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="min-h-[36px] px-3 py-1.5 rounded-xl bg-white/20 hover:bg-white/30 text-white text-xs font-bold transition flex items-center gap-1.5 shrink-0"
      >
        <RefreshCw className="w-3.5 h-3.5" />
        <span>إعادة المحاولة</span>
      </button>
    </div>
  );
};
