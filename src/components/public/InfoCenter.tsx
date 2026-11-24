import React, { useState } from 'react';
import {
  Building2, Send, Smartphone, Clock, ShieldCheck, ChevronDown,
  HelpCircle, FileText, LockKeyhole, ShieldAlert, Phone, Mail, Globe,
  Wallet, CheckCircle2
} from 'lucide-react';

type InfoTab = 'payouts' | 'faq' | 'policies' | 'support';

interface InfoCenterProps {
  onOpenTerms: () => void;
  onOpenPrivacy: () => void;
}

const payoutMethods = [
  { title: 'بنك الكريمي للتمويل الأصغر', detail: 'تحويل إلى حسابك أو حوالة نقدية للاستلام من فروع ووكلاء الكريمي.', min: '1,500 ر.ي', max: '400,000 ر.ي', Icon: Building2 },
  { title: 'شبكة النجم للحوالات', detail: 'حوالة باسم المستفيد للاستلام النقدي من نقاط شبكة النجم.', min: '1,000 ر.ي', max: '500,000 ر.ي', Icon: Send },
  { title: 'محفظة جوالي – كاك بنك', detail: 'تحويل إلكتروني مباشر إلى رقم محفظتك المسجل.', min: '1,000 ر.ي', max: '250,000 ر.ي', Icon: Smartphone },
  { title: 'محفظة ون كاش', detail: 'تحويل مباشر إلى محفظة OneCash.', min: '1,000 ر.ي', max: '300,000 ر.ي', Icon: Wallet },
];

const faqs = [
  { q: 'هل التسجيل في المنصة مجاني؟', a: 'نعم، التسجيل واستخدام المنصة مجانيان. لا تطلب Yemen Task رسوم اشتراك للانضمام أو بدء تنفيذ المهام.' },
  { q: 'ما الحد الأدنى لطلب السحب؟', a: 'الحد الأدنى العام لطلب السحب هو 1,000 ريال يمني، وقد تختلف حدود وسيلة الدفع المختارة حسب الشبكة.' },
  { q: 'كيف أتحقق من وصول الحوالة؟', a: 'بعد إتمام الصرف يتم تزويد المستفيد برقم الحوالة المرجعي أو إشعار التحويل، ويمكن استخدام الرقم لدى جهة الصرف للتحقق من حالة الحوالة.' },
  { q: 'كم يستغرق تدقيق إثبات المهمة؟', a: 'تخضع الإثباتات لمراجعة فريق التدقيق. تختلف المدة بحسب ضغط الطلبات وطبيعة المهمة، ويضاف المقابل إلى المحفظة بعد قبول الإثبات.' },
  { q: 'ما أسباب رفض الإثبات؟', a: 'قد يُرفض الإثبات إذا كان غير واضح أو مكرراً أو لا يطابق المطلوب في تعليمات المهمة.' },
];

