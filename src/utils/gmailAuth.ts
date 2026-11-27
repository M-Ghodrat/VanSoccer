import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, User } from 'firebase/auth';
import { auth } from '../firebase';

export const GMAIL_SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];
export const ALLOWED_GMAIL_SENDER = 'persepolisvfc@gmail.com';

export function extractEmailAddress(headerValue: string): string {
  const trimmed = headerValue.trim();
  if (!trimmed) return '';
  const angleMatches = trimmed.match(/<([^<>]+)>/g);
  if (angleMatches && angleMatches.length === 1) {
    return angleMatches[0].slice(1, -1).trim().toLowerCase();
  }
  if (angleMatches && angleMatches.length > 1) {
    return '';
  }
  const bareMatch = trimmed.match(/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/);
  return bareMatch ? bareMatch[0].toLowerCase() : '';
}

export function isAllowedGmailSender(fromHeader: string): boolean {
  return extractEmailAddress(fromHeader) === ALLOWED_GMAIL_SENDER.toLowerCase();
}

export function buildRestrictedGmailQuery(userQuery?: string): string {
  const senderClause = `from:${ALLOWED_GMAIL_SENDER}`;
  const trimmed = (userQuery || '').trim();
  return trimmed ? `${senderClause} (${trimmed})` : senderClause;
}

// Standard Google sign-in provider (only basic identity, no Gmail access)
export const standardGoogleProvider = new GoogleAuthProvider();

// Scoped provider specifically for admin/treasurer Gmail receipt scanning
export const gmailProvider = new GoogleAuthProvider();
for (const scope of GMAIL_SCOPES) {
  gmailProvider.addScope(scope);
}

// Strict in-memory token cache (never stored in localStorage or sessionStorage)
let cachedAccessToken: string | null = null;
let cachedGmailEmail: string | null = null;
let isSigningIn = false;

export type TokenListener = (token: string | null, email: string | null) => void;
const tokenListeners = new Set<TokenListener>();

function notifyTokenListeners() {
  for (const listener of tokenListeners) {
    listener(cachedAccessToken, cachedGmailEmail);
  }
}

// Automatically clear in-memory token whenever Firebase auth signs out
onAuthStateChanged(auth, (user) => {
  if (!user && !isSigningIn) {
    if (cachedAccessToken !== null || cachedGmailEmail !== null) {
      cachedAccessToken = null;
      cachedGmailEmail = null;
      notifyTokenListeners();
    }
  }
});

export function subscribeGmailToken(listener: TokenListener): () => void {
  tokenListeners.add(listener);
  listener(cachedAccessToken, cachedGmailEmail);
  return () => {
    tokenListeners.delete(listener);
  };
}

export function getGmailAccessToken(): string | null {
  return cachedAccessToken;
}

export function clearGmailAccessToken(): void {
  if (cachedAccessToken !== null || cachedGmailEmail !== null) {
    cachedAccessToken = null;
    cachedGmailEmail = null;
    notifyTokenListeners();
  }
}

export const clearCachedGmailToken = clearGmailAccessToken;

/**
 * Standard Google Sign-In for all club players & members.
 * Only requests default identity (email & profile) with ZERO Gmail permissions.
 */
export async function standardGoogleSignIn(): Promise<User> {
  const result = await signInWithPopup(auth, standardGoogleProvider);
  return result.user;
}

/**
 * Admin/Treasurer Gmail Connect for Interac e-transfer receipt reconciliation.
 * Explicitly requests read-only access to payment receipts from persepolisvfc@gmail.com.
 */
export async function googleSignInWithGmail(): Promise<{
  user: User;
  accessToken: string;
  email: string | null;
}> {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, gmailProvider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Could not obtain a Gmail access token. Please try signing in with Google again.');
    }
    cachedAccessToken = credential.accessToken;
    cachedGmailEmail = result.user.email || null;
    notifyTokenListeners();
    return {
      user: result.user,
      accessToken: cachedAccessToken,
      email: cachedGmailEmail,
    };
  } finally {
    isSigningIn = false;
  }
}

export async function connectGmailReadOnly(): Promise<{
  accessToken: string;
  email: string | null;
}> {
  const { accessToken, email } = await googleSignInWithGmail();
  return { accessToken, email };
}

