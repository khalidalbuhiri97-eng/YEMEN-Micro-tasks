import React, { useEffect, useId, useRef, useState } from 'react';

export interface AdsterraAdProps {
  /** Unique identifier isolating this ad placement from all other placements */
  placementId: string;
  /** Optional wrapper CSS classes (e.g., col-span-full inside CSS Grid) */
  className?: string;
}

const ADSTERRA_KEY = '4644701e0fd0cb6323d081bb79bf0e59';
const ADSTERRA_SCRIPT_SRC = 'https://bicea.org/22/4644701e0fd0cb6323d081bb79bf0e59';
const ADSTERRA_WIDTH = 320;
const ADSTERRA_HEIGHT = 50;

interface AdsterraOptions {
  key: string;
  format: 'iframe';
  height: number;
  width: number;
  params: Record<string, unknown>;
}

declare global {
  interface Window {
    atOptions?: AdsterraOptions;
  }
}

/**
 * Serializes Adsterra script injections so global `window.atOptions`
 * is cleanly bound to each placement script sequentially without race conditions.
 */
let adsterraLoadQueue: Promise<void> = Promise.resolve();

function enqueueAdsterraLoad(task: () => Promise<void>): void {
  adsterraLoadQueue = adsterraLoadQueue
    .then(task)
    .catch(() => {
      // Keep the shared queue healthy even if an individual placement fails
    });
}

class AdsterraErrorBoundary extends React.Component<
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
      console.warn('[AdsterraAd] Isolated ad error:', error);
    }
  }

  render() {
    if (this.state.hasError) {
      return null;
    }
    return this.props.children;
  }
}

type AdStatus = 'loading' | 'loaded' | 'fallback';

