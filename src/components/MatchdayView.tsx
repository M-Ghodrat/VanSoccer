import React, { useEffect, useMemo, useState } from 'react';
import { User } from 'firebase/auth';
import { doc, serverTimestamp, writeBatch } from 'firebase/firestore';
import { AlertTriangle, Calendar, CheckCircle2, Clock, MapPin, Users, XCircle } from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import {
  ClubPayment,
  ClubSettings,
  DropInMatch,
  GoalieOption,
  MatchVote,
  PlayerProfile,
} from '../types';
import {
  DEFAULT_MAX_PLAYERS,
  formatMatchDisplayTitle,
  formatScheduleLabel,
  formatShortDateTime,
  getMonthKey,
  isRedundantMatchTitle,
  partitionAttendingVotes,
} from '../utils/clubUtils';
import { SoccerPitch } from './SoccerPitch';
import { SoccerBallIcon } from './SoccerBallIcon';

const GoalieGloveIcon: React.FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    <path d="M18 11V7a1.4 1.4 0 0 0-2.8 0v3" />
    <path d="M15.2 10V5.2a1.4 1.4 0 0 0-2.8 0V10" />
    <path d="M12.4 10V4.8a1.4 1.4 0 0 0-2.8 0V11" />
    <path d="M9.6 11V7.2a1.4 1.4 0 0 0-2.8 0v6.3c0 2.8 2.2 5 5 5h1.5c2.6 0 4.7-2.1 4.7-4.7V11" />
    <path d="M6.8 13.5 5.2 11.7a1.3 1.3 0 0 0-1.9 1.8l2.5 3.2" />
    <rect x="8" y="18.8" width="8.5" height="2.8" rx="1" fill="currentColor" stroke="none" />
  </svg>
);

interface MatchdayViewProps {
  user: User;
  profile: PlayerProfile;
  settings: ClubSettings;
  activeMatch: DropInMatch | null;
  votes: MatchVote[];
  payments: ClubPayment[];
  playersById: Map<string, PlayerProfile>;
  onNavigateManager?: () => void;
}

