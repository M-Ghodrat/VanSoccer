import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Calendar, Clock, Search, Trophy, Users, X } from 'lucide-react';
import { DropInMatch, getTeamColorPalette, MatchVote, PlayerProfile } from '../types';
import { formatShortDateTime, partitionAttendingVotes } from '../utils/clubUtils';
import { SoccerPitch } from './SoccerPitch';
import { SoccerBallIcon } from './SoccerBallIcon';
import { TeamJerseyIcon } from './TeamJerseyIcon';

interface MatchesViewProps {
  matches: DropInMatch[];
  activeMatch: DropInMatch | null;
  activeMatchVotes: MatchVote[];
  playersById: Map<string, PlayerProfile>;
  maxPlayers: number;
  onNavigateMatchday: () => void;
  onNavigateManager?: () => void;
}

type MatchFilter = 'all' | 'current' | 'past';

export const MatchesView: React.FC<MatchesViewProps> = ({
  matches,
  activeMatch,
  activeMatchVotes,
  playersById,
  maxPlayers,
  onNavigateMatchday,
  onNavigateManager,
}) => {
  const [filter, setFilter] = useState<MatchFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [selectedMatchId, setSelectedMatchId] = useState<string>(
    activeMatch?.id || matches[0]?.id || ''
  );

  const currentMatches = useMemo(
    () => matches.filter((m) => m.status !== 'completed'),
    [matches]
  );
  const pastMatches = useMemo(
    () => matches.filter((m) => m.status === 'completed'),
    [matches]
  );

  const filteredMatches = useMemo(() => {
    const base =
      filter === 'current'
        ? currentMatches
        : filter === 'past'
          ? pastMatches
          : matches;
    const term = searchQuery.trim().toLowerCase();
    if (!term) return base;
    return base.filter((m) =>
      `${m.title} ${m.location} ${m.weekKey}`.toLowerCase().includes(term)
    );
  }, [filter, currentMatches, pastMatches, matches, searchQuery]);

  useEffect(() => {
    if (filteredMatches.length === 0) return;
    if (!filteredMatches.some((m) => m.id === selectedMatchId)) {
      setSelectedMatchId(filteredMatches[0].id);
    }
  }, [filteredMatches, selectedMatchId]);

  const selectedMatch = useMemo(
    () => filteredMatches.find((m) => m.id === selectedMatchId) || filteredMatches[0] || null,
    [filteredMatches, selectedMatchId]
  );

  const { confirmedVotes, waitlistedVotes } = useMemo(
    () => partitionAttendingVotes(activeMatchVotes, maxPlayers),
    [activeMatchVotes, maxPlayers]
  );

  const isSelectedActive = Boolean(selectedMatch && activeMatch && selectedMatch.id === activeMatch.id);

  // Group finalizedPlayerTeams by teamIndex when a completed match has finalized records but no pitch formation
  const groupedFinalizedTeams = useMemo(() => {
    if (!selectedMatch?.finalizedPlayerTeams || selectedMatch.finalizedPlayerTeams.length === 0) {
      return [];
    }
    const map = new Map<
      number,
      { teamIndex: number; teamColor: string; players: { uid: string; name: string; assignedPosition: string }[] }
    >();
    for (const entry of selectedMatch.finalizedPlayerTeams) {
      const existing = map.get(entry.teamIndex) || {
        teamIndex: entry.teamIndex,
        teamColor: entry.teamColor,
        players: [],
      };
      existing.players.push({
        uid: entry.uid,
        name: entry.name,
        assignedPosition: entry.assignedPosition,
      });
      map.set(entry.teamIndex, existing);
    }
    return Array.from(map.values()).sort((a, b) => a.teamIndex - b.teamIndex);
  }, [selectedMatch]);

  return (
    <div className="space-y-6">
      {/* Minimal Page Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
        <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
          Matches Archive
        </h1>

        <div className="flex flex-wrap items-center gap-2">
          {(showSearch || searchQuery) ? (
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                autoFocus
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search..."
                className="pl-7 pr-7 py-1.5 w-44 rounded-lg border border-slate-300 bg-white text-xs focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setShowSearch(false);
                }}
                aria-label="Close match search"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowSearch(true)}
              title="Search matches"
              aria-label="Search matches"
              className="p-2 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 transition-colors"
            >
              <Search className="w-4 h-4" />
            </button>
          )}

          <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg">
            {[
              { id: 'all' as const, label: `All (${matches.length})` },
              { id: 'current' as const, label: `Current (${currentMatches.length})` },
              { id: 'past' as const, label: `Past (${pastMatches.length})` },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilter(tab.id)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                  filter === tab.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {matches.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-3">
          <h2 className="font-display text-2xl font-bold text-slate-900">No Matches Recorded Yet</h2>
          <p className="text-sm text-slate-600 max-w-md mx-auto">
            Once a club manager opens a weekly drop-in poll, current and past match records will appear here.
          </p>
          {onNavigateManager && (
            <button
              type="button"
              onClick={onNavigateManager}
              className="mt-2 px-4 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold"
            >
              Open Manager Command Center
            </button>
          )}
        </div>
      ) : (
        <div className="grid lg:grid-cols-12 gap-6 items-start">
          {/* Match Directory List */}
          <div className="lg:col-span-4 bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-800">
                {filter === 'current'
                  ? 'Current Matches'
                  : filter === 'past'
                    ? 'Past Matches'
                    : 'All Club Matches'}
              </span>
              <span className="font-mono-tabular text-slate-500">
                {filteredMatches.length} {filteredMatches.length === 1 ? 'session' : 'sessions'}
              </span>
            </div>

            {filteredMatches.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500">
                No matches found for this filter.
              </div>
            ) : (
              <div className="divide-y divide-slate-100 max-h-[620px] overflow-y-auto">
                {filteredMatches.map((m) => {
                  const isCurrent = m.status !== 'completed';
                  const isSelected = selectedMatch?.id === m.id;
                  const playerCount =
                    activeMatch?.id === m.id
                      ? confirmedVotes.length
                      : m.currentFormation
                        ? m.currentFormation.teams.reduce((sum, t) => sum + t.players.length, 0)
                        : m.finalizedPlayerTeams?.length || 0;

                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setSelectedMatchId(m.id)}
                      className={`w-full text-left px-4 py-3.5 transition-colors flex flex-col gap-1 ${
                        isSelected ? 'bg-emerald-50/90' : 'hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-slate-900 truncate">
                          {m.title}
                        </span>
                        <span
                          className={`text-[11px] font-semibold shrink-0 ${
                            isCurrent ? 'text-emerald-700' : 'text-slate-500'
                          }`}
                        >
                          {isCurrent ? 'Current' : 'Past'}
                        </span>
                      </div>
                      <div className="text-xs text-slate-500 font-mono-tabular flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span>{new Date(m.kickoffIso).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                        <span>·</span>
                        <span>{m.currentFormation?.teams.length || 2} teams</span>
                        <span>·</span>
                        <span>{playerCount} players</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Selected Match Details */}
          <div className="lg:col-span-8 space-y-4">
            {selectedMatch ? (
              <>
                <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="font-display text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
                          {selectedMatch.title}
                        </h2>
                        <span
                          className={`text-[11px] font-semibold ${
                            selectedMatch.status !== 'completed' ? 'text-emerald-700' : 'text-slate-500'
                          }`}
                        >
                          {selectedMatch.status !== 'completed' ? 'Current' : 'Past'}
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
                        <span className="inline-flex items-center gap-1">
                          <Calendar className="w-3.5 h-3.5 text-emerald-700" />
                          <span className="font-mono-tabular">
                            {new Date(selectedMatch.kickoffIso).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })}
                          </span>
                        </span>
                        {selectedMatch.currentFormation && (
                          <span className="inline-flex items-center gap-1">
                            <Users className="w-3.5 h-3.5 text-emerald-700" />
                            <span className="font-mono-tabular">
                              {selectedMatch.currentFormation.teams.length}
                            </span>{' '}
                            Teams
                          </span>
                        )}
                      </div>
                    </div>

                    {isSelectedActive && (
                      <button
                        type="button"
                        onClick={onNavigateMatchday}
                        className="px-3.5 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 self-start"
                      >
                        Matchday
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  {/* Active Match Live Attendance Summary */}
                  {isSelectedActive && (
                    <div className="pt-4 border-t border-slate-100 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-slate-700">
                      <span>
                        Confirmed:{' '}
                        <strong className="font-mono-tabular text-emerald-800">
                          {confirmedVotes.length}/{maxPlayers}
                        </strong>
                      </span>
                      {waitlistedVotes.length > 0 && (
                        <span className="inline-flex items-center gap-1 text-amber-800">
                          <Clock className="w-3.5 h-3.5" />
                          Waiting List:{' '}
                          <strong className="font-mono-tabular">{waitlistedVotes.length}</strong>
                        </span>
                      )}
                    </div>
                  )}

                  {/* Post-Game Summary if recorded */}
                  {selectedMatch.postGameStats &&
                    ((selectedMatch.postGameStats.games &&
                      selectedMatch.postGameStats.games.length > 0) ||
                      selectedMatch.postGameStats.bestPlayerUid ||
                      selectedMatch.postGameStats.topScorerUid ||
                      selectedMatch.postGameStats.notes ||
                      selectedMatch.postGameStats.lateUids.length > 0 ||
                      selectedMatch.postGameStats.absentUids.length > 0) && (() => {
                      const stats = selectedMatch.postGameStats;
                      const games = stats.games || [];
                      const bestPlayer = stats.bestPlayerUid
                        ? playersById.get(stats.bestPlayerUid)
                        : null;
                      const topScorer = stats.topScorerUid
                        ? playersById.get(stats.topScorerUid)
                        : null;
                      const lateNames = (stats.lateUids || [])
                        .map((uid) => {
                          const p = playersById.get(uid);
                          return p ? `${p.firstName} ${p.lastName}` : null;
                        })
                        .filter(Boolean) as string[];
                      const absentNames = (stats.absentUids || [])
                        .map((uid) => {
                          const p = playersById.get(uid);
                          return p ? `${p.firstName} ${p.lastName}` : null;
                        })
                        .filter(Boolean) as string[];

                      const renderScorersWithBalls = (goals: { scorerName: string }[]) => {
                        const counts = new Map<string, number>();
                        for (const goal of goals) {
                          counts.set(goal.scorerName, (counts.get(goal.scorerName) || 0) + 1);
                        }
                        return Array.from(counts.entries()).map(([name, count], idx) => (
                          <span key={idx} className="inline-flex items-center gap-1 mx-1.5">
                            <span className="font-medium text-slate-800">{name}</span>
                            <span className="inline-flex items-center gap-0.5" title={`${count} ${count === 1 ? 'goal' : 'goals'}`}>
                              {Array.from({ length: count }).map((_, i) => (
                                <SoccerBallIcon key={i} className="w-3.5 h-3.5" />
                              ))}
                            </span>
                          </span>
                        ));
                      };

                      return (
                        <div className="pt-4 border-t border-slate-100 space-y-3 text-xs">
                          <div className="font-semibold text-slate-800 flex items-center gap-1.5">
                            <Trophy className="w-3.5 h-3.5 text-amber-600" />
                            Post-Match Results &amp; Summary
                          </div>

                          {games.length > 0 && (
                            <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg bg-slate-50/50">
                              {games.map((g, gi) => {
                                const homeGoals = (g.goals || []).filter(
                                  (ev) => ev.teamIndex === g.homeTeamIndex
                                );
                                const awayGoals = (g.goals || []).filter(
                                  (ev) => ev.teamIndex === g.awayTeamIndex
                                );
                                return (
                                  <div key={g.id} className="px-3.5 py-2.5 space-y-1">
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="font-mono-tabular text-[11px] text-slate-400">
                                        Game {gi + 1}
                                      </span>
                                      <div className="flex items-center gap-2 font-semibold text-slate-900">
                                        <span className="inline-flex items-center gap-1">
                                          <TeamJerseyIcon color={g.homeTeamColor} size={14} />
                                          {g.homeTeamColor}
                                        </span>
                                        <span className="font-mono-tabular font-bold px-2 py-0.5 rounded bg-white border border-slate-200">
                                          {g.homeScore} – {g.awayScore}
                                        </span>
                                        <span className="inline-flex items-center gap-1">
                                          {g.awayTeamColor}
                                          <TeamJerseyIcon color={g.awayTeamColor} size={14} />
                                        </span>
                                      </div>
                                      <span className="w-10 hidden sm:inline-block" aria-hidden="true" />
                                    </div>
                                    {(homeGoals.length > 0 || awayGoals.length > 0) && (
                                      <div className="text-[11px] text-slate-600 text-center flex flex-wrap items-center justify-center gap-2 pt-1">
                                        {homeGoals.length > 0 && (
                                          <span className="inline-flex items-center gap-1">
                                            <span className="font-semibold text-slate-800">{g.homeTeamColor}:</span>
                                            {renderScorersWithBalls(homeGoals)}
                                          </span>
                                        )}
                                        {awayGoals.length > 0 && (
                                          <span className="inline-flex items-center gap-1">
                                            <span className="font-semibold text-slate-800">{g.awayTeamColor}:</span>
                                            {renderScorersWithBalls(awayGoals)}
                                          </span>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}

                          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-slate-700">
                            {bestPlayer && (
                              <span>
                                MVP:{' '}
                                <strong className="text-slate-900">
                                  {bestPlayer.firstName} {bestPlayer.lastName}
                                </strong>
                              </span>
                            )}
                            {topScorer && (
                              <span>
                                Top Scorer:{' '}
                                <strong className="text-slate-900">
                                  {topScorer.firstName} {topScorer.lastName}
                                </strong>
                              </span>
                            )}
                            {lateNames.length > 0 && (
                              <span>
                                Late:{' '}
                                <strong className="text-amber-800">{lateNames.join(', ')}</strong>
                              </span>
                            )}
                            {absentNames.length > 0 && (
                              <span>
                                Absent:{' '}
                                <strong className="text-rose-700">{absentNames.join(', ')}</strong>
                              </span>
                            )}
                          </div>
                          {stats.notes && (
                            <p className="text-slate-600 leading-relaxed">{stats.notes}</p>
                          )}
                        </div>
                      );
                    })()}
                </div>

                {/* Tactical Lineup (minimal: no header metadata, no avg age, no table below, compact icons, scorer balls) */}
                {selectedMatch.currentFormation ? (() => {
                  const goalsByUid = new Map<string, number>();
                  for (const g of selectedMatch.postGameStats?.games || []) {
                    for (const ev of g.goals || []) {
                      if (ev.scorerUid) {
                        goalsByUid.set(ev.scorerUid, (goalsByUid.get(ev.scorerUid) || 0) + 1);
                      }
                    }
                  }
                  return (
                    <SoccerPitch
                      formation={selectedMatch.currentFormation}
                      playersById={playersById}
                      editable={false}
                      showRatings={false}
                      showPreferredPositions={false}
                      showTeamHeader={false}
                      showAvgAge={false}
                      showRosterTable={false}
                      compactTokens={true}
                      compactGrid={true}
                      goalsByUid={goalsByUid}
                    />
                  );
                })() : groupedFinalizedTeams.length > 0 ? (
                  <div className="grid sm:grid-cols-2 gap-4">
                    {groupedFinalizedTeams.map((team) => {
                      const palette = getTeamColorPalette(team.teamColor, team.teamIndex);
                      return (
                        <div
                          key={team.teamIndex}
                          className="bg-white border border-slate-200 rounded-xl overflow-hidden"
                        >
                          <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span
                                className={`w-3.5 h-3.5 rounded-sm border ${palette.bg} ${palette.border}`}
                                aria-hidden="true"
                              />
                              <span className="font-display text-lg font-bold text-slate-900">
                                Team {team.teamColor}
                              </span>
                            </div>
                            <span className="text-xs font-mono-tabular text-slate-500">
                              {team.players.length} players
                            </span>
                          </div>
                          <ul className="divide-y divide-slate-100 text-xs">
                            {team.players.map((pl) => (
                              <li
                                key={pl.uid}
                                className="px-4 py-2 flex items-center justify-between gap-2"
                              >
                                <span className="font-medium text-slate-900">{pl.name}</span>
                                <span className="font-mono-tabular font-semibold text-emerald-700">
                                  {pl.assignedPosition}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      );
                    })}
                  </div>
                ) : isSelectedActive ? (
                  <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-slate-900">
                        Confirmed Sign-Ups ({confirmedVotes.length}/{maxPlayers})
                      </h3>
                      <span className="text-xs text-slate-500">Teams pending manager formation</span>
                    </div>
                    {confirmedVotes.length === 0 ? (
                      <p className="text-xs text-slate-500">No confirmed players yet.</p>
                    ) : (
                      <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-2 text-xs">
                        {confirmedVotes.map((v, idx) => (
                          <div
                            key={v.uid}
                            className="px-3 py-2 rounded-lg bg-slate-50 border border-slate-200/80 flex items-center justify-between gap-2"
                          >
                            <span className="font-medium text-slate-900 truncate">
                              <span className="font-mono-tabular text-slate-400 mr-1.5">{idx + 1}.</span>
                              {v.playerName}
                            </span>
                            {v.goalieOption !== 'none' && (
                              <span className="text-[11px] font-semibold text-amber-700 shrink-0">
                                {v.goalieOption === 'only_goalie' ? 'GK' : 'W-GK'}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-500">
                    No team formation was published for this past match.
                  </div>
                )}
              </>
            ) : (
              <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-500">
                Select a match from the list to inspect its details and lineups.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
