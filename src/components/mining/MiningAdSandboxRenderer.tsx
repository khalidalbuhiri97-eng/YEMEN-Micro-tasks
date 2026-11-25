import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import type {
  AdCenterComfortSettings,
  AdTrackingSessionRecord,
  MiningAdFormat,
  MiningAdPlacement,
  MiningAdTemplate,
  MiningAdTemplateType,
} from '../../types/index.ts';
import { api } from '../../api/client.ts';
import { useAuth } from '../../context/AuthContext.tsx';
import { formatYt } from '../../../shared/ytCoin.ts';
import {
  DISPLAY_BANNER_FORMATS,
  REWARD_ELIGIBLE_AD_FORMATS,
  buildMiningAdSrcDoc,
  extractAdZoneKey,
  isDisplayBannerTemplate,
  isExoClickCode,
  isRewardEligibleTemplate,
} from '../../../shared/miningAdBannerUtils.ts';

export {
  DISPLAY_BANNER_FORMATS,
  REWARD_ELIGIBLE_AD_FORMATS,
  buildMiningAdSrcDoc,
  extractAdZoneKey,
  isDisplayBannerTemplate,
  isExoClickCode,
  isRewardEligibleTemplate,
};
import {
  ExternalLink,
  ShieldCheck,
  PlayCircle,
  Image as ImageIcon,
  Code2,
  Link2,
  Layers,
  Sparkles,
  Loader2,
  Eye,
  MousePointerClick,
  Clock,
  CheckCircle2,
  PauseCircle,
  X,
  VolumeX,
  Volume2,
  AlertTriangle,
} from 'lucide-react';

export interface ConnectedYtNetworkLite {
  id: string;
  networkKey: string;
  displayName: string;
  adType: 'view' | 'click' | 'both';
  rewardClickYt: number;
  rewardViewYt: number;
  dailyUserLimit: number;
  isActive: boolean;
  isConnected: boolean;
}

export const TEMPLATE_TYPE_LABELS: Record<MiningAdTemplateType, string> = {
  html: 'كود HTML مدمج',
  javascript: 'سكربت JavaScript معزول',
  external_link: 'إعلان رابط خارجي',
  video_player: 'مشغل فيديو إعلاني',
  vast_url: 'رابط VAST XML للفيديو',
  image_banner: 'بانر إعلاني مصوّر',
  recommendation_widget: 'وحدة توصيات (Recommendation Widget)',
  network_code: 'كود شبكة إعلانات',
  multi_format: 'إعلان متعدد الأشكال (Multi Format)',
  push_notification: 'إشعار Push ترويجي (Opt-in)',
  mixed: 'قالب مختلط (كود + رابط/وسائط)',
};

export const AD_FORMAT_LABELS: Record<MiningAdFormat, string> = {
  banner: 'Banner (ويب قياسي)',
  popunder: 'Popunder (معطّل افتراضياً للراحة)',
  instant_message: 'Instant Message (رسالة مدمجة)',
  sticky_banner: 'Sticky Banner (بانر لاصق قابل للإغلاق)',
  desktop_interstitial: 'Desktop Interstitial (بيني لسطح المكتب)',
  mobile_banner: 'Mobile Banner (بانر للهواتف)',
  mobile_sticky_banner: 'Mobile Sticky Banner (لاصق للجوال)',
  mobile_interstitial: 'Mobile Interstitial (بيني للجوال)',
  instream_video: 'In-Stream Video (VAST)',
  invideo_banner: 'InVideo Banner (VAST)',
  video_slider: 'Video Slider (فيديو منزلق)',
  outstream_video: 'Outstream Video (فيديو مستقل)',
  vertical_video: 'Vertical Video (VAST عمودي)',
  recommendation_widget: 'Recommendation Widget (توصيات)',
  native_cards: 'Native Cards (بطاقات أصلية)',
  push_notification: 'Push Notification (تنبيهات اختيارية)',
  multi_format: 'Multi Format (تكيفي متعدد)',
  external_link: 'External Link (رابط خارجي)',
};

export function sanitizeHttpHref(raw?: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  const lower = trimmed.toLowerCase();
  if (lower.includes('javascript:') || lower.includes('vbscript:') || lower.includes('data:text/html')) {
    return null;
  }
  return trimmed;
}

function extractDomain(url: string | null): string {
  if (!url) return '';
  try {
    return new URL(url).hostname.replace(/^www\./i, '');
  } catch {
    return '';
  }
}

export function detectCurrentDeviceType(): 'desktop' | 'mobile' {
  if (typeof window === 'undefined') return 'mobile';
  return window.innerWidth >= 768 ? 'desktop' : 'mobile';
}

// Module-level mounted zone ownership registry so an ExoClick zone (e.g., 6104102)
// is never mounted twice simultaneously across slots or sub-pages.
const mountedAdZoneOwners = new Map<string, string>();

function toSafeVideoEmbedUrl(url: string): { kind: 'iframe' | 'video'; src: string } {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host.includes('youtube.com') || host === 'youtu.be') {
      let videoId = '';
      if (host === 'youtu.be') {
        videoId = parsed.pathname.replace(/^\//, '').split('/')[0] || '';
      } else if (parsed.pathname.startsWith('/shorts/')) {
        videoId = parsed.pathname.split('/')[2] || '';
      } else if (parsed.pathname.startsWith('/embed/')) {
        videoId = parsed.pathname.split('/')[2] || '';
      } else {
        videoId = parsed.searchParams.get('v') || '';
      }
      if (videoId && /^[a-zA-Z0-9_-]{6,20}$/.test(videoId)) {
        return {
          kind: 'iframe',
          src: `https://www.youtube-nocookie.com/embed/${videoId}?rel=0&modestbranding=1`,
        };
      }
    }
    if (host.includes('vimeo.com') && !host.includes('player.vimeo.com')) {
      const idMatch = parsed.pathname.match(/\/(\d{5,15})/);
      if (idMatch?.[1]) {
        return { kind: 'iframe', src: `https://player.vimeo.com/video/${idMatch[1]}` };
      }
    }
    if (host.includes('player.vimeo.com')) {
      return { kind: 'iframe', src: url };
    }
  } catch {
    // ignore URL parse errors
  }
  return { kind: 'video', src: url };
}

interface ParsedVastResult {
  kind: 'linear' | 'nonlinear' | null;
  mediaUrl: string | null;
  nonLinearImageUrl: string | null;
  clickThroughUrl: string | null;
  durationSec: number;
  wrapperUrl: string | null;
  impressionUrls: string[];
  trackingUrls: Record<string, string[]>;
  errorMessage?: string;
}

function parseVastDurationToSec(raw?: string | null): number {
  const val = String(raw || '').trim();
  const match = val.match(/^(\d{1,2}):(\d{2}):(\d{2})(?:\.\d+)?$/);
  if (!match) return 30;
  const sec = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  return Number.isFinite(sec) && sec > 0 ? Math.min(180, Math.max(10, sec)) : 30;
}

