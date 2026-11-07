import React, { useState, useEffect } from 'react';
import { api } from '../../api/client.ts';
import { useAuth } from '../../context/AuthContext.tsx';
import type { WithdrawalRequest, PayoutMethod } from '../../types/index.ts';
import {
  Banknote,
  Building2,
  Send,
  Smartphone,
  ShieldCheck,
  AlertCircle,
  CheckCircle2,
  Clock,
  ArrowRight,
  Info,
} from 'lucide-react';

interface WithdrawViewProps {
  onGoToWallet: () => void;
}

export const WithdrawView: React.FC<WithdrawViewProps> = ({ onGoToWallet }) => {
  const { user, wallet, refreshWallet, showToast, openAuthModal } = useAuth();
  const [methods, setMethods] = useState<PayoutMethod[]>([]);
  const [selectedMethod, setSelectedMethod] = useState<string>('KURAIMI');
  const [amount, setAmount] = useState<string>('2000');
  const [beneficiaryName, setBeneficiaryName] = useState(user?.fullName || '');
  const [phoneNumber, setPhoneNumber] = useState(user?.phone || '');
  const [accountNumber, setAccountNumber] = useState('');
  const [withdrawals, setWithdrawals] = useState<WithdrawalRequest[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);

  const loadMethodsAndHistory = async () => {
    setIsLoadingHistory(true);
    try {
      const settingsRes = await api.getSettings();
      setMethods(settingsRes.payoutMethods || []);
      if (user) {
        const historyRes = await api.getMyWithdrawals();
        setWithdrawals(historyRes.withdrawals || []);
      } else {
        setWithdrawals([]);
      }
    } catch (err) {
      console.error('Error loading methods or history', err);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  useEffect(() => {
    loadMethodsAndHistory();
  }, [user]);

  const activeMethod = methods.find((m) => m.code === selectedMethod) || methods[0];
  const numAmount = Number(amount) || 0;
  const fee = activeMethod
    ? Math.round((numAmount * activeMethod.feePercentage) / 100) + activeMethod.feeFlat
    : 0;
  const netAmount = Math.max(0, numAmount - fee);
  const availableBal = wallet?.availableBalance || 0;
  const isBalanceSufficient = availableBal >= numAmount && numAmount > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!isBalanceSufficient) {
      setError('رصيدك المتاح غير كافٍ لسحب هذا المبلغ.');
      return;
    }

    if (activeMethod && numAmount < activeMethod.minWithdrawal) {
      setError(`الحد الأدنى للسحب هو ${activeMethod.minWithdrawal.toLocaleString()} ر.ي.`);
      return;
    }

    if (activeMethod && numAmount > activeMethod.maxWithdrawal) {
      setError(`الحد الأقصى للسحب هو ${activeMethod.maxWithdrawal.toLocaleString()} ر.ي.`);
      return;
    }

    if (!beneficiaryName.trim() || !phoneNumber.trim()) {
      setError('يرجى كتابة الاسم ورقم الهاتف المعتمدين لاستلام الحوالة.');
      return;
    }

    if (selectedMethod === 'KURAIMI' && !accountNumber.trim()) {
      setError('يرجى إدخال رقم حساب الكريمي المميز أو كتابة "إرسال صرافة بالاسم".');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await api.requestWithdrawal({
        method: selectedMethod,
        amount: numAmount,
        beneficiaryName,
        phoneNumber,
        accountNumber: accountNumber || undefined,
      });

      showToast('تم تقديم طلب السحب بنجاح وحجز الرصيد!', 'success');
      await refreshWallet();
      await loadMethodsAndHistory();
      setAmount('1000');
    } catch (err: any) {
      setError(err.message || 'فشل في إرسال طلب السحب.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'PAID':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/50 rounded-lg border border-emerald-200 dark:border-emerald-800">
            <CheckCircle2 className="w-3.5 h-3.5" />
            تم التحويل بنجاح
          </span>
        );
      case 'REJECTED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/50 rounded-lg border border-rose-200 dark:border-rose-800">
            مرفوض وتم استرجاع الرصيد
          </span>
        );
      case 'PROCESSING':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/50 rounded-lg border border-blue-200 dark:border-blue-800">
            جاري معالجة التحويل
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/50 rounded-lg border border-amber-200 dark:border-amber-800">
            <Clock className="w-3.5 h-3.5" />
            قيد التدقيق المالي
          </span>
        );
    }
  };

  if (!user) {
    return (
      <div className="py-16 px-4 max-w-lg mx-auto text-center">
        <div className="p-8 sm:p-10 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-5">
          <div className="w-16 h-16 rounded-2xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto border border-emerald-200 dark:border-emerald-800 shadow-sm">
            <Banknote className="w-8 h-8" />
          </div>

          <div>
            <h2 className="text-xl font-extrabold text-slate-900 dark:text-white">
              سحب الأرباح نقداً
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 leading-relaxed">
              يرجى تسجيل الدخول أو إنشاء حساب لطلب سحب الأرباح عبر بنك الكريمي، شبكة النجم، أو محفظتي جوالي وون كاش.
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
    <div className="space-y-8">
      {/* Page Title */}
      <div>
        <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 dark:text-white">
          سحب الأرباح عبر شبكات الصرافة اليمنية
        </h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
          اسحب أرباحك بالريال اليمني مباشرة إلى حسابك الكريمي أو حوالة النجم أو محفظة جوالي.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Form: Withdrawal Form */}
        <div className="lg:col-span-7 bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-6">
          {/* Available balance highlight */}
          <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700 flex items-center justify-between">
            <div>
              <span className="text-xs text-slate-500 dark:text-slate-400 block">رصيدك المتاح للسحب حالياً:</span>
              <span className="text-xl sm:text-2xl font-extrabold font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
                {availableBal.toLocaleString()} <span className="text-sm font-normal">ر.ي</span>
              </span>
            </div>
            <button
              type="button"
              onClick={onGoToWallet}
              className="text-xs font-bold text-emerald-600 dark:text-emerald-400 hover:underline"
            >
              عرض حركات المحفظة
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <div className="p-3 text-xs text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 rounded-xl flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Payment Method Selector */}
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">
                اختر طريقة الدفع أو الصرافة:
              </label>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { code: 'KURAIMI', name: 'بنك الكريمي', sub: 'حساب مميز أو إرسال', icon: Building2 },
                  { code: 'NAJM', name: 'شبكة النجم', sub: 'حوالة بالاسم والهاتف', icon: Send },
                  { code: 'JAWALI', name: 'محفظة جوالي', sub: 'كاك بنك عبر الهاتف', icon: Smartphone },
                  { code: 'ONE_CASH', name: 'ون كاش', sub: 'OneCash الرقمية', icon: Smartphone },
                ].map((m) => {
                  const Icon = m.icon;
                  const isSelected = selectedMethod === m.code;
                  return (
                    <button
                      key={m.code}
                      type="button"
                      onClick={() => setSelectedMethod(m.code)}
                      className={`p-3.5 rounded-xl border text-right transition-all flex items-start gap-3 ${
                        isSelected
                          ? 'border-emerald-600 bg-emerald-50/50 dark:bg-emerald-950/30 text-emerald-900 dark:text-emerald-200 shadow-sm'
                          : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 text-slate-700 dark:text-slate-300 hover:border-slate-300'
                      }`}
                    >
                      <div
                        className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                          isSelected
                            ? 'bg-emerald-600 text-white'
                            : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700'
                        }`}
                      >
                        <Icon className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="text-xs font-bold">{m.name}</div>
                        <div className="text-[10px] text-slate-500 mt-0.5">{m.sub}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Amount Input */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  المبلغ المراد سحبه (ريال يمني - YER)
                </label>
                <button
                  type="button"
                  onClick={() => setAmount(String(availableBal))}
                  className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 hover:underline"
                >
                  سحب كامل الرصيد المتاح
                </button>
              </div>
              <div className="relative">
                <input
                  type="number"
                  required
                  min={activeMethod?.minWithdrawal || 1000}
                  max={activeMethod?.maxWithdrawal || 500000}
                  step="100"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full pl-12 pr-4 py-2.5 text-base font-bold font-mono bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-900 dark:text-slate-100"
                />
                <span className="absolute left-4 top-3 text-xs font-semibold text-slate-400">
                  ر.ي
                </span>
              </div>
            </div>

            {/* Live Fee & Net Calculations */}
            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 text-xs space-y-1.5 font-mono">
              <div className="flex items-center justify-between text-slate-500">
                <span>المبلغ المطلوب:</span>
                <span className="tabular-nums font-bold text-slate-700 dark:text-slate-300">
                  {numAmount.toLocaleString()} ر.ي
                </span>
              </div>
              <div className="flex items-center justify-between text-slate-500">
                <span>رسوم التحويل وشبكة الصرافة ({activeMethod?.feePercentage}%):</span>
                <span className="tabular-nums font-medium text-slate-600 dark:text-slate-400">
                  {fee.toLocaleString()} ر.ي
                </span>
              </div>
              <div className="pt-1.5 border-t border-slate-200 dark:border-slate-700/60 flex items-center justify-between text-slate-900 dark:text-white font-bold text-sm">
                <span>صافي المبلغ المستلم نقداً:</span>
                <span className="tabular-nums text-emerald-600 dark:text-emerald-400">
                  {netAmount.toLocaleString()} ر.ي
                </span>
              </div>
            </div>

            {/* Beneficiary Name */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                الاسم الرباعي للمستفيد (كما في البطاقة الشخصية لاستلام الحوالة)
              </label>
              <input
                type="text"
                required
                value={beneficiaryName}
                onChange={(e) => setBeneficiaryName(e.target.value)}
                placeholder="مثال: أحمد ناصر محمد العريقي"
                className="w-full px-3 py-2 text-xs sm:text-sm bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-900 dark:text-slate-100"
              />
            </div>

            {/* Phone Number */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                رقم الهاتف المعتمد لاستلام رسالة الحوالة / المحفظة
              </label>
              <input
                type="tel"
                required
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                placeholder="770112233"
                className="w-full px-3 py-2 text-xs sm:text-sm font-mono bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-900 dark:text-slate-100"
              />
            </div>

            {/* Account number (for Kuraimi) */}
            {selectedMethod === 'KURAIMI' && (
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  رقم حساب الكريمي المميز (أو اكتب "صرافة بالاسم")
                </label>
                <input
                  type="text"
                  required
                  value={accountNumber}
                  onChange={(e) => setAccountNumber(e.target.value)}
                  placeholder="مثال: 211904325"
                  className="w-full px-3 py-2 text-xs sm:text-sm font-mono bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-900 dark:text-slate-100"
                />
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting || !isBalanceSufficient}
              className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm rounded-xl shadow-md transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isSubmitting ? (
                <span>جاري معالجة طلب السحب وحجز الرصيد...</span>
              ) : (
                <>
                  <Banknote className="w-4 h-4" />
                  <span>تأكيد طلب السحب وحجز المبلغ</span>
                </>
              )}
            </button>
          </form>
        </div>

        {/* Right Column: Instructions & Past Withdrawal History */}
        <div className="lg:col-span-5 space-y-6">
          {/* Rules & Policy Card */}
          <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              <span>تعليمات وضمانات السحب المالي</span>
            </h3>
            <ul className="space-y-2 text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              <li className="flex items-start gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0 mt-1.5"></span>
                <span>
                  يتم حجز المبلغ فورياً من رصيدك المتاح، ولا يمكن التصرف فيه أثناء معالجة الطلب.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0 mt-1.5"></span>
                <span>
                  في حال تم رفض الطلب لأي سبب (مثل خطأ في رقم الحساب)، يُعاد المبلغ كاملاً إلى محفظتك آلياً.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0 mt-1.5"></span>
                <span>
                  تصلك رسالة وإشعار فوري برقم الحوالة المرجعي فور قيام المدير المالي بإرسالها.
                </span>
              </li>
            </ul>
          </div>

          {/* Past Withdrawals List */}
          <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
              طلبات السحب السابقة
            </h3>

            {isLoadingHistory ? (
              <div className="space-y-2">
                {[1, 2].map((i) => (
                  <div key={i} className="h-16 rounded-xl bg-slate-100 dark:bg-slate-800 animate-pulse" />
                ))}
              </div>
            ) : withdrawals.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-4">
                لا توجد طلبات سحب سابقة.
              </p>
            ) : (
              <div className="space-y-3">
                {withdrawals.map((w) => (
                  <div
                    key={w.id}
                    className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-700/80 space-y-1.5 text-xs"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-900 dark:text-white">
                        {w.methodNameAr || w.method}
                      </span>
                      {getStatusBadge(w.status)}
                    </div>

                    <div className="flex items-center justify-between font-mono tabular-nums text-slate-600 dark:text-slate-300">
                      <span>المبلغ: {w.amount.toLocaleString()} ر.ي</span>
                      <span className="text-emerald-600 dark:text-emerald-400 font-bold">
                        الصافي: {w.netAmount.toLocaleString()} ر.ي
                      </span>
                    </div>

                    {w.transferReference && (
                      <div className="p-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-[11px] text-emerald-800 dark:text-emerald-200 font-mono">
                        <strong>رقم الحوالة:</strong> {w.transferReference}
                      </div>
                    )}

                    {w.rejectionReason && (
                      <div className="p-2 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-[11px] text-rose-800 dark:text-rose-200">
                        <strong>سبب الرفض:</strong> {w.rejectionReason}
                      </div>
                    )}

                    <div className="text-[10px] text-slate-400 font-mono">
                      {new Date(w.createdAt).toLocaleDateString('ar-YE', {
                        year: 'numeric',
                        month: 'numeric',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