export const InfoCenter: React.FC<InfoCenterProps> = ({ onOpenTerms, onOpenPrivacy }) => {
  const [activeTab, setActiveTab] = useState<InfoTab>('payouts');
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  const tabs: { id: InfoTab; label: string }[] = [
    { id: 'payouts', label: 'طرق السحب' },
    { id: 'faq', label: 'الأسئلة الشائعة' },
    { id: 'policies', label: 'السياسات' },
    { id: 'support', label: 'الدعم الفني' },
  ];

  return (
    <section dir="rtl" className="w-full min-w-0 space-y-4 pb-4">
      <header className="rounded-2xl bg-gradient-to-l from-emerald-700 to-emerald-600 p-4 sm:p-5 text-white shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-white/15 flex items-center justify-center shrink-0"><HelpCircle className="w-6 h-6" /></div>
          <div className="min-w-0">
            <h1 className="text-lg sm:text-xl font-extrabold">مركز المعلومات والسحب والسياسات</h1>
            <p className="text-xs text-emerald-50/90 mt-1">كل ما تحتاج معرفته عن خدمات المنصة ووسائل التواصل</p>
          </div>
        </div>
      </header>

      <div role="tablist" aria-label="أقسام مركز المعلومات" className="grid grid-cols-4 gap-1 rounded-xl bg-slate-100 dark:bg-slate-900 p-1 w-full min-w-0">
        {tabs.map((tab) => (
          <button key={tab.id} type="button" role="tab" aria-selected={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`min-w-0 rounded-lg px-1 py-2.5 text-[10px] sm:text-xs font-bold transition-colors ${activeTab === tab.id ? 'bg-white dark:bg-slate-800 text-emerald-700 dark:text-emerald-400 shadow-sm' : 'text-slate-500 dark:text-slate-400'}`}>
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'payouts' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-extrabold text-slate-900 dark:text-white">شبكات الدفع المعتمدة</h2>
            <span className="text-[10px] text-slate-500">الريال اليمني (YER)</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {payoutMethods.map(({ title, detail, min, max, Icon }) => (
              <article key={title} className="w-full min-w-0 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5 shadow-sm">
                <div className="flex items-center gap-2.5 mb-2">
                  <span className="w-9 h-9 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 flex items-center justify-center shrink-0"><Icon className="w-5 h-5" /></span>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white min-w-0">{title}</h3>
                </div>
                <p className="text-xs leading-5 text-slate-500 dark:text-slate-400 min-h-10">{detail}</p>
                <div className="grid grid-cols-2 gap-2 mt-3 pt-3 border-t border-slate-100 dark:border-slate-800 text-[11px]">
                  <div><span className="block text-slate-400 mb-1">الحد الأدنى</span><strong className="font-mono text-slate-800 dark:text-slate-200">{min}</strong></div>
                  <div><span className="block text-slate-400 mb-1">الحد الأقصى</span><strong className="font-mono text-slate-800 dark:text-slate-200">{max}</strong></div>
                </div>
              </article>
            ))}
          </div>
          <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-100 dark:border-emerald-900/50 p-3 flex items-center gap-2 text-xs text-emerald-800 dark:text-emerald-300">
            <Clock className="w-4 h-4 shrink-0" /><span>ساعات معالجة طلبات السحب: يومياً من 9 صباحاً حتى 6 مساءً.</span>
          </div>
          <div className="rounded-xl bg-slate-100 dark:bg-slate-900 p-3 flex items-start gap-2 text-xs leading-5 text-slate-600 dark:text-slate-400">
            <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" /><span>تتم مراجعة طلبات السحب والتحقق من بيانات المستفيد قبل اعتماد التحويل. احتفظ بالرقم المرجعي الصادر بعد إتمام الحوالة.</span>
          </div>
        </div>
      )}

      {activeTab === 'faq' && (
        <div className="space-y-2">
          <h2 className="font-extrabold text-slate-900 dark:text-white mb-3">الأسئلة المتكررة</h2>
          {faqs.map((faq, index) => (
            <article key={faq.q} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
              <button type="button" aria-expanded={openFaq === index} onClick={() => setOpenFaq(openFaq === index ? null : index)}
                className="w-full min-w-0 flex items-center justify-between gap-3 p-3.5 text-right text-xs sm:text-sm font-bold text-slate-800 dark:text-slate-100">
                <span className="min-w-0">{faq.q}</span><ChevronDown className={`w-4 h-4 shrink-0 text-slate-400 transition-transform ${openFaq === index ? 'rotate-180 text-emerald-600' : ''}`} />
              </button>
              {openFaq === index && <p className="px-3.5 pb-4 text-xs leading-6 text-slate-600 dark:text-slate-400 border-t border-slate-100 dark:border-slate-800 pt-3">{faq.a}</p>}
            </article>
          ))}
        </div>
      )}

      {activeTab === 'policies' && (
        <div className="space-y-3">
          <h2 className="font-extrabold text-slate-900 dark:text-white">السياسات والشروط</h2>
          <button type="button" onClick={onOpenTerms} className="w-full flex items-center gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 text-right">
            <FileText className="w-5 h-5 text-emerald-600 shrink-0" /><span className="flex-1 text-sm font-bold text-slate-800 dark:text-white">الشروط والأحكام</span><span className="text-xs text-emerald-600">عرض</span>
          </button>
          <button type="button" onClick={onOpenPrivacy} className="w-full flex items-center gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 text-right">
            <LockKeyhole className="w-5 h-5 text-emerald-600 shrink-0" /><span className="flex-1 text-sm font-bold text-slate-800 dark:text-white">سياسة الخصوصية</span><span className="text-xs text-emerald-600">عرض</span>
          </button>
          <article className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
            <div className="flex items-center gap-2 mb-2"><ShieldCheck className="w-5 h-5 text-emerald-600" /><h3 className="text-sm font-bold text-slate-900 dark:text-white">إخلاء مسؤولية وشفافية الأرباح</h3></div>
            <p className="text-xs leading-6 text-slate-600 dark:text-slate-400">لا تقدم Yemen Task ضماناً لدخل ثابت أو أرباح مضمونة. تستحق المكافآت عند إنجاز المهام واستيفاء شروطها والتحقق من الإثباتات. تخضع طلبات السحب للمراجعة وحدود جهات الدفع.</p>
          </article>
          <article className="rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50/70 dark:bg-amber-950/20 p-4">
            <div className="flex items-center gap-2 mb-2"><ShieldAlert className="w-5 h-5 text-amber-600" /><h3 className="text-sm font-bold text-amber-900 dark:text-amber-300">تنبيه الأمان والنزاهة</h3></div>
            <p className="text-xs leading-6 text-amber-900/80 dark:text-amber-200/80">استخدم بياناتك الصحيحة وحساباً واحداً، ولا تشارك كلمة المرور أو رموز التحقق مع أي شخص. يمنع التلاعب بالإثباتات أو استغلال النظام، وقد تخضع الأنشطة المخالفة للمراجعة.</p>
          </article>
        </div>
      )}

      {activeTab === 'support' && (
        <div className="space-y-3">
          <h2 className="font-extrabold text-slate-900 dark:text-white">التواصل مع الدعم الفني</h2>
          <article className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
            <div className="flex items-center gap-3 mb-3"><span className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 flex items-center justify-center"><Phone className="w-5 h-5" /></span><div><h3 className="text-sm font-bold text-slate-900 dark:text-white">الهاتف وواتساب</h3><p className="text-xs text-slate-500">الدعم المباشر</p></div></div>
            <a href="https://wa.me/967739701293" target="_blank" rel="noreferrer" className="block font-mono text-sm font-bold text-emerald-700 dark:text-emerald-400" dir="ltr">+967 739 701 293</a>
            <div className="flex gap-2 mt-3"><a href="tel:+967739701293" className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white">اتصال</a><a href="https://wa.me/967739701293" target="_blank" rel="noreferrer" className="rounded-lg bg-slate-100 dark:bg-slate-800 px-4 py-2 text-xs font-bold text-slate-700 dark:text-slate-200">واتساب</a></div>
          </article>
          <article className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
            <div className="flex items-center gap-3 mb-2"><span className="w-10 h-10 rounded-xl bg-sky-50 dark:bg-sky-950/50 text-sky-600 flex items-center justify-center"><Mail className="w-5 h-5" /></span><h3 className="text-sm font-bold text-slate-900 dark:text-white">البريد الإلكتروني</h3></div>
            <a href="mailto:khalidalbuhiri@gmail.com" className="text-sm font-mono font-bold text-slate-800 dark:text-slate-100 break-all">khalidalbuhiri@gmail.com</a>
          </article>
          <article className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
            <div className="flex items-center gap-3 mb-2"><span className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 flex items-center justify-center"><Globe className="w-5 h-5" /></span><h3 className="text-sm font-bold text-slate-900 dark:text-white">الملف التعريفي للمنصة</h3></div>
            <p className="text-xs leading-6 text-slate-600 dark:text-slate-400">Yemen Task منصة للمهام الرقمية المصغرة ومتابعة المكافآت وطلبات السحب بالريال اليمني.</p>
            <a href="/" className="inline-block mt-2 text-xs font-bold text-emerald-600">الصفحة الرئيسية للمنصة</a>
          </article>
        </div>
      )}
    </section>
  );
};
