import React from 'react';
import { Building2, Send, Smartphone, ShieldCheck, Clock, CheckCircle } from 'lucide-react';

export const YemenPayoutsSection: React.FC = () => {
  const methods = [
    {
      code: 'KURAIMI',
      title: 'بنك الكريمي للتمويل الأصغر الإسلامي',
      desc: 'سحب فوري إلى حسابك الكريمي المميز، أو عبر خدمة إرسال صرافة للاستلام نقداً من أي فرع أو وكيل للكريمي في كافة محافظات اليمن.',
      min: '1,500 ر.ي',
      max: '400,000 ر.ي',
      icon: Building2,
      badge: 'الأكثر استخداماً',
    },
    {
      code: 'NAJM',
      title: 'شبكة النجم للحوالات المالية الفورية',
      desc: 'حوالة باسمك الرباعي ورقم هاتفك، قابلة للصرف الفوري من أكثر من 3,500 نقطة ووكيل صرافة في جميع المدن والقرى اليمنية.',
      min: '1,000 ر.ي',
      max: '500,000 ر.ي',
      icon: Send,
      badge: 'استلام نقدي بالبطاقة',
    },
    {
      code: 'JAWALI',
      title: 'محفظة جوالي (كاك بنك)',
      desc: 'إيداع إلكتروني مباشر إلى رقم حساب محفظتك على تطبيق جوالي، للاستفادة منها في تسديد الفواتير أو الشراء أو السحب النقدي.',
      min: '1,000 ر.ي',
      max: '250,000 ر.ي',
      icon: Smartphone,
      badge: 'محفظة إلكترونية',
    },
    {
      code: 'ONE_CASH',
      title: 'محفظة ون كاش (OneCash)',
      desc: 'تحويل مباشر لمحفظة ون كاش لتسهيل تسديد الرصيد والإنترنت وخدمات الدفع السريعة في اليمن.',
      min: '1,000 ر.ي',
      max: '300,000 ر.ي',
      icon: Smartphone,
      badge: 'دفع رقمي',
    },
  ];

  return (
    <section className="py-16 bg-slate-50 dark:bg-slate-950 transition-colors">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
          {/* Left Visual: Payment Concept Photo */}
          <div className="lg:col-span-5 order-2 lg:order-1">
            <div className="relative rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-800 shadow-lg bg-slate-900">
              <img
                src="/src/assets/images/payment_methods_yemen_1793978996941.jpg"
                alt="إشعار حوالة مالية بالريال اليمني"
                referrerPolicy="no-referrer"
                className="w-full h-auto object-cover"
              />
              <div className="p-5 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800">
                <div className="flex items-center gap-2 text-xs font-bold text-slate-900 dark:text-white mb-1">
                  <ShieldCheck className="w-4 h-4 text-emerald-600" />
                  <span>ضمان وصول الحوالة بإشعار رسمي</span>
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">
                  يتم تزويدك برقم الحوالة المرجعي (Reference Number) فور إتمام التحويل مع إمكانية التحقق المباشر من خلال تطبيق الكريمي أو شبكة النجم.
                </p>
              </div>
            </div>
          </div>

          {/* Right Text & Network Grid */}
          <div className="lg:col-span-7 order-1 lg:order-2">
            <p className="text-xs font-bold text-emerald-600 dark:text-emerald-400 mb-2">
              بنية مالية محلية مصممة لليمن
            </p>
            <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white mb-4 [text-wrap:balance]">
              استلم أرباحك بالريال اليمني (YER) عبر أشهر شبكات الصرافة والبنوك
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-400 mb-8 leading-relaxed">
              ندرك طبيعة المعاملات المالية في اليمن وتحديات الدفع الإلكتروني الخارجي، لذا بنينا جسراً مباشراً مع خدمات الصرافة المعتمدة لتتمكن من استلام مستحقاتك نقداً في منطقتك بكل سلاسة.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {methods.map((m, idx) => {
                const Icon = m.icon;
                return (
                  <div
                    key={idx}
                    className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 transition-colors"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                        <Icon className="w-4 h-4" />
                      </div>
                      <span className="text-[11px] font-medium text-slate-500">
                        {m.badge}
                      </span>
                    </div>

                    <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-1">
                      {m.title}
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed mb-3">
                      {m.desc}
                    </p>

                    <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800 text-[11px] font-mono tabular-nums text-slate-600 dark:text-slate-300">
                      <span>الحد الأدنى: {m.min}</span>
                      <span>الأقصى: {m.max}</span>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-6 flex items-center gap-4 text-xs text-slate-500 dark:text-slate-400">
              <span className="flex items-center gap-1.5">
                <Clock className="w-4 h-4 text-emerald-500" />
                معالجة يومية من 9 صباحاً حتى 6 مساءً
              </span>
              <span className="flex items-center gap-1.5">
                <CheckCircle className="w-4 h-4 text-emerald-500" />
                تتبع حالة الطلب لحظة بلحظة
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
