import { PaymentSenderAlias, PlayerPrivateInfo, PlayerProfile } from '../types';
import { getMonthKey } from './clubUtils';
import {
  ALLOWED_GMAIL_SENDER,
  buildRestrictedGmailQuery,
  GmailMessageDetail,
  isAllowedGmailSender,
} from './gmailAuth';

export class GmailAuthExpiredError extends Error {
  constructor(message = 'Your Gmail session expired. Please reconnect Gmail to scan receipts.') {
    super(message);
    this.name = 'GmailAuthExpiredError';
  }
}

export interface ParsedPaymentReceipt {
  messageId: string;
  receivedIso: string;
  subject: string;
  fromHeader: string;
  replyToHeader: string;
  senderName: string;
  senderEmail: string;
  senderKey: string;
  senderLabel: string;
  amount: number | null;
  currency: string;
  referenceCode: string;
  memo: string;
  suggestedMonthKeys: string[];
  snippet: string;
}

export type ReceiptMatchConfidence = 'high' | 'medium' | 'none';

export interface ReceiptPlayerMatch {
  uid: string;
  confidence: ReceiptMatchConfidence;
  reason: string;
}

interface GmailMessagePart {
  mimeType?: string;
  body?: { data?: string; size?: number };
  parts?: GmailMessagePart[];
}

interface GmailMessageFull {
  id: string;
  internalDate?: string;
  snippet?: string;
  payload?: {
    headers?: Array<{ name: string; value: string }>;
    mimeType?: string;
    body?: { data?: string };
    parts?: GmailMessagePart[];
  };
}

const BANK_OR_GATEWAY_DOMAINS = [
  'payments.interac.ca',
  'interac.ca',
  'rbc.com',
  'td.com',
  'scotiabank.com',
  'bmo.com',
  'cibc.com',
  'tangerine.ca',
  'simplii.com',
  'eqbank.ca',
  'wealthsimple.com',
  'coastcapitalsavings.com',
  'vancity.com',
  'desjardins.com',
  'paypal.com',
  'paypal.ca',
  'wise.com',
  'transferwise.com',
  'stripe.com',
  'squareup.com',
  'venmo.com',
  'zellepay.com',
];

const MONTH_NAME_MAP: Record<string, number> = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sept: 9,
  sep: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
};

function decodeBase64Url(input: string): string {
  try {
    const base64 = input.replace(/-/g, '+').replace(/_/g, '/');
    const pad = base64.length % 4 === 0 ? '' : '='.repeat(4 - (base64.length % 4));
    const binary = atob(base64 + pad);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  } catch {
    return '';
  }
}

export function stripHtmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6]|td|th)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&#x27;/gi, "'")
    .replace(/&#36;|&#x24;/gi, '$')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function stripHtml(html: string): string {
  return stripHtmlToText(html);
}

function extractBodyText(payload?: GmailMessageFull['payload']): string {
  if (!payload) return '';

  const plainParts: string[] = [];
  const htmlParts: string[] = [];

  const walk = (part: GmailMessagePart) => {
    if (part.parts && part.parts.length > 0) {
      for (const child of part.parts) {
        walk(child);
      }
      return;
    }
    const mime = (part.mimeType || '').toLowerCase();
    const rawData = part.body?.data;
    if (!rawData) return;
    if (mime === 'text/plain') {
      plainParts.push(decodeBase64Url(rawData));
    } else if (mime === 'text/html') {
      htmlParts.push(decodeBase64Url(rawData));
    }
  };

  walk(payload);

  if (plainParts.length > 0) {
    return plainParts.join('\n').trim();
  }
  if (htmlParts.length > 0) {
    return stripHtml(htmlParts.join('\n'));
  }
  return '';
}

