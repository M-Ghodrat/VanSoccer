import {
  AggregatedPlayerRating,
  ClubSettings,
  DEFAULT_SKILL_ARROW_THRESHOLDS,
  DropInMatch,
  FinalizedPlayerTeamEntry,
  MatchVote,
  normalizeStandardTeamColor,
  PlayerProfile,
  PlayerRating,
  PostMatchGame,
  TeamFormation,
} from '../types';

export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const DEFAULT_MAX_PLAYERS = 22;

export const DEFAULT_CLUB_SETTINGS: Omit<ClubSettings, 'updatedBy' | 'updatedAt'> = {
  pollOpenDay: 1, // Monday
  pollOpenTime: '12:00',
  pollLockDay: 2, // Tuesday
  pollLockTime: '18:00',
  matchDay: 3, // Wednesday
  matchTime: '21:00', // 9:00 PM - 10:15 PM
  matchLocation: 'Ambleside Artificial Field, West Vancouver',
  defaultTeamColors: ['Red', 'Blue', 'Black', 'Yellow'],
  maxPlayers: DEFAULT_MAX_PLAYERS,
  skillArrowThresholds: [...DEFAULT_SKILL_ARROW_THRESHOLDS],
};

export function getVoteQueueTimestampMs(vote: MatchVote): number {
  const joined = (vote.joinedAt as { toMillis?: () => number } | null | undefined)?.toMillis?.();
  if (typeof joined === 'number' && !Number.isNaN(joined)) return joined;
  const updated = (vote.updatedAt as { toMillis?: () => number } | null | undefined)?.toMillis?.();
  if (typeof updated === 'number' && !Number.isNaN(updated)) return updated;
  return Number.MAX_SAFE_INTEGER;
}

export function partitionAttendingVotes(
  votes: MatchVote[],
  maxPlayers: number = DEFAULT_MAX_PLAYERS
): {
  sortedAttending: MatchVote[];
  confirmedVotes: MatchVote[];
  waitlistedVotes: MatchVote[];
} {
  const limit = Math.max(4, Math.min(100, Number(maxPlayers) || DEFAULT_MAX_PLAYERS));
  const sortedAttending = votes
    .filter((v) => v.attending)
    .sort((a, b) => {
      const diff = getVoteQueueTimestampMs(a) - getVoteQueueTimestampMs(b);
      if (diff !== 0) return diff;
      return a.uid.localeCompare(b.uid);
    });
  return {
    sortedAttending,
    confirmedVotes: sortedAttending.slice(0, limit),
    waitlistedVotes: sortedAttending.slice(limit),
  };
}

export function calculateAgeFromDob(dob: string): number {
  if (!dob || !/^\d{4}-\d{2}-\d{2}$/.test(dob)) return 25;
  const [year, month, day] = dob.split('-').map(Number);
  const today = new Date();
  let age = today.getFullYear() - year;
  const m = today.getMonth() + 1 - month;
  if (m < 0 || (m === 0 && today.getDate() < day)) {
    age--;
  }
  return Math.max(12, Math.min(99, age));
}

export function getIsoWeekKey(date: Date = new Date()): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

