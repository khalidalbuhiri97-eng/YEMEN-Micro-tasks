import React, { useEffect, useState } from 'react';
import { checkIsStandalone } from '../pwa/PWAInstallButton.tsx';

const SPLASH_SESSION_KEY = 'yt_splash_shown_v1';

/**
 * Non-blocking animated Splash Screen overlay.
 * - Renders strictly as a fixed overlay (z-[9999]) so the main app, data fetches,
 *   and ad scripts (Adsterra, HilltopAds, ClixWall) initialize underneath with zero delay.
 * - Runs on every launch inside the installed Android app (standalone / TWA),
 *   and once per browser session for web visitors.
 */
export const SplashScreen: React.FC = () => {
  const [shouldRender, setShouldRender] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    const standalone = checkIsStandalone();
    if (standalone) return true;
    try {
      return !window.sessionStorage.getItem(SPLASH_SESSION_KEY);
    } catch {
      return false;
    }
  });

  const [isFadingOut, setIsFadingOut] = useState(false);

  useEffect(() => {
    if (!shouldRender) return;
    try {
      window.sessionStorage.setItem(SPLASH_SESSION_KEY, '1');
    } catch {
      // ignore sessionStorage restrictions
    }

    const fadeTimer = window.setTimeout(() => {
      setIsFadingOut(true);
    }, 2050);

    const removeTimer = window.setTimeout(() => {
      setShouldRender(false);
    }, 2550);

    return () => {
      window.clearTimeout(fadeTimer);
      window.clearTimeout(removeTimer);
    };
  }, [shouldRender]);

  if (!shouldRender) return null;

  return (
    <div
      role="status"
      aria-label="جاري تحميل تطبيق Yemen Task"
      className={`fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-gradient-to-b from-slate-950 via-emerald-950 to-slate-950 text-white select-none transition-opacity duration-500 ease-out ${
        isFadingOut ? 'opacity-0 pointer-events-none' : 'opacity-100'
      }`}
    >
      {/* Subtle ambient radial glow matching Yemen Task brand */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute w-72 h-72 rounded-full bg-emerald-500/20 blur-3xl animate-pulse"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute w-56 h-56 rounded-full bg-amber-400/10 blur-3xl translate-y-10"
      />

      <div className="relative flex flex-col items-center gap-5 px-6 text-center">
        {/* Official App Icon with animated ring */}
        <div className="relative flex items-center justify-center">
          <span
            aria-hidden="true"
            className="absolute -inset-3 rounded-[2rem] border border-emerald-400/35 animate-ping [animation-duration:2.2s]"
          />
          <span
            aria-hidden="true"
            className="absolute -inset-1.5 rounded-[1.75rem] bg-gradient-to-tr from-emerald-500/40 via-amber-400/30 to-teal-400/40 blur-md"
          />
          <div className="relative w-24 h-24 sm:w-28 sm:h-28 rounded-3xl overflow-hidden border-2 border-emerald-400/60 bg-emerald-950 shadow-2xl shadow-emerald-900/60 flex items-center justify-center animate-in zoom-in-90 duration-500">
            <img
              src="/brand-icon.png?v=3"
              alt="Yemen Task"
              width={112}
              height={112}
              decoding="sync"
              className="w-full h-full object-contain"
            />
          </div>
        </div>

        {/* Brand Wordmark */}
        <div className="space-y-1.5 animate-in fade-in slide-in-from-bottom-2 duration-500">
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white">
            Yemen <span className="text-emerald-400">Task</span>
          </h1>
          <p className="text-xs sm:text-sm font-bold text-amber-300/95 tracking-wide">
            كسب اليمن · المهام الرقمية والأرباح المباشرة
          </p>
        </div>

        {/* Sleek Smooth Progress Indicator */}
        <div className="w-44 h-1.5 rounded-full bg-white/10 overflow-hidden border border-white/10 mt-1">
          <div className="h-full w-full rounded-full bg-gradient-to-l from-amber-400 via-emerald-400 to-teal-400 origin-right animate-pulse" />
        </div>
      </div>
    </div>
  );
};
