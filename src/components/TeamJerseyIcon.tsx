import React, { useId } from 'react';
import { normalizeStandardTeamColor, StandardTeamColor } from '../types';

interface TeamJerseyIconProps {
  color: string;
  size?: number;
  className?: string;
  onPitch?: boolean;
  highlighted?: boolean;
}

export interface RealisticKitPalette {
  light: string;
  mid: string;
  deep: string;
  yoke: string;
  sleeveShade: string;
  jacquard: string;
  jacquardDark: string;
  collarBase: string;
  collarShade: string;
  collarTipping: string;
  collarGusset: string;
  collarInnerDark: string;
  collarInnerLight: string;
  neckTape: string;
  shoulderStripe: string;
  shoulderStripeEdge: string;
  cuffBase: string;
  cuffTipping: string;
  seamHighlight: string;
  seamShadow: string;
  rimLight: string;
  crestRim: string;
  crestBody: string;
  crestSash: string;
  brandMark: string;
}

export const REALISTIC_KIT_PALETTES: Record<StandardTeamColor, RealisticKitPalette> = {
  Red: {
    light: '#f03e42',
    mid: '#cf1922',
    deep: '#870e15',
    yoke: '#b9151d',
    sleeveShade: '#7a0c13',
    jacquard: 'rgba(255, 255, 255, 0.11)',
    jacquardDark: 'rgba(85, 5, 10, 0.16)',
    collarBase: '#ffffff',
    collarShade: '#cbd5e1',
    collarTipping: '#dc2626',
    collarGusset: '#f8fafc',
    collarInnerDark: '#52080d',
    collarInnerLight: '#7f1118',
    neckTape: '#f8fafc',
    shoulderStripe: 'rgba(255, 255, 255, 0.94)',
    shoulderStripeEdge: 'rgba(226, 232, 240, 0.45)',
    cuffBase: '#ffffff',
    cuffTipping: '#dc2626',
    seamHighlight: 'rgba(255, 255, 255, 0.28)',
    seamShadow: 'rgba(69, 4, 9, 0.35)',
    rimLight: 'rgba(255, 228, 230, 0.48)',
    crestRim: '#f8fafc',
    crestBody: '#991b1b',
    crestSash: '#e2e8f0',
    brandMark: '#ffffff',
  },
  Blue: {
    light: '#3b82f6',
    mid: '#1d4ed8',
    deep: '#152b75',
    yoke: '#1e40af',
    sleeveShade: '#11225e',
    jacquard: 'rgba(255, 255, 255, 0.11)',
    jacquardDark: 'rgba(15, 23, 66, 0.18)',
    collarBase: '#ffffff',
    collarShade: '#cbd5e1',
    collarTipping: '#38bdf8',
    collarGusset: '#f1f5f9',
    collarInnerDark: '#0c1945',
    collarInnerLight: '#172e7a',
    neckTape: '#bae6fd',
    shoulderStripe: 'rgba(240, 249, 255, 0.95)',
    shoulderStripeEdge: 'rgba(125, 211, 252, 0.5)',
    cuffBase: '#ffffff',
    cuffTipping: '#38bdf8',
    seamHighlight: 'rgba(191, 219, 254, 0.3)',
    seamShadow: 'rgba(12, 25, 69, 0.38)',
    rimLight: 'rgba(219, 234, 254, 0.48)',
    crestRim: '#f8fafc',
    crestBody: '#1e3a8a',
    crestSash: '#7dd3fc',
    brandMark: '#ffffff',
  },
  Black: {
    // Strictly carbon, obsidian, white, silver & platinum-gray — zero yellow/gold
    light: '#434650',
    mid: '#23252c',
    deep: '#101116',
    yoke: '#2c2f38',
    sleeveShade: '#0c0d11',
    jacquard: 'rgba(226, 232, 240, 0.085)',
    jacquardDark: 'rgba(0, 0, 0, 0.28)',
    collarBase: '#e2e8f0',
    collarShade: '#94a3b8',
    collarTipping: '#334155',
    collarGusset: '#cbd5e1',
    collarInnerDark: '#090a0d',
    collarInnerLight: '#1e2028',
    neckTape: '#cbd5e1',
    shoulderStripe: 'rgba(226, 232, 240, 0.9)',
    shoulderStripeEdge: 'rgba(148, 163, 184, 0.45)',
    cuffBase: '#e2e8f0',
    cuffTipping: '#475569',
    seamHighlight: 'rgba(226, 232, 240, 0.24)',
    seamShadow: 'rgba(0, 0, 0, 0.45)',
    rimLight: 'rgba(226, 232, 240, 0.4)',
    crestRim: '#e2e8f0',
    crestBody: '#1e293b',
    crestSash: '#f8fafc',
    brandMark: '#e2e8f0',
  },
  Yellow: {
    light: '#fef08a',
    mid: '#facc15',
    deep: '#b87d06',
    yoke: '#eab308',
    sleeveShade: '#a16207',
    jacquard: 'rgba(255, 255, 255, 0.26)',
    jacquardDark: 'rgba(133, 77, 14, 0.14)',
    collarBase: '#065f46',
    collarShade: '#064e3b',
    collarTipping: '#ffffff',
    collarGusset: '#047857',
    collarInnerDark: '#693909',
    collarInnerLight: '#9a5a0a',
    neckTape: '#065f46',
    shoulderStripe: 'rgba(6, 95, 70, 0.92)',
    shoulderStripeEdge: 'rgba(255, 255, 255, 0.55)',
    cuffBase: '#065f46',
    cuffTipping: '#ffffff',
    seamHighlight: 'rgba(255, 255, 255, 0.48)',
    seamShadow: 'rgba(113, 63, 18, 0.26)',
    rimLight: 'rgba(254, 249, 195, 0.65)',
    crestRim: '#ffffff',
    crestBody: '#065f46',
    crestSash: '#fef08a',
    brandMark: '#065f46',
  },
};