function fireVastBeaconUrls(urls: string[]) {
  if (typeof window === 'undefined' || !Array.isArray(urls) || urls.length === 0) return;
  for (const raw of urls) {
    const safe = sanitizeHttpHref(raw);
    if (!safe) continue;
    try {
      void fetch(safe, { mode: 'no-cors', credentials: 'omit', keepalive: true }).catch(() => {});
    } catch {
      try {
        const img = new Image();
        img.referrerPolicy = 'origin';
        img.src = safe;
      } catch {
        // ignore beacon errors
      }
    }
  }
}

function parseVastXmlSafe(xmlText: string): ParsedVastResult {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, 'text/xml');
    const parseErr = doc.querySelector('parsererror');
    if (parseErr) {
      return {
        kind: null,
        mediaUrl: null,
        nonLinearImageUrl: null,
        clickThroughUrl: null,
        durationSec: 30,
        wrapperUrl: null,
        impressionUrls: [],
        trackingUrls: {},
        errorMessage: 'تنسيق ملف VAST XML غير صالح.',
      };
    }

    const impressionUrls = Array.from(doc.querySelectorAll('Impression'))
      .map((n) => sanitizeHttpHref(n.textContent))
      .filter((u): u is string => Boolean(u));

    const trackingUrls: Record<string, string[]> = {};
    for (const tr of Array.from(doc.querySelectorAll('Tracking'))) {
      const ev = String(tr.getAttribute('event') || '').trim();
      const url = sanitizeHttpHref(tr.textContent);
      if (ev && url) {
        if (!trackingUrls[ev]) trackingUrls[ev] = [];
        trackingUrls[ev].push(url);
      }
    }

    const wrapperTag = sanitizeHttpHref(doc.querySelector('Wrapper > VASTAdTagURI, VASTAdTagURI')?.textContent);
    if (wrapperTag) {
      return {
        kind: null,
        mediaUrl: null,
        nonLinearImageUrl: null,
        clickThroughUrl: null,
        durationSec: 30,
        wrapperUrl: wrapperTag,
        impressionUrls,
        trackingUrls,
      };
    }

    const mediaNodes = Array.from(doc.querySelectorAll('MediaFile'));
    let chosenMedia: string | null = null;
    for (const node of mediaNodes) {
      const type = String(node.getAttribute('type') || '').toLowerCase();
      const rawUrl = sanitizeHttpHref(node.textContent);
      if (rawUrl && (type.includes('mp4') || type.includes('webm') || !chosenMedia)) {
        chosenMedia = rawUrl;
        if (type.includes('mp4')) break;
      }
    }

    if (chosenMedia) {
      const clickNode = doc.querySelector('ClickThrough');
      const clickThroughUrl = sanitizeHttpHref(clickNode?.textContent);
      const durationNode = doc.querySelector('Duration');
      return {
        kind: 'linear',
        mediaUrl: chosenMedia,
        nonLinearImageUrl: null,
        clickThroughUrl,
        durationSec: parseVastDurationToSec(durationNode?.textContent),
        wrapperUrl: null,
        impressionUrls,
        trackingUrls,
      };
    }

    // Fallback: VAST NonLinear / InVideo creative (e.g., ExoClick Zone 6104150 StaticResource)
    const nonLinearEl = doc.querySelector('NonLinear');
    if (nonLinearEl) {
      const staticImg = sanitizeHttpHref(nonLinearEl.querySelector('StaticResource')?.textContent);
      const nlClick = sanitizeHttpHref(
        nonLinearEl.querySelector('NonLinearClickThrough')?.textContent ||
          doc.querySelector('ClickThrough')?.textContent
      );
      const nlTracking = Array.from(nonLinearEl.querySelectorAll('NonLinearClickTracking'))
        .map((n) => sanitizeHttpHref(n.textContent))
        .filter((u): u is string => Boolean(u));
      if (nlTracking.length > 0) {
        trackingUrls.clickThrough = [...(trackingUrls.clickThrough || []), ...nlTracking];
      }
      if (staticImg) {
        return {
          kind: 'nonlinear',
          mediaUrl: null,
          nonLinearImageUrl: staticImg,
          clickThroughUrl: nlClick,
          durationSec: parseVastDurationToSec(nonLinearEl.getAttribute('minSuggestedDuration')),
          wrapperUrl: null,
          impressionUrls,
          trackingUrls,
        };
      }
    }

    return {
      kind: null,
      mediaUrl: null,
      nonLinearImageUrl: null,
      clickThroughUrl: null,
      durationSec: 30,
      wrapperUrl: null,
      impressionUrls,
      trackingUrls,
      errorMessage: 'لا يوجد ملف فيديو MP4/WebM أو محتوى إعلاني متوافق داخل VAST XML (قد لا يتوفر إعلان حالياً).',
    };
  } catch {
    return {
      kind: null,
      mediaUrl: null,
      nonLinearImageUrl: null,
      clickThroughUrl: null,
      durationSec: 30,
      wrapperUrl: null,
      impressionUrls: [],
      trackingUrls: {},
      errorMessage: 'تعذر تحليل استجابة VAST XML.',
    };
  }
}

/**
 * Tracked Video / VAST Player (muted by default, explicit user click to play, dispatches real VAST milestones)
 */
