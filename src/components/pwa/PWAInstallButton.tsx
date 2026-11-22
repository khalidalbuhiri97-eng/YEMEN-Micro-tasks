import React, { useEffect, useState } from 'react';
import { Download } from 'lucide-react';

export function checkIsStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true ||
    (typeof document !== 'undefined' && document.referrer.startsWith('android-app://'))
  );
}

export function useIsStandalone(): boolean {
  const [isStandalone, setIsStandalone] = useState<boolean>(() => checkIsStandalone());

  useEffect(() => {
    setIsStandalone(checkIsStandalone());
    const mediaQuery = window.matchMedia('(display-mode: standalone)');
    const handleChange = () => setIsStandalone(checkIsStandalone());
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', handleChange);
    }
    return () => {
      if (mediaQuery.removeEventListener) {
        mediaQuery.removeEventListener('change', handleChange);
      }
    };
  }, []);

  return isStandalone;
}

export type ApkButtonVariant = 'primary' | 'compact' | 'full';

export const AndroidApkDownloadButton: React.FC<{
  variant?: ApkButtonVariant;
  className?: string;
}> = ({ variant = 'primary', className = '' }) => {
  const isStandalone = useIsStandalone();

  // Hide completely when opened inside the installed Android APK / standalone TWA
  if (isStandalone) return null;

  if (variant === 'compact') {
    return (
      <a
        href="/app.apk"
        download="Yemen-Task.apk"
        title="تحميل التطبيق للأندرويد (APK)"
        className={`inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-xl bg-gradient-to-l from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white text-xs font-extrabold shadow-xs border border-emerald-400/40 transition-all shrink-0 cursor-pointer active:scale-[0.98] ${className}`}
      >
        <Download className="w-3.5 h-3.5 shrink-0" />
        <span className="whitespace-nowrap">تحميل التطبيق (APK)</span>
      </a>
    );
  }

  if (variant === 'full') {
    return (
      <a
        href="/app.apk"
        download="Yemen-Task.apk"
        className={`w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-l from-emerald-600 via-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-extrabold text-xs shadow-md shadow-emerald-600/20 border border-emerald-400/40 transition-all cursor-pointer active:scale-[0.98] ${className}`}
      >
        <Download className="w-4 h-4 shrink-0" />
        <span>تحميل التطبيق للأندرويد (APK)</span>
      </a>
    );
  }

  return (
    <a
      href="/app.apk"
      download="Yemen-Task.apk"
      className={`inline-flex items-center justify-center gap-2.5 px-4 py-3 rounded-xl bg-gradient-to-l from-emerald-600 via-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-extrabold text-sm shadow-md shadow-emerald-600/25 hover:shadow-lg border border-emerald-400/40 transition-all shrink-0 cursor-pointer active:scale-[0.98] ${className}`}
    >
      <Download className="w-4 h-4 shrink-0" />
      <span>تحميل التطبيق للأندرويد (APK)</span>
    </a>
  );
};
