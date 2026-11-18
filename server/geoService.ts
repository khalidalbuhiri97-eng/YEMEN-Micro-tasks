/**
 * Yemen Task - Arab League Geography Service (22 Member States)
 * Supports Supabase-first queries (Migrations 028 & 029) with transparent fallback
 * to the verified open-source dataset (/data/arab-geography.json) when migrations
 * have not yet been applied to the live database.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getSupabaseAdminClient, getSupabaseUserClient, supabaseServer } from './app.js';
import type {
  AdministrativeDivision,
  CountryAdminLevel,
  CountryItem,
  GeoPathItem,
  GeoTargetSummary,
} from '../src/types/index';

interface RawDatasetCountry {
  id: string;
  iso2: string;
  iso3: string;
  name_ar: string;
  name_en: string;
  flag_emoji: string;
  phone_code?: string | null;
  currency_code?: string | null;
  is_active: boolean;
  display_order: number;
}

interface RawDatasetLevel {
  id: string;
  country_id: string;
  level_order: number;
  code: string;
  name_ar: string;
  name_en: string;
  plural_ar?: string | null;
  is_active: boolean;
}

interface RawDatasetDivision {
  id: string;
  country_id: string;
  level_id: string;
  parent_id: string | null;
  code?: string | null;
  geonames_id?: number | null;
  wikidata_id?: string | null;
  name_ar: string;
  name_en: string;
  latitude?: number | null;
  longitude?: number | null;
  is_active: boolean;
  data_source?: string | null;
  data_license?: string | null;
  source_url?: string | null;
  last_synced_at?: string | null;
}

interface RawGeoDataset {
  generated_at: string;
  countries: RawDatasetCountry[];
  levels: RawDatasetLevel[];
  divisions: RawDatasetDivision[];
}

interface IndexedGeoDataset {
  generatedAt: string;
  countries: CountryItem[];
  countriesById: Map<string, CountryItem>;
  countriesByIso2: Map<string, CountryItem>;
  levelsById: Map<string, CountryAdminLevel>;
  levelsByCountryId: Map<string, CountryAdminLevel[]>;
  divisions: AdministrativeDivision[];
  divisionsById: Map<string, AdministrativeDivision>;
  divisionsByCountryId: Map<string, AdministrativeDivision[]>;
  childrenByParentKey: Map<string, AdministrativeDivision[]>;
  hasChildrenIds: Set<string>;
}

let cachedDataset: IndexedGeoDataset | null = null;

function loadGeoDataset(): IndexedGeoDataset {
  if (cachedDataset) return cachedDataset;

  const filePath = path.resolve(process.cwd(), 'data', 'arab-geography.json');
  const rawText = fs.readFileSync(filePath, 'utf8');
  const parsed: RawGeoDataset = JSON.parse(rawText);

  const countriesById = new Map<string, CountryItem>();
  const countriesByIso2 = new Map<string, CountryItem>();
  const levelsById = new Map<string, CountryAdminLevel>();
  const levelsByCountryId = new Map<string, CountryAdminLevel[]>();
  const divisionsById = new Map<string, AdministrativeDivision>();
  const divisionsByCountryId = new Map<string, AdministrativeDivision[]>();
  const childrenByParentKey = new Map<string, AdministrativeDivision[]>();
  const hasChildrenIds = new Set<string>();

  // Derive per-country provenance summary from its divisions
  const countryProvenance = new Map<string, { source?: string; license?: string; syncedAt?: string }>();
  for (const d of parsed.divisions || []) {
    if (d.parent_id) {
      hasChildrenIds.add(d.parent_id);
    }
    if (!countryProvenance.has(d.country_id) && (d.data_source || d.data_license)) {
      countryProvenance.set(d.country_id, {
        source: d.data_source || undefined,
        license: d.data_license || undefined,
        syncedAt: d.last_synced_at || parsed.generated_at,
      });
    }
  }

  const countries: CountryItem[] = (parsed.countries || [])
    .map((c) => {
      const prov = countryProvenance.get(c.id);
      const item: CountryItem = {
        id: c.id,
        iso2: String(c.iso2 || '').toUpperCase(),
        iso3: String(c.iso3 || '').toUpperCase(),
        nameAr: c.name_ar,
        nameEn: c.name_en,
        phoneCode: c.phone_code ?? null,
        flagEmoji: c.flag_emoji || '🏳️',
        isActive: Boolean(c.is_active),
        sortOrder: Number(c.display_order ?? 100),
        dataSource: prov?.source || 'GeoNames + UN OCHA HDX + Wikidata',
        dataLicense: prov?.license || 'CC BY 4.0 / CC BY-IGO / CC0',
        lastSyncedAt: prov?.syncedAt || parsed.generated_at,
      };
      countriesById.set(item.id, item);
      countriesByIso2.set(item.iso2, item);
      return item;
    })
    .sort((a, b) => a.sortOrder - b.sortOrder || a.iso2.localeCompare(b.iso2));

  for (const l of parsed.levels || []) {
    const level: CountryAdminLevel = {
      id: l.id,
      countryId: l.country_id,
      levelOrder: Number(l.level_order),
      nameAr: l.name_ar,
      nameEn: l.name_en,
      pluralAr: l.plural_ar ?? null,
      isRequired: Number(l.level_order) === 1,
      isActive: Boolean(l.is_active),
    };
    levelsById.set(level.id, level);
    const list = levelsByCountryId.get(level.countryId) || [];
    list.push(level);
    levelsByCountryId.set(level.countryId, list);
  }
  for (const [, list] of levelsByCountryId.entries()) {
    list.sort((a, b) => a.levelOrder - b.levelOrder);
  }

  const divisions: AdministrativeDivision[] = [];
  for (const d of parsed.divisions || []) {
    const lvl = levelsById.get(d.level_id);
    const div: AdministrativeDivision = {
      id: d.id,
      countryId: d.country_id,
      levelId: d.level_id,
      levelOrder: lvl?.levelOrder,
      levelNameAr: lvl?.nameAr,
      levelNameEn: lvl?.nameEn,
      parentId: d.parent_id ?? null,
      code: d.code ?? null,
      geonamesId: d.geonames_id ?? null,
      wikidataId: d.wikidata_id ?? null,
      nameAr: d.name_ar,
      nameEn: d.name_en,
      latitude: d.latitude !== null && d.latitude !== undefined ? Number(d.latitude) : null,
      longitude: d.longitude !== null && d.longitude !== undefined ? Number(d.longitude) : null,
      isActive: Boolean(d.is_active),
      hasChildren: hasChildrenIds.has(d.id),
      dataSource: d.data_source || 'Open Geo Dataset',
      dataLicense: d.data_license || 'CC BY 4.0',
      sourceUrl: d.source_url ?? null,
      lastSyncedAt: d.last_synced_at ?? parsed.generated_at,
    };
    divisions.push(div);
    divisionsById.set(div.id, div);

    const byCountry = divisionsByCountryId.get(div.countryId) || [];
    byCountry.push(div);
    divisionsByCountryId.set(div.countryId, byCountry);

    const parentKey = `${div.countryId}::${div.parentId || 'ROOT'}`;
    const children = childrenByParentKey.get(parentKey) || [];
    children.push(div);
    childrenByParentKey.set(parentKey, children);
  }

  for (const [, list] of childrenByParentKey.entries()) {
    list.sort((a, b) => a.nameAr.localeCompare(b.nameAr, 'ar'));
  }

  cachedDataset = {
    generatedAt: parsed.generated_at,
    countries,
    countriesById,
    countriesByIso2,
    levelsById,
    levelsByCountryId,
    divisions,
    divisionsById,
    divisionsByCountryId,
    childrenByParentKey,
    hasChildrenIds,
  };

  return cachedDataset;
}

// ==============================================================================
// TTL CACHE & DB HELPERS
// ==============================================================================

const CACHE_TTL_MS = 60_000;

interface TimedEntry<T> {
  value: T;
  expiresAt: number;
}

let readinessCache: TimedEntry<{ tablesExist: boolean; seeded: boolean; ready: boolean }> | null = null;
const countriesCache = new Map<string, TimedEntry<CountryItem[]>>();
const levelsCache = new Map<string, TimedEntry<CountryAdminLevel[]>>();
const divisionsCache = new Map<string, TimedEntry<AdministrativeDivision[]>>();
const pathCache = new Map<string, TimedEntry<{ path: GeoPathItem[]; division?: AdministrativeDivision }>>();

export function invalidateGeoCache(): void {
  readinessCache = null;
  countriesCache.clear();
  levelsCache.clear();
  divisionsCache.clear();
  pathCache.clear();
}

export function isMissingGeoRelationError(err: any): boolean {
  const code = String(err?.code || '');
  const msg = String(err?.message || '').toLowerCase();
  return (
    code === '42P01' ||
    code === '42703' ||
    code === 'PGRST204' ||
    code === 'PGRST205' ||
    msg.includes('does not exist') ||
    msg.includes('could not find the table') ||
    msg.includes('schema cache') ||
    msg.includes('column')
  );
}

function getGeoReadClient(authToken?: string) {
  try {
    return getSupabaseAdminClient();
  } catch {
    if (authToken) return getSupabaseUserClient(authToken);
    return supabaseServer;
  }
}

function getGeoWriteClient(authToken?: string) {
  try {
    return getSupabaseAdminClient();
  } catch {
    if (authToken) return getSupabaseUserClient(authToken);
    return supabaseServer;
  }
}

function mapCountryRow(row: any): CountryItem {
  return {
    id: row.id,
    iso2: String(row.iso2 || '').toUpperCase(),
    iso3: String(row.iso3 || '').toUpperCase(),
    nameAr: row.name_ar,
    nameEn: row.name_en,
    phoneCode: row.phone_code ?? null,
    flagEmoji: row.flag_emoji || '🏳️',
    isActive: row.is_active !== false,
    sortOrder: Number(row.sort_order ?? 100),
    dataSource: row.data_source ?? null,
    dataLicense: row.data_license ?? null,
    lastSyncedAt: row.last_synced_at ?? null,
  };
}

function mapLevelRow(row: any): CountryAdminLevel {
  return {
    id: row.id,
    countryId: row.country_id,
    levelOrder: Number(row.level_order),
    nameAr: row.name_ar,
    nameEn: row.name_en,
    pluralAr: row.plural_ar ?? null,
    isRequired: Boolean(row.is_required),
    isActive: row.is_active !== false,
  };
}

function mapDivisionRow(
  row: any,
  levelLookup?: Map<string, CountryAdminLevel>,
  parentWithChildren?: Set<string>
): AdministrativeDivision {
  const lvl = levelLookup?.get(row.level_id);
  return {
    id: row.id,
    countryId: row.country_id,
    levelId: row.level_id,
    levelOrder: lvl?.levelOrder ?? row.level_order,
    levelNameAr: lvl?.nameAr ?? row.level_name_ar,
    levelNameEn: lvl?.nameEn ?? row.level_name_en,
    parentId: row.parent_id ?? null,
    code: row.code ?? null,
    geonamesId: row.geonames_id !== null && row.geonames_id !== undefined ? Number(row.geonames_id) : null,
    wikidataId: row.wikidata_id ?? null,
    nameAr: row.name_ar,
    nameEn: row.name_en,
    latitude: row.latitude !== null && row.latitude !== undefined ? Number(row.latitude) : null,
    longitude: row.longitude !== null && row.longitude !== undefined ? Number(row.longitude) : null,
    isActive: row.is_active !== false,
    hasChildren: parentWithChildren ? parentWithChildren.has(row.id) : undefined,
    dataSource: row.data_source ?? undefined,
    dataLicense: row.data_license ?? undefined,
    sourceUrl: row.source_url ?? null,
    lastSyncedAt: row.last_synced_at ?? null,
  };
}

// ==============================================================================
// PUBLIC GEO READ QUERIES
// ==============================================================================

export const geoService = {
  getDatasetStats() {
    const ds = loadGeoDataset();
    return {
      countriesCount: ds.countries.length,
      levelsCount: Array.from(ds.levelsById.values()).length,
      divisionsCount: ds.divisions.length,
      generatedAt: ds.generatedAt,
    };
  },

  async checkGeoTablesStatus(authToken?: string): Promise<{ tablesExist: boolean; seeded: boolean; ready: boolean }> {
    const now = Date.now();
    if (readinessCache && readinessCache.expiresAt > now) {
      return readinessCache.value;
    }

    try {
      const db = getGeoReadClient(authToken);
      const { count, error } = await db
        .from('countries')
        .select('id', { count: 'exact', head: true });

      if (error) {
        const res = { tablesExist: !isMissingGeoRelationError(error), seeded: false, ready: false };
        readinessCache = { value: res, expiresAt: now + CACHE_TTL_MS };
        return res;
      }

      const seeded = Number(count || 0) > 0;
      const res = { tablesExist: true, seeded, ready: seeded };
      readinessCache = { value: res, expiresAt: now + CACHE_TTL_MS };
      return res;
    } catch {
      const res = { tablesExist: false, seeded: false, ready: false };
      readinessCache = { value: res, expiresAt: now + CACHE_TTL_MS };
      return res;
    }
  },

  async getCountries(options?: { includeInactive?: boolean; authToken?: string }): Promise<{
    countries: CountryItem[];
    geoTablesReady: boolean;
  }> {
    const includeInactive = Boolean(options?.includeInactive);
    const cacheKey = includeInactive ? 'ALL' : 'ACTIVE';
    const now = Date.now();
    const status = await this.checkGeoTablesStatus(options?.authToken);

    const cached = countriesCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return { countries: cached.value, geoTablesReady: status.ready };
    }

    if (status.ready) {
      try {
        const db = getGeoReadClient(options?.authToken);
        let q = db
          .from('countries')
          .select('*')
          .order('sort_order', { ascending: true })
          .order('iso2', { ascending: true });
        if (!includeInactive) {
          q = q.eq('is_active', true);
        }
        const { data, error } = await q;
        if (!error && data && data.length > 0) {
          const mapped = data.map(mapCountryRow);
          countriesCache.set(cacheKey, { value: mapped, expiresAt: now + CACHE_TTL_MS });
          return { countries: mapped, geoTablesReady: true };
        }
      } catch {
        // Fall through to verified dataset
      }
    }

    const ds = loadGeoDataset();
    const list = includeInactive ? ds.countries : ds.countries.filter((c) => c.isActive);
    countriesCache.set(cacheKey, { value: list, expiresAt: now + CACHE_TTL_MS });
    return { countries: list, geoTablesReady: status.ready };
  },

  async resolveCountry(countryIdOrIso2: string, authToken?: string): Promise<CountryItem | null> {
    const key = String(countryIdOrIso2 || '').trim();
    if (!key) return null;
    const { countries } = await this.getCountries({ includeInactive: true, authToken });
    const upper = key.toUpperCase();
    return countries.find((c) => c.id === key || c.iso2 === upper || c.iso3 === upper) || null;
  },

  async getCountryLevels(countryIdOrIso2: string, authToken?: string): Promise<CountryAdminLevel[]> {
    const country = await this.resolveCountry(countryIdOrIso2, authToken);
    if (!country) return [];

    const now = Date.now();
    const cached = levelsCache.get(country.id);
    if (cached && cached.expiresAt > now) {
      return cached.value;
    }

    const status = await this.checkGeoTablesStatus(authToken);
    if (status.ready) {
      try {
        const db = getGeoReadClient(authToken);
        const { data, error } = await db
          .from('country_admin_levels')
          .select('*')
          .eq('country_id', country.id)
          .order('level_order', { ascending: true });
        if (!error && data && data.length > 0) {
          const mapped = data.map(mapLevelRow);
          levelsCache.set(country.id, { value: mapped, expiresAt: now + CACHE_TTL_MS });
          return mapped;
        }
      } catch {
        // Fallback to dataset
      }
    }

    const ds = loadGeoDataset();
    const list = ds.levelsByCountryId.get(country.id) || [];
    levelsCache.set(country.id, { value: list, expiresAt: now + CACHE_TTL_MS });
    return list;
  },

  async getDivisions(params: {
    countryId: string;
    parentId?: string | null;
    levelId?: string;
    search?: string;
    includeInactive?: boolean;
    limit?: number;
    authToken?: string;
  }): Promise<AdministrativeDivision[]> {
    const country = await this.resolveCountry(params.countryId, params.authToken);
    if (!country) return [];

    const includeInactive = Boolean(params.includeInactive);
    const cleanSearch = (params.search || '').trim().toLowerCase();
    const limit = Math.min(Math.max(Number(params.limit) || 600, 1), 1000);
    const parentNormalized = params.parentId === undefined ? undefined : params.parentId || null;

    const cacheKey =
      !cleanSearch && limit >= 600
        ? `${country.id}::${parentNormalized === undefined ? 'ANY' : parentNormalized || 'ROOT'}::${params.levelId || 'ALL'}::${includeInactive ? 'ALL' : 'ACT'}`
        : '';

    const now = Date.now();
    if (cacheKey) {
      const cached = divisionsCache.get(cacheKey);
      if (cached && cached.expiresAt > now) {
        return cached.value;
      }
    }

    const levels = await this.getCountryLevels(country.id, params.authToken);
    const levelMap = new Map<string, CountryAdminLevel>(levels.map((l) => [l.id, l]));

    const status = await this.checkGeoTablesStatus(params.authToken);
    if (status.ready) {
      try {
        const db = getGeoReadClient(params.authToken);
        let q = db
          .from('administrative_divisions')
          .select('*')
          .eq('country_id', country.id)
          .order('name_ar', { ascending: true })
          .limit(limit);

        if (!includeInactive) {
          q = q.eq('is_active', true);
        }
        if (params.levelId) {
          q = q.eq('level_id', params.levelId);
        }
        if (parentNormalized === null) {
          q = q.is('parent_id', null);
        } else if (typeof parentNormalized === 'string') {
          q = q.eq('parent_id', parentNormalized);
        }
        if (cleanSearch) {
          q = q.or(`name_ar.ilike.%${cleanSearch}%,name_en.ilike.%${cleanSearch}%,code.ilike.%${cleanSearch}%`);
        }

        const { data, error } = await q;
        if (!error && data) {
          // Determine which returned nodes have children
          const ids = data.map((r: any) => r.id);
          const parentWithChildren = new Set<string>();
          if (ids.length > 0 && ids.length <= 500) {
            const { data: childRows } = await db
              .from('administrative_divisions')
              .select('parent_id')
              .in('parent_id', ids);
            for (const c of childRows || []) {
              if (c.parent_id) parentWithChildren.add(c.parent_id);
            }
          }
          const mapped = data.map((row: any) => mapDivisionRow(row, levelMap, parentWithChildren));
          if (cacheKey && (mapped.length > 0 || parentNormalized !== null)) {
            divisionsCache.set(cacheKey, { value: mapped, expiresAt: now + CACHE_TTL_MS });
          }
          if (mapped.length > 0 || cleanSearch || parentNormalized !== null) {
            return mapped;
          }
        }
      } catch {
        // Fall through to dataset
      }
    }

    const ds = loadGeoDataset();
    let list: AdministrativeDivision[] = [];

    if (!cleanSearch && !params.levelId && parentNormalized !== undefined) {
      list = ds.childrenByParentKey.get(`${country.id}::${parentNormalized || 'ROOT'}`) || [];
    } else {
      list = ds.divisionsByCountryId.get(country.id) || [];
      if (parentNormalized !== undefined) {
        list = list.filter((d) => (parentNormalized === null ? d.parentId === null : d.parentId === parentNormalized));
      }
      if (params.levelId) {
        list = list.filter((d) => d.levelId === params.levelId);
      }
      if (cleanSearch) {
        list = list.filter(
          (d) =>
            d.nameAr.toLowerCase().includes(cleanSearch) ||
            d.nameEn.toLowerCase().includes(cleanSearch) ||
            (d.code && d.code.toLowerCase().includes(cleanSearch))
        );
      }
      list = [...list].sort((a, b) => a.nameAr.localeCompare(b.nameAr, 'ar'));
    }

    if (!includeInactive) {
      list = list.filter((d) => d.isActive);
    }

    const sliced = list.slice(0, limit);
    if (cacheKey) {
      divisionsCache.set(cacheKey, { value: sliced, expiresAt: now + CACHE_TTL_MS });
    }
    return sliced;
  },

  async getDivisionChildren(divisionId: string, authToken?: string): Promise<AdministrativeDivision[]> {
    const div = await this.getDivisionById(divisionId, authToken);
    if (!div) return [];
    return this.getDivisions({
      countryId: div.countryId,
      parentId: div.id,
      authToken,
    });
  },

  async getDivisionById(divisionId: string, authToken?: string): Promise<AdministrativeDivision | null> {
    if (!divisionId) return null;
    const status = await this.checkGeoTablesStatus(authToken);
    if (status.ready) {
      try {
        const db = getGeoReadClient(authToken);
        const { data, error } = await db
          .from('administrative_divisions')
          .select('*')
          .eq('id', divisionId)
          .maybeSingle();
        if (!error && data) {
          const levels = await this.getCountryLevels(data.country_id, authToken);
          const levelMap = new Map<string, CountryAdminLevel>(levels.map((l) => [l.id, l]));
          return mapDivisionRow(data, levelMap);
        }
      } catch {
        // Fallback to dataset
      }
    }
    const ds = loadGeoDataset();
    return ds.divisionsById.get(divisionId) || null;
  },

  async getDivisionPath(
    divisionId: string,
    authToken?: string
  ): Promise<{ path: GeoPathItem[]; division?: AdministrativeDivision }> {
    if (!divisionId) return { path: [] };
    const now = Date.now();
    const cached = pathCache.get(divisionId);
    if (cached && cached.expiresAt > now) {
      return cached.value;
    }

    const chain: AdministrativeDivision[] = [];
    const visited = new Set<string>();
    let currId: string | null = divisionId;
    let depth = 0;

    while (currId && depth < 8 && !visited.has(currId)) {
      visited.add(currId);
      const div = await this.getDivisionById(currId, authToken);
      if (!div) break;
      chain.unshift(div);
      currId = div.parentId;
      depth++;
    }

    const levels = chain.length > 0 ? await this.getCountryLevels(chain[0].countryId, authToken) : [];
    const levelMap = new Map<string, CountryAdminLevel>(levels.map((l) => [l.id, l]));

    const pathItems: GeoPathItem[] = chain.map((d) => {
      const lvl = levelMap.get(d.levelId);
      return {
        id: d.id,
        levelOrder: lvl?.levelOrder ?? d.levelOrder ?? 1,
        levelNameAr: lvl?.nameAr ?? d.levelNameAr ?? '',
        levelNameEn: lvl?.nameEn ?? d.levelNameEn,
        nameAr: d.nameAr,
        nameEn: d.nameEn,
      };
    });

    const result = {
      path: pathItems,
      division: chain[chain.length - 1],
    };
    pathCache.set(divisionId, { value: result, expiresAt: now + CACHE_TTL_MS });
    return result;
  },

  async resolveLocationMeta(params: {
    countryId?: string | null;
    divisionId?: string | null;
    authToken?: string;
  }): Promise<{
    country?: CountryItem;
    division?: AdministrativeDivision;
    locationPath?: string;
  }> {
    const country = params.countryId ? await this.resolveCountry(params.countryId, params.authToken) : null;
    if (!params.divisionId) {
      return {
        country: country || undefined,
        locationPath: country?.nameAr,
      };
    }
    const pathRes = await this.getDivisionPath(params.divisionId, params.authToken);
    const resolvedCountry =
      country ||
      (pathRes.division?.countryId
        ? await this.resolveCountry(pathRes.division.countryId, params.authToken)
        : null);

    const parts = [resolvedCountry?.nameAr, ...pathRes.path.map((p) => p.nameAr)].filter(Boolean);
    return {
      country: resolvedCountry || undefined,
      division: pathRes.division,
      locationPath: parts.join(' · ') || undefined,
    };
  },

  /**
   * Validates that selected countryId & divisionId(s) exist, are active, and belong to the same country.
   */
  async validateGeoSelection(params: {
    countryId?: string | null;
    divisionId?: string | null;
    divisionIds?: string[];
    requireActiveCountry?: boolean;
    authToken?: string;
  }): Promise<{
    country: CountryItem | null;
    division: AdministrativeDivision | null;
    divisions: AdministrativeDivision[];
    locationPath: string | null;
  }> {
    let country: CountryItem | null = null;
    if (params.countryId) {
      country = await this.resolveCountry(params.countryId, params.authToken);
      if (!country) {
        throw new Error('الدولة المحددة غير موجودة في سجل الدول العربية.');
      }
      if (params.requireActiveCountry !== false && !country.isActive) {
        throw new Error(`الدولة المحددة (${country.nameAr}) غير مفعّلة حالياً.`);
      }
    }

    let division: AdministrativeDivision | null = null;
    if (params.divisionId) {
      division = await this.getDivisionById(params.divisionId, params.authToken);
      if (!division) {
        throw new Error('التقسيم الإداري المحدد غير موجود.');
      }
      if (!division.isActive) {
        throw new Error(`التقسيم الإداري (${division.nameAr}) غير مفعّل حالياً.`);
      }
      if (country && division.countryId !== country.id) {
        throw new Error('التقسيم الإداري المحدد لا يتبع الدولة المختارة.');
      }
      if (!country) {
        country = await this.resolveCountry(division.countryId, params.authToken);
      }
    }

    const divisions: AdministrativeDivision[] = [];
    const seen = new Set<string>();
    for (const rawId of params.divisionIds || []) {
      const id = String(rawId || '').trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const d = await this.getDivisionById(id, params.authToken);
      if (!d) {
        throw new Error(`التقسيم الإداري المستهدف (${id}) غير موجود.`);
      }
      if (!d.isActive) {
        throw new Error(`التقسيم الإداري المستهدف (${d.nameAr}) غير مفعّل.`);
      }
      if (country && d.countryId !== country.id) {
        throw new Error(`التقسيم الإداري (${d.nameAr}) لا ينتمي إلى الدولة المحددة.`);
      }
      if (!country) {
        country = await this.resolveCountry(d.countryId, params.authToken);
      }
      divisions.push(d);
    }

    let locationPath: string | null = country ? country.nameAr : null;
    if (division) {
      const meta = await this.resolveLocationMeta({
        countryId: country?.id,
        divisionId: division.id,
        authToken: params.authToken,
      });
      locationPath = meta.locationPath || locationPath;
    }

    return { country, division, divisions, locationPath };
  },

  /**
   * Expands a divisionId to itself + all descendant division IDs (supports multi-level filtering).
   */
  async expandDivisionAndDescendants(divisionId: string, authToken?: string): Promise<string[]> {
    if (!divisionId) return [];
    const status = await this.checkGeoTablesStatus(authToken);
    if (status.ready) {
      try {
        const db = getGeoReadClient(authToken);
        const { data, error } = await db.rpc('get_division_descendant_ids', {
          p_division_id: divisionId,
        });
        if (!error && Array.isArray(data) && data.length > 0) {
          return Array.from(new Set(data.map((r: any) => String(typeof r === 'string' ? r : r?.id || r?.get_division_descendant_ids || r)).filter(Boolean)));
        }
      } catch {
        // Fallback to BFS
      }
    }

    const ds = loadGeoDataset();
    const div = ds.divisionsById.get(divisionId);
    if (!div) return [divisionId];

    const result: string[] = [divisionId];
    const queue: string[] = [divisionId];
    const visited = new Set<string>([divisionId]);
    while (queue.length > 0) {
      const curr = queue.shift()!;
      const children = ds.childrenByParentKey.get(`${div.countryId}::${curr}`) || [];
      for (const ch of children) {
        if (!visited.has(ch.id)) {
          visited.add(ch.id);
          result.push(ch.id);
          queue.push(ch.id);
        }
      }
    }
    return result;
  },

  async resolveTargetSummariesByIds(divisionIds: string[], authToken?: string): Promise<Map<string, GeoTargetSummary>> {
    const cleanIds = Array.from(new Set((divisionIds || []).filter(Boolean)));
    const map = new Map<string, GeoTargetSummary>();
    if (cleanIds.length === 0) return map;

    const status = await this.checkGeoTablesStatus(authToken);
    if (status.ready) {
      try {
        const db = getGeoReadClient(authToken);
        const { data, error } = await db
          .from('administrative_divisions')
          .select('id, country_id, level_id, name_ar, name_en')
          .in('id', cleanIds);
        if (!error && data && data.length > 0) {
          const countryIds = Array.from(new Set(data.map((d: any) => d.country_id)));
          const levelMap = new Map<string, CountryAdminLevel>();
          await Promise.all(
            countryIds.map(async (cid) => {
              const lvls = await this.getCountryLevels(cid, authToken);
              for (const l of lvls) levelMap.set(l.id, l);
            })
          );
          for (const d of data) {
            const lvl = levelMap.get(d.level_id);
            map.set(d.id, {
              id: d.id,
              countryId: d.country_id,
              nameAr: d.name_ar,
              nameEn: d.name_en,
              levelNameAr: lvl?.nameAr,
            });
          }
          return map;
        }
      } catch {
        // Fallback to dataset
      }
    }

    const ds = loadGeoDataset();
    for (const id of cleanIds) {
      const d = ds.divisionsById.get(id);
      if (d) {
        map.set(id, {
          id: d.id,
          countryId: d.countryId,
          nameAr: d.nameAr,
          nameEn: d.nameEn,
          levelNameAr: d.levelNameAr,
        });
      }
    }
    return map;
  },

  /**
   * Fast synchronous enrichment from verified dataset + optional preloaded country map.
   */
  resolveFastGeoLabels(params: {
    countryId?: string | null;
    divisionId?: string | null;
  }): {
    countryCode?: string | null;
    countryNameAr?: string | null;
    countryFlag?: string | null;
    divisionNameAr?: string | null;
    locationPath?: string | null;
  } {
    const ds = loadGeoDataset();
    const div = params.divisionId ? ds.divisionsById.get(params.divisionId) : undefined;
    const country = params.countryId
      ? ds.countriesById.get(params.countryId)
      : div?.countryId
      ? ds.countriesById.get(div.countryId)
      : undefined;

    if (!country && !div) return {};

    const parts: string[] = [];
    if (country?.nameAr) parts.push(country.nameAr);
    if (div) {
      const chain: string[] = [];
      let curr: AdministrativeDivision | undefined = div;
      let depth = 0;
      const seen = new Set<string>();
      while (curr && depth < 6 && !seen.has(curr.id)) {
        seen.add(curr.id);
        chain.unshift(curr.nameAr);
        curr = curr.parentId ? ds.divisionsById.get(curr.parentId) : undefined;
        depth++;
      }
      parts.push(...chain);
    }

    return {
      countryCode: country?.iso2 || null,
      countryNameAr: country?.nameAr || null,
      countryFlag: country?.flagEmoji || null,
      divisionNameAr: div?.nameAr || null,
      locationPath: parts.join(' · ') || null,
    };
  },

  // ============================================================================
  // ADMIN GEO MANAGEMENT & INTEGRITY AUDIT
  // ============================================================================

  async getAdminGeoOverview(authToken?: string) {
    const status = await this.checkGeoTablesStatus(authToken);
    const { countries } = await this.getCountries({ includeInactive: true, authToken });
    const db = getGeoReadClient(authToken);
    const ds = loadGeoDataset();

    // Count levels & divisions per country from live DB if ready, otherwise dataset
    const divisionsCountByCountry = new Map<string, { total: number; l1: number; l2: number; l3: number }>();
    const levelsByCountry = new Map<string, CountryAdminLevel[]>();

    if (status.ready) {
      try {
        const [{ data: allLevels }, { data: allDivs }] = await Promise.all([
          db.from('country_admin_levels').select('*').order('level_order', { ascending: true }),
          db.from('administrative_divisions').select('id, country_id, level_id'),
        ]);
        const lvlOrderById = new Map<string, number>();
        for (const r of allLevels || []) {
          const mapped = mapLevelRow(r);
          lvlOrderById.set(mapped.id, mapped.levelOrder);
          const list = levelsByCountry.get(mapped.countryId) || [];
          list.push(mapped);
          levelsByCountry.set(mapped.countryId, list);
        }
        for (const d of allDivs || []) {
          const ord = lvlOrderById.get(d.level_id) || 1;
          const bucket = divisionsCountByCountry.get(d.country_id) || { total: 0, l1: 0, l2: 0, l3: 0 };
          bucket.total++;
          if (ord === 1) bucket.l1++;
          else if (ord === 2) bucket.l2++;
          else bucket.l3++;
          divisionsCountByCountry.set(d.country_id, bucket);
        }
      } catch {
        // Fallback below
      }
    }

    if (divisionsCountByCountry.size === 0) {
      for (const c of ds.countries) {
        const lvls = ds.levelsByCountryId.get(c.id) || [];
        levelsByCountry.set(c.id, lvls);
        const divs = ds.divisionsByCountryId.get(c.id) || [];
        const bucket = { total: divs.length, l1: 0, l2: 0, l3: 0 };
        for (const d of divs) {
          if (d.levelOrder === 1) bucket.l1++;
          else if (d.levelOrder === 2) bucket.l2++;
          else bucket.l3++;
        }
        divisionsCountByCountry.set(c.id, bucket);
      }
    }

    // Count users & active tasks per country (graceful if pre-028 schema)
    const usersCountByCountry = new Map<string, number>();
    const tasksCountByCountry = new Map<string, number>();
    try {
      const [{ data: profs }, { data: tasks }] = await Promise.all([
        db.from('profiles').select('country_id'),
        db.from('tasks').select('country_id, status'),
      ]);
      for (const p of profs || []) {
        if (p.country_id) {
          usersCountByCountry.set(p.country_id, (usersCountByCountry.get(p.country_id) || 0) + 1);
        }
      }
      for (const t of tasks || []) {
        if (t.country_id) {
          tasksCountByCountry.set(t.country_id, (tasksCountByCountry.get(t.country_id) || 0) + 1);
        }
      }
    } catch {
      // Pre-028 columns absent
    }

    const overviewCountries = countries.map((c) => {
      const lvls = levelsByCountry.get(c.id) || [];
      const counts = divisionsCountByCountry.get(c.id) || { total: 0, l1: 0, l2: 0, l3: 0 };
      return {
        ...c,
        levels: lvls,
        divisionsCount: counts.total,
        level1Count: counts.l1,
        level2Count: counts.l2,
        level3Count: counts.l3,
        usersCount: usersCountByCountry.get(c.id) || 0,
        tasksCount: tasksCountByCountry.get(c.id) || 0,
      };
    });

    return {
      geoTablesReady: status.ready,
      tablesExist: status.tablesExist,
      seeded: status.seeded,
      sourceMode: status.ready ? 'supabase' : 'dataset_fallback',
      totalCountries: overviewCountries.length,
      activeCountries: overviewCountries.filter((c) => c.isActive).length,
      totalLevels: overviewCountries.reduce((s, c) => s + c.levels.length, 0),
      totalDivisions: overviewCountries.reduce((s, c) => s + c.divisionsCount, 0),
      countries: overviewCountries,
    };
  },

  async getAdminGeoIntegrity(authToken?: string) {
    const status = await this.checkGeoTablesStatus(authToken);
    const db = getGeoReadClient(authToken);
    const ds = loadGeoDataset();

    let countriesList: CountryItem[] = ds.countries;
    let levelsList: CountryAdminLevel[] = Array.from(ds.levelsById.values());
    let divisionsList: AdministrativeDivision[] = ds.divisions;

    if (status.ready) {
      try {
        const [{ data: cData }, { data: lData }, { data: dData }] = await Promise.all([
          db.from('countries').select('*').order('sort_order', { ascending: true }),
          db.from('country_admin_levels').select('*'),
          db.from('administrative_divisions').select('*').limit(10000),
        ]);
        if (cData && cData.length > 0 && lData && dData) {
          countriesList = cData.map(mapCountryRow);
          levelsList = lData.map(mapLevelRow);
          const lMap = new Map(levelsList.map((l) => [l.id, l]));
          divisionsList = dData.map((r: any) => mapDivisionRow(r, lMap));
        }
      } catch {
        // Use dataset
      }
    }

    const levelById = new Map(levelsList.map((l) => [l.id, l]));
    const divById = new Map(divisionsList.map((d) => [d.id, d]));

    let missingNamesCount = 0;
    let crossCountryParentCount = 0;
    let invalidLevelOrderCount = 0;
    let cyclesCount = 0;
    let duplicateCodeCount = 0;
    let duplicateSiblingCount = 0;

    const codeSet = new Set<string>();
    const siblingSet = new Set<string>();
    const countriesWithDivs = new Set<string>();

    for (const d of divisionsList) {
      countriesWithDivs.add(d.countryId);
      if (!d.nameAr?.trim() || !d.nameEn?.trim()) {
        missingNamesCount++;
      }
      if (d.code?.trim()) {
        const k = `${d.countryId}::${d.code.trim().toLowerCase()}`;
        if (codeSet.has(k)) duplicateCodeCount++;
        codeSet.add(k);
      }
      const sibKey = `${d.countryId}::${d.parentId || 'ROOT'}::${d.levelId}::${(d.nameEn || '').trim().toLowerCase()}`;
      if (siblingSet.has(sibKey)) duplicateSiblingCount++;
      siblingSet.add(sibKey);

      const lvl = levelById.get(d.levelId);
      if (d.parentId) {
        const parent = divById.get(d.parentId);
        if (!parent || parent.countryId !== d.countryId) {
          crossCountryParentCount++;
        } else {
          const parentLvl = levelById.get(parent.levelId);
          if (lvl && parentLvl && parentLvl.levelOrder >= lvl.levelOrder) {
            invalidLevelOrderCount++;
          }
        }
        // Cycle detection
        let currParent: string | null = d.parentId;
        const visited = new Set<string>([d.id]);
        let depth = 0;
        while (currParent && depth < 12) {
          if (visited.has(currParent)) {
            cyclesCount++;
            break;
          }
          visited.add(currParent);
          currParent = divById.get(currParent)?.parentId || null;
          depth++;
        }
      }
    }

    const countriesMissingDivisions = countriesList
      .filter((c) => !countriesWithDivs.has(c.id))
      .map((c) => c.iso2);

    let unlinkedProfilesCount = 0;
    let unlinkedTasksCount = 0;
    try {
      const [{ count: pCount }, { count: tCount }] = await Promise.all([
        db.from('profiles').select('id', { count: 'exact', head: true }).is('country_id', null),
        db.from('tasks').select('id', { count: 'exact', head: true }).is('country_id', null),
      ]);
      unlinkedProfilesCount = Number(pCount || 0);
      unlinkedTasksCount = Number(tCount || 0);
    } catch {
      // Pre-028 columns absent
    }

    const isHealthy =
      countriesList.length === 22 &&
      countriesMissingDivisions.length === 0 &&
      missingNamesCount === 0 &&
      crossCountryParentCount === 0 &&
      invalidLevelOrderCount === 0 &&
      cyclesCount === 0 &&
      duplicateCodeCount === 0 &&
      duplicateSiblingCount === 0;

    return {
      geoTablesReady: status.ready,
      tablesExist: status.tablesExist,
      seeded: status.seeded,
      sourceMode: status.ready ? 'supabase' : 'dataset_fallback',
      isHealthy,
      totalCountries: countriesList.length,
      activeCountries: countriesList.filter((c) => c.isActive).length,
      totalLevels: levelsList.length,
      totalDivisions: divisionsList.length,
      checks: {
        countriesMissingDivisions,
        missingNamesCount,
        crossCountryParentCount,
        invalidLevelOrderCount,
        cyclesCount,
        duplicateCodeCount,
        duplicateSiblingCount,
        unlinkedProfilesCount,
        unlinkedTasksCount,
      },
      checkedAt: new Date().toISOString(),
    };
  },

  async toggleCountryStatus(countryId: string, isActive: boolean, authToken?: string): Promise<CountryItem> {
    const status = await this.checkGeoTablesStatus(authToken);
    if (!status.tablesExist) {
      throw new Error('جداول النظام الجغرافي غير مثبتة بعد في قاعدة البيانات (يرجى تطبيق الترحيل 028 أولاً).');
    }
    const db = getGeoWriteClient(authToken);
    const { data, error } = await db
      .from('countries')
      .update({ is_active: Boolean(isActive), updated_at: new Date().toISOString() })
      .eq('id', countryId)
      .select('*')
      .single();

    if (error || !data) {
      throw new Error(error?.message || 'فشل تحديث حالة الدولة في قاعدة البيانات.');
    }
    invalidateGeoCache();
    return mapCountryRow(data);
  },

  async createCountryLevel(
    countryId: string,
    payload: { levelOrder: number; nameAr: string; nameEn: string; pluralAr?: string; isRequired?: boolean },
    authToken?: string
  ): Promise<CountryAdminLevel> {
    const status = await this.checkGeoTablesStatus(authToken);
    if (!status.tablesExist) {
      throw new Error('جداول النظام الجغرافي غير مثبتة بعد في قاعدة البيانات (يرجى تطبيق الترحيل 028 أولاً).');
    }
    const levelOrder = Math.round(Number(payload.levelOrder));
    const nameAr = String(payload.nameAr || '').trim();
    const nameEn = String(payload.nameEn || '').trim();
    if (!Number.isFinite(levelOrder) || levelOrder < 1 || levelOrder > 6) {
      throw new Error('ترتيب المستوى الإداري يجب أن يكون بين 1 و 6.');
    }
    if (!nameAr || !nameEn) {
      throw new Error('الاسم العربي والإنجليزي للمستوى الإداري مطلوبان.');
    }

    const db = getGeoWriteClient(authToken);
    const { data, error } = await db
      .from('country_admin_levels')
      .insert({
        id: crypto.randomUUID(),
        country_id: countryId,
        level_order: levelOrder,
        name_ar: nameAr,
        name_en: nameEn,
        plural_ar: payload.pluralAr?.trim() || null,
        is_required: Boolean(payload.isRequired),
        is_active: true,
      })
      .select('*')
      .single();

    if (error || !data) {
      throw new Error(error?.message || 'فشل إضافة المستوى الإداري.');
    }
    invalidateGeoCache();
    return mapLevelRow(data);
  },

  async createDivision(
    payload: {
      countryId: string;
      levelId: string;
      parentId?: string | null;
      nameAr: string;
      nameEn: string;
      code?: string;
      latitude?: number | null;
      longitude?: number | null;
      isActive?: boolean;
    },
    authToken?: string
  ): Promise<AdministrativeDivision> {
    const status = await this.checkGeoTablesStatus(authToken);
    if (!status.tablesExist) {
      throw new Error('جداول النظام الجغرافي غير مثبتة بعد في قاعدة البيانات (يرجى تطبيق الترحيل 028 أولاً).');
    }
    const nameAr = String(payload.nameAr || '').trim();
    const nameEn = String(payload.nameEn || '').trim();
    if (!payload.countryId || !payload.levelId || !nameAr || !nameEn) {
      throw new Error('الدولة والمستوى والاسمان العربي والإنجليزي حقول مطلوبة.');
    }

    // Validate parent belongs to same country if specified
    if (payload.parentId) {
      const parent = await this.getDivisionById(payload.parentId, authToken);
      if (!parent || parent.countryId !== payload.countryId) {
        throw new Error('التقسيم الأب غير موجود أو لا ينتمي لنفس الدولة.');
      }
    }

    const db = getGeoWriteClient(authToken);
    const now = new Date().toISOString();
    const { data, error } = await db
      .from('administrative_divisions')
      .insert({
        id: crypto.randomUUID(),
        country_id: payload.countryId,
        level_id: payload.levelId,
        parent_id: payload.parentId || null,
        code: payload.code?.trim() || null,
        name_ar: nameAr,
        name_en: nameEn,
        latitude: payload.latitude ?? null,
        longitude: payload.longitude ?? null,
        is_active: payload.isActive !== false,
        data_source: 'Admin Manual Entry',
        data_license: 'Platform Verified',
        last_synced_at: now,
      })
      .select('*')
      .single();

    if (error || !data) {
      throw new Error(error?.message || 'فشل إضافة التقسيم الإداري.');
    }
    invalidateGeoCache();
    return mapDivisionRow(data);
  },

  async updateDivision(
    divisionId: string,
    payload: {
      nameAr?: string;
      nameEn?: string;
      code?: string | null;
      latitude?: number | null;
      longitude?: number | null;
      isActive?: boolean;
    },
    authToken?: string
  ): Promise<AdministrativeDivision> {
    const status = await this.checkGeoTablesStatus(authToken);
    if (!status.tablesExist) {
      throw new Error('جداول النظام الجغرافي غير مثبتة بعد في قاعدة البيانات (يرجى تطبيق الترحيل 028 أولاً).');
    }

    const updates: Record<string, any> = { updated_at: new Date().toISOString() };
    if (payload.nameAr !== undefined) {
      const clean = payload.nameAr.trim();
      if (!clean) throw new Error('الاسم العربي لا يمكن أن يكون فارغاً.');
      updates.name_ar = clean;
    }
    if (payload.nameEn !== undefined) {
      const clean = payload.nameEn.trim();
      if (!clean) throw new Error('الاسم الإنجليزي لا يمكن أن يكون فارغاً.');
      updates.name_en = clean;
    }
    if (payload.code !== undefined) updates.code = payload.code ? payload.code.trim() : null;
    if (payload.latitude !== undefined) updates.latitude = payload.latitude;
    if (payload.longitude !== undefined) updates.longitude = payload.longitude;
    if (payload.isActive !== undefined) updates.is_active = Boolean(payload.isActive);

    const db = getGeoWriteClient(authToken);
    const { data, error } = await db
      .from('administrative_divisions')
      .update(updates)
      .eq('id', divisionId)
      .select('*')
      .single();

    if (error || !data) {
      throw new Error(error?.message || 'فشل تحديث التقسيم الإداري.');
    }
    invalidateGeoCache();
    return mapDivisionRow(data);
  },

  async importCountryFromDataset(countryIdOrIso2: string, authToken?: string) {
    const status = await this.checkGeoTablesStatus(authToken);
    if (!status.tablesExist) {
      throw new Error('جداول النظام الجغرافي غير مثبتة بعد في قاعدة البيانات (يرجى تنفيذ الترحيل 028 أولاً).');
    }

    const ds = loadGeoDataset();
    const key = String(countryIdOrIso2 || '').trim();
    const upper = key.toUpperCase();
    const country = ds.countries.find((c) => c.id === key || c.iso2 === upper || c.iso3 === upper);
    if (!country) {
      throw new Error('الدولة المطلوبة غير موجودة في حزمة البيانات الجغرافية الموثقة.');
    }

    const db = getGeoWriteClient(authToken);
    const now = new Date().toISOString();

    // 1. Upsert country row
    const { error: cErr } = await db.from('countries').upsert(
      {
        id: country.id,
        iso2: country.iso2,
        iso3: country.iso3,
        name_ar: country.nameAr,
        name_en: country.nameEn,
        phone_code: country.phoneCode || null,
        flag_emoji: country.flagEmoji,
        is_active: country.isActive,
        sort_order: country.sortOrder,
        data_source: country.dataSource || null,
        data_license: country.dataLicense || null,
        last_synced_at: now,
      },
      { onConflict: 'id' }
    );
    if (cErr) throw new Error(`فشل استيراد بيانات الدولة: ${cErr.message}`);

    // 2. Upsert country administrative levels
    const levels = ds.levelsByCountryId.get(country.id) || [];
    if (levels.length > 0) {
      const { error: lErr } = await db.from('country_admin_levels').upsert(
        levels.map((l) => ({
          id: l.id,
          country_id: l.countryId,
          level_order: l.levelOrder,
          name_ar: l.nameAr,
          name_en: l.nameEn,
          plural_ar: l.pluralAr || null,
          is_required: l.isRequired,
          is_active: l.isActive,
        })),
        { onConflict: 'id' }
      );
      if (lErr) throw new Error(`فشل استيراد المستويات الإدارية: ${lErr.message}`);
    }

    // 3. Upsert divisions ordered by levelOrder ascending so parent rows exist before children
    const divisions = [...(ds.divisionsByCountryId.get(country.id) || [])].sort(
      (a, b) => (a.levelOrder || 1) - (b.levelOrder || 1)
    );

    const byLevelOrder = new Map<number, AdministrativeDivision[]>();
    for (const d of divisions) {
      const ord = d.levelOrder || 1;
      const arr = byLevelOrder.get(ord) || [];
      arr.push(d);
      byLevelOrder.set(ord, arr);
    }

    let importedDivisions = 0;
    for (const ord of Array.from(byLevelOrder.keys()).sort((a, b) => a - b)) {
      const list = byLevelOrder.get(ord) || [];
      for (let i = 0; i < list.length; i += 200) {
        const chunk = list.slice(i, i + 200).map((d) => ({
          id: d.id,
          country_id: d.countryId,
          level_id: d.levelId,
          parent_id: d.parentId || null,
          code: d.code || null,
          geonames_id: d.geonamesId ?? null,
          wikidata_id: d.wikidataId || null,
          name_ar: d.nameAr,
          name_en: d.nameEn,
          latitude: d.latitude ?? null,
          longitude: d.longitude ?? null,
          is_active: d.isActive,
          data_source: d.dataSource || 'Open Geo Dataset',
          data_license: d.dataLicense || 'CC BY 4.0',
          source_url: d.sourceUrl || null,
          last_synced_at: d.lastSyncedAt || now,
        }));
        const { error: dErr } = await db.from('administrative_divisions').upsert(chunk, { onConflict: 'id' });
        if (dErr) throw new Error(`فشل استيراد التقسيمات الإدارية (المستوى ${ord}): ${dErr.message}`);
        importedDivisions += chunk.length;
      }
    }

    invalidateGeoCache();
    return {
      success: true,
      countryId: country.id,
      iso2: country.iso2,
      nameAr: country.nameAr,
      importedLevels: levels.length,
      importedDivisions,
    };
  },
};
