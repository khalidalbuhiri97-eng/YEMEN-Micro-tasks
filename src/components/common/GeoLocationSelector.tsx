import React, { useEffect, useMemo, useState } from 'react';
import { Globe2, MapPin, Plus, RotateCcw, X } from 'lucide-react';
import {
  fetchGeoCountries,
  fetchGeoCountryLevels,
  fetchGeoDivisionPath,
  fetchGeoDivisions,
} from '../../services/geoService.ts';
import type {
  AdministrativeDivision,
  CountryAdminLevel,
  CountryItem,
  GeoTargetSummary,
} from '../../types/index.ts';

export interface GeoSingleValue {
  countryId: string;
  country?: CountryItem;
  divisionId: string | null;
  division?: AdministrativeDivision | null;
  pathTextAr: string;
  lowestNameAr: string;
}

export interface GeoMultiValue {
  countryId: string;
  country?: CountryItem;
  isNationwide: boolean;
  targetDivisionIds: string[];
  targetDivisions: GeoTargetSummary[];
}

export interface GeoFilterValue {
  countryId: string;
  divisionId: string;
}

type GeoLocationSelectorProps =
  | {
      mode: 'single';
      countryId?: string | null;
      divisionId?: string | null;
      defaultCountryIso2?: string;
      required?: boolean;
      compact?: boolean;
      disabled?: boolean;
      onChange: (val: GeoSingleValue) => void;
    }
  | {
      mode: 'multi';
      countryId?: string | null;
      isNationwide?: boolean;
      targetDivisionIds?: string[];
      targetDivisions?: GeoTargetSummary[];
      defaultCountryIso2?: string;
      disabled?: boolean;
      onChange: (val: GeoMultiValue) => void;
    }
  | {
      mode: 'filter';
      countryId?: string;
      divisionId?: string;
      disabled?: boolean;
      onChange: (val: GeoFilterValue) => void;
    };

