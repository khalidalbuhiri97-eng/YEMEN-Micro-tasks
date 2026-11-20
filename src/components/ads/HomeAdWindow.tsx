import React from 'react';
import { SandboxedAdSlot } from './SandboxedAdSlot.tsx';

interface HomeAdWindowProps {
  className?: string;
}

const DefaultHomeAdWindow: React.FC<{ className?: string }> = ({ className = '' }) => {
  const adHtml = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=300, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self' https: http: data: 'unsafe-inline' 'unsafe-eval'; form-action 'none'; object-src 'none'; base-uri 'none';" />
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body {
      width: 300px;
      height: 250px;
      overflow: hidden;
      display: flex;
      justify-content: center;
      align-items: center;
      background: transparent;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
  </style>
</head>
<body>
  <script type="text/javascript">
    atOptions = {
      'key' : '598beabfde4bf58eec891131c86415eb',
      'format' : 'iframe',
      'height' : 250,
      'width' : 300,
      'params' : {}
    };
  </script>
  <script type="text/javascript" src="https://bicea.org/22/598beabfde4bf58eec891131c86415eb"></script>
</body>
</html>`;

  return (
    <div
      className={`rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm p-3 flex flex-col items-center justify-center transition-all ${className}`}
    >
      <div className="w-full flex items-center justify-between mb-2 px-1 text-[11px] text-slate-500 dark:text-slate-400 font-medium">
        <span className="font-semibold">نافذة إعلانية ممولة</span>
        <span className="font-mono text-[10px]">300×250</span>
      </div>

      <div className="w-[300px] h-[250px] max-w-full rounded-xl overflow-hidden bg-slate-50 dark:bg-slate-950 flex items-center justify-center border border-slate-100 dark:border-slate-800/80">
        <iframe
          srcDoc={adHtml}
          width={300}
          height={250}
          title="نافذة إعلانية 300x250"
          sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
          referrerPolicy="no-referrer"
          className="w-[300px] h-[250px] border-0 block mx-auto bg-transparent"
          scrolling="no"
        />
      </div>
    </div>
  );
};

export const HomeAdWindow: React.FC<HomeAdWindowProps> = ({ className = '' }) => {
  return (
    <SandboxedAdSlot
      placementKey="home_clixwall_slot"
      className={className}
      fallbackNode={<DefaultHomeAdWindow className={className} />}
    />
  );
};