export const MatchdayView: React.FC<MatchdayViewProps> = ({
  user,
  profile,
  settings,
  activeMatch,
  votes,
  payments,
  playersById,
  onNavigateManager,
}) => {
  const myVote = votes.find((v) => v.uid === user.uid) || null;
  const [goalieOption, setGoalieOption] = useState<GoalieOption>(myVote?.goalieOption || 'none');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (myVote) {
      setGoalieOption(myVote.goalieOption);
    }
  }, [myVote?.goalieOption]);

  const maxPlayers = settings.maxPlayers ?? DEFAULT_MAX_PLAYERS;
  const { sortedAttending, confirmedVotes, waitlistedVotes } = useMemo(
    () => partitionAttendingVotes(votes, maxPlayers),
    [votes, maxPlayers]
  );
  const declinedVotes = useMemo(() => votes.filter((v) => !v.attending), [votes]);

  const myConfirmedIndex = confirmedVotes.findIndex((v) => v.uid === user.uid);
  const myWaitlistIndex = waitlistedVotes.findIndex((v) => v.uid === user.uid);
  const isUserConfirmed = myConfirmedIndex !== -1;
  const isUserWaitlisted = myWaitlistIndex !== -1;
  const isMatchFull = confirmedVotes.length >= maxPlayers;

  const onlyGoalieCount = confirmedVotes.filter((v) => v.goalieOption === 'only_goalie').length;
  const willingGoalieCount = confirmedVotes.filter((v) => v.goalieOption === 'willing').length;

  const isManagerOrAdmin = profile.role === 'manager' || profile.role === 'admin';
  const matchMonthKey = activeMatch ? getMonthKey(activeMatch.kickoffIso) : getMonthKey();
  const hasPaidForMatchMonth = payments.some(
    (p) => p.uid === user.uid && p.monthKey === matchMonthKey && p.paid
  );

  const castVote = async (attending: boolean, chosenGoalie: GoalieOption) => {
    if (!activeMatch) return;
    setError(null);
    setNotice(null);

    if (attending && !hasPaidForMatchMonth) {
      setError(`Club Fee Notice: You have to pay first for ${matchMonthKey} before joining this match. Please contact a club manager or admin.`);
      return;
    }

    setSubmitting(true);
    try {
      const batch = writeBatch(db);
      const voteDocRef = doc(db, 'matches', activeMatch.id, 'votes', user.uid);
      const wasConfirmedAttending = isUserConfirmed;
      const keepExistingJoinedAt = Boolean(myVote?.attending && attending && myVote.joinedAt);

      batch.set(voteDocRef, {
        uid: user.uid,
        matchId: activeMatch.id,
        attending,
        goalieOption: attending ? chosenGoalie : 'none',
        playerName: `${profile.firstName} ${profile.lastName}`,
        joinedAt: attending
          ? keepExistingJoinedAt
            ? myVote!.joinedAt
            : serverTimestamp()
          : null,
        updatedAt: serverTimestamp(),
      });

      // If a confirmed player cancels and someone is on the waiting list, notify the #1 waitlisted player
      if (!attending && wasConfirmedAttending && waitlistedVotes.length > 0) {
        const promoted = waitlistedVotes[0];
        if (playersById.has(promoted.uid)) {
          const notifId = `notif_${Date.now()}_${promoted.uid.slice(0, 12)}`;
          batch.set(doc(db, 'notifications', notifId), {
            id: notifId,
            recipientUid: promoted.uid,
            matchId: activeMatch.id,
            matchTitle: formatMatchDisplayTitle(activeMatch).slice(0, 120),
            type: 'waitlist_promoted',
            message: `A spot opened up for ${formatMatchDisplayTitle(activeMatch)}! You have been moved off the waiting list into the confirmed lineup.`,
            read: false,
            createdBy: user.uid,
            createdAt: serverTimestamp(),
          });
        }
      }

      await batch.commit();

      if (attending && !wasConfirmedAttending && isMatchFull) {
        setNotice(
          `You have been added to the low-chance waiting list (limit ${maxPlayers} reached). If anyone cancels, you will be automatically moved in and notified.`
        );
      } else if (!attending && wasConfirmedAttending && waitlistedVotes.length > 0) {
        setNotice(
          `Marked Not Attending. ${waitlistedVotes[0].playerName} has been moved up from the waiting list and notified.`
        );
      }
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.WRITE, `matches/${activeMatch.id}/votes/${user.uid}`);
      } catch (wrapped) {
        setError(wrapped instanceof Error ? wrapped.message : 'Could not submit vote.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleUnvote = async () => {
    if (!activeMatch) return;
    setError(null);
    setNotice(null);
    setSubmitting(true);
    try {
      const batch = writeBatch(db);
      batch.delete(doc(db, 'matches', activeMatch.id, 'votes', user.uid));

      if (isUserConfirmed && waitlistedVotes.length > 0) {
        const promoted = waitlistedVotes[0];
        if (playersById.has(promoted.uid)) {
          const notifId = `notif_${Date.now()}_${promoted.uid.slice(0, 12)}`;
          batch.set(doc(db, 'notifications', notifId), {
            id: notifId,
            recipientUid: promoted.uid,
            matchId: activeMatch.id,
            matchTitle: formatMatchDisplayTitle(activeMatch).slice(0, 120),
            type: 'waitlist_promoted',
            message: `A spot opened up for ${formatMatchDisplayTitle(activeMatch)}! You have been moved off the waiting list into the confirmed lineup.`,
            read: false,
            createdBy: user.uid,
            createdAt: serverTimestamp(),
          });
        }
      }

      await batch.commit();
      setGoalieOption('none');
      if (isUserConfirmed && waitlistedVotes.length > 0) {
        setNotice(
          `Your vote was cleared. ${waitlistedVotes[0].playerName} has been promoted from the waiting list and notified.`
        );
      }
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.DELETE, `matches/${activeMatch.id}/votes/${user.uid}`);
      } catch (wrapped) {
        setError(wrapped instanceof Error ? wrapped.message : 'Could not remove vote.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (!activeMatch) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-3">
        <Calendar className="w-10 h-10 text-slate-400 mx-auto" />
        <div className="space-y-1 max-w-md mx-auto">
          <h2 className="font-display text-2xl font-bold text-slate-900">No Active Match Poll Yet</h2>
          <p className="text-sm text-slate-600">
            Weekly polls open every {formatScheduleLabel(settings.pollOpenDay, settings.pollOpenTime)} with a confirmed roster limit of {maxPlayers} players.
          </p>
        </div>
      </div>
    );
  }

  const hasCustomTitle = !isRedundantMatchTitle(activeMatch.title);
  const kickoffTimeStr = new Date(activeMatch.kickoffIso).toLocaleTimeString('en-CA', {
    hour: 'numeric',
    minute: '2-digit',
  });

  return (
    <div className="space-y-6">
      {/* Compact Match Header */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-500">
            <span className={isMatchFull ? 'text-amber-700 font-semibold' : 'text-emerald-700 font-semibold'}>
              {isMatchFull ? 'Waitlist Open' : 'Open'}
            </span>
            <span aria-hidden="true">·</span>
            <span className="inline-flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5 text-slate-400" />
              {hasCustomTitle ? formatShortDateTime(activeMatch.kickoffIso) : kickoffTimeStr}
            </span>
            <span aria-hidden="true">·</span>
            <span className="inline-flex items-center gap-1">
              <MapPin className="w-3.5 h-3.5 text-slate-400" />
              {activeMatch.location}
            </span>
          </div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
            {formatMatchDisplayTitle(activeMatch)}
          </h1>
        </div>

        {/* Attendance KPI Strip */}
        <div
          className={`grid ${waitlistedVotes.length > 0 ? 'grid-cols-3' : 'grid-cols-2'} gap-5 pt-3 lg:pt-0 border-t lg:border-t-0 lg:border-l border-slate-200 lg:pl-6 shrink-0`}
        >
          <div>
            <div className="text-[11px] text-slate-500">Confirmed</div>
            <div className="font-mono-tabular text-xl font-bold text-slate-900">
              {confirmedVotes.length}/{maxPlayers}
            </div>
          </div>
          {waitlistedVotes.length > 0 && (
            <div>
              <div className="text-[11px] text-slate-500">Waitlist</div>
              <div className="font-mono-tabular text-xl font-bold text-amber-700">
                {waitlistedVotes.length}
              </div>
            </div>
          )}
          <div>
            <div className="text-[11px] text-slate-500">GK</div>
            <div className="font-mono-tabular text-xl font-bold text-slate-900">
              {onlyGoalieCount}/{willingGoalieCount}
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">
          {error}
        </div>
      )}

      {notice && (
        <div className="p-3.5 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-900 flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <span>{notice}</span>
        </div>
      )}

      {/* Compact Fit-Content Voting Bar */}
      <div className="bg-white border border-slate-200 rounded-xl px-3.5 py-2.5 w-fit max-w-full space-y-2">
        <div className="flex flex-wrap items-center gap-2.5">
          <div
            role="group"
            aria-label="Position preference"
            className="flex items-center gap-0.5 p-0.5 bg-slate-100 rounded-lg border border-slate-200"
          >
            {[
              { id: 'none' as GoalieOption, title: 'Outfield' },
              { id: 'willing' as GoalieOption, title: 'Willing Goalie' },
              { id: 'only_goalie' as GoalieOption, title: 'Only Goalie' },
            ].map((opt) => {
              const isSelected = goalieOption === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => {
                    setGoalieOption(opt.id);
                    if (myVote?.attending) {
                      castVote(true, opt.id);
                    }
                  }}
                  title={opt.title}
                  aria-label={opt.title}
                  aria-pressed={isSelected}
                  className={`px-2 py-1.5 rounded-md transition-colors inline-flex items-center justify-center gap-0.5 ${
                    isSelected
                      ? 'bg-white text-emerald-700 shadow-xs ring-1 ring-slate-200/80'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  {opt.id === 'none' && <SoccerBallIcon className="w-4 h-4" />}
                  {opt.id === 'willing' && (
                    <>
                      <SoccerBallIcon className="w-3.5 h-3.5" />
                      <GoalieGloveIcon
                        className={`w-3.5 h-3.5 ${isSelected ? 'text-amber-600' : 'text-amber-600/80'}`}
                      />
                    </>
                  )}
                  {opt.id === 'only_goalie' && (
                    <GoalieGloveIcon
                      className={`w-4 h-4 ${isSelected ? 'text-amber-600' : 'text-amber-600/80'}`}
                    />
                  )}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-1.5">
            <div
              role="group"
              aria-label="Match attendance"
              className="inline-flex items-center p-0.5 rounded-lg bg-slate-100 border border-slate-200"
            >
              <button
                type="button"
                disabled={submitting}
                aria-pressed={Boolean(myVote?.attending)}
                onClick={() => castVote(true, goalieOption)}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all inline-flex items-center gap-1.5 whitespace-nowrap ${
                  myVote?.attending
                    ? isUserWaitlisted
                      ? 'bg-amber-600 text-white shadow-xs'
                      : 'bg-emerald-700 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                {myVote?.attending && isUserWaitlisted
                  ? `Waitlist #${myWaitlistIndex + 1}`
                  : !myVote?.attending && isMatchFull
                    ? 'Waitlist'
                    : 'Attend'}
              </button>

              <button
                type="button"
                disabled={submitting}
                aria-pressed={Boolean(myVote && !myVote.attending)}
                onClick={() => castVote(false, 'none')}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all inline-flex items-center gap-1.5 whitespace-nowrap ${
                  myVote && !myVote.attending
                    ? 'bg-slate-900 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <XCircle className="w-3.5 h-3.5" />
                Out
              </button>
            </div>

            {myVote && (
              <button
                type="button"
                disabled={submitting}
                onClick={handleUnvote}
                title="Clear vote"
                aria-label="Clear vote"
                className="px-2 py-1.5 rounded-lg text-xs font-medium text-slate-500 hover:text-rose-700 hover:bg-rose-50 transition-colors whitespace-nowrap"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {!hasPaidForMatchMonth && (
          <div className="px-2.5 py-1.5 rounded-lg bg-amber-50 border border-amber-200 text-[11px] text-amber-900">
            Payment required for {matchMonthKey} before joining.
          </div>
        )}

        {isUserWaitlisted && (
          <div className="px-2.5 py-1.5 rounded-lg bg-amber-50 border border-amber-200 text-[11px] text-amber-950 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
            <span>Waitlist #{myWaitlistIndex + 1} — auto-promoted if a spot opens.</span>
          </div>
        )}

        {!isUserConfirmed && !isUserWaitlisted && isMatchFull && (
          <div className="px-2.5 py-1.5 rounded-lg bg-amber-50 border border-amber-200 text-[11px] text-amber-950 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
            <span>Full ({confirmedVotes.length}/{maxPlayers}) — joins waitlist.</span>
          </div>
        )}
      </div>

      {/* Published Tactical Pitch Formations */}
      {activeMatch.currentFormation ? (
        <SoccerPitch
          formation={activeMatch.currentFormation}
          originalFormation={activeMatch.aiOriginalFormation}
          playersById={playersById}
          editable={false}
          showRatings={false}
          showPreferredPositions={false}
          showAvgAge={false}
          showFormationShape={false}
        />
      ) : (
        /* Attending Players List before formation is generated */
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
              <Users className="w-4 h-4 text-emerald-700" />
              Confirmed Sign-Ups ({confirmedVotes.length}/{maxPlayers})
            </h2>
            <span className="text-xs text-slate-500">
              {declinedVotes.length} declined
              {waitlistedVotes.length > 0 ? ` · ${waitlistedVotes.length} on waiting list` : ''}
            </span>
          </div>

          {sortedAttending.length === 0 ? (
            <p className="text-sm text-slate-500 py-4">No players have voted attending yet. Be the first on the sheet.</p>
          ) : (
            <div className="grid sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {confirmedVotes.map((vote) => {
                const p = playersById.get(vote.uid);
                return (
                  <div
                    key={vote.uid}
                    className="p-3 rounded-lg border border-slate-200 flex items-center gap-3 bg-slate-50/50"
                  >
                    <div className="w-9 h-9 rounded-full bg-slate-200 overflow-hidden flex items-center justify-center text-xs font-bold text-slate-700 shrink-0">
                      {p?.approvedPhotoUrl ? (
                        <img src={p.approvedPhotoUrl} alt={vote.playerName} className="w-full h-full object-cover" />
                      ) : (
                        vote.playerName.slice(0, 2).toUpperCase()
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-slate-900 truncate">{vote.playerName}</div>
                      <div className="text-[11px] text-slate-500 truncate">
                        {vote.goalieOption === 'only_goalie'
                          ? 'Only Goalie'
                          : vote.goalieOption === 'willing'
                            ? 'Willing Goalie'
                            : p?.favoritePositions?.join(' / ') || 'Outfield'}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Low-Chance Waiting List Card (shown whenever players exceed limit) */}
      {waitlistedVotes.length > 0 && (
        <div className="bg-white border border-amber-200 rounded-xl p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-amber-950 flex items-center gap-2">
              <Clock className="w-4 h-4 text-amber-600" />
              Low-Chance Waiting List ({waitlistedVotes.length})
            </h2>
            <span className="text-xs text-amber-800">
              First-come, first-served automatic promotion if a confirmed player cancels
            </span>
          </div>
          <div className="grid sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {waitlistedVotes.map((vote, idx) => {
              const p = playersById.get(vote.uid);
              return (
                <div
                  key={vote.uid}
                  className="p-3 rounded-lg border border-amber-200 bg-amber-50/50 flex items-center gap-3"
                >
                  <span className="font-mono-tabular text-xs font-bold text-amber-800 w-6 shrink-0">
                    #{idx + 1}
                  </span>
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-slate-900 truncate">
                      {vote.playerName}
                      {vote.uid === user.uid ? ' (You)' : ''}
                    </div>
                    <div className="text-[11px] text-amber-900/80 truncate">
                      {vote.goalieOption === 'only_goalie'
                        ? 'Only Goalie'
                        : vote.goalieOption === 'willing'
                          ? 'Willing Goalie'
                          : p?.favoritePositions?.join(' / ') || 'Outfield'}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

