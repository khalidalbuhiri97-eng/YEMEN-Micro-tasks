import React from 'react';
import { Check, ShieldCheck } from 'lucide-react';

export const CAMPAIGN_SERVICE_FEE_INCLUSIONS = [
  'مقابل توفير الجمهور المناسب للحملة.',
  'تشغيل المنصة والبنية التقنية والصيانة والتطوير وأرباح المنصة.',
  'تدقيق ومراجعة المهمات.',
  'تتبع المهمات ومراقبة الأداء.',
  'التحقق من الإنجازات واعتمادها.',
  'منع التلاعب والتكرار والإنجازات الوهمية.',
  'حماية ميزانية المعلن ومراقبة تنفيذ الحملة.',
] as const;

interface CampaignServiceFeeDetailsProps {
  feePercentage?: number;
  className?: string;
}

export const CampaignServiceFeeDetails: React.FC<CampaignServiceFeeDetailsProps> = ({
  feePercentage = 20,
  className = '',
}) => {
  const formattedPct = Number.isFinite(Number(feePercentage)) ? Number(feePercentage) : 20;

  return (
    <section
      aria-label="ماذا تشمل رسوم خدمة يمن تاسك؟"
      className={`rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700/80 p-3.5 sm:p-4 space-y-2.5 ${className}`}
    >
      <div className="flex items-center gap-2 text-slate-900 dark:text-white">
        <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
        <h3 className="text-xs sm:text-sm font-extrabold leading-snug">
          ماذا تشمل رسوم خدمة يمن تاسك؟
        </h3>
      </div>

      <ul className="space-y-1.5 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
        {CAMPAIGN_SERVICE_FEE_INCLUSIONS.map((point) => (
          <li key={point} className="flex items-start gap-2">
            <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-1" />
            <span>{point}</span>
          </li>
        ))}
      </ul>

      <p className="pt-2 border-t border-slate-100 dark:border-slate-800 text-[11px] sm:text-xs font-semibold text-emerald-700 dark:text-emerald-400 leading-relaxed">
        هذه النقاط توضيحية ضمن رسوم إجمالية واحدة{' '}
        <span className="font-mono tabular-nums">{formattedPct}%</span>{' '}
        وليست رسوماً مستقلة.
      </p>
    </section>
  );
};
