import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import config from '../firebase-applet-config.json';
import { ApiHttpError } from './formationAnalyzer';

export function clubApp() {
  const existing = getApps()[0];
  if (existing) return existing;
  const credentials = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!credentials) throw new ApiHttpError(503, 'Club backend is unavailable.');
  return initializeApp({ credential: cert(JSON.parse(credentials)), projectId: config.projectId });
}

export function clubDb() {
  return getFirestore(clubApp(), config.firestoreDatabaseId);
}

export async function requireClubIdentity(header: string | null | undefined) {
  if (!header?.startsWith('Bearer ') || header.length > 8200) {
    throw new ApiHttpError(401, 'Please sign in.');
  }
  const auth = getAuth(clubApp());
  const identity = await auth.verifyIdToken(header.slice(7), true).catch(() => {
    throw new ApiHttpError(401, 'Please sign in again.');
  });
  if (!identity.email_verified) throw new ApiHttpError(403, 'Verify your email first.');
  return identity;
}

export async function requireFormationManager(header: string | null | undefined) {
  const identity = await requireClubIdentity(header);
  const db = clubDb();
  const [admin, manager] = await db.getAll(
    db.doc(`admins/${identity.uid}`), db.doc(`managers/${identity.uid}`)
  );
  if (!admin.exists && !manager.exists) throw new ApiHttpError(403, 'Manager access required.');

  const limitRef = db.doc(`formation_limits/${identity.uid}`);
  await db.runTransaction(async (transaction) => {
    const previous = await transaction.get(limitRef);
    const now = Date.now();
    const windowStart = Math.floor(now / 3_600_000) * 3_600_000;
    const count = previous.get('windowStart') === windowStart ? Number(previous.get('count')) : 0;
    if (count >= 10) throw new ApiHttpError(429, 'Formation limit reached. Try again next hour.');
    transaction.set(limitRef, { windowStart, count: count + 1 });
  });
}
