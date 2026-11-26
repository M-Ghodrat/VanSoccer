import React, { useEffect, useId, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowDownRight,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  Hand,
  RotateCcw,
  Users,
  X,
} from 'lucide-react';
import {
  FormationPlayerSlot,
  FormationTeam,
  getTeamColorPalette,
  GoalieOption,
  normalizeSkillArrowThresholds,
  normalizeStandardTeamColor,
  PlayerProfile,
  SkillArrowThresholds,
  SOCCER_POSITIONS,
  StandardTeamColor,
  TeamFormation,
} from '../types';
import { SoccerBallIcon } from './SoccerBallIcon';
import { REALISTIC_KIT_PALETTES, TeamJerseyIcon } from './TeamJerseyIcon';

interface SoccerPitchProps {
  formation: TeamFormation;
  originalFormation?: TeamFormation | null;
  playersById: Map<string, PlayerProfile>;
  bestPositionsById?: Map<string, string[]>;
  editable?: boolean;
  showRatings?: boolean;
  showPreferredPositions?: boolean;
  showTeamHeader?: boolean;
  showAvgAge?: boolean;
  showRosterTable?: boolean;
  showFormationShape?: boolean;
  compactTokens?: boolean;
  compactGrid?: boolean;
  goalsByUid?: Map<string, number>;
  skillArrowThresholds?: SkillArrowThresholds;
  onFormationChange?: (updated: TeamFormation) => void;
  onRestoreOriginal?: () => void;
}

interface ActiveDragState {
  sourceTeamIndex: number;
  uid: string;
  player: FormationPlayerSlot;
  sourceColor: string;
  startClientX: number;
  startClientY: number;
  clientX: number;
  clientY: number;
  pitchX: number;
  pitchY: number;
  hoverTeamIndex: number | null;
  targetPitchX: number;
  targetPitchY: number;
  moved: boolean;
}

type PopoverMode = 'menu' | 'position' | 'similar';

const QUICK_PITCH_POSITIONS = [
  'GK',
  'D',
  'LB',
  'CB',
  'RB',
  'CDM',
  'LM',
  'CM',
  'RM',
  'CAM',
  'LW',
  'RW',
  'ST',
] as const;

const POSITION_TARGET_COORDS: Record<string, { x: number; y: number }> = {
  GK: { x: 50, y: 90 },
  D: { x: 50, y: 71 },
  LB: { x: 20, y: 70 },
  CB: { x: 50, y: 71 },
  RB: { x: 80, y: 70 },
  CDM: { x: 50, y: 55 },
  LM: { x: 18, y: 45 },
  CM: { x: 50, y: 45 },
  RM: { x: 82, y: 45 },
  CAM: { x: 50, y: 31 },
  LW: { x: 20, y: 20 },
  RW: { x: 80, y: 20 },
  ST: { x: 50, y: 15 },
};

function detectPositionFromCoords(x: number, y: number): string {
  // Own 18-yard penalty area (SVG box is x: 22..78, y: 94/110 = 85.45..100)
  if (y >= 84 && x >= 22 && x <= 78) {
    return 'GK';
  }
  // Defensive third
  if (y >= 62) {
    if (x < 36) return 'LB';
    if (x > 64) return 'RB';
    return 'CB';
  }
  // Midfield third
  if (y >= 34) {
    if (x < 32) return 'LM';
    if (x > 68) return 'RM';
    if (y >= 50) return 'CDM';
    if (y >= 38) return 'CM';
    return 'CAM';
  }
  // Attacking third
  if (x < 34) return 'LW';
  if (x > 66) return 'RW';
  return 'ST';
}

function resolveTeamOverlaps(
  players: FormationPlayerSlot[],
  priorityUid?: string
): FormationPlayerSlot[] {
  if (players.length <= 1) return players;

  const cloned = players.map((p) => ({ ...p }));
  const minDx = 15.5;
  const minDy = 17.5;

  for (let pass = 0; pass < 12; pass++) {
    let anyMoved = false;
    for (let i = 0; i < cloned.length; i++) {
      for (let j = i + 1; j < cloned.length; j++) {
        const a = cloned[i];
        const b = cloned[j];
        const dx = b.pitchX - a.pitchX;
        const dy = b.pitchY - a.pitchY;
        const nx = dx / minDx;
        const ny = dy / minDy;
        const dist = Math.hypot(nx, ny);

        if (dist < 1) {
          anyMoved = true;
          let ux = 1;
          let uy = 0;
          if (dist > 0.001) {
            ux = nx / dist;
            uy = ny / dist;
          } else {
            // Exact overlap: push apart horizontally
            ux = (i % 2 === 0 ? 1 : -1);
            uy = 0;
          }
          const push = (1 - dist) * 0.55;
          const shiftX = ux * push * minDx;
          const shiftY = uy * push * minDy;

          // Keep GK gently inside 18-yard box when possible
          let aWeight = a.uid === priorityUid ? 0.55 : b.uid === priorityUid ? 0.45 : 0.5;
          if (a.assignedPosition === 'GK' && b.assignedPosition !== 'GK') aWeight = 0.15;
          if (b.assignedPosition === 'GK' && a.assignedPosition !== 'GK') aWeight = 0.85;
          const bWeight = 1 - aWeight;

          const clampCoords = (p: FormationPlayerSlot, nextX: number, nextY: number) => {
            if (p.assignedPosition === 'GK') {
              return {
                x: Math.round(Math.max(26, Math.min(74, nextX)) * 10) / 10,
                y: Math.round(Math.max(85, Math.min(92, nextY)) * 10) / 10,
              };
            }
            return {
              x: Math.round(Math.max(8, Math.min(92, nextX)) * 10) / 10,
              y: Math.round(Math.max(8, Math.min(92, nextY)) * 10) / 10,
            };
          };

          const nextA = clampCoords(a, a.pitchX - shiftX * aWeight, a.pitchY - shiftY * aWeight);
          const nextB = clampCoords(b, b.pitchX + shiftX * bWeight, b.pitchY + shiftY * bWeight);
          a.pitchX = nextA.x;
          a.pitchY = nextA.y;
          b.pitchX = nextB.x;
          b.pitchY = nextB.y;
        }
      }
    }
    if (!anyMoved) break;
  }

  return cloned;
}

function getPositionGroup(pos: string): 'GK' | 'DEF' | 'MID' | 'ATT' {
  if (pos === 'GK') return 'GK';
  if (['D', 'CB', 'LB', 'RB'].includes(pos)) return 'DEF';
  if (['CDM', 'LM', 'CM', 'RM', 'CAM'].includes(pos)) return 'MID';
  return 'ATT';
}

function findSimilarPlayers(
  target: FormationPlayerSlot,
  targetTeamIndex: number,
  teams: FormationTeam[]
): { player: FormationPlayerSlot; teamIndex: number; teamColor: string; similarity: number }[] {
  const targetGroup = getPositionGroup(target.assignedPosition);
  const candidates: {
    player: FormationPlayerSlot;
    teamIndex: number;
    teamColor: string;
    similarity: number;
  }[] = [];

  for (const team of teams) {
    for (const p of team.players) {
      if (p.uid === target.uid) continue;

      let penalty = 0;
      if (p.assignedPosition !== target.assignedPosition) {
        penalty += getPositionGroup(p.assignedPosition) === targetGroup ? 1.2 : 3.5;
      }
      penalty += Math.abs((p.avgOverall ?? p.avgSkill) - (target.avgOverall ?? target.avgSkill)) * 0.14;
      penalty += Math.abs(p.avgStamina - target.avgStamina) * 0.11;
      penalty += Math.abs(p.age - target.age) * 0.12;
      if (target.goalieOption === 'only_goalie' && p.goalieOption === 'none') {
        penalty += 3;
      }

      const similarity = Math.max(10, Math.round(100 - penalty * 7));
      candidates.push({
        player: p,
        teamIndex: team.teamIndex,
        teamColor: team.color,
        similarity,
      });
    }
  }

  candidates.sort((a, b) => b.similarity - a.similarity);
  return candidates.slice(0, 5);
}

