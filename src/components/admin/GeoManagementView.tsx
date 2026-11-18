import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  Edit3,
  Globe2,
  Layers,
  MapPin,
  Plus,
  Power,
  RefreshCw,
  ShieldCheck,
  X,
} from 'lucide-react';
import { api } from '../../api/client.ts';
import { useAuth } from '../../context/AuthContext.tsx';
import {
  fetchGeoCountryLevels,
  fetchGeoDivisions,
  invalidateGeoClientCache,
} from '../../services/geoService.ts';
import type {
  AdminGeoOverview,
  AdminGeoOverviewCountry,
  AdministrativeDivision,
  CountryAdminLevel,
  GeoIntegrityReport,
} from '../../types/index.ts';

type SubTab = 'countries' | 'explorer' | 'integrity';

export const GeoManagementView: React.FC = () => {
  const { showToast, openConfirmModal } = useAuth();
  const [subTab, setSubTab] = useState<SubTab>('countries');
  const [overview, setOverview] = useState<AdminGeoOverview | null>(null);
  const [integrity, setIntegrity] = useState<GeoIntegrityReport | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isCheckingIntegrity, setIsCheckingIntegrity] = useState(false);
  const [busyCountryId, setBusyCountryId] = useState<string | null>(null);
  const [countrySearch, setCountrySearch] = useState('');

  // Explorer state
  const [selectedCountryId, setSelectedCountryId] = useState<string>('');
  const [levels, setLevels] = useState<CountryAdminLevel[]>([]);
  const [parentStack, setParentStack] = useState<AdministrativeDivision[]>([]);
  const [divisions, setDivisions] = useState<AdministrativeDivision[]>([]);
  const [divisionSearch, setDivisionSearch] = useState('');
  const [isLoadingExplorer, setIsLoadingExplorer] = useState(false);

  // Add Level modal
  const [showAddLevelModal, setShowAddLevelModal] = useState(false);
  const [lvlOrder, setLvlOrder] = useState('3');
  const [lvlNameAr, setLvlNameAr] = useState('');
  const [lvlNameEn, setLvlNameEn] = useState('');
  const [lvlPluralAr, setLvlPluralAr] = useState('');
  const [isSavingLevel, setIsSavingLevel] = useState(false);

  // Add / Edit Division modal
  const [showDivModal, setShowDivModal] = useState(false);
  const [editingDiv, setEditingDiv] = useState<AdministrativeDivision | null>(null);
  const [divLevelId, setDivLevelId] = useState('');
  const [divNameAr, setDivNameAr] = useState('');
  const [divNameEn, setDivNameEn] = useState('');
  const [divCode, setDivCode] = useState('');
  const [divLat, setDivLat] = useState('');
  const [divLon, setDivLon] = useState('');
  const [isSavingDiv, setIsSavingDiv] = useState(false);

  const loadOverview = async () => {
    setIsLoading(true);
    try {
      const res = await api.getAdminGeoOverview();
      setOverview(res);
      if (!selectedCountryId && res?.countries?.length > 0) {
        const ye = res.countries.find((c: AdminGeoOverviewCountry) => c.iso2 === 'YE');
        setSelectedCountryId((ye || res.countries[0]).id);
      }
    } catch (err: any) {
      showToast(err?.message || 'تعذر تحميل بيانات الدول والتقسيمات الإدارية.', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const loadIntegrity = async () => {
    setIsCheckingIntegrity(true);
    try {
      const res = await api.getAdminGeoIntegrity();
      setIntegrity(res);
    } catch (err: any) {
      showToast(err?.message || 'تعذر فحص سلامة البيانات الجغرافية.', 'error');
    } finally {
      setIsCheckingIntegrity(false);
    }
  };

  useEffect(() => {
    loadOverview();
  }, []);

  useEffect(() => {
    if (subTab === 'integrity' && !integrity) {
      loadIntegrity();
    }
  }, [subTab]);

  const activeParent = parentStack.length > 0 ? parentStack[parentStack.length - 1] : null;

  const loadExplorerData = async (cId: string, pId: string | null, searchTxt: string) => {
    if (!cId) return;
    setIsLoadingExplorer(true);
    try {
      const [lvls, divs] = await Promise.all([
        fetchGeoCountryLevels(cId),
        fetchGeoDivisions({
          countryId: cId,
          parentId: pId,
          includeInactive: true,
          search: searchTxt || undefined,
          limit: 600,
        }),
      ]);
      setLevels(lvls);
      setDivisions(divs);
    } catch (err: any) {
      showToast(err?.message || 'تعذر تحميل التقسيمات الإدارية للدولة المحددة.', 'error');
    } finally {
      setIsLoadingExplorer(false);
    }
  };

  useEffect(() => {
    if (subTab === 'explorer' && selectedCountryId) {
      loadExplorerData(selectedCountryId, activeParent ? activeParent.id : null, divisionSearch);
    }
  }, [subTab, selectedCountryId, activeParent?.id, divisionSearch]);

  const filteredCountries = useMemo(() => {
    const list = overview?.countries || [];
    const q = countrySearch.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (c) =>
        c.nameAr.toLowerCase().includes(q) ||
        c.nameEn.toLowerCase().includes(q) ||
        c.iso2.toLowerCase().includes(q) ||
        c.iso3.toLowerCase().includes(q)
    );
  }, [overview?.countries, countrySearch]);

  const selectedCountry = useMemo(
    () => (overview?.countries || []).find((c) => c.id === selectedCountryId) || null,
    [overview?.countries, selectedCountryId]
  );

  const handleToggleCountry = (c: AdminGeoOverviewCountry) => {
    if (!overview?.geoTablesReady) {
      showToast('التعديل المباشر يتطلب تطبيق الترحيلين 028 و 029 على قاعدة بيانات Supabase الحية.', 'info');
      return;
    }
    const nextState = !c.isActive;
    openConfirmModal({
      title: nextState ? 'تفعيل دولة في المنصة' : 'تعطيل دولة في المنصة',
      message: nextState
        ? `هل تريد تفعيل "${c.flagEmoji} ${c.nameAr}" لإتاحتها في التسجيل والحملات والمهام؟`
        : `هل تريد تعطيل "${c.flagEmoji} ${c.nameAr}"؟ سيمنع ذلك اختيارها في التسجيلات والمهام الجديدة دون حذف البيانات التاريخية.`,
      confirmLabel: nextState ? 'تفعيل' : 'تعطيل',
      cancelLabel: 'إلغاء',
      variant: nextState ? 'primary' : 'warning',
      onConfirm: async () => {
        setBusyCountryId(c.id);
        try {
          await api.toggleAdminGeoCountry(c.id, nextState);
          invalidateGeoClientCache();
          showToast(`تم ${nextState ? 'تفعيل' : 'تعطيل'} ${c.nameAr} بنجاح.`, 'success');
          await loadOverview();
        } catch (err: any) {
          showToast(err?.message || 'تعذر تحديث حالة الدولة.', 'error');
        } finally {
          setBusyCountryId(null);
        }
      },
    });
  };

  const handleImportCountry = (c: AdminGeoOverviewCountry) => {
    if (!overview?.tablesExist) {
      showToast('جداول النظام الجغرافي غير منشأة في قاعدة البيانات بعد (الترحيل 028).', 'info');
      return;
    }
    openConfirmModal({
      title: `مزامنة واستيراد تقسيمات ${c.nameAr}`,
      message: `سيتم استيراد ومزامنة جميع المستويات والتقسيمات الإدارية الموثقة لدولة ${c.flagEmoji} ${c.nameAr} إلى قاعدة بيانات Supabase بأسلوب Upsert الآمن.`,
      confirmLabel: 'بدء المزامنة',
      cancelLabel: 'إلغاء',
      variant: 'primary',
      onConfirm: async () => {
        setBusyCountryId(c.id);
        try {
          const res = await api.importAdminGeoCountry(c.id);
          invalidateGeoClientCache();
          showToast(
            `تمت مزامنة ${res.nameAr}: ${res.importedLevels} مستويات و ${res.importedDivisions} تقسيم إداري.`,
            'success'
          );
          await loadOverview();
        } catch (err: any) {
          showToast(err?.message || 'فشل استيراد بيانات الدولة.', 'error');
        } finally {
          setBusyCountryId(null);
        }
      },
    });
  };

  const handleSaveLevel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCountryId) return;
    setIsSavingLevel(true);
    try {
      await api.createAdminGeoLevel(selectedCountryId, {
        levelOrder: Number(lvlOrder),
        nameAr: lvlNameAr.trim(),
        nameEn: lvlNameEn.trim(),
        pluralAr: lvlPluralAr.trim() || undefined,
      });
      invalidateGeoClientCache();
      showToast('تمت إضافة المستوى الإداري بنجاح.', 'success');
      setShowAddLevelModal(false);
      setLvlNameAr('');
      setLvlNameEn('');
      setLvlPluralAr('');
      await Promise.all([
        loadOverview(),
        loadExplorerData(selectedCountryId, activeParent ? activeParent.id : null, divisionSearch),
      ]);
    } catch (err: any) {
      showToast(err?.message || 'فشل إضافة المستوى الإداري.', 'error');
    } finally {
      setIsSavingLevel(false);
    }
  };

  const openCreateDivisionModal = () => {
    const nextOrder = activeParent ? (activeParent.levelOrder || 1) + 1 : 1;
    const defaultLevel = levels.find((l) => l.levelOrder === nextOrder) || levels[0];
    setEditingDiv(null);
    setDivLevelId(defaultLevel?.id || '');
    setDivNameAr('');
    setDivNameEn('');
    setDivCode('');
    setDivLat('');
    setDivLon('');
    setShowDivModal(true);
  };

  const openEditDivisionModal = (div: AdministrativeDivision) => {
    setEditingDiv(div);
    setDivLevelId(div.levelId);
    setDivNameAr(div.nameAr);
    setDivNameEn(div.nameEn);
    setDivCode(div.code || '');
    setDivLat(div.latitude !== null && div.latitude !== undefined ? String(div.latitude) : '');
    setDivLon(div.longitude !== null && div.longitude !== undefined ? String(div.longitude) : '');
    setShowDivModal(true);
  };

  const handleSaveDivision = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCountryId) return;
    setIsSavingDiv(true);
    try {
      const latNum = divLat.trim() ? Number(divLat) : null;
      const lonNum = divLon.trim() ? Number(divLon) : null;
      if (editingDiv) {
        await api.updateAdminGeoDivision(editingDiv.id, {
          nameAr: divNameAr.trim(),
          nameEn: divNameEn.trim(),
          code: divCode.trim() || null,
          latitude: Number.isFinite(latNum as number) ? latNum : null,
          longitude: Number.isFinite(lonNum as number) ? lonNum : null,
        });
        showToast('تم تحديث بيانات التقسيم الإداري بنجاح.', 'success');
      } else {
        await api.createAdminGeoDivision({
          countryId: selectedCountryId,
          levelId: divLevelId,
          parentId: activeParent ? activeParent.id : null,
          nameAr: divNameAr.trim(),
          nameEn: divNameEn.trim(),
          code: divCode.trim() || undefined,
          latitude: Number.isFinite(latNum as number) ? latNum : null,
          longitude: Number.isFinite(lonNum as number) ? lonNum : null,
        });
        showToast('تم إضافة التقسيم الإداري بنجاح.', 'success');
      }
      invalidateGeoClientCache();
      setShowDivModal(false);
      await Promise.all([
        loadOverview(),
        loadExplorerData(selectedCountryId, activeParent ? activeParent.id : null, divisionSearch),
      ]);
    } catch (err: any) {
      showToast(err?.message || 'فشل حفظ التقسيم الإداري.', 'error');
    } finally {
      setIsSavingDiv(false);
    }
  };

  const handleToggleDivisionActive = async (div: AdministrativeDivision) => {
    if (!overview?.geoTablesReady) {
      showToast('التعديل المباشر يتطلب تفعيل جداول 028/029 في قاعدة البيانات الحية.', 'info');
      return;
    }
    try {
      await api.updateAdminGeoDivision(div.id, { isActive: !div.isActive });
      invalidateGeoClientCache();
      showToast(`تم ${!div.isActive ? 'تفعيل' : 'تعطيل'} ${div.nameAr}.`, 'success');
      await loadExplorerData(selectedCountryId, activeParent ? activeParent.id : null, divisionSearch);
    } catch (err: any) {
      showToast(err?.message || 'فشل تحديث حالة التقسيم الإداري.', 'error');
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Source Status Banner */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Globe2 className="w-5 h-5 text-emerald-600 shrink-0" />
            <h2 className="text-base sm:text-lg font-extrabold text-slate-900 dark:text-white">
              النظام الجغرافي العربي الموحد (22 دولة عربية)
            </h2>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            إدارة الدول العربية الـ22 ومستوياتها الإدارية المحلية والتقسيمات الهرمية الموثقة من مصادر مفتوحة (UN OCHA HDX COD-AB، GeoNames، Wikidata).
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={loadOverview}
            disabled={isLoading}
            className="min-h-[44px] px-4 py-2 text-xs font-bold border border-slate-200 dark:border-slate-700 rounded-xl text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            <span>تحديث السجل</span>
          </button>
        </div>
      </div>

      {/* Live DB vs Verified Fallback Notice */}
      {overview && !overview.geoTablesReady && (
        <div className="p-4 rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50/80 dark:bg-amber-950/30 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2.5">
          <Database className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <div className="font-bold">وضع القراءة من حزمة البيانات الموثقة (Dataset Fallback Active)</div>
            <p className="leading-relaxed">
              تُعرض حالياً جميع الدول الـ22 والتقسيمات الإدارية الـ3,993 من الملف المحلي الموثق <span className="font-mono">data/arab-geography.json</span>. لتفعيل الحفظ والتعديل المباشر في PostgreSQL، يرجى تطبيق الترحيلين <span className="font-mono">028_arab_countries_geography.sql</span> و <span className="font-mono">029_arab_countries_geography_seed.sql</span> على Supabase.
            </p>
          </div>
        </div>
      )}

      {/* KPI Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
          <span className="text-xs text-slate-500 block mb-1">الدول العربية المدرجة</span>
          <div className="text-2xl font-extrabold font-mono tabular-nums text-slate-900 dark:text-white">
            {overview?.totalCountries ?? 22}
          </div>
        </div>
        <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
          <span className="text-xs text-slate-500 block mb-1">الدول المفعلة</span>
          <div className="text-2xl font-extrabold font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
            {overview?.activeCountries ?? 22}
          </div>
        </div>
        <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
          <span className="text-xs text-slate-500 block mb-1">المستويات الإدارية الرسمية</span>
          <div className="text-2xl font-extrabold font-mono tabular-nums text-slate-900 dark:text-white">
            {overview?.totalLevels ?? 45}
          </div>
        </div>
        <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
          <span className="text-xs text-slate-500 block mb-1">إجمالي التقسيمات الموثقة</span>
          <div className="text-2xl font-extrabold font-mono tabular-nums text-slate-900 dark:text-white">
            {(overview?.totalDivisions ?? 3993).toLocaleString()}
          </div>
        </div>
      </div>

      {/* Sub-navigation tabs */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-2 text-xs">
        <button
          type="button"
          onClick={() => setSubTab('countries')}
          className={`min-h-[44px] px-4 py-2 rounded-xl font-bold flex items-center gap-1.5 transition-colors ${
            subTab === 'countries'
              ? 'bg-slate-900 text-white dark:bg-emerald-600'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <Globe2 className="w-4 h-4" />
          <span>سجل الدول الـ22 ({overview?.totalCountries ?? 22})</span>
        </button>
        <button
          type="button"
          onClick={() => setSubTab('explorer')}
          className={`min-h-[44px] px-4 py-2 rounded-xl font-bold flex items-center gap-1.5 transition-colors ${
            subTab === 'explorer'
              ? 'bg-slate-900 text-white dark:bg-emerald-600'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <Layers className="w-4 h-4" />
          <span>مستكشف التقسيمات الإدارية</span>
        </button>
        <button
          type="button"
          onClick={() => setSubTab('integrity')}
          className={`min-h-[44px] px-4 py-2 rounded-xl font-bold flex items-center gap-1.5 transition-colors ${
            subTab === 'integrity'
              ? 'bg-slate-900 text-white dark:bg-emerald-600'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <ShieldCheck className="w-4 h-4" />
          <span>تقرير السلامة والتدقيق</span>
        </button>
      </div>

      {/* TAB 1: 22 ARAB COUNTRIES REGISTRY */}
      {subTab === 'countries' && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
          <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <h3 className="text-xs font-bold text-slate-900 dark:text-white">
              الدول العربية المعتمدة ومسميات هياكلها الإدارية
            </h3>
            <input
              type="text"
              value={countrySearch}
              onChange={(e) => setCountrySearch(e.target.value)}
              placeholder="بحث باسم الدولة أو الرمز (YE, SA, SY...)"
              className="w-full sm:w-72 min-h-[40px] px-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl"
            />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="py-3 px-4">#</th>
                  <th className="py-3 px-4">الدولة</th>
                  <th className="py-3 px-4">الهرمية الإدارية المحلية</th>
                  <th className="py-3 px-4 font-mono">التقسيمات (L1 / L2 / L3)</th>
                  <th className="py-3 px-4 font-mono">المستخدمون / المهام</th>
                  <th className="py-3 px-4">المصدر والترخيص</th>
                  <th className="py-3 px-4">الحالة</th>
                  <th className="py-3 px-4 text-left">الإجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {isLoading ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-slate-400">
                      جارٍ تحميل الدول العربية...
                    </td>
                  </tr>
                ) : (
                  filteredCountries.map((c) => {
                    const busy = busyCountryId === c.id;
                    return (
                      <tr key={c.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                        <td className="py-3 px-4 font-mono tabular-nums text-slate-400">{c.sortOrder}</td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2">
                            <span className="text-lg">{c.flagEmoji}</span>
                            <div>
                              <div className="font-bold text-slate-900 dark:text-white">{c.nameAr}</div>
                              <div className="text-[11px] text-slate-400 font-mono">
                                {c.nameEn} · {c.iso2}/{c.iso3} · {c.phoneCode}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="py-3 px-4 text-slate-700 dark:text-slate-300">
                          {c.levels.map((l) => l.nameAr).join(' ← ')}
                        </td>
                        <td className="py-3 px-4 font-mono tabular-nums">
                          <div className="font-bold text-slate-900 dark:text-white">
                            {c.divisionsCount.toLocaleString()}
                          </div>
                          <div className="text-[10px] text-slate-400">
                            {c.level1Count} / {c.level2Count}
                            {c.level3Count > 0 ? ` / ${c.level3Count}` : ''}
                          </div>
                        </td>
                        <td className="py-3 px-4 font-mono tabular-nums text-slate-600 dark:text-slate-300">
                          {c.usersCount} مستخدم · {c.tasksCount} مهمة
                        </td>
                        <td className="py-3 px-4">
                          <div className="text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                            {c.dataSource || 'Open Geo Dataset'}
                          </div>
                          <div className="text-[10px] font-mono text-slate-400">
                            {c.dataLicense || 'CC BY 4.0'}
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={`text-[11px] font-bold ${
                              c.isActive ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'
                            }`}
                          >
                            {c.isActive ? 'نشطة' : 'معطلة'}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-left">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedCountryId(c.id);
                                setParentStack([]);
                                setDivisionSearch('');
                                setSubTab('explorer');
                              }}
                              className="min-h-[36px] px-2.5 py-1 text-[11px] font-bold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 rounded-lg"
                            >
                              تصفح التقسيمات
                            </button>
                            <button
                              type="button"
                              disabled={busy || !overview?.tablesExist}
                              onClick={() => handleImportCountry(c)}
                              title="استيراد ومزامنة إلى Supabase"
                              className="min-h-[36px] px-2.5 py-1 text-[11px] font-bold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 disabled:opacity-40 rounded-lg"
                            >
                              مزامنة DB
                            </button>
                            <button
                              type="button"
                              disabled={busy || !overview?.geoTablesReady}
                              onClick={() => handleToggleCountry(c)}
                              title={c.isActive ? 'تعطيل الدولة' : 'تفعيل الدولة'}
                              className="min-h-[36px] p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40"
                            >
                              <Power className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 2: DIVISION EXPLORER */}
      {subTab === 'explorer' && (
        <div className="space-y-4">
          <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex flex-col lg:flex-row lg:items-end justify-between gap-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 flex-1">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  اختر الدولة لاستعراض تقسيماتها
                </label>
                <select
                  value={selectedCountryId}
                  onChange={(e) => {
                    setSelectedCountryId(e.target.value);
                    setParentStack([]);
                    setDivisionSearch('');
                  }}
                  className="w-full min-h-[44px] px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl"
                >
                  {(overview?.countries || []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.flagEmoji} {c.nameAr} ({c.divisionsCount} تقسيم)
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  تصفية بالاسم أو الرمز
                </label>
                <input
                  type="text"
                  value={divisionSearch}
                  onChange={(e) => setDivisionSearch(e.target.value)}
                  placeholder="ابحث داخل المستوى الحالي..."
                  className="w-full min-h-[44px] px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                disabled={!overview?.geoTablesReady}
                onClick={() => {
                  setLvlOrder(String((levels[levels.length - 1]?.levelOrder || 0) + 1));
                  setShowAddLevelModal(true);
                }}
                className="min-h-[44px] px-3.5 py-2 text-xs font-bold border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 rounded-xl flex items-center gap-1.5"
              >
                <Layers className="w-4 h-4" />
                <span>+ مستوى إداري</span>
              </button>
              <button
                type="button"
                disabled={!overview?.geoTablesReady}
                onClick={openCreateDivisionModal}
                className="min-h-[44px] px-4 py-2 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white rounded-xl flex items-center gap-1.5"
              >
                <Plus className="w-4 h-4" />
                <span>+ إضافة تقسيم إداري</span>
              </button>
            </div>
          </div>

          {/* Breadcrumb & Levels Bar */}
          {selectedCountry && (
            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setParentStack([])}
                  className={`font-bold ${
                    parentStack.length === 0
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-slate-600 dark:text-slate-300 hover:underline'
                  }`}
                >
                  {selectedCountry.flagEmoji} {selectedCountry.nameAr} (المستوى الرئيسي)
                </button>
                {parentStack.map((item, idx) => (
                  <React.Fragment key={item.id}>
                    <span className="text-slate-400">/</span>
                    <button
                      type="button"
                      onClick={() => setParentStack(parentStack.slice(0, idx + 1))}
                      className={`font-bold ${
                        idx === parentStack.length - 1
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-slate-600 dark:text-slate-300 hover:underline'
                      }`}
                    >
                      {item.nameAr}
                    </button>
                  </React.Fragment>
                ))}
              </div>
              <div className="text-[11px] text-slate-500">
                المستويات المعرّفة: {levels.map((l) => `${l.levelOrder}. ${l.nameAr}`).join(' · ')}
              </div>
            </div>
          )}

          {/* Divisions Table */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="py-3 px-4">الاسم العربي</th>
                    <th className="py-3 px-4">الاسم الإنجليزي</th>
                    <th className="py-3 px-4">المستوى</th>
                    <th className="py-3 px-4 font-mono">الرمز</th>
                    <th className="py-3 px-4 font-mono">الإحداثيات / المراجع</th>
                    <th className="py-3 px-4">الحالة</th>
                    <th className="py-3 px-4 text-left">التحكم</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {isLoadingExplorer ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-slate-400">
                        جارٍ تحميل التقسيمات...
                      </td>
                    </tr>
                  ) : divisions.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-slate-400">
                        لا توجد تقسيمات فرعية مسجلة تحت هذا المستوى.
                      </td>
                    </tr>
                  ) : (
                    divisions.map((div) => (
                      <tr key={div.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                        <td className="py-3 px-4 font-bold text-slate-900 dark:text-white">
                          {div.hasChildren ? (
                            <button
                              type="button"
                              onClick={() => {
                                setParentStack([...parentStack, div]);
                                setDivisionSearch('');
                              }}
                              className="text-emerald-700 dark:text-emerald-400 hover:underline flex items-center gap-1"
                            >
                              <MapPin className="w-3.5 h-3.5 shrink-0" />
                              <span>{div.nameAr}</span>
                            </button>
                          ) : (
                            div.nameAr
                          )}
                        </td>
                        <td className="py-3 px-4 text-slate-600 dark:text-slate-300">{div.nameEn}</td>
                        <td className="py-3 px-4 text-slate-500">{div.levelNameAr || `L${div.levelOrder || 1}`}</td>
                        <td className="py-3 px-4 font-mono text-slate-500">{div.code || '—'}</td>
                        <td className="py-3 px-4 font-mono text-[11px] text-slate-500">
                          {div.latitude !== null && div.longitude !== null
                            ? `${Number(div.latitude).toFixed(4)}, ${Number(div.longitude).toFixed(4)}`
                            : '—'}
                          {div.geonamesId ? ` · GN:${div.geonamesId}` : ''}
                        </td>
                        <td className="py-3 px-4">
                          <span className={div.isActive ? 'text-emerald-600 font-bold' : 'text-slate-400'}>
                            {div.isActive ? 'نشط' : 'معطل'}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-left">
                          <div className="flex items-center justify-end gap-1.5">
                            {div.hasChildren && (
                              <button
                                type="button"
                                onClick={() => {
                                  setParentStack([...parentStack, div]);
                                  setDivisionSearch('');
                                }}
                                className="min-h-[34px] px-2.5 py-1 text-[11px] font-bold bg-slate-100 dark:bg-slate-800 rounded-lg"
                              >
                                عرض الفروع
                              </button>
                            )}
                            <button
                              type="button"
                              disabled={!overview?.geoTablesReady}
                              onClick={() => openEditDivisionModal(div)}
                              className="min-h-[34px] p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 rounded-lg"
                              title="تعديل"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              disabled={!overview?.geoTablesReady}
                              onClick={() => handleToggleDivisionActive(div)}
                              className="min-h-[34px] p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 rounded-lg"
                              title={div.isActive ? 'تعطيل' : 'تفعيل'}
                            >
                              <Power className="w-3.5 h-3.5" />
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
        </div>
      )}

      {/* TAB 3: DATA INTEGRITY REPORT */}
      {subTab === 'integrity' && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              {integrity?.isHealthy ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-600" />
              ) : (
                <AlertTriangle className="w-5 h-5 text-amber-500" />
              )}
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  فحص سلامة الشجرة الإدارية والبيانات المرجعية
                </h3>
                <p className="text-[11px] text-slate-500">
                  مصدر الفحص الحالي:{' '}
                  <span className="font-mono">
                    {integrity?.sourceMode === 'supabase' ? 'Supabase Live PostgreSQL' : 'Verified Open Dataset Fallback'}
                  </span>
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={loadIntegrity}
              disabled={isCheckingIntegrity}
              className="min-h-[44px] px-4 py-2 text-xs font-bold bg-slate-900 dark:bg-emerald-600 text-white rounded-xl flex items-center gap-1.5"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isCheckingIntegrity ? 'animate-spin' : ''}`} />
              <span>إعادة تشغيل الفحص</span>
            </button>
          </div>

          {integrity && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
              {[
                { label: 'دول تفتقد تقسيمات إدارية', val: integrity.checks.countriesMissingDivisions.length },
                { label: 'تقسيمات بدون اسم عربي أو إنجليزي', val: integrity.checks.missingNamesCount },
                { label: 'آباء من دولة مخالفة (Cross-Country)', val: integrity.checks.crossCountryParentCount },
                { label: 'اختلال ترتيب المستويات الهرمية', val: integrity.checks.invalidLevelOrderCount },
                { label: 'حلقات دائرية (Cycles)', val: integrity.checks.cyclesCount },
                { label: 'تكرار رموز الدول/التقسيمات', val: integrity.checks.duplicateCodeCount },
                { label: 'تكرار الأسماء تحت نفس الأب', val: integrity.checks.duplicateSiblingCount },
                { label: 'حسابات سابقة غير مربوطة جغرافياً', val: integrity.checks.unlinkedProfilesCount },
                { label: 'مهام سابقة غير مربوطة جغرافياً', val: integrity.checks.unlinkedTasksCount },
              ].map((item) => (
                <div
                  key={item.label}
                  className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2"
                >
                  <span className="text-slate-700 dark:text-slate-300">{item.label}</span>
                  <span
                    className={`font-mono font-extrabold tabular-nums text-sm ${
                      item.val === 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600'
                    }`}
                  >
                    {item.val}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Modal: Add Level */}
      {showAddLevelModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm">
          <form
            onSubmit={handleSaveLevel}
            className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                إضافة مستوى إداري لـ {selectedCountry?.nameAr}
              </h3>
              <button type="button" onClick={() => setShowAddLevelModal(false)}>
                <X className="w-4 h-4 text-slate-400" />
              </button>
            </div>
            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold mb-1">ترتيب المستوى (1 إلى 6)</label>
                <input
                  type="number"
                  min={1}
                  max={6}
                  required
                  value={lvlOrder}
                  onChange={(e) => setLvlOrder(e.target.value)}
                  className="w-full min-h-[42px] px-3 font-mono bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">المسمى الرسمي بالعربية</label>
                <input
                  type="text"
                  required
                  value={lvlNameAr}
                  onChange={(e) => setLvlNameAr(e.target.value)}
                  placeholder="مثال: العزلة / الحي / البلدة"
                  className="w-full min-h-[42px] px-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">المسمى بالإنجليزية</label>
                <input
                  type="text"
                  required
                  value={lvlNameEn}
                  onChange={(e) => setLvlNameEn(e.target.value)}
                  placeholder="Sub-district / Neighborhood"
                  className="w-full min-h-[42px] px-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">صيغة الجمع بالعربية (اختياري)</label>
                <input
                  type="text"
                  value={lvlPluralAr}
                  onChange={(e) => setLvlPluralAr(e.target.value)}
                  placeholder="العُزَل / الأحياء"
                  className="w-full min-h-[42px] px-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowAddLevelModal(false)}
                className="min-h-[40px] px-4 text-xs font-bold text-slate-600 bg-slate-100 rounded-xl"
              >
                إلغاء
              </button>
              <button
                type="submit"
                disabled={isSavingLevel}
                className="min-h-[40px] px-5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl"
              >
                {isSavingLevel ? 'جاري الحفظ...' : 'حفظ المستوى'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal: Add / Edit Division */}
      {showDivModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm">
          <form
            onSubmit={handleSaveDivision}
            className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                {editingDiv ? `تعديل ${editingDiv.nameAr}` : `إضافة تقسيم إداري في ${selectedCountry?.nameAr}`}
              </h3>
              <button type="button" onClick={() => setShowDivModal(false)}>
                <X className="w-4 h-4 text-slate-400" />
              </button>
            </div>
            <div className="space-y-3 text-xs">
              {!editingDiv && (
                <div>
                  <label className="block font-semibold mb-1">المستوى الإداري</label>
                  <select
                    required
                    value={divLevelId}
                    onChange={(e) => setDivLevelId(e.target.value)}
                    className="w-full min-h-[42px] px-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl"
                  >
                    {levels.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.levelOrder}. {l.nameAr} ({l.nameEn})
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className="block font-semibold mb-1">الاسم الرسمي بالعربية</label>
                <input
                  type="text"
                  required
                  value={divNameAr}
                  onChange={(e) => setDivNameAr(e.target.value)}
                  className="w-full min-h-[42px] px-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">الاسم بالإنجليزية</label>
                <input
                  type="text"
                  required
                  value={divNameEn}
                  onChange={(e) => setDivNameEn(e.target.value)}
                  className="w-full min-h-[42px] px-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl"
                />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block font-semibold mb-1">الرمز (Code)</label>
                  <input
                    type="text"
                    value={divCode}
                    onChange={(e) => setDivCode(e.target.value)}
                    className="w-full min-h-[42px] px-2.5 font-mono bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">خط العرض</label>
                  <input
                    type="number"
                    step="any"
                    value={divLat}
                    onChange={(e) => setDivLat(e.target.value)}
                    className="w-full min-h-[42px] px-2.5 font-mono bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">خط الطول</label>
                  <input
                    type="number"
                    step="any"
                    value={divLon}
                    onChange={(e) => setDivLon(e.target.value)}
                    className="w-full min-h-[42px] px-2.5 font-mono bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl"
                  />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowDivModal(false)}
                className="min-h-[40px] px-4 text-xs font-bold text-slate-600 bg-slate-100 rounded-xl"
              >
                إلغاء
              </button>
              <button
                type="submit"
                disabled={isSavingDiv}
                className="min-h-[40px] px-5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl"
              >
                {isSavingDiv ? 'جاري الحفظ...' : 'حفظ التقسيم'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
