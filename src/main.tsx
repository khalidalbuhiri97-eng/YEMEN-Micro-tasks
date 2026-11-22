import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { fetchGeoCountries } from './services/geoService.ts';
import { api } from './api/client.ts';
import { saveCacheItem } from './services/offlineCache.ts';

// Warm non-financial IndexedDB caches silently in background after first paint (never blocks UI or ads)
function scheduleBackgroundCacheWarmup() {
  if (typeof window === 'undefined' || navigator.onLine === false) return;
  const runWarmup = () => {
    void fetchGeoCountries(false).catch(() => {});
    void api
      .getTaskCategories()
      .then((res) => {
        if (Array.isArray(res?.categories)) {
          return saveCacheItem('task_categories_v1', res.categories);
        }
      })
      .catch(() => {});
    void api
      .getTasks({})
      .then((res) => {
        if (Array.isArray(res?.tasks)) {
          return saveCacheItem('tasks_list_all_all', res.tasks);
        }
      })
      .catch(() => {});
  };

  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(runWarmup, { timeout: 2500 });
  } else {
    globalThis.setTimeout(runWarmup, 1200);
  }
}

scheduleBackgroundCacheWarmup();

// Proactively check for fresh Service Worker updates (including inside installed Android TWA)
if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  const hadController = Boolean(navigator.serviceWorker.controller);
  let hasReloadedForUpdate = false;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController && !hasReloadedForUpdate) {
      hasReloadedForUpdate = true;
      window.location.reload();
    }
  });

  const checkForSwUpdate = () => {
    navigator.serviceWorker
      .getRegistration()
      .then((reg) => reg?.update().catch(() => {}))
      .catch(() => {});
  };

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      checkForSwUpdate();
    }
  });
}

createRoot(document.getElementById('root')!).render(<App />);