export const SkillArrowBadge: React.FC<{
  skill: number | null;
  compact?: boolean;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'pitch' | 'light';
  thresholds?: SkillArrowThresholds;
  kitColor?: string;
  teamIndex?: number;
}> = ({ skill, compact = false, size, variant = 'pitch', thresholds, kitColor, teamIndex = 0 }) => {
  const [t0, t1, t2, t3] = normalizeSkillArrowThresholds(thresholds);
  const resolvedSize: 'sm' | 'md' | 'lg' = size ?? (compact ? 'sm' : 'md');
  const sizeClass =
    resolvedSize === 'lg'
      ? 'w-8 h-8 border-2'
      : resolvedSize === 'md'
        ? 'w-6 h-6 border-[1.5px]'
        : 'w-5 h-5 border';
  const iconClass =
    resolvedSize === 'lg'
      ? 'w-4 h-4'
      : resolvedSize === 'md'
        ? 'w-3.5 h-3.5'
        : 'w-3 h-3';

  const stdKit: StandardTeamColor | null =
    variant === 'pitch' && kitColor ? normalizeStandardTeamColor(kitColor, teamIndex) : null;
  const isLightSurface = variant === 'light' || stdKit === 'Yellow';

  const frameClass =
    variant === 'light'
      ? 'bg-slate-100 border-slate-300 shadow-xs'
      : stdKit === 'Red'
        ? 'bg-red-600/50 border-white/70 shadow-md'
        : stdKit === 'Blue'
          ? 'bg-blue-600/50 border-white/70 shadow-md'
          : stdKit === 'Black'
            ? 'bg-zinc-950/50 border-white/70 shadow-md'
            : stdKit === 'Yellow'
              ? 'bg-yellow-400/50 border-slate-900/50 shadow-md'
              : 'bg-slate-900/95 border-white/45 shadow-md';

  const arrowShadowClass =
    variant === 'pitch'
      ? stdKit === 'Yellow'
        ? 'drop-shadow-[0_1px_1px_rgba(255,255,255,0.65)]'
        : 'drop-shadow-[0_1px_1.5px_rgba(0,0,0,0.9)]'
      : '';

  if (skill === null) {
    return (
      <span
        title="Overall not yet rated"
        className={`inline-flex items-center justify-center rounded-full ${frameClass} ${
          isLightSurface ? 'text-slate-700' : 'text-slate-200'
        } font-mono-tabular text-[10px] font-bold ${sizeClass}`}
      >
        —
      </span>
    );
  }

  if (skill > t3) {
    return (
      <span
        title={`Overall ${Math.round(skill)} (${t3 + 1}–100)`}
        className={`inline-flex items-center justify-center rounded-full ${frameClass} ${
          variant === 'light'
            ? 'text-emerald-600'
            : stdKit === 'Yellow'
              ? 'text-emerald-900'
              : 'text-emerald-300'
        } ${sizeClass}`}
      >
        <ArrowUp className={`${iconClass} ${arrowShadowClass}`} strokeWidth={3} />
      </span>
    );
  }
  if (skill > t2) {
    return (
      <span
        title={`Overall ${Math.round(skill)} (${t2 + 1}–${t3})`}
        className={`inline-flex items-center justify-center rounded-full ${frameClass} ${
          variant === 'light'
            ? 'text-sky-600'
            : stdKit === 'Yellow'
              ? 'text-sky-900'
              : 'text-sky-300'
        } ${sizeClass}`}
      >
        <ArrowUpRight className={`${iconClass} ${arrowShadowClass}`} strokeWidth={3} />
      </span>
    );
  }
  if (skill >= t1) {
    return (
      <span
        title={`Overall ${Math.round(skill)} (${t1}–${t2})`}
        className={`inline-flex items-center justify-center rounded-full ${frameClass} ${
          variant === 'light'
            ? 'text-amber-600'
            : stdKit === 'Yellow'
              ? 'text-slate-950'
              : 'text-amber-200'
        } ${sizeClass}`}
      >
        <ArrowRight className={`${iconClass} ${arrowShadowClass}`} strokeWidth={3} />
      </span>
    );
  }
  if (skill >= t0) {
    return (
      <span
        title={`Overall ${Math.round(skill)} (${t0}–${t1 - 1})`}
        className={`inline-flex items-center justify-center rounded-full ${frameClass} ${
          variant === 'light'
            ? 'text-orange-600'
            : stdKit === 'Yellow'
              ? 'text-orange-900'
              : 'text-orange-300'
        } ${sizeClass}`}
      >
        <ArrowDownRight className={`${iconClass} ${arrowShadowClass}`} strokeWidth={3} />
      </span>
    );
  }
  return (
    <span
      title={`Overall ${Math.round(skill)} (0–${t0 - 1})`}
      className={`inline-flex items-center justify-center rounded-full ${frameClass} ${
        variant === 'light'
          ? 'text-rose-600'
          : stdKit === 'Yellow'
            ? 'text-rose-800'
            : 'text-rose-200'
      } ${sizeClass}`}
    >
      <ArrowDown className={`${iconClass} ${arrowShadowClass}`} strokeWidth={3} />
    </span>
  );
};

export const StaminaPerimeterRing: React.FC<{
  stamina: number | null;
  size?: number;
  variant?: 'pitch' | 'light';
}> = ({ stamina, size = 56, variant = 'pitch' }) => {
  const clamped = stamina === null ? 0 : Math.max(0, Math.min(100, stamina));
  const ratio = clamped / 100;

  if (variant === 'light') {
    const r = 21;
    const circumference = 2 * Math.PI * r;
    const dashOffset = circumference * (1 - ratio);
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 48 48"
        className="absolute inset-0 w-full h-full -rotate-90 pointer-events-none"
        aria-label={stamina === null ? 'Stamina unrated' : `Stamina level ${Math.round(clamped)}%`}
      >
        <circle cx="24" cy="24" r={r} fill="none" stroke="#cbd5e1" strokeWidth="3.4" />
        {clamped > 0 && (
          <circle
            cx="24"
            cy="24"
            r={r}
            fill="none"
            stroke="#0f172a"
            strokeWidth="3.4"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            className="transition-[stroke-dashoffset] duration-150 ease-out"
          />
        )}
      </svg>
    );
  }

  // Crisp, unblurred circular stamina band cleanly wrapping the profile picture
  const r = 27;
  const circumference = 2 * Math.PI * r;
  const dashOffset = circumference * (1 - ratio);
  const bandColor =
    clamped >= 70 ? '#34d399' : clamped >= 45 ? '#fbbf24' : '#fb7185';

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 60 60"
      className="absolute inset-0 w-full h-full -rotate-90 pointer-events-none"
      aria-label={stamina === null ? 'Stamina unrated' : `Stamina level ${Math.round(clamped)}%`}
    >
      {/* Crisp subtle circular track */}
      <circle
        cx="30"
        cy="30"
        r={r}
        fill="none"
        stroke="rgba(15, 23, 42, 0.55)"
        strokeWidth="4"
      />
      {/* Crisp active stamina arc */}
      {clamped > 0 && (
        <circle
          cx="30"
          cy="30"
          r={r}
          fill="none"
          stroke={bandColor}
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          className="transition-[stroke-dashoffset] duration-150 ease-out"
        />
      )}
    </svg>
  );
};

// Pro-grade realistic sculpted soccer jersey shoulders with anatomical collarbone/deltoid contour & refined neck opening (viewBox 0 0 96 36, zero black border)
const PITCH_SHOULDERS_FRONT_PATH =
  'M28.2 6.4C33.1 13.8 39.8 17.2 48 17.2C56.2 17.2 62.9 13.8 67.8 6.4C72.6 7.5 77.7 9.4 82.4 12.4C87.3 15.6 91.2 20.2 93.2 26.2C94.1 28.9 94.6 32.1 94.8 35.6H1.2C1.4 32.1 1.9 28.9 2.8 26.2C4.8 20.2 8.7 15.6 13.6 12.4C18.3 9.4 23.4 7.5 28.2 6.4Z';

const PITCH_NECK_SKIN_AREA_PATH =
  'M28.2 6.4C33.8 4.4 40.6 3.7 48 3.7C55.4 3.7 62.2 4.4 67.8 6.4C63.8 15.4 56.6 19.6 48 19.6C39.4 19.6 32.2 15.4 28.2 6.4Z';

export const DEFAULT_NECK_SKIN_TONE = '#d4a27e';

function deriveSkinShades(rawHex?: string) {
  const validHex =
    rawHex && /^#[0-9a-fA-F]{6}$/.test(rawHex) ? rawHex : DEFAULT_NECK_SKIN_TONE;
  const r = parseInt(validHex.slice(1, 3), 16);
  const g = parseInt(validHex.slice(3, 5), 16);
  const b = parseInt(validHex.slice(5, 7), 16);
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  const toHex = (rr: number, gg: number, bb: number) =>
    `#${clamp(rr).toString(16).padStart(2, '0')}${clamp(gg).toString(16).padStart(2, '0')}${clamp(bb).toString(16).padStart(2, '0')}`;
  return {
    light: toHex(r + 18, g + 14, b + 11),
    mid: validHex,
    shadow: toHex(r * 0.84, g * 0.8, b * 0.77),
    deepShadow: toHex(r * 0.72, g * 0.67, b * 0.64),
    mottleWarm: toHex(r * 0.91 + 5, g * 0.85, b * 0.81),
    poreLight: toHex(r + 13, g + 10, b + 8),
  };
}