// Athletic tailored pro soccer jersey silhouette (64x64 viewBox, zero black outer border)
const JERSEY_SILHOUETTE_PATH =
  'M22.5 9.6C25.2 14.8 28.4 17.4 32 17.4C35.6 17.4 38.8 14.8 41.5 9.6C45.8 10.6 50.1 12.6 53.2 15.8L59.8 26.2C60.4 27.1 60.1 28.3 59.2 28.9L51.8 33.8C50.9 34.4 49.7 34.1 49.2 33.2L46.8 29.2L46.1 55C46.1 56.5 44.9 57.6 43.4 57.6H20.6C19.1 57.6 17.9 56.5 17.9 55L17.2 29.2L14.8 33.2C14.3 34.1 13.1 34.4 12.2 33.8L4.8 28.9C3.9 28.3 3.6 27.1 4.2 26.2L10.8 15.8C13.9 12.6 18.2 10.6 22.5 9.6Z';

export const TeamJerseyIcon: React.FC<TeamJerseyIconProps> = ({
  color,
  size = 28,
  className = '',
  onPitch = false,
  highlighted = false,
}) => {
  const uid = useId().replace(/:/g, '');
  const std = normalizeStandardTeamColor(color);
  const k = REALISTIC_KIT_PALETTES[std];

  const bodyGradId = `pj-body-${uid}`;
  const sheenGradId = `pj-sheen-${uid}`;
  const innerCollarGradId = `pj-inner-${uid}`;
  const collarRibGradId = `pj-rib-${uid}`;
  const clipId = `pj-clip-${uid}`;

  const shadowStyle = highlighted
    ? 'drop-shadow(0 0 5px rgba(52,211,153,0.95)) drop-shadow(0 2px 5px rgba(0,0,0,0.42))'
    : onPitch
      ? 'drop-shadow(0 2px 5px rgba(0,0,0,0.42))'
      : 'drop-shadow(0 1px 2.5px rgba(15,23,42,0.24))';

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ filter: shadowStyle }}
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={bodyGradId} x1="32" y1="9" x2="32" y2="58" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={k.light} />
          <stop offset="46%" stopColor={k.mid} />
          <stop offset="100%" stopColor={k.deep} />
        </linearGradient>
        <radialGradient id={sheenGradId} cx="38%" cy="28%" r="68%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.24" />
          <stop offset="52%" stopColor="#ffffff" stopOpacity="0.03" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0.22" />
        </radialGradient>
        <linearGradient id={innerCollarGradId} x1="32" y1="7" x2="32" y2="18" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={k.collarInnerDark} />
          <stop offset="100%" stopColor={k.collarInnerLight} />
        </linearGradient>
        <linearGradient id={collarRibGradId} x1="32" y1="8.5" x2="32" y2="19.5" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={k.collarBase} />
          <stop offset="100%" stopColor={k.collarShade} />
        </linearGradient>
        <clipPath id={clipId}>
          <path d={JERSEY_SILHOUETTE_PATH} />
        </clipPath>
      </defs>

      {/* Sculpted Back Interior Collar + Woven Neck Tape */}
      <path
        d="M22.2 9.6C25.2 7.8 28.5 7.1 32 7.1C35.5 7.1 38.8 7.8 41.8 9.6C39.2 15.2 35.8 18 32 18C28.2 18 24.8 15.2 22.2 9.6Z"
        fill={`url(#${innerCollarGradId})`}
      />
      <path
        d="M23.5 9.8C26.2 8.6 29 8.1 32 8.1C35 8.1 37.8 8.6 40.5 9.8"
        stroke={k.neckTape}
        strokeWidth="1.2"
        strokeLinecap="round"
        opacity="0.72"
      />
      <rect x="29.5" y="9.2" width="5" height="2" rx="0.6" fill={k.collarBase} opacity="0.45" />

      {/* Main Tailored Pro Jersey Silhouette (Zero Black Border) */}
      <path d={JERSEY_SILHOUETTE_PATH} fill={`url(#${bodyGradId})`} />

      {/* Clipped Realistic Pro Jersey Construction */}
      <g clipPath={`url(#${clipId})`}>
        {/* Tonal Shoulder Yoke Panel */}
        <path
          d="M22.5 9.6C25.2 14.8 28.4 17.4 32 17.4C35.6 17.4 38.8 14.8 41.5 9.6L55 15L49 23.5C43.5 19.8 38 18.4 32 18.4C26 18.4 20.5 19.8 15 23.5L9 15L22.5 9.6Z"
          fill={k.yoke}
          opacity="0.55"
        />

        {/* Engineered Jacquard Chevron & Vertical Micro-Weave Pattern */}
        <path
          d="M16 25L32 33L48 25V29L32 37L16 29V25ZM16 35L32 43L48 35V39L32 47L16 39V35ZM16 45L32 53L48 45V49L32 57L16 49V45Z"
          fill={k.jacquard}
        />
        <rect x="21.5" y="12" width="2.4" height="46" fill={k.jacquardDark} />
        <rect x="27.2" y="15" width="2.4" height="43" fill={k.jacquard} />
        <rect x="34.4" y="15" width="2.4" height="43" fill={k.jacquard} />
        <rect x="40.1" y="12" width="2.4" height="46" fill={k.jacquardDark} />

        {/* Athletic Side Mesh Panels & Drape Shadows */}
        <path d="M16.5 28C20.5 34 21.5 45 20.8 58H16.5V28Z" fill={k.deep} opacity="0.5" />
        <path d="M47.5 28C43.5 34 42.5 45 43.2 58H47.5V28Z" fill={k.deep} opacity="0.5" />
        <path d="M11 16L18 30.5L4 28.5L11 16Z" fill={k.sleeveShade} opacity="0.34" />
        <path d="M53 16L46 30.5L60 28.5L53 16Z" fill={k.sleeveShade} opacity="0.34" />

        {/* Subtle Fabric Fold Highlights Across Chest */}
        <path
          d="M19 31C23.5 29.5 27.5 28.8 31 29.2"
          stroke="#ffffff"
          strokeOpacity="0.14"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
        <path
          d="M45 31C40.5 29.5 36.5 28.8 33 29.2"
          stroke="#ffffff"
          strokeOpacity="0.1"
          strokeWidth="2"
          strokeLinecap="round"
        />

        {/* 3D Stadium Lighting Sheen */}
        <rect x="0" y="0" width="64" height="64" fill={`url(#${sheenGradId})`} />

        {/* Sunlit Top Shoulder Rim-Light (Replaces Flat Cartoon Border) */}
        <path
          d="M4.6 26.2L11 16C14 12.9 18.2 10.9 22.4 9.9M41.6 9.9C45.8 10.9 50 12.9 53 16L59.4 26.2"
          stroke={k.rimLight}
          strokeWidth="1.2"
          strokeLinecap="round"
        />

        {/* Curved Raglan Shoulder Seams (Stitched Highlight + Shadow Pair) */}
        <path
          d="M22.2 11C19.8 17.8 18.2 23.6 17.2 29.4"
          stroke={k.seamShadow}
          strokeWidth="1.4"
          strokeLinecap="round"
        />
        <path
          d="M23.1 11.4C20.7 18.1 19.1 23.8 18.1 29.6"
          stroke={k.seamHighlight}
          strokeWidth="0.85"
          strokeLinecap="round"
        />
        <path
          d="M41.8 11C44.2 17.8 45.8 23.6 46.8 29.4"
          stroke={k.seamShadow}
          strokeWidth="1.4"
          strokeLinecap="round"
        />
        <path
          d="M40.9 11.4C43.3 18.1 44.9 23.8 45.9 29.6"
          stroke={k.seamHighlight}
          strokeWidth="0.85"
          strokeLinecap="round"
        />

        {/* Pro 3-Stripe Athletic Shoulder Trim */}
        <path d="M21 10.5L9.2 19.2" stroke={k.shoulderStripe} strokeWidth="1.35" strokeLinecap="round" />
        <path d="M19.7 12.6L7.9 21.4" stroke={k.shoulderStripe} strokeWidth="1.2" strokeLinecap="round" opacity="0.88" />
        <path d="M18.4 14.8L6.8 23.5" stroke={k.shoulderStripeEdge} strokeWidth="1.05" strokeLinecap="round" />
        <path d="M43 10.5L54.8 19.2" stroke={k.shoulderStripe} strokeWidth="1.35" strokeLinecap="round" />
        <path d="M44.3 12.6L56.1 21.4" stroke={k.shoulderStripe} strokeWidth="1.2" strokeLinecap="round" opacity="0.88" />
        <path d="M45.6 14.8L57.2 23.5" stroke={k.shoulderStripeEdge} strokeWidth="1.05" strokeLinecap="round" />

        {/* Tailored Sleeve Cuffs with Dual Tipping */}
        <path d="M4.2 26.8L13.8 33.2" stroke={k.cuffBase} strokeWidth="3.2" strokeLinecap="round" />
        <path d="M5.1 26.3L14.2 32.3" stroke={k.cuffTipping} strokeWidth="0.95" strokeLinecap="round" />
        <path d="M59.8 26.8L50.2 33.2" stroke={k.cuffBase} strokeWidth="3.2" strokeLinecap="round" />
        <path d="M58.9 26.3L49.8 32.3" stroke={k.cuffTipping} strokeWidth="0.95" strokeLinecap="round" />

        {/* Collar Cast-Shadow onto Chest */}
        <path
          d="M20.8 10.4C24.2 16.8 27.9 19.8 32 19.8C36.1 19.8 39.8 16.8 43.2 10.4"
          stroke="#000000"
          strokeOpacity="0.26"
          strokeWidth="2.8"
          strokeLinecap="round"
        />

        {/* Sculpted 3D Ribbed Collar Band + Center Ribbed V-Gusset + Tipping */}
        <path
          d="M21.2 9.4C24.4 15.2 28 18.2 32 18.2C36 18.2 39.6 15.2 42.8 9.4L40.4 8.6C37.9 13.6 35 16.1 32 16.1C29 16.1 26.1 13.6 23.6 8.6L21.2 9.4Z"
          fill={`url(#${collarRibGradId})`}
        />
        {/* Ribbed Throat Gusset Insert */}
        <path
          d="M28.6 16.8L32 20.6L35.4 16.8C34.2 17.5 33.1 17.8 32 17.8C30.9 17.8 29.8 17.5 28.6 16.8Z"
          fill={k.collarGusset}
        />
        {/* Fine Woven Tipping Stripe inside Collar Rib */}
        <path
          d="M22.2 9.4C25.1 14.6 28.4 17.2 32 17.2C35.6 17.2 38.9 14.6 41.8 9.4"
          stroke={k.collarTipping}
          strokeWidth="1.05"
          strokeLinecap="round"
        />
        {/* Double-Needle Coverstitch Seam Below Collar */}
        <path
          d="M20.4 11.4C23.8 17.9 27.7 21 32 21C36.3 21 40.2 17.9 43.6 11.4"
          stroke={k.seamHighlight}
          strokeWidth="0.7"
          strokeDasharray="1.8 1.5"
          strokeLinecap="round"
          opacity="0.7"
        />

        {/* Embroidered Woven Club Shield Crest (Player Left Chest) */}
        <g>
          <path
            d="M36.5 23.2H42.3V27.4C42.3 29.4 40.8 30.8 39.4 31.4C38 30.8 36.5 29.4 36.5 27.4V23.2Z"
            fill="#000000"
            fillOpacity="0.25"
            transform="translate(0.4, 0.7)"
          />
          <path
            d="M36.5 23.2H42.3V27.4C42.3 29.4 40.8 30.8 39.4 31.4C38 30.8 36.5 29.4 36.5 27.4V23.2Z"
            fill={k.crestRim}
          />
          <path
            d="M37.3 24H41.5V27.1C41.5 28.6 40.4 29.7 39.4 30.2C38.4 29.7 37.3 28.6 37.3 27.1V24Z"
            fill={k.crestBody}
          />
          <path d="M37.4 27.8L41.4 24.4V26.2L38.3 28.9L37.4 27.8Z" fill={k.crestSash} opacity="0.92" />
        </g>

        {/* Minimalist Pro Kit Manufacturer Mark (Player Right Chest) */}
        <path
          d="M22.2 26.8L26.6 25.1M23.2 28L26.4 26.8"
          stroke={k.brandMark}
          strokeWidth="1.25"
          strokeLinecap="round"
          opacity="0.9"
        />

        {/* Authentic Lower Hem Stitched Trim & Tiny Woven Jock Tag */}
        <line
          x1="18"
          y1="55.6"
          x2="46"
          y2="55.6"
          stroke={k.seamHighlight}
          strokeWidth="0.7"
          strokeDasharray="2 1.5"
          opacity="0.65"
        />
        <rect x="40.5" y="52.6" width="3.8" height="2" rx="0.5" fill={k.collarBase} opacity="0.65" />
      </g>
    </svg>
  );
};
