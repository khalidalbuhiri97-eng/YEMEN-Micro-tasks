import { api } from '../api/client.ts';
import type {
  AdministrativeDivision,
  CountryAdminLevel,
  CountryItem,
  GeoPathItem,
} from '../types/index.ts';

let countriesCache: CountryItem[] | null = null;
let allCountriesCache: CountryItem[] | null = null;
let geoTablesReadyCache: boolean | undefined = undefined;
const levelsCache = new Map<string, CountryAdminLevel[]>();
const divisionsCache = new Map<string, AdministrativeDivision[]>();
const pathCache = new Map<string, { path: GeoPathItem[]; division?: AdministrativeDivision }>();

export function invalidateGeoClientCache(): void {
  countriesCache = null;
  allCountriesCache = null;
  geoTablesReadyCache = undefined;
  levelsCache.clear();
  divisionsCache.clear();
  pathCache.clear();
}

export async function fetchGeoCountries(includeInactive = false): Promise<{
  countries: CountryItem[];
  geoTablesReady: boolean;
}> {
  if (!includeInactive && countriesCache) {
    return { countries: countriesCache, geoTablesReady: geoTablesReadyCache ?? true };
  }
  if (includeInactive && allCountriesCache) {
    return { countries: allCountriesCache, geoTablesReady: geoTablesReadyCache ?? true };
  }

  const res = await api.getGeoCountries(includeInactive);
  const list: CountryItem[] = Array.isArray(res?.countries) ? res.countries : [];
  geoTablesReadyCache = res?.geoTablesReady !== false;

  if (includeInactive) {
    allCountriesCache = list;
  } else {
    countriesCache = list;
  }
  return { countries: list, geoTablesReady: geoTablesReadyCache };
}

export async function fetchGeoCountryLevels(countryId: string): Promise<CountryAdminLevel[]> {
  if (!countryId) return [];
  const cached = levelsCache.get(countryId);
  if (cached) return cached;

  const res = await api.getGeoCountryLevels(countryId);
  const levels: CountryAdminLevel[] = Array.isArray(res?.levels) ? res.levels : [];
  levelsCache.set(countryId, levels);
  return levels;
}

export async function fetchGeoDivisions(params: {
  countryId: string;
  parentId?: string | null;
  levelId?: string;
  search?: string;
  includeInactive?: boolean;
  limit?: number;
}): Promise<AdministrativeDivision[]> {
  if (!params.countryId) return [];
  const cleanSearch = params.search?.trim() || '';
  const cacheKey = `${params.countryId}::${params.parentId || 'ROOT'}::${params.levelId || 'ALL'}::${params.includeInactive ? 'ALL' : 'ACT'}`;

  if (!cleanSearch && !params.limit) {
    const cached = divisionsCache.get(cacheKey);
    if (cached) return cached;
  }

  const res = await api.getGeoDivisions({
    countryId: params.countryId,
    parentId: params.parentId || undefined,
    levelId: params.levelId,
    search: cleanSearch || undefined,
    includeInactive: params.includeInactive,
    limit: params.limit,
  });
  const divisions: AdministrativeDivision[] = Array.isArray(res?.divisions) ? res.divisions : [];

  if (!cleanSearch && !params.limit) {
    divisionsCache.set(cacheKey, divisions);
  }
  return divisions;
}

export async function fetchGeoDivisionPath(
  divisionId: string
): Promise<{ path: GeoPathItem[]; division?: AdministrativeDivision }> {
  if (!divisionId) return { path: [] };
  const cached = pathCache.get(divisionId);
  if (cached) return cached;

  const res = await api.getGeoDivisionPath(divisionId);
  const payload = {
    path: Array.isArray(res?.path) ? res.path : [],
    division: res?.division,
  };
  pathCache.set(divisionId, payload);
  return payload;
}