export function getMonthKey(dateInput: Date | string = new Date()): string {
  const d = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (Number.isNaN(d.getTime())) {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function computeWeeklyScheduleDates(settings: Pick<ClubSettings, 'pollOpenDay' | 'pollOpenTime' | 'pollLockDay' | 'pollLockTime' | 'matchDay' | 'matchTime'>) {
  const now = new Date();
  const currentDay = now.getDay();
  // Anchor week to Monday (day 1)
  const diffToMonday = currentDay === 0 ? -6 : 1 - currentDay;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diffToMonday);
  monday.setHours(0, 0, 0, 0);

  function dateForDayAndTime(day: number, timeStr: string) {
    const [hh, mm] = timeStr.split(':').map(Number);
    const offset = day === 0 ? 6 : day - 1;
    const d = new Date(monday);
    d.setDate(monday.getDate() + offset);
    d.setHours(hh || 0, mm || 0, 0, 0);
    return d;
  }

  const opensAt = dateForDayAndTime(settings.pollOpenDay, settings.pollOpenTime);
  let locksAt = dateForDayAndTime(settings.pollLockDay, settings.pollLockTime);
  if (locksAt <= opensAt) {
    locksAt.setDate(locksAt.getDate() + 7);
  }
  let kickoff = dateForDayAndTime(settings.matchDay, settings.matchTime);
  if (kickoff <= locksAt) {
    kickoff.setDate(kickoff.getDate() + 7);
  }

  while (kickoff <= now) {
    opensAt.setDate(opensAt.getDate() + 7);
    locksAt.setDate(locksAt.getDate() + 7);
    kickoff.setDate(kickoff.getDate() + 7);
  }

  return {
    weekKey: getIsoWeekKey(kickoff),
    opensAtIso: opensAt.toISOString(),
    locksAtIso: locksAt.toISOString(),
    kickoffIso: kickoff.toISOString(),
  };
}

export function formatScheduleLabel(day: number, time: string): string {
  const [hhStr, mmStr] = time.split(':');
  const hh = Number(hhStr);
  const suffix = hh >= 12 ? 'PM' : 'AM';
  const hour12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${DAY_NAMES[day] || 'Monday'} ${hour12}:${mmStr} ${suffix}`;
}

export function formatShortDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-CA', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function aggregatePlayerRatings(
  player: PlayerProfile,
  ratings: PlayerRating[]
): AggregatedPlayerRating {
  const playerRatings = ratings.filter((r) => r.playerId === player.uid);
  if (playerRatings.length === 0) {
    return {
      playerId: player.uid,
      avgOverall: 60,
      avgSkill: 60,
      avgAttack: 60,
      avgTechnique: 60,
      avgStamina: 60,
      avgDefense: 60,
      avgSpeed: 60,
      avgPhysics: 60,
      ratingCount: 0,
      consensusPositions: player.favoritePositions,
    };
  }

  const n = playerRatings.length;
  const avgOverall = Math.round(
    playerRatings.reduce((acc, r) => acc + (typeof r.overall === 'number' ? r.overall : r.skill), 0) / n
  );
  const avgAttack = Math.round(
    playerRatings.reduce((acc, r) => acc + (typeof r.attack === 'number' ? r.attack : r.skill), 0) / n
  );
  const avgTechnique = Math.round(
    playerRatings.reduce((acc, r) => acc + (typeof r.technique === 'number' ? r.technique : r.skill), 0) / n
  );
  const avgStamina = Math.round(
    playerRatings.reduce((acc, r) => acc + r.stamina, 0) / n
  );
  const avgDefense = Math.round(
    playerRatings.reduce((acc, r) => acc + (typeof r.defense === 'number' ? r.defense : r.skill), 0) / n
  );
  const avgSpeed = Math.round(
    playerRatings.reduce((acc, r) => acc + (typeof r.speed === 'number' ? r.speed : r.skill), 0) / n
  );
  const avgPhysics = Math.round(
    playerRatings.reduce((acc, r) => acc + (typeof r.physics === 'number' ? r.physics : r.skill), 0) / n
  );

  const posScores: Record<string, number> = {};
  for (const r of playerRatings) {
    r.assessedPositions.forEach((pos, idx) => {
      posScores[pos] = (posScores[pos] || 0) + (3 - idx);
    });
  }

  const consensusPositions = Object.entries(posScores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([pos]) => pos);

  return {
    playerId: player.uid,
    avgOverall,
    avgSkill: avgOverall,
    avgAttack,
    avgTechnique,
    avgStamina,
    avgDefense,
    avgSpeed,
    avgPhysics,
    ratingCount: n,
    consensusPositions: consensusPositions.length > 0 ? consensusPositions : player.favoritePositions,
  };
}

export function syncFormationWithLivePlayerData(
  formation: TeamFormation | null | undefined,
  playersById: Map<string, PlayerProfile>,
  ratings: PlayerRating[]
): TeamFormation | null {
  if (!formation) return null;

  return {
    ...formation,
    teams: formation.teams.map((team) => {
      const updatedPlayers = team.players.map((slot) => {
        const player = playersById.get(slot.uid);
        if (!player) return slot;
        const agg = aggregatePlayerRatings(player, ratings);
        const fullName = `${player.firstName} ${player.lastName}`.trim();
        return {
          ...slot,
          name: fullName || slot.name,
          age: player.age,
          avgOverall: agg.avgOverall,
          avgSkill: agg.avgOverall,
          avgAttack: agg.avgAttack,
          avgTechnique: agg.avgTechnique,
          avgStamina: agg.avgStamina,
          avgDefense: agg.avgDefense,
          avgSpeed: agg.avgSpeed,
          avgPhysics: agg.avgPhysics,
        };
      });

      const count = updatedPlayers.length || 1;
      const avgSkill =
        Math.round(
          (updatedPlayers.reduce((sum, p) => sum + (p.avgOverall ?? p.avgSkill), 0) / count) * 10
        ) / 10;
      const avgStamina =
        Math.round((updatedPlayers.reduce((sum, p) => sum + p.avgStamina, 0) / count) * 10) / 10;
      const avgAge =
        Math.round((updatedPlayers.reduce((sum, p) => sum + p.age, 0) / count) * 10) / 10;

      return {
        ...team,
        players: updatedPlayers,
        avgSkill,
        avgStamina,
        avgAge,
      };
    }),
  };
}

export interface MatchRosterTeam {
  teamIndex: number;
  teamColor: string;
  teamName: string;
  players: {
    uid: string;
    name: string;
    assignedPosition: string;
  }[];
}

/**
 * Extracts the latest saved team rosters & colors from a match
 * (prefers currentFormation, falls back to finalizedPlayerTeams).
 */
export function getMatchRosterTeams(match: DropInMatch): MatchRosterTeam[] {
  if (match.currentFormation?.teams && match.currentFormation.teams.length > 0) {
    return match.currentFormation.teams.map((t, idx) => {
      const color = normalizeStandardTeamColor(
        t.color || match.teamColors?.[t.teamIndex ?? idx],
        t.teamIndex ?? idx
      );
      return {
        teamIndex: t.teamIndex ?? idx,
        teamColor: color,
        teamName: t.teamName || `Team ${color}`,
        players: t.players.map((pl) => ({
          uid: pl.uid,
          name: pl.name,
          assignedPosition: pl.assignedPosition,
        })),
      };
    });
  }

  if (match.finalizedPlayerTeams && match.finalizedPlayerTeams.length > 0) {
    const byTeam = new Map<number, MatchRosterTeam>();
    for (const entry of match.finalizedPlayerTeams) {
      const color = normalizeStandardTeamColor(
        entry.teamColor || match.teamColors?.[entry.teamIndex],
        entry.teamIndex
      );
      const existing = byTeam.get(entry.teamIndex) || {
        teamIndex: entry.teamIndex,
        teamColor: color,
        teamName: `Team ${color}`,
        players: [],
      };
      existing.players.push({
        uid: entry.uid,
        name: entry.name,
        assignedPosition: entry.assignedPosition,
      });
      byTeam.set(entry.teamIndex, existing);
    }
    return Array.from(byTeam.values()).sort((a, b) => a.teamIndex - b.teamIndex);
  }

  return [];
}

/**
 * Builds a flat FinalizedPlayerTeamEntry list from a match's latest saved teams.
 */
export function buildFinalizedEntriesFromMatch(match: DropInMatch): FinalizedPlayerTeamEntry[] {
  if (match.finalizedPlayerTeams && match.finalizedPlayerTeams.length > 0) {
    return match.finalizedPlayerTeams;
  }
  return getMatchRosterTeams(match).flatMap((team) =>
    team.players.map((pl) => ({
      uid: pl.uid,
      name: pl.name,
      teamIndex: team.teamIndex,
      teamColor: team.teamColor,
      assignedPosition: pl.assignedPosition,
    }))
  );
}

export interface PlayerMatchLogEntry {
  match: DropInMatch;
  teamIndex: number;
  teamColor: string;
  assignedPosition: string;
  status: 'played' | 'late' | 'absent';
  goals: number;
  matchRating: number | null;
  isMvp: boolean;
  games: PostMatchGame[];
}

export interface PlayerCareerStats {
  uid: string;
  appearances: number;
  goals: number;
  wins: number;
  draws: number;
  losses: number;
  lateCount: number;
  absentCount: number;
  avgRating: number | null;
  ratingCount: number;
  mvpCount: number;
  matchLogs: PlayerMatchLogEntry[];
}

export function computePlayerCareerStats(
  players: PlayerProfile[],
  completedMatches: DropInMatch[]
): Record<string, PlayerCareerStats> {
  const statsMap: Record<string, PlayerCareerStats> = {};

  const ensureEntry = (uid: string): PlayerCareerStats => {
    if (!statsMap[uid]) {
      statsMap[uid] = {
        uid,
        appearances: 0,
        goals: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        lateCount: 0,
        absentCount: 0,
        avgRating: null,
        ratingCount: 0,
        mvpCount: 0,
        matchLogs: [],
      };
    }
    return statsMap[uid];
  };

  for (const p of players) {
    ensureEntry(p.uid);
  }

  const ratingSums: Record<string, { sum: number; count: number }> = {};

  const sortedCompleted = [...completedMatches].sort(
    (a, b) => new Date(b.kickoffIso).getTime() - new Date(a.kickoffIso).getTime()
  );

  for (const match of sortedCompleted) {
    const entries = buildFinalizedEntriesFromMatch(match);
    const pg = match.postGameStats;
    const absentSet = new Set(pg?.absentUids || []);
    const lateSet = new Set(pg?.lateUids || []);
    const games = pg?.games || [];
    const ratingsMap = pg?.playerMatchRatings || {};

    // Count goals per player for this match night
    const goalsThisNight: Record<string, number> = {};
    for (const game of games) {
      for (const goal of game.goals || []) {
        if (goal.scorerUid) {
          goalsThisNight[goal.scorerUid] = (goalsThisNight[goal.scorerUid] || 0) + 1;
        }
      }
    }

    const seenInMatch = new Set<string>();

    for (const entry of entries) {
      if (seenInMatch.has(entry.uid)) continue;
      seenInMatch.add(entry.uid);

      const st = ensureEntry(entry.uid);
      const isAbsent = absentSet.has(entry.uid);
      const isLate = !isAbsent && lateSet.has(entry.uid);
      const playerGoals = goalsThisNight[entry.uid] || 0;
      const rawRating = ratingsMap[entry.uid];
      const validRating =
        typeof rawRating === 'number' && Number.isFinite(rawRating) && rawRating >= 1 && rawRating <= 10
          ? rawRating
          : null;
      const isMvp = pg?.bestPlayerUid === entry.uid;

      if (isAbsent) {
        st.absentCount += 1;
      } else {
        st.appearances += 1;
        if (isLate) st.lateCount += 1;

        // Compute W-D-L across games their team played that night
        for (const game of games) {
          if (game.homeTeamIndex === entry.teamIndex) {
            if (game.homeScore > game.awayScore) st.wins += 1;
            else if (game.homeScore < game.awayScore) st.losses += 1;
            else st.draws += 1;
          } else if (game.awayTeamIndex === entry.teamIndex) {
            if (game.awayScore > game.homeScore) st.wins += 1;
            else if (game.awayScore < game.homeScore) st.losses += 1;
            else st.draws += 1;
          }
        }
      }

      st.goals += playerGoals;
      if (isMvp) st.mvpCount += 1;

      if (validRating !== null && !isAbsent) {
        if (!ratingSums[entry.uid]) ratingSums[entry.uid] = { sum: 0, count: 0 };
        ratingSums[entry.uid].sum += validRating;
        ratingSums[entry.uid].count += 1;
      }

      st.matchLogs.push({
        match,
        teamIndex: entry.teamIndex,
        teamColor: normalizeStandardTeamColor(entry.teamColor, entry.teamIndex),
        assignedPosition: entry.assignedPosition,
        status: isAbsent ? 'absent' : isLate ? 'late' : 'played',
        goals: playerGoals,
        matchRating: isAbsent ? null : validRating,
        isMvp,
        games: games.filter(
          (g) => g.homeTeamIndex === entry.teamIndex || g.awayTeamIndex === entry.teamIndex
        ),
      });
    }

    // Handle any scorers/ratings/late/absent recorded for someone not in finalizedPlayerTeams
    for (const [uid, goalCount] of Object.entries(goalsThisNight)) {
      if (seenInMatch.has(uid)) continue;
      const st = ensureEntry(uid);
      st.goals += goalCount;
    }
  }

  for (const [uid, r] of Object.entries(ratingSums)) {
    if (statsMap[uid] && r.count > 0) {
      statsMap[uid].avgRating = Math.round((r.sum / r.count) * 10) / 10;
      statsMap[uid].ratingCount = r.count;
    }
  }

  return statsMap;
}

export function computeTeammateCoOccurrence(
  completedMatches: DropInMatch[]
): Record<string, Record<string, number>> {
  const matrix: Record<string, Record<string, number>> = {};

  for (const match of completedMatches) {
    const entries = buildFinalizedEntriesFromMatch(match);
    if (!entries || entries.length === 0) continue;
    const absentSet = new Set(match.postGameStats?.absentUids || []);

    const byTeam: Record<number, string[]> = {};
    for (const entry of entries) {
      if (absentSet.has(entry.uid)) continue;
      if (!byTeam[entry.teamIndex]) byTeam[entry.teamIndex] = [];
      byTeam[entry.teamIndex].push(entry.uid);
    }

    for (const teamUids of Object.values(byTeam)) {
      for (let i = 0; i < teamUids.length; i++) {
        const a = teamUids[i];
        if (!matrix[a]) matrix[a] = {};
        for (let j = 0; j < teamUids.length; j++) {
          if (i === j) continue;
          const b = teamUids[j];
          matrix[a][b] = (matrix[a][b] || 0) + 1;
        }
      }
    }
  }

  return matrix;
}

export async function compressAvatarFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read image file.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Invalid image file.'));
      img.onload = () => {
        const size = 256;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas context unavailable.'));
          return;
        }
        const minSide = Math.min(img.width, img.height);
        const sx = (img.width - minSide) / 2;
        const sy = (img.height - minSide) / 2;
        ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, size, size);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.78);
        if (dataUrl.length > 170000) {
          resolve(canvas.toDataURL('image/jpeg', 0.55));
        } else {
          resolve(dataUrl);
        }
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}
