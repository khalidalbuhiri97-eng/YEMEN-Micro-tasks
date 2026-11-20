import React from 'react';
import type { CampaignItem, WalletTransaction } from '../../types/index.ts';
import { CampaignServiceFeeDetails } from './CampaignServiceFeeDetails.tsx';
import { SecureImageView } from '../common/SecureImageView.tsx';
import {
  Building2,
  CheckCircle2,
  Clock,
  EyeOff,
  FileText,
  Megaphone,
  Play,
  Printer,
  RotateCcw,
  Shield,
  X,
} from 'lucide-react';
import { formatYer } from '../../../shared/money.ts';

const CATEGORY_LABELS: Record<string, string> = {
  app_testing: 'تجربة وتقييم التطبيقات',
  social_engagement: 'تفاعل شبكات التواصل',
  surveys: 'استبيانات وآراء',
  content_writing: 'كتابة ومراجعة المحتوى',
  data_entry: 'إدخال وتنظيم البيانات',
  review_ratings: 'مراجعات وتقييمات',
  local_services: 'خدمات محلية',
};

export function getCampaignStatusLabel(status: CampaignItem['status']): { label: string; cls: string } {
  switch (status) {
    case 'pending_approval':
      return {
        label: 'بانتظار موافقة الإدارة',
        cls: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-950/60 dark:text-yellow-300',
      };
    case 'pending_start':
      return {
        label: 'معتمدة — بانتظار البدء',
        cls: 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300',
      };
    case 'rejected':
      return {
        label: 'مرفوضة من الإدارة',
        cls: 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300',
      };
    case 'active':
      return {
        label: 'نشطة الآن',
        cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300',
      };
    case 'completed':
      return {
        label: 'مكتملة',
        cls: 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300',
      };
    case 'cancelled':
      return {
        label: 'ملغاة ومسواة',
        cls: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
      };
    default:
      return {
        label: 'متوقفة مؤقتاً',
        cls: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
      };
  }
}

interface CampaignDetailsModalProps {
  campaign: CampaignItem | null;
  isAdminView?: boolean;
  isApprovedAdvertiser?: boolean;
  actionBusy?: boolean;
  onClose: () => void;
  onOpenInvoice: (camp: CampaignItem) => void;
  onStart?: (camp: CampaignItem) => void;
  onSettle?: (camp: CampaignItem) => void;
}

