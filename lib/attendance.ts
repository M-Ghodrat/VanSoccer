import { FieldValue } from 'firebase-admin/firestore';
import { clubDb, requireClubIdentity } from './clubBackend';
import { ApiHttpError } from './formationAnalyzer';
import { getAttendanceWindow, getMonthKey, partitionAttendingVotes } from '../src/utils/clubUtils';
import type { DropInMatch, MatchVote } from '../src/types';

export async function updateAttendance(header: string | null | undefined, input: unknown) {
  const identity = await requireClubIdentity(header);
  const { matchId, attending, goalieOption } = (input ?? {}) as Record<string, unknown>;
  if (typeof matchId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(matchId)
    || (attending !== null && typeof attending !== 'boolean')
    || (attending === true && !['none', 'willing', 'only_goalie'].includes(String(goalieOption)))) {
    throw new ApiHttpError(400, 'Invalid attendance request.');
  }

  const db = clubDb();
  const matchRef = db.collection('matches').doc(matchId);
  const votes = matchRef.collection('votes');
  const voteRef = votes.doc(identity.uid);
  await db.runTransaction(async (transaction) => {
    const [match, player, member, admin, manager, settings] = await transaction.getAll(
      matchRef, db.collection('players').doc(identity.uid), db.collection('members').doc(identity.uid),
      db.collection('admins').doc(identity.uid), db.collection('managers').doc(identity.uid),
      db.doc('settings/clubConfig')
    );
    if (!player.exists || (!member.exists && !admin.exists && !manager.exists)) {
      throw new ApiHttpError(403, 'Approved club membership required.');
    }
    if (!match.exists) throw new ApiHttpError(404, 'Match unavailable.');
    const matchData = match.data() as DropInMatch;
    const { canJoin, canWithdraw } = getAttendanceWindow(matchData, Date.now());
    if (!canWithdraw) throw new ApiHttpError(409, 'This match has already started.');
    if (attending === true) {
      if (!canJoin) throw new ApiHttpError(409, 'The attendance poll is closed.');
      const month = getMonthKey(match.get('kickoffIso'));
      const payment = await transaction.get(db.collection('payments').doc(`${identity.uid}_${month}`));
      if (payment.get('uid') !== identity.uid || payment.get('monthKey') !== month || payment.get('paid') !== true) {
        throw new ApiHttpError(403, `Club Fee Notice: You have to pay first for ${month} before joining this match. Please contact a club manager or admin.`);
      }
    }

    const snapshot = await transaction.get(votes);
    const previous = snapshot.docs.find((vote) => vote.id === identity.uid);
    const roster = partitionAttendingVotes(snapshot.docs.map((vote) => ({
      ...vote.data(), uid: vote.id,
    }) as MatchVote), settings.get('maxPlayers'));
    const promoted = attending !== true && roster.confirmedVotes.some((vote) => vote.uid === identity.uid)
      ? roster.waitlistedVotes[0] : undefined;

    if (attending === null) {
      transaction.delete(voteRef);
    } else {
      transaction.set(voteRef, {
        uid: identity.uid,
        matchId,
        attending,
        goalieOption: attending ? goalieOption : 'none',
        playerName: `${player.get('firstName')} ${player.get('lastName')}`.slice(0, 100),
        joinedAt: attending ? (previous?.get('attending') && previous.get('joinedAt')) || FieldValue.serverTimestamp() : null,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    if (promoted) {
      const notification = db.collection('notifications').doc();
      const matchTitle = String(match.get('title')).slice(0, 120);
      transaction.create(notification, {
        id: notification.id,
        recipientUid: promoted.uid,
        matchId,
        matchTitle,
        type: 'waitlist_promoted',
        message: `A spot opened up for ${matchTitle}. You moved off the waitlist into the confirmed lineup.`,
        read: false,
        createdBy: identity.uid,
        createdAt: FieldValue.serverTimestamp(),
      });
    }
  });
}
