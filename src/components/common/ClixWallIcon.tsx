import React from 'react';

interface ClixWallIconProps {
  className?: string;
  size?: number;
}

export const ClixWallIcon: React.FC<ClixWallIconProps> = ({ className = 'w-6 h-6', size = 24 }) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="ClixWall Icon"
    >
      <defs>
        <linearGradient id="cw-bg-grad" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop stopColor="#0284C7" />
          <stop offset="0.5" stopColor="#2563EB" />
          <stop offset="1" stopColor="#7C3AED" />
        </linearGradient>
        <linearGradient id="cw-gold-grad" x1="12" y1="12" x2="26" y2="22" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FDE047" />
          <stop offset="1" stopColor="#F59E0B" />
        </linearGradient>
        <filter id="cw-shadow" x="0" y="1" width="32" height="31" filterUnits="userSpaceOnUse">
          <feDropShadow dx="0" dy="1.5" stdDeviation="1.5" floodColor="#0F172A" floodOpacity="0.25" />
        </filter>
      </defs>

      {/* Rounded Container */}
      <rect x="1.5" y="1.5" width="29" height="29" rx="8" fill="url(#cw-bg-grad)" filter="url(#cw-shadow)" />

      {/* Subtle Inner Glow Border */}
      <rect x="2" y="2" width="28" height="28" rx="7.5" stroke="white" strokeOpacity="0.2" strokeWidth="1" />

      {/* Wall Bricks / Offer Tiles */}
      {/* Row 1 */}
      <rect x="5.5" y="6" width="9" height="4.5" rx="1.5" fill="white" fillOpacity="0.9" />
      <rect x="16" y="6" width="10.5" height="4.5" rx="1.5" fill="white" fillOpacity="0.9" />

      {/* Row 2 - Active Reward Tile */}
      <rect x="5.5" y="12" width="6" height="4.5" rx="1.5" fill="white" fillOpacity="0.65" />
      <rect x="13" y="12" width="13.5" height="4.5" rx="1.5" fill="url(#cw-gold-grad)" />

      {/* Row 3 */}
      <rect x="5.5" y="18" width="11" height="4.5" rx="1.5" fill="white" fillOpacity="0.9" />
      <rect x="18" y="18" width="8.5" height="4.5" rx="1.5" fill="white" fillOpacity="0.65" />

      {/* Stylized Cursor / Click Pointer */}
      <path
        d="M17.5 13.5L25 21L21.5 21.5L24 26.5L21.5 27.5L19 22.5L16.5 25L17.5 13.5Z"
        fill="#0F172A"
        stroke="white"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
};
