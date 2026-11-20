import React, { useEffect, useState } from 'react';
import { Download, Smartphone, X, CheckCircle2, Share, MoreVertical } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

type DeviceType = 'ios' | 'android' | 'desktop';

function detectDeviceType(): DeviceType {
  if (typeof window === 'undefined') return 'desktop';
  const ua = window.navigator.userAgent.toLowerCase();
  if (/iphone|ipad|ipod/.test(ua)) return 'ios';
  if (/android/.test(ua)) return 'android';
  return 'desktop';
}

function checkIsStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

/**
 * Shared hook managing persistent PWA installation state.
 * Triggers native browser beforeinstallprompt.prompt() immediately when available
 * and never hides the install button until the app is genuinely installed.
 */
export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState<boolean>(() => checkIsStandalone());
  const [deviceType, setDeviceType] = useState<DeviceType>(() => detectDeviceType());
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    setIsInstalled(checkIsStandalone());
    setDeviceType(detectDeviceType());

    const mediaQuery = window.matchMedia('(display-mode: standalone)');
    const handleDisplayChange = (e: MediaQueryListEvent) => {
      if (e.matches) {
        setIsInstalled(true);
        setShowModal(false);
      }
    };

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
      setShowModal(false);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', handleDisplayChange);
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
      if (mediaQuery.removeEventListener) {
        mediaQuery.removeEventListener('change', handleDisplayChange);
      }
    };
  }, []);

  const triggerInstall = async () => {
    if (deferredPrompt) {
      const promptEvent = deferredPrompt;
      try {
        await promptEvent.prompt();
        const { outcome } = await promptEvent.userChoice;
        // Chromium consumes BeforeInstallPromptEvent once prompt() completes
        setDeferredPrompt(null);
        if (outcome === 'accepted') {
          setIsInstalled(true);
          setShowModal(false);
        }
      } catch {
        setDeferredPrompt(null);
        setShowModal(true);
      }
    } else {
      // Only shown when native beforeinstallprompt is not supported/emitted by this browser (e.g. iOS Safari)
      setShowModal(true);
    }
  };

  return {
    deferredPrompt,
    isInstalled,
    deviceType,
    showModal,
    setShowModal,
    triggerInstall,
  };
}

