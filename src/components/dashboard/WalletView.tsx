import React, { useState, useEffect } from 'react';
import { api } from '../../api/client.ts';
import { useAuth } from '../../context/AuthContext.tsx';
import type { WalletTransaction, WalletTransfer } from '../../types/index.ts';
import {
  Wallet,
  ArrowUpRight,
  ArrowDownLeft,
  Clock,
  ShieldCheck,
  CheckCircle,
  Banknote,
  Search,
  Filter,
  Copy,
  Check,
  Send,
  QrCode,
  ArrowRightLeft,
  X,
  AlertCircle,
  UserCheck,
  Sparkles,
  Lock,
} from 'lucide-react';
import confetti from 'canvas-confetti';

interface WalletViewProps {
  onGoToWithdraw: () => void;
  onGoToTasks: () => void;
}

export const WalletView: React.FC<WalletViewProps> = ({ onGoToWithdraw, onGoToTasks }) => {
  const { user, wallet, refreshWallet, openAuthModal, showToast } = useAuth();
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [transfers, setTransfers] = useState<WalletTransfer[]>([]);
  const [filterType, setFilterType] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  // Transfer Modal State
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [recipientAddress, setRecipientAddress] = useState('');
  const [transferAmount, setTransferAmount] = useState('');
  const [transferNote, setTransferNote] = useState('');
  const [recipientLookupName, setRecipientLookupName] = useState<string | null>(null);
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [isSubmittingTransfer, setIsSubmittingTransfer] = useState(false);

  // Receive Modal State
  const [isReceiveModalOpen, setIsReceiveModalOpen] = useState(false);
  const [hasCopiedAddress, setHasCopiedAddress] = useState(false);

  const loadData = async () => {
    if (!user) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const [walletRes, transfersRes] = await Promise.all([
        api.getMyWallet(),
        api.getWalletTransfers().catch(() => ({ transfers: [] })),
      ]);
      setTransactions(walletRes.transactions || []);
      setTransfers(transfersRes.transfers || []);
      await refreshWallet();
    } catch (err: any) {
      console.error('Error loading wallet data', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (user) {
      loadData();
    } else {
      setIsLoading(false);
    }
  }, [user]);

  // Handle Recipient Address Lookup with debounce
  useEffect(() => {
    const cleanAddress = recipientAddress.trim().toUpperCase();
    if (!cleanAddress || cleanAddress.length < 5) {
      setRecipientLookupName(null);
      setLookupError(null);
      return;
    }

    if (wallet?.walletAddress && cleanAddress === wallet.walletAddress.toUpperCase()) {
      setRecipientLookupName(null);
      setLookupError('لا يمكنك التحويل لنفس محفظتك.');
      return;
    }

    const timer = setTimeout(async () => {
      setIsLookingUp(true);
      setLookupError(null);
      try {
        const res = await api.lookupWallet(cleanAddress);
        if (res.wallet && res.wallet.ownerName) {
          setRecipientLookupName(res.wallet.ownerName);
          setLookupError(null);
        } else {
          setRecipientLookupName(null);
          setLookupError('عنوان المحفظة غير موجود.');
        }
      } catch (err: any) {
        setRecipientLookupName(null);
        setLookupError(err.message || 'لم يتم العثور على محفظة بهذا العنوان.');
      } finally {
        setIsLookingUp(false);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [recipientAddress, wallet?.walletAddress]);

  const handleCopyAddress = (text?: string) => {
    const addressToCopy = text || wallet?.walletAddress;
    if (!addressToCopy) return;

    navigator.clipboard.writeText(addressToCopy);
    setHasCopiedAddress(true);
    showToast('تم نسخ عنوان المحفظة إلى الحافظة', 'success');
    setTimeout(() => setHasCopiedAddress(false), 2500);
  };

  const handleExecuteTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    const amountNum = parseInt(transferAmount, 10);
    if (isNaN(amountNum) || amountNum <= 0) {
      showToast('يرجى إدخال مبلغ صحيح أكبر من 0 ر.ي', 'error');
      return;
    }

    if (amountNum > (wallet?.availableBalance || 0)) {
      showToast('رصيدك المتاح غير كافٍ لإتمام عملية التحويل', 'error');
      return;
    }

    if (!recipientAddress.trim() || !recipientLookupName) {
      showToast('يرجى التحقق من عنوان محفظة المستلم', 'error');
      return;
    }

    setIsSubmittingTransfer(true);
    try {
      await api.transferWallet({
        recipientAddress: recipientAddress.trim().toUpperCase(),
        amount: amountNum,
        note: transferNote.trim() || undefined,
      });

      try {
        confetti({ particleCount: 60, spread: 50 });
      } catch {}

      showToast(`تم تحويل ${amountNum.toLocaleString()} ر.ي بنجاح إلى ${recipientLookupName}!`, 'success');
      setIsTransferModalOpen(false);
      setRecipientAddress('');
      setTransferAmount('');
      setTransferNote('');
      setRecipientLookupName(null);
      await loadData();
    } catch (err: any) {
      showToast(err.message || 'فشلت عملية التحويل', 'error');
    } finally {
      setIsSubmittingTransfer(false);
    }
  };

  const filteredTransactions = transactions.filter((tx) => {
    if (filterType !== 'all') {
      if (filterType === 'TRANSFERS') {
        if (tx.type !== 'WALLET_TRANSFER_SENT' && tx.type !== 'WALLET_TRANSFER_RECEIVED') return false;
      } else if (tx.type !== filterType) {
        return false;
      }
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (
        tx.description.toLowerCase().includes(q) ||
        tx.id.toLowerCase().includes(q) ||
        (tx.referenceId && tx.referenceId.toLowerCase().includes(q))
      );
    }
    return true;
  });

  const getTransactionTypeLabel = (type: string) => {
    switch (type) {
      case 'TASK_REWARD':
        return 'مكافأة إنجاز مهمة';
      case 'WITHDRAWAL_REQUEST':
        return 'حجز طلب سحب';
      case 'WITHDRAWAL_REFUND':
        return 'استرجاع سحب ملغي/مرفوض';
      case 'REFERRAL_REWARD':
        return 'مكافأة دعوة صديق';
      case 'WALLET_TRANSFER_SENT':
        return 'تحويل رصيد صادر';
      case 'WALLET_TRANSFER_RECEIVED':
        return 'تحويل رصيد وارد';
      case 'ADMIN_ADJUSTMENT':
        return 'تعديل تدقيق إداري';
      case 'PROMOTIONAL_BONUS':
        return 'مكافأة منصة';
      default:
        return 'حركة قيود مالية';
    }
  };

  if (!user) {
    return (
      <div className="py-16 px-4 max-w-lg mx-auto text-center">
        <div className="p-8 sm:p-10 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-5">
          <div className="w-16 h-16 rounded-2xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto border border-emerald-200 dark:border-emerald-800 shadow-sm">
            <Wallet className="w-8 h-8" />
          </div>

          <div>
            <h2 className="text-xl font-extrabold text-slate-900 dark:text-white">
              المحفظة الرقمية وسجل الأرباح
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 leading-relaxed">
              يرجى تسجيل الدخول أو إنشاء حساب جديد للوصول إلى محفظتك الشخصية، متابعة أرباح المهام المنجزة بالريال اليمني، وإجراء تحويلات المحافظ وسحب الرصيد عبر الكريمي وشبكات الصرافة.
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

          <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-center gap-2 text-[11px] text-slate-400 font-medium">
            <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>نظام دفتر أستاذ محاسبي موثق ومغلق بدون عمولات داخلية</span>
          </div>
        </div>
      </div>
    );
  }

  const walletAddr = wallet?.walletAddress || 'KY-XXXXXXXXXXXX';

  return (
    <div className="space-y-8">
      {/* Header & Wallet Address Badge */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 dark:text-white">
              المحفظة الداخلية وسجل الحركات
            </h1>
            <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300">
              قيد مزدوج معتمد
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            دفتر أستاذ مالي ذري يضمن مطابقة الأرصدة والتحويلات المباشرة بين المحافظ بدون وسطاء.
          </p>

          {/* Wallet Address Chip */}
          <div className="pt-2 flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-400">عنوان محفظتك:</span>
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono text-xs font-bold text-emerald-700 dark:text-emerald-400 shadow-inner">
              <span>{walletAddr}</span>
              <button
                type="button"
                onClick={() => handleCopyAddress()}
                title="نسخ عنوان المحفظة"
                className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-md transition-colors text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
              >
                {hasCopiedAddress ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
            <button
              type="button"
              onClick={() => setIsReceiveModalOpen(true)}
              className="text-xs text-emerald-600 dark:text-emerald-400 hover:underline flex items-center gap-1 font-medium"
            >
              <QrCode className="w-3.5 h-3.5" />
              <span>بطاقة الاستلام</span>
            </button>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            onClick={() => setIsTransferModalOpen(true)}
            className="px-4 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl shadow-sm transition-colors flex items-center gap-1.5"
          >
            <ArrowRightLeft className="w-4 h-4" />
            <span>تحويل رصيد</span>
          </button>
          <button
            onClick={onGoToWithdraw}
            className="px-4 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl shadow-sm transition-colors flex items-center gap-1.5"
          >
            <Banknote className="w-4 h-4" />
            <span>طلب سحب أرباح</span>
          </button>
          <button
            onClick={onGoToTasks}
            className="px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 rounded-xl transition-colors"
          >
            تصفح المهام
          </button>
        </div>
      </div>

      {/* 4 Financial Balance Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Available Balance */}
        <div className="p-5 rounded-2xl bg-gradient-to-br from-emerald-500/10 via-white to-white dark:from-emerald-950/40 dark:via-slate-900 dark:to-slate-900 border border-emerald-500/30 dark:border-emerald-600/30 shadow-sm relative overflow-hidden">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mb-2">
            <span className="font-semibold text-emerald-700 dark:text-emerald-400">الرصيد المتاح للتحويل والسحب</span>
            <Wallet className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-xl sm:text-2xl font-extrabold font-mono tabular-nums text-slate-900 dark:text-white truncate max-w-full" title={`${wallet?.availableBalance.toLocaleString() || '0'} ر.ي`}>
            {wallet?.availableBalance.toLocaleString() || '0'}{' '}
            <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">ر.ي</span>
          </div>
          <p className="text-[11px] text-slate-400 mt-2">جاهز للتحويل المباشر أو السحب عبر الصرافة</p>
        </div>

        {/* Card 2: Pending Balance */}
        <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm relative overflow-hidden">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mb-2">
            <span>الرصيد المعلق (قيد السحب)</span>
            <Clock className="w-4 h-4 text-amber-500" />
          </div>
          <div className="text-xl sm:text-2xl font-extrabold font-mono tabular-nums text-slate-900 dark:text-white truncate max-w-full" title={`${wallet?.pendingBalance.toLocaleString() || '0'} ر.ي`}>
            {wallet?.pendingBalance.toLocaleString() || '0'}{' '}
            <span className="text-xs font-bold text-slate-500">ر.ي</span>
          </div>
          <p className="text-[11px] text-slate-400 mt-2">محجوز لطلبات السحب حتى إشعار التحويل</p>
        </div>

        {/* Card 3: Total Transferred */}
        <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm relative overflow-hidden">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mb-2">
            <span>إجمالي التحويلات الصادرة</span>
            <ArrowRightLeft className="w-4 h-4 text-blue-500" />
          </div>
          <div className="text-xl sm:text-2xl font-extrabold font-mono tabular-nums text-slate-900 dark:text-white truncate max-w-full" title={`${(wallet?.totalTransferred || 0).toLocaleString()} ر.ي`}>
            {(wallet?.totalTransferred || 0).toLocaleString()}{' '}
            <span className="text-xs font-bold text-slate-500">ر.ي</span>
          </div>
          <p className="text-[11px] text-slate-400 mt-2">تم تحويلها لمحفظات أخرى عبر المنصة</p>
        </div>

        {/* Card 4: Total Earned */}
        <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm relative overflow-hidden">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mb-2">
            <span>إجمالي الأرباح المكتسبة</span>
            <ArrowUpRight className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="text-xl sm:text-2xl font-extrabold font-mono tabular-nums text-slate-900 dark:text-white truncate max-w-full" title={`${wallet?.totalEarned.toLocaleString() || '0'} ر.ي`}>
            {wallet?.totalEarned.toLocaleString() || '0'}{' '}
            <span className="text-xs font-bold text-slate-500">ر.ي</span>
          </div>
          <p className="text-[11px] text-slate-400 mt-2">مجموع مكافآت المهام المعتمدة</p>
        </div>
      </div>

      {/* Ledger Security Note */}
      <div className="p-4 rounded-xl bg-slate-100 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
          <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>
            نظام محاسبي مغلق (Closed-Loop Virtual Ledger) مسجل بقيد محاسبي مزدوج لا يقبل الانحراف المالي.
          </span>
        </div>
        <span className="font-mono text-[11px] text-slate-500">
          وحدة الحساب: YER (ريال يمني افتراضي)
        </span>
      </div>

      {/* Transactions Ledger Table */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <h2 className="text-base font-bold text-slate-900 dark:text-white">
            سجل القيود والمعاملات المالية (Ledger History)
          </h2>

          <div className="flex flex-wrap items-center gap-2">
            {/* Filter Tabs */}
            <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg text-xs">
              <button
                onClick={() => setFilterType('all')}
                className={`px-2.5 py-1 rounded font-medium transition-colors ${
                  filterType === 'all'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                الكل
              </button>
              <button
                onClick={() => setFilterType('TASK_REWARD')}
                className={`px-2.5 py-1 rounded font-medium transition-colors ${
                  filterType === 'TASK_REWARD'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                المكافآت
              </button>
              <button
                onClick={() => setFilterType('TRANSFERS')}
                className={`px-2.5 py-1 rounded font-medium transition-colors ${
                  filterType === 'TRANSFERS'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                التحويلات
              </button>
              <button
                onClick={() => setFilterType('WITHDRAWAL_REQUEST')}
                className={`px-2.5 py-1 rounded font-medium transition-colors ${
                  filterType === 'WITHDRAWAL_REQUEST'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                السحوبات
              </button>
            </div>

            {/* Search */}
            <div className="relative">
              <Search className="absolute right-2.5 top-2 w-3.5 h-3.5 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="بحث في البيان أو الرقم..."
                className="pr-8 pl-3 py-1.5 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-emerald-500 w-36 sm:w-48"
              />
            </div>
          </div>
        </div>

        {/* High Density Table */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 border-b border-slate-200 dark:border-slate-800 font-medium">
                <tr>
                  <th className="py-3 px-4">رقم الحركة</th>
                  <th className="py-3 px-4">نوع العملية</th>
                  <th className="py-3 px-4">البيان والتفاصيل</th>
                  <th className="py-3 px-4 text-left">المبلغ</th>
                  <th className="py-3 px-4 text-left font-mono">الرصيد السابق</th>
                  <th className="py-3 px-4 text-left font-mono">الرصيد الجديد</th>
                  <th className="py-3 px-4">التاريخ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {isLoading ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-400">
                      جاري تحميل بيانات السجل المالي...
                    </td>
                  </tr>
                ) : filteredTransactions.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-400">
                      لا توجد حركات مالية مطابقة للبحث أو التصفية.
                    </td>
                  </tr>
                ) : (
                  filteredTransactions.map((tx) => {
                    const isCredit = tx.amount > 0;
                    return (
                      <tr
                        key={tx.id}
                        className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors"
                      >
                        <td className="py-3 px-4 font-mono text-[11px] text-slate-500">
                          {tx.id.slice(0, 10)}...
                        </td>
                        <td className="py-3 px-4 font-semibold text-slate-800 dark:text-slate-200">
                          {getTransactionTypeLabel(tx.type)}
                        </td>
                        <td className="py-3 px-4 text-slate-600 dark:text-slate-300 max-w-xs truncate">
                          {tx.description}
                        </td>
                        <td
                          className={`py-3 px-4 text-left font-mono font-bold tabular-nums text-sm ${
                            isCredit
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-rose-600 dark:text-rose-400'
                          }`}
                        >
                          {isCredit ? '+' : ''}
                          {tx.amount.toLocaleString()} ر.ي
                        </td>
                        <td className="py-3 px-4 text-left font-mono tabular-nums text-slate-500">
                          {tx.previousBalance.toLocaleString()}
                        </td>
                        <td className="py-3 px-4 text-left font-mono font-semibold tabular-nums text-slate-800 dark:text-slate-200">
                          {tx.newBalance.toLocaleString()}
                        </td>
                        <td className="py-3 px-4 text-slate-400 font-mono text-[11px] whitespace-nowrap">
                          {new Date(tx.createdAt).toLocaleDateString('ar-YE', {
                            year: 'numeric',
                            month: 'numeric',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* MODAL 1: SEND TRANSFER TO ANOTHER WALLET */}
      {isTransferModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-xl max-w-md w-full p-6 space-y-5 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2 text-slate-900 dark:text-white font-bold">
                <ArrowRightLeft className="w-5 h-5 text-blue-600" />
                <span>تحويل رصيد لمحفظة أخرى</span>
              </div>
              <button
                type="button"
                onClick={() => setIsTransferModalOpen(false)}
                className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleExecuteTransfer} className="space-y-4">
              {/* Recipient Address */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  عنوان محفظة المستلم (KY-...)
                </label>
                <div className="relative">
                  <input
                    type="text"
                    required
                    placeholder="KY-XXXXXXXXXXXX"
                    value={recipientAddress}
                    onChange={(e) => setRecipientAddress(e.target.value.toUpperCase())}
                    className="w-full px-3 py-2 text-xs font-mono font-bold bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white uppercase placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  {isLookingUp && (
                    <span className="absolute left-3 top-2.5 text-[10px] text-blue-500 font-mono animate-pulse">
                      جارِ التحقق...
                    </span>
                  )}
                </div>

                {/* Recipient Lookup Result */}
                {recipientLookupName && (
                  <div className="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-800 dark:text-emerald-300 flex items-center gap-2">
                    <UserCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>المستلم المؤكد: <strong>{recipientLookupName}</strong></span>
                  </div>
                )}
                {lookupError && (
                  <div className="p-2 rounded-xl bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 text-xs text-rose-700 dark:text-rose-300 flex items-center gap-1.5">
                    <AlertCircle className="w-4 h-4 text-rose-500 shrink-0" />
                    <span>{lookupError}</span>
                  </div>
                )}
              </div>

              {/* Amount */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <label className="font-semibold text-slate-700 dark:text-slate-300">المبلغ بالريال اليمني</label>
                  <button
                    type="button"
                    onClick={() => setTransferAmount(String(wallet?.availableBalance || 0))}
                    className="text-blue-600 dark:text-blue-400 font-semibold text-[11px] hover:underline"
                  >
                    أقصى مبلغ متاح ({wallet?.availableBalance.toLocaleString()} ر.ي)
                  </button>
                </div>
                <div className="relative">
                  <input
                    type="number"
                    required
                    min="1"
                    max={wallet?.availableBalance || 0}
                    placeholder="0"
                    value={transferAmount}
                    onChange={(e) => setTransferAmount(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono font-bold bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="absolute left-3 top-2.5 text-xs font-bold text-slate-400">ر.ي</span>
                </div>
              </div>

              {/* Optional Note */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  ملاحظة أو بيان التحويل (اختياري)
                </label>
                <input
                  type="text"
                  placeholder="مثال: مقابل تصميم، سداد خدمة..."
                  value={transferNote}
                  onChange={(e) => setTransferNote(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Transfer Details Card */}
              <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-700 text-[11px] space-y-1 text-slate-500">
                <div className="flex justify-between">
                  <span>رسوم التحويل الداخلي:</span>
                  <span className="font-bold text-emerald-600">مجاناً (0 ر.ي)</span>
                </div>
                <div className="flex justify-between">
                  <span>سرعة التنفيذ:</span>
                  <span className="font-semibold text-slate-700 dark:text-slate-300">فوري ومؤكد آلياً</span>
                </div>
              </div>

              <div className="pt-2 flex gap-3">
                <button
                  type="button"
                  onClick={() => setIsTransferModalOpen(false)}
                  className="flex-1 py-2.5 text-xs font-semibold text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 rounded-xl transition-colors"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingTransfer || !recipientLookupName || !transferAmount}
                  className="flex-1 py-2.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl shadow-sm transition-colors flex items-center justify-center gap-1.5"
                >
                  {isSubmittingTransfer ? 'جارِ التحويل...' : 'تأكيد التحويل الآن'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: RECEIVE FUNDS / WALLET ADDRESS CARD */}
      {isReceiveModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-xl max-w-sm w-full p-6 text-center space-y-5 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex justify-between items-center">
              <span className="text-sm font-bold text-slate-900 dark:text-white">استلام رصيد داخلي</span>
              <button
                type="button"
                onClick={() => setIsReceiveModalOpen(false)}
                className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* QR Visual Placeholder with Lock & Logo */}
            <div className="p-6 bg-slate-50 dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 flex flex-col items-center justify-center space-y-2">
              <div className="w-28 h-28 bg-white p-2 rounded-xl border border-slate-200 shadow-inner flex items-center justify-center">
                <QrCode className="w-24 h-24 text-slate-900" />
              </div>
              <p className="text-xs font-bold text-slate-800 dark:text-slate-200 pt-2">{user.fullName}</p>
              <p className="text-[11px] text-slate-400 font-mono">{user.phone}</p>
            </div>

            {/* Address Display & Copy */}
            <div className="space-y-2">
              <p className="text-xs text-slate-500">عنوان محفظتك الفريد للاستلام المباشر:</p>
              <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 rounded-xl font-mono font-bold text-sm text-emerald-800 dark:text-emerald-300 select-all">
                {walletAddr}
              </div>
              <button
                type="button"
                onClick={() => handleCopyAddress()}
                className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-sm transition-colors flex items-center justify-center gap-2"
              >
                {hasCopiedAddress ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                <span>{hasCopiedAddress ? 'تم نسخ العنوان بنجاح!' : 'نسخ العنوان'}</span>
              </button>
            </div>

            <p className="text-[11px] text-slate-400 leading-relaxed">
              شارك هذا العنوان مع أي عضو على منصة كسب اليمن لإرسال رصيد فوري لمحفظتك مجاناً وبدون أي اقتطاعات.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