export const PlayerKitShouldersSvg: React.FC<{
  color: string;
  teamIndex: number;
  layer?: 'back' | 'front' | 'full';
  skinTone?: string;
  highlighted?: boolean;
  className?: string;
}> = ({
  color,
  teamIndex,
  layer = 'full',
  skinTone,
  highlighted = false,
  className = '',
}) => {
  const uid = useId().replace(/:/g, '');
  const std = normalizeStandardTeamColor(color, teamIndex);
  const k = REALISTIC_KIT_PALETTES[std];
  const skin = deriveSkinShades(skinTone);

  const bodyGradId = `psh-body-${uid}`;
  const sheenGradId = `psh-sheen-${uid}`;
  const skinGradId = `psh-skin-${uid}`;
  const skinDepthGradId = `psh-skindepth-${uid}`;
  const skinTexId = `psh-skintex-${uid}`;
  const skinClipId = `psh-skinclip-${uid}`;
  const collarRibGradId = `psh-rib-${uid}`;
  const clipId = `psh-clip-${uid}`;

  const showBack = layer === 'back' || layer === 'full';
  const showFront = layer === 'front' || layer === 'full';
  const activeFrontPath = PITCH_SHOULDERS_FRONT_PATH;
  const activeSkinAreaPath = PITCH_NECK_SKIN_AREA_PATH;

  return (
    <svg
      viewBox="0 0 96 36"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={
        highlighted && showFront
          ? { filter: 'drop-shadow(0 0 4.5px rgba(52,211,153,0.92))' }
          : undefined
      }
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={bodyGradId} x1="48" y1="5" x2="48" y2="36" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={k.light} />
          <stop offset="48%" stopColor={k.mid} />
          <stop offset="100%" stopColor={k.deep} />
        </linearGradient>
        <radialGradient id={sheenGradId} cx="44%" cy="22%" r="74%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.24" />
          <stop offset="52%" stopColor="#ffffff" stopOpacity="0.03" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0.22" />
        </radialGradient>
        {/* Natural cylindrical neck/collarbone skin shading gradient (no bold dark shirt cavity) */}
        <linearGradient id={skinGradId} x1="28" y1="11" x2="68" y2="11" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={skin.shadow} />
          <stop offset="28%" stopColor={skin.mid} />
          <stop offset="50%" stopColor={skin.light} />
          <stop offset="72%" stopColor={skin.mid} />
          <stop offset="100%" stopColor={skin.shadow} />
        </linearGradient>
        <linearGradient id={skinDepthGradId} x1="48" y1="4" x2="48" y2="19" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={skin.deepShadow} stopOpacity="0.28" />
          <stop offset="45%" stopColor={skin.light} stopOpacity="0.06" />
          <stop offset="100%" stopColor={skin.deepShadow} stopOpacity="0.22" />
        </linearGradient>
        {/* Subtle organic skin micro-texture pattern */}
        <pattern id={skinTexId} width="5" height="5" patternUnits="userSpaceOnUse">
          <circle cx="1.2" cy="1.4" r="0.65" fill={skin.mottleWarm} fillOpacity="0.24" />
          <circle cx="3.8" cy="2.9" r="0.55" fill={skin.poreLight} fillOpacity="0.2" />
          <circle cx="2.4" cy="4.2" r="0.5" fill={skin.shadow} fillOpacity="0.16" />
        </pattern>
        <linearGradient id={collarRibGradId} x1="48" y1="4" x2="48" y2="21" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={k.collarBase} />
          <stop offset="100%" stopColor={k.collarShade} />
        </linearGradient>
        <clipPath id={skinClipId}>
          <path d={activeSkinAreaPath} />
        </clipPath>
        <clipPath id={clipId}>
          <path d={activeFrontPath} />
        </clipPath>
      </defs>

      {/* Back Layer: Natural Skin-Colored & Skin-Textured Neck Opening + Slim Back Collar Rim (Sits Behind Player Neck) */}
      {showBack && (
        <g>
          {/* Natural Skin-Toned & Textured Neck/Trapezius Base (blends smoothly around thin necks) */}
          <path d={activeSkinAreaPath} fill={`url(#${skinGradId})`} />
          <g clipPath={`url(#${skinClipId})`}>
            <rect x="26" y="3" width="44" height="18" fill={`url(#${skinTexId})`} />
            <rect x="26" y="3" width="44" height="18" fill={`url(#${skinDepthGradId})`} />
            {/* Soft anatomical clavicle / throat contour lines */}
            <path
              d="M34 14.2C38.5 15.8 43 16.4 48 16.4C53 16.4 57.5 15.8 62 14.2"
              stroke={skin.deepShadow}
              strokeOpacity="0.18"
              strokeWidth="1.2"
              strokeLinecap="round"
            />
          </g>

          {/* Slim Classic Crew Back Neckline Rim */}
          <path
            d="M28.2 6.4C33.8 4.2 40.6 3.5 48 3.5C55.4 3.5 62.2 4.2 67.8 6.4"
            stroke={k.collarBase}
            strokeWidth="1.75"
            strokeLinecap="round"
          />
        </g>
      )}

      {/* Front Realistic Sculpted Soccer Jersey Shoulders & Pro Collar (Sits in Front of Base of Neck) */}
      {showFront && (
        <g>
          <path d={activeFrontPath} fill={`url(#${bodyGradId})`} />

          <g clipPath={`url(#${clipId})`}>
            {/* Tailored Shoulder Yoke Panel Wrapping Collarbone & Shoulders */}
            <path
              d="M28.2 6.4C33.1 13.8 39.8 17.2 48 17.2C56.2 17.2 62.9 13.8 67.8 6.4L91 17L82 28C72 22.8 60.5 20.6 48 20.6C35.5 20.6 24 22.8 14 28L5 17L28.2 6.4Z"
              fill={k.yoke}
              opacity="0.52"
            />

            {/* Engineered Jacquard Chevron & Micro-Rib Breathable Mesh Pattern */}
            <path
              d="M14 23L48 34L82 23V27.2L48 38.2L14 27.2V23ZM18 15L48 25L78 15V18.8L48 28.8L18 18.8V15Z"
              fill={k.jacquard}
            />
            <rect x="19" y="6" width="4" height="30" fill={k.jacquardDark} />
            <rect x="29" y="9" width="4" height="27" fill={k.jacquard} />
            <rect x="46" y="14" width="4" height="22" fill={k.jacquard} />
            <rect x="63" y="9" width="4" height="27" fill={k.jacquard} />
            <rect x="73" y="6" width="4" height="30" fill={k.jacquardDark} />

            {/* Natural Muscular Deltoid / Outer Sleeve Curvature Shading */}
            <path d="M0 16C7 18.2 14.2 25 16.8 36H0V16Z" fill={k.sleeveShade} opacity="0.4" />
            <path d="M96 16C89 18.2 81.8 25 79.2 36H96V16Z" fill={k.sleeveShade} opacity="0.4" />

            {/* Subtle Natural Fabric Drape Creases near Clavicle & Underarm */}
            <path
              d="M18.5 28.5C24.5 26.2 30.2 25.4 36 26.2"
              stroke="#ffffff"
              strokeOpacity="0.16"
              strokeWidth="2.4"
              strokeLinecap="round"
            />
            <path
              d="M77.5 28.5C71.5 26.2 65.8 25.4 60 26.2"
              stroke="#ffffff"
              strokeOpacity="0.12"
              strokeWidth="2.2"
              strokeLinecap="round"
            />
            <path
              d="M15.5 31.5C21.5 29.5 26.5 29 31.5 29.8"
              stroke="#000000"
              strokeOpacity="0.14"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
            <path
              d="M80.5 31.5C74.5 29.5 69.5 29 64.5 29.8"
              stroke="#000000"
              strokeOpacity="0.14"
              strokeWidth="1.8"
              strokeLinecap="round"
            />

            {/* 3D Stadium Cloth Lighting Sheen Overlay */}
            <rect x="0" y="0" width="96" height="36" fill={`url(#${sheenGradId})`} />

            {/* Crisp Sunlit Top-Shoulder Rim-Light (Realistic Edge Definition, Zero Black Margin) */}
            <path
              d="M2.2 28C4.4 21 8.4 15.8 13.6 12.4C18 9.4 22.8 7.5 27.8 6.5M68.2 6.5C73.2 7.5 78 9.4 82.4 12.4C87.6 15.8 91.6 21 93.8 28"
              stroke={k.rimLight}
              strokeWidth="1.35"
              strokeLinecap="round"
            />

            {/* Curved Raglan Athletic Shoulder Seams (Stitched Shadow + Highlight Pair) */}
            <path
              d="M25.6 8.2C21.6 16.4 18.4 25.6 16.8 35.8"
              stroke={k.seamShadow}
              strokeWidth="1.65"
              strokeLinecap="round"
            />
            <path
              d="M26.9 8.7C22.9 16.8 19.7 25.9 18.1 35.8"
              stroke={k.seamHighlight}
              strokeWidth="0.95"
              strokeLinecap="round"
            />
            <path
              d="M70.4 8.2C74.4 16.4 77.6 25.6 79.2 35.8"
              stroke={k.seamShadow}
              strokeWidth="1.65"
              strokeLinecap="round"
            />
            <path
              d="M69.1 8.7C73.1 16.8 76.3 25.9 77.9 35.8"
              stroke={k.seamHighlight}
              strokeWidth="0.95"
              strokeLinecap="round"
            />

            {/* Pro 3-Stripe Perspective-Curved Athletic Shoulder Tape */}
            <path
              d="M24.2 7.8C17.4 10.6 11.2 15.4 6.1 22.4"
              stroke={k.shoulderStripe}
              strokeWidth="1.75"
              strokeLinecap="round"
            />
            <path
              d="M22.2 10.6C15.8 13.5 9.8 18.2 4.8 25.4"
              stroke={k.shoulderStripe}
              strokeWidth="1.45"
              strokeLinecap="round"
              opacity="0.88"
            />
            <path
              d="M20.2 13.5C14.1 16.5 8.5 21.1 3.9 28.4"
              stroke={k.shoulderStripeEdge}
              strokeWidth="1.2"
              strokeLinecap="round"
            />
            <path
              d="M71.8 7.8C78.6 10.6 84.8 15.4 89.9 22.4"
              stroke={k.shoulderStripe}
              strokeWidth="1.75"
              strokeLinecap="round"
            />
            <path
              d="M73.8 10.6C80.2 13.5 86.2 18.2 91.2 25.4"
              stroke={k.shoulderStripe}
              strokeWidth="1.45"
              strokeLinecap="round"
              opacity="0.88"
            />
            <path
              d="M75.8 13.5C81.9 16.5 87.5 21.1 92.1 28.4"
              stroke={k.shoulderStripeEdge}
              strokeWidth="1.2"
              strokeLinecap="round"
            />

            {/* Embroidered Multi-Layer Club Shield Crest (Player Left Chest) */}
            <g>
              <path
                d="M61.6 23.2H68.8V28.4C68.8 30.8 67 32.5 65.2 33.2C63.4 32.5 61.6 30.8 61.6 28.4V23.2Z"
                fill="#000000"
                fillOpacity="0.26"
                transform="translate(0.5, 0.8)"
              />
              <path
                d="M61.6 23.2H68.8V28.4C68.8 30.8 67 32.5 65.2 33.2C63.4 32.5 61.6 30.8 61.6 28.4V23.2Z"
                fill={k.crestRim}
              />
              <path
                d="M62.6 24.2H67.8V28.1C67.8 29.9 66.5 31.2 65.2 31.8C63.9 31.2 62.6 29.9 62.6 28.1V24.2Z"
                fill={k.crestBody}
              />
              <path d="M62.7 28.8L67.7 24.6V26.8L63.8 30.1L62.7 28.8Z" fill={k.crestSash} opacity="0.92" />
            </g>

            {/* Minimalist Kit Manufacturer Emblem (Player Right Chest) */}
            <path
              d="M27.6 27.6L33.8 25.4M29 29.3L33.5 27.7"
              stroke={k.brandMark}
              strokeWidth="1.55"
              strokeLinecap="round"
              opacity="0.92"
            />

            {/* Classic Ribbed Athletic Crew Neckline */}
            <g>
              {/* Soft Cast-Shadow Below Neckline Band onto Upper Chest */}
              <path
                d="M26.4 7.4C32 15.8 39.2 19.9 48 19.9C56.8 19.9 64 15.8 69.6 7.4"
                stroke="#000000"
                strokeOpacity="0.26"
                strokeWidth="3"
                strokeLinecap="round"
              />
              {/* Sculpted 3D Ribbed Athletic Neck Band */}
              <path
                d="M26.6 6.2C32 14.2 39.1 18.2 48 18.2C56.9 18.2 64 14.2 69.4 6.2L66.8 5.4C62 12.5 55.6 15.9 48 15.9C40.4 15.9 34 12.5 29.2 5.4L26.6 6.2Z"
                fill={`url(#${collarRibGradId})`}
              />
              {/* Front Center Ribbed V-Throat Gusset Insert */}
              <path
                d="M42.4 17.4L48 22.3L53.6 17.4C51.8 18 49.9 18.3 48 18.3C46.1 18.3 44.2 18 42.4 17.4Z"
                fill={k.collarGusset}
              />
              {/* Woven Contrast Tipping Stripe inside Ribbed Band */}
              <path
                d="M27.8 6.3C32.9 13.5 39.6 17.1 48 17.1C56.4 17.1 63.1 13.5 68.2 6.3"
                stroke={k.collarTipping}
                strokeWidth="1.2"
                strokeLinecap="round"
              />
              {/* Fine Double-Needle Coverstitch Seam */}
              <path
                d="M25.6 8.5C31.4 17.1 38.8 21.3 48 21.3C57.2 21.3 64.6 17.1 70.4 8.5"
                stroke={k.seamHighlight}
                strokeWidth="0.85"
                strokeDasharray="2.2 1.8"
                strokeLinecap="round"
                opacity="0.72"
              />
            </g>
          </g>
        </g>
      )}
    </svg>
  );
};

