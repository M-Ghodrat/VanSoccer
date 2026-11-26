import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, RotateCcw, Shuffle, Users, X } from 'lucide-react';
import {
  FormationPlayerSlot,
  FormationTeam,
  getTeamColorPalette,
  MatchVote,
  normalizeStandardTeamColor,
  PlayerProfile,
  PlayerRating,
  SOCCER_POSITIONS,
  TeamFormation,
} from '../types';
import { aggregatePlayerRatings } from '../utils/clubUtils';

interface ManualTeamBuilderProps {
  confirmedVotes: MatchVote[];
  playersById: Map<string, PlayerProfile>;
  ratings: PlayerRating[];
  teamCount: 2 | 3 | 4;
  teamColors: string[];
  existingFormation: TeamFormation | null;
  busy: boolean;
  onApplyFormation: (formation: TeamFormation) => Promise<void>;
  onClose: () => void;
}

const POSITION_BASE_COORDS: Record<string, { x: number; y: number }> = {
  GK: { x: 50, y: 89 },
  LB: { x: 18, y: 70 },
  CB: { x: 50, y: 71 },
  RB: { x: 82, y: 70 },
  CDM: { x: 50, y: 56 },
  LM: { x: 18, y: 45 },
  CM: { x: 50, y: 45 },
  RM: { x: 82, y: 45 },
  CAM: { x: 50, y: 32 },
  LW: { x: 20, y: 20 },
  RW: { x: 80, y: 20 },
  ST: { x: 50, y: 15 },
};

function spreadCoordinatesForTeam(slots: FormationPlayerSlot[]): FormationPlayerSlot[] {
  const byPos = new Map<string, FormationPlayerSlot[]>();
  for (const s of slots) {
    const list = byPos.get(s.assignedPosition) || [];
    list.push(s);
    byPos.set(s.assignedPosition, list);
  }

  const placed: FormationPlayerSlot[] = [];
  for (const [pos, group] of byPos.entries()) {
    const base = POSITION_BASE_COORDS[pos] || { x: 50, y: 45 };
    if (group.length === 1) {
      placed.push({ ...group[0], pitchX: base.x, pitchY: base.y });
    } else {
      const span = Math.min(64, group.length * 20);
      const startX = Math.max(14, Math.min(86 - span, base.x - span / 2));
      const step = span / Math.max(1, group.length - 1);
      group.forEach((slot, idx) => {
        placed.push({
          ...slot,
          pitchX: Math.round(Math.max(12, Math.min(88, startX + idx * step)) * 10) / 10,
          pitchY: base.y,
        });
      });
    }
  }
  return placed;
}

