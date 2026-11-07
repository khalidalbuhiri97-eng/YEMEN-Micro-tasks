import React from 'react';
import { Smartphone, ClipboardList, Star, FileText, Database, Share2, ArrowLeft } from 'lucide-react';

interface TaskCategoriesProps {
  onSelectCategory: (category: string) => void;
}

export const TaskCategoriesSection: React.FC<TaskCategoriesProps> = ({ onSelectCategory }) => {
  const categories = [
    {
      id: 'app_testing',
      name: 'تجربة التطبيقات والمواقع',
      desc: 'فحص واجهات التطبيقات، تسجيل الدخول، واختبار سهولة الاستخدام مع كتابة تقرير فني مختصر.',
      icon: Smartphone,
    },
    {
      id: 'surveys',
      name: 'الاستبيانات وأبحاث السوق',
      desc: 'الإجابة على أسئلة استطلاعية تهم الشركات والمتاجر حول المنتجات والخدمات الاستهلاكية في اليمن.',
      icon: ClipboardList,
    },
    {
      id: 'review_ratings',
      name: 'تقييمات خرائط جوجل والمتاجر',
      desc: 'تقييم المنشآت والمطاعم والمتاجر المحلية على خرائط Google مع تعليق صادق وتجربة حقيقية.',
      icon: Star,
    },
    {
      id: 'data_entry',
      name: 'إدخال البيانات والأسعار',
      desc: 'توثيق أسعار السلع، أرقام التواصل، وقوائم المنتجات من الأسواق المحلية لمساعدة قواعد البيانات.',
      icon: Database,
    },
    {
      id: 'social_engagement',
      name: 'التفاعل والنشر الاجتماعي',
      desc: 'متابعة قنوات تيليجرام، الانضمام لصفحات فيسبوك، أو مشاركة عروض المتاجر في المجموعات المستهدفة.',
      icon: Share2,
    },
    {
      id: 'content_writing',
      name: 'كتابة المحتوى والأوصاف',
      desc: 'صياغة منشورات تسويقية، أوصاف منتجات يمنية (عسل، بن، بهارات)، أو مراجعات كتابية جذابة.',
      icon: FileText,
    },
  ];

  return (
    <section className="py-16 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 transition-colors">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col md:flex-row md:items-end justify-between mb-10 gap-4">
          <div>
            <p className="text-xs font-bold text-emerald-600 dark:text-emerald-400 mb-1">
              تنوع يناسب كافة المهارات
            </p>
            <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white [text-wrap:balance]">
              تصنيفات المهام في منصة كسب اليمن
            </h2>
          </div>
          <button
            onClick={() => onSelectCategory('all')}
            className="text-xs font-bold text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 flex items-center gap-1 group self-start md:self-auto"
          >
            <span>استعراض المهام المتاحة حالياً</span>
            <ArrowLeft className="w-3.5 h-3.5 group-hover:-translate-x-1 transition-transform" />
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {categories.map((c) => {
            const Icon = c.icon;
            return (
              <div
                key={c.id}
                onClick={() => onSelectCategory(c.id)}
                className="group cursor-pointer p-6 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 hover:border-emerald-500/50 hover:shadow-md transition-all flex flex-col justify-between"
              >
                <div>
                  <div className="w-10 h-10 rounded-xl bg-white dark:bg-slate-800 text-emerald-600 dark:text-emerald-400 shadow-sm border border-slate-200/60 dark:border-slate-700 flex items-center justify-center group-hover:bg-emerald-600 group-hover:text-white transition-colors mb-4">
                    <Icon className="w-5 h-5" />
                  </div>

                  <h3 className="text-base font-bold text-slate-900 dark:text-white mb-2 group-hover:text-emerald-600 transition-colors">
                    {c.name}
                  </h3>

                  <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed mb-4">
                    {c.desc}
                  </p>
                </div>

                <div className="pt-3 border-t border-slate-200/60 dark:border-slate-700/60 flex items-center justify-between text-xs text-emerald-600 dark:text-emerald-400 font-semibold">
                  <span>تصفح هذا التصنيف</span>
                  <ArrowLeft className="w-3.5 h-3.5 group-hover:-translate-x-1 transition-transform" />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};
