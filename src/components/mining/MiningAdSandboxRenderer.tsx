import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  mediaUrl: string | null;
  clickThroughUrl: string | null;
  errorMessage?: string;
}

function parseVastXmlSafe(xmlText: string): ParsedVastResult {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, 'text/xml');
    const parseErr = doc.querySelector('parsererror');
    if (parseErr) {
      return { mediaUrl: null, clickThroughUrl: null, errorMessage: 'تنسيق ملف VAST XML غير صالح.' };
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
    const clickNode = doc.querySelector('ClickThrough');
    const clickThroughUrl = sanitizeHttpHref(clickNode?.textContent);
    if (!chosenMedia) {
      return { mediaUrl: null, clickThroughUrl, errorMessage: 'لا يوجد ملف فيديو MP4/WebM متوافق داخل VAST XML.' };
    }
    return { mediaUrl: chosenMedia, clickThroughUrl };
  } catch {
    return { mediaUrl: null, clickThroughUrl: null, errorMessage: 'تعذر تحليل استجابة VAST XML.' };
  }
}

/**
 * Generates an isolated srcDoc HTML wrapper executed inside an iframe
 * WITHOUT `allow-same-origin` so third-party HTML/JS/ad-network scripts
 * cannot access parent DOM, auth tokens, localStorage, IndexedDB, or wallets.
 */
