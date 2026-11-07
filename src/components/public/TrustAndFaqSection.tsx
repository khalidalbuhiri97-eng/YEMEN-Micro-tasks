import React, { useState } from 'react';
import { ChevronDown, HelpCircle, ShieldAlert } from 'lucide-react';

export const TrustAndFaqSection: React.FC = () => {
  const [openIdx, setOpenIdx] = useState<number | null>(0);

  const faqs = [
    {
      q: 'هل الانضمام لمنصة كسب اليمن مجاني أم يتطلب رسوم اشتراك؟',
      a: 'التسجيل واستخدام المنصة مجاني 100% تماماً. لا نطلب أي مبالغ مالية أو اشتراكات على الإطلاق. أنت هنا لتكسب مقابل إنجازك الفعلي للمهام.',
    },
    {
      q: 'ما هي أقل قيمة يمكنني سحبها من رصيدي؟',
      a: 'الحد الأدنى لطلب السحب هو 1,000 ريال يمني فقط (YER). نتيح هذا الحد المنخفض لتمكين جميع المستخدمين والطلاب من سحب مستحقاتهم أولاً بأول.',
    },
    {
      q: 'كيف أضمن وصول الحوالة المالية إلى اسمي؟',
      a: 'عند تقديم طلب السحب، يتم حجز الرصيد وتدقيق بيانات المستفيد من قبل المراقب المالي للمنصة. يتم إرسال الحوالة فوراً عبر بنك الكريمي أو شبكة النجم، ونزودك برقم الحوالة المرجعي وإشعار الإرسال، ويمكنك صرفها نقداً بإبراز بطاقتك الشخصية.',
    },
    {
      q: 'هل يمكنني العمل من خارج صنعاء؟',
      a: 'نعم بالتأكيد! المنصة تغطي كافة المحافظات والمديريات اليمنية (صنعاء، عدن، تعز، حضرموت، إب، الحديدة، ذمار، مأرب وغيرها). طالما تمتلك هاتفاً متصلاً بالإنترنت يمكنك إنجاز المهام واستلام أرباحك.',
    },
    {
      q: 'كم يستغرق تدقيق إثبات المهمة قبل إضافة المبلغ للمحفظة؟',
      a: 'يتم تدقيق الإثباتات (الصور والنصوص) من قبل فريق التدقيق خلال بضع ساعات فقط، وبحد أقصى 24 ساعة. وبمجرد قبول الإثبات يُقيد المبلغ فورياً في محفظتك الإلكترونية.',
    },
    {
      q: 'ما هي معايير رفض الإثبات؟',
      a: 'يُرفض الإثبات إذا تم رفع صور غير واضحة، أو مكررة، أو إجابات عشوائية وغير مطابقة لخطوات المهمة. نلتزم بالعدالة والشفافية لحماية أصحاب الأعمال والمستقلين الجادين.',
    },
  ];

  return (
    <section className="py-16 bg-slate-50 dark:bg-slate-950 transition-colors">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-10">
          <p className="text-xs font-bold text-emerald-600 dark:text-emerald-400 mb-2 flex items-center justify-center gap-1">
            <HelpCircle className="w-4 h-4" />
            <span>الأسئلة الشائعة والمصداقية</span>
          </p>
          <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white [text-wrap:balance]">
            كل ما تحتاج معرفته عن كسب وسحب الريال اليمني
          </h2>
        </div>

        <div className="space-y-3">
          {faqs.map((f, i) => {
            const isOpen = openIdx === i;
            return (
              <div
                key={i}
                className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden transition-all"
              >
                <button
                  type="button"
                  onClick={() => setOpenIdx(isOpen ? null : i)}
                  className="w-full text-right px-5 py-4 flex items-center justify-between gap-4 font-bold text-sm text-slate-900 dark:text-white hover:text-emerald-600 transition-colors"
                >
                  <span>{f.q}</span>
                  <ChevronDown
                    className={`w-4 h-4 text-slate-400 transition-transform duration-200 shrink-0 ${
                      isOpen ? 'rotate-180 text-emerald-600' : ''
                    }`}
                  />
                </button>
                {isOpen && (
                  <div className="px-5 pb-4 text-xs sm:text-sm text-slate-600 dark:text-slate-400 leading-relaxed border-t border-slate-100 dark:border-slate-800/60 pt-3">
                    {f.a}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Security / anti-fraud notice */}
        <div className="mt-8 p-4 rounded-xl bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/40 text-xs text-amber-900 dark:text-amber-300 flex items-start gap-3">
          <ShieldAlert className="w-4 h-4 shrink-0 text-amber-600 mt-0.5" />
          <p className="leading-relaxed">
            <strong>تنبيه الأمان والنزاهة:</strong> نراقب محاولات الغش والحسابات الوهمية بواسطة نظام حماية متطور. يرجى استخدام اسمك الحقيقي ورقم هاتفك الصحيح لضمان عدم تعليق حسابك وسرعة استلام الحوالات.
          </p>
        </div>
      </div>
    </section>
  );
};
