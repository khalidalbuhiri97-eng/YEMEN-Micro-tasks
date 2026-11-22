import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { fetchGeoCountries } from './services/geoService.ts';

// Warm the public country selector before the registration modal is opened.
void fetchGeoCountries(false).catch(() => {});

createRoot(document.getElementById('root')!).render(<App />);
