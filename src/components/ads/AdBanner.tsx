import React, { useEffect, useId, useRef, useState } from 'react';

export type AdPlacementId = 'home_hero_top';

export interface AdBannerProps {
  /** Placement identifier (restricted to the home page banner slot) */
  placement: AdPlacementId;
  /** Extra CSS classes for the outer wrapper */
  className?: string;
}

/**
 * Single verified HilltopAds Mobile Banner Zone (300x100) for Yemen Task Home page.
 * - Renders an in-page iframe banner (`300x100`) on Mobile User-Agents via `settings.appendTo`.
 * - Returns no banner payload on Desktop User-Agents, where the container collapses cleanly.
 * - Uses HilltopAds' single-zone `globalNameLoaded` lock (`ffe396`).
 */
export const PRIMARY_HILLTOP_MOBILE_BANNER_SRC =
  '//conventionalresponse.com/bgXTVTsgd.Gblm0xYwWMcj/neAm/9/usZhUbltkIPqTccZ2/MUzGQY4SOADxkCtmNMzkYez-NlDkgG5/MowW';

const HOME_ZONE_SCRIPT_SRC: string =
  import.meta.env.VITE_HILLTOP_ZONE_HOME || PRIMARY_HILLTOP_MOBILE_BANNER_SRC;

const injectedScriptUrls = new Set<string>();

class AdErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    if (import.meta.env.DEV) {
      console.warn('[AdBanner] Isolated ad rendering error:', error);
    }
  }

  render() {
    if (this.state.hasError) {
      return null;
    }
    return this.props.children;
  }
}

type AdLoadStatus = 'loading' | 'loaded' | 'fallback';

