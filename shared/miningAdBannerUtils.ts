import type { MiningAdFormat, MiningAdTemplate, MiningAdTemplateType } from '../src/types/index.ts';

export const DISPLAY_BANNER_FORMATS = new Set<MiningAdFormat>([
  'banner',
  'mobile_banner',
  'sticky_banner',
  'mobile_sticky_banner',
  'desktop_interstitial',
  'mobile_interstitial',
  'instant_message',
]);

/**
 * Strict allowlist: ONLY Video ads, External Link ads, and equivalent task formats
 * are eligible for YT Coin rewards / S2S Postback linkage.
 * Display banners, Recommendation Widgets, Native Cards, Multi-Format, Push, Popunder,
 * and ExoClick units are strictly excluded from rewards.
 */
export const REWARD_ELIGIBLE_AD_FORMATS = new Set<MiningAdFormat>([
  'instream_video',
  'invideo_banner',
  'video_slider',
  'outstream_video',
  'vertical_video',
  'external_link',
]);

export const REWARD_ELIGIBLE_TEMPLATE_TYPES = new Set<MiningAdTemplateType>([
  'video_player',
  'vast_url',
  'external_link',
]);

export const NON_REWARDABLE_TEMPLATE_TYPES = new Set<MiningAdTemplateType>([
  'image_banner',
  'recommendation_widget',
  'multi_format',
  'push_notification',
]);

export function isDisplayBannerTemplate(
  template: Pick<MiningAdTemplate, 'adFormat' | 'sourceName' | 'codeContent'>
): boolean {
  if (DISPLAY_BANNER_FORMATS.has(template.adFormat)) return true;
  const src = String(template.sourceName || '').toLowerCase();
  const code = String(template.codeContent || '').toLowerCase();
  return src.includes('exoclick') || code.includes('magsrv.com') || code.includes('eas6a97888e2');
}

export function isRewardEligibleTemplate(template: {
  adFormat?: MiningAdFormat | string | null;
  templateType?: MiningAdTemplateType | string | null;
  sourceName?: string | null;
  codeContent?: string | null;
}): boolean {
  const fmt = String(template.adFormat || '').trim() as MiningAdFormat;
  const tplType = String(template.templateType || '').trim() as MiningAdTemplateType;

  if (
    isDisplayBannerTemplate({
      adFormat: fmt,
      sourceName: template.sourceName ?? '',
      codeContent: template.codeContent ?? '',
    })
  ) {
    return false;
  }
  if (fmt === 'popunder') return false;
  if (tplType && NON_REWARDABLE_TEMPLATE_TYPES.has(tplType)) return false;

  return REWARD_ELIGIBLE_AD_FORMATS.has(fmt);
}