export class GmailAuthExpiredError extends Error {
  constructor(message = 'Your Gmail session expired. Please sign in with Google again.') {
    super(message);
    this.name = 'GmailAuthExpiredError';
  }
}

export interface GmailProfileInfo {
  emailAddress: string;
  messagesTotal: number;
  threadsTotal: number;
}

export interface GmailMessageSummary {
  id: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  internalDateMs: number;
  snippet: string;
  isUnread: boolean;
  isStarred: boolean;
  labelIds: string[];
}

export interface GmailAttachmentMeta {
  filename: string;
  mimeType: string;
  size: number;
}

export interface GmailMessageDetail extends GmailMessageSummary {
  plainBody: string;
  htmlBody: string;
  attachments: GmailAttachmentMeta[];
}

interface GmailHeader {
  name?: string;
  value?: string;
}

interface GmailPayloadPart {
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: {
    data?: string;
    size?: number;
    attachmentId?: string;
  };
  parts?: GmailPayloadPart[];
}

interface GmailApiMessageResponse {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GmailPayloadPart;
}

const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

async function gmailFetch<T>(accessToken: string, path: string): Promise<T> {
  const res = await fetch(`${GMAIL_API_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (res.status === 401) {
    clearGmailAccessToken();
    throw new GmailAuthExpiredError();
  }

  if (!res.ok) {
    let detail = `Gmail request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error?.message) {
        detail = body.error.message;
      }
    } catch {
      // Ignore JSON parse errors on error payload
    }
    throw new Error(detail);
  }

  return res.json() as Promise<T>;
}

function getHeaderValue(headers: GmailHeader[] | undefined, name: string): string {
  if (!headers) return '';
  const target = name.toLowerCase();
  const found = headers.find((h) => h.name?.toLowerCase() === target);
  return found?.value || '';
}

function decodeBase64UrlUtf8(data?: string): string {
  if (!data) return '';
  try {
    const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
    const padLength = (4 - (base64.length % 4)) % 4;
    const padded = base64 + '='.repeat(padLength);
    const binaryStr = atob(padded);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  } catch {
    return '';
  }
}

function extractBodyAndAttachments(payload?: GmailPayloadPart): {
  plainBody: string;
  htmlBody: string;
  attachments: GmailAttachmentMeta[];
} {
  let plainBody = '';
  let htmlBody = '';
  const attachments: GmailAttachmentMeta[] = [];

  const walk = (part?: GmailPayloadPart) => {
    if (!part) return;
    const mime = (part.mimeType || '').toLowerCase();

    if (part.filename && part.filename.trim().length > 0) {
      attachments.push({
        filename: part.filename,
        mimeType: part.mimeType || 'application/octet-stream',
        size: part.body?.size || 0,
      });
    }

    if (mime === 'text/plain' && part.body?.data && !plainBody) {
      plainBody = decodeBase64UrlUtf8(part.body.data);
    } else if (mime === 'text/html' && part.body?.data && !htmlBody) {
      htmlBody = decodeBase64UrlUtf8(part.body.data);
    }

    if (Array.isArray(part.parts)) {
      for (const child of part.parts) {
        walk(child);
      }
    }
  };

  walk(payload);

  // Fallback for single-part messages without explicit text/* mimeType
  if (!plainBody && !htmlBody && payload?.body?.data) {
    plainBody = decodeBase64UrlUtf8(payload.body.data);
  }

  return { plainBody, htmlBody, attachments };
}

function toSummary(raw: GmailApiMessageResponse): GmailMessageSummary {
  const headers = raw.payload?.headers;
  const labelIds = Array.isArray(raw.labelIds) ? raw.labelIds : [];
  const internalDateMs = Number(raw.internalDate) || 0;
  return {
    id: raw.id,
    threadId: raw.threadId,
    from: getHeaderValue(headers, 'From') || 'Unknown sender',
    to: getHeaderValue(headers, 'To'),
    subject: getHeaderValue(headers, 'Subject') || '(No subject)',
    date: getHeaderValue(headers, 'Date'),
    internalDateMs,
    snippet: raw.snippet || '',
    isUnread: labelIds.includes('UNREAD'),
    isStarred: labelIds.includes('STARRED'),
    labelIds,
  };
}

