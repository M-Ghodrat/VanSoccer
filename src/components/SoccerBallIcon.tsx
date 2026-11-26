import React, { useId } from 'react';

interface SoccerBallIconProps {
  className?: string;
  title?: string;
}

/**
 * Classical 32-panel Telstar-style soccer ball SVG with crisp black pentagons,
 * hexagonal panel seams, and subtle 3D spherical shading.
 */
export const SoccerBallIcon: React.FC<SoccerBallIconProps> = ({
  className = 'w-4 h-4',
  title,
}) => {
  const uid = useId().replace(/:/g, '');
  const gradId = `ball-sphere-${uid}`;
  const clipId = `ball-clip-${uid}`;

  return (
    <svg
      viewBox="0 0 32 32"
      className={`inline-block shrink-0 ${className}`}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      {title && <title>{title}</title>}
      <defs>
        <radialGradient id={gradId} cx="35%" cy="28%" r="72%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="62%" stopColor="#f1f5f9" />
          <stop offset="100%" stopColor="#cbd5e1" />
        </radialGradient>
        <clipPath id={clipId}>
          <circle cx="16" cy="16" r="14.2" />
        </clipPath>
      </defs>

      {/* Base White Leather Sphere */}
      <circle cx="16" cy="16" r="14.4" fill={`url(#${gradId})`} />

      {/* Clipped Classical Telstar Panels & Seams */}
      <g clipPath={`url(#${clipId})`}>
        {/* Seam lines radiating from center pentagon to outer pentagons */}
        <g stroke="#334155" strokeWidth="1.05" strokeLinecap="round" strokeLinejoin="round" fill="none">
          <line x1="16" y1="10.4" x2="16" y2="5.1" />
          <line x1="21.3" y1="14.3" x2="26.2" y2="12.6" />
          <line x1="19.3" y1="20.5" x2="22.4" y2="24.9" />
          <line x1="12.7" y1="20.5" x2="9.6" y2="24.9" />
          <line x1="10.7" y1="14.3" x2="5.8" y2="12.6" />

          {/* Secondary hexagonal panel seams connecting perimeter pentagons */}
          <path d="M12.3 3.2 L6.5 7.4" />
          <path d="M19.7 3.2 L25.5 7.4" />
          <path d="M28.6 15.8 L26.2 23.0" />
          <path d="M19.6 28.4 L12.4 28.4" />
          <path d="M3.4 15.8 L5.8 23.0" />
        </g>

        {/* Center Black Pentagon */}
        <polygon
          points="16,10.3 21.4,14.2 19.3,20.6 12.7,20.6 10.6,14.2"
          fill="#111827"
          stroke="#0f172a"
          strokeWidth="0.6"
          strokeLinejoin="round"
        />

        {/* 5 Perimeter Black Pentagons (Telstar pattern) */}
        {/* Top */}
        <polygon points="16,5.2 20.1,2.9 18.8,-0.6 13.2,-0.6 11.9,2.9" fill="#111827" />
        {/* Top-Right */}
        <polygon points="26.1,12.5 29.4,16.1 32.5,12.4 30.2,7.1 25.4,7.4" fill="#111827" />
        {/* Bottom-Right */}
        <polygon points="22.2,24.6 19.4,28.6 24.1,31.4 28.4,27.2 26.3,22.9" fill="#111827" />
        {/* Bottom-Left */}
        <polygon points="9.8,24.6 12.6,28.6 7.9,31.4 3.6,27.2 5.7,22.9" fill="#111827" />
        {/* Top-Left */}
        <polygon points="5.9,12.5 2.6,16.1 -0.5,12.4 1.8,7.1 6.6,7.4" fill="#111827" />

        {/* Subtle glossy specular highlight on top-left */}
        <ellipse
          cx="11.4"
          cy="9.2"
          rx="4.6"
          ry="2.5"
          transform="rotate(-28 11.4 9.2)"
          fill="#ffffff"
          opacity="0.32"
        />
      </g>

      {/* Crisp Outer Rim */}
      <circle
        cx="16"
        cy="16"
        r="14.3"
        fill="none"
        stroke="#0f172a"
        strokeWidth="1.6"
      />
    </svg>
  );
};