export const CampaignDetailsModal: React.FC<CampaignDetailsModalProps> = ({
  campaign,
  isAdminView = false,
  isApprovedAdvertiser = true,
  actionBusy = false,
  onClose,
  onOpenInvoice,
  onStart,
  onSettle,
}) => {
  if (!campaign) return null;

  const meta = getCampaignStatusLabel(campaign.status);
  const progressPct =
    campaign.slots > 0
      ? Math.min(100, Math.round(((campaign.approvedCount ?? 0) / campaign.slots) * 100))
      : 0;
  const userVisibleIdentity = campaign.hideAdvertiserName
    ? 'معلن عبر يمن تاسك'
    : campaign.advertiserDisplayName || campaign.advertiserCompany || campaign.advertiserName || 'معلن عبر يمن تاسك';

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-slate-950/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-2xl max-h-[92vh] bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Mobile grab handle */}
        <div className="sm:hidden w-10 h-1.5 bg-slate-300 dark:bg-slate-700 rounded-full mx-auto mt-3 shrink-0" />

        {/* Header */}
        <div className="px-4 sm:px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-start justify-between gap-3 shrink-0">
          <div className="space-y-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
              <span className={`px-2 py-0.5 rounded font-bold ${meta.cls}`}>{meta.label}</span>
              <span aria-hidden="true">·</span>
              <span>{CATEGORY_LABELS[campaign.category] || campaign.category}</span>
              <span aria-hidden="true">·</span>
              <span>حملة معلن خارجي (تمويل ذاتي)</span>
            </div>
            <h2 className="text-base sm:text-lg font-extrabold text-slate-900 dark:text-white leading-snug">
              {campaign.title}
            </h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-white rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-5">
          {/* Advertiser Identity Block */}
          <div className="p-3.5 sm:p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/80 space-y-3">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                <Building2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <span>هوية المعلن ومصدر التمويل</span>
              </span>
              <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                حملة خارجية (ليست ممولة من المنصة)
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="p-3 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-1.5">
                <div className="text-[11px] text-slate-500 dark:text-slate-400">الظهور أمام المستخدمين:</div>
                <div className="flex items-center gap-2.5">
                  {!campaign.hideAdvertiserName && campaign.advertiserLogoUrl ? (
                    <SecureImageView
                      storagePathOrUrl={campaign.advertiserLogoUrl}
                      alt={userVisibleIdentity}
                      className="w-9 h-9 rounded-lg object-cover border border-slate-200 dark:border-slate-700 shrink-0"
                    />
                  ) : (
                    <div className="w-9 h-9 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-500 shrink-0">
                      {campaign.hideAdvertiserName ? <EyeOff className="w-4 h-4" /> : <Megaphone className="w-4 h-4" />}
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="font-bold text-slate-900 dark:text-white truncate">{userVisibleIdentity}</div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      {campaign.hideAdvertiserName
                        ? 'اسم المعلن مخفي عن المنفذين'
                        : 'يظهر الاسم والشعار للمنفذين'}
                    </div>
                  </div>
                </div>
              </div>

              {/* Real Advertiser Identity (Retained for Admin & Campaign Owner) */}
              <div className="p-3 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-1">
                <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1">
                  <Shield className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <span>{isAdminView ? 'الهوية الحقيقية المحفوظة للإدارة:' : 'بيانات حسابك الموثق:'}</span>
                </div>
                <div className="font-bold text-slate-900 dark:text-white">
                  {campaign.advertiserCompany || campaign.advertiserName || 'معلن معتمد'}
                </div>
                {campaign.advertiserName && (
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    المسؤول: {campaign.advertiserName}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Description & Execution Progress */}
          <div className="space-y-3">
            <div>
              <div className="text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">تفاصيل المهمة المطلوبة</div>
              <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed whitespace-pre-line">
                {campaign.description}
              </p>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs pt-2 border-t border-slate-100 dark:border-slate-800">
              <div>
                <span className="text-slate-500 dark:text-slate-400 block">المنجز</span>
                <strong className="font-mono tabular-nums text-slate-900 dark:text-white">
                  {campaign.approvedCount ?? 0} / {campaign.slots} ({progressPct}%)
                </strong>
              </div>
              <div>
                <span className="text-slate-500 dark:text-slate-400 block">الوقت المقدر</span>
                <strong className="font-mono tabular-nums text-slate-900 dark:text-white">
                  {campaign.timeEstimateMinutes} دقائق
                </strong>
              </div>
              <div className="col-span-2 sm:col-span-1">
                <span className="text-slate-500 dark:text-slate-400 block">تاريخ الإنشاء</span>
                <strong className="font-mono tabular-nums text-slate-900 dark:text-white">
                  {new Date(campaign.createdAt).toLocaleDateString('ar-YE')}
                </strong>
              </div>
              <div className="col-span-2 sm:col-span-3 pt-2 border-t border-slate-100 dark:border-slate-800">
                <span className="text-slate-500 dark:text-slate-400 block mb-0.5">النطاق الجغرافي المستهدف</span>
                <strong className="text-slate-900 dark:text-white">
                  {campaign.countryFlag ? `${campaign.countryFlag} ` : ''}
                  {campaign.countryNameAr
                    ? campaign.isNationwide === false && campaign.targetDivisions && campaign.targetDivisions.length > 0
                      ? `${campaign.countryNameAr} — ${campaign.targetDivisions.map((d) => d.nameAr).join('، ')}`
                      : `${campaign.countryNameAr} (كافة التقسيمات الإدارية)`
                    : 'جميع الدول العربية'}
                </strong>
              </div>
            </div>
          </div>

          {/* Cost & Escrow Summary */}
          <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-slate-900 dark:text-white">ملخص التكلفة والضمان المالي</span>
              <span className="font-mono tabular-nums text-slate-500 dark:text-slate-400">
                نسبة الرسوم: {campaign.feePercentage}%
              </span>
            </div>

            <div className="space-y-2 text-xs divide-y divide-slate-200/70 dark:divide-slate-700/70">
              <div className="flex items-center justify-between pt-1">
                <span className="text-slate-600 dark:text-slate-300">
                  ميزانية المكافآت ({formatYer(campaign.rewardUnits)} × {campaign.slots.toLocaleString()})
                </span>
                <span className="font-mono font-bold tabular-nums text-slate-900 dark:text-white">
                  {formatYer(campaign.budgetUnits)} ر.ي
                </span>
              </div>
              <div className="flex items-center justify-between pt-2">
                <span className="text-slate-600 dark:text-slate-300">
                  رسوم خدمة يمن تاسك ({campaign.feePercentage}%)
                </span>
                <span className="font-mono font-bold tabular-nums text-slate-900 dark:text-white">
                  {formatYer(campaign.feeUnits)} ر.ي
                </span>
              </div>
              <div className="flex items-center justify-between pt-2 text-sm">
                <span className="font-extrabold text-slate-900 dark:text-white">إجمالي تكلفة الحملة</span>
                <span className="font-mono font-extrabold tabular-nums text-emerald-600 dark:text-emerald-400">
                  {formatYer(campaign.totalUnits)} ر.ي
                </span>
              </div>
              <div className="flex items-center justify-between pt-2 text-[11px] text-slate-500 dark:text-slate-400">
                <span>الضمان المتبقي للمكافآت / الرسوم المعلقة</span>
                <span className="font-mono tabular-nums">
                  {formatYer(campaign.budgetEscrowBalance ?? 0)} / {formatYer(campaign.feeEscrowBalance ?? 0)} ر.ي
                </span>
              </div>
              {campaign.refundedUnits > 0 && (
                <div className="flex items-center justify-between pt-2 text-xs font-bold text-emerald-600 dark:text-emerald-400">
                  <span>المبالغ المسترجعة لمحفظة المعلن</span>
                  <span className="font-mono tabular-nums">{formatYer(campaign.refundedUnits)} ر.ي</span>
                </div>
              )}
            </div>

            {/* Required Service Fee Inclusion Section directly below cost summary */}
            <CampaignServiceFeeDetails feePercentage={campaign.feePercentage} />
          </div>
        </div>

        {/* Mobile-First Sticky Action Bar */}
        <div className="p-4 border-t border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-wrap items-center justify-between gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => onOpenInvoice(campaign)}
            className="min-h-[44px] flex-1 sm:flex-initial px-4 py-2.5 rounded-xl text-xs font-bold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 flex items-center justify-center gap-1.5 whitespace-nowrap"
          >
            <FileText className="w-4 h-4" />
            <span>فاتورة الحملة</span>
          </button>

          <div className="flex flex-wrap items-center gap-2 flex-1 sm:flex-initial justify-end">
            {campaign.status === 'pending_start' && isApprovedAdvertiser && onStart && (
              <button
                type="button"
                disabled={actionBusy}
                onClick={() => {
                  onClose();
                  onStart(campaign);
                }}
                className="min-h-[44px] px-4 py-2.5 rounded-xl text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 flex items-center justify-center gap-1.5 whitespace-nowrap"
              >
                <Play className="w-4 h-4" />
                <span>بدء الحملة</span>
              </button>
            )}

            {(campaign.status === 'pending_start' || campaign.status === 'active' || campaign.status === 'paused') && onSettle && (
              <button
                type="button"
                disabled={actionBusy}
                onClick={() => {
                  onClose();
                  onSettle(campaign);
                }}
                className="min-h-[44px] px-4 py-2.5 rounded-xl text-xs font-bold text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800 hover:bg-rose-50 dark:hover:bg-rose-950/40 disabled:opacity-50 flex items-center justify-center gap-1.5 whitespace-nowrap"
              >
                <RotateCcw className="w-4 h-4" />
                <span>إغلاق وتسوية</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

interface CampaignInvoiceModalProps {
  campaign: CampaignItem | null;
  isAdminView?: boolean;
  onClose: () => void;
}

export const CampaignInvoiceModal: React.FC<CampaignInvoiceModalProps> = ({
  campaign,
  isAdminView = false,
  onClose,
}) => {
  if (!campaign) return null;

  const invoiceNumber = `INV-${campaign.id.slice(0, 8).toUpperCase()}`;
  const statusMeta = getCampaignStatusLabel(campaign.status);
  const publicIdentity = campaign.hideAdvertiserName
    ? 'معلن عبر يمن تاسك'
    : campaign.advertiserDisplayName || campaign.advertiserCompany || campaign.advertiserName || 'معلن عبر يمن تاسك';

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-slate-950/75 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-2xl max-h-[92vh] bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sm:hidden w-10 h-1.5 bg-slate-300 dark:bg-slate-700 rounded-full mx-auto mt-3 shrink-0" />

        {/* Invoice Top Bar */}
        <div className="px-4 sm:px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-emerald-600 text-white font-black text-base flex items-center justify-center shrink-0">
              Y
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-extrabold text-slate-900 dark:text-white">
                فاتورة تمويل حملة إعلانية
              </h2>
              <p className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400" dir="ltr">
                {invoiceNumber}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق الفاتورة"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-white rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Invoice Body */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-5">
          {/* Meta Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs p-4 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800">
            <div className="space-y-1">
              <div className="text-[11px] text-slate-500 dark:text-slate-400">جهة الإصدار</div>
              <div className="font-bold text-slate-900 dark:text-white">منصة يمن تاسك (Yemen Task)</div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">نوع الفاتورة: تمويل حملة معلن خارجي</div>
            </div>

            <div className="space-y-1">
              <div className="text-[11px] text-slate-500 dark:text-slate-400">بيانات المعلن</div>
              <div className="font-bold text-slate-900 dark:text-white">
                {campaign.advertiserCompany || campaign.advertiserName || 'معلن معتمد'}
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                الاسم الظاهر للمستخدمين: <strong className="text-slate-700 dark:text-slate-200">{publicIdentity}</strong>
                {isAdminView && campaign.hideAdvertiserName ? ' (هوية محمية للإدارة)' : ''}
              </div>
            </div>

            <div>
              <span className="text-slate-500 dark:text-slate-400">الحالة: </span>
              <span className={`inline-block px-2 py-0.5 rounded font-bold text-[11px] ${statusMeta.cls}`}>
                {statusMeta.label}
              </span>
            </div>

            <div>
              <span className="text-slate-500 dark:text-slate-400">تاريخ الإصدار: </span>
              <span className="font-mono tabular-nums text-slate-800 dark:text-slate-200">
                {new Date(campaign.createdAt).toLocaleString('ar-YE')}
              </span>
            </div>

            <div className="sm:col-span-2">
              <span className="text-slate-500 dark:text-slate-400">النطاق الجغرافي: </span>
              <span className="font-semibold text-slate-800 dark:text-slate-200">
                {campaign.countryFlag ? `${campaign.countryFlag} ` : ''}
                {campaign.countryNameAr
                  ? campaign.isNationwide === false && campaign.targetDivisions && campaign.targetDivisions.length > 0
                    ? `${campaign.countryNameAr} (${campaign.targetDivisions.map((d) => d.nameAr).join('، ')})`
                    : `${campaign.countryNameAr} (شاملة)`
                  : 'جميع الدول العربية'}
              </span>
            </div>

            {campaign.fundingTransactionId && (
              <div className="sm:col-span-2 text-[11px] text-slate-500 dark:text-slate-400 font-mono" dir="ltr">
                TX: {campaign.fundingTransactionId}
              </div>
            )}
          </div>

          {/* Line Items */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
            <div className="px-4 py-3 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-xs font-bold text-slate-800 dark:text-slate-100">
              ملخص بنود فاتورة الحملة: {campaign.title}
            </div>

            <div className="p-4 space-y-2.5 text-xs divide-y divide-slate-100 dark:divide-slate-800">
              <div className="flex items-center justify-between pt-1">
                <div className="text-slate-600 dark:text-slate-300">
                  <div>ميزانية مكافآت المهمات</div>
                  <div className="text-[11px] font-mono tabular-nums text-slate-400">
                    {formatYer(campaign.rewardUnits)} ر.ي × {campaign.slots.toLocaleString()} مهمة
                  </div>
                </div>
                <span className="font-mono font-bold tabular-nums text-slate-900 dark:text-white">
                  {formatYer(campaign.budgetUnits)} ر.ي
                </span>
              </div>

              <div className="flex items-center justify-between pt-2.5">
                <span className="text-slate-600 dark:text-slate-300">
                  رسوم خدمة يمن تاسك الإجمالية ({campaign.feePercentage}%)
                </span>
                <span className="font-mono font-bold tabular-nums text-slate-900 dark:text-white">
                  {formatYer(campaign.feeUnits)} ر.ي
                </span>
              </div>

              <div className="flex items-center justify-between pt-2.5">
                <span className="text-slate-600 dark:text-slate-300">رسوم إيداع أو شحن المحفظة</span>
                <span className="font-mono font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                  0 ر.ي (مجاني)
                </span>
              </div>

              <div className="flex items-center justify-between pt-3 text-sm sm:text-base">
                <span className="font-extrabold text-slate-900 dark:text-white">الإجمالي المدفوع / المحجوز</span>
                <span className="font-mono font-extrabold tabular-nums text-emerald-600 dark:text-emerald-400">
                  {formatYer(campaign.totalUnits)} ر.ي
                </span>
              </div>

              {campaign.refundedUnits > 0 && (
                <div className="flex items-center justify-between pt-2.5 text-xs font-bold text-blue-600 dark:text-blue-400">
                  <span>المبلغ المسترجع بعد التسوية</span>
                  <span className="font-mono tabular-nums">-{formatYer(campaign.refundedUnits)} ر.ي</span>
                </div>
              )}
            </div>
          </div>

          {/* Service Fee Explanation directly below invoice cost summary */}
          <CampaignServiceFeeDetails feePercentage={campaign.feePercentage} />
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-wrap items-center justify-between gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => window.print()}
            className="min-h-[44px] flex-1 sm:flex-initial px-4 py-2.5 rounded-xl text-xs font-bold border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center justify-center gap-1.5"
          >
            <Printer className="w-4 h-4" />
            <span>طباعة الفاتورة</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] flex-1 sm:flex-initial px-6 py-2.5 rounded-xl text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700"
          >
            إغلاق
          </button>
        </div>
      </div>
    </div>
  );
};

interface CampaignLedgerTxModalProps {
  transaction: WalletTransaction | null;
  onClose: () => void;
}

export const CampaignLedgerTxModal: React.FC<CampaignLedgerTxModalProps> = ({ transaction, onClose }) => {
  if (!transaction) return null;

  const meta = transaction.metadata || {};
  const isCampaignTx =
    transaction.type === 'CAMPAIGN_FUNDING_RESERVE' ||
    transaction.type === 'CAMPAIGN_ESCROW_REFUND' ||
    transaction.type === 'AD_REVENUE' ||
    String(transaction.referenceId || '').startsWith('CAMPAIGN:') ||
    Boolean(meta.campaign_id);

  const feePct = Number(meta.fee_percentage ?? 20);
  const budgetUnits = Number(meta.budget_units ?? meta.refund_budget_units ?? 0);
  const feeUnits = Number(meta.fee_units ?? meta.refund_fee_units ?? 0);
  const totalUnits = Number(meta.total_units ?? meta.total_refund_units ?? Math.abs(transaction.amount));

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-slate-950/75 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-xl max-h-[92vh] bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sm:hidden w-10 h-1.5 bg-slate-300 dark:bg-slate-700 rounded-full mx-auto mt-3 shrink-0" />

        <div className="px-4 sm:px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3 shrink-0">
          <div>
            <h2 className="text-sm sm:text-base font-extrabold text-slate-900 dark:text-white">
              تفاصيل العملية المالية
            </h2>
            <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400" dir="ltr">
              {transaction.referenceId || transaction.id}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-white rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 sm:p-6 overflow-y-auto space-y-4">
          <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 space-y-2.5 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-slate-500 dark:text-slate-400">البيان</span>
              <span className="font-bold text-slate-900 dark:text-white text-left max-w-[70%]">
                {transaction.description}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500 dark:text-slate-400">التاريخ</span>
              <span className="font-mono tabular-nums text-slate-700 dark:text-slate-300">
                {new Date(transaction.createdAt).toLocaleString('ar-YE')}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500 dark:text-slate-400">قيمة الحركة</span>
              <span
                className={`font-mono font-extrabold tabular-nums text-sm ${
                  transaction.amount >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                }`}
              >
                {transaction.amount >= 0 ? '+' : ''}
                {formatYer(transaction.amount)} ر.ي
              </span>
            </div>

            {isCampaignTx && (budgetUnits > 0 || feeUnits > 0) && (
              <div className="pt-2.5 border-t border-slate-200 dark:border-slate-700 space-y-1.5">
                {budgetUnits > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600 dark:text-slate-300">ميزانية المهام</span>
                    <span className="font-mono font-bold tabular-nums text-slate-900 dark:text-white">
                      {formatYer(budgetUnits)} ر.ي
                    </span>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-slate-600 dark:text-slate-300">رسوم خدمة يمن تاسك ({feePct}%)</span>
                  <span className="font-mono font-bold tabular-nums text-slate-900 dark:text-white">
                    {formatYer(feeUnits)} ر.ي
                  </span>
                </div>
                <div className="flex items-center justify-between font-bold text-slate-900 dark:text-white">
                  <span>الإجمالي</span>
                  <span className="font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
                    {formatYer(totalUnits)} ر.ي
                  </span>
                </div>
              </div>
            )}
          </div>

          {isCampaignTx && <CampaignServiceFeeDetails feePercentage={feePct} />}
        </div>

        <div className="p-4 border-t border-slate-100 dark:border-slate-800 flex justify-end shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] w-full sm:w-auto px-6 py-2.5 rounded-xl text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700"
          >
            إغلاق
          </button>
        </div>
      </div>
    </div>
  );
};
