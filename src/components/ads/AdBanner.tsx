import React, { useEffect, useId, useRef, useState } from 'react';

export type AdPlacementId =
  | 'home_hero_top'
  | 'admin_top'
  | `tasks_after_${number}`
  | `categories_after_${number}`;

export type AdSlotGroup = 'home' | 'tasks' | 'categories' | 'admin';

export interface AdBannerProps {
  /** Unique identifier of the placement on the page */
  placement: AdPlacementId;
  /** Logical section group for layout spacing & optional per-section zone lookup */
  slotGroup?: AdSlotGroup;
  /** Optional explicit HilltopAds Zone script URL for this placement */
  scriptSrc?: string;
  /** Extra CSS classes for the outer wrapper (e.g. col-span-full inside CSS Grid) */
  className?: string;
  /** Security gate: when false, the ad slot is not rendered or loaded at all */
  enabled?: boolean;
}

/**
 * Primary verified HilltopAds Banner script provided for Yemen Task.
 * Live inspection of this Zone script shows:
 * - Format: In-page Banner (`bannerScript`)
 * - Dimensions: 300x100 on Mobile User-Agents; returns no banner payload on Desktop UAs
 * - Global singleton lock inside HilltopAds script (`globalNameLoaded: "ffe396"`)
 *
 * Because HilltopAds enforces one active instance per Zone via `globalNameLoaded`,
 * secondary placements (tasks, categories, admin) require their own independent
 * HilltopAds Zone script URLs rather than duplicating this single Zone URL.
 */
export const PRIMARY_HILLTOP_MOBILE_BANNER_SRC =
  '//conventionalresponse.com/bgXTVTsgd.Gblm0xYwWMcj/neAm/9/usZhUbltkIPqTccZ2/MUzGQY4SOADxkCtmNMzkYez-NlDkgG5/MowW';

const ENV_ZONE_OVERRIDES: Partial<Record<AdSlotGroup | 'home_hero_top', string>> = {
  home_hero_top: import.meta.env.VITE_HILLTOP_ZONE_HOME || PRIMARY_HILLTOP_MOBILE_BANNER_SRC,
  tasks: import.meta.env.VITE_HILLTOP_ZONE_TASKS || undefined,
  categories: import.meta.env.VITE_HILLTOP_ZONE_CATEGORIES || undefined,
  admin: import.meta.env.VITE_HILLTOP_ZONE_ADMIN || undefined,
};

const injectedScriptUrls = new Set<string>();

function resolveScriptSrc(
  placement: AdPlacementId,
  slotGroup?: AdSlotGroup,
  explicitSrc?: string
): string | undefined {
  if (explicitSrc && explicitSrc.trim()) {
    return explicitSrc.trim();
  }
  if (placement === 'home_hero_top') {
    return ENV_ZONE_OVERRIDES.home_hero_top;
  }
  if (slotGroup && ENV_ZONE_OVERRIDES[slotGroup]) {
    return ENV_ZONE_OVERRIDES[slotGroup];
  }
  return undefined;
}

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

type AdLoadStatus = 'idle' | 'loading' | 'loaded' | 'fallback';

const AdBannerInner: React.FC<AdBannerProps> = ({
  placement,
  slotGroup,
  scriptSrc,
  className = '',
  enabled = true,
}) => {
  const reactId = useId().replace(/:/g, '');
  const hostElementId = `hilltop-slot-${placement}-${reactId}`;

  const outerRef = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const hasAttemptedLoadRef = useRef(false);

  const resolvedSrc = enabled ? resolveScriptSrc(placement, slotGroup, scriptSrc) : undefined;

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
    if (!enabled || !resolvedSrc) {
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
      if (existingIframe) {
        setStatus('loaded');
      } else {
        setStatus('fallback');
      }
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
        // Check shortly after onload in case synchronous banner DOM insertion finished
        window.setTimeout(() => {
          if (!isDisposed && !inspectInjectedAd()) {
            // Leave remaining window for async iframe creation before falling back
          }
        }, 250);
      };

      script.onerror = () => {
        if (isDisposed) return;
        setStatus('fallback');
      };

      hostEl.appendChild(script);

      // Collapse cleanly if HilltopAds delivers no banner payload (e.g. Desktop UA, ad-blocker, unfilled zone)
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
  }, [enabled, hostElementId, placement, resolvedSrc]);

  if (!enabled || !resolvedSrc || status === 'fallback') {
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
