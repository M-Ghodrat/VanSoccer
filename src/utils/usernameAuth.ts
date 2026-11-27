import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '../firebase';

export interface UsernameDoc {
  username: string;
  email: string;
  uid: string;
  createdAt?: unknown;
}

/**
 * Validates username string constraints:
 * - 3 to 24 characters
 * - Alphanumeric, underscores, hyphens, and periods
 * - Cannot start or end with a period/hyphen
 */
export function validateUsername(username: string): { valid: boolean; error?: string } {
  const trimmed = username.trim();
  if (trimmed.length < 3) {
    return { valid: false, error: 'Username must be at least 3 characters.' };
  }
  if (trimmed.length > 24) {
    return { valid: false, error: 'Username cannot exceed 24 characters.' };
  }
  if (!/^[a-zA-Z0-9_.-]+$/.test(trimmed)) {
    return {
      valid: false,
      error: 'Username can only contain letters, numbers, underscores, hyphens, and dots.',
    };
  }
  if (/^[.-]|[.-]$/.test(trimmed)) {
    return { valid: false, error: 'Username cannot start or end with a dot or hyphen.' };
  }
  return { valid: true };
}

export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

/**
 * Looks up the registered email for a given username.
 * Supports signing in with either a username or an email address.
 */
export async function lookupEmailByUsername(rawUsername: string): Promise<string | null> {
  const normalized = normalizeUsername(rawUsername);
  if (!normalized) return null;

  try {
    const snap = await getDoc(doc(db, 'usernames', normalized));
    if (snap.exists()) {
      const data = snap.data() as UsernameDoc;
      if (data?.email) {
        return data.email.toLowerCase().trim();
      }
    }
  } catch (err) {
    console.warn('Direct Firestore username lookup notice:', err);
  }

  // Fallback to server proxy if available
  try {
    const res = await fetch('/api/auth/lookup-username', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: normalized }),
    });
    if (res.ok) {
      const data = (await res.json()) as { email?: string };
      if (data?.email) {
        return data.email.toLowerCase().trim();
      }
    }
  } catch {
    // Ignore fallback network error
  }

  return null;
}

/**
 * Checks if a username is available to be claimed by a user.
 */
export async function isUsernameAvailable(
  rawUsername: string,
  currentUid?: string
): Promise<boolean> {
  const normalized = normalizeUsername(rawUsername);
  if (!normalized) return false;

  try {
    const snap = await getDoc(doc(db, 'usernames', normalized));
    if (!snap.exists()) return true;
    const data = snap.data() as UsernameDoc;
    return Boolean(currentUid && data?.uid === currentUid);
  } catch {
    return false;
  }
}

/**
 * Claims a username document in the `usernames` collection.
 */
export async function claimUsername(
  rawUsername: string,
  email: string,
  uid: string
): Promise<void> {
  const normalized = normalizeUsername(rawUsername);
  if (!normalized) return;

  await setDoc(doc(db, 'usernames', normalized), {
    username: rawUsername.trim(),
    email: email.trim().toLowerCase(),
    uid,
    createdAt: serverTimestamp(),
  });
}
