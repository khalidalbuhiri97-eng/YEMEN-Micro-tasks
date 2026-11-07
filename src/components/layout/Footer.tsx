import React from 'react';
import { ShieldCheck, Phone, Mail, MapPin } from 'lucide-react';

interface FooterProps {
  onNavigate: (tab: string) => void;
}

export const Footer: React.FC<FooterProps> = ({ onNavigate }) => {
  return (
    <footer className="border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 text-xs transition-colors">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-8">
          {/* Col 1: Platform & Trust */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-md bg-emerald-600 flex items-center justify-center text-white font-black text-sm">
                Y
              </div>
              <span className="text-base font-bold text-slate-900 dark:text-white">
                منصة Yemen Micro-tasks
              </span>
            </div>
            <p className="text-slate-500 text-xs leading-relaxed">
              المنصة اليمنية المستقلة الأولى للمهام الرقمية المصغرة والعمل عن بعد. نربط الشباب وأصحاب الكفاءات في اليمن مع أصحاب الأعمال لكسب الريال اليمني مباشرة دون وسطاء.
            </p>
            <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400 font-medium text-[11px]">
              <ShieldCheck className="w-4 h-4 shrink-0" />
              <span>دفعات حقيقية وسريعة بالريال اليمني (YER)</span>
            </div>
          </div>

          {/* Col 2: Quick Links */}
          <div className="space-y-2">
            <h4 className="text-sm font-semibold text-slate-900 dark:text-white">روابط سريعة</h4>
            <ul className="space-y-1.5">
              <li>
                <button
                  onClick={() => onNavigate('home')}
                  className="hover:text-emerald-600 transition-colors"
                >
                  الصفحة الرئيسية
                </button>
              </li>
              <li>
                <button
                  onClick={() => onNavigate('tasks')}
                  className="hover:text-emerald-600 transition-colors"
                >
                  المهام المتاحة اليوم
                </button>
              </li>
              <li>
                <button
                  onClick={() => onNavigate('wallet')}
                  className="hover:text-emerald-600 transition-colors"
                >
                  المحفظة وسحب الأرباح
                </button>
              </li>
              <li>
                <button
                  onClick={() => onNavigate('how_it_works')}
                  className="hover:text-emerald-600 transition-colors"
                >
                  طرق الدفع وشبكات الصرافة
                </button>
              </li>
            </ul>
          </div>

          {/* Col 3: Yemeni Payout Services */}
          <div className="space-y-2">
            <h4 className="text-sm font-semibold text-slate-900 dark:text-white">شبكات الدفع المعتمدة</h4>
            <ul className="space-y-1.5 text-xs">
              <li className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                <span>بنك الكريمي للتمويل الأصغر الإسلامي</span>
              </li>
              <li className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                <span>شبكة النجم للحوالات الفورية</span>
              </li>
              <li className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                <span>محفظة جوالي (كاك بنك)</span>
              </li>
              <li className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                <span>محفظة ون كاش (OneCash)</span>
              </li>
            </ul>
          </div>

          {/* Col 4: Contact & Support */}
          <div className="space-y-2">
            <h4 className="text-sm font-semibold text-slate-900 dark:text-white">الدعم الفني المباشر</h4>
            <p className="text-xs text-slate-500">فريق الدعم في صنعاء وعدن جاهز لمساعدتكم:</p>
            <div className="space-y-1 text-xs">
              <div className="flex items-center gap-2">
                <Phone className="w-3.5 h-3.5 text-slate-400" />
                <a href="tel:+967739701293" className="font-mono text-ltr hover:text-emerald-600 transition-colors" dir="ltr">+967 739 701 293</a>
              </div>
              <div className="flex items-center gap-2">
                <Mail className="w-3.5 h-3.5 text-slate-400" />
                <a href="mailto:khalidalbuhiri@gmail.com" className="font-mono hover:text-emerald-600 transition-colors">khalidalbuhiri@gmail.com</a>
              </div>
              <div className="flex items-center gap-2">
                <MapPin className="w-3.5 h-3.5 text-slate-400" />
                <span>الجمهورية اليمنية - صنعاء / عدن</span>
              </div>
            </div>
          </div>
        </div>

        {/* Mandatory Transparency & Legal Notice */}
        <div className="pt-6 border-t border-slate-100 dark:border-slate-800/80 text-[11px] leading-relaxed text-slate-500">
          <p className="mb-2">
            <strong className="text-slate-700 dark:text-slate-300 font-semibold">إخلاء مسؤولية وشفافية الأرباح:</strong> لا تقدم منصة "Yemen Micro-tasks" أي وعود وهمية أو ضمانات دخل ثابت. جميع المكافآت محددة بوضوح ومستحقة حصراً عند إنجاز المهام المطلوبة والتحقق الفعلي من مطابقتها للشروط. السحب يتم يدوياً وتدقيقه عبر مسؤولي الصرف وفق حدود وأنظمة شركات الصرافة اليمنية.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mt-4">
            <div className="flex items-center gap-4">
              <span>جميع الحقوق محفوظة لمنصة Yemen Micro-tasks © 2026</span>
              <span aria-hidden="true">·</span>
              <button onClick={() => onNavigate('privacy')} className="hover:underline">سياسة الخصوصية</button>
              <span aria-hidden="true">·</span>
              <button onClick={() => onNavigate('terms')} className="hover:underline">الشروط والأحكام</button>
            </div>
            <div className="text-slate-400 font-mono text-[10px]">
              النظام المالي الموثق: YER-LEDGER-V1
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
};
