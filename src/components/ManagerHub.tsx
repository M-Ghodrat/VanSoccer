import React, { useEffect, useMemo, useRef, useState } from 'react';
import { User } from 'firebase/auth';
import { doc, serverTimestamp, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  LayoutGrid,
  Loader2,
  Palette,
  Plus,
  Save,
  Search,
  Sparkles,
  Trash2,
  Users,
  X,
  XCircle,
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import {
  ClubPayment,
  ClubSettings,
  DEFAULT_SKILL_ARROW_THRESHOLDS,
  DropInMatch,
  GoalieOption,
  MatchVote,
  normalizeSkillArrowThresholds,
  normalizeStandardTeamColor,
  PlayerProfile,
  PlayerRating,
  SkillArrowThresholds,
  STANDARD_TEAM_COLORS,
  TeamFormation,
} from '../types';
import {
  aggregatePlayerRatings,
  buildFinalizedEntriesFromMatch,
  computeTeammateCoOccurrence,
  computeWeeklyScheduleDates,
  DAY_NAMES,
  DEFAULT_MAX_PLAYERS,
  getIsoWeekKey,
  getMonthKey,
  partitionAttendingVotes,
  syncFormationWithLivePlayerData,
} from '../utils/clubUtils';
import { isTestPlayerUid } from '../utils/testPlayers';
import { ManualTeamBuilder } from './ManualTeamBuilder';
import { PlayerRatingDeck } from './PlayerRatingDeck';
import { PostMatchStatsEditor } from './PostMatchStatsEditor';
import { SkillArrowBadge, SoccerPitch } from './SoccerPitch';
import { TeamJerseyIcon } from './TeamJerseyIcon';

function toLocalDateInputValue(isoString: string): string {
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return '';
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function findDuplicateTeamColors(colors: string[]): { color: string; teamNumbers: number[] }[] {
  const byColor = new Map<string, number[]>();
  colors.forEach((c, idx) => {
    const list = byColor.get(c) || [];
    list.push(idx + 1);
    byColor.set(c, list);
  });
  return Array.from(byColor.entries())
    .filter(([, teams]) => teams.length > 1)
    .map(([color, teamNumbers]) => ({ color, teamNumbers }));
}

interface ManagerHubProps {
  user: User;
  profile: PlayerProfile;
  settings: ClubSettings;
  activeMatch: DropInMatch | null;
  completedMatches: DropInMatch[];
  votes: MatchVote[];
  payments: ClubPayment[];
  players: PlayerProfile[];
  ratings: PlayerRating[];
  subTab?: 'formation' | 'scouting' | 'schedule';
  onSubTabChange?: (tab: 'formation' | 'scouting' | 'schedule') => void;
}

export const ManagerHub: React.FC<ManagerHubProps> = ({
  user,
  profile,
  settings,
  activeMatch,
  completedMatches,
  votes,
  payments,
  players,
  ratings,
  subTab: propSubTab,
  onSubTabChange,
}) => {
  const [internalSubTab, setInternalSubTab] = useState<'formation' | 'scouting' | 'schedule'>('formation');
  const subTab = propSubTab !== undefined ? propSubTab : internalSubTab;
  const setSubTab = (next: 'formation' | 'scouting' | 'schedule') => {
    if (onSubTabChange) onSubTabChange(next);
    setInternalSubTab(next);
  };
  const [busy, setBusy] = useState(false);
  const [aiRunning, setAiRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Match creation form (collapsed behind a single button by default)
  const [showCreatePollForm, setShowCreatePollForm] = useState(false);
  const [newMatchTitle, setNewMatchTitle] = useState('Vancouver Weekly Drop-In');
  const [newMatchLocation, setNewMatchLocation] = useState(settings.matchLocation);
  const [newMatchDate, setNewMatchDate] = useState(() =>
    toLocalDateInputValue(computeWeeklyScheduleDates(settings).kickoffIso)
  );
  const [newMatchTime, setNewMatchTime] = useState(settings.matchTime || '21:00');
  const [newMatchMaxPlayers, setNewMatchMaxPlayers] = useState<number>(
    settings.maxPlayers ?? DEFAULT_MAX_PLAYERS
  );
  const [showDeletePollModal, setShowDeletePollModal] = useState(false);
  const [showManualBuilder, setShowManualBuilder] = useState(false);
  const [showTeamConfig, setShowTeamConfig] = useState(false);
  const [showPollPanel, setShowPollPanel] = useState(false);
  const [matchModeOverride, setMatchModeOverride] = useState<'active' | 'post_match' | null>(null);
  const [selectedPostMatchId, setSelectedPostMatchId] = useState<string>('');

  // Optimistic formation state while auto-saving pitch edits to Firestore
  const [draftFormation, setDraftFormation] = useState<TeamFormation | null>(null);
  const autoSaveSeqRef = useRef(0);
  const workingFormation = draftFormation || activeMatch?.currentFormation || null;

  // Automatically clear manual mode override when active match appears or disappears
  useEffect(() => {
    setMatchModeOverride(null);
  }, [activeMatch?.id]);

  // After match kickoff (when active match is archived/completed) and before creating next poll,
  // the Match tab automatically turns into Post-Match Stats.
  const isPostMatchMode = activeMatch
    ? matchModeOverride === 'post_match' && completedMatches.length > 0
    : completedMatches.length > 0;

  // Schedule & limit settings state
  const [pollOpenDay, setPollOpenDay] = useState(settings.pollOpenDay);
  const [pollOpenTime, setPollOpenTime] = useState(settings.pollOpenTime);
  const [matchDay, setMatchDay] = useState(settings.matchDay);
  const [matchTime, setMatchTime] = useState(settings.matchTime);
  const [matchLocation, setMatchLocation] = useState(settings.matchLocation);
  const [maxPlayersInput, setMaxPlayersInput] = useState<number>(
    settings.maxPlayers ?? DEFAULT_MAX_PLAYERS
  );
  const [defaultColors, setDefaultColors] = useState<string[]>(() =>
    [0, 1, 2, 3].map((i) => normalizeStandardTeamColor(settings.defaultTeamColors[i], i))
  );
  const [skillThresholdsInput, setSkillThresholdsInput] = useState<SkillArrowThresholds>(() =>
    normalizeSkillArrowThresholds(settings.skillArrowThresholds)
  );

  useEffect(() => {
    setPollOpenDay(settings.pollOpenDay);
    setPollOpenTime(settings.pollOpenTime);
    setMatchDay(settings.matchDay);
    setMatchTime(settings.matchTime);
    setMatchLocation(settings.matchLocation);
    setNewMatchLocation(settings.matchLocation);
    setNewMatchTime(settings.matchTime || '21:00');
    setNewMatchMaxPlayers(settings.maxPlayers ?? DEFAULT_MAX_PLAYERS);
    setMaxPlayersInput(settings.maxPlayers ?? DEFAULT_MAX_PLAYERS);
    setDefaultColors(
      [0, 1, 2, 3].map((i) => normalizeStandardTeamColor(settings.defaultTeamColors[i], i))
    );
    setSkillThresholdsInput(normalizeSkillArrowThresholds(settings.skillArrowThresholds));
  }, [settings]);

  const activeSkillThresholds = useMemo(
    () => normalizeSkillArrowThresholds(settings.skillArrowThresholds),
    [settings.skillArrowThresholds]
  );

  const playersById = useMemo(() => new Map(players.map((p) => [p.uid, p])), [players]);
  const liveWorkingFormation = useMemo(
    () => syncFormationWithLivePlayerData(workingFormation, playersById, ratings),
    [workingFormation, playersById, ratings]
  );
  const liveOriginalFormation = useMemo(
    () => syncFormationWithLivePlayerData(activeMatch?.aiOriginalFormation, playersById, ratings),
    [activeMatch?.aiOriginalFormation, playersById, ratings]
  );
  const bestPositionsById = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const p of players) {
      const agg = aggregatePlayerRatings(p, ratings);
      const list = agg.consensusPositions.length > 0 ? agg.consensusPositions : p.favoritePositions;
      if (list.length > 0) {
        map.set(p.uid, list.slice(0, 3));
      }
    }
    return map;
  }, [players, ratings]);
  const maxPlayers = settings.maxPlayers ?? DEFAULT_MAX_PLAYERS;
  const { sortedAttending: attendingVotes, confirmedVotes, waitlistedVotes } = useMemo(
    () => partitionAttendingVotes(votes, maxPlayers),
    [votes, maxPlayers]
  );
  const confirmedUidSet = useMemo(() => new Set(confirmedVotes.map((v) => v.uid)), [confirmedVotes]);
  const declinedVotes = useMemo(() => votes.filter((v) => !v.attending), [votes]);
  const unvotedPlayers = useMemo(() => {
    const votedUids = new Set(votes.map((v) => v.uid));
    return players.filter((p) => !votedUids.has(p.uid));
  }, [players, votes]);
  const activeTeamCount: 2 | 3 | 4 = activeMatch?.teamCount || (confirmedVotes.length >= 28 ? 4 : 2);
  const normalizedMatchColors = useMemo(
    () =>
      [0, 1, 2, 3].map((i) =>
        normalizeStandardTeamColor(activeMatch?.teamColors?.[i] ?? settings.defaultTeamColors[i], i)
      ),
    [activeMatch, settings.defaultTeamColors]
  );
  const activeColorDuplicates = useMemo(
    () => findDuplicateTeamColors(normalizedMatchColors.slice(0, activeTeamCount)),
    [normalizedMatchColors, activeTeamCount]
  );
  const activeDuplicateColorSet = useMemo(
    () => new Set(activeColorDuplicates.map((d) => d.color)),
    [activeColorDuplicates]
  );
  const defaultColorDuplicates = useMemo(
    () =>
      findDuplicateTeamColors(
        [0, 1, 2, 3].map((i) => normalizeStandardTeamColor(defaultColors[i], i))
      ),
    [defaultColors]
  );
  const defaultDuplicateColorSet = useMemo(
    () => new Set(defaultColorDuplicates.map((d) => d.color)),
    [defaultColorDuplicates]
  );
  const teammateMatrix = useMemo(
    () => computeTeammateCoOccurrence(completedMatches),
    [completedMatches]
  );

  const formationStale = useMemo(() => {
    if (!activeMatch?.currentFormation || !activeMatch.formationAttendingUids) return false;
    const currentUids = [...confirmedVotes.map((v) => v.uid)].sort().join(',');
    const savedUids = [...activeMatch.formationAttendingUids].sort().join(',');
    return currentUids !== savedUids;
  }, [activeMatch, confirmedVotes]);

  const queueWaitlistPromotionNotification = (
    batch: ReturnType<typeof writeBatch>,
    promoted: MatchVote,
    match: DropInMatch
  ) => {
    if (!playersById.has(promoted.uid)) return;
    const notifId = `notif_${Date.now()}_${promoted.uid.slice(0, 12)}`;
    batch.set(doc(db, 'notifications', notifId), {
      id: notifId,
      recipientUid: promoted.uid,
      matchId: match.id,
      matchTitle: match.title.slice(0, 120),
      type: 'waitlist_promoted',
      message: `A spot opened up for ${match.title}! You have been moved off the waiting list into the confirmed lineup.`,
      read: false,
      createdBy: user.uid,
      createdAt: serverTimestamp(),
    });
  };

  const handleAutoSaveFormation = async (updated: TeamFormation) => {
    if (!activeMatch) return;
    const synced = syncFormationWithLivePlayerData(updated, playersById, ratings) || updated;
    setDraftFormation(synced);
    setError(null);
    const seq = ++autoSaveSeqRef.current;

    try {
      await updateDoc(doc(db, 'matches', activeMatch.id), {
        currentFormation: synced,
        updatedAt: serverTimestamp(),
      });
      if (autoSaveSeqRef.current === seq) {
        setDraftFormation(null);
      }
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.UPDATE, `matches/${activeMatch.id}`);
      } catch (wrapped) {
        setError(wrapped instanceof Error ? wrapped.message : 'Failed to auto-save formation.');
      }
    }
  };

  const [livePollSearch, setLivePollSearch] = useState('');
  const [livePollListFilter, setLivePollListFilter] = useState<
    'all' | 'coming' | 'declined' | 'unvoted'
  >('all');
  const [votingForUid, setVotingForUid] = useState<string | null>(null);

  const handleManagerCastVote = async (
    targetUid: string,
    playerName: string,
    attending: boolean,
    goalieOption: GoalieOption = 'none'
  ) => {
    if (!activeMatch) return;
    setError(null);
    setNotice(null);

    if (attending) {
      const matchMonthKey = getMonthKey(activeMatch.kickoffIso);
      const hasPaid = payments.some(
        (pay) => pay.uid === targetUid && pay.monthKey === matchMonthKey && pay.paid
      );
      if (!hasPaid) {
        setError(`Club Fee Notice: ${playerName} has not paid for ${matchMonthKey}. Mark them Paid in the Payments tab before voting them Coming.`);
        return;
      }
    }

    setVotingForUid(targetUid);
    try {
      const existingVote = votes.find((v) => v.uid === targetUid);
      const wasConfirmed = confirmedUidSet.has(targetUid);
      const keepJoinedAt = Boolean(existingVote?.attending && attending && existingVote.joinedAt);

      const batch = writeBatch(db);
      batch.set(doc(db, 'matches', activeMatch.id, 'votes', targetUid), {
        uid: targetUid,
        matchId: activeMatch.id,
        attending,
        goalieOption: attending ? goalieOption : 'none',
        playerName,
        joinedAt: attending ? (keepJoinedAt ? existingVote!.joinedAt : serverTimestamp()) : null,
        updatedAt: serverTimestamp(),
      });

      let promotedName: string | null = null;
      if (!attending && wasConfirmed && waitlistedVotes.length > 0) {
        const promoted = waitlistedVotes[0];
        queueWaitlistPromotionNotification(batch, promoted, activeMatch);
        promotedName = promoted.playerName;
      }

      await batch.commit();

      const label = attending
        ? goalieOption === 'only_goalie'
          ? 'Coming (GK Only)'
          : goalieOption === 'willing'
            ? 'Coming (Willing GK)'
            : 'Coming'
        : 'Not Coming';
      const addedToWaitlist =
        attending && !existingVote?.attending && confirmedVotes.length >= maxPlayers;
      setNotice(
        promotedName
          ? `Recorded ${label} for ${playerName}. ${promotedName} moved up from the waiting list and was notified.`
          : addedToWaitlist
            ? `Recorded ${label} for ${playerName} (placed on the low-chance waiting list — limit ${maxPlayers} reached).`
            : `Recorded ${label} vote for ${playerName}.`
      );
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.WRITE, `matches/${activeMatch.id}/votes/${targetUid}`);
      } catch (wrapped) {
        setError(wrapped instanceof Error ? wrapped.message : 'Failed to record vote for player.');
      }
    } finally {
      setVotingForUid(null);
    }
  };

  const handleManagerClearVote = async (targetUid: string, playerName: string) => {
    if (!activeMatch) return;
    setError(null);
    setNotice(null);
    setVotingForUid(targetUid);
    try {
      const wasConfirmed = confirmedUidSet.has(targetUid);
      const batch = writeBatch(db);
      batch.delete(doc(db, 'matches', activeMatch.id, 'votes', targetUid));

      let promotedName: string | null = null;
      if (wasConfirmed && waitlistedVotes.length > 0) {
        const promoted = waitlistedVotes[0];
        queueWaitlistPromotionNotification(batch, promoted, activeMatch);
        promotedName = promoted.playerName;
      }

      await batch.commit();
      setNotice(
        promotedName
          ? `Cleared vote for ${playerName}. ${promotedName} moved up from the waiting list and was notified.`
          : `Cleared vote for ${playerName} (moved back to Not Voted Yet).`
      );
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.DELETE, `matches/${activeMatch.id}/votes/${targetUid}`);
      } catch (wrapped) {
        setError(wrapped instanceof Error ? wrapped.message : 'Failed to clear player vote.');
      }
    } finally {
      setVotingForUid(null);
    }
  };

  const handleCreateMatchPoll = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);

    if (activeMatch) {
      setError(
        `An active weekly drop-in poll ("${activeMatch.title}") is already running. Please stop and delete the current poll first before opening a new one.`
      );
      return;
    }

    setBusy(true);
    try {
      const schedule = computeWeeklyScheduleDates(settings);
      let kickoffDate = new Date(schedule.kickoffIso);
      if (newMatchDate && /^\d{4}-\d{2}-\d{2}$/.test(newMatchDate)) {
        const [yr, mo, dy] = newMatchDate.split('-').map(Number);
        const [hr, min] = (newMatchTime || settings.matchTime || '21:00').split(':').map(Number);
        const candidate = new Date(yr, mo - 1, dy, hr || 0, min || 0, 0, 0);
        if (!Number.isNaN(candidate.getTime())) {
          kickoffDate = candidate;
        }
      }

      const teamColors = [0, 1, 2, 3].map((i) =>
        normalizeStandardTeamColor(settings.defaultTeamColors[i], i)
      );
      const safeMaxPlayers = Math.max(
        4,
        Math.min(100, Math.round(Number(newMatchMaxPlayers) || DEFAULT_MAX_PLAYERS))
      );
      const matchId = `match_${Date.now()}`;
      const batch = writeBatch(db);
      batch.set(doc(db, 'matches', matchId), {
        id: matchId,
        title: newMatchTitle.trim() || 'Vancouver Weekly Drop-In',
        weekKey: getIsoWeekKey(kickoffDate),
        location: newMatchLocation.trim() || settings.matchLocation,
        kickoffIso: kickoffDate.toISOString(),
        pollOpensAtIso: schedule.opensAtIso,
        pollLocksAtIso: schedule.locksAtIso,
        status: 'open',
        teamCount: 2,
        teamColors,
        createdBy: user.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      if (safeMaxPlayers !== (settings.maxPlayers ?? DEFAULT_MAX_PLAYERS)) {
        batch.set(doc(db, 'settings', 'clubConfig'), {
          pollOpenDay: settings.pollOpenDay,
          pollOpenTime: settings.pollOpenTime,
          pollLockDay: settings.pollLockDay ?? 3,
          pollLockTime: settings.pollLockTime || '18:00',
          matchDay: settings.matchDay,
          matchTime: settings.matchTime,
          matchLocation: settings.matchLocation,
          maxPlayers: safeMaxPlayers,
          defaultTeamColors: teamColors,
          skillArrowThresholds: activeSkillThresholds,
          updatedBy: user.uid,
          updatedAt: serverTimestamp(),
        });
      }

      await batch.commit();
      setNewMatchMaxPlayers(safeMaxPlayers);
      setMaxPlayersInput(safeMaxPlayers);
      setDraftFormation(null);
      setShowManualBuilder(false);
      setShowCreatePollForm(false);
      setNotice(
        `New weekly drop-in poll opened (confirmed player limit: ${safeMaxPlayers}). All players can now submit their attendance.`
      );
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.CREATE, 'matches');
      } catch (wrapped) {
        setError(wrapped instanceof Error ? wrapped.message : 'Failed to create match poll.');
      }
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteActivePoll = async () => {
    if (!activeMatch) return;
    setError(null);
    setNotice(null);
    setBusy(true);
    const deletedTitle = activeMatch.title;
    try {
      const batch = writeBatch(db);
      for (const v of votes) {
        batch.delete(doc(db, 'matches', activeMatch.id, 'votes', v.uid));
      }
      batch.delete(doc(db, 'matches', activeMatch.id));
      await batch.commit();

      setDraftFormation(null);
      setShowManualBuilder(false);
      setShowDeletePollModal(false);
      setNotice(`Stopped and deleted "${deletedTitle}" along with its poll votes. You can now open a new weekly drop-in poll.`);
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.DELETE, `matches/${activeMatch.id}`);
      } catch (wrapped) {
        setError(wrapped instanceof Error ? wrapped.message : 'Failed to stop and delete the current poll.');
      }
    } finally {
      setBusy(false);
    }
  };

  const handleFinishActiveMatchForStats = async () => {
    if (!activeMatch) return;
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const finalizedPlayerTeams = buildFinalizedEntriesFromMatch({
        ...activeMatch,
        currentFormation: liveWorkingFormation || activeMatch.currentFormation,
      });
      await updateDoc(doc(db, 'matches', activeMatch.id), {
        status: 'completed',
        ...(finalizedPlayerTeams.length > 0 ? { finalizedPlayerTeams } : {}),
        updatedAt: serverTimestamp(),
      });
      setSelectedPostMatchId(activeMatch.id);
      setMatchModeOverride(null);
      setDraftFormation(null);
      setShowManualBuilder(false);
      setNotice(
        `Match "${activeMatch.title}" closed. You can now log games, goal scorers, late/absent players, and ratings below.`
      );
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.UPDATE, `matches/${activeMatch.id}`);
      } catch (wrapped) {
        setError(
          wrapped instanceof Error
            ? wrapped.message
            : 'Failed to close match for post-match stats.'
        );
      }
    } finally {
      setBusy(false);
    }
  };

  const handleApplyManualFormation = async (formation: TeamFormation) => {
    if (!activeMatch) return;
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await updateDoc(doc(db, 'matches', activeMatch.id), {
        teamCount: activeTeamCount,
        teamColors: normalizedMatchColors,
        currentFormation: formation,
        formationAttendingUids: confirmedVotes.map((v) => v.uid),
        updatedAt: serverTimestamp(),
      });
      setDraftFormation(null);
      setShowManualBuilder(false);
      setNotice('Manual team arrangement saved and synced to the tactical pitch.');
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.UPDATE, `matches/${activeMatch.id}`);
      } catch (wrapped) {
        setError(wrapped instanceof Error ? wrapped.message : 'Failed to save manual team arrangement.');
      }
    } finally {
      setBusy(false);
    }
  };

  const handleUpdateTeamCount = async (nextCount: 2 | 3 | 4) => {
    if (!activeMatch || activeMatch.teamCount === nextCount) return;
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await updateDoc(doc(db, 'matches', activeMatch.id), {
        teamCount: nextCount,
        updatedAt: serverTimestamp(),
      });
      setNotice(`Updated team count to ${nextCount} teams.${workingFormation ? ' Re-run AI Formation or use Manual Team Arrangement to split into ' + nextCount + ' teams.' : ''}`);
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.UPDATE, `matches/${activeMatch.id}`);
      } catch (wrapped) {
        setError(wrapped instanceof Error ? wrapped.message : 'Failed to update team count.');
      }
    } finally {
      setBusy(false);
    }
  };

  const handleUpdateMatchColor = async (teamIdx: number, newColor: string) => {
    if (!activeMatch) return;
    setError(null);
    const stdColor = normalizeStandardTeamColor(newColor, teamIdx);
    const nextColors = [...normalizedMatchColors];
    nextColors[teamIdx] = stdColor;

    let nextFormation = workingFormation;
    if (nextFormation) {
      nextFormation = {
        ...nextFormation,
        teams: nextFormation.teams.map((t) =>
          t.teamIndex === teamIdx ? { ...t, color: stdColor, teamName: `Team ${stdColor}` } : t
        ),
      };
      setDraftFormation(nextFormation);
    }

    try {
      await updateDoc(doc(db, 'matches', activeMatch.id), {
        teamColors: nextColors,
        ...(nextFormation ? { currentFormation: nextFormation } : {}),
        updatedAt: serverTimestamp(),
      });
      setNotice(`Updated Team ${teamIdx + 1} color to ${stdColor}.`);
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.UPDATE, `matches/${activeMatch.id}`);
      } catch (wrapped) {
        setError(wrapped instanceof Error ? wrapped.message : 'Could not update team color.');
      }
    }
  };

  const handleRunAiFormation = async () => {
    if (!activeMatch || aiRunning) return;
    if (confirmedVotes.length < activeTeamCount) {
      setError(`Need at least ${activeTeamCount} confirmed players to split into ${activeTeamCount} teams.`);
      return;
    }

    setError(null);
    setNotice(null);
    setAiRunning(true);
    setBusy(true);
    try {
      const teamCount: 2 | 3 | 4 = activeTeamCount;
      const teamColors = normalizedMatchColors.slice(0, teamCount);

      const playerInputs = confirmedVotes.map((vote) => {
        const p = playersById.get(vote.uid);
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
              playerId: vote.uid,
            };

        const pastMap: Record<string, number> = {};
        const myMatrix = teammateMatrix[vote.uid] || {};
        for (const other of confirmedVotes) {
          if (other.uid !== vote.uid && myMatrix[other.uid]) {
            pastMap[other.uid] = myMatrix[other.uid];
          }
        }

        return {
          uid: vote.uid,
          name: vote.playerName,
          age: p?.age || 26,
          goalieOption: vote.goalieOption,
          favoritePositions: p?.favoritePositions || ['CM', 'CDM', 'CB'],
          avgSkill: agg.avgOverall,
          avgStamina: agg.avgStamina,
          assessedPositions: agg.consensusPositions,
          pastTeammateCounts: pastMap,
        };
      });

      const response = await fetch('/api/formation/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          matchTitle: activeMatch.title,
          teamCount,
          teamColors,
          players: playerInputs,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'AI formation service failed.');
      }

      try {
        await updateDoc(doc(db, 'matches', activeMatch.id), {
          teamCount,
          teamColors: normalizedMatchColors,
          aiOriginalFormation: data,
          currentFormation: data,
          formationAttendingUids: confirmedVotes.map((v) => v.uid),
          updatedAt: serverTimestamp(),
        });
      } catch (writeErr) {
        handleFirestoreError(writeErr, OperationType.UPDATE, `matches/${activeMatch.id}`);
      }
      setDraftFormation(null);
      setShowManualBuilder(false);
      setNotice('AI formation generated and saved for the confirmed lineup. Original AI snapshot is preserved for comparison.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI formation analysis failed.');
    } finally {
      setAiRunning(false);
      setBusy(false);
    }
  };

  const handleRestoreOriginalAi = async () => {
    if (!activeMatch?.aiOriginalFormation) return;
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await updateDoc(doc(db, 'matches', activeMatch.id), {
        currentFormation: activeMatch.aiOriginalFormation,
        updatedAt: serverTimestamp(),
      });
      setDraftFormation(null);
      setNotice('Restored the original AI-recommended formation.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not restore original AI formation.');
    } finally {
      setBusy(false);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    const [t0, t1, t2, t3] = skillThresholdsInput.map((n) => Math.round(Number(n)));
    if (
      [t0, t1, t2, t3].some((n) => Number.isNaN(n)) ||
      t0 < 1 ||
      t0 >= t1 ||
      t1 >= t2 ||
      t2 >= t3 ||
      t3 > 99
    ) {
      setError(
        'Skill arrow thresholds must be 4 strictly ascending whole numbers between 1 and 99 (e.g. 25, 40, 60, 75).'
      );
      return;
    }

    setBusy(true);
    try {
      const safeMaxPlayers = Math.max(4, Math.min(100, Math.round(Number(maxPlayersInput) || DEFAULT_MAX_PLAYERS)));
      const normalizedDefaults = [0, 1, 2, 3].map((i) => normalizeStandardTeamColor(defaultColors[i], i));
      const cleanThresholds: SkillArrowThresholds = [t0, t1, t2, t3];
      await setDoc(doc(db, 'settings', 'clubConfig'), {
        pollOpenDay: Number(pollOpenDay),
        pollOpenTime,
        pollLockDay: settings.pollLockDay ?? 3,
        pollLockTime: settings.pollLockTime || '18:00',
        matchDay: Number(matchDay),
        matchTime,
        matchLocation: matchLocation.trim() || 'Trillium Park Turf, Vancouver',
        maxPlayers: safeMaxPlayers,
        defaultTeamColors: normalizedDefaults,
        skillArrowThresholds: cleanThresholds,
        updatedBy: user.uid,
        updatedAt: serverTimestamp(),
      });
      setMaxPlayersInput(safeMaxPlayers);
      setDefaultColors(normalizedDefaults);
      setSkillThresholdsInput(cleanThresholds);
      setNotice(
        `Club settings updated (player limit: ${safeMaxPlayers}, skill cutoffs: ${cleanThresholds.join(' / ')}).`
      );
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.WRITE, 'settings/clubConfig');
      } catch (wrapped) {
        setError(wrapped instanceof Error ? wrapped.message : 'Failed to save settings.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
        <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
          {subTab === 'formation'
            ? isPostMatchMode
              ? 'Post-Match'
              : 'Lineup'
            : subTab === 'scouting'
              ? 'Player Ratings'
              : 'Setting'}
        </h1>

        {subTab === 'formation' && (
          <div className="flex items-center gap-2 shrink-0">
            {activeMatch && completedMatches.length > 0 && (
              <div className="inline-flex items-center p-1 bg-slate-200/70 rounded-lg">
                <button
                  type="button"
                  onClick={() => setMatchModeOverride('active')}
                  className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                    !isPostMatchMode
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Lineup
                </button>
                <button
                  type="button"
                  onClick={() => setMatchModeOverride('post_match')}
                  className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                    isPostMatchMode
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Post-Match
                </button>
              </div>
            )}
            <button
              type="button"
              onClick={() => {
                setShowCreatePollForm((prev) => !prev);
                setError(null);
              }}
              title={showCreatePollForm ? 'Close form' : 'New match poll'}
              aria-label={showCreatePollForm ? 'Close new poll form' : 'Open new match poll'}
              className={`p-2 rounded-lg transition-colors shrink-0 ${
                showCreatePollForm
                  ? 'border border-slate-300 bg-white hover:bg-slate-50 text-slate-800'
                  : 'bg-emerald-700 hover:bg-emerald-800 text-white'
              }`}
            >
              {showCreatePollForm ? (
                <X className="w-4 h-4" />
              ) : (
                <Plus className="w-4 h-4" />
              )}
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800 flex flex-wrap items-center justify-between gap-3">
          <span>{error}</span>
          {subTab === 'formation' && activeMatch && !showManualBuilder && (
            <button
              type="button"
              onClick={() => {
                setShowManualBuilder(true);
                setError(null);
              }}
              className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              Arrange Teams Manually
            </button>
          )}
        </div>
      )}
      {notice && (
        <div className="p-3.5 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-800 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      {subTab === 'formation' && (
        <div className="space-y-5">

          {showCreatePollForm && (
            <div className="bg-white border border-emerald-200 rounded-xl p-6 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                  <Plus className="w-4 h-4 text-emerald-700" />
                  Open Weekly Drop-In Poll
                </h3>
                <button
                  type="button"
                  onClick={() => setShowCreatePollForm(false)}
                  className="text-xs text-slate-500 hover:text-slate-800"
                >
                  Cancel
                </button>
              </div>

              {activeMatch ? (
                <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 space-y-3">
                  <div className="flex items-start gap-2.5 text-amber-950">
                    <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                    <div className="space-y-1 text-xs">
                      <p className="font-semibold text-sm text-amber-950">
                        A weekly drop-in poll is already running
                      </p>
                      <p className="text-amber-900">
                        <span className="font-semibold">&ldquo;{activeMatch.title}&rdquo;</span> (
                        {new Date(activeMatch.kickoffIso).toLocaleDateString('en-CA', {
                          weekday: 'short',
                          month: 'short',
                          day: 'numeric',
                        })}
                        , {votes.length} vote{votes.length === 1 ? '' : 's'}) is currently active. You must stop and delete the current poll before opening a new one.
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setShowCreatePollForm(false)}
                      className="px-3.5 py-2 rounded-lg border border-amber-300 bg-white hover:bg-amber-100/50 text-amber-950 text-xs font-semibold whitespace-nowrap"
                    >
                      Keep Current Poll
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setShowDeletePollModal(true)}
                      className="px-3.5 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap disabled:opacity-50"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Stop / Delete Current Poll
                    </button>
                  </div>
                </div>
              ) : (
                <form onSubmit={handleCreateMatchPoll} className="grid sm:grid-cols-12 gap-4 items-end">
                  <div className="sm:col-span-4">
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Match Title</label>
                    <input
                      type="text"
                      required
                      value={newMatchTitle}
                      onChange={(e) => setNewMatchTitle(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                    />
                  </div>
                  <div className="sm:col-span-3">
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Match Date</label>
                    <input
                      type="date"
                      required
                      value={newMatchDate}
                      onChange={(e) => setNewMatchDate(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-mono-tabular"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Kickoff Time</label>
                    <input
                      type="time"
                      required
                      value={newMatchTime}
                      onChange={(e) => setNewMatchTime(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-mono-tabular"
                    />
                  </div>
                  <div className="sm:col-span-3">
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Player Limit (Waitlist After)
                    </label>
                    <input
                      type="number"
                      min={4}
                      max={100}
                      required
                      value={newMatchMaxPlayers}
                      onChange={(e) => setNewMatchMaxPlayers(Number(e.target.value))}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-mono-tabular font-semibold"
                    />
                  </div>
                  <div className="sm:col-span-12">
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Vancouver Pitch</label>
                    <input
                      type="text"
                      required
                      value={newMatchLocation}
                      onChange={(e) => setNewMatchLocation(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                    />
                  </div>
                  <div className="sm:col-span-12 flex justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setShowCreatePollForm(false)}
                      className="px-4 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={busy}
                      className="px-5 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold transition-colors whitespace-nowrap disabled:opacity-60"
                    >
                      Create &amp; Open Poll
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

          {isPostMatchMode ? (
            <PostMatchStatsEditor
              user={user}
              completedMatches={completedMatches}
              selectedMatchId={selectedPostMatchId || completedMatches[0]?.id}
              onSelectMatchId={(id) => setSelectedPostMatchId(id)}
              players={players}
              playersById={playersById}
              onSavedNotice={(msg) => setNotice(msg)}
            />
          ) : (
            <>
          {/* Compact Active Match Action Bar */}
          {activeMatch ? (
            <>
              <div className="bg-white border border-slate-200 rounded-xl px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2.5">
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 min-w-0">
                  <h2 className="text-sm font-semibold text-slate-900 truncate">{activeMatch.title}</h2>
                  <span className="text-xs text-slate-500 font-mono-tabular whitespace-nowrap">
                    {new Date(activeMatch.kickoffIso).toLocaleDateString('en-CA', {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                    })}{' '}
                    {new Date(activeMatch.kickoffIso).toLocaleTimeString('en-CA', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setShowPollPanel((prev) => !prev)}
                    title="Poll attendance & vote override"
                    aria-label="Toggle poll attendance"
                    className={`px-2.5 py-1.5 rounded-lg border text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap transition-colors ${
                      showPollPanel
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-white hover:bg-slate-50 text-slate-700 border-slate-200'
                    }`}
                  >
                    <Users className="w-3.5 h-3.5" />
                    <span className="font-mono-tabular">
                      {confirmedVotes.length}/{maxPlayers}
                    </span>
                    {waitlistedVotes.length > 0 && (
                      <span className="font-mono-tabular text-[10px] text-amber-600">
                        +{waitlistedVotes.length}
                      </span>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowTeamConfig((prev) => !prev)}
                    title="Team count & kit colors"
                    aria-label="Toggle team count and kit colors"
                    className={`px-2.5 py-1.5 rounded-lg border text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap transition-colors ${
                      showTeamConfig
                        ? 'bg-slate-900 text-white border-slate-900'
                        : activeColorDuplicates.length > 0
                          ? 'bg-amber-50 text-amber-900 border-amber-300 hover:bg-amber-100'
                          : 'bg-white hover:bg-slate-50 text-slate-700 border-slate-200'
                    }`}
                  >
                    <Palette className="w-3.5 h-3.5" />
                    <span className="font-mono-tabular">{activeTeamCount}T</span>
                  </button>

                  <button
                    type="button"
                    disabled={busy || confirmedVotes.length === 0}
                    onClick={() => setShowManualBuilder((prev) => !prev)}
                    title={showManualBuilder ? 'Close manual builder' : 'Arrange teams manually'}
                    aria-label={showManualBuilder ? 'Close manual builder' : 'Arrange teams manually'}
                    className={`p-1.5 rounded-lg border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                      showManualBuilder
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-white hover:bg-slate-50 text-slate-700 border-slate-200'
                    }`}
                  >
                    <LayoutGrid className="w-4 h-4" />
                  </button>

                  <button
                    type="button"
                    disabled={busy || aiRunning || confirmedVotes.length < activeTeamCount}
                    onClick={handleRunAiFormation}
                    title="Run AI Formation"
                    className="px-2.5 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {aiRunning ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="w-3.5 h-3.5" />
                    )}
                    {aiRunning ? 'Running...' : 'AI'}
                  </button>

                  {liveWorkingFormation && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={handleFinishActiveMatchForStats}
                      title="End match & log stats"
                      aria-label="End match and log stats"
                      className="p-1.5 rounded-lg border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 transition-colors disabled:opacity-50"
                    >
                      <ClipboardCheck className="w-4 h-4" />
                    </button>
                  )}

                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setShowDeletePollModal(true)}
                    title="Stop / delete poll"
                    aria-label="Stop or delete poll"
                    className="p-1.5 rounded-lg border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 transition-colors disabled:opacity-50"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {formationStale && (
                <div className="bg-orange-600 text-white px-3.5 py-2 rounded-xl flex items-center justify-between gap-3 text-xs">
                  <span>Roster changed since last generation.</span>
                  <button
                    type="button"
                    disabled={busy || aiRunning}
                    onClick={handleRunAiFormation}
                    className="px-3 py-1 rounded-lg bg-white text-orange-950 font-semibold whitespace-nowrap inline-flex items-center gap-1.5 hover:bg-orange-50 disabled:opacity-60"
                  >
                    {aiRunning && <Loader2 className="w-3 h-3 animate-spin" />}
                    {aiRunning ? 'Rebalancing...' : 'Rebalance'}
                  </button>
                </div>
              )}

              {/* Collapsible Drawer: Team Count & Kit Colors (only opens when clicked) */}
              {showTeamConfig && (
                <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-slate-800">Teams &amp; Kits</span>
                      <div className="flex items-center gap-1">
                        {([2, 3, 4] as const).map((cnt) => (
                          <button
                            key={cnt}
                            type="button"
                            disabled={busy}
                            onClick={() => handleUpdateTeamCount(cnt)}
                            className={`px-2.5 py-1 rounded-md text-xs font-semibold border transition-colors whitespace-nowrap ${
                              activeTeamCount === cnt
                                ? 'bg-slate-900 text-white border-slate-900'
                                : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                            }`}
                          >
                            {cnt}
                          </button>
                        ))}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowTeamConfig(false)}
                      aria-label="Close teams and kits"
                      className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {activeColorDuplicates.length > 0 && (
                    <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-300 text-xs text-amber-950 flex items-center gap-2">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                      <span>
                        Duplicate colors:{' '}
                        {activeColorDuplicates
                          .map((d) => `T${d.teamNumbers.join('&')} (${d.color})`)
                          .join(' · ')}
                      </span>
                    </div>
                  )}

                  <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                    {Array.from({ length: activeTeamCount }, (_, idx) => {
                      const currentColor = normalizedMatchColors[idx];
                      const hasConflict = activeDuplicateColorSet.has(currentColor);
                      return (
                        <div
                          key={idx}
                          className={`p-2.5 rounded-lg border space-y-2 transition-colors ${
                            hasConflict
                              ? 'border-amber-400 bg-amber-50/40'
                              : 'border-slate-200 bg-slate-50/70'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] font-semibold text-slate-600">
                              Team {idx + 1}
                            </span>
                            <span className="inline-flex items-center gap-1 text-xs font-bold text-slate-900">
                              <TeamJerseyIcon color={currentColor} size={16} />
                              {currentColor}
                            </span>
                          </div>
                          <div className="grid grid-cols-4 gap-1">
                            {STANDARD_TEAM_COLORS.map((colorName) => {
                              const isSelected = currentColor === colorName;
                              return (
                                <button
                                  key={colorName}
                                  type="button"
                                  disabled={busy}
                                  onClick={() => handleUpdateMatchColor(idx, colorName)}
                                  title={`${colorName} jersey for Team ${idx + 1}`}
                                  aria-pressed={isSelected}
                                  className={`py-1.5 px-1 rounded-md border flex flex-col items-center justify-center gap-0.5 transition-all ${
                                    isSelected
                                      ? 'bg-white border-slate-900 ring-1 ring-slate-900 opacity-100'
                                      : 'bg-white/60 border-slate-200 opacity-45 hover:opacity-85'
                                  }`}
                                >
                                  <TeamJerseyIcon color={colorName} size={22} />
                                  <span className="text-[9px] leading-none font-medium text-slate-700">
                                    {colorName}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Collapsible Drawer: Live Poll Attendance Breakdown (only opens when clicked) */}
              {showPollPanel && (() => {
                const searchTerm = livePollSearch.trim().toLowerCase();
                const matchMonthKey = getMonthKey(activeMatch.kickoffIso);
                const paidUidsForMatchMonth = new Set(
                  payments.filter((pay) => pay.monthKey === matchMonthKey && pay.paid).map((pay) => pay.uid)
                );

                const filteredAttendingVotes = attendingVotes.filter((v) => {
                  if (!searchTerm) return true;
                  const p = playersById.get(v.uid);
                  const posText = p?.favoritePositions?.join(' ') || '';
                  const gkText =
                    v.goalieOption === 'only_goalie'
                      ? 'gk only goalie'
                      : v.goalieOption === 'willing'
                        ? 'willing gk goalie'
                        : 'outfield';
                  const wlText = confirmedUidSet.has(v.uid) ? 'confirmed' : 'waitlist waiting';
                  return `${v.playerName} ${posText} ${gkText} ${wlText}`.toLowerCase().includes(searchTerm);
                });

                const filteredDeclinedVotes = declinedVotes.filter((v) => {
                  if (!searchTerm) return true;
                  const p = playersById.get(v.uid);
                  const posText = p?.favoritePositions?.join(' ') || '';
                  return `${v.playerName} ${posText} declined`.toLowerCase().includes(searchTerm);
                });

                const filteredUnvotedPlayers = unvotedPlayers.filter((p) => {
                  if (!searchTerm) return true;
                  const paidText = paidUidsForMatchMonth.has(p.uid) ? 'paid' : 'unpaid';
                  return `${p.firstName} ${p.lastName} ${p.favoritePositions.join(' ')} ${paidText}`
                    .toLowerCase()
                    .includes(searchTerm);
                });

                const showComing = livePollListFilter === 'all' || livePollListFilter === 'coming';
                const showDeclined = livePollListFilter === 'all' || livePollListFilter === 'declined';
                const showUnvoted = livePollListFilter === 'all' || livePollListFilter === 'unvoted';

                return (
                  <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-xs font-semibold text-slate-900">
                          Attendance ({confirmedVotes.length}/{maxPlayers}
                          {waitlistedVotes.length > 0 ? ` · ${waitlistedVotes.length} WL` : ''})
                        </h3>
                        <div className="relative">
                          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                          <input
                            type="text"
                            value={livePollSearch}
                            onChange={(e) => setLivePollSearch(e.target.value)}
                            placeholder="Filter..."
                            className="pl-7 pr-6 py-1 w-40 rounded-lg border border-slate-300 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-600"
                          />
                          {livePollSearch && (
                            <button
                              type="button"
                              onClick={() => setLivePollSearch('')}
                              aria-label="Clear poll filter"
                              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                        <div className="flex items-center gap-0.5 p-0.5 bg-slate-100 rounded-lg border border-slate-200">
                          {[
                            { id: 'all' as const, label: 'All' },
                            { id: 'coming' as const, label: `In (${filteredAttendingVotes.length})` },
                            { id: 'declined' as const, label: `Out (${filteredDeclinedVotes.length})` },
                            { id: 'unvoted' as const, label: `Pending (${filteredUnvotedPlayers.length})` },
                          ].map((opt) => (
                            <button
                              key={opt.id}
                              type="button"
                              onClick={() => setLivePollListFilter(opt.id)}
                              className={`px-2 py-0.5 rounded-md text-[11px] font-semibold transition-colors whitespace-nowrap ${
                                livePollListFilter === opt.id
                                  ? 'bg-white text-slate-900 shadow-xs'
                                  : 'text-slate-600 hover:text-slate-900'
                              }`}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowPollPanel(false)}
                        aria-label="Close attendance panel"
                        className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>

                    <div className={livePollListFilter === 'all' ? 'grid md:grid-cols-3 gap-3' : 'grid grid-cols-1 gap-3'}>
                      {/* Coming */}
                      {showComing && (
                        <div className="border border-emerald-200 bg-emerald-50/40 rounded-lg p-3 space-y-2">
                          <div className="text-xs font-semibold text-emerald-900 flex items-center gap-1.5">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700" />
                            Coming ({filteredAttendingVotes.length})
                          </div>
                          {filteredAttendingVotes.length === 0 ? (
                            <p className="text-xs text-slate-500">None.</p>
                          ) : (
                            <ul className="divide-y divide-emerald-100 max-h-64 overflow-y-auto text-xs pr-1">
                              {filteredAttendingVotes.map((v) => {
                                const isRowBusy = votingForUid === v.uid;
                                const isPaid = paidUidsForMatchMonth.has(v.uid);
                                const waitlistIdx = waitlistedVotes.findIndex((w) => w.uid === v.uid);
                                const isWaitlisted = waitlistIdx !== -1;
                                return (
                                  <li key={v.uid} className="py-1 flex items-center justify-between gap-1.5">
                                    <div className="min-w-0 flex items-center gap-1">
                                      <span className="font-medium text-slate-900 truncate">{v.playerName}</span>
                                      {isWaitlisted && (
                                        <span className="inline-flex items-center gap-0.5 text-[10px] font-mono-tabular font-semibold text-amber-800 shrink-0">
                                          <Clock className="w-2.5 h-2.5" />
                                          #{waitlistIdx + 1}
                                        </span>
                                      )}
                                      {!isPaid && !isTestPlayerUid(v.uid) && (
                                        <span className="text-[10px] font-semibold text-rose-700 shrink-0">
                                          Unpaid
                                        </span>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-1 shrink-0">
                                      <select
                                        disabled={isRowBusy}
                                        value={v.goalieOption}
                                        onChange={(e) =>
                                          handleManagerCastVote(
                                            v.uid,
                                            v.playerName,
                                            true,
                                            e.target.value as GoalieOption
                                          )
                                        }
                                        title="Change goalie status"
                                        className="px-1 py-0.5 rounded border border-emerald-200 bg-white text-[10px] font-mono-tabular text-emerald-900"
                                      >
                                        <option value="none">Out</option>
                                        <option value="willing">W-GK</option>
                                        <option value="only_goalie">GK</option>
                                      </select>
                                      <button
                                        type="button"
                                        disabled={isRowBusy}
                                        onClick={() => handleManagerCastVote(v.uid, v.playerName, false, 'none')}
                                        title="Move to Not Coming"
                                        className="px-1.5 py-0.5 rounded border border-slate-300 bg-white hover:bg-slate-100 text-[10px] font-semibold text-slate-700 disabled:opacity-50"
                                      >
                                        Out
                                      </button>
                                      <button
                                        type="button"
                                        disabled={isRowBusy}
                                        onClick={() => handleManagerClearVote(v.uid, v.playerName)}
                                        title="Clear vote"
                                        className="p-0.5 rounded text-slate-400 hover:text-red-600 disabled:opacity-50"
                                      >
                                        <X className="w-3 h-3" />
                                      </button>
                                    </div>
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                        </div>
                      )}

                      {/* Not Coming */}
                      {showDeclined && (
                        <div className="border border-slate-200 bg-slate-50/70 rounded-lg p-3 space-y-2">
                          <div className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                            <XCircle className="w-3.5 h-3.5 text-slate-500" />
                            Not Coming ({filteredDeclinedVotes.length})
                          </div>
                          {filteredDeclinedVotes.length === 0 ? (
                            <p className="text-xs text-slate-500">None.</p>
                          ) : (
                            <ul className="divide-y divide-slate-200/70 max-h-64 overflow-y-auto text-xs pr-1">
                              {filteredDeclinedVotes.map((v) => {
                                const isRowBusy = votingForUid === v.uid;
                                return (
                                  <li key={v.uid} className="py-1 flex items-center justify-between gap-2">
                                    <span className="font-medium text-slate-700 truncate">{v.playerName}</span>
                                    <div className="flex items-center gap-1 shrink-0">
                                      <button
                                        type="button"
                                        disabled={isRowBusy}
                                        onClick={() => handleManagerCastVote(v.uid, v.playerName, true, 'none')}
                                        title="Switch to Coming"
                                        className="px-1.5 py-0.5 rounded bg-emerald-700 hover:bg-emerald-800 text-[10px] font-semibold text-white disabled:opacity-50"
                                      >
                                        In
                                      </button>
                                      <button
                                        type="button"
                                        disabled={isRowBusy}
                                        onClick={() => handleManagerClearVote(v.uid, v.playerName)}
                                        title="Clear vote"
                                        className="p-0.5 rounded text-slate-400 hover:text-red-600 disabled:opacity-50"
                                      >
                                        <X className="w-3 h-3" />
                                      </button>
                                    </div>
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                        </div>
                      )}

                      {/* Not Voted Yet */}
                      {showUnvoted && (
                        <div className="border border-amber-200 bg-amber-50/40 rounded-lg p-3 space-y-2">
                          <div className="text-xs font-semibold text-amber-900">
                            Pending ({filteredUnvotedPlayers.length})
                          </div>
                          {filteredUnvotedPlayers.length === 0 ? (
                            <p className="text-xs text-slate-500">All voted.</p>
                          ) : (
                            <ul className="divide-y divide-amber-100 max-h-64 overflow-y-auto text-xs pr-1">
                              {filteredUnvotedPlayers.map((p) => {
                                const fullName = `${p.firstName} ${p.lastName}`;
                                const isRowBusy = votingForUid === p.uid;
                                const isPaid = paidUidsForMatchMonth.has(p.uid);
                                return (
                                  <li key={p.uid} className="py-1 flex items-center justify-between gap-1.5">
                                    <div className="min-w-0">
                                      <div className="font-medium text-slate-800 truncate">{fullName}</div>
                                      <div className="text-[10px] text-amber-800/80 font-mono-tabular flex items-center gap-1">
                                        <span>{p.favoritePositions[0]}</span>
                                        {!isPaid && <span className="text-rose-700 font-sans">· Unpaid</span>}
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-1 shrink-0">
                                      <button
                                        type="button"
                                        disabled={isRowBusy}
                                        onClick={() => handleManagerCastVote(p.uid, fullName, true, 'none')}
                                        title="Vote Coming"
                                        className="px-1.5 py-0.5 rounded bg-emerald-700 hover:bg-emerald-800 text-white text-[10px] font-semibold disabled:opacity-50"
                                      >
                                        In
                                      </button>
                                      <button
                                        type="button"
                                        disabled={isRowBusy}
                                        onClick={() => handleManagerCastVote(p.uid, fullName, true, 'only_goalie')}
                                        title="Vote Coming as Goalie"
                                        className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-900 text-amber-300 text-[10px] font-semibold disabled:opacity-50"
                                      >
                                        GK
                                      </button>
                                      <button
                                        type="button"
                                        disabled={isRowBusy}
                                        onClick={() => handleManagerCastVote(p.uid, fullName, false, 'none')}
                                        title="Vote Not Coming"
                                        className="px-1.5 py-0.5 rounded border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 text-[10px] font-semibold disabled:opacity-50"
                                      >
                                        Out
                                      </button>
                                    </div>
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}

              {showManualBuilder && (
                <ManualTeamBuilder
                  confirmedVotes={confirmedVotes}
                  playersById={playersById}
                  ratings={ratings}
                  teamCount={activeTeamCount}
                  teamColors={normalizedMatchColors}
                  existingFormation={liveWorkingFormation}
                  busy={busy}
                  onApplyFormation={handleApplyManualFormation}
                  onClose={() => setShowManualBuilder(false)}
                />
              )}

              {/* Center of Attention: Soccer Pitches */}
              {liveWorkingFormation ? (
                <SoccerPitch
                  formation={liveWorkingFormation}
                  originalFormation={liveOriginalFormation}
                  playersById={playersById}
                  bestPositionsById={bestPositionsById}
                  editable={true}
                  showRatings={true}
                  showPreferredPositions={true}
                  skillArrowThresholds={activeSkillThresholds}
                  onFormationChange={handleAutoSaveFormation}
                  onRestoreOriginal={handleRestoreOriginalAi}
                />
              ) : (
                <div className="bg-white border border-slate-200 rounded-xl p-8 text-center space-y-3">
                  <p className="text-sm text-slate-600">
                    No pitch formation yet ({confirmedVotes.length} confirmed).
                  </p>
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    <button
                      type="button"
                      disabled={busy || aiRunning || confirmedVotes.length < activeTeamCount}
                      onClick={handleRunAiFormation}
                      className="px-3.5 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-50"
                    >
                      {aiRunning ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Sparkles className="w-3.5 h-3.5" />
                      )}
                      Run AI Formation
                    </button>
                    <button
                      type="button"
                      disabled={busy || confirmedVotes.length === 0}
                      onClick={() => setShowManualBuilder(true)}
                      className="px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-50"
                    >
                      <LayoutGrid className="w-3.5 h-3.5" />
                      Arrange Manually
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-500">
              No active poll. Click <span className="font-semibold text-slate-700">+</span> to open one.
            </div>
          )}
            </>
          )}
        </div>
      )}

      {subTab === 'scouting' && (
        <PlayerRatingDeck
          user={user}
          profile={profile}
          players={players}
          ratings={ratings}
          completedMatches={completedMatches}
          skillArrowThresholds={activeSkillThresholds}
        />
      )}

      {subTab === 'schedule' && (
        <form
          onSubmit={handleSaveSettings}
          className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8 max-w-3xl space-y-6"
        >
          <div className="flex items-center gap-2.5 pb-4 border-b border-slate-100">
            <CalendarClock className="w-5 h-5 text-emerald-700" />
            <h2 className="text-base font-semibold text-slate-900">Match Schedule, Player Limit &amp; Kit Colors</h2>
          </div>

          {/* Adjustable Player Limit / Waitlist Threshold */}
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="max-players-input" className="text-xs font-semibold text-slate-900">
                Confirmed Player Limit
              </label>
              <div className="flex items-center gap-2 shrink-0">
                <input
                  id="max-players-input"
                  type="number"
                  min={4}
                  max={100}
                  required
                  value={maxPlayersInput}
                  onChange={(e) => setMaxPlayersInput(Number(e.target.value))}
                  className="w-24 px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm font-mono-tabular font-semibold text-center"
                />
                <span className="text-xs text-slate-500 whitespace-nowrap">players</span>
              </div>
            </div>
          </div>

          {/* Adjustable Skill Arrow Thresholds */}
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3.5">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs font-semibold text-slate-900">
                Skill Arrow Thresholds
              </h3>
              <button
                type="button"
                onClick={() =>
                  setSkillThresholdsInput([...DEFAULT_SKILL_ARROW_THRESHOLDS] as SkillArrowThresholds)
                }
                className="px-2.5 py-1 rounded-md border border-slate-300 bg-white hover:bg-slate-100 text-[11px] font-semibold text-slate-700 whitespace-nowrap"
              >
                Reset
              </button>
            </div>

            {(() => {
              const [t0, t1, t2, t3] = skillThresholdsInput;
              const isValidOrder =
                t0 >= 1 && t0 < t1 && t1 < t2 && t2 < t3 && t3 <= 99;
              const previewThresholds = isValidOrder
                ? skillThresholdsInput
                : DEFAULT_SKILL_ARROW_THRESHOLDS;
              const updateCutoff = (idx: 0 | 1 | 2 | 3, val: number) => {
                const next = [...skillThresholdsInput] as SkillArrowThresholds;
                next[idx] = val;
                setSkillThresholdsInput(next);
              };

              return (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {[
                      { idx: 0 as const, title: 'Down / Down-Right', hint: `0–${Math.max(0, t0 - 1)} vs ${t0}+` },
                      { idx: 1 as const, title: 'Down-Right / Flat', hint: `${t0}–${Math.max(t0, t1 - 1)} vs ${t1}+` },
                      { idx: 2 as const, title: 'Flat / Up-Right', hint: `${t1}–${t2} vs ${t2 + 1}+` },
                      { idx: 3 as const, title: 'Up-Right / Up', hint: `${t2 + 1}–${t3} vs ${t3 + 1}+` },
                    ].map((item) => (
                      <div key={item.idx} className="bg-white border border-slate-200 rounded-lg p-2.5 space-y-1">
                        <label
                          htmlFor={`skill-cutoff-${item.idx}`}
                          className="block text-[11px] font-semibold text-slate-700"
                        >
                          {item.title}
                        </label>
                        <input
                          id={`skill-cutoff-${item.idx}`}
                          type="number"
                          min={1}
                          max={99}
                          required
                          value={skillThresholdsInput[item.idx]}
                          onChange={(e) => updateCutoff(item.idx, Number(e.target.value))}
                          className="w-full px-2.5 py-1.5 rounded-md border border-slate-300 bg-slate-50 focus:bg-white text-sm font-mono-tabular font-bold text-slate-900 text-center"
                        />
                        <div className="text-[10px] font-mono-tabular text-slate-500 text-center">
                          {item.hint}
                        </div>
                      </div>
                    ))}
                  </div>

                  {!isValidOrder && (
                    <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-300 text-[11px] text-amber-900 flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                      <span>
                        Thresholds must be strictly increasing between 1 and 99 (e.g. 25, 40, 60, 75).
                      </span>
                    </div>
                  )}

                  <div className="grid grid-cols-5 gap-2 pt-1">
                    {[
                      { sample: Math.max(0, previewThresholds[0] - 1), range: `0–${previewThresholds[0] - 1}` },
                      { sample: previewThresholds[0], range: `${previewThresholds[0]}–${previewThresholds[1] - 1}` },
                      { sample: previewThresholds[1], range: `${previewThresholds[1]}–${previewThresholds[2]}` },
                      { sample: previewThresholds[3], range: `${previewThresholds[2] + 1}–${previewThresholds[3]}` },
                      { sample: Math.min(100, previewThresholds[3] + 1), range: `${previewThresholds[3] + 1}–100` },
                    ].map((tier, i) => (
                      <div
                        key={i}
                        className="flex flex-col items-center gap-1 py-2 px-1 rounded-lg bg-white border border-slate-200"
                      >
                        <SkillArrowBadge
                          skill={tier.sample}
                          size="md"
                          variant="pitch"
                          thresholds={previewThresholds}
                        />
                        <span className="text-[10px] font-mono-tabular font-semibold text-slate-700">
                          {tier.range}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              );
            })()}
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Poll Open Day</label>
              <select
                value={pollOpenDay}
                onChange={(e) => setPollOpenDay(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white"
              >
                {DAY_NAMES.map((name, idx) => (
                  <option key={name} value={idx}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Poll Open Time</label>
              <input
                type="time"
                value={pollOpenTime}
                onChange={(e) => setPollOpenTime(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-mono-tabular"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Match Day</label>
              <select
                value={matchDay}
                onChange={(e) => setMatchDay(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white"
              >
                {DAY_NAMES.map((name, idx) => (
                  <option key={name} value={idx}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Match Kickoff Time</label>
              <input
                type="time"
                value={matchTime}
                onChange={(e) => setMatchTime(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-mono-tabular"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Default Vancouver Pitch Location</label>
            <input
              type="text"
              required
              value={matchLocation}
              onChange={(e) => setMatchLocation(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
            />
          </div>

          <div className="space-y-3">
            <label className="block text-xs font-semibold text-slate-700">
              Default 4-Team Kit Colors (Red, Blue, Black, Yellow)
            </label>

            {defaultColorDuplicates.length > 0 && (
              <div className="p-3 rounded-lg bg-amber-50 border border-amber-300 text-xs text-amber-950 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold">Similar default kit colors selected:</span>{' '}
                  {defaultColorDuplicates
                    .map((d) => `Teams ${d.teamNumbers.join(' & ')} are both set to ${d.color}`)
                    .join(' · ')}
                  . Consider using distinct colors for each default team.
                </div>
              </div>
            )}

            <div className="grid sm:grid-cols-2 gap-3">
              {[0, 1, 2, 3].map((idx) => {
                const selectedColor = normalizeStandardTeamColor(defaultColors[idx], idx);
                const hasConflict = defaultDuplicateColorSet.has(selectedColor);
                return (
                  <div
                    key={idx}
                    className={`p-3 rounded-xl border space-y-2.5 transition-colors ${
                      hasConflict
                        ? 'border-amber-400 bg-amber-50/40'
                        : 'border-slate-200 bg-slate-50/70'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold text-slate-600">
                        Team {idx + 1}
                        {hasConflict && (
                          <span className="ml-1.5 text-amber-700 font-semibold">· Duplicate</span>
                        )}
                      </span>
                      <span className="inline-flex items-center gap-1 text-xs font-bold text-slate-900">
                        <TeamJerseyIcon color={selectedColor} size={18} />
                        {selectedColor}
                      </span>
                    </div>
                    <div className="grid grid-cols-4 gap-1.5">
                      {STANDARD_TEAM_COLORS.map((colorName) => {
                        const isPicked = selectedColor === colorName;
                        return (
                          <button
                            key={colorName}
                            type="button"
                            onClick={() => {
                              const next = [...defaultColors];
                              next[idx] = colorName;
                              setDefaultColors(next);
                            }}
                            aria-pressed={isPicked}
                            className={`py-2 px-1 rounded-lg border flex flex-col items-center justify-center gap-1 transition-all duration-150 ${
                              isPicked
                                ? 'bg-white border-slate-900 ring-2 ring-slate-900/80 shadow-sm opacity-100 scale-[1.03]'
                                : 'bg-white/60 border-slate-200 opacity-40 hover:opacity-80 hover:border-slate-300'
                            }`}
                          >
                            <TeamJerseyIcon color={colorName} size={26} />
                            <span
                              className={`text-[10px] leading-none ${
                                isPicked
                                  ? 'font-bold text-slate-950'
                                  : 'font-medium text-slate-500'
                              }`}
                            >
                              {colorName}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={busy}
              className="px-5 py-2.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold inline-flex items-center gap-2 whitespace-nowrap disabled:opacity-60"
            >
              <Save className="w-4 h-4" />
              Save Schedule & Defaults
            </button>
          </div>
        </form>
      )}
      {/* Approval Modal: Stop / Delete Active Weekly Drop-In Poll */}
      {showDeletePollModal && activeMatch && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-poll-modal-title"
        >
          <div className="bg-white border border-slate-200 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-rose-100 text-rose-700 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3
                  id="delete-poll-modal-title"
                  className="text-base font-bold text-slate-900"
                >
                  Approve Stop &amp; Delete Drop-In Poll?
                </h3>
                <p className="text-xs text-slate-600 leading-relaxed">
                  This will permanently stop and delete the current active drop-in poll and clear all recorded attendance votes for it.
                </p>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-500">Poll Title</span>
                <span className="font-semibold text-slate-900 text-right">{activeMatch.title}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-500">Scheduled Date</span>
                <span className="font-mono-tabular font-semibold text-slate-900">
                  {new Date(activeMatch.kickoffIso).toLocaleDateString('en-CA', {
                    weekday: 'short',
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                  })}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-500">Votes to be removed</span>
                <span className="font-mono-tabular font-semibold text-rose-700">
                  {votes.length} ({confirmedVotes.length} confirmed{waitlistedVotes.length > 0 ? `, ${waitlistedVotes.length} waitlisted` : ''})
                </span>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => setShowDeletePollModal(false)}
                className="px-4 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold whitespace-nowrap disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={handleDeleteActivePoll}
                className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap disabled:opacity-50"
              >
                {busy ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Trash2 className="w-3.5 h-3.5" />
                )}
                Approve &amp; Delete Poll
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
