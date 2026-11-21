import React from 'react';
import { AdsterraAd } from './AdsterraAd.tsx';

interface HomeAdWindowProps {
  className?: string;
}

/**
 * Homepage Adsterra placement is owned by the app itself.
 * It intentionally does not load admin-managed ad_partner snippets.
 */
export const HomeAdWindow: React.FC<HomeAdWindowProps> = ({ className = '' }) => {
  return (
    <div className={`w-full flex items-center justify-center ${className}`}>
      <AdsterraAd
        placementId="home_clixwall_slot"
        adKey="598beabfde4bf58eec891131c86415eb"
        scriptSrc="https://bicea.org/22/598beabfde4bf58eec891131c86415eb"
        width={300}
        height={250}
      />
    </div>
  );
};