const TrackedVastVideoBox: React.FC<{
  template: MiningAdTemplate;
  videoSrc: string | null;
  vastUrl: string | null;
  maxHeight: number;
  maxWidth: number;
  isPreview: boolean;
  onEmitVastEvent: (
    eventName:
      | 'vast_impression'
      | 'vast_start'
      | 'vast_firstQuartile'
      | 'vast_midpoint'
      | 'vast_thirdQuartile'
      | 'vast_complete'
      | 'vast_clickThrough'
      | 'vast_error',
    meta?: Record<string, any>
  ) => Promise<void>;
  onEnsureTrackingStarted: () => Promise<boolean>;
}> = ({
  template,
  videoSrc,
  vastUrl,
  maxHeight,
  maxWidth,
  isPreview,
  onEmitVastEvent,
  onEnsureTrackingStarted,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [resolvedMediaUrl, setResolvedMediaUrl] = useState<string | null>(videoSrc);
  const [nonLinearImageUrl, setNonLinearImageUrl] = useState<string | null>(null);
  const [nonLinearDurationSec, setNonLinearDurationSec] = useState<number>(30);
  const [nonLinearPlaying, setNonLinearPlaying] = useState<boolean>(false);
  const [nonLinearElapsedSec, setNonLinearElapsedSec] = useState<number>(0);
  const [vastClickUrl, setVastClickUrl] = useState<string | null>(sanitizeHttpHref(template.targetUrl));
  const [vastImpressionUrls, setVastImpressionUrls] = useState<string[]>([]);
  const [vastTrackingUrls, setVastTrackingUrls] = useState<Record<string, string[]>>({});
  const [vastError, setVastError] = useState<string | null>(null);
  const [vastLoading, setVastLoading] = useState<boolean>(false);
  const [isMuted, setIsMuted] = useState<boolean>(true); // Always muted by default (UX comfort)
  const sentStagesRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    sentStagesRef.current = new Set();
    setVastError(null);
    setResolvedMediaUrl(videoSrc);
    setNonLinearImageUrl(null);
    setNonLinearPlaying(false);
    setNonLinearElapsedSec(0);
    setVastImpressionUrls([]);
    setVastTrackingUrls({});
    setVastClickUrl(sanitizeHttpHref(template.targetUrl));

    if (!vastUrl) return;
    let cancelled = false;
    setVastLoading(true);

    const resolveVastChain = async (
      targetVastUrl: string,
      depth: number,
      accImpressions: string[],
      accTracking: Record<string, string[]>
    ): Promise<ParsedVastResult> => {
      const resp = await fetch(targetVastUrl, { mode: 'cors' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const xml = await resp.text();
      const parsed = parseVastXmlSafe(xml);
      const mergedImp = [...accImpressions, ...parsed.impressionUrls];
      const mergedTrack: Record<string, string[]> = { ...accTracking };
      for (const [k, urls] of Object.entries(parsed.trackingUrls)) {
        mergedTrack[k] = [...(mergedTrack[k] || []), ...urls];
      }
      if (parsed.wrapperUrl && depth < 2) {
        return resolveVastChain(parsed.wrapperUrl, depth + 1, mergedImp, mergedTrack);
      }
      return {
        ...parsed,
        impressionUrls: mergedImp,
        trackingUrls: mergedTrack,
      };
    };

    resolveVastChain(vastUrl, 0, [], {})
      .then((parsed) => {
        if (cancelled) return;
        setVastImpressionUrls(parsed.impressionUrls);
        setVastTrackingUrls(parsed.trackingUrls);
        if (parsed.clickThroughUrl) setVastClickUrl(parsed.clickThroughUrl);

        if (parsed.mediaUrl) {
          setResolvedMediaUrl(parsed.mediaUrl);
          setNonLinearImageUrl(null);
        } else if (parsed.nonLinearImageUrl) {
          setResolvedMediaUrl(null);
          setNonLinearImageUrl(parsed.nonLinearImageUrl);
          setNonLinearDurationSec(parsed.durationSec || 30);
        } else {
          setVastError(parsed.errorMessage || 'تعذر تشغيل إعلان VAST.');
          if (!isPreview) {
            void onEmitVastEvent('vast_error', { reason: parsed.errorMessage || 'empty_media' });
          }
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setVastError('تعذر جلب ملف VAST من الخادم الإعلاني (CORS أو رابط غير متاح).');
        if (!isPreview) {
          void onEmitVastEvent('vast_error', { reason: String(err?.message || 'fetch_failed') });
        }
      })
      .finally(() => {
        if (!cancelled) setVastLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [vastUrl, videoSrc, template.targetUrl, isPreview]);

  const emitOnce = async (stage: 'impression' | 'start' | 'firstQuartile' | 'midpoint' | 'thirdQuartile' | 'complete') => {
    if (sentStagesRef.current.has(stage)) return;
    sentStagesRef.current.add(stage);

    if (!isPreview) {
      if (stage === 'impression') {
        fireVastBeaconUrls(vastImpressionUrls);
      } else if (vastTrackingUrls[stage]?.length) {
        fireVastBeaconUrls(vastTrackingUrls[stage]);
      }
      await onEmitVastEvent(`vast_${stage}` as any);
    }
  };

  const handleVideoPlay = async () => {
    if (!isPreview) {
      const ready = await onEnsureTrackingStarted();
      if (!ready) return;
    }
    await emitOnce('impression');
    await emitOnce('start');
  };

  const handleTimeUpdate = () => {
    const vid = videoRef.current;
    if (!vid || !Number.isFinite(vid.duration) || vid.duration <= 0) return;
    const ratio = vid.currentTime / vid.duration;
    if (ratio >= 0.25) void emitOnce('firstQuartile');
    if (ratio >= 0.5) void emitOnce('midpoint');
    if (ratio >= 0.75) void emitOnce('thirdQuartile');
  };

  const handleEnded = () => {
    void emitOnce('complete');
  };

  // NonLinear / InVideo VAST timed playback (e.g., ExoClick Zone 6104150)
  useEffect(() => {
    if (!nonLinearImageUrl || !nonLinearPlaying) return;
    const timer = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      setNonLinearElapsedSec((prev) => {
        const next = prev + 1;
        const ratio = next / Math.max(10, nonLinearDurationSec);
        if (ratio >= 0.25) void emitOnce('firstQuartile');
        if (ratio >= 0.5) void emitOnce('midpoint');
        if (ratio >= 0.75) void emitOnce('thirdQuartile');
        if (next >= nonLinearDurationSec) {
          void emitOnce('complete');
          window.clearInterval(timer);
          setNonLinearPlaying(false);
          return nonLinearDurationSec;
        }
        return next;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [nonLinearImageUrl, nonLinearPlaying, nonLinearDurationSec]);

  const handleStartNonLinear = async () => {
    if (!isPreview) {
      const ready = await onEnsureTrackingStarted();
      if (!ready) return;
    }
    await emitOnce('impression');
    await emitOnce('start');
    setNonLinearPlaying(true);
  };

  if (vastLoading) {
    return (
      <div className="rounded-xl bg-[#080B10] border border-white/10 p-8 text-center text-xs text-gray-400">
        <Loader2 className="w-5 h-5 animate-spin text-amber-400 mx-auto mb-2" />
        جاري تجهيز مشغل الفيديو المعتمد...
      </div>
    );
  }

  if (vastError) {
    return (
      <div className="rounded-xl bg-rose-950/30 border border-rose-500/30 p-4 text-xs text-rose-300 flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 shrink-0" />
        <span>{vastError}</span>
      </div>
    );
  }

  if (nonLinearImageUrl) {
    const pct = Math.min(100, Math.round((nonLinearElapsedSec / Math.max(10, nonLinearDurationSec)) * 100));
    const finished = nonLinearElapsedSec >= nonLinearDurationSec;
    return (
      <div className="rounded-xl bg-[#080B10] border border-white/10 overflow-hidden">
        <div className="relative flex flex-col items-center justify-center bg-black p-3">
          {vastClickUrl ? (
            <a
              href={vastClickUrl}
              target="_blank"
              rel="noopener noreferrer nofollow"
              onClick={() => {
                if (!isPreview) {
                  if (vastTrackingUrls.clickThrough?.length) {
                    fireVastBeaconUrls(vastTrackingUrls.clickThrough);
                  }
                  void onEmitVastEvent('vast_clickThrough', { href: vastClickUrl });
                }
              }}
              className="block rounded-lg overflow-hidden border border-white/10"
            >
              <img
                src={nonLinearImageUrl}
                alt={template.title}
                referrerPolicy="origin"
                className="mx-auto object-contain max-w-full"
                style={{ maxHeight: `${Math.max(180, Math.min(maxHeight, 360))}px` }}
              />
            </a>
          ) : (
            <img
              src={nonLinearImageUrl}
              alt={template.title}
              referrerPolicy="origin"
              className="mx-auto object-contain max-w-full rounded-lg"
              style={{ maxHeight: `${Math.max(180, Math.min(maxHeight, 360))}px` }}
            />
          )}

          {!nonLinearPlaying && !finished && (
            <button
              type="button"
              onClick={() => void handleStartNonLinear()}
              className="mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-[#0B0E14] font-black text-xs cursor-pointer shadow-lg"
            >
              <PlayCircle className="w-4 h-4" />
              <span>تشغيل إعلان الفيديو الموثق</span>
            </button>
          )}

          {(nonLinearPlaying || finished) && (
            <div className="mt-3 text-[11px] text-gray-300" aria-live="polite">
              {finished ? 'اكتمل عرض الإعلان' : 'جارٍ عرض الإعلان والتحقق في الخلفية...'}
            </div>
          )}
        </div>

        {vastClickUrl && (
          <div className="px-3 py-2 bg-[#0E131D] border-t border-white/10 flex items-center justify-between gap-2">
            <span className="text-[11px] text-gray-400 truncate">{template.sourceName || 'ExoClick VAST'}</span>
            <a
              href={vastClickUrl}
              target="_blank"
              rel="noopener noreferrer nofollow"
              onClick={() => {
                if (!isPreview) {
                  if (vastTrackingUrls.clickThrough?.length) {
                    fireVastBeaconUrls(vastTrackingUrls.clickThrough);
                  }
                  void onEmitVastEvent('vast_clickThrough', { href: vastClickUrl });
                }
              }}
              className="inline-flex items-center gap-1 text-xs font-bold text-amber-400 hover:text-amber-300 shrink-0"
            >
              <span>{template.ctaLabel || 'فتح العرض'}</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        )}
      </div>
    );
  }

  if (!resolvedMediaUrl) {
    return (
      <div className="rounded-xl bg-[#080B10] border border-white/10 p-4 text-center text-xs text-gray-400">
        {template.vastUrl ? 'مشغل VAST جاهز — يرجى إضافة رابط ملف MP4 احتياطي أو دعم CORS في الخادم الإعلاني.' : template.title}
      </div>
    );
  }

  const embed = toSafeVideoEmbedUrl(resolvedMediaUrl);
  if (embed.kind === 'iframe') {
    return (
      <div className="rounded-xl bg-[#080B10] border border-white/10 overflow-hidden">
        <div className="w-full flex justify-center bg-black">
          <iframe
            src={embed.src}
            title={template.title}
            sandbox="allow-scripts allow-popups allow-presentation"
            referrerPolicy="no-referrer"
            allow="encrypted-media; picture-in-picture"
            className="w-full border-0"
            style={{ height: `${Math.max(200, Math.min(maxHeight, 380))}px`, maxWidth: `${maxWidth}px` }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-[#080B10] border border-white/10 overflow-hidden">
      <div className="relative">
        <video
          ref={videoRef}
          src={embed.src}
          controls
          muted={isMuted}
          playsInline
          preload="metadata"
          onPlay={() => void handleVideoPlay()}
          onTimeUpdate={handleTimeUpdate}
          onEnded={handleEnded}
          onError={() => {
            if (!isPreview) void onEmitVastEvent('vast_error', { reason: 'media_playback_error' });
          }}
          className="w-full bg-black rounded-t-xl"
          style={{ maxHeight: `${Math.max(200, Math.min(maxHeight, 380))}px` }}
        />
        <button
          type="button"
          onClick={() => setIsMuted((m) => !m)}
          className="absolute top-2 left-2 px-2 py-1 rounded-lg bg-black/70 border border-white/20 text-white text-[10px] font-bold flex items-center gap-1 cursor-pointer"
        >
          {isMuted ? <VolumeX className="w-3 h-3 text-amber-400" /> : <Volume2 className="w-3 h-3 text-emerald-400" />}
          <span>{isMuted ? 'صامت (آمن)' : 'صوت مفعّل'}</span>
        </button>
      </div>
      {vastClickUrl && (
        <div className="px-3 py-2 bg-[#0E131D] border-t border-white/10 flex items-center justify-between gap-2">
          <span className="text-[11px] text-gray-400 truncate">{template.sourceName || 'مقطع إعلاني'}</span>
          <a
            href={vastClickUrl}
            target="_blank"
            rel="noopener noreferrer nofollow"
            onClick={() => {
              if (!isPreview) {
                if (vastTrackingUrls.clickThrough?.length) {
                  fireVastBeaconUrls(vastTrackingUrls.clickThrough);
                }
                void onEmitVastEvent('vast_clickThrough', { href: vastClickUrl });
              }
            }}
            className="inline-flex items-center gap-1 text-xs font-bold text-amber-400 hover:text-amber-300 shrink-0"
          >
            <span>{template.ctaLabel || 'التفاصيل'}</span>
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      )}
    </div>
  );
};

export const MiningAdTemplateCard: React.FC<{
  template: MiningAdTemplate;
  compact?: boolean;
  isPreview?: boolean;
  connectedNetwork?: ConnectedYtNetworkLite | null;
  onStartVerifiedSession?: (networkKey: string, eventType: 'view' | 'click') => Promise<void>;
  startingSessionKey?: string | null;
  onDismiss?: () => void;
  className?: string;
}> = ({
  template,
  compact = false,
  isPreview = false,
  connectedNetwork = null,
  onStartVerifiedSession,
  startingSessionKey,
  onDismiss,
  className = '',
}) => {
  const { user, openAuthModal, showToast } = useAuth();
  const instanceId = useId();
  const cardRef = useRef<HTMLDivElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const impressionTrackedRef = useRef<boolean>(false);
  const [imageBroken, setImageBroken] = useState(false);

  const isDisplayBanner = useMemo(() => isDisplayBannerTemplate(template), [template]);
  const isRewardEligible = useMemo(() => isRewardEligibleTemplate(template), [template]);
  const isExoClickBanner = useMemo(
    () => isExoClickCode(template.codeContent, template.sourceName),
    [template.codeContent, template.sourceName]
  );
  const zoneKey = useMemo(() => (isPreview ? null : extractAdZoneKey(template)), [isPreview, template]);
  const [duplicateZoneBlocked, setDuplicateZoneBlocked] = useState<boolean>(false);
  const [adLoadStatus, setAdLoadStatus] = useState<'loading' | 'loaded' | 'failed'>(() =>
    isExoClickCode(template.codeContent, template.sourceName) ? 'loading' : 'loaded'
  );

  // Claim single mounted instance ownership for external ad zones (e.g. ExoClick 6104102)
  useEffect(() => {
    if (!zoneKey || isPreview) {
      setDuplicateZoneBlocked(false);
      return;
    }
    const existingOwner = mountedAdZoneOwners.get(zoneKey);
    if (existingOwner && existingOwner !== instanceId) {
      setDuplicateZoneBlocked(true);
      return;
    }
    mountedAdZoneOwners.set(zoneKey, instanceId);
    setDuplicateZoneBlocked(false);
    return () => {
      if (mountedAdZoneOwners.get(zoneKey) === instanceId) {
        mountedAdZoneOwners.delete(zoneKey);
      }
    };
  }, [zoneKey, instanceId, isPreview]);

  // Reset health status when template code changes
  useEffect(() => {
    setAdLoadStatus(isExoClickBanner ? 'loading' : 'loaded');
  }, [template.id, template.codeContent, isExoClickBanner]);

  // Verified iframe health postMessage listener (only accepts events from our exact iframeRef)
  useEffect(() => {
    if (!isExoClickBanner) return;
    const onMessage = (event: MessageEvent) => {
      if (!iframeRef.current || event.source !== iframeRef.current.contentWindow) return;
      const payload = event.data;
      if (!payload || typeof payload !== 'object') return;
      if (payload.type !== 'yt_mining_ad_status' || payload.templateId !== template.id) return;
      if (payload.status === 'loaded') setAdLoadStatus('loaded');
      else if (payload.status === 'failed') setAdLoadStatus('failed');
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [isExoClickBanner, template.id]);

  // Server-Side Tracking State
  const [trackingSession, setTrackingSession] = useState<AdTrackingSessionRecord | null>(null);
  const [sessionToken, setSessionToken] = useState<string>('');
  const [trackingBusy, setTrackingBusy] = useState<boolean>(false);
  const [isInViewport, setIsInViewport] = useState<boolean>(false);
  const [pageVisible, setPageVisible] = useState<boolean>(() =>
    typeof document === 'undefined' ? true : document.visibilityState === 'visible'
  );
  const [localActiveTick, setLocalActiveTick] = useState<number>(0);
  const localActiveTickRef = useRef<number>(0);
  const autoStartedRef = useRef<boolean>(false);
  const autoCompletedRef = useRef<boolean>(false);

  const safeTargetUrl = useMemo(() => sanitizeHttpHref(template.targetUrl), [template.targetUrl]);
  const safeMediaUrl = useMemo(() => sanitizeHttpHref(template.mediaUrl), [template.mediaUrl]);
  const safeVastUrl = useMemo(() => sanitizeHttpHref(template.vastUrl), [template.vastUrl]);
  const sandboxSrcDoc = useMemo(
    () => buildMiningAdSrcDoc(template),
    [template.id, template.codeContent, template.templateType, template.width, template.height, template.sourceName]
  );

  useEffect(() => {
    setImageBroken(false);
    impressionTrackedRef.current = false;
    autoStartedRef.current = false;
    autoCompletedRef.current = false;
    localActiveTickRef.current = 0;
    setLocalActiveTick(0);
    setTrackingSession(null);
    setSessionToken('');
  }, [template.id, template.mediaUrl]);

  useEffect(() => {
    if (isPreview || duplicateZoneBlocked) return;
    // Wait until async network banner actually filled before recording impression or starting session
    if (isExoClickBanner && adLoadStatus !== 'loaded') return;
    const el = cardRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setIsInViewport(true);
      if (!impressionTrackedRef.current) {
        impressionTrackedRef.current = true;
        void api.trackMiningAdImpression(template.id).catch(() => {});
      }
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const visibleInView = entries.some((entry) => entry.isIntersecting);
        setIsInViewport(visibleInView);
        if (visibleInView && !impressionTrackedRef.current) {
          impressionTrackedRef.current = true;
          void api.trackMiningAdImpression(template.id).catch(() => {});
        }
      },
      { threshold: 0.25 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [template.id, isPreview, duplicateZoneBlocked, isExoClickBanner, adLoadStatus]);

  // Visibility API tracker: automatically pause dwell heartbeats when tab/app is hidden!
  useEffect(() => {
    const onVisibility = () => {
      const visible = document.visibilityState === 'visible';
      setPageVisible(visible);
      if (trackingSession && !['completed', 'rejected', 'expired'].includes(trackingSession.sessionStatus)) {
        void api
          .sendAdTrackingEvent(trackingSession.id, {
            sessionToken,
            eventName: visible ? 'visibility_visible' : 'visibility_hidden',
            isVisible: visible,
            clientElapsedSec: localActiveTick,
          })
          .catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [trackingSession, sessionToken, localActiveTick]);

  // Active server heartbeat loop (every 5 seconds while session is active)
  useEffect(() => {
    if (!trackingSession || ['completed', 'rejected', 'expired'].includes(trackingSession.sessionStatus)) {
      return;
    }
    const tickTimer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        setLocalActiveTick((s) => {
          const next = s + 1;
          localActiveTickRef.current = next;
          return next;
        });
      }
    }, 1000);

    const hbTimer = window.setInterval(() => {
      const visible = document.visibilityState === 'visible';
      void api
        .sendAdTrackingHeartbeat(trackingSession.id, {
          sessionToken,
          isVisible: visible,
          clientElapsedSec: localActiveTickRef.current,
        })
        .then((res) => {
          if (res?.session) setTrackingSession(res.session);
        })
        .catch(() => {});
    }, 5000);

    return () => {
      window.clearInterval(tickTimer);
      window.clearInterval(hbTimer);
    };
  }, [trackingSession?.id, trackingSession?.sessionStatus, sessionToken]);

  const startOrGetTrackingSession = async (options?: {
    silent?: boolean;
  }): Promise<AdTrackingSessionRecord | null> => {
    if (isPreview) return null;
    if (!user) {
      if (!options?.silent) openAuthModal('login');
      return null;
    }
    if (trackingSession && !['expired', 'rejected'].includes(trackingSession.sessionStatus)) {
      return trackingSession;
    }
    setTrackingBusy(true);
    try {
      const res = await api.startAdTrackingSession({
        templateId: template.id,
        deviceType: detectCurrentDeviceType(),
      });
      setTrackingSession(res.session);
      setSessionToken(res.sessionToken);
      localActiveTickRef.current = 0;
      setLocalActiveTick(0);
      autoCompletedRef.current = false;

      if (isDisplayBanner || isExoClickBanner) {
        void api
          .sendAdTrackingEvent(res.session.id, {
            sessionToken: res.sessionToken,
            eventName: 'impression',
            isVisible: typeof document === 'undefined' ? true : document.visibilityState === 'visible',
            clientElapsedSec: 0,
            metadata: {
              zoneKey: zoneKey || null,
              source: template.sourceName || 'direct',
            },
          })
          .catch(() => {});
      }
      return res.session;
    } catch (err: any) {
      if (!options?.silent) {
        showToast(err?.message || 'تعذر بدء جلسة التتبع الخادمية.', 'error');
      }
      return null;
    } finally {
      setTrackingBusy(false);
    }
  };

  // Auto-start server-side 30s view tracking once an active display banner (e.g. ExoClick 6104102) loads and enters viewport
  useEffect(() => {
    if (
      isPreview ||
      compact ||
      duplicateZoneBlocked ||
      !user ||
      !isDisplayBanner ||
      !template.trackingEnabled ||
      !isInViewport ||
      autoStartedRef.current ||
      trackingSession
    ) {
      return;
    }
    if (isExoClickBanner && adLoadStatus !== 'loaded') return;
    autoStartedRef.current = true;
    void startOrGetTrackingSession({ silent: true });
  }, [
    isPreview,
    compact,
    duplicateZoneBlocked,
    user,
    isDisplayBanner,
    isExoClickBanner,
    adLoadStatus,
    template.trackingEnabled,
    isInViewport,
    trackingSession,
  ]);

  const handleEmitVastEvent = async (
    eventName:
      | 'vast_impression'
      | 'vast_start'
      | 'vast_firstQuartile'
      | 'vast_midpoint'
      | 'vast_thirdQuartile'
      | 'vast_complete'
      | 'vast_clickThrough'
      | 'vast_error',
    metadata?: Record<string, any>
  ) => {
    if (!trackingSession) return;
    try {
      const res = await api.sendAdTrackingEvent(trackingSession.id, {
        sessionToken,
        eventName,
        isVisible: document.visibilityState === 'visible',
        clientElapsedSec: localActiveTick,
        metadata,
      });
      if (res?.session) setTrackingSession(res.session);
    } catch {
      // ignore non-fatal telemetry hiccup
    }
  };

  const handleCompleteTracking = async (options?: { silent?: boolean }) => {
    if (!trackingSession) return;
    setTrackingBusy(true);
    try {
      const res = await api.completeAdTrackingSession(trackingSession.id, {
        sessionToken,
        isVisible: document.visibilityState === 'visible',
      });
      setTrackingSession(res.session);
      if (!options?.silent) {
        showToast(res.message, res.completed ? 'success' : 'error');
      }
    } catch (err: any) {
      if (!options?.silent) {
        showToast(err?.message || 'تعذر التحقق من إكمال الإعلان.', 'error');
      }
    } finally {
      setTrackingBusy(false);
    }
  };

  // Auto-verify 30s dwell completion for tracked display banners once active watch requirement is met
  useEffect(() => {
    if (
      isPreview ||
      compact ||
      !(isDisplayBanner || template.templateType === 'external_link') ||
      !trackingSession ||
      trackingSession.verificationMode !== 'dwell' ||
      ['completed', 'rejected', 'expired'].includes(trackingSession.sessionStatus) ||
      autoCompletedRef.current ||
      !pageVisible
    ) {
      return;
    }
    const targetSec = trackingSession.requiredWatchSec ?? template.completionRule?.requiredWatchSec ?? 30;
    if (targetSec <= 0 || localActiveTick < targetSec) return;

    autoCompletedRef.current = true;
    void (async () => {
      try {
        if (trackingSession.activeDurationSec < targetSec) {
          const hbRes = await api.sendAdTrackingHeartbeat(trackingSession.id, {
            sessionToken,
            isVisible: document.visibilityState === 'visible',
            clientElapsedSec: localActiveTickRef.current,
          });
          if (hbRes?.session) {
            setTrackingSession(hbRes.session);
            if (hbRes.session.activeDurationSec + 0.5 < targetSec) {
              autoCompletedRef.current = false;
              return;
            }
          }
        }
        await handleCompleteTracking({ silent: true });
      } catch {
        autoCompletedRef.current = false;
      }
    })();
  }, [
    isPreview,
    compact,
    isDisplayBanner,
    trackingSession,
    template.completionRule?.requiredWatchSec,
    template.templateType,
    localActiveTick,
    pageVisible,
    sessionToken,
  ]);

  const handleExternalLinkVisit = async () => {
    if (!safeTargetUrl || isPreview) return;
    const sess = await startOrGetTrackingSession();
    if (sess) {
      await api
        .sendAdTrackingEvent(sess.id, {
          sessionToken,
          eventName: 'external_open',
          isVisible: true,
        })
        .then((res) => res?.session && setTrackingSession(res.session))
        .catch(() => {});
    }
    window.open(safeTargetUrl, '_blank', 'noopener,noreferrer');
  };

  const handleRecordExternalReturn = async () => {
    if (!trackingSession) return;
    setTrackingBusy(true);
    try {
      const evRes = await api.sendAdTrackingEvent(trackingSession.id, {
        sessionToken,
        eventName: 'external_return',
        isVisible: true,
      });
      if (evRes?.session) setTrackingSession(evRes.session);
      const cmp = await api.completeAdTrackingSession(trackingSession.id, {
        sessionToken,
        isVisible: true,
      });
      setTrackingSession(cmp.session);
      showToast(cmp.message, cmp.completed ? 'success' : 'info');
    } catch (err: any) {
      showToast(err?.message || 'تعذر تسجيل العودة والتحقق.', 'error');
    } finally {
      setTrackingBusy(false);
    }
  };

  const w = Math.min(1400, Math.max(100, Number(template.width) || 320));
  const h = Math.min(900, Math.max(50, Number(template.height) || 250));
  const aspectHeight = compact ? Math.min(h, 140) : Math.min(h, 380);

  const rewardEvent: 'view' | 'click' =
    template.rewardEventType === 'click' || template.rewardEventType === 'view'
      ? template.rewardEventType
      : template.templateType === 'external_link'
        ? 'click'
        : 'view';

  const rewardYt = connectedNetwork
    ? rewardEvent === 'click'
      ? connectedNetwork.rewardClickYt
      : connectedNetwork.rewardViewYt
    : 0;

  const canTriggerVerifiedReward =
    isRewardEligible &&
    Boolean(connectedNetwork?.isActive && connectedNetwork?.isConnected) &&
    Boolean(onStartVerifiedSession) &&
    (rewardEvent === 'click'
      ? connectedNetwork?.adType === 'click' || connectedNetwork?.adType === 'both'
      : connectedNetwork?.adType === 'view' || connectedNetwork?.adType === 'both');

  // Strict deduplication & clean collapse when an async ad fails/has no-fill on live user pages
  if (!isPreview && duplicateZoneBlocked) {
    return null;
  }
  if (!isPreview && isExoClickBanner && adLoadStatus === 'failed') {
    return null;
  }

  const TypeIcon =
    template.templateType === 'video_player' || template.templateType === 'vast_url'
      ? PlayCircle
      : template.templateType === 'image_banner'
        ? ImageIcon
        : template.templateType === 'external_link'
          ? Link2
          : template.templateType === 'mixed' || template.templateType === 'multi_format'
            ? Layers
            : Code2;

  const requiredSec =
    trackingSession?.requiredWatchSec ??
    template.completionRule?.requiredWatchSec ??
    (isDisplayBanner ? 30 : 15);
  const serverActiveSec = Math.max(trackingSession?.activeDurationSec ?? 0, localActiveTick);

  return (
    <div
      ref={cardRef}
      className={`rounded-2xl bg-[#131822]/95 border border-amber-500/20 hover:border-amber-400/40 transition-colors overflow-hidden shadow-lg ${
        compact ? 'p-2.5' : 'p-3.5 sm:p-4'
      } ${className}`}
    >
      {/* Subtle Ad Metadata Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2 text-[11px]">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/30 text-amber-300 font-bold shrink-0">
            <TypeIcon className="w-3 h-3" />
            <span>{isDisplayBanner ? `إعلان${template.sourceName ? ` · ${template.sourceName}` : ''}` : template.sourceName ? template.sourceName : 'إعلان ممول'}</span>
          </span>
          {!isDisplayBanner && <span className="font-bold text-white truncate">{template.title}</span>}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {isPreview && isExoClickBanner && (
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                adLoadStatus === 'loaded'
                  ? 'bg-emerald-500/15 text-emerald-300'
                  : adLoadStatus === 'failed'
                    ? 'bg-amber-500/15 text-amber-300'
                    : 'bg-sky-500/15 text-sky-300'
              }`}
            >
              {adLoadStatus === 'loaded'
                ? 'تم تحميل الإعلان'
                : adLoadStatus === 'failed'
                  ? 'بانتظار Fill / موافقة النطاق'
                  : 'جاري تحميل ExoClick...'}
            </span>
          )}
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-gray-400">
            {isDisplayBanner ? `${w}×${h}` : AD_FORMAT_LABELS[template.adFormat] || template.adFormat}
          </span>
          {canTriggerVerifiedReward && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 font-mono font-bold text-[10px]">
              <ShieldCheck className="w-3 h-3" />
              +{formatYt(rewardYt)} YT مؤكد
            </span>
          )}
          {onDismiss && template.isDismissible && (
            <button
              type="button"
              onClick={onDismiss}
              aria-label="إغلاق الإعلان"
              className="p-1 rounded-md bg-white/5 hover:bg-rose-500/20 text-gray-400 hover:text-rose-300 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Main Content Renderer by Template Type */}
      {template.templateType === 'external_link' ? (
        <div className="rounded-xl bg-[#0B0E14] border border-white/10 p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="min-w-0 space-y-1">
            {safeMediaUrl && !imageBroken && (
              <div className="w-full max-w-[220px] h-20 rounded-lg overflow-hidden border border-white/10 mb-2 bg-[#111622]">
                <img
                  src={safeMediaUrl}
                  alt={template.title}
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  onError={() => setImageBroken(true)}
                  className="w-full h-full object-cover"
                />
              </div>
            )}
            <div className="text-xs sm:text-sm font-extrabold text-white">{template.title}</div>
            {safeTargetUrl && (
              <div className="text-[11px] font-mono text-sky-400/90 truncate" dir="ltr">
                {extractDomain(safeTargetUrl) || safeTargetUrl}
              </div>
            )}
          </div>

          {safeTargetUrl && (
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                disabled={trackingBusy}
                onClick={() => void handleExternalLinkVisit()}
                className="inline-flex items-center justify-center gap-1.5 min-h-[42px] px-4 py-2 rounded-xl bg-gradient-to-l from-amber-500 to-amber-400 hover:from-amber-400 hover:to-amber-300 text-[#0B0E14] font-black text-xs shrink-0 transition-transform active:scale-95 cursor-pointer"
              >
                <span>{template.ctaLabel || 'فتح الرابط وتتبع الزيارة'}</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </button>
              {trackingSession?.sessionStatus === 'left_to_external' && (
                <button
                  type="button"
                  disabled={trackingBusy}
                  onClick={() => void handleRecordExternalReturn()}
                  className="inline-flex items-center gap-1.5 min-h-[42px] px-3.5 py-2 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-300 font-black text-xs cursor-pointer"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>تسجيل العودة والتحقق</span>
                </button>
              )}
            </div>
          )}
        </div>
      ) : template.templateType === 'image_banner' && safeMediaUrl && !imageBroken ? (
        <div className="rounded-xl bg-[#0B0E14] border border-white/10 overflow-hidden flex flex-col items-center">
          {safeTargetUrl ? (
            <a
              href={safeTargetUrl}
              target="_blank"
              rel="noopener noreferrer nofollow"
              onClick={() => {
                if (trackingSession && !isPreview) {
                  void api.sendAdTrackingEvent(trackingSession.id, {
                    sessionToken,
                    eventName: 'click',
                  }).catch(() => {});
                }
              }}
              className="block w-full text-center group"
            >
              <img
                src={safeMediaUrl}
                alt={template.title}
                loading="lazy"
                referrerPolicy="no-referrer"
                onError={() => setImageBroken(true)}
                className="mx-auto w-full object-contain bg-[#080B10] group-hover:opacity-95 transition-opacity"
                style={{ maxHeight: `${aspectHeight}px` }}
              />
            </a>
          ) : (
            <img
              src={safeMediaUrl}
              alt={template.title}
              loading="lazy"
              referrerPolicy="no-referrer"
              onError={() => setImageBroken(true)}
              className="mx-auto w-full object-contain bg-[#080B10]"
              style={{ maxHeight: `${aspectHeight}px` }}
            />
          )}
        </div>
      ) : template.templateType === 'video_player' || template.templateType === 'vast_url' ? (
        template.codeContent.trim().length > 0 && !safeMediaUrl && !safeVastUrl ? (
          <div
            className="w-full mx-auto rounded-xl overflow-hidden bg-[#0B0E14] border border-white/10 flex items-center justify-center"
            style={{ maxWidth: `${w}px`, height: `${aspectHeight}px` }}
          >
            <iframe
              key={template.id}
              ref={iframeRef}
              srcDoc={sandboxSrcDoc}
              width={w}
              height={aspectHeight}
              title={`فيديو ${template.title}`}
              sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
              referrerPolicy="no-referrer"
              loading="lazy"
              scrolling="no"
              className="border-0 block w-full h-full bg-transparent"
            />
          </div>
        ) : (
          <TrackedVastVideoBox
            template={template}
            videoSrc={safeMediaUrl}
            vastUrl={safeVastUrl}
            maxHeight={h}
            maxWidth={w}
            isPreview={isPreview}
            onEmitVastEvent={handleEmitVastEvent}
            onEnsureTrackingStarted={async () => Boolean(await startOrGetTrackingSession())}
          />
        )
      ) : (
        <div className="space-y-2.5">
          {template.templateType === 'mixed' && safeMediaUrl && !imageBroken && (
            <div className="rounded-xl overflow-hidden border border-white/10 bg-[#0B0E14]">
              <img
                src={safeMediaUrl}
                alt={template.title}
                loading="lazy"
                referrerPolicy="no-referrer"
                onError={() => setImageBroken(true)}
                className="w-full object-cover"
                style={{ maxHeight: '160px' }}
              />
            </div>
          )}

          {template.codeContent.trim().length > 0 ? (
            <div
              className="w-full mx-auto rounded-xl overflow-hidden bg-[#0B0E14] border border-white/10 flex items-center justify-center"
              style={{ maxWidth: `${w}px`, height: `${isExoClickBanner ? Math.min(h, 250) : aspectHeight}px` }}
            >
              <iframe
                key={template.id}
                ref={iframeRef}
                srcDoc={sandboxSrcDoc}
                width={w}
                height={isExoClickBanner ? Math.min(h, 250) : aspectHeight}
                title={`إعلان ${template.title}`}
                sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
                referrerPolicy={isExoClickBanner || template.templateType === 'network_code' ? 'origin' : 'no-referrer'}
                loading="lazy"
                scrolling="no"
                className="border-0 block w-full h-full bg-transparent"
              />
            </div>
          ) : (
            <div className="rounded-xl bg-[#0B0E14] border border-white/10 p-3 text-center text-xs text-gray-400">
              {template.title}
            </div>
          )}

          {safeTargetUrl && (
            <div className="flex justify-end">
              <a
                href={safeTargetUrl}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="inline-flex items-center gap-1.5 min-h-[38px] px-3.5 py-1.5 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/35 text-amber-300 font-bold text-xs transition-colors"
              >
                <span>{template.ctaLabel || 'فتح العرض'}</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          )}
        </div>
      )}

      {/* Silent Background Tracking Engine (Zero UI buttons or countdown timers) */}
      {false && !isPreview && !compact && template.trackingEnabled && (!isExoClickBanner || adLoadStatus === 'loaded') && (
        <div className="hidden" />
      )}

      {/* Optional Server-Verified YT Coin S2S Network Trigger */}
      {canTriggerVerifiedReward && connectedNetwork && onStartVerifiedSession && (
        <div className="mt-2 pt-2 border-t border-white/10 flex flex-wrap items-center justify-between gap-2">
          <span className="text-[10px] text-gray-400 flex items-center gap-1">
            <Sparkles className="w-3 h-3 text-amber-400 shrink-0" />
            <span>تُضاف المكافأة فقط بعد تأكيد الخادم (S2S) من {connectedNetwork.displayName}</span>
          </span>
          <button
            type="button"
            disabled={startingSessionKey === `${connectedNetwork.networkKey}:${rewardEvent}` || isPreview}
            onClick={() => void onStartVerifiedSession(connectedNetwork.networkKey, rewardEvent)}
            className="inline-flex items-center gap-1.5 min-h-[38px] px-3 py-1.5 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/35 text-emerald-300 text-[11px] font-black transition-colors cursor-pointer disabled:opacity-60"
          >
            {startingSessionKey === `${connectedNetwork.networkKey}:${rewardEvent}` ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : rewardEvent === 'click' ? (
              <MousePointerClick className="w-3.5 h-3.5" />
            ) : (
              <Eye className="w-3.5 h-3.5" />
            )}
            <span>بدء جلسة S2S (+{formatYt(rewardYt)} YT)</span>
          </button>
        </div>
      )}
    </div>
  );
};

interface MiningAdSlotProps {
  placementKey: string;
  placements?: MiningAdPlacement[];
  templates?: MiningAdTemplate[];
  templatesOverride?: MiningAdTemplate[];
  comfortSettings?: AdCenterComfortSettings;
  connectedNetworks?: ConnectedYtNetworkLite[];
  onStartVerifiedSession?: (networkKey: string, eventType: 'view' | 'click') => Promise<void>;
  startingSessionKey?: string | null;
  compact?: boolean;
  hideWhenEmpty?: boolean;
  maxItems?: number;
  className?: string;
}

export const MiningAdSlot: React.FC<MiningAdSlotProps> = ({
  placementKey,
  placements = [],
  templates = [],
  templatesOverride,
  comfortSettings,
  connectedNetworks = [],
  onStartVerifiedSession,
  startingSessionKey,
  compact = false,
  hideWhenEmpty = true,
  maxItems,
  className = '',
}) => {
  const isPreview = Boolean(templatesOverride);
  const [dismissedIds, setDismissedIds] = useState<Record<string, number>>({});
  const currentDevice = detectCurrentDeviceType();

  const placement = useMemo(
    () => placements.find((p) => p.placementKey === placementKey) ?? null,
    [placements, placementKey]
  );

  const eligibleTemplates = useMemo(() => {
    if (templatesOverride) return templatesOverride;
    if (placement && !placement.isActive) return [];

    const cooldownMs = (comfortSettings?.cooldownAfterDismissSec ?? 120) * 1000;
    const now = Date.now();
    const isStickySlot = placement?.slotType === 'sticky';
    const maxStickyCap = comfortSettings?.maxStickyAds ?? 1;
    if (isStickySlot && maxStickyCap <= 0) return [];

    const cap = isStickySlot
      ? Math.min(maxItems ?? placement?.maxAds ?? 1, maxStickyCap)
      : maxItems ?? placement?.maxAds ?? 2;

    return templates
      .filter((t) => t.placementKey === placementKey && t.isActive)
      .filter((t) => !(comfortSettings?.popunderAutoDisabled !== false && t.adFormat === 'popunder'))
      .filter((t) => t.deviceTarget === 'all' || t.deviceTarget === currentDevice)
      .filter((t) => {
        const dismissedAt = dismissedIds[t.id];
        return !dismissedAt || now - dismissedAt >= cooldownMs;
      })
      .filter((t) => t.maxImpressions === 0 || t.impressionsCount < t.maxImpressions)
      .sort((a, b) => a.sortOrder - b.sortOrder || b.priority - a.priority)
      .slice(0, Math.max(1, cap));
  }, [templatesOverride, placement, templates, placementKey, maxItems, comfortSettings, currentDevice, dismissedIds]);

  // Never render empty ad spaces on user screens
  if (eligibleTemplates.length === 0) {
    if (hideWhenEmpty) return null;
    return null;
  }

  return (
    <div
      data-mining-placement={placementKey}
      className={className}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: `${comfortSettings?.minSpacingPx ?? 16}px`,
      }}
    >
      {eligibleTemplates.length > 1 && (placement?.slotType === 'mixed' || placement?.slotType === 'recommendation') ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {eligibleTemplates.map((tpl) => {
            const rewardEligible = isRewardEligibleTemplate(tpl);
            const net =
              rewardEligible && tpl.ytNetworkKey
                ? connectedNetworks.find((n) => n.networkKey === tpl.ytNetworkKey) ?? null
                : null;
            return (
              <MiningAdTemplateCard
                key={tpl.id}
                template={tpl}
                compact={compact}
                isPreview={isPreview}
                connectedNetwork={net}
                onStartVerifiedSession={rewardEligible ? onStartVerifiedSession : undefined}
                startingSessionKey={startingSessionKey}
                onDismiss={() => setDismissedIds((prev) => ({ ...prev, [tpl.id]: Date.now() }))}
              />
            );
          })}
        </div>
      ) : (
        eligibleTemplates.map((tpl) => {
          const rewardEligible = isRewardEligibleTemplate(tpl);
          const net =
            rewardEligible && tpl.ytNetworkKey
              ? connectedNetworks.find((n) => n.networkKey === tpl.ytNetworkKey) ?? null
              : null;
          return (
            <MiningAdTemplateCard
              key={tpl.id}
              template={tpl}
              compact={compact}
              isPreview={isPreview}
              connectedNetwork={net}
              onStartVerifiedSession={rewardEligible ? onStartVerifiedSession : undefined}
              startingSessionKey={startingSessionKey}
              onDismiss={() => setDismissedIds((prev) => ({ ...prev, [tpl.id]: Date.now() }))}
            />
          );
        })
      )}
    </div>
  );
};
