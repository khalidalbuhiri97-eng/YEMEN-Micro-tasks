/**
 * Yemen Task - IndexedDB Offline UI & Non-Financial Data Cache
 *
 * SECURITY RULE:
 * Never store authentication tokens, passwords, or authoritative financial balances
 * in IndexedDB. Only non-financial UI state, public tasks, settings metadata,
 * ad partner configs, and non-financial display profile fields are persisted here.
 */

const DB_NAME = 'yemen_task_offline_db';
const DB_VERSION = 1;
const STORE_CACHE = 'cache';
const STORE_PREFS = 'ui_prefs';

export interface CachedRecord<T = unknown> {
  key: string;
  value: T;
  updatedAt: string;
}

export interface OfflineProfileUiSummary {
  id: string;
  fullName: string;
  phone: string;
  email?: string;
  emailVerified?: boolean;
  role: 'user' | 'admin' | 'advertiser';
  status: 'active' | 'suspended' | 'under_review' | 'pending';
  referralCode: string;
  city: string;
  countryFlag?: string | null;
  countryNameAr?: string | null;
  locationPath?: string | null;
  createdAt: string;
  updatedAt: string;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openOfflineDb(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || !('indexedDB' in window)) {
    return Promise.resolve(null);
  }
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve) => {
    try {
      const req = window.indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_CACHE)) {
          db.createObjectStore(STORE_CACHE, { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains(STORE_PREFS)) {
          db.createObjectStore(STORE_PREFS, { keyPath: 'key' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });

  return dbPromise;
}

async function idbPut<T>(storeName: string, key: string, value: T): Promise<void> {
  const db = await openOfflineDb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      store.put({ key, value, updatedAt: new Date().toISOString() });
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

async function idbGet<T>(storeName: string, key: string): Promise<CachedRecord<T> | null> {
  const db = await openOfflineDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.get(key);
      req.onsuccess = () => resolve((req.result as CachedRecord<T>) || null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function idbDelete(storeName: string, key: string): Promise<void> {
  const db = await openOfflineDb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function saveCacheItem<T>(key: string, value: T): Promise<void> {
  await idbPut(STORE_CACHE, key, value);
}

export async function getCacheItem<T>(key: string): Promise<CachedRecord<T> | null> {
  return idbGet<T>(STORE_CACHE, key);
}

export async function removeCacheItem(key: string): Promise<void> {
  await idbDelete(STORE_CACHE, key);
}

export async function saveUiPref<T>(key: string, value: T): Promise<void> {
  await idbPut(STORE_PREFS, key, value);
}

export async function getUiPref<T>(key: string): Promise<T | null> {
  const rec = await idbGet<T>(STORE_PREFS, key);
  return rec ? rec.value : null;
}

export async function clearUserUiCache(): Promise<void> {
  await Promise.all([
    idbDelete(STORE_CACHE, 'profile_ui'),
    idbDelete(STORE_CACHE, 'notifications_ui'),
  ]);
  try {
    localStorage.removeItem('kasb_profile_ui');
  } catch {
    // ignore storage limits
  }
}
