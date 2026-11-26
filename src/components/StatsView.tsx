import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  ArrowUpDown,
  History,
  Search,
  Star,
  Users,
  X,
} from 'lucide-react';
import { DropInMatch, getTeamColorPalette, PlayerProfile } from '../types';
import {
  computePlayerCareerStats,
  computeTeammateCoOccurrence,
} from '../utils/clubUtils';
import { SoccerBallIcon } from './SoccerBallIcon';

interface StatsViewProps {
  currentUserId: string;
  players: PlayerProfile[];
  completedMatches: DropInMatch[];
}

type StatsSortField =
  | 'appearances'
  | 'goals'
  | 'rating'
  | 'wins'
  | 'mvp'
  | 'late'
  | 'absent'
  | 'name';

type SortDirection = 'desc' | 'asc';
type RightPanelMode = 'all' | 'compare';

export const StatsView: React.FC<StatsViewProps> = ({
  currentUserId,
  players,
  completedMatches,
}) => {
  const [rightMode, setRightMode] = useState<RightPanelMode>('all');
  const [compareUid, setCompareUid] = useState<string>('');
  const [sortBy, setSortBy] = useState<StatsSortField>('appearances');
  const [sortDir, setSortDir] = useState<SortDirection>('desc');
  const [search, setSearch] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [showMyHistory, setShowMyHistory] = useState(false);

  const playersById = useMemo(() => new Map(players.map((p) => [p.uid, p])), [players]);

  const sortedCompletedMatches = useMemo(
    () =>
      [...completedMatches].sort(
        (a, b) => new Date(b.kickoffIso).getTime() - new Date(a.kickoffIso).getTime()
      ),
    [completedMatches]
  );

  const careerStats = useMemo(
    () => computePlayerCareerStats(players, sortedCompletedMatches),
    [players, sortedCompletedMatches]
  );

  const teammateMatrix = useMemo(
    () => computeTeammateCoOccurrence(sortedCompletedMatches),
    [sortedCompletedMatches]
  );

  const currentPlayer = playersById.get(currentUserId) || players[0] || null;
  const currentStats = currentPlayer ? careerStats[currentPlayer.uid] : null;

  const otherPlayers = useMemo(
    () =>
      players
        .filter((p) => p.uid !== currentPlayer?.uid)
        .sort((a, b) =>
          `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`)
        ),
    [players, currentPlayer?.uid]
  );

  // Pick a sensible default comparison teammate
  useEffect(() => {
    if (otherPlayers.length === 0) {
      if (compareUid !== '') setCompareUid('');
      return;
    }
    if (!compareUid || !otherPlayers.some((p) => p.uid === compareUid)) {
      setCompareUid(otherPlayers[0].uid);
    }
  }, [otherPlayers, compareUid]);

  const comparePlayer = playersById.get(compareUid) || otherPlayers[0] || null;
  const compareStats = comparePlayer ? careerStats[comparePlayer.uid] : null;

  const myCommonTeammates = useMemo(() => {
    if (!currentPlayer) return [];
    const counts = teammateMatrix[currentPlayer.uid] || {};
    return Object.entries(counts)
      .map(([uid, count]) => {
        const tm = playersById.get(uid);
        const name = tm ? `${tm.firstName} ${tm.lastName}` : 'Club Member';
        const initials = tm
          ? `${tm.firstName[0] || ''}${tm.lastName[0] || ''}`.toUpperCase()
          : 'CM';
        return {
          uid,
          name,
          initials,
          photoUrl: tm?.approvedPhotoUrl || '',
          hasProfile: Boolean(tm),
          count,
        };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [currentPlayer, teammateMatrix, playersById]);

  const handleSortColumn = (field: StatsSortField) => {
    if (sortBy === field) {
      setSortDir((prev) => (prev === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortBy(field);
      setSortDir(field === 'name' ? 'asc' : 'desc');
    }
  };

  const sortedPlayers = useMemo(() => {
    const term = search.trim().toLowerCase();
    const dir = sortDir === 'asc' ? 1 : -1;

    return [...players]
      .filter((p) => `${p.firstName} ${p.lastName}`.toLowerCase().includes(term))
      .sort((a, b) => {
        const sa = careerStats[a.uid];
        const sb = careerStats[b.uid];
        const appsA = Math.max(sa?.appearances ?? 0, a.appearances ?? 0);
        const appsB = Math.max(sb?.appearances ?? 0, b.appearances ?? 0);

        let cmp = 0;
        if (sortBy === 'name') {
          cmp = `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`);
        } else if (sortBy === 'goals') {
          cmp = (sa?.goals ?? 0) - (sb?.goals ?? 0);
        } else if (sortBy === 'rating') {
          const ra = sa?.avgRating ?? -1;
          const rb = sb?.avgRating ?? -1;
          cmp = ra - rb;
        } else if (sortBy === 'wins') {
          cmp = (sa?.wins ?? 0) - (sb?.wins ?? 0);
        } else if (sortBy === 'mvp') {
          cmp = (sa?.mvpCount ?? 0) - (sb?.mvpCount ?? 0);
        } else if (sortBy === 'late') {
          cmp = (sa?.lateCount ?? 0) - (sb?.lateCount ?? 0);
        } else if (sortBy === 'absent') {
          cmp = (sa?.absentCount ?? 0) - (sb?.absentCount ?? 0);
        } else {
          cmp = appsA - appsB;
        }

        if (cmp !== 0) return cmp * dir;
        return appsB - appsA || a.lastName.localeCompare(b.lastName);
      });
  }, [players, search, sortBy, sortDir, careerStats]);

  const myApps = currentPlayer
    ? Math.max(currentStats?.appearances ?? 0, currentPlayer.appearances ?? 0)
    : 0;
  const myTotalGames = currentStats
    ? currentStats.wins + currentStats.draws + currentStats.losses
    : 0;
  const myWinPct =
    myTotalGames > 0 && currentStats
      ? Math.round((currentStats.wins / myTotalGames) * 100)
      : 0;

  const compareApps = comparePlayer
    ? Math.max(compareStats?.appearances ?? 0, comparePlayer.appearances ?? 0)
    : 0;
  const compareTotalGames = compareStats
    ? compareStats.wins + compareStats.draws + compareStats.losses
    : 0;
  const compareWinPct =
    compareTotalGames > 0 && compareStats
      ? Math.round((compareStats.wins / compareTotalGames) * 100)
      : 0;

  const matchesPlayedTogether =
    currentPlayer && comparePlayer
      ? teammateMatrix[currentPlayer.uid]?.[comparePlayer.uid] || 0
      : 0;

  const renderSortIcon = (field: StatsSortField) => {
    if (sortBy !== field) {
      return <ArrowUpDown className="w-3 h-3 text-slate-400 opacity-60" />;
    }
    return sortDir === 'desc' ? (
      <ArrowDown className="w-3 h-3 text-emerald-700" />
    ) : (
      <ArrowUp className="w-3 h-3 text-emerald-700" />
    );
  };

  const renderAvatar = (p: PlayerProfile, sizeClass = 'w-10 h-10 text-xs') => (
    <div
      className={`${sizeClass} rounded-full bg-slate-100 border border-slate-200 overflow-hidden flex items-center justify-center font-bold text-slate-700 shrink-0`}
    >
      {p.approvedPhotoUrl ? (
        <img
          src={p.approvedPhotoUrl}
          alt={`${p.firstName} ${p.lastName}`}
          referrerPolicy="no-referrer"
          className="w-full h-full object-cover"
        />
      ) : (
        `${p.firstName[0] || ''}${p.lastName[0] || ''}`.toUpperCase()
      )}
    </div>
  );

  const comparisonMetrics = useMemo(() => {
    if (!currentStats || !compareStats) return [];
    return [
      {
        label: 'Appearances',
        leftVal: myApps,
        rightVal: compareApps,
        leftDisplay: String(myApps),
        rightDisplay: String(compareApps),
        higherIsBetter: true,
        showBall: false,
      },
      {
        label: 'Goals',
        leftVal: currentStats.goals,
        rightVal: compareStats.goals,
        leftDisplay: String(currentStats.goals),
        rightDisplay: String(compareStats.goals),
        higherIsBetter: true,
        showBall: true,
      },
      {
        label: 'Avg Rating',
        leftVal: currentStats.avgRating ?? 0,
        rightVal: compareStats.avgRating ?? 0,
        leftDisplay: currentStats.avgRating !== null ? currentStats.avgRating.toFixed(1) : '—',
        rightDisplay: compareStats.avgRating !== null ? compareStats.avgRating.toFixed(1) : '—',
        higherIsBetter: true,
        maxOverride: 10,
        showBall: false,
      },
      {
        label: 'Wins',
        leftVal: currentStats.wins,
        rightVal: compareStats.wins,
        leftDisplay: String(currentStats.wins),
        rightDisplay: String(compareStats.wins),
        higherIsBetter: true,
        showBall: false,
      },
      {
        label: 'Win Rate',
        leftVal: myWinPct,
        rightVal: compareWinPct,
        leftDisplay: myTotalGames > 0 ? `${myWinPct}%` : '—',
        rightDisplay: compareTotalGames > 0 ? `${compareWinPct}%` : '—',
        higherIsBetter: true,
        maxOverride: 100,
        showBall: false,
      },
      {
        label: 'MVP',
        leftVal: currentStats.mvpCount,
        rightVal: compareStats.mvpCount,
        leftDisplay: String(currentStats.mvpCount),
        rightDisplay: String(compareStats.mvpCount),
        higherIsBetter: true,
        showBall: false,
      },
      {
        label: 'Late',
        leftVal: currentStats.lateCount,
        rightVal: compareStats.lateCount,
        leftDisplay: String(currentStats.lateCount),
        rightDisplay: String(compareStats.lateCount),
        higherIsBetter: false,
        showBall: false,
      },
      {
        label: 'Absent',
        leftVal: currentStats.absentCount,
        rightVal: compareStats.absentCount,
        leftDisplay: String(currentStats.absentCount),
        rightDisplay: String(compareStats.absentCount),
        higherIsBetter: false,
        showBall: false,
      },
    ];
  }, [
    currentStats,
    compareStats,
    myApps,
    compareApps,
    myWinPct,
    compareWinPct,
    myTotalGames,
    compareTotalGames,
  ]);

  return (
    <div className="space-y-5">
      {/* Minimal Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
        <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
          Stats
        </h1>

        {/* Right Workspace Mode Switcher: All Others vs Compare */}
        <div
          role="tablist"
          aria-label="Stats workspace mode"
          className="inline-flex items-center p-1 bg-slate-200/75 rounded-lg"
        >
          <button
            type="button"
            role="tab"
            aria-selected={rightMode === 'all'}
            onClick={() => setRightMode('all')}
            className={`px-3.5 py-1.5 rounded-md text-xs font-semibold inline-flex items-center gap-1.5 transition-colors ${
              rightMode === 'all'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            All Players
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={rightMode === 'compare'}
            onClick={() => setRightMode('compare')}
            className={`px-3.5 py-1.5 rounded-md text-xs font-semibold inline-flex items-center gap-1.5 transition-colors ${
              rightMode === 'compare'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <ArrowLeftRight className="w-3.5 h-3.5" />
            Compare
          </button>
        </div>
      </div>

      {/* Two-Column Split: Persistent Logged-In Player Card (Left) + All Players / Compare (Right) */}
      <div className="grid lg:grid-cols-12 gap-5 items-start">
        {/* LEFT COLUMN: Logged-In Player's Own Overall Stats Card */}
        {currentPlayer && currentStats && (
          <div className="lg:col-span-4 lg:sticky lg:top-6 space-y-4">
            <div className="bg-white border border-emerald-200/90 rounded-2xl overflow-hidden shadow-xs">
              {/* Top Personal Banner */}
              <div className="bg-gradient-to-br from-emerald-900 via-emerald-800 to-slate-900 text-white p-5">
                <div className="flex items-center gap-3.5">
                  <div className="w-14 h-14 rounded-full bg-white/10 border-2 border-emerald-300/60 overflow-hidden flex items-center justify-center font-display text-lg font-bold text-white shrink-0">
                    {currentPlayer.approvedPhotoUrl ? (
                      <img
                        src={currentPlayer.approvedPhotoUrl}
                        alt={`${currentPlayer.firstName} ${currentPlayer.lastName}`}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      `${currentPlayer.firstName[0] || ''}${currentPlayer.lastName[0] || ''}`.toUpperCase()
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="text-[10px] font-bold uppercase tracking-widest text-emerald-300">
                      Your Stats
                    </div>
                    <h2 className="font-display text-xl font-bold leading-tight truncate">
                      {currentPlayer.firstName} {currentPlayer.lastName}
                    </h2>
                    <div className="text-xs text-emerald-100/80 font-mono-tabular mt-0.5">
                      {currentPlayer.favoritePositions.join(' · ') || '—'} · Age {currentPlayer.age}
                    </div>
                  </div>
                </div>
              </div>

              {/* Overall Career KPI Grid */}
              <div className="p-4 space-y-4">
                <div className="grid grid-cols-2 gap-2.5">
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
                    <div className="text-[11px] font-medium text-slate-500">Appearances</div>
                    <div className="mt-1 font-mono-tabular text-2xl font-bold text-slate-900 leading-none">
                      {myApps}
                    </div>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
                    <div className="text-[11px] font-medium text-slate-500">Goals</div>
                    <div className="mt-1 font-mono-tabular text-2xl font-bold text-emerald-700 leading-none inline-flex items-center gap-1.5">
                      <span>{currentStats.goals}</span>
                      {currentStats.goals > 0 && <SoccerBallIcon className="w-4 h-4" />}
                    </div>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
                    <div className="text-[11px] font-medium text-slate-500">Avg Rating</div>
                    <div className="mt-1 font-mono-tabular text-2xl font-bold text-slate-900 leading-none">
                      {currentStats.avgRating !== null ? currentStats.avgRating.toFixed(1) : '—'}
                    </div>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
                    <div className="text-[11px] font-medium text-slate-500">W-D-L</div>
                    <div className="mt-1 font-mono-tabular text-lg font-bold text-slate-900 leading-tight">
                      {currentStats.wins}-{currentStats.draws}-{currentStats.losses}
                    </div>
                    {myTotalGames > 0 && (
                      <div className="text-[10px] font-mono-tabular text-slate-500 mt-0.5">
                        {myWinPct}% win
                      </div>
                    )}
                  </div>
                </div>

                {/* Secondary Row: MVP / Late / Absent */}
                <div className="grid grid-cols-3 gap-2 pt-1 border-t border-slate-100 text-center">
                  <div className="py-1.5">
                    <div className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">
                      MVP
                    </div>
                    <div
                      className={`font-mono-tabular text-sm font-bold mt-0.5 ${
                        currentStats.mvpCount > 0 ? 'text-amber-700' : 'text-slate-400'
                      }`}
                    >
                      {currentStats.mvpCount}
                    </div>
                  </div>
                  <div className="py-1.5 border-x border-slate-100">
                    <div className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">
                      Late
                    </div>
                    <div
                      className={`font-mono-tabular text-sm font-bold mt-0.5 ${
                        currentStats.lateCount > 0 ? 'text-amber-700' : 'text-slate-400'
                      }`}
                    >
                      {currentStats.lateCount}
                    </div>
                  </div>
                  <div className="py-1.5">
                    <div className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">
                      Absent
                    </div>
                    <div
                      className={`font-mono-tabular text-sm font-bold mt-0.5 ${
                        currentStats.absentCount > 0 ? 'text-rose-700' : 'text-slate-400'
                      }`}
                    >
                      {currentStats.absentCount}
                    </div>
                  </div>
                </div>

                {/* Top Teammates (Quick Compare Links) */}
                {myCommonTeammates.length > 0 && (
                  <div className="pt-3 border-t border-slate-100 space-y-2">
                    <div className="text-[11px] font-semibold text-slate-500 flex items-center gap-1.5">
                      <Users className="w-3.5 h-3.5 text-emerald-700" />
                      Common Teammates
                    </div>
                    <div className="space-y-1">
                      {myCommonTeammates.map((tm) => (
                        <button
                          key={tm.uid}
                          type="button"
                          disabled={!tm.hasProfile}
                          onClick={() => {
                            if (tm.hasProfile) {
                              setCompareUid(tm.uid);
                              setRightMode('compare');
                            }
                          }}
                          title="Click to compare stats"
                          className="w-full px-2.5 py-1.5 rounded-lg hover:bg-slate-50 transition-colors flex items-center justify-between gap-2 text-xs text-left disabled:cursor-default"
                        >
                          <span className="font-medium text-slate-800 truncate">{tm.name}</span>
                          <span className="font-mono-tabular text-[11px] font-semibold text-emerald-700 shrink-0">
                            {tm.count}×
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Collapsible Personal Match History */}
                <div className="pt-3 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setShowMyHistory((prev) => !prev)}
                    className="w-full flex items-center justify-between text-xs font-semibold text-slate-700 hover:text-slate-900"
                  >
                    <span className="inline-flex items-center gap-1.5">
                      <History className="w-3.5 h-3.5 text-emerald-700" />
                      Match History ({currentStats.matchLogs.length})
                    </span>
                    <span className="text-[11px] font-medium text-emerald-700">
                      {showMyHistory ? 'Hide' : 'Show'}
                    </span>
                  </button>

                  {showMyHistory && (
                    <div className="mt-2.5 space-y-1.5 max-h-64 overflow-y-auto pr-0.5">
                      {currentStats.matchLogs.length === 0 ? (
                        <p className="text-xs text-slate-400">No completed matches yet.</p>
                      ) : (
                        currentStats.matchLogs.slice(0, 12).map((log) => {
                          const palette = getTeamColorPalette(log.teamColor, log.teamIndex);
                          const dateStr = new Date(log.match.kickoffIso).toLocaleDateString('en-CA', {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          });
                          return (
                            <div
                              key={log.match.id}
                              className="p-2.5 rounded-lg bg-slate-50 border border-slate-200/70 text-[11px] space-y-1"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-semibold text-slate-900 truncate flex items-center gap-1.5">
                                  <span className="truncate">{log.match.title}</span>
                                  {log.goals > 0 && (
                                    <span
                                      className="inline-flex items-center gap-0.5 shrink-0"
                                      title={`${log.goals} ${log.goals === 1 ? 'goal' : 'goals'}`}
                                    >
                                      {Array.from({ length: log.goals }).map((_, i) => (
                                        <SoccerBallIcon key={i} className="w-3 h-3" />
                                      ))}
                                    </span>
                                  )}
                                </span>
                                <span className="inline-flex items-center gap-1 font-mono-tabular text-[10px] font-semibold text-slate-700 shrink-0">
                                  <span
                                    className={`w-2 h-2 rounded-xs border ${palette.bg} ${palette.border}`}
                                    aria-hidden="true"
                                  />
                                  {log.assignedPosition}
                                </span>
                              </div>
                              <div className="flex items-center justify-between text-[10px] text-slate-500 font-mono-tabular">
                                <span>{dateStr}</span>
                                <span className="inline-flex items-center gap-1.5">
                                  {log.matchRating !== null && (
                                    <span className="font-semibold text-slate-800">
                                      {log.matchRating}/10
                                    </span>
                                  )}
                                  {log.isMvp && (
                                    <span className="inline-flex items-center gap-0.5 text-amber-700 font-semibold">
                                      <Star className="w-2.5 h-2.5 fill-amber-500 text-amber-500" />
                                      MVP
                                    </span>
                                  )}
                                  <span
                                    className={
                                      log.status === 'absent'
                                        ? 'text-rose-700 font-semibold'
                                        : log.status === 'late'
                                          ? 'text-amber-700 font-semibold'
                                          : 'text-emerald-700'
                                    }
                                  >
                                    {log.status === 'absent'
                                      ? 'Absent'
                                      : log.status === 'late'
                                        ? 'Late'
                                        : 'Played'}
                                  </span>
                                </span>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* RIGHT COLUMN: Mode 1 (All Players Table) OR Mode 2 (Compare Head-to-Head) */}
        <div className="lg:col-span-8">
          {rightMode === 'all' ? (
            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
              {/* Sort & Search Toolbar */}
              <div className="px-4 py-3 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <label htmlFor="stats-sort-select" className="text-xs font-medium text-slate-500">
                    Sort
                  </label>
                  <select
                    id="stats-sort-select"
                    value={sortBy}
                    onChange={(e) => {
                      const next = e.target.value as StatsSortField;
                      setSortBy(next);
                      setSortDir(next === 'name' ? 'asc' : 'desc');
                    }}
                    className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-800"
                  >
                    <option value="appearances">Apps</option>
                    <option value="goals">Goals</option>
                    <option value="rating">Rating</option>
                    <option value="wins">Wins</option>
                    <option value="mvp">MVP</option>
                    <option value="late">Late</option>
                    <option value="absent">Absent</option>
                    <option value="name">Name</option>
                  </select>

                  <button
                    type="button"
                    onClick={() => setSortDir((prev) => (prev === 'desc' ? 'asc' : 'desc'))}
                    title={sortDir === 'desc' ? 'Descending' : 'Ascending'}
                    aria-label={`Sort direction: ${sortDir === 'desc' ? 'Descending' : 'Ascending'}`}
                    className="px-2 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 inline-flex items-center gap-1 transition-colors"
                  >
                    {sortDir === 'desc' ? (
                      <>
                        <ArrowDown className="w-3.5 h-3.5 text-emerald-700" />
                        <span>Desc</span>
                      </>
                    ) : (
                      <>
                        <ArrowUp className="w-3.5 h-3.5 text-emerald-700" />
                        <span>Asc</span>
                      </>
                    )}
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400 font-mono-tabular">
                    {sortedPlayers.length}/{players.length}
                  </span>
                  {showSearch || search ? (
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        type="text"
                        autoFocus
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Player..."
                        className="pl-7 pr-7 py-1.5 w-36 sm:w-44 rounded-lg border border-slate-300 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-600"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setSearch('');
                          setShowSearch(false);
                        }}
                        aria-label="Close player search"
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setShowSearch(true)}
                      title="Search player"
                      aria-label="Search player"
                      className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors"
                    >
                      <Search className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* All Players Table (Current Logged-In Player Always Highlighted) */}
              <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 sticky top-0 z-10">
                    <tr>
                      <th className="py-2.5 pl-4 pr-2 font-semibold w-9">#</th>
                      <th className="py-2.5 px-2.5 font-semibold">
                        <button
                          type="button"
                          onClick={() => handleSortColumn('name')}
                          className="inline-flex items-center gap-1 hover:text-slate-900"
                        >
                          <span>Player</span>
                          {renderSortIcon('name')}
                        </button>
                      </th>
                      <th className="py-2.5 px-2 font-semibold text-right">
                        <button
                          type="button"
                          onClick={() => handleSortColumn('appearances')}
                          className="inline-flex items-center gap-1 hover:text-slate-900 ml-auto"
                        >
                          <span>Apps</span>
                          {renderSortIcon('appearances')}
                        </button>
                      </th>
                      <th className="py-2.5 px-2 font-semibold text-right">
                        <button
                          type="button"
                          onClick={() => handleSortColumn('goals')}
                          className="inline-flex items-center gap-1 hover:text-slate-900 ml-auto"
                        >
                          <span>Goals</span>
                          {renderSortIcon('goals')}
                        </button>
                      </th>
                      <th className="py-2.5 px-2 font-semibold text-right">
                        <button
                          type="button"
                          onClick={() => handleSortColumn('rating')}
                          className="inline-flex items-center gap-1 hover:text-slate-900 ml-auto"
                        >
                          <span>Rating</span>
                          {renderSortIcon('rating')}
                        </button>
                      </th>
                      <th className="py-2.5 px-2 font-semibold text-right">
                        <button
                          type="button"
                          onClick={() => handleSortColumn('wins')}
                          className="inline-flex items-center gap-1 hover:text-slate-900 ml-auto"
                        >
                          <span>W-D-L</span>
                          {renderSortIcon('wins')}
                        </button>
                      </th>
                      <th className="py-2.5 px-2 font-semibold text-right">
                        <button
                          type="button"
                          onClick={() => handleSortColumn('mvp')}
                          className="inline-flex items-center gap-1 hover:text-slate-900 ml-auto"
                        >
                          <span>MVP</span>
                          {renderSortIcon('mvp')}
                        </button>
                      </th>
                      <th className="py-2.5 px-2 font-semibold text-right">
                        <button
                          type="button"
                          onClick={() => handleSortColumn('late')}
                          className="inline-flex items-center gap-1 hover:text-slate-900 ml-auto"
                        >
                          <span>Late</span>
                          {renderSortIcon('late')}
                        </button>
                      </th>
                      <th className="py-2.5 px-2 font-semibold text-right">
                        <button
                          type="button"
                          onClick={() => handleSortColumn('absent')}
                          className="inline-flex items-center gap-1 hover:text-slate-900 ml-auto"
                        >
                          <span>Absent</span>
                          {renderSortIcon('absent')}
                        </button>
                      </th>
                      <th className="py-2.5 pl-1 pr-3 w-9" aria-label="Compare" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {sortedPlayers.length === 0 ? (
                      <tr>
                        <td colSpan={10} className="py-8 px-4 text-center text-slate-500">
                          No players found.
                        </td>
                      </tr>
                    ) : (
                      sortedPlayers.map((p, idx) => {
                        const st = careerStats[p.uid];
                        const apps = Math.max(st?.appearances ?? 0, p.appearances ?? 0);
                        const goals = st?.goals ?? 0;
                        const avgRating = st?.avgRating;
                        const wins = st?.wins ?? 0;
                        const draws = st?.draws ?? 0;
                        const losses = st?.losses ?? 0;
                        const mvp = st?.mvpCount ?? 0;
                        const late = st?.lateCount ?? 0;
                        const absent = st?.absentCount ?? 0;
                        const isMe = p.uid === currentUserId;

                        return (
                          <tr
                            key={p.uid}
                            onClick={() => {
                              if (!isMe) {
                                setCompareUid(p.uid);
                                setRightMode('compare');
                              }
                            }}
                            className={`transition-colors ${
                              isMe
                                ? 'bg-emerald-50/95 ring-1 ring-inset ring-emerald-200/80'
                                : 'hover:bg-slate-50 cursor-pointer'
                            }`}
                          >
                            <td
                              className={`py-2.5 pl-4 pr-2 font-mono-tabular ${
                                isMe
                                  ? 'border-l-[3px] border-l-emerald-600 font-bold text-emerald-800'
                                  : 'text-slate-400'
                              }`}
                            >
                              {idx + 1}
                            </td>
                            <td className="py-2.5 px-2.5 whitespace-nowrap">
                              <div className="flex items-center gap-2">
                                {renderAvatar(p, 'w-7 h-7 text-[10px]')}
                                <div className="min-w-0">
                                  <div
                                    className={`truncate ${
                                      isMe
                                        ? 'font-bold text-emerald-950'
                                        : 'font-semibold text-slate-900'
                                    }`}
                                  >
                                    {p.firstName} {p.lastName}
                                    {isMe && (
                                      <span className="ml-1.5 text-[10px] font-bold uppercase tracking-wider text-emerald-700">
                                        You
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-[10px] text-slate-400 font-mono-tabular">
                                    {p.favoritePositions[0] || '—'}
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td className="py-2.5 px-2 text-right font-mono-tabular font-semibold text-slate-900">
                              {apps}
                            </td>
                            <td className="py-2.5 px-2 text-right font-mono-tabular font-semibold text-emerald-700">
                              <span className="inline-flex items-center justify-end gap-1">
                                <span>{goals}</span>
                                {goals > 0 && <SoccerBallIcon className="w-3.5 h-3.5" />}
                              </span>
                            </td>
                            <td className="py-2.5 px-2 text-right font-mono-tabular font-semibold text-slate-800">
                              {avgRating !== null && avgRating !== undefined
                                ? avgRating.toFixed(1)
                                : '—'}
                            </td>
                            <td className="py-2.5 px-2 text-right font-mono-tabular text-slate-700 whitespace-nowrap">
                              {wins}-{draws}-{losses}
                            </td>
                            <td
                              className={`py-2.5 px-2 text-right font-mono-tabular font-semibold ${
                                mvp > 0 ? 'text-amber-700' : 'text-slate-300'
                              }`}
                            >
                              {mvp}
                            </td>
                            <td
                              className={`py-2.5 px-2 text-right font-mono-tabular font-semibold ${
                                late > 0 ? 'text-amber-700' : 'text-slate-300'
                              }`}
                            >
                              {late}
                            </td>
                            <td
                              className={`py-2.5 px-2 text-right font-mono-tabular font-semibold ${
                                absent > 0 ? 'text-rose-700' : 'text-slate-300'
                              }`}
                            >
                              {absent}
                            </td>
                            <td className="py-2.5 pl-1 pr-3 text-right">
                              {!isMe && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setCompareUid(p.uid);
                                    setRightMode('compare');
                                  }}
                                  title={`Compare with ${p.firstName}`}
                                  aria-label={`Compare with ${p.firstName} ${p.lastName}`}
                                  className="p-1.5 rounded-md text-slate-400 hover:text-emerald-700 hover:bg-emerald-50 transition-colors"
                                >
                                  <ArrowLeftRight className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            /* MODE 2: Head-to-Head Overall Stats Comparison (You vs Selected Player) */
            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
              {/* Opponent Selector Header */}
              <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50/70 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <ArrowLeftRight className="w-4 h-4 text-emerald-700" />
                  <span className="text-xs font-semibold text-slate-900">Head-to-Head</span>
                </div>

                <div className="flex items-center gap-2">
                  <label htmlFor="compare-player-select" className="text-xs text-slate-500">
                    Compare with
                  </label>
                  <select
                    id="compare-player-select"
                    value={comparePlayer?.uid || ''}
                    onChange={(e) => setCompareUid(e.target.value)}
                    disabled={otherPlayers.length === 0}
                    className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-600"
                  >
                    {otherPlayers.length === 0 ? (
                      <option value="">No other players</option>
                    ) : (
                      otherPlayers.map((p) => (
                        <option key={p.uid} value={p.uid}>
                          {p.firstName} {p.lastName}
                        </option>
                      ))
                    )}
                  </select>
                </div>
              </div>

              {!currentPlayer || !comparePlayer || !currentStats || !compareStats ? (
                <div className="p-10 text-center text-sm text-slate-500">
                  No other club players available to compare yet.
                </div>
              ) : (
                <div className="p-5 space-y-5">
                  {/* Face-Off Player Headers */}
                  <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 pb-4 border-b border-slate-100">
                    <div className="flex items-center gap-2.5 min-w-0">
                      {renderAvatar(currentPlayer, 'w-11 h-11 text-xs')}
                      <div className="min-w-0">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">
                          You
                        </div>
                        <div className="text-sm font-bold text-slate-900 truncate">
                          {currentPlayer.firstName} {currentPlayer.lastName}
                        </div>
                        <div className="text-[11px] font-mono-tabular text-slate-500 truncate">
                          {currentPlayer.favoritePositions.slice(0, 2).join('/') || '—'} ·{' '}
                          {currentStats.wins}-{currentStats.draws}-{currentStats.losses}
                        </div>
                      </div>
                    </div>

                    <div className="text-center px-2">
                      <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                        VS
                      </div>
                      {matchesPlayedTogether > 0 && (
                        <div className="text-[10px] font-mono-tabular text-slate-500 mt-0.5 whitespace-nowrap">
                          {matchesPlayedTogether}× together
                        </div>
                      )}
                    </div>

                    <div className="flex items-center justify-end gap-2.5 min-w-0 text-right">
                      <div className="min-w-0">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-sky-700">
                          Selected
                        </div>
                        <div className="text-sm font-bold text-slate-900 truncate">
                          {comparePlayer.firstName} {comparePlayer.lastName}
                        </div>
                        <div className="text-[11px] font-mono-tabular text-slate-500 truncate">
                          {comparePlayer.favoritePositions.slice(0, 2).join('/') || '—'} ·{' '}
                          {compareStats.wins}-{compareStats.draws}-{compareStats.losses}
                        </div>
                      </div>
                      {renderAvatar(comparePlayer, 'w-11 h-11 text-xs')}
                    </div>
                  </div>

                  {/* Mirrored Comparison Bars */}
                  <div className="space-y-3.5">
                    {comparisonMetrics.map((m) => {
                      const scaleMax =
                        m.maxOverride ?? Math.max(1, m.leftVal, m.rightVal);
                      const leftPct = Math.min(100, Math.round((m.leftVal / scaleMax) * 100));
                      const rightPct = Math.min(100, Math.round((m.rightVal / scaleMax) * 100));
                      const leftLeads =
                        m.leftVal !== m.rightVal &&
                        (m.higherIsBetter ? m.leftVal > m.rightVal : m.leftVal < m.rightVal);
                      const rightLeads =
                        m.leftVal !== m.rightVal &&
                        (m.higherIsBetter ? m.rightVal > m.leftVal : m.rightVal < m.leftVal);

                      return (
                        <div key={m.label} className="space-y-1.5">
                          <div className="grid grid-cols-3 items-center text-xs">
                            <div
                              className={`font-mono-tabular font-bold inline-flex items-center gap-1 ${
                                leftLeads ? 'text-emerald-700' : 'text-slate-700'
                              }`}
                            >
                              <span>{m.leftDisplay}</span>
                              {m.showBall && m.leftVal > 0 && (
                                <SoccerBallIcon className="w-3.5 h-3.5" />
                              )}
                            </div>
                            <div className="text-center text-[11px] font-semibold text-slate-500">
                              {m.label}
                            </div>
                            <div
                              className={`font-mono-tabular font-bold inline-flex items-center justify-end gap-1 ${
                                rightLeads ? 'text-sky-700' : 'text-slate-700'
                              }`}
                            >
                              {m.showBall && m.rightVal > 0 && (
                                <SoccerBallIcon className="w-3.5 h-3.5" />
                              )}
                              <span>{m.rightDisplay}</span>
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-1.5">
                            {/* Left bar grows right-to-left */}
                            <div className="h-2 rounded-full bg-slate-100 overflow-hidden flex justify-end">
                              <div
                                className={`h-full rounded-full transition-all duration-300 ${
                                  leftLeads ? 'bg-emerald-600' : 'bg-emerald-300'
                                }`}
                                style={{ width: `${leftPct}%` }}
                              />
                            </div>
                            {/* Right bar grows left-to-right */}
                            <div className="h-2 rounded-full bg-slate-100 overflow-hidden flex justify-start">
                              <div
                                className={`h-full rounded-full transition-all duration-300 ${
                                  rightLeads ? 'bg-sky-600' : 'bg-sky-300'
                                }`}
                                style={{ width: `${rightPct}%` }}
                              />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
