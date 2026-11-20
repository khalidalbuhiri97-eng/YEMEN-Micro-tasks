import React, { useEffect, useMemo, useState } from 'react';
import type { AdPartner } from '../../types/index.ts';
import { api } from '../../api/client.ts';
import { getCacheItem, saveCacheItem } from '../../services/offlineCache.ts';
import { ShieldCheck } from 'lucide-react';

interface SandboxedAdSlotProps {
  placementKey: string;
  partnersOverride?: AdPartner[];
  fallbackNode?: React.ReactNode;
  emptyPlaceholderText?: string;
  compact?: boolean;
  className?: string;
}

/**
 * Wraps arbitrary admin-configured HTML/JS/Iframe ad snippets inside a heavily
 * sandboxed iframe WITHOUT `allow-same-origin`, preventing any access to parent
 * DOM, localStorage tokens, cookies, IndexedDB, or ClixWall / Wallet APIs.
 */
export function buildSandboxedAdSrcDoc(partner: Pick<AdPartner, 'code' | 'codeType' | 'width' | 'height'>): string {
  const safeW = Math.min(1200, Math.max(100, Number(partner.width) || 300));
  const safeH = Math.min(800, Math.max(50, Number(partner.height) || 250));
  const rawCode = String(partner.code || '').trim();

  let bodyContent = rawCode;
  if (partner.codeType === 'javascript') {
    // Allow either raw JS statements or full <script>...</script> tags
    if (!/<script[\s>]/i.test(rawCode)) {
      bodyContent = `<script type="text/javascript">\n${rawCode}\n</script>`;
    }
  } else if (partner.codeType === 'iframe') {
    // Allow either pure https/http URL or clean <iframe> markup
    if (!/<iframe[\s>]/i.test(rawCode) && /^https?:\/\//i.test(rawCode)) {
      const escapedUrl = rawCode.replace(/"/g, '&quot;');
      bodyContent = `<iframe src="${escapedUrl}" width="${safeW}" height="${safeH}" frameborder="0" scrolling="no" referrerpolicy="no-referrer-when-downgrade" style="border:0;width:${safeW}px;height:${safeH}px;"></iframe>`;
    }
  }

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=${safeW}, initial-scale=1" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'self' https: http: data: 'unsafe-inline' 'unsafe-eval'; form-action 'none'; object-src 'none'; base-uri 'none';" />
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body {
      width: 100%;
      height: 100%;
      overflow: hidden;
      display: flex;
      justify-content: center;
      align-items: center;
      background: transparent;
      font-family: system-ui, -apple-system, sans-serif;
    }
  </style>
</head>
<body>${bodyContent}</body>
</html>`;
}

export const SandboxedAdSlot: React.FC<SandboxedAdSlotProps> = ({
  placementKey,
  partnersOverride,
  fallbackNode = null,
  emptyPlaceholderText,
  compact = false,
  className = '',
}) => {
  const [partners, setPartners] = useState<AdPartner[]>(partnersOverride || []);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isLoaded, setIsLoaded] = useState(Boolean(partnersOverride));

  useEffect(() => {
    if (partnersOverride) {
      setPartners(partnersOverride);
      setActiveIndex(0);
      setIsLoaded(true);
      return;
    }

    let cancelled = false;
    const cacheKey = `ad_partners_${placementKey}`;

    const loadPartners = async () => {
      try {
        const res = await api.getPublicAdPartners(placementKey);
        if (!cancelled && Array.isArray(res?.partners)) {
          setPartners(res.partners);
          saveCacheItem(cacheKey, res.partners).catch(() => {});
        }
      } catch {
        const cached = await getCacheItem<AdPartner[]>(cacheKey);
        if (!cancelled && Array.isArray(cached?.value)) {
          setPartners(cached.value);
        }
      } finally {
        if (!cancelled) setIsLoaded(true);
      }
    };

    loadPartners();
    return () => {
      cancelled = true;
    };
  }, [placementKey, partnersOverride]);

  const activePartners = useMemo(
    () => partners.filter((p) => p.isActive !== false && p.code?.trim()),
    [partners]
  );

  // Rotate only if there are multiple active partners and top priority uses 'rotate'
  const shouldRotate =
    activePartners.length > 1 && activePartners.some((p) => p.rotationMode === 'rotate');

  useEffect(() => {
    if (!shouldRotate) return;
    const timer = window.setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % activePartners.length);
    }, 12000);
    return () => window.clearInterval(timer);
  }, [shouldRotate, activePartners.length]);

  const currentPartner =
    activePartners.length > 0 ? activePartners[activeIndex % activePartners.length] : null;

  if (!currentPartner) {
    if (fallbackNode) return <>{fallbackNode}</>;
    if (isLoaded && emptyPlaceholderText) {
      return (
        <div
          className={`rounded-xl border border-dashed border-slate-200 dark:border-slate-700/80 bg-slate-50/70 dark:bg-slate-900/50 px-3 py-2 text-center text-[11px] text-slate-500 dark:text-slate-400 flex items-center justify-center gap-1.5 ${className}`}
        >
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
          <span>{emptyPlaceholderText}</span>
        </div>
      );
    }
    return null;
  }

  const srcDoc = buildSandboxedAdSrcDoc(currentPartner);
  const w = Math.min(1200, Math.max(100, Number(currentPartner.width) || 300));
  const h = Math.min(800, Math.max(50, Number(currentPartner.height) || 250));

  return (
    <div
      className={`rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm ${
        compact ? 'p-2' : 'p-3'
      } flex flex-col items-center justify-center ${className}`}
    >
      <div className="w-full flex items-center justify-between mb-1.5 px-1 text-[10px] text-slate-400 dark:text-slate-500 font-medium">
        <span className="truncate max-w-[70%] font-semibold text-slate-500 dark:text-slate-400">
          شريك إعلاني · {currentPartner.partnerName}
        </span>
        <span className="font-mono tabular-nums">
          {w}×{h}
        </span>
      </div>

      <div
        className="max-w-full rounded-xl overflow-hidden bg-slate-50 dark:bg-slate-950 flex items-center justify-center border border-slate-100 dark:border-slate-800/80"
        style={{ width: `${w}px`, height: `${h}px` }}
      >
        <iframe
          key={currentPartner.id}
          srcDoc={srcDoc}
          width={w}
          height={h}
          title={`إعلان ${currentPartner.partnerName}`}
          sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
          referrerPolicy="no-referrer"
          className="border-0 block mx-auto bg-transparent max-w-full"
          style={{ width: `${w}px`, height: `${h}px` }}
          scrolling="no"
        />
      </div>

      {activePartners.length > 1 && (
        <div className="mt-2 flex items-center justify-center gap-1.5">
          {activePartners.map((p, idx) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setActiveIndex(idx)}
              aria-label={`عرض إعلان ${p.partnerName}`}
              className={`h-1.5 rounded-full transition-all ${
                idx === activeIndex % activePartners.length
                  ? 'w-4 bg-emerald-600'
                  : 'w-1.5 bg-slate-300 dark:bg-slate-700'
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
};