export function buildMiningAdSrcDoc(
  template: Pick<MiningAdTemplate, 'codeContent' | 'templateType' | 'width' | 'height'>
): string {
  const safeH = Math.min(900, Math.max(50, Number(template.height) || 250));
  const rawCode = String(template.codeContent || '').trim();

  let bodyContent = rawCode;
  if (template.templateType === 'javascript') {
    if (!/<script[\s>]/i.test(rawCode)) {
      bodyContent = `<script type="text/javascript">\n${rawCode}\n</script>`;
    }
  } else if (
    template.templateType === 'network_code' ||
    template.templateType === 'video_player' ||
    template.templateType === 'multi_format' ||
    template.templateType === 'recommendation_widget'
  ) {
    if (!/<(script|iframe|div|ins|a|video|img)[\s>]/i.test(rawCode) && /^https?:\/\//i.test(rawCode)) {
      const escapedUrl = rawCode.replace(/"/g, '&quot;');
      bodyContent = `<iframe src="${escapedUrl}" width="100%" height="${safeH}" frameborder="0" referrerpolicy="no-referrer" style="border:0;width:100%;height:${safeH}px;"></iframe>`;
    }
  }

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'self' https: http: data: blob: 'unsafe-inline' 'unsafe-eval'; form-action 'none'; object-src 'none'; base-uri 'none';" />
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body {
      width: 100%;
      height: 100%;
      overflow: hidden;
      display: flex;
      justify-content: center;
      align-items: center;
      background: #0B0E14;
      color: #F3F4F6;
      font-family: system-ui, -apple-system, sans-serif;
    }
    img, iframe, video { max-width: 100%; max-height: 100%; border: 0; }
  </style>
</head>
<body>${bodyContent}</body>
</html>`;
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
  const [vastClickUrl, setVastClickUrl] = useState<string | null>(sanitizeHttpHref(template.targetUrl));
  const [vastError, setVastError] = useState<string | null>(null);
  const [vastLoading, setVastLoading] = useState<boolean>(false);
  const [isMuted, setIsMuted] = useState<boolean>(true); // Always muted by default (UX comfort)
  const sentStagesRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    sentStagesRef.current = new Set();
    setVastError(null);
    setResolvedMediaUrl(videoSrc);
    setVastClickUrl(sanitizeHttpHref(template.targetUrl));

    if (!vastUrl || isPreview) return;
    let cancelled = false;
    setVastLoading(true);
    fetch(vastUrl, { mode: 'cors' })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then((xml) => {
        if (cancelled) return;
        const parsed = parseVastXmlSafe(xml);
        if (parsed.errorMessage || !parsed.mediaUrl) {
          setVastError(parsed.errorMessage || 'تعذر تشغيل إعلان VAST.');
          void onEmitVastEvent('vast_error', { reason: parsed.errorMessage || 'empty_media' });
        } else {
          setResolvedMediaUrl(parsed.mediaUrl);
          if (parsed.clickThroughUrl) setVastClickUrl(parsed.clickThroughUrl);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setVastError('تعذر جلب ملف VAST من الخادم الإعلاني (CORS أو رابط غير متاح).');
        void onEmitVastEvent('vast_error', { reason: String(err?.message || 'fetch_failed') });
      })
      .finally(() => {
        if (!cancelled) setVastLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [vastUrl, videoSrc, template.targetUrl, isPreview]);

  const emitOnce = async (stage: 'impression' | 'start' | 'firstQuartile' | 'midpoint' | 'thirdQuartile' | 'complete') => {
    if (isPreview || sentStagesRef.current.has(stage)) return;
    sentStagesRef.current.add(stage);
    await onEmitVastEvent(`vast_${stage}` as any);
  };

  const handleVideoPlay = async () => {
    if (isPreview) return;
    const ready = await onEnsureTrackingStarted();
    if (!ready) return;
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
              if (!isPreview) void onEmitVastEvent('vast_clickThrough', { href: vastClickUrl });
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
  const cardRef = useRef<HTMLDivElement | null>(null);
  const impressionTrackedRef = useRef<boolean>(false);
  const [imageBroken, setImageBroken] = useState(false);

  // Server-Side Tracking State
  const [trackingSession, setTrackingSession] = useState<AdTrackingSessionRecord | null>(null);
  const [sessionToken, setSessionToken] = useState<string>('');
  const [trackingBusy, setTrackingBusy] = useState<boolean>(false);
  const [pageVisible, setPageVisible] = useState<boolean>(() =>
    typeof document === 'undefined' ? true : document.visibilityState === 'visible'
  );
  const [localActiveTick, setLocalActiveTick] = useState<number>(0);

  const safeTargetUrl = useMemo(() => sanitizeHttpHref(template.targetUrl), [template.targetUrl]);
  const safeMediaUrl = useMemo(() => sanitizeHttpHref(template.mediaUrl), [template.mediaUrl]);
  const safeVastUrl = useMemo(() => sanitizeHttpHref(template.vastUrl), [template.vastUrl]);

  useEffect(() => {
    setImageBroken(false);
  }, [template.id, template.mediaUrl]);

  useEffect(() => {
    if (isPreview || impressionTrackedRef.current) return;
    const el = cardRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      impressionTrackedRef.current = true;
      void api.trackMiningAdImpression(template.id).catch(() => {});
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          if (!impressionTrackedRef.current) {
            impressionTrackedRef.current = true;
            void api.trackMiningAdImpression(template.id).catch(() => {});
          }
          observer.disconnect();
        }
      },
      { threshold: 0.25 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [template.id, isPreview]);

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
        setLocalActiveTick((s) => s + 1);
      }
    }, 1000);

    const hbTimer = window.setInterval(() => {
      const visible = document.visibilityState === 'visible';
      void api
        .sendAdTrackingHeartbeat(trackingSession.id, {
          sessionToken,
          isVisible: visible,
          clientElapsedSec: localActiveTick,
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

  const startOrGetTrackingSession = async (): Promise<AdTrackingSessionRecord | null> => {
    if (isPreview) return null;
    if (!user) {
      openAuthModal('login');
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
      setLocalActiveTick(0);
      return res.session;
    } catch (err: any) {
      showToast(err?.message || 'تعذر بدء جلسة التتبع الخادمية.', 'error');
      return null;
    } finally {
      setTrackingBusy(false);
    }
  };

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

  const handleCompleteTracking = async () => {
    if (!trackingSession) return;
    setTrackingBusy(true);
    try {
      const res = await api.completeAdTrackingSession(trackingSession.id, {
        sessionToken,
        isVisible: document.visibilityState === 'visible',
      });
      setTrackingSession(res.session);
      showToast(res.message, res.completed ? 'success' : 'error');
    } catch (err: any) {
      showToast(err?.message || 'تعذر التحقق من إكمال الإعلان.', 'error');
    } finally {
      setTrackingBusy(false);
    }
  };

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
    Boolean(connectedNetwork?.isActive && connectedNetwork?.isConnected) &&
    Boolean(onStartVerifiedSession) &&
    (rewardEvent === 'click'
      ? connectedNetwork?.adType === 'click' || connectedNetwork?.adType === 'both'
      : connectedNetwork?.adType === 'view' || connectedNetwork?.adType === 'both');

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

  const requiredSec = trackingSession?.requiredWatchSec ?? template.completionRule?.requiredWatchSec ?? 15;
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
            <span>{template.sourceName ? template.sourceName : 'إعلان ممول'}</span>
          </span>
          <span className="font-bold text-white truncate">{template.title}</span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-gray-400">
            {AD_FORMAT_LABELS[template.adFormat] || template.adFormat}
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
              srcDoc={buildMiningAdSrcDoc(template)}
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
              style={{ maxWidth: `${w}px`, height: `${aspectHeight}px` }}
            >
              <iframe
                key={template.id}
                srcDoc={buildMiningAdSrcDoc(template)}
                width={w}
                height={aspectHeight}
                title={`إعلان ${template.title}`}
                sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
                referrerPolicy="no-referrer"
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

      {/* Honest Server-Side Dwell / Completion Tracker Strip */}
      {!isPreview && !compact && template.trackingEnabled && (
        <div className="mt-2.5 pt-2.5 border-t border-white/10 flex flex-wrap items-center justify-between gap-2 text-[11px]">
          {!trackingSession ? (
            <>
              <span className="text-gray-400 flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span>تتبع خادمي للبقاء النشط ({requiredSec} ثانية)</span>
              </span>
              <button
                type="button"
                disabled={trackingBusy}
                onClick={() => void startOrGetTrackingSession()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/35 text-amber-300 font-bold cursor-pointer disabled:opacity-60"
              >
                {trackingBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Eye className="w-3.5 h-3.5" />}
                <span>بدء التتبع النشط</span>
              </button>
            </>
          ) : trackingSession.sessionStatus === 'completed' ? (
            <div className="w-full flex flex-wrap items-center justify-between gap-2 text-emerald-300">
              <span className="flex items-center gap-1.5 font-bold">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>
                  تم توثيق الجلسة ({Math.floor(trackingSession.activeDurationSec)}ث) —{' '}
                  {trackingSession.eligibilityResult === 'credited'
                    ? 'تم اعتماد المكافأة عبر S2S'
                    : trackingSession.eligibilityResult === 'eligible_for_yt_reward'
                      ? 'مؤهل بانتظار S2S'
                      : 'مكتمل التتبع'}
                </span>
              </span>
            </div>
          ) : (
            <div className="w-full flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 font-mono text-gray-300">
                {!pageVisible ? (
                  <span className="inline-flex items-center gap-1 text-amber-400 font-bold">
                    <PauseCircle className="w-3.5 h-3.5" /> متوقف (التبويب مخفي)
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-sky-300 font-bold">
                    <Clock className="w-3.5 h-3.5" /> الوقت النشط: {Math.floor(serverActiveSec)} / {requiredSec}ث
                  </span>
                )}
              </span>

              <button
                type="button"
                disabled={trackingBusy}
                onClick={() => void handleCompleteTracking()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/35 text-emerald-300 font-black cursor-pointer disabled:opacity-60"
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>تحقق وإكمال الجلسة</span>
              </button>
            </div>
          )}
        </div>
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
            const net = tpl.ytNetworkKey
              ? connectedNetworks.find((n) => n.networkKey === tpl.ytNetworkKey) ?? null
              : null;
            return (
              <MiningAdTemplateCard
                key={tpl.id}
                template={tpl}
                compact={compact}
                isPreview={isPreview}
                connectedNetwork={net}
                onStartVerifiedSession={onStartVerifiedSession}
                startingSessionKey={startingSessionKey}
                onDismiss={() => setDismissedIds((prev) => ({ ...prev, [tpl.id]: Date.now() }))}
              />
            );
          })}
        </div>
      ) : (
        eligibleTemplates.map((tpl) => {
          const net = tpl.ytNetworkKey
            ? connectedNetworks.find((n) => n.networkKey === tpl.ytNetworkKey) ?? null
            : null;
          return (
            <MiningAdTemplateCard
              key={tpl.id}
              template={tpl}
              compact={compact}
              isPreview={isPreview}
              connectedNetwork={net}
              onStartVerifiedSession={onStartVerifiedSession}
              startingSessionKey={startingSessionKey}
              onDismiss={() => setDismissedIds((prev) => ({ ...prev, [tpl.id]: Date.now() }))}
            />
          );
        })
      )}
    </div>
  );
};
