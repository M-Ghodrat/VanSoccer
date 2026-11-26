import React, { useId } from 'react';
import { RADAR_STAT_KEYS, RADAR_STAT_META, RadarStatKey } from '../types';

export interface PlayerRadarValues {
  attack: number | null;
  technique: number | null;
  stamina: number | null;
  defense: number | null;
  speed: number | null;
  physics: number | null;
}

interface PlayerStatsRadarProps {
  values: PlayerRadarValues;
  size?: number;
  variant?: 'light' | 'dark';
}

const LEVELS = [0.25, 0.5, 0.75, 1];

export const PlayerStatsRadar: React.FC<PlayerStatsRadarProps> = ({
  values,
  size = 216,
  variant = 'light',
}) => {
  const uid = useId().replace(/:/g, '');
  const fillGradId = `radar-fill-${uid}`;

  const vbW = 240;
  const vbH = 216;
  const cx = vbW / 2;
  const cy = vbH / 2 + 2;
  const maxR = 66;
  const labelR = 85;

  const getVertex = (index: number, radius: number) => {
    const angle = (-Math.PI / 2) + (index * Math.PI * 2) / 6;
    return {
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
    };
  };

  const makeHexPoints = (scale: number) =>
    RADAR_STAT_KEYS.map((_, idx) => {
      const pt = getVertex(idx, maxR * scale);
      return `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`;
    }).join(' ');

  const hasAnyValue = RADAR_STAT_KEYS.some((key) => values[key] !== null);

  const statPoints = RADAR_STAT_KEYS.map((key: RadarStatKey, idx: number) => {
    const raw = values[key];
    const clamped = raw === null ? 0 : Math.max(0, Math.min(100, raw));
    const pt = getVertex(idx, (clamped / 100) * maxR);
    return { key, raw, clamped, ...pt };
  });

  const statPolygonPoints = statPoints
    .map((pt) => `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`)
    .join(' ');

  const isDark = variant === 'dark';
  const gridStroke = isDark ? 'rgba(255,255,255,0.16)' : '#e2e8f0';
  const outerStroke = isDark ? 'rgba(255,255,255,0.32)' : '#cbd5e1';
  const spokeStroke = isDark ? 'rgba(255,255,255,0.14)' : '#e2e8f0';
  const labelFill = isDark ? '#cbd5e1' : '#64748b';
  const valFill = isDark ? '#ffffff' : '#0f172a';
  const polyStroke = isDark ? '#34d399' : '#059669';

  return (
    <svg
      viewBox={`0 0 ${vbW} ${vbH}`}
      style={{ width: size, height: Math.round((size * vbH) / vbW) }}
      className="mx-auto block select-none overflow-visible"
      role="img"
      aria-label="Player 6-factor stats hexagon radar"
    >
      <defs>
        <linearGradient id={fillGradId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={isDark ? '#34d399' : '#10b981'} stopOpacity={isDark ? 0.45 : 0.34} />
          <stop offset="100%" stopColor={isDark ? '#38bdf8' : '#0d9488'} stopOpacity={isDark ? 0.25 : 0.18} />
        </linearGradient>
      </defs>

      {/* Concentric Hexagonal Guide Rings */}
      {LEVELS.map((lvl, idx) => (
        <polygon
          key={lvl}
          points={makeHexPoints(lvl)}
          fill={idx === LEVELS.length - 1 ? (isDark ? 'rgba(15,23,42,0.35)' : '#f8fafc') : 'none'}
          stroke={idx === LEVELS.length - 1 ? outerStroke : gridStroke}
          strokeWidth={idx === LEVELS.length - 1 ? 1.5 : 0.9}
        />
      ))}

      {/* 6 Radial Axis Spokes */}
      {RADAR_STAT_KEYS.map((key, idx) => {
        const outer = getVertex(idx, maxR);
        return (
          <line
            key={key}
            x1={cx}
            y1={cy}
            x2={outer.x}
            y2={outer.y}
            stroke={spokeStroke}
            strokeWidth={0.9}
          />
        );
      })}

      {/* Live Stat Polygon (matches outer hexagon stroke width, no corner dots) */}
      {hasAnyValue && (
        <polygon
          points={statPolygonPoints}
          fill={`url(#${fillGradId})`}
          stroke={polyStroke}
          strokeWidth={1.5}
          strokeLinejoin="round"
          className="transition-all duration-150"
        />
      )}

      {/* Vertex Labels & Tabular Numeric Readouts */}
      {RADAR_STAT_KEYS.map((key, idx) => {
        const pt = getVertex(idx, labelR);
        const raw = values[key];
        const meta = RADAR_STAT_META[key];
        const textAnchor =
          idx === 0 || idx === 3
            ? 'middle'
            : idx === 1 || idx === 2
              ? 'start'
              : 'end';
        const dx = idx === 1 || idx === 2 ? -6 : idx === 4 || idx === 5 ? 6 : 0;
        const dy = idx === 0 ? -4 : idx === 3 ? 6 : 0;

        return (
          <g key={key} transform={`translate(${(pt.x + dx).toFixed(1)}, ${(pt.y + dy).toFixed(1)})`}>
            <text
              x={0}
              y={-3}
              textAnchor={textAnchor}
              fill={labelFill}
              fontSize="9.5"
              fontWeight="700"
              letterSpacing="0.06em"
            >
              {meta.short}
            </text>
            <text
              x={0}
              y={9}
              textAnchor={textAnchor}
              fill={valFill}
              fontSize="11"
              fontWeight="800"
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {raw !== null ? Math.round(raw) : '—'}
            </text>
          </g>
        );
      })}
    </svg>
  );
};
