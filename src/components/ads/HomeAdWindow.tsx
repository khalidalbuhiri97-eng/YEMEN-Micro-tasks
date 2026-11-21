import React from 'react';
import { AdsterraAd } from './AdsterraAd.tsx';

interface HomeAdWindowProps {
  className?: string;
}

/**
 * Homepage 300x250 ad placement. The reserved square remains visible
 * when the ad network has no fill, is blocked, or fails to load.
 */
export const HomeAdWindow: React.FC<HomeAdWindowProps> = ({ className = '' }) => {
  return (
    <div className={`w-full flex items-center justify-center ${className}`}>
      <div className="relative h-[250px] w-full max-w-[300px] overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-900 shadow-sm">
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center text-slate-400 dark:text-slate-500">
          <span className="text-xs font-bold">مساحة إعلانية</span>
          <span className="text-[10px]">300 × 250</span>
          <span className="text-[10px]">يظهر الإعلان عند توفره من الشبكة</span>
        </div>
        <div className="relative z-10 flex h-full w-full items-center justify-center">
          <AdsterraAd
            placementId="home_clixwall_slot"
            adKey="598beabfde4bf58eec891131c86415eb"
            scriptSrc="https://bicea.org/22/598beabfde4bf58eec891131c86415eb"
            width={300}
            height={250}
            className="!my-0"
          />
        </div>
      </div>
    </div>
  );
};