export const GeoLocationSelector: React.FC<GeoLocationSelectorProps> = (props) => {
  const [countries, setCountries] = useState<CountryItem[]>([]);
  const [levels, setLevels] = useState<CountryAdminLevel[]>([]);
  const [optionsByLevel, setOptionsByLevel] = useState<Record<number, AdministrativeDivision[]>>({});
  const [selectedIdsByLevel, setSelectedIdsByLevel] = useState<Record<number, string>>({});
  const [isLoadingCountries, setIsLoadingCountries] = useState(true);
  const [isLoadingDivisions, setIsLoadingDivisions] = useState(false);

  const activeCountryId = props.countryId || '';
  const selectedCountry = useMemo(
    () => countries.find((c) => c.id === activeCountryId),
    [countries, activeCountryId]
  );

  // Load 22 active Arab League countries once
  useEffect(() => {
    let mounted = true;
    fetchGeoCountries(false)
      .then(({ countries: list }) => {
        if (!mounted) return;
        setCountries(list);

        if (props.mode !== 'filter' && !props.countryId && list.length > 0) {
          const defaultIso = (props.defaultCountryIso2 || 'YE').toUpperCase();
          const defCountry = list.find((c) => c.iso2 === defaultIso) || list[0];
          if (props.mode === 'single') {
            props.onChange({
              countryId: defCountry.id,
              country: defCountry,
              divisionId: null,
              division: null,
              pathTextAr: defCountry.nameAr,
              lowestNameAr: defCountry.nameAr,
            });
          } else if (props.mode === 'multi') {
            props.onChange({
              countryId: defCountry.id,
              country: defCountry,
              isNationwide: props.isNationwide ?? true,
              targetDivisionIds: props.targetDivisionIds || [],
              targetDivisions: props.targetDivisions || [],
            });
          }
        }
      })
      .catch(() => {})
      .finally(() => {
        if (mounted) setIsLoadingCountries(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  // Load levels + root divisions whenever activeCountryId changes
  useEffect(() => {
    let mounted = true;
    if (!activeCountryId) {
      setLevels([]);
      setOptionsByLevel({});
      setSelectedIdsByLevel({});
      return;
    }

    setIsLoadingDivisions(true);
    Promise.all([
      fetchGeoCountryLevels(activeCountryId),
      fetchGeoDivisions({ countryId: activeCountryId, parentId: null }),
    ])
      .then(async ([lvls, rootDivs]) => {
        if (!mounted) return;
        const activeLevels = lvls.filter((l) => l.isActive).sort((a, b) => a.levelOrder - b.levelOrder);
        setLevels(activeLevels);
        const nextOptions: Record<number, AdministrativeDivision[]> = { 1: rootDivs };
        const nextSelected: Record<number, string> = {};

        // Hydrate initial division path in single or filter mode if provided
        const initialDivId =
          props.mode === 'single'
            ? props.divisionId
            : props.mode === 'filter'
            ? props.divisionId
            : null;

        if (initialDivId) {
          try {
            const { path } = await fetchGeoDivisionPath(initialDivId);
            if (!mounted) return;
            for (let idx = 0; idx < path.length; idx++) {
              const pItem = path[idx];
              nextSelected[pItem.levelOrder] = pItem.id;
              if (idx + 1 < activeLevels.length) {
                const children = await fetchGeoDivisions({
                  countryId: activeCountryId,
                  parentId: pItem.id,
                });
                if (!mounted) return;
                if (children.length > 0) {
                  nextOptions[pItem.levelOrder + 1] = children;
                }
              }
            }
          } catch {}
        }

        setOptionsByLevel(nextOptions);
        setSelectedIdsByLevel(nextSelected);
      })
      .catch(() => {})
      .finally(() => {
        if (mounted) setIsLoadingDivisions(false);
      });

    return () => {
      mounted = false;
    };
  }, [activeCountryId]);

  const handleCountryChange = (newCountryId: string) => {
    setSelectedIdsByLevel({});
    setOptionsByLevel({});
    const countryObj = countries.find((c) => c.id === newCountryId);

    if (props.mode === 'single') {
      props.onChange({
        countryId: newCountryId,
        country: countryObj,
        divisionId: null,
        division: null,
        pathTextAr: countryObj?.nameAr || '',
        lowestNameAr: countryObj?.nameAr || '',
      });
    } else if (props.mode === 'multi') {
      props.onChange({
        countryId: newCountryId,
        country: countryObj,
        isNationwide: true,
        targetDivisionIds: [],
        targetDivisions: [],
      });
    } else {
      props.onChange({
        countryId: newCountryId,
        divisionId: '',
      });
    }
  };

  const handleLevelSelect = async (levelOrder: number, divisionId: string) => {
    const updatedSelected: Record<number, string> = {};
    for (const [ordStr, val] of Object.entries(selectedIdsByLevel)) {
      const ord = Number(ordStr);
      if (ord < levelOrder && val) updatedSelected[ord] = val;
    }
    if (divisionId) {
      updatedSelected[levelOrder] = divisionId;
    }
    setSelectedIdsByLevel(updatedSelected);

    // Prune deeper options above current levelOrder
    const updatedOptions: Record<number, AdministrativeDivision[]> = {};
    for (const [ordStr, list] of Object.entries(optionsByLevel)) {
      const ord = Number(ordStr);
      if (ord <= levelOrder) updatedOptions[ord] = list;
    }

    const nextLevel = levels.find((l) => l.levelOrder === levelOrder + 1);

    if (divisionId && nextLevel) {
      setIsLoadingDivisions(true);
      try {
        const children = await fetchGeoDivisions({
          countryId: activeCountryId,
          parentId: divisionId,
        });
        if (children.length > 0) {
          updatedOptions[nextLevel.levelOrder] = children;
        }
      } catch {}
      setIsLoadingDivisions(false);
    }
    setOptionsByLevel(updatedOptions);

    // Resolve effective lowest selected division
    const orderedPicked = Object.entries(updatedSelected)
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([ord, id]) => (updatedOptions[Number(ord)] || []).find((d) => d.id === id))
      .filter(Boolean) as AdministrativeDivision[];

    const lowest = orderedPicked[orderedPicked.length - 1] || null;
    const pathParts = [
      selectedCountry?.nameAr,
      ...orderedPicked.map((d) => d.nameAr),
    ].filter(Boolean);

    if (props.mode === 'single') {
      props.onChange({
        countryId: activeCountryId,
        country: selectedCountry,
        divisionId: lowest?.id || null,
        division: lowest,
        pathTextAr: pathParts.join(' · '),
        lowestNameAr: lowest?.nameAr || selectedCountry?.nameAr || '',
      });
    } else if (props.mode === 'filter') {
      props.onChange({
        countryId: activeCountryId,
        divisionId: lowest?.id || '',
      });
    }
  };

  // Multi-mode: add currently picked deepest division to targeted list
  const deepestMultiCandidate = useMemo(() => {
    const sorted = Object.entries(selectedIdsByLevel)
      .sort((a, b) => Number(a[0]) - Number(b[0]));
    if (sorted.length === 0) return null;
    const [ordStr, id] = sorted[sorted.length - 1];
    const ord = Number(ordStr);
    const div = (optionsByLevel[ord] || []).find((d) => d.id === id);
    const lvl = levels.find((l) => l.levelOrder === ord);
    if (!div) return null;
    return { div, lvl };
  }, [selectedIdsByLevel, optionsByLevel, levels]);

  const handleAddTargetDivision = () => {
    if (props.mode !== 'multi' || !deepestMultiCandidate) return;
    const { div, lvl } = deepestMultiCandidate;
    const currentIds = props.targetDivisionIds || [];
    if (currentIds.includes(div.id)) return;

    const currentSummaries = props.targetDivisions || [];
    const nextSummary: GeoTargetSummary = {
      id: div.id,
      countryId: activeCountryId,
      nameAr: div.nameAr,
      nameEn: div.nameEn,
      levelNameAr: lvl?.nameAr || div.levelNameAr,
    };

    props.onChange({
      countryId: activeCountryId,
      country: selectedCountry,
      isNationwide: false,
      targetDivisionIds: [...currentIds, div.id],
      targetDivisions: [...currentSummaries, nextSummary],
    });
  };

  const handleRemoveTargetDivision = (divId: string) => {
    if (props.mode !== 'multi') return;
    const nextIds = (props.targetDivisionIds || []).filter((id) => id !== divId);
    const nextSummaries = (props.targetDivisions || []).filter((d) => d.id !== divId);
    props.onChange({
      countryId: activeCountryId,
      country: selectedCountry,
      isNationwide: nextIds.length === 0 ? Boolean(props.isNationwide) : false,
      targetDivisionIds: nextIds,
      targetDivisions: nextSummaries,
    });
  };

  if (props.mode === 'filter') {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[165px]">
          <Globe2 className="w-3.5 h-3.5 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <select
            aria-label="تصفية حسب الدولة"
            disabled={props.disabled || isLoadingCountries}
            value={props.countryId || ''}
            onChange={(e) => handleCountryChange(e.target.value)}
            className="w-full min-h-[40px] pr-8 pl-3 py-1.5 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            <option value="">كل الدول العربية ({countries.length || 22})</option>
            {countries.map((c) => (
              <option key={c.id} value={c.id}>
                {c.flagEmoji} {c.nameAr}
              </option>
            ))}
          </select>
        </div>

        {activeCountryId &&
          levels.map((lvl) => {
            const opts = optionsByLevel[lvl.levelOrder] || [];
            if (opts.length === 0) return null;
            return (
              <div key={lvl.id} className="min-w-[155px]">
                <select
                  aria-label={lvl.nameAr}
                  disabled={props.disabled || isLoadingDivisions}
                  value={selectedIdsByLevel[lvl.levelOrder] || ''}
                  onChange={(e) => handleLevelSelect(lvl.levelOrder, e.target.value)}
                  className="w-full min-h-[40px] px-3 py-1.5 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="">كل {lvl.pluralAr || lvl.nameAr}</option>
                  {opts.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.nameAr}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}

        {(props.countryId || props.divisionId) && (
          <button
            type="button"
            onClick={() => handleCountryChange('')}
            className="min-h-[40px] px-3 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center gap-1"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>مسح الموقع</span>
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className={`grid gap-3 ${props.mode === 'single' && props.compact ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1 sm:grid-cols-2'}`}>
        {/* Country Select */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
            الدولة العربية {props.mode === 'single' && props.required ? '*' : ''}
          </label>
          <div className="relative">
            <Globe2 className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <select
              required={props.mode === 'single' ? props.required : false}
              disabled={props.disabled || isLoadingCountries}
              value={activeCountryId}
              onChange={(e) => handleCountryChange(e.target.value)}
              className="w-full min-h-[42px] pr-9 pl-3 py-2 text-xs bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-900 dark:text-slate-100"
            >
              {isLoadingCountries && countries.length === 0 ? (
                <option value="">جارٍ تحميل الدول العربية...</option>
              ) : (
                <>
                  <option value="">اختر الدولة...</option>
                  {countries.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.flagEmoji} {c.nameAr} ({c.iso2})
                    </option>
                  ))}
                </>
              )}
            </select>
          </div>
        </div>

        {/* Nationwide vs Targeted Toggle in Multi mode */}
        {props.mode === 'multi' && activeCountryId && (
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              نطاق الاستهداف الجغرافي داخل {selectedCountry?.nameAr || 'الدولة'}
            </label>
            <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-100 dark:bg-slate-800/80 rounded-xl">
              <button
                type="button"
                disabled={props.disabled}
                onClick={() =>
                  props.onChange({
                    countryId: activeCountryId,
                    country: selectedCountry,
                    isNationwide: true,
                    targetDivisionIds: [],
                    targetDivisions: [],
                  })
                }
                className={`min-h-[34px] px-2.5 text-xs font-bold rounded-lg transition-colors ${
                  props.isNationwide !== false
                    ? 'bg-white dark:bg-slate-900 text-emerald-600 dark:text-emerald-400 shadow-sm'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                كافة المناطق
              </button>
              <button
                type="button"
                disabled={props.disabled}
                onClick={() =>
                  props.onChange({
                    countryId: activeCountryId,
                    country: selectedCountry,
                    isNationwide: false,
                    targetDivisionIds: props.targetDivisionIds || [],
                    targetDivisions: props.targetDivisions || [],
                  })
                }
                className={`min-h-[34px] px-2.5 text-xs font-bold rounded-lg transition-colors ${
                  props.isNationwide === false
                    ? 'bg-white dark:bg-slate-900 text-emerald-600 dark:text-emerald-400 shadow-sm'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                تقسيمات محددة
              </button>
            </div>
          </div>
        )}

        {/* Dynamic Cascading Administrative Level Selectors */}
        {activeCountryId &&
          (props.mode === 'single' || props.isNationwide === false) &&
          levels.map((lvl) => {
            const opts = optionsByLevel[lvl.levelOrder] || [];
            if (opts.length === 0) return null;
            const isRequiredLevel = props.mode === 'single' && props.required && lvl.levelOrder === 1;
            return (
              <div key={lvl.id}>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  {lvl.nameAr} {isRequiredLevel ? '*' : '(اختياري)'}
                </label>
                <div className="relative">
                  <MapPin className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <select
                    required={isRequiredLevel}
                    disabled={props.disabled || isLoadingDivisions}
                    value={selectedIdsByLevel[lvl.levelOrder] || ''}
                    onChange={(e) => handleLevelSelect(lvl.levelOrder, e.target.value)}
                    className="w-full min-h-[42px] pr-9 pl-3 py-2 text-xs bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-900 dark:text-slate-100"
                  >
                    <option value="">اختر {lvl.nameAr}...</option>
                    {opts.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.nameAr}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            );
          })}
      </div>

      {/* Multi-select Add button & Target List */}
      {props.mode === 'multi' && props.isNationwide === false && (
        <div className="space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              {deepestMultiCandidate
                ? `المحدد للإضافة: ${deepestMultiCandidate.lvl?.nameAr || ''} — ${deepestMultiCandidate.div.nameAr}`
                : 'اختر تقسيماً إدارياً أعلاه لإضافته إلى نطاق الاستهداف'}
            </span>
            <button
              type="button"
              disabled={!deepestMultiCandidate || (props.targetDivisionIds || []).includes(deepestMultiCandidate.div.id)}
              onClick={handleAddTargetDivision}
              className="min-h-[38px] px-3.5 py-1.5 rounded-xl text-xs font-bold bg-slate-900 dark:bg-emerald-600 hover:bg-slate-800 dark:hover:bg-emerald-700 disabled:opacity-40 text-white flex items-center gap-1.5 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>إضافة إلى الاستهداف</span>
            </button>
          </div>

          {(props.targetDivisions || []).length > 0 && (
            <div className="border border-slate-200 dark:border-slate-700 rounded-xl divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-900">
              {(props.targetDivisions || []).map((t) => (
                <div
                  key={t.id}
                  className="px-3 py-2 flex items-center justify-between gap-2 text-xs"
                >
                  <div className="min-w-0 flex items-center gap-2 text-slate-800 dark:text-slate-200">
                    <MapPin className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    <span className="font-semibold truncate">{t.nameAr}</span>
                    {t.levelNameAr && (
                      <>
                        <span aria-hidden="true" className="text-slate-400">·</span>
                        <span className="text-[11px] text-slate-500 dark:text-slate-400">{t.levelNameAr}</span>
                      </>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemoveTargetDivision(t.id)}
                    aria-label={`إزالة ${t.nameAr}`}
                    className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/30"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
