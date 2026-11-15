import React from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { TreasurySummary } from '../../../types/index.ts';

interface MigrationReadinessBannerProps {
  treasury: TreasurySummary | null;
}

export const MigrationReadinessBanner: React.FC<MigrationReadinessBannerProps> = ({ treasury }) => {
  if (!treasury) return null;

  const missingAccounts = treasury.missingMigration011Accounts || [];
  const allReady =
    Boolean(treasury.migration011Ready) &&
    Boolean(treasury.taxTablesReady) &&
    Boolean(treasury.auditLogsTableReady) &&
    Boolean(treasury.withdrawalsTableReady);

  if (allReady) {
    return (
      <div className="px-4 py-2.5 rounded-xl border border-emerald-200 dark:border-emerald-800/60 bg-emerald-50/70 dark:bg-emerald-950/20 flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2 text-emerald-800 dark:text-emerald-300 font-semibold">
          <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <span>البنية المحاسبية والضريبية للترحيل 011 مكتملة ومرتبطة مباشرة بقاعدة البيانات الحية.</span>
        </div>
        <span className="font-mono text-[11px] text-emerald-700 dark:text-emerald-400">
          Migration 011: Active
        </span>
      </div>
    );
  }

  const missingParts: string[] = [];
  if (!treasury.migration011Ready && missingAccounts.length > 0) {
    missingParts.push(`حسابات الترحيل 011 غير المضافة بعد (${missingAccounts.length} حساباً)`);
  }
  if (treasury.taxTablesReady === false) {
    missingParts.push('جداول الضرائب (tax_definitions / tax_settlements)');
  }
  if (treasury.auditLogsTableReady === false) {
    missingParts.push('جدول التدقيق المالي (financial_audit_logs)');
  }
  if (treasury.withdrawalsTableReady === false) {
    missingParts.push('جدول طلبات السحب (withdrawal_requests)');
  }

  return (
    <div className="p-4 rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50/80 dark:bg-amber-950/30 text-xs space-y-2">
      <div className="flex items-start gap-2.5">
        <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <div className="font-bold text-amber-900 dark:text-amber-200">
            تنبيه الشفافية المحاسبية: بعض مكونات الترحيل المالي 011 لم تُنفّذ بعد على قاعدة البيانات الحية
          </div>
          <p className="text-amber-800 dark:text-amber-300 leading-relaxed">
            كافة الأرقام المعروضة حالياً مقروءة مباشرة من قاعدة البيانات الحية دون أي بيانات افتراضية. الأجزاء التالية بانتظار تنفيذ ملف الترحيل{' '}
            <span className="font-mono font-semibold" dir="ltr">
              011_comprehensive_financial_system_and_accounting.sql
            </span>{' '}
            في Supabase:
          </p>
          <div className="flex flex-wrap gap-1.5 pt-1">
            {missingParts.map((part, idx) => (
              <span
                key={idx}
                className="px-2 py-0.5 rounded-md bg-amber-100 dark:bg-amber-900/50 text-amber-900 dark:text-amber-200 font-semibold text-[11px]"
              >
                {part}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