interface PitchPlayerJerseyProps {
  color: string;
  teamIndex: number;
  playerName: string;
  displayName: string;
  age?: number;
  initials: string;
  photoUrl?: string;
  skinTone?: string;
  position: string;
  skill: number;
  stamina: number;
  goalieOption: GoalieOption;
  showRatings: boolean;
  skillArrowThresholds?: SkillArrowThresholds;
  highlighted?: boolean;
  transferLabel?: string;
  compact?: boolean;
  goals?: number;
}

const PitchPlayerJersey: React.FC<PitchPlayerJerseyProps> = ({
  color,
  teamIndex,
  playerName,
  displayName,
  age,
  initials,
  photoUrl,
  skinTone,
  position,
  skill,
  stamina,
  goalieOption,
  showRatings,
  skillArrowThresholds,
  highlighted = false,
  transferLabel,
  compact = false,
  goals = 0,
}) => {
  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => {
    setImgFailed(false);
  }, [photoUrl]);

  const palette = getTeamColorPalette(color, teamIndex);
  const clampedStamina = Math.max(0, Math.min(100, stamina));
  const staminaBarColor =
    clampedStamina >= 70
      ? 'bg-emerald-400'
      : clampedStamina >= 45
        ? 'bg-amber-400'
        : 'bg-rose-400';

  const isTransparentCutout = Boolean(
    photoUrl && (photoUrl.startsWith('data:image/webp') || photoUrl.startsWith('data:image/png'))
  );

  return (
    <div
      className={`flex flex-col items-center transition-transform ${
        highlighted ? 'scale-105' : ''
      }`}
    >
      {/* Layered Player Head/Neck + Pro Realistic Soccer Jersey Shoulders (Compact Scale) */}
      <div
        className={`relative flex justify-center overflow-visible pointer-events-none ${
          compact ? 'w-[44px] h-[40px]' : 'w-[56px] h-[52px]'
        }`}
      >
        {/* Back Layer: Skin-Toned & Textured Neck Opening + Slim Back Collar Rim */}
        <div
          className={`absolute bottom-0 left-0 z-10 ${
            compact ? 'w-[44px] h-[16px]' : 'w-[56px] h-[21px]'
          }`}
        >
          <PlayerKitShouldersSvg
            color={color}
            teamIndex={teamIndex}
            layer="back"
            skinTone={skinTone}
            className={compact ? 'w-[44px] h-[16px]' : 'w-[56px] h-[21px]'}
          />
        </div>

        {/* Cutout Portrait / Circular Photo */}
        {photoUrl && !imgFailed ? (
          isTransparentCutout ? (
            <img
              src={photoUrl}
              alt={playerName}
              draggable={false}
              referrerPolicy="no-referrer"
              onError={() => setImgFailed(true)}
              className={`absolute left-1/2 -translate-x-1/2 object-contain object-bottom z-20 pointer-events-none select-none drop-shadow-[0_1px_2px_rgba(0,0,0,0.38)] ${
                compact ? 'bottom-[4px] w-[42px] h-[53px]' : 'bottom-[5px] w-[54px] h-[68px]'
              }`}
            />
          ) : (
            <div
              className={`absolute left-1/2 -translate-x-1/2 z-20 flex items-center justify-center ${
                compact ? 'bottom-[8px] w-[28px] h-[28px]' : 'bottom-[11px] w-[36px] h-[36px]'
              }`}
            >
              <img
                src={photoUrl}
                alt={playerName}
                draggable={false}
                referrerPolicy="no-referrer"
                onError={() => setImgFailed(true)}
                className={`rounded-full object-cover object-top portrait-perimeter-50 pointer-events-none select-none ${
                  compact ? 'w-[28px] h-[28px]' : 'w-[36px] h-[36px]'
                }`}
              />
            </div>
          )
        ) : (
          <div
            className={`absolute left-1/2 -translate-x-1/2 z-20 rounded-full flex items-center justify-center bg-gradient-to-b from-slate-600 to-slate-800 text-white portrait-perimeter-50 pointer-events-none select-none ${
              compact ? 'bottom-[9px] w-[26px] h-[26px]' : 'bottom-[12px] w-[34px] h-[34px]'
            }`}
          >
            <span
              className={`font-display font-bold tracking-tight leading-none ${
                compact ? 'text-[9px]' : 'text-[11px]'
              }`}
            >
              {initials}
            </span>
          </div>
        )}

        {/* Front Pro Sculpted Soccer Jersey Shoulders Wrapping Base of Neck */}
        <div
          className={`absolute bottom-0 left-0 z-30 ${
            compact ? 'w-[44px] h-[16px]' : 'w-[56px] h-[21px]'
          }`}
        >
          <PlayerKitShouldersSvg
            color={color}
            teamIndex={teamIndex}
            layer="front"
            skinTone={skinTone}
            highlighted={highlighted}
            className={`${
              compact ? 'w-[44px] h-[16px]' : 'w-[56px] h-[21px]'
            } drop-shadow-[0_2px_3px_rgba(0,0,0,0.45)]`}
          />
        </div>

        {/* Goalie hands indicator at top-left */}
        {goalieOption !== 'none' && (
          <span
            title={goalieOption === 'only_goalie' ? 'Only Goalie' : 'Willing Goalie'}
            className={`absolute top-0.5 left-0 z-40 rounded-full bg-slate-900 text-amber-300 flex items-center justify-center border border-white/80 shadow-sm pointer-events-none ${
              compact ? 'w-[13px] h-[13px]' : 'w-[15px] h-[15px]'
            }`}
          >
            <Hand className={compact ? 'w-2 h-2' : 'w-2.5 h-2.5'} strokeWidth={2.5} />
          </span>
        )}

        {/* Goal scorer ball icon(s) at top-right */}
        {goals > 0 && (
          <span
            title={`${goals} ${goals === 1 ? 'goal' : 'goals'}`}
            className="absolute -top-1 -right-2 z-40 inline-flex items-center gap-[1px] pointer-events-none drop-shadow-[0_1px_2px_rgba(0,0,0,0.75)]"
          >
            {goals <= 4 ? (
              Array.from({ length: goals }).map((_, i) => (
                <SoccerBallIcon
                  key={i}
                  className={compact ? 'w-3 h-3' : 'w-3.5 h-3.5'}
                />
              ))
            ) : (
              <span className="inline-flex items-center gap-0.5 px-1 py-[1px] rounded-full bg-slate-950/90 text-white text-[8px] font-mono-tabular font-bold border border-white/70">
                <SoccerBallIcon className="w-2.5 h-2.5" />
                ×{goals}
              </span>
            )}
          </span>
        )}
      </div>

      {/* Broadcast White Nameplate + Skill Badge + Horizontal Stamina Bar */}
      <div className="relative -mt-[2px] z-40 inline-flex flex-col items-stretch pointer-events-none">
        <div className="relative flex items-center justify-center">
          <div
            className={`flex items-center rounded-[3px] bg-white text-slate-950 shadow-[0_2px_7px_rgba(0,0,0,0.5)] overflow-hidden transition-shadow ${
              highlighted ? 'ring-2 ring-emerald-400' : ''
            }`}
          >
            {/* Compact Integrated Position Cap */}
            <span
              title={`Position: ${position}`}
              className={`font-mono-tabular font-extrabold uppercase leading-none tracking-tight ${palette.bg} ${palette.text} ${
                compact ? 'px-1 py-[1.5px] text-[7px]' : 'px-1 py-[2px] text-[8px]'
              }`}
            >
              {position}
            </span>

            {/* Bold Uppercase Broadcast Nameplate Text */}
            <span
              className={`font-extrabold uppercase tracking-tight leading-none whitespace-nowrap flex items-baseline gap-0.5 ${
                compact
                  ? `py-[1.5px] pl-1 text-[7.5px] ${showRatings ? 'pr-3' : 'pr-1.5'}`
                  : `py-[2px] pl-1 text-[8.5px] ${showRatings ? 'pr-3.5' : 'pr-1.5'}`
              }`}
            >
              <span>{displayName}</span>
              {typeof age === 'number' && !compact && (
                <span className="text-[7.5px] font-mono-tabular font-semibold text-slate-500">
                  {age}
                </span>
              )}
              {transferLabel && (
                <span className="text-[7.5px] font-bold text-emerald-700 normal-case">
                  {transferLabel}
                </span>
              )}
            </span>
          </div>

          {/* Circular Skill Arrow Badge Overlapping Right Edge */}
          {showRatings && (
            <span className="absolute -right-2.5 top-1/2 -translate-y-1/2 z-40 pointer-events-none">
              <SkillArrowBadge
                skill={skill}
                size="sm"
                variant="pitch"
                thresholds={skillArrowThresholds}
                kitColor={color}
                teamIndex={teamIndex}
              />
            </span>
          )}
        </div>

        {/* Horizontal Stamina Bar Directly Below POS | NAME Area (Manager View Only) */}
        {showRatings && (
          <div
            title={`Stamina: ${Math.round(clampedStamina)}%`}
            className="mt-[2px] w-full min-w-[50px] h-[4px] rounded-full bg-slate-950/75 overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.6)]"
          >
            <div
              className={`h-full rounded-full transition-[width] duration-150 ${staminaBarColor}`}
              style={{ width: `${clampedStamina}%` }}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export const SoccerPitch: React.FC<SoccerPitchProps> = ({
  formation,
  originalFormation,
  playersById,
  bestPositionsById,
  editable = false,
  showRatings = true,
  showPreferredPositions = showRatings,
  showTeamHeader = true,
  showAvgAge = true,
  showRosterTable = true,
  showFormationShape = true,
  compactTokens = false,
  compactGrid = false,
  goalsByUid,
  skillArrowThresholds,
  onFormationChange,
  onRestoreOriginal,
}) => {
  const resolvedThresholds = normalizeSkillArrowThresholds(skillArrowThresholds);
  const [viewingOriginal, setViewingOriginal] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<{
    teamIndex: number;
    player: FormationPlayerSlot;
  } | null>(null);
  const [showPopover, setShowPopover] = useState(false);
  const [popoverMode, setPopoverMode] = useState<PopoverMode>('menu');
  const [dragState, setDragState] = useState<ActiveDragState | null>(null);

  const pitchRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const dragRef = useRef<ActiveDragState | null>(null);
  const lastDragEndedAtRef = useRef(0);
  const formationRef = useRef(formation);
  const editableRef = useRef(editable);
  const viewingOriginalRef = useRef(viewingOriginal);
  const onFormationChangeRef = useRef(onFormationChange);
  const selectedSlotRef = useRef(selectedSlot);
  const showPopoverRef = useRef(showPopover);

  formationRef.current = formation;
  editableRef.current = editable;
  viewingOriginalRef.current = viewingOriginal;
  onFormationChangeRef.current = onFormationChange;
  selectedSlotRef.current = selectedSlot;
  showPopoverRef.current = showPopover;

  const activeFormation = viewingOriginal && originalFormation ? originalFormation : formation;

  const computeTeamAverages = (team: FormationTeam) => {
    if (team.players.length === 0) {
      return {
        avgAge: 0,
        avgOverall: 0,
        avgSkill: 0,
        avgAttack: 0,
        avgTechnique: 0,
        avgStamina: 0,
        avgDefense: 0,
        avgSpeed: 0,
        avgPhysics: 0,
      };
    }
    const n = team.players.length;
    const avgAge = team.players.reduce((s, p) => s + p.age, 0) / n;
    const avgOverall = team.players.reduce((s, p) => s + (p.avgOverall ?? p.avgSkill), 0) / n;
    const avgAttack = team.players.reduce((s, p) => s + (p.avgAttack ?? p.avgSkill), 0) / n;
    const avgTechnique = team.players.reduce((s, p) => s + (p.avgTechnique ?? p.avgSkill), 0) / n;
    const avgStamina = team.players.reduce((s, p) => s + p.avgStamina, 0) / n;
    const avgDefense = team.players.reduce((s, p) => s + (p.avgDefense ?? p.avgSkill), 0) / n;
    const avgSpeed = team.players.reduce((s, p) => s + (p.avgSpeed ?? p.avgSkill), 0) / n;
    const avgPhysics = team.players.reduce((s, p) => s + (p.avgPhysics ?? p.avgSkill), 0) / n;
    return {
      avgAge,
      avgOverall,
      avgSkill: avgOverall,
      avgAttack,
      avgTechnique,
      avgStamina,
      avgDefense,
      avgSpeed,
      avgPhysics,
    };
  };

  const applyPitchMoveWithAutoRole = (
    teamIndex: number,
    uid: string,
    pitchX: number,
    pitchY: number
  ) => {
    const cb = onFormationChangeRef.current;
    if (!editableRef.current || !cb || viewingOriginalRef.current) return;
    const current = formationRef.current;
    const detectedPos = detectPositionFromCoords(pitchX, pitchY);

    let updatedSelected: FormationPlayerSlot | null = null;
    const nextTeams = current.teams.map((team) => {
      if (team.teamIndex !== teamIndex) return team;
      const movedPlayers = team.players.map((p) =>
        p.uid === uid
          ? { ...p, pitchX, pitchY, assignedPosition: detectedPos }
          : p
      );
      const separated = resolveTeamOverlaps(movedPlayers, uid);
      updatedSelected = separated.find((p) => p.uid === uid) || null;
      return { ...team, players: separated };
    });

    cb({ ...current, teams: nextTeams });
    if (updatedSelected) {
      setSelectedSlot({ teamIndex, player: updatedSelected });
    }
  };

  const applyPlayerPosition = (teamIndex: number, uid: string, newPosition: string) => {
    const cb = onFormationChangeRef.current;
    if (!editableRef.current || !cb || viewingOriginalRef.current) return;
    const current = formationRef.current;
    const targetCoords = POSITION_TARGET_COORDS[newPosition] || { x: 50, y: 48 };

    let updatedPlayer: FormationPlayerSlot | null = null;
    const nextTeams = current.teams.map((team) => {
      if (team.teamIndex !== teamIndex) return team;
      const updatedList = team.players.map((p) =>
        p.uid === uid
          ? {
              ...p,
              assignedPosition: newPosition,
              pitchX: targetCoords.x,
              pitchY: targetCoords.y,
            }
          : p
      );
      const separated = resolveTeamOverlaps(updatedList, uid);
      updatedPlayer = separated.find((p) => p.uid === uid) || null;
      return { ...team, players: separated };
    });

    cb({ ...current, teams: nextTeams });
    if (updatedPlayer && selectedSlotRef.current?.player.uid === uid) {
      setSelectedSlot({ teamIndex, player: updatedPlayer });
    }
    setShowPopover(false);
    setPopoverMode('menu');
  };

  const movePlayerToTeamAtCoords = (
    sourceTeamIndex: number,
    uid: string,
    targetTeamIndex: number,
    pitchX?: number,
    pitchY?: number,
    newPosition?: string
  ) => {
    const cb = onFormationChangeRef.current;
    if (!editableRef.current || !cb || viewingOriginalRef.current) return;

    const current = formationRef.current;
    const nextTeams = current.teams.map((team) => ({
      ...team,
      players: team.players.map((p) => ({ ...p })),
    }));

    const sourceTeam = nextTeams.find((t) => t.teamIndex === sourceTeamIndex);
    const targetTeam = nextTeams.find((t) => t.teamIndex === targetTeamIndex);
    if (!sourceTeam || !targetTeam) return;

    const idx = sourceTeam.players.findIndex((p) => p.uid === uid);
    if (idx === -1) return;

    const [moved] = sourceTeam.players.splice(idx, 1);
    if (typeof pitchX === 'number' && typeof pitchY === 'number') {
      moved.pitchX = pitchX;
      moved.pitchY = pitchY;
      moved.assignedPosition = newPosition || detectPositionFromCoords(pitchX, pitchY);
    } else if (newPosition) {
      const targetCoords = POSITION_TARGET_COORDS[newPosition];
      moved.assignedPosition = newPosition;
      if (targetCoords) {
        moved.pitchX = targetCoords.x;
        moved.pitchY = targetCoords.y;
      }
    }

    targetTeam.players.push(moved);
    targetTeam.players = resolveTeamOverlaps(targetTeam.players, moved.uid);

    const finalMoved = targetTeam.players.find((p) => p.uid === moved.uid) || moved;
    cb({ ...current, teams: nextTeams });
    setSelectedSlot({ teamIndex: targetTeamIndex, player: finalMoved });
  };

  const swapTwoPlayers = (
    teamAIndex: number,
    uidA: string,
    teamBIndex: number,
    uidB: string
  ) => {
    const cb = onFormationChangeRef.current;
    if (!editableRef.current || !cb || viewingOriginalRef.current) return;

    const current = formationRef.current;
    const nextTeams = current.teams.map((team) => ({
      ...team,
      players: team.players.map((p) => ({ ...p })),
    }));

    const teamA = nextTeams.find((t) => t.teamIndex === teamAIndex);
    const teamB = nextTeams.find((t) => t.teamIndex === teamBIndex);
    if (!teamA || !teamB) return;

    const idxA = teamA.players.findIndex((p) => p.uid === uidA);
    const idxB = teamB.players.findIndex((p) => p.uid === uidB);
    if (idxA === -1 || idxB === -1) return;

    const playerA = teamA.players[idxA];
    const playerB = teamB.players[idxB];

    const slotAProps = {
      assignedPosition: playerA.assignedPosition,
      pitchX: playerA.pitchX,
      pitchY: playerA.pitchY,
    };
    const slotBProps = {
      assignedPosition: playerB.assignedPosition,
      pitchX: playerB.pitchX,
      pitchY: playerB.pitchY,
    };

    const swappedIntoA: FormationPlayerSlot = { ...playerB, ...slotAProps };
    const swappedIntoB: FormationPlayerSlot = { ...playerA, ...slotBProps };

    if (teamAIndex === teamBIndex) {
      teamA.players[idxA] = swappedIntoA;
      teamA.players[idxB] = swappedIntoB;
    } else {
      teamA.players.splice(idxA, 1, swappedIntoA);
      teamB.players.splice(idxB, 1, swappedIntoB);
    }

    cb({ ...current, teams: nextTeams });
    setSelectedSlot({ teamIndex: teamBIndex, player: swappedIntoB });
    setShowPopover(false);
    setPopoverMode('menu');
  };

  useEffect(() => {
    if (!dragState) return;

    const handlePointerMove = (e: PointerEvent) => {
      const current = dragRef.current;
      if (!current) return;

      const dist = Math.hypot(e.clientX - current.startClientX, e.clientY - current.startClientY);
      if (!current.moved && dist < 4) return;

      if (!current.moved) {
        setShowPopover(false);
        setPopoverMode('menu');
      }

      let hoverTeamIndex: number | null = null;
      let targetPitchX = current.targetPitchX;
      let targetPitchY = current.targetPitchY;

      for (const t of formationRef.current.teams) {
        const el = pitchRefs.current[t.teamIndex];
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        if (
          e.clientX >= rect.left &&
          e.clientX <= rect.right &&
          e.clientY >= rect.top &&
          e.clientY <= rect.bottom
        ) {
          hoverTeamIndex = t.teamIndex;
          const rawX = ((e.clientX - rect.left) / rect.width) * 100;
          const rawY = ((e.clientY - rect.top) / rect.height) * 100;
          targetPitchX = Math.round(Math.max(8, Math.min(92, rawX)) * 10) / 10;
          targetPitchY = Math.round(Math.max(8, Math.min(92, rawY)) * 10) / 10;
          break;
        }
      }

      const updated: ActiveDragState = {
        ...current,
        clientX: e.clientX,
        clientY: e.clientY,
        hoverTeamIndex,
        targetPitchX,
        targetPitchY,
        pitchX: hoverTeamIndex === current.sourceTeamIndex ? targetPitchX : current.pitchX,
        pitchY: hoverTeamIndex === current.sourceTeamIndex ? targetPitchY : current.pitchY,
        moved: true,
      };
      dragRef.current = updated;
      setDragState(updated);
    };

    const finishDrag = () => {
      const current = dragRef.current;
      dragRef.current = null;
      setDragState(null);
      if (!current) return;

      const sourceTeam = formationRef.current.teams.find(
        (t) => t.teamIndex === current.sourceTeamIndex
      );
      const slot = sourceTeam?.players.find((p) => p.uid === current.uid);

      if (current.moved) {
        lastDragEndedAtRef.current = performance.now();
        setShowPopover(false);
        setPopoverMode('menu');
        if (
          current.hoverTeamIndex !== null &&
          current.hoverTeamIndex !== current.sourceTeamIndex
        ) {
          movePlayerToTeamAtCoords(
            current.sourceTeamIndex,
            current.uid,
            current.hoverTeamIndex,
            current.targetPitchX,
            current.targetPitchY
          );
        } else if (current.hoverTeamIndex === current.sourceTeamIndex) {
          applyPitchMoveWithAutoRole(
            current.sourceTeamIndex,
            current.uid,
            current.targetPitchX,
            current.targetPitchY
          );
        } else if (slot) {
          setSelectedSlot({
            teamIndex: current.sourceTeamIndex,
            player: slot,
          });
        }
      } else if (slot) {
        const curSelected = selectedSlotRef.current;
        const isSameSelected =
          curSelected?.player.uid === slot.uid &&
          curSelected?.teamIndex === current.sourceTeamIndex;
        if (isSameSelected && showPopoverRef.current) {
          setShowPopover(false);
          setPopoverMode('menu');
        } else {
          setSelectedSlot({ teamIndex: current.sourceTeamIndex, player: slot });
          setPopoverMode('menu');
          setShowPopover(true);
        }
      }
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', finishDrag);
    window.addEventListener('pointercancel', finishDrag);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', finishDrag);
      window.removeEventListener('pointercancel', finishDrag);
    };
  }, [Boolean(dragState)]);

  const positionOptions = Array.from(new Set([...QUICK_PITCH_POSITIONS, ...SOCCER_POSITIONS]));

  const floatingGhostTeam =
    dragState && dragState.moved && dragState.hoverTeamIndex !== dragState.sourceTeamIndex
      ? activeFormation.teams.find((t) => t.teamIndex === dragState.hoverTeamIndex) || null
      : null;
  const floatingGhostColor = floatingGhostTeam?.color || dragState?.sourceColor || 'Red';
  const floatingGhostTeamIndex = floatingGhostTeam?.teamIndex ?? dragState?.sourceTeamIndex ?? 0;

  return (
    <div className="space-y-6">
      {/* Compact Original AI Toggle Bar (only when original AI snapshot exists) */}
      {originalFormation && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg border border-slate-200">
            <button
              type="button"
              onClick={() => {
                setViewingOriginal(false);
                setSelectedSlot(null);
                setShowPopover(false);
              }}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                !viewingOriginal ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Current Roster
            </button>
            <button
              type="button"
              onClick={() => {
                setViewingOriginal(true);
                setSelectedSlot(null);
                setShowPopover(false);
              }}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                viewingOriginal ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Original AI Plan
            </button>
          </div>

          {editable && onRestoreOriginal && viewingOriginal && (
            <button
              type="button"
              onClick={() => {
                onRestoreOriginal();
                setViewingOriginal(false);
              }}
              className="px-3.5 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset
            </button>
          )}
        </div>
      )}

      {/* Soccer Pitches Grid */}
      <div
        className={`grid grid-cols-1 ${
          compactGrid ? 'sm:grid-cols-2 gap-3' : 'md:grid-cols-2 gap-4 max-w-5xl'
        }`}
      >
        {activeFormation.teams.map((team) => {
          const stats = computeTeamAverages(team);
          const isDropTarget =
            Boolean(dragState?.moved) &&
            dragState?.hoverTeamIndex === team.teamIndex &&
            dragState?.sourceTeamIndex !== team.teamIndex;

          return (
            <div key={team.teamIndex} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              {/* Team Header Strip */}
              {showTeamHeader && (
                <div className="px-3.5 py-2.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <TeamJerseyIcon color={team.color} size={22} className="shrink-0" />
                    <div>
                      <h3 className="font-display text-base font-bold tracking-tight text-slate-900 leading-tight">
                        {team.teamName}
                      </h3>
                      <p className="text-[11px] text-slate-500">
                        {showFormationShape ? `${team.formationShape} · ` : ''}{team.players.length} players
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2.5 text-xs text-slate-700">
                    {showAvgAge && (
                      <span className="font-mono-tabular text-[11px] text-slate-500" title="Average squad age">
                        Age {team.players.length > 0 ? stats.avgAge.toFixed(1) : '—'}
                      </span>
                    )}
                    {showRatings && (
                      <>
                        <div className="inline-flex items-center gap-1" title="Average squad overall">
                          <SkillArrowBadge
                            skill={stats.avgOverall}
                            compact={true}
                            variant="light"
                            thresholds={resolvedThresholds}
                          />
                          <span className="font-mono-tabular text-[11px] font-semibold text-slate-800">
                            {Math.round(stats.avgOverall)}
                          </span>
                        </div>
                        <div className="inline-flex items-center gap-1" title="Average squad stamina">
                          <div className="relative w-4 h-4">
                            <StaminaPerimeterRing stamina={stats.avgStamina} size={16} variant="light" />
                          </div>
                          <span className="font-mono-tabular text-[11px] font-semibold text-slate-800">
                            {Math.round(stats.avgStamina)}
                          </span>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* Tactical 2D Soccer Pitch (compact proportion so fields fit comfortably on one screen) */}
              <div>
                <div
                  ref={(el) => {
                    pitchRefs.current[team.teamIndex] = el;
                  }}
                  className={`relative w-full ${
                    compactGrid ? 'aspect-[11/10]' : 'aspect-[10/10]'
                  } pitch-stripes select-none transition-shadow ${
                    isDropTarget
                      ? 'ring-4 ring-inset ring-amber-300/85'
                      : ''
                  }`}
                  onClick={(e) => {
                    if (performance.now() - lastDragEndedAtRef.current < 150) {
                      return;
                    }
                    const targetEl = e.target as HTMLElement | null;
                    if (
                      targetEl?.closest('[data-player-marker="true"]') ||
                      targetEl?.closest('[data-pos-popover="true"]')
                    ) {
                      return;
                    }
                    if (
                      editable &&
                      !viewingOriginal &&
                      selectedSlot &&
                      selectedSlot.teamIndex === team.teamIndex
                    ) {
                      const rect = e.currentTarget.getBoundingClientRect();
                      const rawX = ((e.clientX - rect.left) / rect.width) * 100;
                      const rawY = ((e.clientY - rect.top) / rect.height) * 100;
                      const x = Math.round(Math.max(8, Math.min(92, rawX)) * 10) / 10;
                      const y = Math.round(Math.max(8, Math.min(92, rawY)) * 10) / 10;
                      setShowPopover(false);
                      setPopoverMode('menu');
                      applyPitchMoveWithAutoRole(team.teamIndex, selectedSlot.player.uid, x, y);
                    }
                  }}
                >
                  {/* Pitch Markings SVG */}
                  <svg
                    viewBox="0 0 100 110"
                    preserveAspectRatio="none"
                    className="absolute inset-0 w-full h-full pointer-events-none rounded-lg overflow-hidden"
                  >
                    <rect x="22" y="0" width="56" height="16" fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth="0.6" />
                    <rect x="36" y="0" width="28" height="6" fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth="0.6" />
                    <line x1="0" y1="55" x2="100" y2="55" stroke="rgba(255,255,255,0.4)" strokeWidth="0.6" />
                    <circle cx="50" cy="55" r="11" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="0.6" />
                    <circle cx="50" cy="55" r="0.8" fill="rgba(255,255,255,0.65)" />
                    <rect x="22" y="94" width="56" height="16" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="0.6" />
                    <rect x="36" y="104" width="28" height="6" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="0.6" />
                  </svg>

                  {/* Cross-team drop landing preview indicator */}
                  {isDropTarget && dragState && (
                    <div
                      style={{
                        left: `${dragState.targetPitchX}%`,
                        top: `${dragState.targetPitchY}%`,
                      }}
                      className="absolute -translate-x-1/2 -translate-y-1/2 pointer-events-none z-10 opacity-65 drop-shadow-[0_0_8px_rgba(251,191,36,0.95)]"
                    >
                      <TeamJerseyIcon color={team.color} size={42} onPitch={true} highlighted={true} />
                    </div>
                  )}

                  {/* Players on Pitch */}
                  {team.players.map((slot) => {
                    const profile = playersById.get(slot.uid);
                    const isSelected =
                      selectedSlot?.player.uid === slot.uid &&
                      selectedSlot?.teamIndex === team.teamIndex;
                    const isDraggingThis =
                      dragState?.sourceTeamIndex === team.teamIndex &&
                      dragState?.uid === slot.uid;
                    const isDraggedOutsideSource =
                      isDraggingThis &&
                      dragState.moved &&
                      dragState.hoverTeamIndex !== team.teamIndex;

                    const activeX =
                      isDraggingThis && dragState.moved && dragState.hoverTeamIndex === team.teamIndex
                        ? dragState.pitchX
                        : slot.pitchX;
                    const activeY =
                      isDraggingThis && dragState.moved && dragState.hoverTeamIndex === team.teamIndex
                        ? dragState.pitchY
                        : slot.pitchY;

                    const livePreviewPosition =
                      isDraggingThis && dragState.moved
                        ? detectPositionFromCoords(
                            dragState.hoverTeamIndex === team.teamIndex
                              ? dragState.pitchX
                              : dragState.targetPitchX,
                            dragState.hoverTeamIndex === team.teamIndex
                              ? dragState.pitchY
                              : dragState.targetPitchY
                          )
                        : slot.assignedPosition;

                    const lastName = slot.name.split(' ').slice(-1)[0] || slot.name;
                    const initials =
                      slot.name
                        .split(/\s+/)
                        .filter(Boolean)
                        .map((part) => part[0])
                        .join('')
                        .slice(0, 2)
                        .toUpperCase() || lastName.slice(0, 2).toUpperCase();
                    const bestPositions = (
                      bestPositionsById?.get(slot.uid) ||
                      profile?.favoritePositions ||
                      []
                    )
                      .filter(Boolean)
                      .slice(0, 3);
                    const canDrag = editable && !viewingOriginal;

                    const popoverVertical = activeY > 52 ? 'bottom-full mb-2' : 'top-full mt-2';
                    const popoverHorizontal =
                      activeX < 25
                        ? 'left-0'
                        : activeX > 75
                          ? 'right-0'
                          : 'left-1/2 -translate-x-1/2';

                    const similarPlayers =
                      isSelected && showPopover && popoverMode === 'similar'
                        ? findSimilarPlayers(slot, team.teamIndex, activeFormation.teams)
                        : [];

                    return (
                      <div
                        key={slot.uid}
                        role={canDrag ? 'button' : undefined}
                        tabIndex={canDrag ? 0 : undefined}
                        data-player-marker="true"
                        onPointerDown={(e) => {
                          if (!canDrag) return;
                          if (e.pointerType === 'mouse' && e.button !== 0) return;
                          if ((e.target as HTMLElement | null)?.closest('[data-pos-popover="true"]')) {
                            return;
                          }
                          e.preventDefault();
                          e.stopPropagation();
                          const nextDrag: ActiveDragState = {
                            sourceTeamIndex: team.teamIndex,
                            uid: slot.uid,
                            player: slot,
                            sourceColor: team.color,
                            startClientX: e.clientX,
                            startClientY: e.clientY,
                            clientX: e.clientX,
                            clientY: e.clientY,
                            pitchX: slot.pitchX,
                            pitchY: slot.pitchY,
                            hoverTeamIndex: team.teamIndex,
                            targetPitchX: slot.pitchX,
                            targetPitchY: slot.pitchY,
                            moved: false,
                          };
                          dragRef.current = nextDrag;
                          setDragState(nextDrag);
                        }}
                        onKeyDown={(e) => {
                          if (canDrag && (e.key === 'Enter' || e.key === ' ')) {
                            e.preventDefault();
                            setSelectedSlot({ teamIndex: team.teamIndex, player: slot });
                            setPopoverMode('menu');
                            setShowPopover(true);
                          }
                        }}
                        style={{
                          left: `${activeX}%`,
                          top: `${activeY}%`,
                        }}
                        className={`absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center group touch-none select-none ${
                          isDraggedOutsideSource ? 'opacity-25 pointer-events-none' : ''
                        } ${
                          isDraggingThis && dragState.moved
                            ? 'transition-none z-30 scale-105 cursor-grabbing'
                            : isSelected
                              ? 'transition-all duration-300 ease-out z-30 ' +
                                (canDrag ? 'cursor-grab' : 'cursor-default')
                              : 'transition-all duration-300 ease-out z-10 ' +
                                (canDrag ? 'cursor-grab hover:scale-105' : 'cursor-default')
                        }`}
                      >
                        {/* Broadcast Lineup Player Token */}
                        <PitchPlayerJersey
                          color={team.color}
                          teamIndex={team.teamIndex}
                          playerName={slot.name}
                          displayName={lastName}
                          age={slot.age}
                          initials={initials}
                          photoUrl={profile?.approvedPitchPhotoUrl || profile?.approvedPhotoUrl}
                          skinTone={profile?.pitchSkinTone}
                          position={livePreviewPosition}
                          skill={slot.avgOverall ?? slot.avgSkill}
                          stamina={slot.avgStamina}
                          goalieOption={slot.goalieOption}
                          showRatings={showRatings}
                          skillArrowThresholds={resolvedThresholds}
                          highlighted={isSelected || Boolean(isDraggingThis && dragState.moved)}
                          compact={compactTokens}
                          goals={goalsByUid?.get(slot.uid) || 0}
                        />

                        {/* Preferred Positions Sub-line (Manager view only, never on Matchday) */}
                        {showPreferredPositions && bestPositions.length > 0 && (
                          <div className="mt-0.5 text-center pointer-events-none whitespace-nowrap drop-shadow-[0_1px_2px_rgba(0,0,0,0.95)] leading-tight">
                            <div className="text-[8px] font-mono-tabular font-semibold text-white/90 tracking-wide">
                              {bestPositions.join(' · ')}
                            </div>
                          </div>
                        )}

                        {/* Click Popover: 2-option menu (Position / Similar Players) */}
                        {isSelected &&
                          showPopover &&
                          canDrag &&
                          !(isDraggingThis && dragState.moved) && (
                            <div
                              data-pos-popover="true"
                              onPointerDown={(e) => e.stopPropagation()}
                              onClick={(e) => e.stopPropagation()}
                              className={`absolute ${popoverVertical} ${popoverHorizontal} p-2.5 rounded-lg bg-slate-950/95 border border-slate-700 shadow-xl z-40 ${
                                popoverMode === 'similar' ? 'w-60' : 'w-48'
                              }`}
                            >
                              {popoverMode === 'menu' && (
                                <div className="space-y-1.5">
                                  <div className="flex items-center justify-between px-0.5 pb-1 border-b border-slate-800">
                                    <span className="text-[11px] font-semibold text-white truncate">
                                      {slot.name}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => setShowPopover(false)}
                                      className="text-slate-400 hover:text-white p-0.5"
                                      aria-label="Close menu"
                                    >
                                      <X className="w-3 h-3" />
                                    </button>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => setPopoverMode('position')}
                                    className="w-full px-2.5 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold flex items-center justify-between transition-colors"
                                  >
                                    <span>Position</span>
                                    <span className="font-mono-tabular text-emerald-400 text-[11px]">
                                      {slot.assignedPosition}
                                    </span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setPopoverMode('similar')}
                                    className="w-full px-2.5 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold flex items-center justify-between transition-colors"
                                  >
                                    <span>Similar Players</span>
                                    <Users className="w-3.5 h-3.5 text-sky-400" />
                                  </button>
                                </div>
                              )}

                              {popoverMode === 'position' && (
                                <div>
                                  <div className="flex items-center justify-between mb-1.5 px-0.5">
                                    <button
                                      type="button"
                                      onClick={() => setPopoverMode('menu')}
                                      className="text-[10px] font-semibold text-slate-300 hover:text-white inline-flex items-center gap-1"
                                    >
                                      <ArrowLeft className="w-3 h-3" />
                                      Position
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setShowPopover(false);
                                        setPopoverMode('menu');
                                      }}
                                      className="text-slate-400 hover:text-white p-0.5"
                                      aria-label="Close position selector"
                                    >
                                      <X className="w-3 h-3" />
                                    </button>
                                  </div>
                                  <div className="grid grid-cols-4 gap-1">
                                    {QUICK_PITCH_POSITIONS.map((pos) => (
                                      <button
                                        key={pos}
                                        type="button"
                                        onClick={() => applyPlayerPosition(team.teamIndex, slot.uid, pos)}
                                        className={`py-1 px-1 rounded text-[10px] font-mono-tabular font-semibold transition-colors ${
                                          slot.assignedPosition === pos
                                            ? 'bg-emerald-600 text-white'
                                            : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
                                        }`}
                                      >
                                        {pos}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {popoverMode === 'similar' && (
                                <div>
                                  <div className="flex items-center justify-between mb-1.5 px-0.5">
                                    <button
                                      type="button"
                                      onClick={() => setPopoverMode('menu')}
                                      className="text-[10px] font-semibold text-slate-300 hover:text-white inline-flex items-center gap-1"
                                    >
                                      <ArrowLeft className="w-3 h-3" />
                                      Similar Players
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setShowPopover(false);
                                        setPopoverMode('menu');
                                      }}
                                      className="text-slate-400 hover:text-white p-0.5"
                                      aria-label="Close similar players"
                                    >
                                      <X className="w-3 h-3" />
                                    </button>
                                  </div>
                                  {similarPlayers.length === 0 ? (
                                    <p className="text-[11px] text-slate-400 py-2 text-center">
                                      No other players available.
                                    </p>
                                  ) : (
                                    <div className="space-y-1">
                                      {similarPlayers.map((cand) => (
                                          <button
                                            key={cand.player.uid}
                                            type="button"
                                            onClick={() =>
                                              swapTwoPlayers(
                                                team.teamIndex,
                                                slot.uid,
                                                cand.teamIndex,
                                                cand.player.uid
                                              )
                                            }
                                            title="Click to swap with this player"
                                            className="w-full px-2 py-1.5 rounded-md bg-slate-900 hover:bg-slate-800 border border-slate-800 text-left flex items-center justify-between gap-2 transition-colors"
                                          >
                                            <div className="min-w-0 flex items-center gap-1.5">
                                              <TeamJerseyIcon
                                                color={cand.teamColor}
                                                size={16}
                                                className="shrink-0"
                                              />
                                              <span className="text-[11px] font-medium text-white truncate">
                                                ({cand.player.age}) {cand.player.name}
                                              </span>
                                            </div>
                                            <div className="flex items-center gap-1.5 shrink-0">
                                              <span className="text-[10px] font-mono-tabular text-slate-300">
                                                {cand.player.assignedPosition}
                                              </span>
                                              <SkillArrowBadge
                                                skill={cand.player.avgOverall ?? cand.player.avgSkill}
                                                compact={true}
                                                thresholds={resolvedThresholds}
                                              />
                                            </div>
                                          </button>
                                        ))}
                                      <div className="text-[10px] text-slate-400 pt-1 text-center">
                                        Click a player to swap positions
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                      </div>
                    );
                  })}
                </div>
                {editable && !viewingOriginal && (
                  <p className="text-[10px] text-slate-500 py-1.5 px-3 bg-slate-50 border-t border-slate-200 text-center">
                    Drag players across zones or teams · Click player to edit
                  </p>
                )}
              </div>

              {/* Roster Data Table (Compact 3-letter Radar Stats + OVR, no Pos/Age) */}
              {showRosterTable && (
                <div className="overflow-x-auto border-t border-slate-200">
                  <table className="w-full text-left text-[11px]">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                      <tr>
                        <th className="py-1.5 pl-3 pr-2 font-semibold">Player</th>
                        {showRatings && (
                          <>
                            <th className="py-1.5 px-1.5 font-semibold text-center" title="Overall">OVR</th>
                            <th className="py-1.5 px-1 font-semibold text-center" title="Attack">ATT</th>
                            <th className="py-1.5 px-1 font-semibold text-center" title="Technique">TEC</th>
                            <th className="py-1.5 px-1 font-semibold text-center" title="Stamina">STA</th>
                            <th className="py-1.5 px-1 font-semibold text-center" title="Defense">DEF</th>
                            <th className="py-1.5 px-1 font-semibold text-center" title="Speed">SPD</th>
                            <th className="py-1.5 pl-1 pr-2.5 font-semibold text-center" title="Physics">PHY</th>
                          </>
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {team.players.map((p) => {
                        const ovr = p.avgOverall ?? p.avgSkill;
                        const att = p.avgAttack ?? p.avgSkill;
                        const tec = p.avgTechnique ?? p.avgSkill;
                        const sta = p.avgStamina;
                        const def = p.avgDefense ?? p.avgSkill;
                        const spd = p.avgSpeed ?? p.avgSkill;
                        const phy = p.avgPhysics ?? p.avgSkill;

                        return (
                          <tr
                            key={p.uid}
                            onClick={() => {
                              if (editable && !viewingOriginal) {
                                setSelectedSlot({ teamIndex: team.teamIndex, player: p });
                                setPopoverMode('menu');
                                setShowPopover(true);
                              }
                            }}
                            className={`hover:bg-slate-50 ${
                              editable && !viewingOriginal ? 'cursor-pointer' : ''
                            }`}
                          >
                            <td className="py-1.5 pl-3 pr-2 font-medium text-slate-900 whitespace-nowrap">
                              {p.name}
                              {p.goalieOption === 'only_goalie' && (
                                <span className="ml-1 text-[10px] text-amber-700 font-semibold">(GK)</span>
                              )}
                              {p.goalieOption === 'willing' && (
                                <span className="ml-1 text-[10px] text-slate-500">(W-GK)</span>
                              )}
                            </td>
                            {showRatings && (
                              <>
                                <td className="py-1.5 px-1.5 text-center">
                                  <div className="inline-flex items-center justify-center gap-1">
                                    <SkillArrowBadge
                                      skill={ovr}
                                      compact={true}
                                      variant="light"
                                      thresholds={resolvedThresholds}
                                    />
                                    <span className="font-mono-tabular text-[11px] font-bold text-slate-900">
                                      {Math.round(ovr)}
                                    </span>
                                  </div>
                                </td>
                                <td className="py-1.5 px-1 text-center font-mono-tabular text-slate-700">
                                  {Math.round(att)}
                                </td>
                                <td className="py-1.5 px-1 text-center font-mono-tabular text-slate-700">
                                  {Math.round(tec)}
                                </td>
                                <td className="py-1.5 px-1 text-center font-mono-tabular text-slate-700">
                                  {Math.round(sta)}
                                </td>
                                <td className="py-1.5 px-1 text-center font-mono-tabular text-slate-700">
                                  {Math.round(def)}
                                </td>
                                <td className="py-1.5 px-1 text-center font-mono-tabular text-slate-700">
                                  {Math.round(spd)}
                                </td>
                                <td className="py-1.5 pl-1 pr-2.5 text-center font-mono-tabular text-slate-700">
                                  {Math.round(phy)}
                                </td>
                              </>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                    {showRatings && team.players.length > 0 && (
                      <tfoot className="bg-slate-50 border-t border-slate-200 text-slate-900 font-semibold">
                        <tr>
                          <td className="py-1.5 pl-3 pr-2 text-[11px]">Avg</td>
                          <td className="py-1.5 px-1.5 text-center font-mono-tabular text-[11px] font-bold text-emerald-800">
                            {Math.round(stats.avgOverall)}
                          </td>
                          <td className="py-1.5 px-1 text-center font-mono-tabular text-[11px] text-slate-700">
                            {Math.round(stats.avgAttack)}
                          </td>
                          <td className="py-1.5 px-1 text-center font-mono-tabular text-[11px] text-slate-700">
                            {Math.round(stats.avgTechnique)}
                          </td>
                          <td className="py-1.5 px-1 text-center font-mono-tabular text-[11px] text-slate-700">
                            {Math.round(stats.avgStamina)}
                          </td>
                          <td className="py-1.5 px-1 text-center font-mono-tabular text-[11px] text-slate-700">
                            {Math.round(stats.avgDefense)}
                          </td>
                          <td className="py-1.5 px-1 text-center font-mono-tabular text-[11px] text-slate-700">
                            {Math.round(stats.avgSpeed)}
                          </td>
                          <td className="py-1.5 pl-1 pr-2.5 text-center font-mono-tabular text-[11px] text-slate-700">
                            {Math.round(stats.avgPhysics)}
                          </td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Floating Cursor Ghost while dragging across pitches */}
      {dragState && dragState.moved && dragState.hoverTeamIndex !== dragState.sourceTeamIndex && (
        <div
          style={{
            left: `${dragState.clientX}px`,
            top: `${dragState.clientY}px`,
          }}
          className="fixed -translate-x-1/2 -translate-y-1/2 pointer-events-none z-50 flex flex-col items-center scale-110"
        >
          <PitchPlayerJersey
            color={floatingGhostColor}
            teamIndex={floatingGhostTeamIndex}
            playerName={dragState.player.name}
            displayName={dragState.player.name.split(' ').slice(-1)[0] || dragState.player.name}
            age={dragState.player.age}
            initials={
              dragState.player.name
                .split(/\s+/)
                .filter(Boolean)
                .map((part) => part[0])
                .join('')
                .slice(0, 2)
                .toUpperCase() || 'PL'
            }
            photoUrl={
              playersById.get(dragState.uid)?.approvedPitchPhotoUrl ||
              playersById.get(dragState.uid)?.approvedPhotoUrl
            }
            skinTone={playersById.get(dragState.uid)?.pitchSkinTone}
            position={
              floatingGhostTeam
                ? detectPositionFromCoords(dragState.targetPitchX, dragState.targetPitchY)
                : dragState.player.assignedPosition
            }
            skill={dragState.player.avgOverall ?? dragState.player.avgSkill}
            stamina={dragState.player.avgStamina}
            goalieOption={dragState.player.goalieOption}
            showRatings={showRatings}
            skillArrowThresholds={resolvedThresholds}
            highlighted={true}
            transferLabel={floatingGhostTeam ? `→ ${floatingGhostTeam.color}` : undefined}
          />
        </div>
      )}
    </div>
  );
};
