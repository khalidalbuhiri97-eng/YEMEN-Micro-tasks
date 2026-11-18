import React, { useEffect, useState } from 'react';
import {
  Receipt,
  PlusCircle,
  ShieldAlert,
  CheckCircle2,
  Power,
  Edit3,
  X,
} from 'lucide-react';
import { api } from '../../../api/client.ts';
import { useAuth } from '../../../context/AuthContext.tsx';
import { fetchGeoCountries } from '../../../services/geoService.ts';
import type { CountryItem, TaxDefinition, TaxSettlement, TreasurySummary } from '../../../types/index.ts';

interface TaxManagementViewProps {
  treasury: TreasurySummary | null;
  onRefreshAll: () => Promise<void>;
}

const fmt = (n: number | undefined | null) => Math.round(Number(n || 0)).toLocaleString('en-US');

export const TaxManagementView: React.FC<TaxManagementViewProps> = ({ treasury, onRefreshAll }) => {
  const { user, showToast, openConfirmModal } = useAuth();
  const [taxTablesReady, setTaxTablesReady] = useState(true);
  const [taxPayableTotal, setTaxPayableTotal] = useState(0);
  const [definitions, setDefinitions] = useState<TaxDefinition[]>([]);
  const [settlements, setSettlements] = useState<TaxSettlement[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Create Tax Definition Form
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [taxType, setTaxType] = useState('');
  const [taxAuthority, setTaxAuthority] = useState('');
  const [region, setRegion] = useState('YEMEN');
  const [countryId, setCountryId] = useState<string>('');
  const [countries, setCountries] = useState<CountryItem[]>([]);
  const [taxBase, setTaxBase] = useState('صافي الأرباح');
  const [ratePercentage, setRatePercentage] = useState('0');
  const [flatAmount, setFlatAmount] = useState('0');
  const [validFrom, setValidFrom] = useState('');
  const [validTo, setValidTo] = useState('');
  const [isSavingDef, setIsSavingDef] = useState(false);

  // Edit Rate Modal
  const [editingDef, setEditingDef] = useState<TaxDefinition | null>(null);
  const [editRate, setEditRate] = useState('');
  const [editFlat, setEditFlat] = useState('');

  // Explicit Tax Accrual Form (only on active rules)
  const [accrualDefId, setAccrualDefId] = useState('');
  const [taxableAmount, setTaxableAmount] = useState('');
  const [accrualRef, setAccrualRef] = useState('');
  const [accrualNote, setAccrualNote] = useState('');

  // Settlement modal
  const [settlingRow, setSettlingRow] = useState<TaxSettlement | null>(null);
  const [settlementRef, setSettlementRef] = useState('');

  const loadTaxes = async () => {
    setIsLoading(true);
    try {
      const res = await api.getTaxesOverview();
      setTaxTablesReady(Boolean(res?.taxTablesReady));
      setTaxPayableTotal(Number(res?.taxPayableTotal || 0));
      setDefinitions(res?.definitions || []);
      setSettlements(res?.settlements || []);
    } catch (err: any) {
      showToast(err.message || 'فشل تحميل بيانات الضرائب.', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadTaxes();
    fetchGeoCountries(false)
      .then(({ countries: list }) => {
        setCountries(list);
        const ye = list.find((c) => c.iso2 === 'YE');
        if (ye) setCountryId((prev) => prev || ye.id);
      })
      .catch(() => {});
  }, []);

  const handleCreateDefinition = (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || user.role !== 'admin') {
      showToast('هذه العمليات مقيدة بالمالك فقط.', 'error');
      return;
    }
    if (!taxType.trim() || !taxAuthority.trim() || !taxBase.trim()) {
      showToast('يرجى تعبئة نوع الضريبة والجهة المختصة والوعاء الضريبي.', 'error');
      return;
    }

    openConfirmModal({
      title: 'إنشاء تعريف ضريبي جديد (غير مفعل افتراضياً)',
      message: `سيتم حفظ قاعدة "${taxType.trim()}" بنسبة ${Number(ratePercentage || 0)}% بحالة معطلة (Inactive) حتى تقوم بتفعيلها يدوياً.`,
      confirmLabel: 'تأكيد الحفظ',
      cancelLabel: 'إلغاء',
      variant: 'primary',
      onConfirm: async () => {
        setIsSavingDef(true);
        try {
          await api.createTaxDefinition({
            taxType: taxType.trim(),
            taxAuthority: taxAuthority.trim(),
            region: region.trim() || 'YEMEN',
            countryId: countryId || null,
            taxBase: taxBase.trim(),
            ratePercentage: Number(ratePercentage || 0),
            flatAmount: Number(flatAmount || 0),
            validFrom: validFrom || undefined,
            validTo: validTo || null,
            isActive: false, // Strictly disabled until explicit owner activation
          });
          showToast('تم حفظ التعريف الضريبي بنجاح (بحالة غير مفعلة).', 'success');
          setShowCreateForm(false);
          setTaxType('');
          setTaxAuthority('');
          setRatePercentage('0');
          setFlatAmount('0');
          await loadTaxes();
        } catch (err: any) {
          showToast(err.message || 'فشل حفظ التعريف الضريبي.', 'error');
        } finally {
          setIsSavingDef(false);
        }
      },
    });
  };

  const handleToggleActive = (def: TaxDefinition) => {
    const nextState = !def.isActive;
    openConfirmModal({
      title: nextState ? 'تفعيل قاعدة ضريبية' : 'تعطيل قاعدة ضريبية',
      message: nextState
        ? `هل تريد تفعيل قاعدة "${def.taxType}" بنسبة ${def.ratePercentage}% للسماح باحتساب الالتزامات الضريبية؟`
        : `هل تريد تعطيل قاعدة "${def.taxType}" وإيقاف احتساب أي ضرائب جديدة عليها؟`,
      confirmLabel: nextState ? 'تأكيد التفعيل' : 'تأكيد التعطيل',
      cancelLabel: 'إلغاء',
      variant: nextState ? 'warning' : 'primary',
      onConfirm: async () => {
        try {
          await api.updateTaxDefinition(def.id, { isActive: nextState });
          showToast(nextState ? 'تم تفعيل القاعدة الضريبية.' : 'تم تعطيل القاعدة الضريبية.', 'success');
          await loadTaxes();
        } catch (err: any) {
          showToast(err.message || 'فشل تحديث حالة القاعدة الضريبية.', 'error');
        }
      },
    });
  };

  const handleSaveEditRate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingDef) return;
    openConfirmModal({
      title: 'تعديل نسبة / قيمة الضريبة',
      message: `تحديث نسبة ضريبة "${editingDef.taxType}" إلى ${Number(editRate || 0)}% والمبلغ الثابت إلى ${fmt(Number(editFlat || 0))} ر.ي؟`,
      confirmLabel: 'تأكيد التعديل',
      cancelLabel: 'إلغاء',
      variant: 'warning',
      onConfirm: async () => {
        try {
          await api.updateTaxDefinition(editingDef.id, {
            ratePercentage: Number(editRate || 0),
            flatAmount: Number(editFlat || 0),
          });
          showToast('تم تحديث القاعدة الضريبية بنجاح.', 'success');
          setEditingDef(null);
          await loadTaxes();
        } catch (err: any) {
          showToast(err.message || 'فشل تعديل القاعدة الضريبية.', 'error');
        }
      },
    });
  };

  const handleAccrueTax = (e: React.FormEvent) => {
    e.preventDefault();
    const def = definitions.find((d) => d.id === accrualDefId);
    if (!def) {
      showToast('يرجى اختيار قاعدة ضريبية مفعلة.', 'error');
      return;
    }
    const baseAmt = Math.round(Number(taxableAmount));
    if (!Number.isFinite(baseAmt) || baseAmt <= 0) {
      showToast('يرجى إدخال قيمة الوعاء الضريبي الخاضع للحساب.', 'error');
      return;
    }
    const expectedTax = Math.round((baseAmt * def.ratePercentage) / 100) + def.flatAmount;

    openConfirmModal({
      title: 'تأكيد إثبات استحقاق ضريبي في الدفتر',
      message: `سيتم قيد التزام ضريبي بقيمة ${fmt(expectedTax)} ر.ي لحساب (${def.taxType}) في TAX-PAYABLE مقابل PLATFORM-EXPENSES.`,
      confirmLabel: 'تأكيد الإثبات',
      cancelLabel: 'إلغاء',
      variant: 'warning',
      onConfirm: async () => {
        try {
          await api.accrueTaxObligation({
            taxDefinitionId: def.id,
            taxableAmount: baseAmt,
            referenceId: accrualRef.trim() || undefined,
            note: accrualNote.trim() || undefined,
          });
          showToast('تم إثبات الالتزام الضريبي في دفتر الأستاذ بنجاح.', 'success');
          setTaxableAmount('');
          setAccrualRef('');
          setAccrualNote('');
          await Promise.all([loadTaxes(), onRefreshAll()]);
        } catch (err: any) {
          showToast(err.message || 'فشل إثبات الالتزام الضريبي.', 'error');
        }
      },
    });
  };

  const handleSettleTax = (e: React.FormEvent) => {
    e.preventDefault();
    if (!settlingRow || !settlementRef.trim()) {
      showToast('رقم مرجع السداد الرسمي مطلوب.', 'error');
      return;
    }
    openConfirmModal({
      title: 'تأكيد سداد الضريبة للجهة المختصة',
      message: `سيتم خصم ${fmt(settlingRow.taxAmount)} ر.ي من الخزينة النقدية (PLATFORM-CASH-VAULT) وإقفال الالتزام في TAX-PAYABLE برقم مرجع "${settlementRef.trim()}".`,
      confirmLabel: 'تأكيد السداد',
      cancelLabel: 'إلغاء',
      variant: 'danger',
      onConfirm: async () => {
        try {
          await api.settleTaxObligation({
            settlementId: settlingRow.id,
            referenceId: settlementRef.trim(),
          });
          showToast('تم توثيق سداد الضريبة وإقفال الالتزام بنجاح.', 'success');
          setSettlingRow(null);
          setSettlementRef('');
          await Promise.all([loadTaxes(), onRefreshAll()]);
        } catch (err: any) {
          showToast(err.message || 'فشل سداد الالتزام الضريبي.', 'error');
        }
      },
    });
  };

  const activeDefinitions = definitions.filter((d) => d.isActive);
  const settledTotal = settlements
    .filter((s) => s.status === 'SETTLED')
    .reduce((sum, s) => sum + s.taxAmount, 0);

  return (
    <div className="space-y-6">
      {/* Strict Zero-Assumption Notice */}
      <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2.5 text-xs">
          <ShieldAlert className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <div className="font-bold text-slate-900 dark:text-white">
              محرك الضرائب المرن — سياسة عدم افتراض أي نسبة ضريبية تلقائياً
            </div>
            <p className="text-slate-500 dark:text-slate-400 leading-relaxed">
              لا يقوم النظام بفرض أو خصم أي نسبة ضريبية تلقائياً في اليمن. جميع التعريفات تُنشأ معطلة (<span className="font-mono">is_active = false</span>) ولا تُحتسب إلا بعد إعدادها وتفعيلها وإثباتها صراحةً من قِبل المالك.
            </p>
          </div>
        </div>
        {taxTablesReady && (
          <button
            type="button"
            onClick={() => setShowCreateForm(!showCreateForm)}
            className="px-3.5 py-2 text-xs font-bold bg-slate-900 dark:bg-emerald-600 hover:bg-slate-800 text-white rounded-lg flex items-center gap-1.5 whitespace-nowrap"
          >
            <PlusCircle className="w-3.5 h-3.5" />
            <span>إضافة تعريف ضريبي</span>
          </button>
        )}
      </div>

      {!taxTablesReady && (
        <div className="p-4 rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50/80 dark:bg-amber-950/30 text-xs text-amber-900 dark:text-amber-200">
          جداول الضرائب (<span className="font-mono">tax_definitions</span> و <span className="font-mono">tax_settlements</span>) غير منشأة بعد في قاعدة البيانات الحية بانتظار تنفيذ الترحيل 011. لن يتم عرض أو حفظ بيانات وهمية.
        </div>
      )}

      {/* Summary KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
          <span className="text-xs text-slate-500 block mb-1">الضرائب المستحقة (TAX-PAYABLE)</span>
          <div className="text-xl font-extrabold font-mono tabular-nums text-slate-900 dark:text-white">
            {fmt(taxPayableTotal)} <span className="text-xs font-normal">ر.ي</span>
          </div>
        </div>
        <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
          <span className="text-xs text-slate-500 block mb-1">الضرائب المدفوعة فعلياً</span>
          <div className="text-xl font-extrabold font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
            {fmt(settledTotal || treasury?.taxesPaidTotal)} <span className="text-xs font-normal">ر.ي</span>
          </div>
        </div>
        <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
          <span className="text-xs text-slate-500 block mb-1">القواعد الضريبية المفعلة حالياً</span>
          <div className="text-xl font-extrabold font-mono tabular-nums text-slate-900 dark:text-white">
            {activeDefinitions.length} <span className="text-xs font-normal">من أصل {definitions.length}</span>
          </div>
        </div>
      </div>

      {/* Create Tax Definition Form */}
      {showCreateForm && taxTablesReady && (
        <form
          onSubmit={handleCreateDefinition}
          className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4"
        >
          <h3 className="text-sm font-bold text-slate-900 dark:text-white border-b border-slate-100 dark:border-slate-800 pb-2">
            تعريف قاعدة ضريبية جديدة (تُحفظ غير مفعلة افتراضياً)
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">نوع الضريبة</label>
              <input
                type="text"
                required
                value={taxType}
                onChange={(e) => setTaxType(e.target.value)}
                placeholder="مثال: ضريبة مبيعات / ضريبة أرباح"
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">الجهة المختصة</label>
              <input
                type="text"
                required
                value={taxAuthority}
                onChange={(e) => setTaxAuthority(e.target.value)}
                placeholder="مثال: مصلحة الضرائب"
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">النطاق الجغرافي (الدولة)</label>
              <select
                value={countryId || (region === 'ALL' ? 'ALL' : '')}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === 'ALL') {
                    setCountryId('');
                    setRegion('ALL');
                  } else {
                    const matched = countries.find((c) => c.id === val);
                    setCountryId(val);
                    setRegion(matched ? (matched.iso2 === 'YE' ? 'YEMEN' : matched.iso3) : 'YEMEN');
                  }
                }}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg"
              >
                <option value="ALL">جميع الدول العربية (ALL)</option>
                {countries.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.flagEmoji} {c.nameAr} ({c.iso2})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">الوعاء الخاضع للضريبة</label>
              <input
                type="text"
                required
                value={taxBase}
                onChange={(e) => setTaxBase(e.target.value)}
                placeholder="صافي الأرباح / العمولات"
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">النسبة المئوية (%)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                max="100"
                required
                value={ratePercentage}
                onChange={(e) => setRatePercentage(e.target.value)}
                className="w-full px-3 py-2 font-mono bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">مبلغ ثابت إضافي (ر.ي)</label>
              <input
                type="number"
                min="0"
                value={flatAmount}
                onChange={(e) => setFlatAmount(e.target.value)}
                className="w-full px-3 py-2 font-mono bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">سارية من تاريخ</label>
              <input
                type="date"
                value={validFrom}
                onChange={(e) => setValidFrom(e.target.value)}
                className="w-full px-3 py-2 font-mono bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">سارية حتى تاريخ (اختياري)</label>
              <input
                type="date"
                value={validTo}
                onChange={(e) => setValidTo(e.target.value)}
                className="w-full px-3 py-2 font-mono bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setShowCreateForm(false)}
              className="px-4 py-2 text-xs text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg"
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={isSavingDef}
              className="px-5 py-2 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg"
            >
              {isSavingDef ? 'جارِ الحفظ...' : 'حفظ التعريف الضريبي'}
            </button>
          </div>
        </form>
      )}

      {/* Tax Definitions Table */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <h3 className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Receipt className="w-4 h-4 text-emerald-600" />
            <span>سجل تعريفات الضرائب</span>
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="py-2.5 px-4">نوع الضريبة</th>
                <th className="py-2.5 px-4">الجهة والمنطقة</th>
                <th className="py-2.5 px-4">الوعاء الضريبي</th>
                <th className="py-2.5 px-4 font-mono">النسبة / الثابت</th>
                <th className="py-2.5 px-4 font-mono">تاريخ السريان</th>
                <th className="py-2.5 px-4">الحالة</th>
                <th className="py-2.5 px-4 text-left">التحكم</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="py-6 text-center text-slate-400">
                    جارِ التحميل...
                  </td>
                </tr>
              ) : definitions.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-400">
                    لا توجد تعريفات ضريبية مضافة حتى الآن (نسبة الضريبة الحالية: 0%).
                  </td>
                </tr>
              ) : (
                definitions.map((d) => (
                  <tr key={d.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                    <td className="py-2.5 px-4 font-bold text-slate-900 dark:text-white">{d.taxType}</td>
                    <td className="py-2.5 px-4 text-slate-600 dark:text-slate-300">
                      {d.taxAuthority} ({d.region})
                    </td>
                    <td className="py-2.5 px-4">{d.taxBase}</td>
                    <td className="py-2.5 px-4 font-mono tabular-nums font-bold">
                      {d.ratePercentage}% {d.flatAmount > 0 ? `+ ${fmt(d.flatAmount)} ر.ي` : ''}
                    </td>
                    <td className="py-2.5 px-4 font-mono text-[11px] text-slate-500">
                      {new Date(d.validFrom).toLocaleDateString('ar-YE')}
                      {d.validTo ? ` → ${new Date(d.validTo).toLocaleDateString('ar-YE')}` : ' (مفتوح)'}
                    </td>
                    <td className="py-2.5 px-4">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          d.isActive
                            ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-300'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                        }`}
                      >
                        {d.isActive ? 'مفعلة' : 'معطلة'}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-left">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleToggleActive(d)}
                          className={`px-2.5 py-1 rounded text-[11px] font-bold inline-flex items-center gap-1 ${
                            d.isActive
                              ? 'bg-amber-50 text-amber-700 hover:bg-amber-100'
                              : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                          }`}
                        >
                          <Power className="w-3 h-3" />
                          <span>{d.isActive ? 'تعطيل' : 'تفعيل'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingDef(d);
                            setEditRate(String(d.ratePercentage));
                            setEditFlat(String(d.flatAmount));
                          }}
                          className="p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded"
                          title="تعديل النسبة"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Explicit Accrual & Settlements */}
      {taxTablesReady && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Accrue Form */}
          <form
            onSubmit={handleAccrueTax}
            className="lg:col-span-5 p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3"
          >
            <h3 className="text-sm font-bold text-slate-900 dark:text-white border-b border-slate-100 dark:border-slate-800 pb-2">
              إثبات التزام ضريبي يدوي (لقاعدة مفعلة فقط)
            </h3>
            <div className="text-xs space-y-3">
              <div>
                <label className="block font-semibold mb-1">اختر القاعدة الضريبية المفعلة</label>
                <select
                  value={accrualDefId}
                  onChange={(e) => setAccrualDefId(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg"
                  disabled={activeDefinitions.length === 0}
                >
                  <option value="">
                    {activeDefinitions.length === 0 ? 'لا توجد قواعد مفعلة حالياً' : '— اختر قاعدة مفعلة —'}
                  </option>
                  {activeDefinitions.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.taxType} ({d.ratePercentage}%)
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-semibold mb-1">الوعاء الخاضع للضريبة (ر.ي)</label>
                <input
                  type="number"
                  min="1"
                  value={taxableAmount}
                  onChange={(e) => setTaxableAmount(e.target.value)}
                  placeholder="مثال: 100000"
                  className="w-full px-3 py-2 font-mono bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">مرجع الفاتورة / الفترة (اختياري)</label>
                <input
                  type="text"
                  value={accrualRef}
                  onChange={(e) => setAccrualRef(e.target.value)}
                  placeholder="مثال: Q1-2026"
                  className="w-full px-3 py-2 font-mono bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">بيان الإثبات</label>
                <input
                  type="text"
                  value={accrualNote}
                  onChange={(e) => setAccrualNote(e.target.value)}
                  placeholder="وصف الالتزام الضريبي..."
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg"
                />
              </div>
              <button
                type="submit"
                disabled={activeDefinitions.length === 0}
                className="w-full py-2 font-bold bg-slate-900 dark:bg-emerald-600 hover:bg-slate-800 disabled:opacity-40 text-white rounded-lg"
              >
                إثبات الالتزام في TAX-PAYABLE
              </button>
            </div>
          </form>

          {/* Settlements Table */}
          <div className="lg:col-span-7 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 text-xs font-bold text-slate-900 dark:text-white">
              سجل الالتزامات والتسويات الضريبية ({settlements.length})
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="py-2.5 px-3">الضريبة</th>
                    <th className="py-2.5 px-3 font-mono">الوعاء</th>
                    <th className="py-2.5 px-3 font-mono">المستحق</th>
                    <th className="py-2.5 px-3">الحالة</th>
                    <th className="py-2.5 px-3 text-left">الإجراء</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {settlements.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-slate-400">
                        لا توجد التزامات ضريبية مسجلة.
                      </td>
                    </tr>
                  ) : (
                    settlements.map((s) => (
                      <tr key={s.id}>
                        <td className="py-2.5 px-3 font-bold">{s.taxType || 'ضريبة'}</td>
                        <td className="py-2.5 px-3 font-mono tabular-nums">{fmt(s.taxableAmount)}</td>
                        <td className="py-2.5 px-3 font-mono font-bold tabular-nums">{fmt(s.taxAmount)}</td>
                        <td className="py-2.5 px-3">
                          {s.status === 'SETTLED' ? (
                            <span className="inline-flex items-center gap-1 text-emerald-600 font-bold text-[11px]">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>مسددة</span>
                            </span>
                          ) : (
                            <span className="text-amber-600 font-bold text-[11px]">بانتظار السداد</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-left">
                          {s.status === 'PENDING' ? (
                            <button
                              type="button"
                              onClick={() => {
                                setSettlingRow(s);
                                setSettlementRef('');
                              }}
                              className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-[11px] font-bold"
                            >
                              تأكيد السداد
                            </button>
                          ) : (
                            <span className="font-mono text-[11px] text-slate-400">{s.referenceId}</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Edit Rate */}
      {editingDef && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm">
          <form
            onSubmit={handleSaveEditRate}
            className="w-full max-w-sm bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold">تعديل نسبة "{editingDef.taxType}"</h3>
              <button type="button" onClick={() => setEditingDef(null)}>
                <X className="w-4 h-4 text-slate-400" />
              </button>
            </div>
            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold mb-1">النسبة المئوية (%)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  required
                  value={editRate}
                  onChange={(e) => setEditRate(e.target.value)}
                  className="w-full px-3 py-2 font-mono bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">المبلغ الثابت (ر.ي)</label>
                <input
                  type="number"
                  min="0"
                  required
                  value={editFlat}
                  onChange={(e) => setEditFlat(e.target.value)}
                  className="w-full px-3 py-2 font-mono bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setEditingDef(null)} className="px-3 py-1.5 text-xs text-slate-500">
                إلغاء
              </button>
              <button type="submit" className="px-4 py-1.5 text-xs font-bold bg-emerald-600 text-white rounded-lg">
                حفظ التعديل
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal: Settle Tax */}
      {settlingRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm">
          <form
            onSubmit={handleSettleTax}
            className="w-full max-w-sm bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5 space-y-4"
          >
            <h3 className="text-sm font-bold">سداد الالتزام الضريبي</h3>
            <p className="text-xs text-slate-500">
              المبلغ المستحق للسداد: <strong className="font-mono text-slate-900 dark:text-white">{fmt(settlingRow.taxAmount)} ر.ي</strong>
            </p>
            <div className="text-xs">
              <label className="block font-semibold mb-1">رقم مرجع السداد / الإيصال الضريبي</label>
              <input
                type="text"
                required
                value={settlementRef}
                onChange={(e) => setSettlementRef(e.target.value)}
                placeholder="مثال: TAX-REC-2026-001"
                className="w-full px-3 py-2 font-mono bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setSettlingRow(null)} className="px-3 py-1.5 text-xs text-slate-500">
                إلغاء
              </button>
              <button type="submit" className="px-4 py-1.5 text-xs font-bold bg-emerald-600 text-white rounded-lg">
                متابعة لتأكيد السداد
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