export const PWAInstallModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  deviceType: DeviceType;
  deferredPrompt: BeforeInstallPromptEvent | null;
  onNativeInstall: () => Promise<void>;
}> = ({ isOpen, onClose, deviceType, deferredPrompt, onNativeInstall }) => {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-slate-950/75 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-md w-full p-6 space-y-5 text-right relative"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="إغلاق نافذة التثبيت"
          className="absolute left-4 top-4 p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-full"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3.5">
          <img
            src="/brand-icon.png?v=3"
            alt="شعار Yemen Task"
            className="w-12 h-12 rounded-2xl object-contain border border-emerald-200 dark:border-emerald-800 shadow-sm shrink-0 bg-emerald-900"
          />
          <div>
            <h3 className="text-base font-extrabold text-slate-900 dark:text-white">
              تثبيت تطبيق Yemen Task
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {deferredPrompt
                ? 'المتصفح جاهز لتثبيت التطبيق مباشرة على جهازك.'
                : 'خيار التثبيت الرسمي عبر قائمة متصفحك الحالي.'}
            </p>
          </div>
        </div>

        <div className="space-y-3 text-xs text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/60 p-4 rounded-2xl border border-slate-200/70 dark:border-slate-700/70">
          <div className="flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
            <span>تشغيل مباشر بملء الشاشة كأي تطبيق مثبت على الجهاز.</span>
          </div>

          {deviceType === 'ios' && (
            <div className="border-t border-slate-200 dark:border-slate-700 pt-3 space-y-2">
              <p className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                <Share className="w-4 h-4 text-emerald-600" />
                <span>التثبيت الرسمي على iPhone / iPad (Safari):</span>
              </p>
              <ol className="list-decimal list-inside space-y-1 text-slate-600 dark:text-slate-300">
                <li>اضغط على زر <strong>المشاركة (Share)</strong> أسفل Safari.</li>
                <li>اختر <strong>إضافة إلى الشاشة الرئيسية (Add to Home Screen)</strong>.</li>
                <li>اضغط <strong>إضافة (Add)</strong> لتأكيد التثبيت.</li>
              </ol>
            </div>
          )}

          {deviceType === 'android' && !deferredPrompt && (
            <div className="border-t border-slate-200 dark:border-slate-700 pt-3 space-y-2">
              <p className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                <MoreVertical className="w-4 h-4 text-emerald-600" />
                <span>لم يُتح نافذة التثبيت التلقائية في هذا المتصفح:</span>
              </p>
              <ol className="list-decimal list-inside space-y-1 text-slate-600 dark:text-slate-300">
                <li>افتح قائمة المتصفح (<strong>⋮</strong>) في الأعلى.</li>
                <li>اختر <strong>تثبيت التطبيق</strong> أو <strong>الإضافة إلى الشاشة الرئيسية</strong>.</li>
              </ol>
            </div>
          )}

          {deviceType === 'desktop' && !deferredPrompt && (
            <div className="border-t border-slate-200 dark:border-slate-700 pt-3 space-y-1.5">
              <p className="font-bold text-slate-900 dark:text-white">التثبيت على الحاسوب (Chrome / Edge):</p>
              <p className="text-slate-600 dark:text-slate-300">
                استخدم أيقونة التثبيت في شريط العنوان أعلى المتصفح، أو اختر <strong>تثبيت Yemen Task</strong> من قائمة المتصفح.
              </p>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 pt-1">
          {deferredPrompt ? (
            <button
              type="button"
              onClick={onNativeInstall}
              className="flex-1 min-h-[44px] py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-lg shadow-emerald-600/20 transition-all flex items-center justify-center gap-2"
            >
              <Download className="w-4 h-4" />
              <span>تثبيت Yemen Task الآن</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="flex-1 min-h-[44px] py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-lg shadow-emerald-600/20 transition-all"
            >
              حسناً
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export const PWAInstallButton: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  const { deferredPrompt, isInstalled, deviceType, showModal, setShowModal, triggerInstall } = usePWAInstall();

  if (isInstalled) return null;

  return (
    <>
      <button
        type="button"
        onClick={triggerInstall}
        className={`inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-sm transition-colors shrink-0 cursor-pointer ${
          compact ? 'px-2.5 py-1.5' : 'px-3 py-2'
        }`}
        title="تثبيت تطبيق Yemen Task"
      >
        <Smartphone className="w-3.5 h-3.5 shrink-0" />
        <span>تثبيت التطبيق</span>
      </button>

      <PWAInstallModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        deviceType={deviceType}
        deferredPrompt={deferredPrompt}
        onNativeInstall={triggerInstall}
      />
    </>
  );
};

export const PWAInstallTopBanner: React.FC = () => {
  const { deferredPrompt, isInstalled, deviceType, showModal, setShowModal, triggerInstall } = usePWAInstall();

  if (isInstalled) return null;

  return (
    <>
      <div className="bg-slate-900 dark:bg-slate-950 text-white border-b border-emerald-500/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <img
              src="/brand-icon.png?v=3"
              alt="Yemen Task"
              className="w-7 h-7 rounded-lg object-contain shrink-0 border border-emerald-500/40 bg-emerald-950"
            />
            <div className="min-w-0">
              <p className="text-xs font-bold truncate">
                ثبّت تطبيق Yemen Task على جهازك للوصول الفوري
              </p>
              <p className="text-[11px] text-slate-300 hidden sm:block truncate">
                تجربة أسرع، إشعارات فورية، وتشغيل مستقل بملء الشاشة.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={triggerInstall}
            className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-colors cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 shrink-0" />
            <span>{deferredPrompt ? 'تثبيت الآن' : 'تثبيت التطبيق'}</span>
          </button>
        </div>
      </div>

      <PWAInstallModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        deviceType={deviceType}
        deferredPrompt={deferredPrompt}
        onNativeInstall={triggerInstall}
      />
    </>
  );
};
