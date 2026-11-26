import React, { useEffect, useMemo, useState } from 'react';
import { User } from 'firebase/auth';
import { doc, serverTimestamp, writeBatch } from 'firebase/firestore';
import {
  Check,
  CheckCircle2,
  Clock,
  Loader2,
  Minus,
  Plus,
  Save,
  Trash2,
  Trophy,
  UserCheck,
  UserX,
  X,
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import {
  DropInMatch,
  getTeamColorPalette,
  PlayerProfile,
  PostGameStats,
  PostMatchGame,
  PostMatchGoalEvent,
} from '../types';
import {
  buildFinalizedEntriesFromMatch,
  computePlayerCareerStats,
  getMatchRosterTeams,
  MatchRosterTeam,
} from '../utils/clubUtils';
import { SoccerBallIcon } from './SoccerBallIcon';
import { TeamJerseyIcon } from './TeamJerseyIcon';

interface PostMatchStatsEditorProps {
  user: User;
  completedMatches: DropInMatch[];
  selectedMatchId?: string;
  onSelectMatchId?: (matchId: string) => void;
  players: PlayerProfile[];
  playersById: Map<string, PlayerProfile>;
  onSavedNotice?: (msg: string) => void;
}

function makeClientId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function pickNextTeamPair(
  teams: MatchRosterTeam[],
  existingGames: PostMatchGame[]
): [MatchRosterTeam, MatchRosterTeam] | null {
  if (teams.length < 2) return null;

  const usedPairs = new Set(
    existingGames.map((g) => {
      const a = Math.min(g.homeTeamIndex, g.awayTeamIndex);
      const b = Math.max(g.homeTeamIndex, g.awayTeamIndex);
      return `${a}-${b}`;
    })
  );

  // If 4 teams and Game 1 was 0 vs 1, prefer 2 vs 3 as Game 2 (simultaneous pitch matchup)
  if (teams.length === 4 && existingGames.length === 1) {
    const g0 = existingGames[0];
    const usedInFirst = new Set([g0.homeTeamIndex, g0.awayTeamIndex]);
    const remaining = teams.filter((t) => !usedInFirst.has(t.teamIndex));
    if (remaining.length === 2) {
      return [remaining[0], remaining[1]];
    }
  }

  for (let i = 0; i < teams.length; i++) {
    for (let j = i + 1; j < teams.length; j++) {
      const key = `${Math.min(teams[i].teamIndex, teams[j].teamIndex)}-${Math.max(
        teams[i].teamIndex,
        teams[j].teamIndex
      )}`;
      if (!usedPairs.has(key)) {
        return [teams[i], teams[j]];
      }
    }
  }

  return [teams[0], teams[1]];
}

function createGameBetween(home: MatchRosterTeam, away: MatchRosterTeam): PostMatchGame {
  return {
    id: makeClientId('game'),
    homeTeamIndex: home.teamIndex,
    homeTeamColor: home.teamColor,
    awayTeamIndex: away.teamIndex,
    awayTeamColor: away.teamColor,
    homeScore: 0,
    awayScore: 0,
    goals: [],
  };
}

export const PostMatchStatsEditor: React.FC<PostMatchStatsEditorProps> = ({
  user,
  completedMatches,
  selectedMatchId,
  onSelectMatchId,
  players,
  playersById,
  onSavedNotice,
}) => {
  const sortedMatches = useMemo(
    () =>
      [...completedMatches].sort(
        (a, b) => new Date(b.kickoffIso).getTime() - new Date(a.kickoffIso).getTime()
      ),
    [completedMatches]
  );

  const [internalMatchId, setInternalMatchId] = useState<string>(
    selectedMatchId || sortedMatches[0]?.id || ''
  );

  const activeMatchId = selectedMatchId || internalMatchId || sortedMatches[0]?.id || '';
  const match = useMemo(
    () => sortedMatches.find((m) => m.id === activeMatchId) || sortedMatches[0] || null,
    [sortedMatches, activeMatchId]
  );

  const rosterTeams = useMemo(() => (match ? getMatchRosterTeams(match) : []), [match]);
  const allRosterPlayers = useMemo(
    () =>
      rosterTeams.flatMap((t) =>
        t.players.map((pl) => ({
          ...pl,
          teamIndex: t.teamIndex,
          teamColor: t.teamColor,
        }))
      ),
    [rosterTeams]
  );

  const [games, setGames] = useState<PostMatchGame[]>([]);
  const [showAddGamePicker, setShowAddGamePicker] = useState<boolean>(false);
  const [draftHomeTeamIndex, setDraftHomeTeamIndex] = useState<number>(0);
  const [draftAwayTeamIndex, setDraftAwayTeamIndex] = useState<number>(1);
  const [absentUids, setAbsentUids] = useState<string[]>([]);
  const [lateUids, setLateUids] = useState<string[]>([]);
  const [attendanceMode, setAttendanceMode] = useState<'on_time' | 'late' | 'absent' | null>(null);
  const [playerRatings, setPlayerRatings] = useState<Record<string, number>>({});
  const [bestPlayerUid, setBestPlayerUid] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [dirty, setDirty] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [savedSuccess, setSavedSuccess] = useState<string | null>(null);

  // Hydrate editor state whenever the target match changes
  useEffect(() => {
    if (!match) return;
    const pg = match.postGameStats;
    const teams = getMatchRosterTeams(match);

    if (pg?.games && pg.games.length > 0) {
      setGames(
        pg.games.map((g) => {
          const safeGoals = Array.isArray(g.goals) ? g.goals : [];
          const homeGoalsCount = safeGoals.filter((ev) => ev.teamIndex === g.homeTeamIndex).length;
          const awayGoalsCount = safeGoals.filter((ev) => ev.teamIndex === g.awayTeamIndex).length;
          return {
            ...g,
            homeScore: Math.max(g.homeScore, homeGoalsCount),
            awayScore: Math.max(g.awayScore, awayGoalsCount),
            goals: safeGoals,
          };
        })
      );
      setShowAddGamePicker(false);
    } else if (teams.length === 2) {
      // Pre-populate 1 default game (Team 1 vs Team 2) so 2-team nights are ready immediately
      setGames([createGameBetween(teams[0], teams[1])]);
      setShowAddGamePicker(false);
    } else if (teams.length > 2) {
      // For 3 or 4 teams, prompt the manager to pick the two team colors for Game 1
      setGames([]);
      setDraftHomeTeamIndex(teams[0].teamIndex);
      setDraftAwayTeamIndex(teams[1].teamIndex);
      setShowAddGamePicker(true);
    } else {
      setGames([]);
      setShowAddGamePicker(false);
    }

    setAbsentUids(Array.isArray(pg?.absentUids) ? [...pg.absentUids] : []);
    setLateUids(Array.isArray(pg?.lateUids) ? [...pg.lateUids] : []);
    setPlayerRatings(pg?.playerMatchRatings ? { ...pg.playerMatchRatings } : {});
    setBestPlayerUid(pg?.bestPlayerUid || '');
    setNotes(pg?.notes || '');
    setDirty(false);
    setError(null);
    setSavedSuccess(null);
  }, [match?.id, match?.postGameStats]);

  const absentSet = useMemo(() => new Set(absentUids), [absentUids]);
  const lateSet = useMemo(() => new Set(lateUids), [lateUids]);

  const goalsByUid = useMemo(() => {
    const map: Record<string, number> = {};
    for (const g of games) {
      for (const ev of g.goals) {
        if (ev.scorerUid) {
          map[ev.scorerUid] = (map[ev.scorerUid] || 0) + 1;
        }
      }
    }
    return map;
  }, [games]);

  const computedTopScorerUid = useMemo(() => {
    let topUid = '';
    let topGoals = 0;
    for (const [uid, count] of Object.entries(goalsByUid)) {
      if (count > topGoals) {
        topGoals = count;
        topUid = uid;
      }
    }
    return topUid;
  }, [goalsByUid]);

  const totalGoalsNight = useMemo(
    () => games.reduce((sum, g) => sum + g.homeScore + g.awayScore, 0),
    [games]
  );

  const handleSelectMatch = (id: string) => {
    setInternalMatchId(id);
    onSelectMatchId?.(id);
  };

  const handleAddGame = () => {
    if (rosterTeams.length < 2) return;
    const pair = pickNextTeamPair(rosterTeams, games);
    if (!pair) return;

    if (rosterTeams.length === 2) {
      setGames((prev) => [...prev, createGameBetween(pair[0], pair[1])]);
      setDirty(true);
      setSavedSuccess(null);
      return;
    }

    // For 3 or 4 teams, ask which two team colors played in this game
    setDraftHomeTeamIndex(pair[0].teamIndex);
    setDraftAwayTeamIndex(pair[1].teamIndex);
    setShowAddGamePicker(true);
  };

  const handleSelectDraftTeam = (side: 'home' | 'away', nextTeamIndex: number) => {
    if (side === 'home') {
      if (nextTeamIndex === draftAwayTeamIndex) {
        setDraftAwayTeamIndex(draftHomeTeamIndex);
      }
      setDraftHomeTeamIndex(nextTeamIndex);
    } else {
      if (nextTeamIndex === draftHomeTeamIndex) {
        setDraftHomeTeamIndex(draftAwayTeamIndex);
      }
      setDraftAwayTeamIndex(nextTeamIndex);
    }
  };

  const handleConfirmAddGame = () => {
    const homeTeam = rosterTeams.find((t) => t.teamIndex === draftHomeTeamIndex);
    const awayTeam = rosterTeams.find((t) => t.teamIndex === draftAwayTeamIndex);
    if (!homeTeam || !awayTeam || homeTeam.teamIndex === awayTeam.teamIndex) return;

    setGames((prev) => [...prev, createGameBetween(homeTeam, awayTeam)]);
    setShowAddGamePicker(false);
    setDirty(true);
    setSavedSuccess(null);
  };

  const handleRemoveGame = (gameId: string) => {
    setGames((prev) => prev.filter((g) => g.id !== gameId));
    setDirty(true);
    setSavedSuccess(null);
  };

  const handleChangeGameTeam = (
    gameId: string,
    side: 'home' | 'away',
    nextTeamIndex: number
  ) => {
    const targetTeam = rosterTeams.find((t) => t.teamIndex === nextTeamIndex);
    if (!targetTeam) return;
    setGames((prev) =>
      prev.map((g) => {
        if (g.id !== gameId) return g;
        if (side === 'home') {
          if (targetTeam.teamIndex === g.homeTeamIndex) return g;
          // If picking the away team's color, cleanly swap both sides
          if (targetTeam.teamIndex === g.awayTeamIndex) {
            return {
              ...g,
              homeTeamIndex: g.awayTeamIndex,
              homeTeamColor: g.awayTeamColor,
              awayTeamIndex: g.homeTeamIndex,
              awayTeamColor: g.homeTeamColor,
              homeScore: g.awayScore,
              awayScore: g.homeScore,
            };
          }
          return {
            ...g,
            homeTeamIndex: targetTeam.teamIndex,
            homeTeamColor: targetTeam.teamColor,
            goals: g.goals.filter((ev) => ev.teamIndex !== g.homeTeamIndex),
          };
        }

        if (targetTeam.teamIndex === g.awayTeamIndex) return g;
        if (targetTeam.teamIndex === g.homeTeamIndex) {
          return {
            ...g,
            homeTeamIndex: g.awayTeamIndex,
            homeTeamColor: g.awayTeamColor,
            awayTeamIndex: g.homeTeamIndex,
            awayTeamColor: g.homeTeamColor,
            homeScore: g.awayScore,
            awayScore: g.homeScore,
          };
        }
        return {
          ...g,
          awayTeamIndex: targetTeam.teamIndex,
          awayTeamColor: targetTeam.teamColor,
          goals: g.goals.filter((ev) => ev.teamIndex !== g.awayTeamIndex),
        };
      })
    );
    setDirty(true);
    setSavedSuccess(null);
  };

  const handleAdjustScore = (gameId: string, side: 'home' | 'away', delta: number) => {
    setGames((prev) =>
      prev.map((g) => {
        if (g.id !== gameId) return g;
        const currentScore = side === 'home' ? g.homeScore : g.awayScore;
        const nextScore = Math.max(0, Math.min(50, currentScore + delta));
        if (nextScore === currentScore) return g;

        const sideTeamIndex = side === 'home' ? g.homeTeamIndex : g.awayTeamIndex;
        let nextGoals = g.goals;

        // If score decreases below currently assigned scorers for this team, trim excess trailing scorers
        if (nextScore < currentScore) {
          let keptForSide = 0;
          nextGoals = g.goals.filter((ev) => {
            if (ev.teamIndex !== sideTeamIndex) return true;
            if (keptForSide < nextScore) {
              keptForSide += 1;
              return true;
            }
            return false;
          });
        }

        return {
          ...g,
          homeScore: side === 'home' ? nextScore : g.homeScore,
          awayScore: side === 'away' ? nextScore : g.awayScore,
          goals: nextGoals,
        };
      })
    );
    setDirty(true);
    setSavedSuccess(null);
  };

  const handleAddGoalScorer = (
    gameId: string,
    side: 'home' | 'away',
    scorerUid: string
  ) => {
    if (!scorerUid) return;
    const rosterPlayer = allRosterPlayers.find((p) => p.uid === scorerUid);
    const profile = playersById.get(scorerUid);
    const scorerName =
      rosterPlayer?.name ||
      (profile ? `${profile.firstName} ${profile.lastName}` : 'Player');

    setGames((prev) =>
      prev.map((g) => {
        if (g.id !== gameId) return g;
        const teamIndex = side === 'home' ? g.homeTeamIndex : g.awayTeamIndex;
        const teamColor = side === 'home' ? g.homeTeamColor : g.awayTeamColor;
        const allowedGoals = side === 'home' ? g.homeScore : g.awayScore;
        const assignedForSide = g.goals.filter((ev) => ev.teamIndex === teamIndex).length;

        // Never allow assigning more scorers than the team's score, and never alter the score here
        if (assignedForSide >= allowedGoals) return g;

        const newEvent: PostMatchGoalEvent = {
          id: makeClientId('goal'),
          scorerUid,
          scorerName,
          teamIndex,
          teamColor,
        };
        return {
          ...g,
          goals: [...g.goals, newEvent],
        };
      })
    );
    setDirty(true);
    setSavedSuccess(null);
  };

  const handleRemoveGoal = (gameId: string, goalId: string) => {
    setGames((prev) =>
      prev.map((g) => {
        if (g.id !== gameId) return g;
        return {
          ...g,
          goals: g.goals.filter((ev) => ev.id !== goalId),
        };
      })
    );
    setDirty(true);
    setSavedSuccess(null);
  };

  const handleSetAttendance = (uid: string, status: 'on_time' | 'late' | 'absent') => {
    setAbsentUids((prev) => {
      const filtered = prev.filter((id) => id !== uid);
      return status === 'absent' ? [...filtered, uid] : filtered;
    });
    setLateUids((prev) => {
      const filtered = prev.filter((id) => id !== uid);
      return status === 'late' ? [...filtered, uid] : filtered;
    });
    if (status === 'absent') {
      // Remove any assigned scorer entries for an absent player while keeping game scores unchanged
      setGames((prev) =>
        prev.map((g) => ({
          ...g,
          goals: g.goals.filter((ev) => ev.scorerUid !== uid),
        }))
      );
      setPlayerRatings((prev) => {
        if (!(uid in prev)) return prev;
        const next = { ...prev };
        delete next[uid];
        return next;
      });
      if (bestPlayerUid === uid) {
        setBestPlayerUid('');
      }
    }
    setDirty(true);
    setSavedSuccess(null);
  };

  const handleTapAttendancePlayer = (
    uid: string,
    selectedCategory: 'on_time' | 'late' | 'absent'
  ) => {
    const isCurrentlyAbsent = absentSet.has(uid);
    const isCurrentlyLate = !isCurrentlyAbsent && lateSet.has(uid);
    if (selectedCategory === 'late') {
      handleSetAttendance(uid, isCurrentlyLate ? 'on_time' : 'late');
    } else if (selectedCategory === 'absent') {
      handleSetAttendance(uid, isCurrentlyAbsent ? 'on_time' : 'absent');
    } else {
      handleSetAttendance(uid, 'on_time');
    }
  };

  const handleSavePostMatchStats = async () => {
    if (!match) return;
    setError(null);
    setSavedSuccess(null);
    setSaving(true);

    try {
      const cleanAbsent = Array.from(new Set(absentUids)).slice(0, 120);
      const cleanAbsentSet = new Set(cleanAbsent);
      const cleanLate = Array.from(new Set(lateUids))
        .filter((uid) => !cleanAbsentSet.has(uid))
        .slice(0, 120);

      const cleanRatings: Record<string, number> = {};
      for (const [uid, val] of Object.entries(playerRatings)) {
        if (!cleanAbsentSet.has(uid) && typeof val === 'number' && val >= 1 && val <= 10) {
          cleanRatings[uid] = Math.round(val * 10) / 10;
        }
      }

      const cleanGames: PostMatchGame[] = games.slice(0, 30).map((g) => ({
        id: g.id,
        homeTeamIndex: g.homeTeamIndex,
        homeTeamColor: g.homeTeamColor,
        awayTeamIndex: g.awayTeamIndex,
        awayTeamColor: g.awayTeamColor,
        homeScore: Math.max(0, Math.min(50, Math.round(g.homeScore))),
        awayScore: Math.max(0, Math.min(50, Math.round(g.awayScore))),
        goals: g.goals.slice(0, 60).map((ev) => ({
          id: ev.id,
          scorerUid: ev.scorerUid,
          scorerName: ev.scorerName.slice(0, 100),
          teamIndex: ev.teamIndex,
          teamColor: ev.teamColor,
        })),
      }));

      const nextPostGameStats: PostGameStats = {
        games: cleanGames,
        absentUids: cleanAbsent,
        lateUids: cleanLate,
        playerMatchRatings: cleanRatings,
        bestPlayerUid: bestPlayerUid && !cleanAbsentSet.has(bestPlayerUid) ? bestPlayerUid : '',
        topScorerUid: computedTopScorerUid || '',
        notes: notes.trim().slice(0, 500),
        updatedBy: user.uid,
        updatedAt: new Date().toISOString(),
      };

      const finalizedEntries = buildFinalizedEntriesFromMatch(match);

      // Recompute accurate career appearances across all completed matches including this update
      const updatedCompletedMatches = completedMatches.map((m) =>
        m.id === match.id
          ? {
              ...m,
              finalizedPlayerTeams:
                finalizedEntries.length > 0 ? finalizedEntries : m.finalizedPlayerTeams,
              postGameStats: nextPostGameStats,
            }
          : m
      );
      const careerStats = computePlayerCareerStats(players, updatedCompletedMatches);

      const batch = writeBatch(db);
      const matchPayload: Record<string, unknown> = {
        postGameStats: nextPostGameStats,
        updatedAt: serverTimestamp(),
      };
      if ((!match.finalizedPlayerTeams || match.finalizedPlayerTeams.length === 0) && finalizedEntries.length > 0) {
        matchPayload.finalizedPlayerTeams = finalizedEntries;
      }
      batch.update(doc(db, 'matches', match.id), matchPayload);

      // Sync appearance counts on player profiles so Profile & Rating cards match Stats
      const rosterUids = new Set(finalizedEntries.map((e) => e.uid));
      for (const uid of rosterUids) {
        const player = playersById.get(uid);
        if (!player) continue;
        const computedApps = careerStats[uid]?.appearances ?? 0;
        if (player.appearances !== computedApps) {
          batch.update(doc(db, 'players', uid), {
            appearances: computedApps,
            updatedAt: serverTimestamp(),
          });
        }
      }

      await batch.commit();
      setDirty(false);
      const msg = `Saved post-match stats for "${match.title}" (${cleanGames.length} ${
        cleanGames.length === 1 ? 'game' : 'games'
      }, ${cleanLate.length} late, ${cleanAbsent.length} absent).`;
      setSavedSuccess(msg);
      onSavedNotice?.(msg);
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.UPDATE, `matches/${match.id}`);
      } catch (wrapped) {
        setError(wrapped instanceof Error ? wrapped.message : 'Failed to save post-match stats.');
      }
    } finally {
      setSaving(false);
    }
  };

  if (!match) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-8 text-center space-y-2">
        <Trophy className="w-7 h-7 text-slate-400 mx-auto" />
        <h3 className="font-display text-lg font-bold text-slate-900">
          No Completed Match
        </h3>
      </div>
    );
  }

  const attendanceRoster = (() => {
    const seen = new Set<string>();
    const list: {
      uid: string;
      name: string;
      teamColor: string;
      teamIndex: number;
    }[] = [];

    for (const pl of allRosterPlayers) {
      if (seen.has(pl.uid)) continue;
      seen.add(pl.uid);
      list.push({
        uid: pl.uid,
        name: pl.name,
        teamColor: pl.teamColor,
        teamIndex: pl.teamIndex,
      });
    }

    return list;
  })();

  const onTimePlayers = attendanceRoster.filter(
    (pl) => !absentSet.has(pl.uid) && !lateSet.has(pl.uid)
  );
  const latePlayers = attendanceRoster.filter(
    (pl) => !absentSet.has(pl.uid) && lateSet.has(pl.uid)
  );
  const absentPlayers = attendanceRoster.filter((pl) => absentSet.has(pl.uid));

  const compactMatchDate = new Date(match.kickoffIso).toLocaleDateString('en-CA', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <div className="space-y-4 pb-6">
      {/* Compact Session Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center justify-between sm:justify-start gap-2.5 min-w-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono-tabular text-sm font-bold text-slate-900">
                {compactMatchDate}
              </span>
              <span className="text-xs font-mono-tabular text-slate-500 inline-flex items-center gap-1">
                <span>{games.length}G</span>
                <span aria-hidden="true">·</span>
                <span className="inline-flex items-center gap-1">
                  {totalGoalsNight}
                  <SoccerBallIcon className="w-3.5 h-3.5" />
                </span>
              </span>
            </div>
            {rosterTeams.length > 0 && (
              <div className="flex flex-wrap items-center gap-2.5 mt-1.5">
                {rosterTeams.map((team) => {
                  const presentCount = team.players.filter((pl) => !absentSet.has(pl.uid)).length;
                  return (
                    <span
                      key={team.teamIndex}
                      className="inline-flex items-center gap-1 text-xs text-slate-700"
                    >
                      <TeamJerseyIcon color={team.teamColor} size={16} />
                      <span className="font-semibold text-slate-900">{team.teamColor}</span>
                      <span className="font-mono-tabular text-[11px] text-slate-400">
                        {presentCount}
                      </span>
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {sortedMatches.length > 1 && (
            <select
              value={match.id}
              onChange={(e) => handleSelectMatch(e.target.value)}
              aria-label="Select match date"
              className="flex-1 sm:flex-none h-10 px-2.5 rounded-lg border border-slate-300 bg-white text-sm sm:text-xs font-medium text-slate-800 max-w-[190px]"
            >
              {sortedMatches.map((m) => (
                <option key={m.id} value={m.id}>
                  {new Date(m.kickoffIso).toLocaleDateString('en-CA', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </option>
              ))}
            </select>
          )}

          <button
            type="button"
            disabled={saving}
            onClick={handleSavePostMatchStats}
            className="h-10 px-4 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-sm sm:text-xs font-semibold inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 transition-colors disabled:opacity-50"
          >
            {saving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            <span>{saving ? 'Saving' : 'Save'}</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs sm:text-sm text-red-800">
          {error}
        </div>
      )}

      {savedSuccess && (
        <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs sm:text-sm text-emerald-800 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{savedSuccess}</span>
        </div>
      )}

      {rosterTeams.length < 2 ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-xs text-amber-900">
          At least 2 saved teams are required.
        </div>
      ) : (
        <>
          {/* SECTION 1: GAMES & SCORERS */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-900">
                Games ({games.length})
              </h3>
              <button
                type="button"
                onClick={handleAddGame}
                className="h-9 px-3 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Game
              </button>
            </div>

            {/* 3- or 4-Team Color Picker */}
            {showAddGamePicker && rosterTeams.length > 2 && (() => {
              const draftHome = rosterTeams.find((t) => t.teamIndex === draftHomeTeamIndex);
              const draftAway = rosterTeams.find((t) => t.teamIndex === draftAwayTeamIndex);
              return (
                <div className="p-4 bg-slate-50 border-b border-slate-200 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="text-xs font-bold text-slate-900">
                      Game {games.length + 1}
                    </h4>
                    {games.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setShowAddGamePicker(false)}
                        aria-label="Close picker"
                        className="p-1 text-slate-500 hover:text-slate-800"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>

                  <div className="grid sm:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        Team 1
                      </span>
                      <div className="flex flex-wrap gap-2">
                        {rosterTeams.map((t) => {
                          const selected = t.teamIndex === draftHomeTeamIndex;
                          return (
                            <button
                              key={t.teamIndex}
                              type="button"
                              onClick={() => handleSelectDraftTeam('home', t.teamIndex)}
                              className={`min-h-[40px] px-3 py-1.5 rounded-lg border text-xs font-semibold inline-flex items-center gap-1.5 transition-colors ${
                                selected
                                  ? 'border-emerald-700 bg-emerald-50 text-emerald-900 ring-1 ring-emerald-700'
                                  : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400'
                              }`}
                            >
                              <TeamJerseyIcon color={t.teamColor} size={18} />
                              {t.teamColor}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        Team 2
                      </span>
                      <div className="flex flex-wrap gap-2">
                        {rosterTeams.map((t) => {
                          const selected = t.teamIndex === draftAwayTeamIndex;
                          return (
                            <button
                              key={t.teamIndex}
                              type="button"
                              onClick={() => handleSelectDraftTeam('away', t.teamIndex)}
                              className={`min-h-[40px] px-3 py-1.5 rounded-lg border text-xs font-semibold inline-flex items-center gap-1.5 transition-colors ${
                                selected
                                  ? 'border-emerald-700 bg-emerald-50 text-emerald-900 ring-1 ring-emerald-700'
                                  : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400'
                              }`}
                            >
                              <TeamJerseyIcon color={t.teamColor} size={18} />
                              {t.teamColor}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={
                      !draftHome || !draftAway || draftHome.teamIndex === draftAway.teamIndex
                    }
                    onClick={handleConfirmAddGame}
                    className="w-full sm:w-auto h-10 px-4 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40"
                  >
                    <Plus className="w-4 h-4" />
                    {draftHome?.teamColor} vs {draftAway?.teamColor}
                  </button>
                </div>
              );
            })()}

            {games.length === 0 ? (
              !showAddGamePicker && (
                <div className="p-6 text-center">
                  <button
                    type="button"
                    onClick={handleAddGame}
                    className="h-10 px-4 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold inline-flex items-center gap-1.5"
                  >
                    <Plus className="w-4 h-4" />
                    Add Game
                  </button>
                </div>
              )
            ) : (
              <div className="divide-y divide-slate-200">
                {games.map((game, idx) => {
                  const homeTeam = rosterTeams.find((t) => t.teamIndex === game.homeTeamIndex);
                  const awayTeam = rosterTeams.find((t) => t.teamIndex === game.awayTeamIndex);
                  const homePalette = getTeamColorPalette(game.homeTeamColor, game.homeTeamIndex);
                  const awayPalette = getTeamColorPalette(game.awayTeamColor, game.awayTeamIndex);
                  const homeGoals = game.goals.filter((ev) => ev.teamIndex === game.homeTeamIndex);
                  const awayGoals = game.goals.filter((ev) => ev.teamIndex === game.awayTeamIndex);
                  const sameTeamWarning = game.homeTeamIndex === game.awayTeamIndex;

                  const renderSideColumn = (
                    side: 'home' | 'away',
                    team: MatchRosterTeam | undefined,
                    teamColor: string,
                    score: number,
                    sideGoals: PostMatchGoalEvent[]
                  ) => {
                    const teamPlayers = (team?.players || []).filter((pl) => !absentSet.has(pl.uid));
                    const remainingSlots = Math.max(0, score - sideGoals.length);

                    return (
                      <div className="space-y-2.5">
                        {/* Team + Large Thumb-Friendly Score Stepper */}
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <TeamJerseyIcon color={teamColor} size={22} />
                            {rosterTeams.length > 2 ? (
                              <select
                                value={team?.teamIndex ?? 0}
                                onChange={(e) =>
                                  handleChangeGameTeam(game.id, side, Number(e.target.value))
                                }
                                aria-label={`Game ${idx + 1} ${side} team`}
                                className="h-9 px-2 rounded-lg border border-slate-300 bg-white text-sm sm:text-xs font-semibold text-slate-900"
                              >
                                {rosterTeams.map((t) => (
                                  <option key={t.teamIndex} value={t.teamIndex}>
                                    {t.teamColor}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <span className="text-sm font-semibold text-slate-900 truncate">
                                {teamColor}
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={() => handleAdjustScore(game.id, side, -1)}
                              disabled={score <= 0}
                              aria-label={`Decrease ${teamColor} score`}
                              className="w-10 h-10 sm:w-8 sm:h-8 rounded-lg border border-slate-300 bg-white active:bg-slate-100 hover:bg-slate-50 text-slate-700 flex items-center justify-center disabled:opacity-35"
                            >
                              <Minus className="w-4 h-4" />
                            </button>
                            <span className="font-mono-tabular text-2xl sm:text-xl font-bold text-slate-900 w-8 text-center">
                              {score}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleAdjustScore(game.id, side, 1)}
                              aria-label={`Increase ${teamColor} score`}
                              className="w-10 h-10 sm:w-8 sm:h-8 rounded-lg border border-slate-300 bg-white active:bg-slate-100 hover:bg-slate-50 text-slate-700 flex items-center justify-center"
                            >
                              <Plus className="w-4 h-4" />
                            </button>
                          </div>
                        </div>

                        {/* Scorer Picker (shown only when goals remain to assign) */}
                        {score > 0 && remainingSlots > 0 && (
                          <select
                            value=""
                            onChange={(e) => {
                              if (e.target.value) {
                                handleAddGoalScorer(game.id, side, e.target.value);
                              }
                            }}
                            aria-label={`Add scorer for ${teamColor} in Game ${idx + 1}`}
                            className="w-full h-10 px-3 rounded-lg border border-slate-300 bg-slate-50 hover:bg-white text-sm sm:text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-600"
                          >
                            <option value="">
                              + Scorer ({sideGoals.length + 1}/{score})
                            </option>
                            {teamPlayers.map((pl) => (
                              <option key={pl.uid} value={pl.uid}>
                                {pl.name}
                              </option>
                            ))}
                          </select>
                        )}

                        {/* Recorded Scorers Chips */}
                        {sideGoals.length > 0 && (
                          <div className="flex flex-wrap gap-1.5">
                            {sideGoals.map((ev) => (
                              <span
                                key={ev.id}
                                className="inline-flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-lg bg-slate-100 border border-slate-200/80 text-xs font-medium text-slate-800"
                              >
                                <SoccerBallIcon className="w-3.5 h-3.5 shrink-0" />
                                <span className="max-w-[140px] truncate">{ev.scorerName}</span>
                                <button
                                  type="button"
                                  onClick={() => handleRemoveGoal(game.id, ev.id)}
                                  title="Remove"
                                  aria-label={`Remove ${ev.scorerName}`}
                                  className="p-1 rounded-md text-slate-400 hover:text-rose-600 hover:bg-white"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  };

                  return (
                    <div key={game.id} className="p-3.5 sm:p-4 space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 text-xs">
                          <span className="font-mono-tabular font-bold text-slate-900">
                            G{idx + 1}
                          </span>
                          <span className="inline-flex items-center gap-1.5 font-semibold text-slate-700">
                            <span
                              className={`w-2.5 h-2.5 rounded-xs border ${homePalette.bg} ${homePalette.border}`}
                              aria-hidden="true"
                            />
                            {game.homeTeamColor}
                            <span className="font-mono-tabular text-slate-900">
                              {game.homeScore}–{game.awayScore}
                            </span>
                            <span
                              className={`w-2.5 h-2.5 rounded-xs border ${awayPalette.bg} ${awayPalette.border}`}
                              aria-hidden="true"
                            />
                            {game.awayTeamColor}
                          </span>
                          {sameTeamWarning && (
                            <span className="text-amber-700 font-semibold">· Same team</span>
                          )}
                        </div>

                        {games.length > 1 && (
                          <button
                            type="button"
                            onClick={() => handleRemoveGame(game.id)}
                            aria-label={`Remove Game ${idx + 1}`}
                            title="Remove game"
                            className="p-1.5 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>

                      <div className="grid md:grid-cols-2 gap-4 md:divide-x md:divide-slate-100">
                        <div>
                          {renderSideColumn(
                            'home',
                            homeTeam,
                            game.homeTeamColor,
                            game.homeScore,
                            homeGoals
                          )}
                        </div>
                        <div className="pt-3 border-t border-slate-100 md:pt-0 md:border-t-0 md:pl-4">
                          {renderSideColumn(
                            'away',
                            awayTeam,
                            game.awayTeamColor,
                            game.awayScore,
                            awayGoals
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* SECTION 2: ATTENDANCE (3 BUTTONS -> TAP PLAYERS) */}
          <div className="bg-white border border-slate-200 rounded-xl p-3.5 sm:p-4 space-y-3">
            <h3 className="text-sm font-semibold text-slate-900">Attendance</h3>

            {/* 3 Primary Status Buttons */}
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() =>
                  setAttendanceMode((prev) => (prev === 'on_time' ? null : 'on_time'))
                }
                aria-expanded={attendanceMode === 'on_time'}
                className={`min-h-[52px] px-2 py-2.5 rounded-xl border text-xs font-semibold flex flex-col items-center justify-center gap-1 transition-colors ${
                  attendanceMode === 'on_time'
                    ? 'bg-emerald-700 border-emerald-700 text-white shadow-xs'
                    : 'bg-emerald-50/60 border-emerald-200 text-emerald-900 hover:bg-emerald-50'
                }`}
              >
                <span className="inline-flex items-center gap-1">
                  <UserCheck className="w-3.5 h-3.5" />
                  <span>On Time</span>
                </span>
                <span
                  className={`font-mono-tabular text-sm font-bold ${
                    attendanceMode === 'on_time' ? 'text-white' : 'text-emerald-700'
                  }`}
                >
                  {onTimePlayers.length}
                </span>
              </button>

              <button
                type="button"
                onClick={() =>
                  setAttendanceMode((prev) => (prev === 'late' ? null : 'late'))
                }
                aria-expanded={attendanceMode === 'late'}
                className={`min-h-[52px] px-2 py-2.5 rounded-xl border text-xs font-semibold flex flex-col items-center justify-center gap-1 transition-colors ${
                  attendanceMode === 'late'
                    ? 'bg-amber-600 border-amber-600 text-white shadow-xs'
                    : 'bg-amber-50/70 border-amber-200 text-amber-900 hover:bg-amber-50'
                }`}
              >
                <span className="inline-flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" />
                  <span>Late</span>
                </span>
                <span
                  className={`font-mono-tabular text-sm font-bold ${
                    attendanceMode === 'late' ? 'text-white' : 'text-amber-700'
                  }`}
                >
                  {latePlayers.length}
                </span>
              </button>

              <button
                type="button"
                onClick={() =>
                  setAttendanceMode((prev) => (prev === 'absent' ? null : 'absent'))
                }
                aria-expanded={attendanceMode === 'absent'}
                className={`min-h-[52px] px-2 py-2.5 rounded-xl border text-xs font-semibold flex flex-col items-center justify-center gap-1 transition-colors ${
                  attendanceMode === 'absent'
                    ? 'bg-rose-600 border-rose-600 text-white shadow-xs'
                    : 'bg-rose-50/70 border-rose-200 text-rose-900 hover:bg-rose-50'
                }`}
              >
                <span className="inline-flex items-center gap-1">
                  <UserX className="w-3.5 h-3.5" />
                  <span>Absent</span>
                </span>
                <span
                  className={`font-mono-tabular text-sm font-bold ${
                    attendanceMode === 'absent' ? 'text-white' : 'text-rose-700'
                  }`}
                >
                  {absentPlayers.length}
                </span>
              </button>
            </div>

            {/* Compact Summary Tags when picker is closed */}
            {attendanceMode === null && (latePlayers.length > 0 || absentPlayers.length > 0) && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {latePlayers.map((pl) => (
                  <button
                    key={pl.uid}
                    type="button"
                    onClick={() => setAttendanceMode('late')}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-amber-50 border border-amber-200 text-[11px] font-medium text-amber-900"
                  >
                    <Clock className="w-3 h-3 text-amber-600" />
                    <span>{pl.name}</span>
                  </button>
                ))}
                {absentPlayers.map((pl) => (
                  <button
                    key={pl.uid}
                    type="button"
                    onClick={() => setAttendanceMode('absent')}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-rose-50 border border-rose-200 text-[11px] font-medium text-rose-900"
                  >
                    <UserX className="w-3 h-3 text-rose-600" />
                    <span>{pl.name}</span>
                  </button>
                ))}
              </div>
            )}

            {/* Expanded Touch-Friendly Player Selector */}
            {attendanceMode !== null && (
              <div className="pt-2 border-t border-slate-100 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-700">
                    {attendanceMode === 'on_time'
                      ? 'On Time'
                      : attendanceMode === 'late'
                        ? 'Late'
                        : 'Absent'}
                  </span>
                  <button
                    type="button"
                    onClick={() => setAttendanceMode(null)}
                    className="text-xs font-semibold text-slate-500 hover:text-slate-900 px-2 py-1 rounded-md hover:bg-slate-100"
                  >
                    Done
                  </button>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                  {attendanceRoster.map((pl) => {
                    const isAbsent = absentSet.has(pl.uid);
                    const isLate = !isAbsent && lateSet.has(pl.uid);
                    const isOnTime = !isAbsent && !isLate;
                    const isSelected =
                      (attendanceMode === 'on_time' && isOnTime) ||
                      (attendanceMode === 'late' && isLate) ||
                      (attendanceMode === 'absent' && isAbsent);

                    const palette = pl.teamColor
                      ? getTeamColorPalette(pl.teamColor, pl.teamIndex ?? 0)
                      : null;

                    const activeClasses =
                      attendanceMode === 'on_time'
                        ? 'bg-emerald-50 border-emerald-600 text-emerald-950 ring-1 ring-emerald-600'
                        : attendanceMode === 'late'
                          ? 'bg-amber-50 border-amber-500 text-amber-950 ring-1 ring-amber-500'
                          : 'bg-rose-50 border-rose-500 text-rose-950 ring-1 ring-rose-500';

                    const checkClasses =
                      attendanceMode === 'on_time'
                        ? 'bg-emerald-700 text-white'
                        : attendanceMode === 'late'
                          ? 'bg-amber-600 text-white'
                          : 'bg-rose-600 text-white';

                    return (
                      <button
                        key={pl.uid}
                        type="button"
                        onClick={() => handleTapAttendancePlayer(pl.uid, attendanceMode)}
                        aria-pressed={isSelected}
                        className={`min-h-[44px] px-2.5 py-2 rounded-lg border text-left text-xs font-medium flex items-center justify-between gap-2 transition-colors ${
                          isSelected
                            ? activeClasses
                            : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300'
                        }`}
                      >
                        <span className="flex items-center gap-1.5 min-w-0">
                          {palette && (
                            <span
                              className={`w-2.5 h-2.5 rounded-full border shrink-0 ${palette.bg} ${palette.border}`}
                              aria-hidden="true"
                            />
                          )}
                          <span className="truncate">{pl.name}</span>
                        </span>

                        {isSelected ? (
                          <span
                            className={`w-4 h-4 rounded-full flex items-center justify-center shrink-0 ${checkClasses}`}
                          >
                            <Check className="w-2.5 h-2.5" />
                          </span>
                        ) : isLate ? (
                          <Clock className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                        ) : isAbsent ? (
                          <UserX className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Mobile-Friendly Bottom Save Bar */}
          <div className="flex items-center justify-end pt-1">
            <button
              type="button"
              disabled={saving}
              onClick={handleSavePostMatchStats}
              className="w-full sm:w-auto h-11 sm:h-10 px-6 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-sm sm:text-xs font-semibold inline-flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
            >
              {saving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              <span>{saving ? 'Saving...' : dirty ? 'Save Changes' : 'Save'}</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
};
