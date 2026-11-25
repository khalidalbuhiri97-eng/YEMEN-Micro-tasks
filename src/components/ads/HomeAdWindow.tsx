import React from 'react';
import { SandboxedAdSlot } from './SandboxedAdSlot.tsx';

export interface HomeAdWindowProps {
  placementKey?: string;
  className?: string;
}

export const HomeAdWindow: React.FC<HomeAdWindowProps> = ({
  placementKey = 'home_clixwall_slot',
  className = '',
}) => {
  return (
    <SandboxedAdSlot
      placementKey={placementKey}
      compact
      emptyPlaceholderText="مساحة إعلانية معزولة جاهزة للعرض عند تفعيل الشريك الإعلاني"
      className={className}
    />
  );
};
