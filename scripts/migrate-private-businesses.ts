import 'dotenv/config';
import { FieldValue } from 'firebase-admin/firestore';
import { clubDb } from '../lib/clubBackend';
import { getPlayerBusinesses, type PlayerProfile } from '../src/types';

const apply = process.argv.includes('--apply');

async function main() {
  const db = clubDb();
  const players = await db.collection('players').select('businesses', 'business').get();
  let changed = 0;
  for (const candidate of players.docs) {
    if (!getPlayerBusinesses(candidate.data()).some((entry) => entry.allowPromotion !== true)) continue;
    if (!apply) {
      changed++;
      continue;
    }
    const migrated = await db.runTransaction(async (transaction) => {
      const player = await transaction.get(candidate.ref);
      if (!player.exists) return false;
      const entries = getPlayerBusinesses(player.data() as PlayerProfile);
      const privateEntries = entries.filter((entry) => entry.allowPromotion !== true);
      if (privateEntries.length === 0) return false;
      const privateRef = db.collection('player_business_private').doc(candidate.id);
      const privateDoc = await transaction.get(privateRef);
      const businesses = getPlayerBusinesses({
        businesses: [...(privateDoc.get('businesses') ?? []), ...privateEntries],
      });
      transaction.set(privateRef, { businesses, updatedAt: FieldValue.serverTimestamp() });
      transaction.update(candidate.ref, {
        businesses: entries.filter((entry) => entry.allowPromotion === true),
        business: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return true;
    });
    if (migrated) changed++;
  }
  console.log(`${apply ? 'Migrated' : 'Profiles needing migration:'} ${changed}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Business migration failed.');
  process.exitCode = 1;
});
