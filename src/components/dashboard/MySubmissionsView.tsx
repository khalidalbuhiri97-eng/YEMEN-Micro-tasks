import React, { useState, useEffect } from 'react';
import { api } from '../../api/client.ts';
import { useAuth } from '../../context/AuthContext.tsx';
import type { TaskSubmission } from '../../types/index.ts';
import { Clock, CheckCircle2, XCircle, AlertCircle, Image as ImageIcon, Eye, RefreshCw, X, FileCheck } from 'lucide-react';

interface MySubmissionsViewProps {
  onBrowseTasks: () => void;
}

export const MySubmissionsView: React.FC<MySubmissionsViewProps> = ({ onBrowseTasks }) => {
  const { user, openAuthModal } = useAuth();
  const [submissions, setSubmissions] = useState<TaskSubmission[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);

  const loadSubmissions = async () => {
    if (!user) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const res = await api.getMySubmissions();
      setSubmissions(res.submissions || []);
    } catch (err) {
      console.error('Failed to load submissions', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (user) {
      loadSubmissions();
    } else {
      setIsLoading(false);
    }
  }, [user]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'APPROVED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/50 rounded-lg border border-emerald-200 dark:border-emerald-800">
            <CheckCircle2 className="w-3.5 h-3.5" />
            تمت الموافقة وصرف المكافأة
          </span>
        );
      case 'REJECTED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/50 rounded-lg border border-rose-200 dark:border-rose-800">
            <XCircle className="w-3.5 h-3.5" />
            مرفوض
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/50 rounded-lg border border-amber-200 dark:border-amber-800">
            <Clock className="w-3.5 h-3.5" />
            قيد المراجعة والتدقيق
          </span>
        );
    }
  };

  if (!user) {
    return (
      <div className="py-16 px-4 max-w-lg mx-auto text-center">
        <div className="p-8 sm:p-10 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-5">
          <div className="w-16 h-16 rounded-2xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto border border-emerald-200 dark:border-emerald-800 shadow-sm">
            <FileCheck className="w-8 h-8" />
          </div>

          <div>
            <h2 className="text-xl font-extrabold text-slate-900 dark:text-white">
              متابعة المهام والإثباتات
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 leading-relaxed">
              يرجى تسجيل الدخول أو إنشاء حساب لمتابعة إثباتات المهام التي أرسلتها وحالة اعتمادها من الإدارة.
            </p>
          </div>

          <div className="pt-2 flex flex-col sm:flex-row gap-3">
            <button
              type="button"
              onClick={() => openAuthModal('login')}
              className="flex-1 py-3 px-4 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-sm transition-colors flex items-center justify-center gap-2"
            >
              <span>تسجيل الدخول</span>
            </button>
            <button
              type="button"
              onClick={() => openAuthModal('register')}
              className="flex-1 py-3 px-4 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 font-bold text-xs rounded-xl transition-colors"
            >
              <span>إنشاء حساب جديد</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 dark:text-white">
            متابعة إثباتاتي والمهام المرسلة
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            تابع حالة تدقيق إثباتاتك ومكافآتك المضافة لمحفظتك.
          </p>
        </div>
        <button
          onClick={loadSubmissions}
          title="تحديث القائمة"
          className="p-2 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 rounded-2xl bg-slate-100 dark:bg-slate-800 animate-pulse" />
          ))}
        </div>
      ) : submissions.length === 0 ? (
        <div className="text-center py-12 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-8">
          <Clock className="w-10 h-10 text-slate-400 mx-auto mb-3" />
          <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-1">
            لم تقم بتقديم أي إثبات بعد
          </h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto mb-4">
            تصفح المهام اليومية المتاحة وابدأ بإنجاز أول مهمة لك لكسب الريال اليمني فوراً.
          </p>
          <button
            onClick={onBrowseTasks}
            className="px-5 py-2.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl transition-colors"
          >
            تصفح المهام المتاحة
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {submissions.map((sub) => (
            <div
              key={sub.id}
              className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4 transition-colors"
            >
              <div className="space-y-2 flex-1">
                <div className="flex flex-wrap items-center gap-3">
                  <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                    {sub.taskTitle || 'مهمة منجزة'}
                  </h3>
                  {getStatusBadge(sub.status)}
                </div>

                {sub.proofText && (
                  <p className="text-xs text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/60 p-3 rounded-xl border border-slate-200/50 dark:border-slate-700/50 leading-relaxed max-w-2xl">
                    <strong className="text-slate-800 dark:text-slate-200">نص الإثبات:</strong> {sub.proofText}
                  </p>
                )}

                {sub.rejectionReason && (
                  <div className="p-3 text-xs text-rose-800 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 rounded-xl flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                    <div>
                      <strong>سبب الرفض من الإدارة:</strong> {sub.rejectionReason}
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-4 text-[11px] text-slate-400 font-mono">
                  <span>تاريخ التقديم: {new Date(sub.createdAt).toLocaleDateString('ar-YE')}</span>
                  {sub.reviewedAt && (
                    <span>تاريخ المراجعة: {new Date(sub.reviewedAt).toLocaleDateString('ar-YE')}</span>
                  )}
                </div>
              </div>

              {/* Right: Reward & Actions */}
              <div className="flex items-center md:flex-col items-end justify-between gap-3 shrink-0 pt-3 md:pt-0 border-t md:border-t-0 border-slate-100 dark:border-slate-800">
                <div className="text-right">
                  <span className="text-[10px] text-slate-400 block">المكافأة</span>
                  <span className="text-base font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
                    +{sub.taskRewardYer?.toLocaleString() || '0'} ر.ي
                  </span>
                </div>

                {sub.proofImages && sub.proofImages.length > 0 && (
                  <button
                    onClick={() => setSelectedImage(sub.proofImages[0])}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 rounded-lg transition-colors"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>عرض الصورة المرفوعة</span>
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Image Lightbox Modal */}
      {selectedImage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in">
          <div className="relative max-w-2xl w-full bg-slate-900 rounded-2xl overflow-hidden border border-slate-700 p-2">
            <button
              onClick={() => setSelectedImage(null)}
              className="absolute top-4 left-4 z-10 p-2 bg-slate-950/70 text-white rounded-full hover:bg-slate-950 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
            <img
              src={selectedImage}
              alt="صورة الإثبات"
              className="w-full max-h-[80vh] object-contain rounded-xl"
            />
          </div>
        </div>
      )}
    </div>
  );
};
