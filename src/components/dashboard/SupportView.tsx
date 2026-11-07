import React, { useState, useEffect } from 'react';
import { api } from '../../api/client.ts';
import { useAuth } from '../../context/AuthContext.tsx';
import type { SupportTicket } from '../../types/index.ts';
import { MessageSquare, Send, PlusCircle, CheckCircle2, Clock, X, AlertCircle, Phone, Mail, MessageCircle } from 'lucide-react';

export const SupportView: React.FC = () => {
  const { user, showToast, openAuthModal } = useAuth();
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [activeTicket, setActiveTicket] = useState<SupportTicket | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [priority, setPriority] = useState('MEDIUM');
  const [replyText, setReplyText] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  const loadTickets = async () => {
    if (!user) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const res = await api.getSupportTickets();
      setTickets(res.tickets || []);
      if (res.tickets && res.tickets.length > 0) {
        setActiveTicket(res.tickets[0]);
      }
    } catch (err) {
      console.error('Error loading tickets', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (user) {
      loadTickets();
    } else {
      setIsLoading(false);
    }
  }, [user]);

  const handleCreateTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subject.trim() || !message.trim()) return;

    try {
      const res = await api.createSupportTicket({ subject, message, priority });
      showToast('تم فتح تذكرة الدعم بنجاح وسيتم الرد خلال وقت قصير.', 'success');
      setSubject('');
      setMessage('');
      setIsCreating(false);
      await loadTickets();
      setActiveTicket(res.ticket);
    } catch (err: any) {
      showToast(err.message || 'فشل في إنشاء التذكرة', 'error');
    }
  };

  const handleSendReply = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeTicket || !replyText.trim()) return;

    const newMsg = {
      id: crypto.randomUUID(),
      senderId: user?.id || 'user',
      senderRole: user?.role || 'user',
      senderName: user?.fullName || 'أنا',
      message: replyText.trim(),
      createdAt: new Date().toISOString(),
    };

    activeTicket.messages.push(newMsg);
    setReplyText('');
    showToast('تم إرسال ردك.', 'success');
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 dark:text-white">
            مركز الدعم والمساعدة الفنية
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            فريق الدعم المالي والتقني في اليمن جاهز للإجابة على استفساراتك وحل أي مشكلة.
          </p>
        </div>
        <button
          onClick={() => {
            if (!user) {
              openAuthModal('login');
              showToast('يرجى تسجيل الدخول أولاً لفتح تذكرة دعم ومتابعتها', 'info');
              return;
            }
            setIsCreating(!isCreating);
          }}
          className="px-4 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl transition-colors flex items-center gap-1.5"
        >
          <PlusCircle className="w-4 h-4" />
          <span>فتح تذكرة جديدة</span>
        </button>
      </div>

      {/* Official Technical Support Direct Channels */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Phone & WhatsApp Card */}
        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm flex items-start gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
            <Phone className="w-5 h-5" />
          </div>
          <div className="flex-1">
            <span className="text-[11px] font-bold text-slate-400 block mb-0.5">الاتصال المباشر وواتساب</span>
            <div className="text-base font-bold font-mono text-slate-900 dark:text-white" dir="ltr">
              +967 739 701 293
            </div>
            <div className="flex items-center gap-2 mt-2">
              <a
                href="https://wa.me/967739701293"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold rounded-lg transition-colors"
              >
                <MessageCircle className="w-3.5 h-3.5" />
                <span>محادثة واتساب فورية</span>
              </a>
              <a
                href="tel:+967739701293"
                className="inline-flex items-center gap-1 px-3 py-1 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-300 text-[11px] font-semibold rounded-lg transition-colors"
              >
                <span>اتصال</span>
              </a>
            </div>
          </div>
        </div>

        {/* Email Card */}
        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm flex items-start gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
            <Mail className="w-5 h-5" />
          </div>
          <div className="flex-1">
            <span className="text-[11px] font-bold text-slate-400 block mb-0.5">البريد الإلكتروني الرسمي</span>
            <a
              href="mailto:khalidalbuhiri@gmail.com"
              className="text-sm font-bold font-mono text-slate-900 dark:text-white hover:text-emerald-600 transition-colors block truncate"
            >
              khalidalbuhiri@gmail.com
            </a>
            <p className="text-[11px] text-slate-400 mt-1">الرد خلال دقائق لمعالجة مشاكل السحوبات والتحقق</p>
          </div>
        </div>
      </div>

      {/* New Ticket Modal / Accordion */}
      {isCreating && (
        <form
          onSubmit={handleCreateTicket}
          className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4 shadow-sm"
        >
          <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">فتح تذكرة استفسار أو شكوى جديدة</h3>
            <button
              type="button"
              onClick={() => setIsCreating(false)}
              className="text-slate-400 hover:text-slate-600"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                موضوع التذكرة
              </label>
              <input
                type="text"
                required
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="مثال: استفسار عن حوالة الكريمي أو مشكلة في إثبات المهمة..."
                className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                مستوى الأهمية
              </label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100"
              >
                <option value="LOW">عادي</option>
                <option value="MEDIUM">متوسط</option>
                <option value="HIGH">عاجل</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              تفاصيل الرسالة
            </label>
            <textarea
              rows={4}
              required
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="يرجى كتابة كافة التفاصيل لمساعدتك في أسرع وقت..."
              className="w-full p-3 text-xs bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100"
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setIsCreating(false)}
              className="px-4 py-2 text-xs font-medium text-slate-500 hover:bg-slate-100 rounded-lg"
            >
              إلغاء
            </button>
            <button
              type="submit"
              className="px-5 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg"
            >
              إرسال التذكرة
            </button>
          </div>
        </form>
      )}

      {/* Ticket List and Thread Split */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Ticket Selector */}
        <div className="lg:col-span-5 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
          <h3 className="text-xs font-bold text-slate-500 px-2">تذاكر الدعم السابقة:</h3>
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2].map((i) => (
                <div key={i} className="h-16 rounded-xl bg-slate-100 dark:bg-slate-800 animate-pulse" />
              ))}
            </div>
          ) : tickets.length === 0 ? (
            <p className="text-xs text-slate-400 p-4 text-center">لا توجد تذاكر حالية.</p>
          ) : (
            <div className="space-y-2">
              {tickets.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setActiveTicket(t)}
                  className={`w-full text-right p-3 rounded-xl border transition-all text-xs ${
                    activeTicket?.id === t.id
                      ? 'border-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/30'
                      : 'border-slate-200 dark:border-slate-800 hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-slate-900 dark:text-white truncate max-w-[200px]">
                      {t.subject}
                    </span>
                    <span
                      className={`text-[10px] font-semibold px-2 py-0.5 rounded ${
                        t.status === 'ANSWERED'
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      {t.status === 'ANSWERED' ? 'تم الرد' : 'مفتوحة'}
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-400 font-mono">
                    {new Date(t.createdAt).toLocaleDateString('ar-YE')}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Message Thread View */}
        <div className="lg:col-span-7 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 flex flex-col justify-between min-h-[400px]">
          {activeTicket ? (
            <>
              <div>
                <div className="pb-3 border-b border-slate-100 dark:border-slate-800 mb-4">
                  <h2 className="text-base font-bold text-slate-900 dark:text-white">
                    {activeTicket.subject}
                  </h2>
                  <div className="flex items-center gap-3 text-[11px] text-slate-400 font-mono mt-1">
                    <span>الحالة: {activeTicket.status === 'ANSWERED' ? 'تم الرد' : 'قيد الانتظار'}</span>
                    <span>·</span>
                    <span>الأولوية: {activeTicket.priority}</span>
                  </div>
                </div>

                {/* Messages */}
                <div className="space-y-4 max-h-[300px] overflow-y-auto pr-1">
                  {activeTicket.messages.map((m) => {
                    const isAdminMsg = m.senderRole === 'admin';
                    return (
                      <div
                        key={m.id}
                        className={`p-3.5 rounded-xl text-xs leading-relaxed max-w-[85%] ${
                          isAdminMsg
                            ? 'bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200 mr-auto text-left'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 ml-auto'
                        }`}
                      >
                        <div className="font-bold text-[11px] mb-1 text-slate-900 dark:text-white">
                          {m.senderName} ({isAdminMsg ? 'فريق الدعم' : 'أنا'})
                        </div>
                        <p>{m.message}</p>
                        <span className="block text-[10px] text-slate-400 font-mono mt-2">
                          {new Date(m.createdAt).toLocaleTimeString('ar-YE', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Reply Form */}
              <form onSubmit={handleSendReply} className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 flex gap-2">
                <input
                  type="text"
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder="اكتب ردك هنا..."
                  className="flex-1 px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100"
                />
                <button
                  type="submit"
                  className="px-4 py-2 bg-slate-900 dark:bg-emerald-600 text-white font-bold text-xs rounded-xl hover:bg-slate-800 flex items-center gap-1.5"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>إرسال</span>
                </button>
              </form>
            </>
          ) : (
            <div className="flex items-center justify-center h-full text-xs text-slate-400 py-16">
              اختر تذكرة لعرض المحادثة والردود
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