export async function fetchGmailProfile(accessToken: string): Promise<GmailProfileInfo> {
  return gmailFetch<GmailProfileInfo>(accessToken, '/profile');
}

export async function fetchGmailMessages(
  accessToken: string,
  options: {
    q?: string;
    labelIds?: string[];
    maxResults?: number;
    pageToken?: string;
  } = {}
): Promise<{
  messages: GmailMessageSummary[];
  nextPageToken: string | null;
}> {
  const params = new URLSearchParams();
  params.set('maxResults', String(options.maxResults ?? 20));
  params.set('q', buildRestrictedGmailQuery(options.q));
  if (options.pageToken) {
    params.set('pageToken', options.pageToken);
  }
  if (options.labelIds && options.labelIds.length > 0) {
    for (const labelId of options.labelIds) {
      params.append('labelIds', labelId);
    }
  }

  const listData = await gmailFetch<{
    messages?: Array<{ id: string; threadId: string }>;
    nextPageToken?: string;
  }>(accessToken, `/messages?${params.toString()}`);

  const ids = listData.messages || [];
  if (ids.length === 0) {
    return { messages: [], nextPageToken: null };
  }

  const metadataParams =
    'format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date';

  const details = await Promise.all(
    ids.map((item) =>
      gmailFetch<GmailApiMessageResponse>(
        accessToken,
        `/messages/${encodeURIComponent(item.id)}?${metadataParams}`
      )
    )
  );

  const filteredMessages = details
    .map(toSummary)
    .filter((msg) => isAllowedGmailSender(msg.from));

  return {
    messages: filteredMessages,
    nextPageToken: listData.nextPageToken || null,
  };
}

export async function fetchGmailMessageDetail(
  accessToken: string,
  messageId: string
): Promise<GmailMessageDetail> {
  const raw = await gmailFetch<GmailApiMessageResponse>(
    accessToken,
    `/messages/${encodeURIComponent(messageId)}?format=full`
  );
  const summary = toSummary(raw);
  if (!isAllowedGmailSender(summary.from)) {
    throw new Error(`Only emails from ${ALLOWED_GMAIL_SENDER} can be read in this app.`);
  }
  const { plainBody, htmlBody, attachments } = extractBodyAndAttachments(raw.payload);
  return {
    ...summary,
    plainBody,
    htmlBody,
    attachments,
  };
}

export async function fetchGmailFullMessagesPage(
  accessToken: string,
  options: {
    q?: string;
    labelIds?: string[];
    maxResults?: number;
    pageToken?: string;
  } = {}
): Promise<{
  messages: GmailMessageDetail[];
  nextPageToken: string | null;
}> {
  const params = new URLSearchParams();
  params.set('maxResults', String(options.maxResults ?? 25));
  params.set('q', buildRestrictedGmailQuery(options.q));
  if (options.pageToken) {
    params.set('pageToken', options.pageToken);
  }
  if (options.labelIds && options.labelIds.length > 0) {
    for (const labelId of options.labelIds) {
      params.append('labelIds', labelId);
    }
  }

  const listData = await gmailFetch<{
    messages?: Array<{ id: string; threadId: string }>;
    nextPageToken?: string;
  }>(accessToken, `/messages?${params.toString()}`);

  const ids = listData.messages || [];
  if (ids.length === 0) {
    return { messages: [], nextPageToken: null };
  }

  const results: GmailMessageDetail[] = [];
  const chunkSize = 8;

  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const fullItems = await Promise.all(
      chunk.map((item) =>
        gmailFetch<GmailApiMessageResponse>(
          accessToken,
          `/messages/${encodeURIComponent(item.id)}?format=full`
        )
      )
    );

    for (const raw of fullItems) {
      const summary = toSummary(raw);
      if (!isAllowedGmailSender(summary.from)) {
        continue;
      }
      const { plainBody, htmlBody, attachments } = extractBodyAndAttachments(raw.payload);
      results.push({
        ...summary,
        plainBody,
        htmlBody,
        attachments,
      });
    }
  }

  results.sort((a, b) => b.internalDateMs - a.internalDateMs);

  return {
    messages: results,
    nextPageToken: listData.nextPageToken || null,
  };
}
