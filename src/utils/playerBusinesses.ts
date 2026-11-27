import { deleteField, doc, serverTimestamp, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import type { PlayerBusinessInfo } from '../types';

export async function savePlayerBusinesses(uid: string, businesses: PlayerBusinessInfo[]) {
  const batch = writeBatch(db);
  batch.set(doc(db, 'player_business_private', uid), {
    businesses: businesses.filter((entry) => !entry.allowPromotion),
    updatedAt: serverTimestamp(),
  });
  batch.update(doc(db, 'players', uid), {
    businesses: businesses.filter((entry) => entry.allowPromotion),
    business: deleteField(),
    updatedAt: serverTimestamp(),
  });
  await batch.commit();
}
