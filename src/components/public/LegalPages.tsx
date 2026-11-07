import React from 'react';
import { ShieldCheck, FileText, X } from 'lucide-react';

interface LegalModalProps {
  type: 'terms' | 'privacy' | null;
  onClose: () => void;
}

export const LegalModal: React.FC<LegalModalProps> = ({ type, onClose }) => {
  if (!type) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-in fade-in">
      <div className="relative w-full max-w-2xl bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col max-h-[85vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-emerald-600" />
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              {type === 'terms' ? 'الشروط والأحكام وسياسة الاستخدام العادل' : 'سياسة الخصوصية وحماية البيانات المالية'}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-4 text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
          {type === 'terms' ? (
            <>
              <div>
                <h3 className="font-bold text-slate-900 dark:text-white mb-1">1. الأهلية والتسجيل في اليمن</h3>
                <p>
                  المنصة متاحة لجميع المواطنين والمقيمين في محافظات الجمهورية اليمنية. يجب على المستخدم تقديم اسمه الرباعي الحقيقي ورقم هاتفه الصحيح لضمان مطابقة الاسم عند استلام الحوالات المالية من شركات الصرافة.
                </p>
              </div>

              <div>
                <h3 className="font-bold text-slate-900 dark:text-white mb-1">2. قواعد إنجاز المهام والتحقق</h3>
                <p>
                  يلتزم المستخدم بتنفيذ تعليمات المهمة حرفياً وبأمانة. أي محاولة لرفع لقطات شاشة مفبركة، أو استخدام برامج التكرار الآلي (Bots)، أو نسخ إثباتات مستخدمين آخرين تؤدي إلى رفض الإثبات تلقائياً، وتجميد الحساب في حال التكرار.
                </p>
              </div>

              <div>
                <h3 className="font-bold text-slate-900 dark:text-white mb-1">3. سياسة السحب والعملة (YER)</h3>
                <p>
                  العملة الرسمية المعتمدة للمنصة هي الريال اليمني (YER). الحد الأدنى للسحب هو 1,000 ريال يمني. يتم تحويل المبالغ عبر بنك الكريمي أو شبكة النجم أو محفظة جوالي وفق الرسوم المعلنة بشفافية، ويتم تزويد المستفيد برقم الحوالة المرجعي فور إتمام الصرف.
                </p>
              </div>

              <div>
                <h3 className="font-bold text-slate-900 dark:text-white mb-1">4. مكافحة الاحتيال والنزاهة</h3>
                <p>
                  تحظر المنصة إنشاء حسابات متعددة لنفس الشخص بهدف استغلال مكافآت الإحالة. يحق للإدارة تجميد الحسابات المشبوهة وإجراء تسويات بعد التحقق المباشر مع صاحب الحساب.
                </p>
              </div>
            </>
          ) : (
            <>
              <div>
                <h3 className="font-bold text-slate-900 dark:text-white mb-1">1. البيانات التي نجمعها</h3>
                <p>
                  نجمع فقط البيانات الضرورية لتنفيذ المعاملات المالية وإثباتات المهام: الاسم الرباعي، رقم الهاتف اليمني، المدينة، ولقطات الشاشة التي يقدمها المستخدم لإثبات إنجاز المهام.
                </p>
              </div>

              <div>
                <h3 className="font-bold text-slate-900 dark:text-white mb-1">2. حماية وتشفير المعاملات</h3>
                <p>
                  لا نشارك بياناتك أو أرقام هواتفك مع أي طرف خارجي أو معلنين. تُستخدم البيانات حصرياً من قبل المراقب المالي للتحقق من هوية المستفيد لدى شركات الصرافة اليمنية وإصدار الحوالات المالية.
                </p>
              </div>

              <div>
                <h3 className="font-bold text-slate-900 dark:text-white mb-1">3. أمن السجل المالي</h3>
                <p>
                  تخضع جميع الحركات المالية في المحفظة لنظام تسجيل ذري غير قابل للتلاعب (Immutable Financial Ledger)، مما يضمن حق كل مستخدم في رصيده التاريخي والمتاح.
                </p>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 text-xs font-bold text-white bg-slate-900 dark:bg-emerald-600 rounded-xl"
          >
            إغلاق وقبول الشروط
          </button>
        </div>
      </div>
    </div>
  );
};
