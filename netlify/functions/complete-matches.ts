import { FieldValue } from 'firebase-admin/firestore';
import { clubDb } from '../../lib/clubBackend';
import { buildFinalizedEntriesFromMatch } from '../../src/utils/clubUtils';
import type { DropInMatch } from '../../src/types';

export const config = { schedule: '*/5 * * * *' };

export default async function handler() {
  const db = clubDb();
  const now = new Date().toISOString();
  for (const status of ['open', 'locked']) {
    const due = await db.collection('matches').where('status', '==', status)
      .get();
    for (const candidate of due.docs.filter((match) => Date.parse(match.get('kickoffIso')) <= Date.parse(now)).slice(0, 50)) {
      await db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(candidate.ref);
        if (!snapshot.exists) return;
        const match = snapshot.data() as DropInMatch;
        if (match.status !== status || !(Date.parse(match.kickoffIso) <= Date.parse(now))) return;
        const finalized = buildFinalizedEntriesFromMatch(match);
        transaction.update(candidate.ref, {
          status: 'completed',
          ...(finalized.length ? { finalizedPlayerTeams: finalized } : {}),
          updatedAt: FieldValue.serverTimestamp(),
        });
      });
    }
  }
  return new Response(null, { status: 204 });
}
