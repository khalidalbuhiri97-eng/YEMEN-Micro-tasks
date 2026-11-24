import React, { useState } from 'react';
import { AdPartnersManager } from './AdPartnersManager.tsx';
import { MiningAdsManager } from './MiningAdsManager.tsx';

type Section = 'partners' | 'templates';

export const AdManagementHub: React.FC = () => {
  const [section, setSection] = useState<Section>('templates');

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-base font-extrabold text-slate-900 dark:text-white">مركز الإعلانات</h2>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          إدارة قوالب الإعلانات ومواقع عرضها، ثم إدارة شبكات وشركاء الإعلانات من مكان واحد.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-2" role="tablist" aria-label="أقسام مركز الإعلانات">
          <button
            type="button"
            role="tab"
            aria-selected={section === 'templates'}
            onClick={() => setSection('templates')}
            className={`rounded-xl px-3 py-2.5 text-xs font-bold transition-colors ${section === 'templates' ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}
          >
            القوالب ومواقع العرض والتتبع
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={section === 'partners'}
            onClick={() => setSection('partners')}
            className={`rounded-xl px-3 py-2.5 text-xs font-bold transition-colors ${section === 'partners' ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}
          >
            الشركاء والشبكات
          </button>
        </div>
      </div>
      {section === 'templates' ? <MiningAdsManager /> : <AdPartnersManager />}
    </div>
  );
};