export function extractAdZoneKey(
  template: Pick<MiningAdTemplate, 'codeContent' | 'sourceName'>
): string | null {
  const code = String(template.codeContent || '');
  const zoneMatch = code.match(/data-zoneid\s*=\s*["']?(\d{4,12})["']?/i);
  if (zoneMatch?.[1]) {
    return `exoclick:zone:${zoneMatch[1]}`;
  }
  const magsrvMatch = code.match(/magsrv\.com\/[^\s"'<>]+/i);
  if (magsrvMatch?.[0] && String(template.sourceName || '').toLowerCase().includes('exoclick')) {
    return `exoclick:${magsrvMatch[0].toLowerCase()}`;
  }
  return null;
}

export function isExoClickCode(codeContent?: string | null, sourceName?: string | null): boolean {
  const code = String(codeContent || '').toLowerCase();
  const src = String(sourceName || '').toLowerCase();
  return (
    code.includes('magsrv.com/ad-provider.js') ||
    code.includes('eas6a97888e2') ||
    (src.includes('exoclick') && code.includes('data-zoneid'))
  );
}

export const EXOCLICK_DELEGATE_CH_META =
  '<meta http-equiv="Delegate-CH" content="Sec-CH-UA https://s.magsrv.com; Sec-CH-UA-Mobile https://s.magsrv.com; Sec-CH-UA-Arch https://s.magsrv.com; Sec-CH-UA-Model https://s.magsrv.com; Sec-CH-UA-Platform https://s.magsrv.com; Sec-CH-UA-Platform-Version https://s.magsrv.com; Sec-CH-UA-Bitness https://s.magsrv.com; Sec-CH-UA-Full-Version-List https://s.magsrv.com; Sec-CH-UA-Full-Version https://s.magsrv.com;" />';

/**
 * Generates an isolated srcDoc HTML wrapper executed inside an iframe
 * WITHOUT `allow-same-origin` so third-party HTML/JS/ad-network scripts
 * cannot access parent DOM, auth tokens, localStorage, IndexedDB, or wallets.
 */
export function buildMiningAdSrcDoc(
  template: Pick<MiningAdTemplate, 'codeContent' | 'templateType' | 'width' | 'height'> & {
    id?: string;
    sourceName?: string;
  }
): string {
  const safeH = Math.min(900, Math.max(50, Number(template.height) || 250));
  const rawCode = String(template.codeContent || '').trim();
  const tplIdLiteral = JSON.stringify(String(template.id || ''));

  let bodyContent = rawCode;
  const isExoClick = isExoClickCode(rawCode, template.sourceName);
  if (isExoClick) {
    const zoneMatch = rawCode.match(/data-zoneid\s*=\s*["']?(\d{4,12})["']?/i);
    const classMatch = rawCode.match(/class\s*=\s*["']([a-zA-Z0-9_-]+)["']/i);
    const zoneId = zoneMatch?.[1] || '';
    const insClass = classMatch?.[1] || 'eas6a97888e2';

    if (zoneId) {
      bodyContent = `<ins class="${insClass}" data-zoneid="${zoneId}"></ins>
<script>
  (function () {
    if (window.__ytExoAdProviderInit) return;
    window.__ytExoAdProviderInit = true;
    var tplId = ${tplIdLiteral};
    var resolved = false;
    var obs = null;

    function notify(status, detail) {
      try {
        if (window.parent && window.parent !== window) {
          window.parent.postMessage(
            { type: 'yt_mining_ad_status', templateId: tplId, status: status, detail: detail || '' },
            '*'
          );
        }
      } catch (e) {}
    }

    function checkFilled() {
      if (resolved) return;
      var ins = document.querySelector('ins[data-zoneid]');
      if (!ins) return;
      var hasCreative =
        ins.children.length > 0 ||
        Boolean(ins.querySelector('iframe, img, a, canvas, video, svg')) ||
        ins.innerHTML.trim().length > 0;
      if (hasCreative) {
        resolved = true;
        if (obs) obs.disconnect();
        notify('loaded', 'creative_rendered');
      }
    }

    var insEl = document.querySelector('ins[data-zoneid]');
    if (insEl && typeof MutationObserver !== 'undefined') {
      obs = new MutationObserver(checkFilled);
      obs.observe(insEl, { childList: true, subtree: true });
    }

    if (!document.querySelector('script[data-yt-exoclick="1"], script[src*="a.magsrv.com/ad-provider.js"]')) {
      var s = document.createElement('script');
      s.async = true;
      s.type = 'application/javascript';
      s.src = 'https://a.magsrv.com/ad-provider.js';
      s.setAttribute('data-yt-exoclick', '1');
      s.onerror = function () {
        if (!resolved) {
          resolved = true;
          if (obs) obs.disconnect();
          notify('failed', 'script_error');
        }
      };
      s.onload = function () {
        setTimeout(checkFilled, 350);
      };
      document.head.appendChild(s);
    }

    if (!window.__ytExoPushCalled) {
      window.__ytExoPushCalled = true;
      (window.AdProvider = window.AdProvider || []).push({ serve: {} });
    }

    setTimeout(function () {
      checkFilled();
      if (!resolved) {
        resolved = true;
        if (obs) obs.disconnect();
        notify('failed', 'no_fill_timeout');
      }
    }, 8000);
  })();
</script>`;
    }
  } else if (template.templateType === 'javascript') {
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
  <meta name="viewport" content="width=device-width, initial-scale=1" />${isExoClick ? `\n  ${EXOCLICK_DELEGATE_CH_META}` : ''}
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
    img, iframe, video, ins { max-width: 100%; max-height: 100%; border: 0; }
  </style>
</head>
<body>${bodyContent}</body>
</html>`;
}