function parseAddressHeader(header: string): { name: string; email: string } {
  const trimmed = header.trim();
  if (!trimmed) return { name: '', email: '' };

  const angleMatch = trimmed.match(/^(.*?)\s*<([^<>\s]+@[^<>\s]+)>/);
  if (angleMatch) {
    const rawName = angleMatch[1].replace(/^["']|["']$/g, '').trim();
    const email = angleMatch[2].trim().toLowerCase();
    return { name: rawName, email };
  }

  const emailOnly = trimmed.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
  if (emailOnly) {
    return { name: '', email: emailOnly[1].toLowerCase() };
  }

  return { name: trimmed.replace(/^["']|["']$/g, '').trim(), email: '' };
}

function isGatewayEmail(email: string): boolean {
  const lower = email.toLowerCase();
  if (!lower) return true;
  if (lower === ALLOWED_GMAIL_SENDER.toLowerCase()) {
    return true;
  }
  if (
    lower.includes('noreply') ||
    lower.includes('no-reply') ||
    lower.includes('donotreply') ||
    lower.includes('notify@') ||
    lower.includes('catch@') ||
    lower.includes('alerts@')
  ) {
    return true;
  }
  return BANK_OR_GATEWAY_DOMAINS.some((domain) => lower.endsWith(`@${domain}`) || lower.includes(`.${domain}`));
}

function formatDisplayName(name: string): string {
  const lettersOnly = name.replace(/[^A-Za-zÀ-ÖØ-öø-ÿ]/g, '');
  if (lettersOnly.length >= 2 && lettersOnly === lettersOnly.toUpperCase()) {
    return name
      .toLowerCase()
      .replace(/(^|[\s'-])([a-zà-öø-ÿ])/g, (_, sep: string, ch: string) => sep + ch.toUpperCase());
  }
  return name;
}

function cleanExtractedName(raw: string): string {
  const cleaned = raw
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(
      /\s+(?:and\s+it\s+has\s+been|has\s+been|has\s+sent|sent\s+you|via\s+interac|into\s+your|for\s+[\$\d].*).*$/i,
      ''
    )
    .replace(/^["'`\s:–—-]+|["'`\s:.,;–—-]+$/g, '')
    .trim();

  if (!cleaned || cleaned.length < 2 || cleaned.length > 72) return '';
  if (cleaned.includes('@') || /https?:\/\//i.test(cleaned) || /^\d/.test(cleaned)) {
    return '';
  }

  const lower = cleaned.toLowerCase();
  if (
    /^(interac|interac\s+e-?transfer|e-?transfer|etransfer|rbc|rbc\s+royal\s+bank|royal\s+bank|td|td\s+canada\s+trust|td\s+bank|bmo|bmo\s+bank\s+of\s+montreal|cibc|scotiabank|tangerine|simplii|simplii\s+financial|eq\s+bank|wealthsimple|vancity|coast\s+capital|desjardins|paypal|wise|stripe|square|autodeposit|payment|payments|receipt|you|your|customer|member|client|admin|noreply|no-reply|notify|alerts?|forwarded\s+message|money|funds|deposit|transfer|account|notification|bank|perspolis|perspolis\s+vfc|perspolis\s+vfc\s+society|persepolis|persepolis\s+vfc|persepolis\s+vfc\s+society|vanfootball|soccer)$/i.test(
      lower
    )
  ) {
    return '';
  }
  if (
    lower.includes('interac') ||
    lower.includes('e-transfer') ||
    lower.includes('etransfer') ||
    lower.includes('persepolis') ||
    lower.includes('perspolis') ||
    lower.includes('forwarded message') ||
    lower.includes('autodeposit')
  ) {
    return '';
  }

  return formatDisplayName(cleaned);
}

export function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeSenderKey(senderName: string, senderEmail: string): string {
  const email = senderEmail.trim().toLowerCase();
  if (email && !isGatewayEmail(email)) {
    return `email:${email}`.slice(0, 160);
  }
  const normName = normalizeText(senderName);
  if (normName.length >= 2) {
    return `name:${normName}`.slice(0, 160);
  }
  return '';
}

export function makeAliasDocId(senderKey: string): string {
  // Deterministic, Firestore-safe ID matching ^[a-zA-Z0-9_-]+$
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < senderKey.length; i++) {
    const c = senderKey.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (c + i), 0x85ebca6b) >>> 0;
  }
  const slug = senderKey
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 42);
  return `alias_${slug}_${h1.toString(36)}${h2.toString(36)}`.slice(0, 120);
}

function addMonthsToMonthKey(monthKey: string, offset: number): string {
  const [yrStr, moStr] = monthKey.split('-');
  const yr = Number(yrStr);
  const mo = Number(moStr);
  if (!yr || !mo) return getMonthKey();
  const d = new Date(yr, mo - 1 + offset, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function detectMonthKeysFromReceipt(
  receivedIso: string,
  subject: string,
  memo: string,
  amount: number | null,
  monthlyFee: number
): string[] {
  const baseDate = new Date(receivedIso);
  const safeBaseDate = Number.isNaN(baseDate.getTime()) ? new Date() : baseDate;
  const baseMonthKey = getMonthKey(safeBaseDate);
  const baseYear = safeBaseDate.getFullYear();
  const baseMonth = safeBaseDate.getMonth() + 1;

  const textToScan = `${memo} ${subject}`.toLowerCase();
  const explicitMonths = new Set<string>();

  // Match explicit YYYY-MM patterns
  for (const m of textToScan.matchAll(/\b(20\d{2})-(0[1-9]|1[0-2])\b/g)) {
    explicitMonths.add(`${m[1]}-${m[2]}`);
  }

  // Match explicit month names (e.g., "May", "June 2026", "Nov & Dec") inside memo
  if (memo) {
    const memoLower = memo.toLowerCase();
    for (const [token, monthNum] of Object.entries(MONTH_NAME_MAP)) {
      const re = new RegExp(`\\b${token}(?:\\s+(20\\d{2}))?\\b`, 'i');
      const match = memoLower.match(re);
      if (match) {
        let yr = match[1] ? Number(match[1]) : baseYear;
        // Handle Dec->Jan year rollover if no explicit year
        if (!match[1]) {
          if (baseMonth >= 11 && monthNum <= 2) yr = baseYear + 1;
          else if (baseMonth <= 2 && monthNum >= 11) yr = baseYear - 1;
        }
        explicitMonths.add(`${yr}-${String(monthNum).padStart(2, '0')}`);
      }
    }
  }

  if (explicitMonths.size > 0) {
    return Array.from(explicitMonths).sort().slice(0, 6);
  }

  // Infer multi-month payments when amount is a clean multiple of the monthly fee (e.g. $40 = 2 months)
  if (
    amount !== null &&
    monthlyFee > 0 &&
    amount >= monthlyFee &&
    amount <= monthlyFee * 6 &&
    Math.abs(amount % monthlyFee) < 0.01
  ) {
    const count = Math.max(1, Math.min(6, Math.round(amount / monthlyFee)));
    return Array.from({ length: count }, (_, idx) => addMonthsToMonthKey(baseMonthKey, idx));
  }

  return [baseMonthKey];
}

function isLikelyOutboundOrNonDeposit(subject: string, body: string): boolean {
  const s = subject.toLowerCase();
  const head = body.slice(0, 700).toLowerCase();
  const combined = `${s}\n${head}`;

  const inboundSignals = [
    'sent you',
    'you received',
    "you've received",
    'has been automatically deposited',
    'automatically deposited into your account',
    'deposited into your account',
    'payment received',
    'money received',
    'sent you an interac',
    'funds have been deposited',
  ];
  if (inboundSignals.some((sig) => combined.includes(sig))) {
    return false;
  }

  const outboundSignals = [
    'you sent ',
    'you have sent',
    'your interac e-transfer to ',
    'your transfer to ',
    'requested money',
    'money request',
    'was cancelled',
    'has expired',
    'was declined',
    'reminder:',
  ];
  return outboundSignals.some((sig) => combined.includes(sig));
}

function stripSubjectPrefixes(subject: string): string {
  return subject.replace(/^(?:(?:fwd?|re)\s*:\s*)+/i, '').trim();
}

function extractAmountFromText(combined: string): { amount: number | null; currency: string } {
  let amount: number | null = null;
  let currency = 'CAD';
  const amountPatterns = [
    /(?:amount|total|sum|deposit(?:ed)?|transfer(?:red)?|payment)\s*[:\-]?\s*(?:\r?\n\s*)?(?:CA\$|CAD\s*\$?|US\$|USD\s*\$?|\$)\s*(\d{1,5}(?:,\d{3})*(?:\.\d{1,2})?)/i,
    /(?:sent you|received|deposited|payment of|paid(?:\s+you)?|transferred|for)\s+(?:an?\s+interac\s+e-?transfer\s+of\s+)?(?:CA\$|CAD\s*\$?|US\$|USD\s*\$?|\$)\s*(\d{1,5}(?:,\d{3})*(?:\.\d{1,2})?)/i,
    /(?:CA\$|CAD\s*\$?|US\$|USD\s*\$?|\$)\s*(\d{1,5}(?:,\d{3})*\.\d{2})\b/,
    /(?:CA\$|CAD\s*\$?|US\$|USD\s*\$?|\$)\s*(\d{1,5}(?:,\d{3})*(?:\.\d{1,2})?)\b/,
    /\b(\d{1,5}(?:,\d{3})*(?:\.\d{1,2})?)\s*(?:\$|CAD|USD|dollars?)\b/i,
  ];
  for (const pat of amountPatterns) {
    const m = combined.match(pat);
    if (m && m[1]) {
      const parsed = Number(m[1].replace(/,/g, ''));
      if (Number.isFinite(parsed) && parsed > 0 && parsed <= 10000) {
        amount = Math.round(parsed * 100) / 100;
        if (/USD|US\$/i.test(m[0])) currency = 'USD';
        break;
      }
    }
  }
  return { amount, currency };
}

function extractPayerDetailsFromContent(
  rawSubject: string,
  bodyText: string,
  fromHeader: string,
  replyToHeader: string
): {
  senderName: string;
  senderEmail: string;
  referenceCode: string;
  memo: string;
} {
  const cleanSubject = stripSubjectPrefixes(rawSubject);
  const parsedFrom = parseAddressHeader(fromHeader);
  const parsedReplyTo = parseAddressHeader(replyToHeader);

  // Extract sender email (skip bank gateways and the club forwarding address)
  let senderEmail = '';
  if (parsedReplyTo.email && !isGatewayEmail(parsedReplyTo.email)) {
    senderEmail = parsedReplyTo.email;
  } else if (parsedFrom.email && !isGatewayEmail(parsedFrom.email)) {
    senderEmail = parsedFrom.email;
  } else {
    const emailMatches = bodyText.matchAll(
      /(?:sent\s+from|from|sender|email|reply\s*to|payer)\s*[:\-]?\s*(?:[^\n@]{0,60}<)?([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi
    );
    for (const m of emailMatches) {
      if (m[1] && !isGatewayEmail(m[1])) {
        senderEmail = m[1].toLowerCase();
        break;
      }
    }
  }

  // Extract sender/payer name using matchAll so forwarded headers (e.g. "From: Interac e-Transfer")
  // are skipped cleanly in favor of the actual payer name in subject or body.
  let senderName = '';
  const namePatterns: Array<{ source: string; regex: RegExp }> = [
    // Subject: "INTERAC e-Transfer: ALI REZAEI sent you money."
    {
      source: cleanSubject,
      regex: /(?:interac\s+e-?transfer|e-?transfer)\s*[:\-]\s*(.+?)\s+(?:has\s+)?sent\s+you/gi,
    },
    // Subject: "You've received $20.00 from Ali Rezaei" / "Payment from Ali Rezaei"
    {
      source: cleanSubject,
      regex:
        /(?:received\s+(?:an?\s+[\w\s-]{0,30}?)?(?:of\s+)?(?:[\$CADUS\d.,\s]+)?from|payment\s+from|e-?transfer\s+from|transfer\s+from|deposit\s+from|from)\s+([A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ\s.'-]{1,60}?)(?=\s+(?:and\s+it|has\s+been|for\b|via\b|on\b|with\b|\$|\(|-)|$)/gi,
    },
    // Subject: "Ali Rezaei sent you $20" / "Ali Rezaei paid $20"
    {
      source: cleanSubject,
      regex:
        /^([A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ.'-]+(?:\s+[A-Za-zÀ-ÖØ-öø-ÿ.'-]+){0,3})\s+(?:has\s+)?(?:sent\s+you|paid|transferred)/gi,
    },
    // Body: "ALI REZAEI has sent you $20.00" or "Ali Rezaei sent you money"
    {
      source: bodyText,
      regex:
        /(?:^|\n|[.,!]\s+)([A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ.'-]+(?:\s+[A-Za-zÀ-ÖØ-öø-ÿ.'-]+){0,4})\s+(?:has\s+)?(?:sent\s+you|paid\s+you|transferred\s+you)\s+(?:an?\s+INTERAC|money|funds|\$|CA\$|CAD|US\$|USD|\d)/gim,
    },
    // Body: "You have received $20.00 from Ali Rezaei"
    {
      source: bodyText,
      regex:
        /(?:you(?:'ve|\s+have)?\s+received|received|deposited)\s+(?:an?\s+interac\s+e-?transfer\s+(?:of\s+)?)?(?:(?:CA\$|CAD|US\$|USD|\$)\s*[\d.,]+\s*(?:\(?(?:CAD|USD)\)?)?\s+)?from\s+([A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ.'-]+(?:\s+[A-Za-zÀ-ÖØ-öø-ÿ.'-]+){0,4}?)(?=\s*(?:\.|,|!|\n|and\s+it|has\s+been|into\s+your|via\b|for\b|\()|$)/gim,
    },
    // Body labeled rows (supports inline "Sent From: Ali" and table-style "Sent From:\nAli")
    {
      source: bodyText,
      regex:
        /(?:^|\n)\s*(?:sent\s+from|sender\s+name|sender|payer|paid\s+by|received\s+from|transferred\s+by|from)\s*[:\-]\s*(?:\r?\n\s*)?([^\n<()]{2,64})/gim,
    },
    // Body: "Message from Ali Rezaei:"
    {
      source: bodyText,
      regex: /message\s+from\s+([^\n:]{2,64})\s*:/gim,
    },
    // Body: "Name: Ali Rezaei"
    {
      source: bodyText,
      regex: /(?:^|\n)\s*name\s*[:\-]\s*(?:\r?\n\s*)?([^\n<()]{2,64})/gim,
    },
  ];

  for (const { source, regex } of namePatterns) {
    if (!source) continue;
    for (const m of source.matchAll(regex)) {
      if (m[1]) {
        const candidate = cleanExtractedName(m[1]);
        if (candidate) {
          senderName = candidate;
          break;
        }
      }
    }
    if (senderName) break;
  }

  if (!senderName && parsedReplyTo.name) {
    senderName = cleanExtractedName(parsedReplyTo.name);
  }
  if (!senderName && parsedFrom.name && !isGatewayEmail(parsedFrom.email)) {
    senderName = cleanExtractedName(parsedFrom.name);
  }

  // Extract reference/confirmation code
  const refMatch = bodyText.match(
    /(?:reference\s*(?:number|#|no\.?)|confirmation\s*(?:number|#|no\.?))\s*[:\-]?\s*(?:\r?\n\s*)?([A-Za-z0-9\-]{5,32})/i
  );
  const referenceCode = refMatch ? refMatch[1].trim() : '';

  // Extract sender memo / message
  let memo = '';
  const memoMatch = bodyText.match(
    /(?:message(?:\s+from\s+[^\n:]{1,40})?|memo|note)\s*[:\-]\s*([^\n]{2,140})/i
  );
  if (memoMatch && memoMatch[1]) {
    memo = memoMatch[1].trim().replace(/\s+/g, ' ').slice(0, 140);
  }

  return { senderName, senderEmail, referenceCode, memo };
}

export interface ExtractedEmailPayment {
  messageId: string;
  receivedIso: string;
  internalDateMs: number;
  subject: string;
  fromHeader: string;
  senderName: string;
  senderEmail: string;
  senderKey: string;
  senderLabel: string;
  amount: number | null;
  currency: string;
  referenceCode: string;
  memo: string;
  suggestedMonthKeys: string[];
  isPayment: boolean;
  email: GmailMessageDetail;
}

export function extractPaymentFromGmailDetail(
  detail: GmailMessageDetail,
  monthlyFee = 20
): ExtractedEmailPayment {
  const receivedMs = detail.internalDateMs || Date.parse(detail.date);
  const receivedIso = Number.isFinite(receivedMs)
    ? new Date(receivedMs).toISOString()
    : new Date().toISOString();

  const htmlAsText = detail.htmlBody ? stripHtmlToText(detail.htmlBody) : '';
  const plainTrimmed = detail.plainBody.trim();
  const bodyText =
    plainTrimmed.length >= 25
      ? plainTrimmed
      : htmlAsText || plainTrimmed || detail.snippet || '';

  const combined = `${detail.subject}\n${bodyText}\n${detail.snippet}`;
  const { amount, currency } = extractAmountFromText(combined);
  const { senderName, senderEmail, referenceCode, memo } = extractPayerDetailsFromContent(
    detail.subject,
    bodyText,
    detail.from,
    ''
  );

  const outbound = isLikelyOutboundOrNonDeposit(detail.subject, bodyText);
  const hasPaymentKeywords =
    /interac|e-?transfer|autodeposit|payment|deposited|sent you|paid|received\s+\$/i.test(combined);
  const isPayment = !outbound && (amount !== null || (hasPaymentKeywords && Boolean(senderName)));

  const senderKey = normalizeSenderKey(senderName, senderEmail);
  const senderLabel =
    senderName && senderEmail
      ? `${senderName} (${senderEmail})`
      : senderName || senderEmail || 'Sender not detected';

  const suggestedMonthKeys = detectMonthKeysFromReceipt(
    receivedIso,
    detail.subject,
    memo,
    amount,
    monthlyFee
  );

  return {
    messageId: detail.id,
    receivedIso,
    internalDateMs: detail.internalDateMs || (Number.isFinite(receivedMs) ? receivedMs : 0),
    subject: detail.subject || '(No subject)',
    fromHeader: detail.from,
    senderName,
    senderEmail,
    senderKey,
    senderLabel: senderLabel.slice(0, 160),
    amount,
    currency,
    referenceCode,
    memo,
    suggestedMonthKeys,
    isPayment,
    email: detail,
  };
}

export function parsePaymentReceiptEmail(
  msg: GmailMessageFull,
  monthlyFee = 20
): ParsedPaymentReceipt | null {
  const headers = msg.payload?.headers || [];
  const getHeader = (name: string) =>
    headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || '';

  const subject = getHeader('Subject').trim();
  const fromHeader = getHeader('From').trim();
  const replyToHeader = getHeader('Reply-To').trim();
  const dateHeader = getHeader('Date').trim();

  // Strictly only parse emails sent by the allowed club sender
  if (!isAllowedGmailSender(fromHeader)) {
    return null;
  }

  const receivedMs = msg.internalDate ? Number(msg.internalDate) : Date.parse(dateHeader);
  const receivedIso = Number.isFinite(receivedMs)
    ? new Date(receivedMs).toISOString()
    : new Date().toISOString();

  const bodyText = extractBodyText(msg.payload) || msg.snippet || '';
  const combined = `${subject}\n${bodyText}`;

  // Filter out non-incoming / outbound transfers
  if (isLikelyOutboundOrNonDeposit(subject, bodyText)) {
    return null;
  }

  const { amount, currency } = extractAmountFromText(combined);

  // Require either a parsed dollar amount or strong e-transfer/payment keywords
  const looksLikePayment =
    amount !== null ||
    /interac|e-transfer|etransfer|autodeposit|payment received|sent you money/i.test(combined);
  if (!looksLikePayment) {
    return null;
  }

  const parsedFrom = parseAddressHeader(fromHeader);
  const { senderName, senderEmail, referenceCode, memo } = extractPayerDetailsFromContent(
    subject,
    bodyText,
    fromHeader,
    replyToHeader
  );

  const senderKey = normalizeSenderKey(senderName, senderEmail);
  const senderLabel = senderName && senderEmail
    ? `${senderName} (${senderEmail})`
    : senderName || senderEmail || parsedFrom.name || parsedFrom.email || 'Unknown Sender';

  const suggestedMonthKeys = detectMonthKeysFromReceipt(
    receivedIso,
    subject,
    memo,
    amount,
    monthlyFee
  );

  return {
    messageId: msg.id,
    receivedIso,
    subject: subject || '(No subject)',
    fromHeader,
    replyToHeader,
    senderName,
    senderEmail,
    senderKey,
    senderLabel: senderLabel.slice(0, 160),
    amount,
    currency,
    referenceCode,
    memo,
    suggestedMonthKeys,
    snippet: (msg.snippet || '').trim().slice(0, 180),
  };
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp: number[] = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + cost);
      prev = temp;
    }
  }
  return dp[n];
}

function stringSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

export function matchReceiptToPlayer(
  receipt: ParsedPaymentReceipt,
  players: PlayerProfile[],
  privateInfos: PlayerPrivateInfo[],
  aliases: PaymentSenderAlias[]
): ReceiptPlayerMatch {
  const playerById = new Map(players.map((p) => [p.uid, p]));

  // 1. Saved sender alias (exact match on normalized senderKey or email/name variants)
  const candidateKeys = new Set<string>();
  if (receipt.senderKey) candidateKeys.add(receipt.senderKey);
  if (receipt.senderEmail && !isGatewayEmail(receipt.senderEmail)) {
    candidateKeys.add(`email:${receipt.senderEmail.toLowerCase()}`);
  }
  if (receipt.senderName) {
    const n = normalizeText(receipt.senderName);
    if (n.length >= 2) candidateKeys.add(`name:${n}`);
  }

  for (const alias of aliases) {
    if (candidateKeys.has(alias.senderKey) && playerById.has(alias.uid)) {
      return { uid: alias.uid, confidence: 'high', reason: 'Saved sender alias' };
    }
  }

  // 2. Exact email match against player_private.email
  if (receipt.senderEmail) {
    const emailLower = receipt.senderEmail.toLowerCase();
    const privMatch = privateInfos.find(
      (pi) => pi.email?.trim().toLowerCase() === emailLower && playerById.has(pi.uid)
    );
    if (privMatch) {
      return { uid: privMatch.uid, confidence: 'high', reason: 'Email match' };
    }
  }

  // 3. Exact normalized full name match (First Last or Last First)
  const normSender = normalizeText(receipt.senderName);
  const normMemo = normalizeText(receipt.memo);
  if (normSender) {
    for (const p of players) {
      const first = normalizeText(p.firstName);
      const last = normalizeText(p.lastName);
      const full = `${first} ${last}`.trim();
      const reversed = `${last} ${first}`.trim();
      if (normSender === full || normSender === reversed) {
        return { uid: p.uid, confidence: 'high', reason: 'Exact name match' };
      }
    }

    // Check if both first and last name appear as whole words inside a longer legal name
    const senderTokens = normSender.split(' ').filter(Boolean);
    const senderTokenSet = new Set(senderTokens);
    const exactTokenMatches = players.filter((p) => {
      const first = normalizeText(p.firstName);
      const last = normalizeText(p.lastName);
      return first.length >= 2 && last.length >= 2 && senderTokenSet.has(first) && senderTokenSet.has(last);
    });
    if (exactTokenMatches.length === 1) {
      return { uid: exactTokenMatches[0].uid, confidence: 'high', reason: 'Full name match' };
    }

    // 4. Strong fuzzy name similarity (e.g. spelling variations like Mohammad/Mohammed)
    let bestUid = '';
    let bestScore = 0;
    for (const p of players) {
      const first = normalizeText(p.firstName);
      const last = normalizeText(p.lastName);
      const full = `${first} ${last}`.trim();
      const reversed = `${last} ${first}`.trim();
      const score = Math.max(
        stringSimilarity(normSender, full),
        stringSimilarity(normSender, reversed)
      );
      if (score > bestScore) {
        bestScore = score;
        bestUid = p.uid;
      }
    }
    if (bestUid && bestScore >= 0.8) {
      return { uid: bestUid, confidence: 'medium', reason: 'Suggested name match' };
    }

    // Unique surname match (medium confidence)
    if (senderTokens.length >= 2) {
      const lastToken = senderTokens[senderTokens.length - 1];
      if (lastToken.length >= 4) {
        const surnameMatches = players.filter((p) => normalizeText(p.lastName) === lastToken);
        if (surnameMatches.length === 1) {
          return { uid: surnameMatches[0].uid, confidence: 'medium', reason: 'Surname match' };
        }
      }
    }
  }

  // 5. Check if player's full name is explicitly written in the transfer memo (e.g. spouse paying for player)
  if (normMemo) {
    const memoMatches = players.filter((p) => {
      const full = normalizeText(`${p.firstName} ${p.lastName}`);
      return full.length >= 5 && normMemo.includes(full);
    });
    if (memoMatches.length === 1) {
      return { uid: memoMatches[0].uid, confidence: 'medium', reason: 'Name found in memo' };
    }
  }

  return { uid: '', confidence: 'none', reason: 'Unmatched sender' };
}

export interface FetchReceiptsOptions {
  daysBack: number;
  customQuery?: string;
  monthlyFee?: number;
  maxResults?: number;
}

export async function fetchPaymentReceiptEmails(
  accessToken: string,
  options: FetchReceiptsOptions
): Promise<{ receipts: ParsedPaymentReceipt[]; totalScanned: number }> {
  const daysBack = Math.max(7, Math.min(365, options.daysBack || 60));
  const monthlyFee = options.monthlyFee && options.monthlyFee > 0 ? options.monthlyFee : 20;
  const maxResults = Math.max(10, Math.min(60, options.maxResults || 40));

  const baseTerms =
    '("Interac" OR "e-Transfer" OR "etransfer" OR "autodeposit" OR "sent you money" OR "payment received" OR "deposited into your account")';
  const extra = options.customQuery?.trim() ? ` (${options.customQuery.trim()})` : '';
  const query = buildRestrictedGmailQuery(`${baseTerms}${extra} newer_than:${daysBack}d`);

  const listUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(
    query
  )}&maxResults=${maxResults}`;

  const listRes = await fetch(listUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (listRes.status === 401 || listRes.status === 403) {
    throw new GmailAuthExpiredError(
      listRes.status === 403
        ? 'Gmail read permission was not granted. Please reconnect Gmail and allow read-only access.'
        : 'Your Gmail session expired. Please reconnect Gmail to scan receipts.'
    );
  }

  if (!listRes.ok) {
    throw new Error(`Gmail API error (${listRes.status}). Please try again.`);
  }

  const listData = (await listRes.json()) as {
    messages?: Array<{ id: string; threadId: string }>;
  };

  const stubs = listData.messages || [];
  if (stubs.length === 0) {
    return { receipts: [], totalScanned: 0 };
  }

  const receipts: ParsedPaymentReceipt[] = [];
  const chunkSize = 8;

  for (let i = 0; i < stubs.length; i += chunkSize) {
    const chunk = stubs.slice(i, i + chunkSize);
    const fullMsgs = await Promise.all(
      chunk.map(async (stub) => {
        const msgRes = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(
            stub.id
          )}?format=full`,
          {
            headers: { Authorization: `Bearer ${accessToken}` },
          }
        );
        if (msgRes.status === 401 || msgRes.status === 403) {
          throw new GmailAuthExpiredError();
        }
        if (!msgRes.ok) return null;
        return (await msgRes.json()) as GmailMessageFull;
      })
    );

    for (const fullMsg of fullMsgs) {
      if (!fullMsg) continue;
      const parsed = parsePaymentReceiptEmail(fullMsg, monthlyFee);
      if (parsed) {
        receipts.push(parsed);
      }
    }
  }

  receipts.sort((a, b) => new Date(b.receivedIso).getTime() - new Date(a.receivedIso).getTime());

  return { receipts, totalScanned: stubs.length };
}