const AdsterraAdInner: React.FC<AdsterraAdProps> = ({ placementId, className = '' }) => {
  const reactId = useId().replace(/:/g, '');
  const containerDomId = `adsterra-slot-${placementId}-${reactId}`;

  const outerRef = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const hasAttemptedLoadRef = useRef(false);

  const [status, setStatus] = useState<AdStatus>('loading');
  const [adSize, setAdSize] = useState<{ width: number; height: number }>({
    width: ADSTERRA_WIDTH,
    height: ADSTERRA_HEIGHT,
  });
  const [availableWidth, setAvailableWidth] = useState<number>(ADSTERRA_WIDTH);

  useEffect(() => {
    const el = outerRef.current;
    if (!el || typeof window === 'undefined') return;

    const updateWidth = () => {
      const rectWidth = el.getBoundingClientRect().width;
      const horizontalPadding = 28;
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

  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    const hostEl = hostRef.current;
    if (!hostEl) return;

    const existingScript = hostEl.querySelector(
      `script[data-adsterra-placement="${placementId.replace(/"/g, '\\"')}"]`
    );
    if (hasAttemptedLoadRef.current || existingScript) {
      const existingCreative = hostEl.querySelector('iframe, ins, img, a');
      setStatus(existingCreative ? 'loaded' : 'fallback');
      return;
    }

    hasAttemptedLoadRef.current = true;
    setStatus('loading');

    let isDisposed = false;
    let fallbackTimer: number | undefined;
    let releaseQueueOnUnmount: (() => void) | undefined;

    const inspectRenderedCreative = (): boolean => {
      if (isDisposed || !hostRef.current) return false;
      const iframe = hostRef.current.querySelector('iframe');
      if (iframe) {
        const w = Number(iframe.getAttribute('width')) || ADSTERRA_WIDTH;
        const h = Number(iframe.getAttribute('height')) || ADSTERRA_HEIGHT;
        setAdSize({ width: w, height: h });
        setStatus('loaded');
        if (fallbackTimer) window.clearTimeout(fallbackTimer);
        return true;
      }

      const fallbackNode = hostRef.current.querySelector('ins, img, a, div');
      if (fallbackNode) {
        const hasVisibleContent =
          fallbackNode.tagName === 'IMG' ||
          Boolean(fallbackNode.querySelector('img, iframe')) ||
          (fallbackNode.textContent || '').trim().length > 0;
        if (hasVisibleContent) {
          setStatus('loaded');
          if (fallbackTimer) window.clearTimeout(fallbackTimer);
          return true;
        }
      }

      return false;
    };

    const observer = new MutationObserver(() => {
      inspectRenderedCreative();
    });
    observer.observe(hostEl, { childList: true, subtree: true });

    enqueueAdsterraLoad(
      () =>
        new Promise<void>((resolve) => {
          if (isDisposed || !hostRef.current || !document.body.contains(hostRef.current)) {
            resolve();
            return;
          }

          let settled = false;
          const finishSlotQueue = () => {
            if (!settled) {
              settled = true;
              resolve();
            }
          };
          releaseQueueOnUnmount = finishSlotQueue;

          const queueSafetyTimer = window.setTimeout(finishSlotQueue, 3500);

          try {
            window.atOptions = {
              key: ADSTERRA_KEY,
              format: 'iframe',
              height: ADSTERRA_HEIGHT,
              width: ADSTERRA_WIDTH,
              params: {},
            };

            const script = document.createElement('script');
            script.src = ADSTERRA_SCRIPT_SRC;
            script.async = true;
            script.referrerPolicy = 'no-referrer-when-downgrade';
            script.setAttribute('data-adsterra-placement', placementId);
            script.setAttribute('data-adsterra-key', ADSTERRA_KEY);

            script.onload = () => {
              window.clearTimeout(queueSafetyTimer);
              if (!isDisposed) {
                window.setTimeout(() => {
                  if (!isDisposed) {
                    inspectRenderedCreative();
                  }
                }, 250);
              }
              finishSlotQueue();
            };

            script.onerror = () => {
              window.clearTimeout(queueSafetyTimer);
              if (!isDisposed) {
                setStatus('fallback');
              }
              finishSlotQueue();
            };

            hostRef.current.appendChild(script);

            fallbackTimer = window.setTimeout(() => {
              if (!isDisposed && !inspectRenderedCreative()) {
                setStatus('fallback');
              }
            }, 5500);
          } catch {
            window.clearTimeout(queueSafetyTimer);
            if (!isDisposed) {
              setStatus('fallback');
            }
            finishSlotQueue();
          }
        })
    );

    return () => {
      isDisposed = true;
      observer.disconnect();
      if (fallbackTimer) {
        window.clearTimeout(fallbackTimer);
      }
      if (releaseQueueOnUnmount) {
        releaseQueueOnUnmount();
      }
      // Clean up ONLY this placement container without touching any other slots
      if (hostRef.current) {
        hostRef.current.replaceChildren();
      }
      hasAttemptedLoadRef.current = false;
    };
  }, [placementId]);

  if (status === 'fallback') {
    return null;
  }

  const isLoaded = status === 'loaded';
  const scale =
    availableWidth > 0 && availableWidth < adSize.width
      ? Math.max(0.6, availableWidth / adSize.width)
      : 1;
  const scaledWidth = Math.round(adSize.width * scale);
  const scaledHeight = Math.round(adSize.height * scale);

  return (
    <aside
      ref={outerRef}
      aria-label="مساحة إعلانية"
      data-adsterra-placement={placementId}
      className={`relative z-0 w-full max-w-full overflow-hidden flex justify-center ${
        isLoaded ? 'my-4 px-1.5 sm:px-3' : 'my-0 h-0 opacity-0 pointer-events-none'
      } ${className}`.trim()}
    >
      <div
        className={`w-full max-w-[356px] rounded-2xl transition-opacity duration-200 ${
          isLoaded
            ? 'bg-slate-100/80 dark:bg-slate-900/70 border border-slate-200/80 dark:border-slate-800/80 px-2 sm:px-3 py-2 flex flex-col items-center justify-center'
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
            id={containerDomId}
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

export const AdsterraAd: React.FC<AdsterraAdProps> = (props) => {
  return (
    <AdsterraErrorBoundary>
      <AdsterraAdInner {...props} />
    </AdsterraErrorBoundary>
  );
};