const AdBannerInner: React.FC<AdBannerProps> = ({ placement, className = '' }) => {
  const reactId = useId().replace(/:/g, '');
  const hostElementId = `hilltop-slot-${placement}-${reactId}`;

  const outerRef = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const hasAttemptedLoadRef = useRef(false);

  const resolvedSrc = HOME_ZONE_SCRIPT_SRC.trim();

  const [status, setStatus] = useState<AdLoadStatus>(() =>
    resolvedSrc ? 'loading' : 'fallback'
  );
  const [adSize, setAdSize] = useState<{ width: number; height: number }>({
    width: 300,
    height: 100,
  });
  const [availableWidth, setAvailableWidth] = useState<number>(300);

  // Measure available width for proportional scaling on viewports narrower than 300px
  useEffect(() => {
    const el = outerRef.current;
    if (!el || typeof window === 'undefined') return;

    const updateWidth = () => {
      const rectWidth = el.getBoundingClientRect().width;
      const horizontalPadding = 16;
      const usable = Math.max(0, Math.floor((rectWidth || window.innerWidth) - horizontalPadding));
      setAvailableWidth(usable);
    };

    updateWidth();

    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => updateWidth());
      ro.observe(el);
      return () => ro.disconnect();
    }

    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, [status]);

  // Browser-only HilltopAds script loader & DOM injection observer
  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    if (!resolvedSrc) {
      setStatus('fallback');
      return;
    }

    const hostEl = hostRef.current;
    if (!hostEl) return;

    // Prevent duplicate injection across re-renders or already-loaded Zone scripts
    const escapedSrc =
      typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
        ? CSS.escape(resolvedSrc)
        : resolvedSrc.replace(/"/g, '\\"');
    const alreadyInDom = Boolean(
      document.querySelector(`script[data-hilltop-src="${escapedSrc}"]`)
    );
    if (hasAttemptedLoadRef.current || injectedScriptUrls.has(resolvedSrc) || alreadyInDom) {
      const existingIframe = hostEl.querySelector('iframe');
      setStatus(existingIframe ? 'loaded' : 'fallback');
      return;
    }

    hasAttemptedLoadRef.current = true;
    injectedScriptUrls.add(resolvedSrc);
    setStatus('loading');

    let isDisposed = false;
    let fallbackTimer: number | undefined;

    const inspectInjectedAd = () => {
      if (isDisposed || !hostRef.current) return false;
      const iframe = hostRef.current.querySelector('iframe');
      if (!iframe) return false;

      const attrW = Number(iframe.getAttribute('width')) || 300;
      const attrH = Number(iframe.getAttribute('height')) || 100;
      setAdSize({ width: attrW, height: attrH });
      setStatus('loaded');
      if (fallbackTimer) {
        window.clearTimeout(fallbackTimer);
      }
      return true;
    };

    const observer = new MutationObserver(() => {
      inspectInjectedAd();
    });
    observer.observe(hostEl, { childList: true, subtree: true });

    try {
      const script = document.createElement('script') as HTMLScriptElement & {
        settings?: Record<string, unknown>;
      };
      script.settings = { appendTo: `#${hostElementId}` };
      script.src = resolvedSrc;
      script.async = true;
      script.referrerPolicy = 'no-referrer-when-downgrade';
      script.setAttribute('data-hilltop-placement', placement);
      script.setAttribute('data-hilltop-src', resolvedSrc);

      script.onload = () => {
        if (isDisposed) return;
        window.setTimeout(() => {
          if (!isDisposed) {
            inspectInjectedAd();
          }
        }, 250);
      };

      script.onerror = () => {
        if (isDisposed) return;
        setStatus('fallback');
      };

      hostEl.appendChild(script);

      // Collapse cleanly if HilltopAds delivers no banner payload (e.g. Desktop UA or ad-blocker)
      fallbackTimer = window.setTimeout(() => {
        if (!isDisposed && !inspectInjectedAd()) {
          setStatus('fallback');
        }
      }, 5000);
    } catch {
      setStatus('fallback');
    }

    return () => {
      isDisposed = true;
      observer.disconnect();
      if (fallbackTimer) {
        window.clearTimeout(fallbackTimer);
      }
    };
  }, [hostElementId, placement, resolvedSrc]);

  if (!resolvedSrc || status === 'fallback') {
    return null;
  }

  const isLoaded = status === 'loaded';
  const scale =
    availableWidth > 0 && availableWidth < adSize.width
      ? Math.max(0.5, availableWidth / adSize.width)
      : 1;
  const scaledWidth = Math.round(adSize.width * scale);
  const scaledHeight = Math.round(adSize.height * scale);

  return (
    <aside
      ref={outerRef}
      aria-label="مساحة إعلانية"
      data-ad-placement={placement}
      className={`w-full max-w-full overflow-hidden flex justify-center ${
        isLoaded ? 'my-4 px-2 sm:px-4' : 'my-0 h-0 opacity-0 pointer-events-none'
      } ${className}`.trim()}
    >
      <div
        className={`w-full max-w-[324px] rounded-2xl transition-opacity duration-200 ${
          isLoaded
            ? 'bg-slate-100/80 dark:bg-slate-900/70 border border-slate-200/80 dark:border-slate-800/80 px-3 py-2.5 flex flex-col items-center justify-center'
            : 'flex flex-col items-center justify-center'
        }`}
      >
        {isLoaded && (
          <div className="w-full flex items-center justify-between mb-1.5 px-0.5">
            <span className="text-[10px] font-semibold tracking-wide text-slate-400 dark:text-slate-500">
              إعلان
            </span>
          </div>
        )}

        <div
          dir="ltr"
          className="relative flex items-center justify-center overflow-hidden mx-auto max-w-full"
          style={
            isLoaded
              ? { width: `${scaledWidth}px`, height: `${scaledHeight}px` }
              : { width: `${adSize.width}px`, height: '0px' }
          }
        >
          <div
            id={hostElementId}
            ref={hostRef}
            className="flex items-center justify-center"
            style={
              isLoaded && scale < 1
                ? {
                    width: `${adSize.width}px`,
                    height: `${adSize.height}px`,
                    transform: `scale(${scale})`,
                    transformOrigin: 'center center',
                  }
                : {
                    width: `${adSize.width}px`,
                    height: isLoaded ? `${adSize.height}px` : '0px',
                  }
            }
          />
        </div>
      </div>
    </aside>
  );
};

export const AdBanner: React.FC<AdBannerProps> = (props) => {
  return (
    <AdErrorBoundary>
      <AdBannerInner {...props} />
    </AdErrorBoundary>
  );
};
