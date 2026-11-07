import React from 'react';
import { Search, Send, Banknote, ArrowLeft } from 'lucide-react';

interface HowItWorksProps {
  onStart: () => void;
}

export const HowItWorks: React.FC<HowItWorksProps> = ({ onStart }) => {
  const steps = [
    {
      num: '01',
      title: 'اختر المهمة المناسبة لك',
      desc: 'تصفح قائمة المهام اليومية المتجددة: تجربة تطبيقات، تعبئة استبيانات، تقييم متاجر، أو تفاعل اجتماعي. اختر ما يناسب وقتك والمكافأة التي ترغب في كسبها.',
      icon: Search,
    },
    {
      num: '02',
      title: 'نفّذ المطلوب وارفع الإثبات',
      desc: 'اتبع التعليمات الواضحة خطوة بخطوة، ثم قم برفع لقطة الشاشة أو كتابة النص المطلوب في خانة إثبات الإنجاز من خلال لوحة التحكم بضغطة زر.',
      icon: Send,
    },
    {
      num: '03',
      title: 'استلم أرباحك واسحبها نقداً',
      desc: 'بمجرد تدقيق الإثبات واعتماده، يُضاف المبلغ فوراً إلى محفظتك بالريال اليمني. يمكنك طلب السحب مباشرة واستلامها نقداً من الكريمي أو النجم.',
      icon: Banknote,
    },
  ];

  return (
    <section className="py-16 bg-white dark:bg-slate-900 border-t border-b border-slate-200 dark:border-slate-800 transition-colors">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-2xl mx-auto mb-12">
          <p className="text-xs font-bold text-emerald-600 dark:text-emerald-400 mb-2">
            بساطة وسرعة ومصداقية
          </p>
          <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white [text-wrap:balance]">
            كيف تعمل منصة كسب اليمن؟ ثلاث خطوات بسيطة للبدء
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-3 leading-relaxed">
            صممنا آلية عمل واضحة ومباشرة لتضمن حصولك على مكافأتك العادلة بكل شفافية ودون أي تعقيدات.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {steps.map((s, idx) => {
            const Icon = s.icon;
            return (
              <div
                key={idx}
                className="relative p-6 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/70 hover:border-emerald-500/50 transition-all flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <div className="w-10 h-10 rounded-xl bg-emerald-600/10 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                      <Icon className="w-5 h-5" />
                    </div>
                    <span className="font-mono text-2xl font-bold text-slate-300 dark:text-slate-700">
                      {s.num}
                    </span>
                  </div>

                  <h3 className="text-base font-bold text-slate-900 dark:text-white mb-2">
                    {s.title}
                  </h3>

                  <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                    {s.desc}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-12 text-center">
          <button
            onClick={onStart}
            className="inline-flex items-center gap-2 px-6 py-3 text-sm font-semibold text-white bg-slate-900 dark:bg-emerald-600 hover:bg-slate-800 dark:hover:bg-emerald-700 rounded-xl shadow-sm transition-colors"
          >
            <span>ابدأ بتنفيذ أول مهمة لك الآن</span>
            <ArrowLeft className="w-4 h-4" />
          </button>
        </div>
      </div>
    </section>
  );
};
