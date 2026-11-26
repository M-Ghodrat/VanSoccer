import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { User } from 'firebase/auth';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { AnimatePresence, motion, PanInfo, useReducedMotion } from 'framer-motion';
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Loader2,
  RotateCcw,
  Save,
  Search,
  UserCheck,
  X,
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import {
  DropInMatch,
  normalizeSkillArrowThresholds,
  PlayerProfile,
  PlayerRating,
  POSITION_LABELS,
  RADAR_STAT_KEYS,
  RADAR_STAT_META,
  RadarStatKey,
  SkillArrowThresholds,
  SOCCER_POSITIONS,
} from '../types';
import { aggregatePlayerRatings } from '../utils/clubUtils';
import { PlayerStatsRadar } from './PlayerStatsRadar';
import { SkillArrowBadge, StaminaPerimeterRing } from './SoccerPitch';

interface PlayerRatingDeckProps {
  user: User;
  profile: PlayerProfile;
  players: PlayerProfile[];
  ratings: PlayerRating[];
  completedMatches: DropInMatch[];
  skillArrowThresholds?: SkillArrowThresholds;
  canEdit?: boolean;
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

interface SinglePlayerCardProps {
  user: User;
  managerProfile: PlayerProfile;
  player: PlayerProfile;
  playerRatings: PlayerRating[];
  mvpCount: number;
  topScorerCount: number;
  currentIndex: number;
  totalCount: number;
  hasNext: boolean;
  skillArrowThresholds: SkillArrowThresholds;
  canEdit: boolean;
  onAdvanceNext: () => void;
}

const getRatingTierStyle = (
  val: number | null,
  thresholds: SkillArrowThresholds
) => {
  const [t0, t1, t2, t3] = thresholds;
  if (val === null) {
    return {
      fillBg: 'bg-slate-300',
      thumbBorder: 'border-slate-400',
      textAccent: 'text-slate-500',
    };
  }
  if (val > t3) {
    return {
      fillBg: 'bg-emerald-500',
      thumbBorder: 'border-emerald-600',
      textAccent: 'text-emerald-700',
    };
  }
  if (val > t2) {
    return {
      fillBg: 'bg-sky-500',
      thumbBorder: 'border-sky-600',
      textAccent: 'text-sky-700',
    };
  }
  if (val >= t1) {
    return {
      fillBg: 'bg-amber-500',
      thumbBorder: 'border-amber-600',
      textAccent: 'text-amber-700',
    };
  }
  if (val >= t0) {
    return {
      fillBg: 'bg-orange-500',
      thumbBorder: 'border-orange-600',
      textAccent: 'text-orange-700',
    };
  }
  return {
    fillBg: 'bg-rose-500',
    thumbBorder: 'border-rose-600',
    textAccent: 'text-rose-700',
  };
};

interface CompactStatSliderProps {
  id: string;
  label: string;
  shortLabel?: string;
  valueStr: string;
  numericValue: number | null;
  thresholds: SkillArrowThresholds;
  onValueChange: (next: string) => void;
  ariaLabel: string;
  prominent?: boolean;
}

const CompactStatSlider: React.FC<CompactStatSliderProps> = ({
  id,
  label,
  shortLabel,
  valueStr,
  numericValue,
  thresholds,
  onValueChange,
  ariaLabel,
  prominent = false,
}) => {
  const tier = getRatingTierStyle(numericValue, thresholds);
  const thumbPct = numericValue ?? 50;

  return (
    <div className={prominent ? 'space-y-1.5' : 'space-y-1'}>
      <div className="flex items-center justify-between gap-1.5">
        <label
          htmlFor={id}
          className={`font-semibold leading-none ${
            prominent ? 'text-xs text-slate-900' : 'text-[11px] text-slate-700'
          }`}
        >
          {label}
          {shortLabel && (
            <span className="ml-1 font-mono-tabular text-[10px] font-bold text-slate-400">
              {shortLabel}
            </span>
          )}
        </label>
        <input
          id={id}
          type="number"
          min={0}
          max={100}
          step={1}
          placeholder="—"
          value={valueStr}
          onChange={(e) => {
            const val = e.target.value;
            if (val === '' || (/^\d{0,3}$/.test(val) && Number(val) <= 100)) {
              onValueChange(val);
            }
          }}
          className={`px-1.5 py-0.5 rounded-md border border-slate-300 font-mono-tabular font-bold text-center bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-600 ${
            prominent ? 'w-14 text-sm text-slate-950' : 'w-11 text-[11px] text-slate-900'
          }`}
        />
      </div>

      {/* Unified Color-Changing Bar + Interactive Range Slider */}
      <div className={`relative flex items-center select-none ${prominent ? 'h-5' : 'h-4'}`}>
        <div
          className={`w-full rounded-full bg-slate-200/90 overflow-hidden shadow-inner ${
            prominent ? 'h-2.5' : 'h-1.5'
          }`}
        >
          <div
            className={`h-full rounded-full transition-[width,background-color] duration-150 ${tier.fillBg}`}
            style={{ width: `${numericValue ?? 0}%` }}
          />
        </div>
        <div
          className={`pointer-events-none absolute top-1/2 -translate-y-1/2 -translate-x-1/2 rounded-full bg-white border-2 shadow-sm transition-colors duration-150 ${
            prominent ? 'w-4 h-4' : 'w-3.5 h-3.5'
          } ${numericValue === null ? 'border-slate-400 opacity-55' : tier.thumbBorder}`}
          style={{ left: `calc(${thumbPct}% + ${7 - thumbPct * 0.14}px)` }}
        />
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={thumbPct}
          onChange={(e) => onValueChange(e.target.value)}
          aria-label={ariaLabel}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
        />
      </div>
    </div>
  );
};

interface ReadOnlyStatBarProps {
  label: string;
  shortLabel?: string;
  numericValue: number | null;
  thresholds: SkillArrowThresholds;
  prominent?: boolean;
}

const ReadOnlyStatBar: React.FC<ReadOnlyStatBarProps> = ({
  label,
  shortLabel,
  numericValue,
  thresholds,
  prominent = false,
}) => {
  const tier = getRatingTierStyle(numericValue, thresholds);

  return (
    <div className={prominent ? 'space-y-1.5' : 'space-y-1'}>
      <div className="flex items-center justify-between gap-1.5">
        <span
          className={`font-semibold leading-none ${
            prominent ? 'text-xs text-slate-900' : 'text-[11px] text-slate-700'
          }`}
        >
          {label}
          {shortLabel && (
            <span className="ml-1 font-mono-tabular text-[10px] font-bold text-slate-400">
              {shortLabel}
            </span>
          )}
        </span>
        <span
          className={`font-mono-tabular font-bold leading-none ${
            prominent ? 'text-sm text-slate-950' : 'text-xs'
          } ${numericValue !== null ? tier.textAccent : 'text-slate-400'}`}
        >
          {numericValue !== null ? Math.round(numericValue) : '—'}
        </span>
      </div>

      <div
        className={`w-full rounded-full bg-slate-200/90 overflow-hidden ${
          prominent ? 'h-2.5' : 'h-1.5'
        }`}
      >
        <div
          className={`h-full rounded-full transition-[width,background-color] duration-200 ${tier.fillBg}`}
          style={{ width: `${numericValue ?? 0}%` }}
        />
      </div>
    </div>
  );
};

const parseRatingStr = (str: string): number | null => {
  if (str.trim() === '') return null;
  const n = Number(str);
  if (Number.isNaN(n)) return null;
  return Math.max(0, Math.min(100, n));
};

const SinglePlayerCard: React.FC<SinglePlayerCardProps> = ({
  user,
  managerProfile,
  player,
  playerRatings,
  mvpCount,
  topScorerCount,
  currentIndex,
  totalCount,
  hasNext,
  skillArrowThresholds,
  canEdit,
  onAdvanceNext,
}) => {
  const myRating = useMemo(
    () => (canEdit ? playerRatings.find((r) => r.managerId === user.uid) || null : null),
    [canEdit, playerRatings, user.uid]
  );

  const hasAnyRating = playerRatings.length > 0;
  const agg = useMemo(
    () => aggregatePlayerRatings(player, playerRatings),
    [player, playerRatings]
  );

  const resolveInitialStr = (
    myVal: number | undefined,
    myLegacyFallback: number | undefined,
    aggVal: number
  ): string => {
    if (myRating) {
      const v = typeof myVal === 'number' ? myVal : myLegacyFallback;
      return typeof v === 'number' ? String(Math.round(v)) : '';
    }
    return hasAnyRating ? String(Math.round(aggVal)) : '';
  };

  const initialOverall = resolveInitialStr(myRating?.overall, myRating?.skill, agg.avgOverall);
  const initialRadar: Record<RadarStatKey, string> = {
    attack: resolveInitialStr(myRating?.attack, myRating?.skill, agg.avgAttack),
    technique: resolveInitialStr(myRating?.technique, myRating?.skill, agg.avgTechnique),
    stamina: resolveInitialStr(myRating?.stamina, myRating?.stamina, agg.avgStamina),
    defense: resolveInitialStr(myRating?.defense, myRating?.skill, agg.avgDefense),
    speed: resolveInitialStr(myRating?.speed, myRating?.skill, agg.avgSpeed),
    physics: resolveInitialStr(myRating?.physics, myRating?.skill, agg.avgPhysics),
  };

  const initialPos =
    myRating?.assessedPositions && myRating.assessedPositions.length > 0
      ? myRating.assessedPositions
      : hasAnyRating && agg.consensusPositions.length > 0
        ? agg.consensusPositions
        : player.favoritePositions;

  const [overallStr, setOverallStr] = useState<string>(initialOverall);
  const [radarStrs, setRadarStrs] = useState<Record<RadarStatKey, string>>(initialRadar);
  const [pos1, setPos1] = useState<string>(initialPos[0] || '');
  const [pos2, setPos2] = useState<string>(initialPos[1] || '');
  const [pos3, setPos3] = useState<string>(initialPos[2] || '');
  const [activePosSlot, setActivePosSlot] = useState<1 | 2 | 3 | null>(null);
  const [notes, setNotes] = useState<string>(myRating?.notes || '');
  const [saving, setSaving] = useState(false);
  const [savedToast, setSavedToast] = useState(false);
  const [cardError, setCardError] = useState<string | null>(null);
  const [imgFailed, setImgFailed] = useState(false);

  const ratingSyncKey = [
    player.uid,
    myRating?.overall ?? myRating?.skill ?? '',
    myRating?.attack ?? '',
    myRating?.technique ?? '',
    myRating?.stamina ?? '',
    myRating?.defense ?? '',
    myRating?.speed ?? '',
    myRating?.physics ?? '',
    myRating?.assessedPositions?.join(',') ?? '',
    myRating?.notes ?? '',
    agg.ratingCount,
  ].join('_');

  useEffect(() => {
    setOverallStr(initialOverall);
    setRadarStrs(initialRadar);
    setPos1(initialPos[0] || '');
    setPos2(initialPos[1] || '');
    setPos3(initialPos[2] || '');
    setActivePosSlot(null);
    setNotes(myRating?.notes || '');
    setImgFailed(false);
    setCardError(null);
    setSavedToast(false);
  }, [ratingSyncKey]);

  const originalPositions = player.favoritePositions.filter(Boolean);

  const isPositionsModified =
    pos1 !== (originalPositions[0] || '') ||
    pos2 !== (originalPositions[1] || '') ||
    pos3 !== (originalPositions[2] || '');

  const handleResetPositions = () => {
    setPos1(originalPositions[0] || 'CM');
    setPos2(originalPositions[1] || '');
    setPos3(originalPositions[2] || '');
    setActivePosSlot(null);
    setCardError(null);
  };

  const applySlotPosition = (slot: 1 | 2 | 3, value: string) => {
    if (slot === 1) setPos1(value);
    else if (slot === 2) setPos2(value);
    else setPos3(value);
    setActivePosSlot(null);
    setCardError(null);
  };

  const numericOverall = parseRatingStr(overallStr);
  const numericRadar = {
    attack: parseRatingStr(radarStrs.attack),
    technique: parseRatingStr(radarStrs.technique),
    stamina: parseRatingStr(radarStrs.stamina),
    defense: parseRatingStr(radarStrs.defense),
    speed: parseRatingStr(radarStrs.speed),
    physics: parseRatingStr(radarStrs.physics),
  };

  const radarMean = useMemo(() => {
    const vals = RADAR_STAT_KEYS.map((k) => numericRadar[k]).filter(
      (v): v is number => v !== null
    );
    if (vals.length === 0) return null;
    return Math.round(vals.reduce((s, v) => s + v, 0) / vals.length);
  }, [
    numericRadar.attack,
    numericRadar.technique,
    numericRadar.stamina,
    numericRadar.defense,
    numericRadar.speed,
    numericRadar.physics,
  ]);

  const saveEvaluation = async (advanceAfter: boolean) => {
    setCardError(null);
    setSavedToast(false);

    if (numericOverall === null) {
      setCardError('Please enter Overall (0–100) before saving.');
      return;
    }

    for (const key of RADAR_STAT_KEYS) {
      if (numericRadar[key] === null) {
        setCardError(`Please enter ${RADAR_STAT_META[key].label} (0–100) before saving.`);
        return;
      }
    }

    const chosenPositions = Array.from(new Set([pos1, pos2, pos3].filter(Boolean))).slice(0, 3);
    if (chosenPositions.length === 0) {
      setCardError('Please choose at least a 1st position.');
      return;
    }

    const roundedOverall = Math.round(numericOverall);

    setSaving(true);
    try {
      const ratingId = `${player.uid}_${user.uid}`;
      await setDoc(doc(db, 'player_ratings', ratingId), {
        playerId: player.uid,
        managerId: user.uid,
        managerName: `${managerProfile.firstName} ${managerProfile.lastName}`,
        skill: roundedOverall,
        overall: roundedOverall,
        attack: Math.round(numericRadar.attack!),
        technique: Math.round(numericRadar.technique!),
        stamina: Math.round(numericRadar.stamina!),
        defense: Math.round(numericRadar.defense!),
        speed: Math.round(numericRadar.speed!),
        physics: Math.round(numericRadar.physics!),
        assessedPositions: chosenPositions,
        notes: notes.trim().slice(0, 400),
        updatedAt: serverTimestamp(),
      });
      setSavedToast(true);
      if (advanceAfter && hasNext) {
        setTimeout(() => {
          onAdvanceNext();
        }, 220);
      } else {
        setTimeout(() => setSavedToast(false), 2600);
      }
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.WRITE, `player_ratings/${player.uid}_${user.uid}`);
      } catch (wrapped) {
        setCardError(wrapped instanceof Error ? wrapped.message : 'Failed to save player rating.');
      }
    } finally {
      setSaving(false);
    }
  };

  const initials = `${player.firstName?.[0] || ''}${player.lastName?.[0] || ''}`.toUpperCase() || 'PL';
  const displayPrimaryPos = pos1 || originalPositions[0] || '';

  return (
    <div className="bg-white border border-slate-200 rounded-[24px] shadow-xl overflow-hidden flex flex-col">
      {/* FIFA-Style Portrait Crest Top Half */}
      <div className="relative bg-gradient-to-b from-[#0a1b3d] via-[#102b5e] to-[#163c7c] text-white px-5 pt-3.5 pb-4">
        {/* Progress Bar */}
        <div className="mb-3">
          {totalCount <= 28 ? (
            <div className="flex items-center gap-1">
              {Array.from({ length: totalCount }, (_, i) => (
                <div
                  key={i}
                  className={`h-1 flex-1 rounded-full transition-all duration-300 ${
                    i === currentIndex
                      ? 'bg-emerald-400'
                      : i < currentIndex
                        ? 'bg-white/50'
                        : 'bg-white/15'
                  }`}
                />
              ))}
            </div>
          ) : (
            <div className="h-1 w-full bg-white/15 rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-400 transition-all duration-300"
                style={{ width: `${((currentIndex + 1) / Math.max(1, totalCount)) * 100}%` }}
              />
            </div>
          )}
        </div>

        {/* FIFA Top Layout: Left OVR/POS/Arrow + Right Portrait */}
        <div className="flex items-center justify-between gap-3 pt-0.5">
          <div className="flex flex-col items-center justify-center w-20 shrink-0 space-y-1 border-r border-white/15 pr-3">
            <span className="text-[9px] font-bold uppercase tracking-widest text-slate-300/90 leading-none">
              OVR
            </span>
            <div className="font-display text-4xl font-extrabold font-mono-tabular leading-none tracking-tight text-white">
              {numericOverall !== null ? Math.round(numericOverall) : '—'}
            </div>
            <div className="text-xs font-mono-tabular font-extrabold tracking-wider uppercase text-emerald-300">
              {displayPrimaryPos || '—'}
            </div>
            <div className="pt-0.5">
              <SkillArrowBadge
                skill={numericOverall}
                size="md"
                variant="pitch"
                thresholds={skillArrowThresholds}
              />
            </div>
          </div>

          <div className="flex-1 flex justify-center">
            <div
              className="relative w-24 h-24 flex items-center justify-center shrink-0"
              title={`Overall: ${numericOverall !== null ? numericOverall : 'Unrated'} · Stamina: ${numericRadar.stamina !== null ? numericRadar.stamina : 'Unrated'}`}
            >
              <StaminaPerimeterRing stamina={numericRadar.stamina} size={96} variant="pitch" />

              {player.approvedPhotoUrl && !imgFailed ? (
                <img
                  src={player.approvedPhotoUrl}
                  alt={`${player.firstName} ${player.lastName}`}
                  referrerPolicy="no-referrer"
                  onError={() => setImgFailed(true)}
                  className="relative z-10 w-[74px] h-[74px] rounded-full object-cover object-top drop-shadow-[0_3px_6px_rgba(0,0,0,0.45)]"
                />
              ) : (
                <div className="relative z-10 w-[74px] h-[74px] rounded-full flex items-center justify-center bg-gradient-to-b from-slate-700 to-slate-900 shadow-md">
                  <span className="font-display text-2xl font-bold text-emerald-200 tracking-wide">
                    {initials}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Centered FIFA Nameplate */}
        <div className="mt-3 pt-2.5 border-t border-white/15 text-center space-y-1">
          <div className="flex items-center justify-center gap-2 min-w-0">
            <h3 className="font-display text-xl font-bold tracking-tight text-white leading-tight truncate uppercase">
              {player.firstName} {player.lastName}
            </h3>
            {player.uid === user.uid && (
              <span className="px-1.5 py-0.5 rounded bg-emerald-400/20 border border-emerald-300/40 text-[10px] font-mono-tabular font-bold uppercase tracking-wider text-emerald-200 shrink-0">
                You
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 text-[11px] text-slate-300 font-mono-tabular">
            <span>Age {player.age}</span>
            <span aria-hidden="true" className="text-slate-500">·</span>
            <span>{player.appearances} Matches</span>
            {hasAnyRating && (
              <>
                <span aria-hidden="true" className="text-slate-500">·</span>
                <span className="text-emerald-300">OVR {Math.round(agg.avgOverall)}</span>
              </>
            )}
            {mvpCount > 0 && (
              <>
                <span aria-hidden="true" className="text-slate-500">·</span>
                <span className="text-amber-300">{mvpCount} MVP</span>
              </>
            )}
            {topScorerCount > 0 && (
              <>
                <span aria-hidden="true" className="text-slate-500">·</span>
                <span className="text-emerald-300">{topScorerCount} Top</span>
              </>
            )}
          </div>
        </div>

        {/* Hexagon Player Stats Radar (6 Factors) inside FIFA Crest */}
        <div className="mt-2.5 pt-2 border-t border-white/10">
          <PlayerStatsRadar values={numericRadar} size={220} variant="dark" />
        </div>
      </div>

      {/* Compact Lower FIFA Card Body */}
      <div className="p-4 space-y-3.5">
        {canEdit ? (
          <>
            {/* Separate Overall Rating Control (Not part of Hexagon Radar) */}
            <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  Overall Score
                </span>
                {radarMean !== null && (
                  <button
                    type="button"
                    onClick={() => {
                      setOverallStr(String(radarMean));
                      setCardError(null);
                    }}
                    title="Set Overall to average of the 6 radar factors"
                    className="text-[10px] font-mono-tabular font-semibold text-emerald-700 hover:text-emerald-800 hover:underline"
                  >
                    Use avg ({radarMean})
                  </button>
                )}
              </div>
              <CompactStatSlider
                id={`overall-input-${player.uid}`}
                label="Overall"
                shortLabel="OVR"
                valueStr={overallStr}
                numericValue={numericOverall}
                thresholds={skillArrowThresholds}
                onValueChange={(next) => {
                  setOverallStr(next);
                  setCardError(null);
                }}
                ariaLabel={`Overall rating slider for ${player.firstName} ${player.lastName}`}
                prominent={true}
              />
            </div>

            {/* 6 Hexagon Radar Factor Sliders (2-Column Grid) */}
            <div className="grid grid-cols-2 gap-x-3.5 gap-y-2.5">
              {RADAR_STAT_KEYS.map((key) => {
                const meta = RADAR_STAT_META[key];
                return (
                  <CompactStatSlider
                    key={key}
                    id={`${key}-input-${player.uid}`}
                    label={meta.label}
                    shortLabel={meta.short}
                    valueStr={radarStrs[key]}
                    numericValue={numericRadar[key]}
                    thresholds={skillArrowThresholds}
                    onValueChange={(next) => {
                      setRadarStrs((prev) => ({ ...prev, [key]: next }));
                      setCardError(null);
                    }}
                    ariaLabel={`${meta.label} slider for ${player.firstName} ${player.lastName}`}
                  />
                );
              })}
            </div>

            {/* Clickable Position Buttons + Inline Alternative Picker + Reset */}
            <div className="pt-3 border-t border-slate-100 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold text-slate-600">
                  Positions
                  {originalPositions.length > 0 && (
                    <span className="ml-1.5 font-mono-tabular font-normal text-slate-400">
                      ({originalPositions.join('/')})
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={handleResetPositions}
                  disabled={!isPositionsModified}
                  title="Reset to player's original positions"
                  className="px-2 py-0.5 rounded-md border border-slate-200 bg-white hover:bg-slate-50 text-[11px] font-semibold text-slate-700 inline-flex items-center gap-1 whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <RotateCcw className="w-3 h-3" />
                  Reset
                </button>
              </div>

              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    { slot: 1 as const, label: '1st', value: pos1 },
                    { slot: 2 as const, label: '2nd', value: pos2 },
                    { slot: 3 as const, label: '3rd', value: pos3 },
                  ] as const
                ).map((item) => {
                  const isOpen = activePosSlot === item.slot;
                  return (
                    <button
                      key={item.slot}
                      type="button"
                      onClick={() => setActivePosSlot(isOpen ? null : item.slot)}
                      aria-expanded={isOpen}
                      className={`py-1.5 px-2 rounded-lg border text-center transition-colors flex flex-col items-center justify-center gap-0.5 ${
                        isOpen
                          ? 'bg-emerald-50 border-emerald-600 ring-1 ring-emerald-500 text-emerald-900'
                          : item.value
                            ? 'bg-slate-50 border-slate-200 hover:border-slate-300 text-slate-900'
                            : 'bg-white border-dashed border-slate-300 hover:border-slate-400 text-slate-400'
                      }`}
                    >
                      <span className="text-[10px] font-medium text-slate-500 leading-none">
                        {item.label}
                      </span>
                      <span className="font-mono-tabular text-xs font-bold leading-tight">
                        {item.value || '—'}
                      </span>
                    </button>
                  );
                })}
              </div>

              {activePosSlot !== null && (
                <div className="p-2 rounded-lg bg-slate-50 border border-slate-200 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-semibold text-slate-600">
                      Select {activePosSlot === 1 ? '1st' : activePosSlot === 2 ? '2nd' : '3rd'} Position
                    </span>
                    <button
                      type="button"
                      onClick={() => setActivePosSlot(null)}
                      aria-label="Close position picker"
                      className="text-slate-400 hover:text-slate-700 p-0.5"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                  <div className="grid grid-cols-5 gap-1">
                    {activePosSlot !== 1 && (
                      <button
                        type="button"
                        onClick={() => applySlotPosition(activePosSlot, '')}
                        className={`py-1 rounded text-[11px] font-semibold border transition-colors ${
                          (activePosSlot === 2 ? pos2 : pos3) === ''
                            ? 'bg-slate-900 border-slate-900 text-white'
                            : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-100'
                        }`}
                      >
                        None
                      </button>
                    )}
                    {SOCCER_POSITIONS.map((p) => {
                      const currentVal = activePosSlot === 1 ? pos1 : activePosSlot === 2 ? pos2 : pos3;
                      const isChosen = currentVal === p;
                      return (
                        <button
                          key={p}
                          type="button"
                          title={POSITION_LABELS[p]}
                          onClick={() => applySlotPosition(activePosSlot, p)}
                          className={`py-1 rounded text-[11px] font-mono-tabular font-bold border transition-colors ${
                            isChosen
                              ? 'bg-emerald-700 border-emerald-700 text-white'
                              : 'bg-white border-slate-200 text-slate-800 hover:border-emerald-500 hover:text-emerald-800'
                          }`}
                        >
                          {p}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Inline Feedback */}
            {cardError && (
              <div className="p-2 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800">
                {cardError}
              </div>
            )}
            {savedToast && (
              <div className="p-2 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                <span>Saved rating.</span>
              </div>
            )}

            {/* Save Actions */}
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                disabled={saving}
                onClick={() => saveEvaluation(false)}
                className="px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-900 text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap disabled:opacity-50 transition-colors"
              >
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                Save
              </button>
              {hasNext && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => saveEvaluation(true)}
                  className="px-3.5 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap disabled:opacity-50 transition-colors"
                >
                  <span>Save &amp; Next</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            {/* Read-Only Overall Rating Bar */}
            <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  Overall Score
                </span>
                {!hasAnyRating && (
                  <span className="text-[10px] font-medium text-slate-400">
                    Not rated yet
                  </span>
                )}
              </div>
              <ReadOnlyStatBar
                label="Overall"
                shortLabel="OVR"
                numericValue={numericOverall}
                thresholds={skillArrowThresholds}
                prominent={true}
              />
            </div>

            {/* Read-Only 6 Hexagon Radar Factors */}
            <div className="grid grid-cols-2 gap-x-3.5 gap-y-2.5">
              {RADAR_STAT_KEYS.map((key) => {
                const meta = RADAR_STAT_META[key];
                return (
                  <ReadOnlyStatBar
                    key={key}
                    label={meta.label}
                    shortLabel={meta.short}
                    numericValue={numericRadar[key]}
                    thresholds={skillArrowThresholds}
                  />
                );
              })}
            </div>

            {/* Read-Only Positions */}
            <div className="pt-3 border-t border-slate-100 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold text-slate-600">Positions</span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    { slot: 1 as const, label: '1st', value: pos1 },
                    { slot: 2 as const, label: '2nd', value: pos2 },
                    { slot: 3 as const, label: '3rd', value: pos3 },
                  ] as const
                ).map((item) => (
                  <div
                    key={item.slot}
                    className={`py-1.5 px-2 rounded-lg border text-center flex flex-col items-center justify-center gap-0.5 ${
                      item.value
                        ? 'bg-slate-50 border-slate-200 text-slate-900'
                        : 'bg-white border-dashed border-slate-200 text-slate-400'
                    }`}
                  >
                    <span className="text-[10px] font-medium text-slate-500 leading-none">
                      {item.label}
                    </span>
                    <span className="font-mono-tabular text-xs font-bold leading-tight">
                      {item.value || '—'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export const PlayerRatingDeck: React.FC<PlayerRatingDeckProps> = ({
  user,
  profile,
  players,
  ratings,
  completedMatches,
  skillArrowThresholds,
  canEdit = true,
}) => {
  const shouldReduceMotion = useReducedMotion();
  const resolvedSkillThresholds = useMemo(
    () => normalizeSkillArrowThresholds(skillArrowThresholds),
    [skillArrowThresholds]
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [positionFilter, setPositionFilter] = useState<string>('ALL');
  const [sortBy, setSortBy] = useState<'lastName' | 'firstName'>('lastName');
  const [letterFilter, setLetterFilter] = useState<string>('ALL');
  const [activeIndex, setActiveIndex] = useState<number>(0);
  const [pendingFocusUid, setPendingFocusUid] = useState<string | null>(() =>
    canEdit ? null : user.uid
  );
  const [direction, setDirection] = useState<1 | -1>(1);
  const [edgeFlash, setEdgeFlash] = useState<'left' | 'right' | null>(null);

  const awardsByUid = useMemo(() => {
    const map = new Map<string, { mvp: number; topScorer: number }>();
    for (const m of completedMatches) {
      const mvp = m.postGameStats?.bestPlayerUid;
      if (mvp) {
        const cur = map.get(mvp) || { mvp: 0, topScorer: 0 };
        cur.mvp += 1;
        map.set(mvp, cur);
      }
      const scorer = m.postGameStats?.topScorerUid;
      if (scorer) {
        const cur = map.get(scorer) || { mvp: 0, topScorer: 0 };
        cur.topScorer += 1;
        map.set(scorer, cur);
      }
    }
    return map;
  }, [completedMatches]);

  const ratingsByPlayerId = useMemo(() => {
    const map = new Map<string, PlayerRating[]>();
    for (const r of ratings) {
      const list = map.get(r.playerId) || [];
      list.push(r);
      map.set(r.playerId, list);
    }
    return map;
  }, [ratings]);

  const availableLetters = useMemo(() => {
    const set = new Set<string>();
    for (const p of players) {
      const key = (sortBy === 'lastName' ? p.lastName : p.firstName).trim().toUpperCase();
      if (key && /^[A-Z]/.test(key[0])) {
        set.add(key[0]);
      }
    }
    return set;
  }, [players, sortBy]);

  const filteredPlayers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    return [...players]
      .filter((p) => {
        if (q && !`${p.firstName} ${p.lastName}`.toLowerCase().includes(q)) {
          return false;
        }
        if (positionFilter !== 'ALL') {
          const pRatings = ratingsByPlayerId.get(p.uid) || [];
          const agg = aggregatePlayerRatings(p, pRatings);
          const allPositions = new Set([...p.favoritePositions, ...agg.consensusPositions]);
          if (!allPositions.has(positionFilter)) {
            return false;
          }
        }
        if (letterFilter !== 'ALL') {
          const primary = (sortBy === 'lastName' ? p.lastName : p.firstName).trim().toUpperCase();
          if (!primary.startsWith(letterFilter)) {
            return false;
          }
        }
        return true;
      })
      .sort((a, b) => {
        const aPrimary = sortBy === 'lastName' ? a.lastName : a.firstName;
        const bPrimary = sortBy === 'lastName' ? b.lastName : b.firstName;
        const primaryCmp = aPrimary.localeCompare(bPrimary, undefined, { sensitivity: 'base' });
        if (primaryCmp !== 0) return primaryCmp;
        const aSecondary = sortBy === 'lastName' ? a.firstName : a.lastName;
        const bSecondary = sortBy === 'lastName' ? b.firstName : b.lastName;
        return aSecondary.localeCompare(bSecondary, undefined, { sensitivity: 'base' });
      });
  }, [players, searchQuery, positionFilter, letterFilter, sortBy, ratingsByPlayerId]);

  // Reset to first card when filters/sort change (unless jumping to a specific player)
  useEffect(() => {
    if (!pendingFocusUid) {
      setActiveIndex(0);
    }
  }, [searchQuery, positionFilter, letterFilter, sortBy, pendingFocusUid]);

  // Resolve pending focus jump (e.g., "My Card" button or initial own-card focus)
  useEffect(() => {
    if (!pendingFocusUid || filteredPlayers.length === 0) return;
    const idx = filteredPlayers.findIndex((p) => p.uid === pendingFocusUid);
    if (idx !== -1) {
      setActiveIndex(idx);
    }
    setPendingFocusUid(null);
  }, [pendingFocusUid, filteredPlayers]);

  // Clamp index if player list shrinks
  useEffect(() => {
    if (activeIndex >= filteredPlayers.length && filteredPlayers.length > 0) {
      setActiveIndex(filteredPlayers.length - 1);
    }
  }, [activeIndex, filteredPlayers.length]);

  const hasMyCard = useMemo(
    () => players.some((p) => p.uid === user.uid),
    [players, user.uid]
  );

  const handleJumpToMyCard = () => {
    const idxInFiltered = filteredPlayers.findIndex((p) => p.uid === user.uid);
    if (idxInFiltered !== -1) {
      if (idxInFiltered !== activeIndex) {
        setDirection(idxInFiltered > activeIndex ? 1 : -1);
        setActiveIndex(idxInFiltered);
      }
      return;
    }
    setSearchQuery('');
    setPositionFilter('ALL');
    setLetterFilter('ALL');
    setPendingFocusUid(user.uid);
  };

  const triggerFlash = useCallback((side: 'left' | 'right') => {
    setEdgeFlash(side);
    setTimeout(() => {
      setEdgeFlash((cur) => (cur === side ? null : cur));
    }, 220);
  }, []);

  const goPrev = useCallback(() => {
    if (filteredPlayers.length <= 1) return;
    setDirection(-1);
    triggerFlash('left');
    setActiveIndex((prev) => (prev > 0 ? prev - 1 : filteredPlayers.length - 1));
  }, [filteredPlayers.length, triggerFlash]);

  const goNext = useCallback(() => {
    if (filteredPlayers.length <= 1) return;
    setDirection(1);
    triggerFlash('right');
    setActiveIndex((prev) => (prev < filteredPlayers.length - 1 ? prev + 1 : 0));
  }, [filteredPlayers.length, triggerFlash]);

  // Keyboard arrow navigation when not typing inside an input/select
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        goPrev();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        goNext();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [goPrev, goNext]);

  const handleDragEnd = (_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    if (filteredPlayers.length <= 1) return;
    if (info.offset.x < -75 || info.velocity.x < -450) {
      goNext();
    } else if (info.offset.x > 75 || info.velocity.x > 450) {
      goPrev();
    }
  };

  const activePlayer = filteredPlayers[activeIndex] || null;

  const cardVariants = {
    enter: (dir: number) =>
      shouldReduceMotion
        ? { opacity: 0 }
        : { x: dir > 0 ? 110 : -110, opacity: 0, scale: 0.96, rotate: dir > 0 ? 1.5 : -1.5 },
    center: { x: 0, opacity: 1, scale: 1, rotate: 0 },
    exit: (dir: number) =>
      shouldReduceMotion
        ? { opacity: 0 }
        : { x: dir > 0 ? -110 : 110, opacity: 0, scale: 0.96, rotate: dir > 0 ? -1.5 : 1.5 },
  };

  return (
    <div className="space-y-5">
      {/* Top Filter & Alphabet Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h2 className="text-base font-semibold text-slate-900">
              {canEdit ? 'Player Cards & Ratings' : 'Player Cards'}
            </h2>
            {hasMyCard && activePlayer?.uid !== user.uid && (
              <button
                type="button"
                onClick={handleJumpToMyCard}
                className="px-2.5 py-1 rounded-lg bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 text-emerald-800 text-[11px] font-semibold inline-flex items-center gap-1 transition-colors whitespace-nowrap"
              >
                <UserCheck className="w-3.5 h-3.5" />
                My Card
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Search by Name */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search player name..."
                className="pl-8 pr-7 py-1.5 w-48 sm:w-56 rounded-lg border border-slate-300 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  aria-label="Clear name search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Position Filter */}
            <select
              value={positionFilter}
              onChange={(e) => setPositionFilter(e.target.value)}
              aria-label="Filter by position"
              className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-800"
            >
              <option value="ALL">All Positions</option>
              {SOCCER_POSITIONS.map((pos) => (
                <option key={pos} value={pos}>
                  {pos} ({POSITION_LABELS[pos]})
                </option>
              ))}
            </select>

            {/* Last Name / First Name Sort Toggle */}
            <div className="flex items-center gap-0.5 p-0.5 bg-slate-100 rounded-lg border border-slate-200">
              <button
                type="button"
                onClick={() => {
                  setSortBy('lastName');
                  setLetterFilter('ALL');
                }}
                className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors whitespace-nowrap ${
                  sortBy === 'lastName'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Last Name
              </button>
              <button
                type="button"
                onClick={() => {
                  setSortBy('firstName');
                  setLetterFilter('ALL');
                }}
                className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors whitespace-nowrap ${
                  sortBy === 'firstName'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                First Name
              </button>
            </div>
          </div>
        </div>

        {/* Alphabetical A-Z Filter Strip */}
        <div className="flex flex-wrap items-center gap-1 pt-2 border-t border-slate-100">
          <button
            type="button"
            onClick={() => setLetterFilter('ALL')}
            className={`px-2 py-1 rounded-md text-[11px] font-mono-tabular font-semibold transition-colors ${
              letterFilter === 'ALL'
                ? 'bg-slate-900 text-white'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            All
          </button>
          {ALPHABET.map((letter) => {
            const hasPlayers = availableLetters.has(letter);
            const isActive = letterFilter === letter;
            return (
              <button
                key={letter}
                type="button"
                disabled={!hasPlayers && !isActive}
                onClick={() => setLetterFilter(isActive ? 'ALL' : letter)}
                className={`w-6 h-6 rounded-md text-[11px] font-mono-tabular font-semibold transition-colors flex items-center justify-center ${
                  isActive
                    ? 'bg-emerald-700 text-white'
                    : hasPlayers
                      ? 'text-slate-800 hover:bg-slate-100'
                      : 'text-slate-300 cursor-not-allowed'
                }`}
              >
                {letter}
              </button>
            );
          })}
        </div>
      </div>

      {/* Single-Card Social Carousel Stage */}
      {!activePlayer ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center space-y-2">
          <p className="text-sm font-medium text-slate-700">No players match the current filters.</p>
          <button
            type="button"
            onClick={() => {
              setSearchQuery('');
              setPositionFilter('ALL');
              setLetterFilter('ALL');
            }}
            className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 underline"
          >
            Reset all filters
          </button>
        </div>
      ) : (
        <div className="relative py-2">
          <div className="max-w-3xl mx-auto flex items-center justify-center gap-3 sm:gap-5">
            {/* Left Flash / Chevron Arrow */}
            <button
              type="button"
              onClick={goPrev}
              disabled={filteredPlayers.length <= 1}
              aria-label="Previous player"
              className={`hidden sm:flex w-12 h-12 rounded-full items-center justify-center shrink-0 border transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 disabled:opacity-30 disabled:cursor-not-allowed ${
                edgeFlash === 'left'
                  ? 'bg-emerald-700 text-white border-emerald-700 scale-95 shadow-lg shadow-emerald-700/30'
                  : 'bg-white hover:bg-slate-900 hover:text-white text-slate-800 border-slate-200 shadow-md hover:scale-105'
              }`}
            >
              <ChevronLeft className="w-6 h-6" />
            </button>

            {/* Stacked Deck Stage (FIFA Portrait Aspect Ratio) */}
            <div className="relative w-full max-w-[340px] sm:max-w-[360px]">
              {/* Subtle deck depth silhouettes behind the single card */}
              {filteredPlayers.length > 1 && (
                <>
                  <div
                    aria-hidden="true"
                    className="absolute inset-x-5 -bottom-3 h-8 rounded-[24px] bg-slate-200/70 border border-slate-300/60 pointer-events-none"
                  />
                  <div
                    aria-hidden="true"
                    className="absolute inset-x-2.5 -bottom-1.5 h-8 rounded-[24px] bg-slate-100 border border-slate-200 pointer-events-none"
                  />
                </>
              )}

              {/* Directional Swipe/Slide Animated Single Card */}
              <div className="relative overflow-hidden rounded-[24px]">
                <AnimatePresence mode="wait" custom={direction} initial={false}>
                  <motion.div
                    key={activePlayer.uid}
                    custom={direction}
                    variants={cardVariants}
                    initial="enter"
                    animate="center"
                    exit="exit"
                    transition={{
                      type: 'spring',
                      stiffness: 360,
                      damping: 32,
                      mass: 0.85,
                    }}
                    drag={filteredPlayers.length > 1 ? 'x' : false}
                    dragConstraints={{ left: 0, right: 0 }}
                    dragElastic={0.22}
                    onDragEnd={handleDragEnd}
                    className="touch-pan-y"
                  >
                    <SinglePlayerCard
                      user={user}
                      managerProfile={profile}
                      player={activePlayer}
                      playerRatings={ratingsByPlayerId.get(activePlayer.uid) || []}
                      mvpCount={awardsByUid.get(activePlayer.uid)?.mvp || 0}
                      topScorerCount={awardsByUid.get(activePlayer.uid)?.topScorer || 0}
                      currentIndex={activeIndex}
                      totalCount={filteredPlayers.length}
                      hasNext={filteredPlayers.length > 1}
                      skillArrowThresholds={resolvedSkillThresholds}
                      canEdit={canEdit}
                      onAdvanceNext={goNext}
                    />
                  </motion.div>
                </AnimatePresence>
              </div>
            </div>

            {/* Right Flash / Chevron Arrow */}
            <button
              type="button"
              onClick={goNext}
              disabled={filteredPlayers.length <= 1}
              aria-label="Next player"
              className={`hidden sm:flex w-12 h-12 rounded-full items-center justify-center shrink-0 border transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 disabled:opacity-30 disabled:cursor-not-allowed ${
                edgeFlash === 'right'
                  ? 'bg-emerald-700 text-white border-emerald-700 scale-95 shadow-lg shadow-emerald-700/30'
                  : 'bg-white hover:bg-slate-900 hover:text-white text-slate-800 border-slate-200 shadow-md hover:scale-105'
              }`}
            >
              <ChevronRight className="w-6 h-6" />
            </button>
          </div>

          {/* Mobile / Compact Prev-Next Controls + Quick Counter */}
          <div className="mt-5 flex items-center justify-center gap-4">
            <button
              type="button"
              onClick={goPrev}
              disabled={filteredPlayers.length <= 1}
              className="sm:hidden px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-800 inline-flex items-center gap-1 disabled:opacity-40"
            >
              <ChevronLeft className="w-4 h-4" />
              Prev
            </button>

            <span className="text-xs font-mono-tabular text-slate-500">
              <strong className="text-slate-900">{activeIndex + 1}</strong> / {filteredPlayers.length}
            </span>

            <button
              type="button"
              onClick={goNext}
              disabled={filteredPlayers.length <= 1}
              className="sm:hidden px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-800 inline-flex items-center gap-1 disabled:opacity-40"
            >
              Next
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