export const ManualTeamBuilder: React.FC<ManualTeamBuilderProps> = ({
  confirmedVotes,
  playersById,
  ratings,
  teamCount,
  teamColors,
  existingFormation,
  busy,
  onApplyFormation,
  onClose,
}) => {
  const normalizedColors = useMemo(
    () =>
      Array.from({ length: teamCount }, (_, idx) =>
        normalizeStandardTeamColor(teamColors[idx], idx)
      ),
    [teamCount, teamColors]
  );

  // Map uid -> teamIndex (0..teamCount-1) or null (unassigned)
  const [teamByUid, setTeamByUid] = useState<Record<string, number | null>>({});
  const [posByUid, setPosByUid] = useState<Record<string, string>>({});

  // Seed initial assignments from existingFormation when opened or confirmedVotes changes
  useEffect(() => {
    const nextTeams: Record<string, number | null> = {};
    const nextPos: Record<string, string> = {};

    const existingTeamLookup = new Map<string, { teamIndex: number; pos: string }>();
    if (existingFormation) {
      for (const team of existingFormation.teams) {
        for (const pl of team.players) {
          existingTeamLookup.set(pl.uid, {
            teamIndex: team.teamIndex < teamCount ? team.teamIndex : 0,
            pos: pl.assignedPosition,
          });
        }
      }
    }

    for (const v of confirmedVotes) {
      const prev = existingTeamLookup.get(v.uid);
      const p = playersById.get(v.uid);
      const agg = p ? aggregatePlayerRatings(p, ratings) : null;
      const defaultPos =
        v.goalieOption === 'only_goalie'
          ? 'GK'
          : agg?.consensusPositions?.[0] || p?.favoritePositions?.[0] || 'CM';

      nextTeams[v.uid] = prev ? prev.teamIndex : teamByUid[v.uid] ?? null;
      if (nextTeams[v.uid] !== null && (nextTeams[v.uid] as number) >= teamCount) {
        nextTeams[v.uid] = null;
      }
      nextPos[v.uid] = prev?.pos || posByUid[v.uid] || defaultPos;
    }

    setTeamByUid(nextTeams);
    setPosByUid(nextPos);
  }, [confirmedVotes, teamCount, existingFormation]);

  const handleAutoDistribute = () => {
    const nextTeams: Record<string, number | null> = {};
    const nextPos: Record<string, string> = { ...posByUid };
    const counts = Array.from({ length: teamCount }, () => 0);

    // 1. Place dedicated & willing goalies across separate teams first
    const onlyGoalies = confirmedVotes.filter((v) => v.goalieOption === 'only_goalie');
    const willingGoalies = confirmedVotes.filter((v) => v.goalieOption === 'willing');
    const outfielders = confirmedVotes.filter((v) => v.goalieOption === 'none');

    const assignToSmallestTeam = (uid: string, forcedPos?: string) => {
      let minIdx = 0;
      for (let i = 1; i < teamCount; i++) {
        if (counts[i] < counts[minIdx]) minIdx = i;
      }
      nextTeams[uid] = minIdx;
      counts[minIdx] += 1;
      if (forcedPos) nextPos[uid] = forcedPos;
    };

    onlyGoalies.forEach((v) => assignToSmallestTeam(v.uid, 'GK'));
    willingGoalies.forEach((v) => {
      // Assign as GK if target team has no GK yet
      let minIdx = 0;
      for (let i = 1; i < teamCount; i++) {
        if (counts[i] < counts[minIdx]) minIdx = i;
      }
      const teamHasGk = Object.entries(nextTeams).some(
        ([uid, tIdx]) => tIdx === minIdx && nextPos[uid] === 'GK'
      );
      assignToSmallestTeam(v.uid, teamHasGk ? undefined : 'GK');
    });

    // 2. Distribute outfielders sorted by skill (snake order) for clean manual starting balance
    const sortedOutfield = [...outfielders].sort((a, b) => {
      const pa = playersById.get(a.uid);
      const pb = playersById.get(b.uid);
      const sa = pa ? aggregatePlayerRatings(pa, ratings).avgSkill : 60;
      const sb = pb ? aggregatePlayerRatings(pb, ratings).avgSkill : 60;
      return sb - sa;
    });

    sortedOutfield.forEach((v, idx) => {
      const round = Math.floor(idx / teamCount);
      const offset = idx % teamCount;
      const target = round % 2 === 0 ? offset : teamCount - 1 - offset;
      nextTeams[v.uid] = target;
      counts[target] += 1;
    });

    setTeamByUid(nextTeams);
    setPosByUid(nextPos);
  };

  const handleClearAll = () => {
    const cleared: Record<string, number | null> = {};
    for (const v of confirmedVotes) {
      cleared[v.uid] = null;
    }
    setTeamByUid(cleared);
  };

  const teamCounts = useMemo(() => {
    const counts = Array.from({ length: teamCount }, () => 0);
    for (const v of confirmedVotes) {
      const idx = teamByUid[v.uid];
      if (typeof idx === 'number' && idx >= 0 && idx < teamCount) {
        counts[idx] += 1;
      }
    }
    return counts;
  }, [confirmedVotes, teamByUid, teamCount]);

  const unassignedCount = confirmedVotes.filter((v) => teamByUid[v.uid] === null || teamByUid[v.uid] === undefined).length;

  const handleSaveManual = async () => {
    const teams: FormationTeam[] = Array.from({ length: teamCount }, (_, idx) => {
      const color = normalizedColors[idx];
      const rawSlots: FormationPlayerSlot[] = confirmedVotes
        .filter((v) => teamByUid[v.uid] === idx)
        .map((v) => {
          const p = playersById.get(v.uid);
          const agg = p
            ? aggregatePlayerRatings(p, ratings)
            : {
                avgOverall: 60,
                avgSkill: 60,
                avgAttack: 60,
                avgTechnique: 60,
                avgStamina: 60,
                avgDefense: 60,
                avgSpeed: 60,
                avgPhysics: 60,
                consensusPositions: ['CM'],
                ratingCount: 0,
                playerId: v.uid,
              };
          const assignedPosition =
            posByUid[v.uid] ||
            (v.goalieOption === 'only_goalie'
              ? 'GK'
              : agg.consensusPositions[0] || p?.favoritePositions[0] || 'CM');
          return {
            uid: v.uid,
            name: v.playerName,
            age: p?.age || 26,
            avgOverall: agg.avgOverall,
            avgSkill: agg.avgOverall,
            avgAttack: agg.avgAttack,
            avgTechnique: agg.avgTechnique,
            avgStamina: agg.avgStamina,
            avgDefense: agg.avgDefense,
            avgSpeed: agg.avgSpeed,
            avgPhysics: agg.avgPhysics,
            goalieOption: v.goalieOption,
            assignedPosition,
            pitchX: 50,
            pitchY: 50,
            rationale: 'Manually arranged by manager',
          };
        });

      const placed = spreadCoordinatesForTeam(rawSlots);
      const gkCount = placed.filter((s) => s.assignedPosition === 'GK').length;
      const defCount = placed.filter((s) => ['LB', 'CB', 'RB'].includes(s.assignedPosition)).length;
      const midCount = placed.filter((s) => ['CDM', 'LM', 'CM', 'RM', 'CAM'].includes(s.assignedPosition)).length;
      const attCount = placed.filter((s) => ['LW', 'RW', 'ST'].includes(s.assignedPosition)).length;

      return {
        teamIndex: idx,
        teamName: `Team ${color}`,
        color,
        formationShape: `${gkCount}-${defCount}-${midCount}-${attCount}`,
        players: placed,
      };
    });

    const formation: TeamFormation = {
      generatedAtIso: new Date().toISOString(),
      summary: 'Teams arranged manually by club manager.',
      teams,
    };

    await onApplyFormation(formation);
  };

  return (
    <div className="bg-white border border-slate-300 rounded-xl p-6 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3 pb-4 border-b border-slate-200">
        <div>
          <h3 className="text-base font-semibold text-slate-900 flex items-center gap-2">
            <Users className="w-4 h-4 text-emerald-700" />
            Manual Team Arrangement ({teamCount} Teams)
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Assign players directly to {normalizedColors.join(', ')} without using AI, then fine-tune positions on the pitch.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleAutoDistribute}
            className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            <Shuffle className="w-3.5 h-3.5 text-emerald-700" />
            Quick Auto-Split (No AI)
          </button>
          <button
            type="button"
            onClick={handleClearAll}
            className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Clear All
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close manual team builder"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Team Counts Summary */}
      <div className="flex flex-wrap items-center gap-4 text-xs">
        {normalizedColors.map((color, idx) => {
          const palette = getTeamColorPalette(color, idx);
          return (
            <div key={idx} className="inline-flex items-center gap-2">
              <span
                className={`w-3.5 h-3.5 rounded-sm border ${palette.bg} ${palette.border}`}
                aria-hidden="true"
              />
              <span className="font-semibold text-slate-900">Team {color}:</span>
              <span className="font-mono-tabular font-bold text-slate-700">{teamCounts[idx]}</span>
            </div>
          );
        })}
        <span className="text-slate-500 font-mono-tabular">
          · Unassigned: <strong>{unassignedCount}</strong>
        </span>
      </div>

      {/* Player Assignment List */}
      {confirmedVotes.length === 0 ? (
        <p className="text-xs text-slate-500 py-4">No confirmed attending players yet.</p>
      ) : (
        <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg max-h-[440px] overflow-y-auto">
          {confirmedVotes.map((vote) => {
            const p = playersById.get(vote.uid);
            const assignedTeam = teamByUid[vote.uid];
            const assignedPos = posByUid[vote.uid] || 'CM';
            const initials = vote.playerName
              .split(/\s+/)
              .filter(Boolean)
              .map((part) => part[0])
              .join('')
              .slice(0, 2)
              .toUpperCase();

            return (
              <div
                key={vote.uid}
                className="px-3.5 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs hover:bg-slate-50/70"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-7 h-7 rounded-full bg-slate-100 border border-slate-200 overflow-hidden flex items-center justify-center text-[10px] font-bold text-slate-700 shrink-0">
                    {p?.approvedPhotoUrl ? (
                      <img
                        src={p.approvedPhotoUrl}
                        alt={vote.playerName}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      initials
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-900 truncate">
                      {vote.playerName}
                      {vote.goalieOption === 'only_goalie' && (
                        <span className="ml-1.5 text-[11px] font-semibold text-amber-700">(GK Only)</span>
                      )}
                      {vote.goalieOption === 'willing' && (
                        <span className="ml-1.5 text-[11px] text-slate-500">(Willing GK)</span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-500 font-mono-tabular">
                      Pref: {p?.favoritePositions?.join(' · ') || 'Outfield'}
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                  <select
                    value={assignedPos}
                    onChange={(e) =>
                      setPosByUid((prev) => ({ ...prev, [vote.uid]: e.target.value }))
                    }
                    aria-label={`Position for ${vote.playerName}`}
                    className="px-2 py-1 rounded-md border border-slate-300 bg-white font-mono-tabular text-[11px] font-semibold text-slate-800"
                  >
                    {SOCCER_POSITIONS.map((pos) => (
                      <option key={pos} value={pos}>
                        {pos}
                      </option>
                    ))}
                  </select>

                  {normalizedColors.map((color, idx) => {
                    const palette = getTeamColorPalette(color, idx);
                    const isPicked = assignedTeam === idx;
                    return (
                      <button
                        key={idx}
                        type="button"
                        onClick={() =>
                          setTeamByUid((prev) => ({
                            ...prev,
                            [vote.uid]: isPicked ? null : idx,
                          }))
                        }
                        className={`px-2.5 py-1 rounded-md border text-[11px] font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap ${
                          isPicked
                            ? `${palette.bg} ${palette.border} ${palette.text} ring-2 ring-offset-1 ${palette.ring}`
                            : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        <span
                          className={`w-2.5 h-2.5 rounded-full border ${
                            isPicked ? 'border-white/70 bg-current opacity-80' : `${palette.bg} ${palette.border}`
                          }`}
                          aria-hidden="true"
                        />
                        {color}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100">
        <span className="text-xs text-slate-500">
          {unassignedCount > 0
            ? `${unassignedCount} confirmed player${unassignedCount === 1 ? '' : 's'} not assigned yet.`
            : 'All confirmed players assigned.'}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy || confirmedVotes.length === 0 || teamCounts.every((c) => c === 0)}
            onClick={handleSaveManual}
            className="px-4 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap disabled:opacity-50"
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            Apply &amp; Open on Pitch
          </button>
        </div>
      </div>
    </div>
  );
};
