import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { fetchGeoCountries } from './services/geoService.ts';

// Warm the public country selector before the registration modal is opened.
void fetchGeoCountries(false).catch(() => {});

// Proactively check for fresh Service Worker updates when returning to the app (including Android TWA)
if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
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
