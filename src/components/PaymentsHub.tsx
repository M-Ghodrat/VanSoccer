import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { User } from 'firebase/auth';
import { deleteDoc, doc, serverTimestamp, writeBatch } from 'firebase/firestore';
import {
  AlertCircle,
  ArrowLeft,
  BookmarkCheck,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  DollarSign,
  FileText,
  Loader2,
  LogOut,
  Mail,
  Paperclip,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import {
  ClubPayment,
  DropInMatch,
  MatchVote,
  PaymentSenderAlias,
  PlayerPrivateInfo,
  PlayerProfile,
  TeamFormation,
} from '../types';
import { getMonthKey, partitionAttendingVotes } from '../utils/clubUtils';
import {
  ALLOWED_GMAIL_SENDER,
  clearGmailAccessToken,
  fetchGmailFullMessagesPage,
  fetchGmailMessageDetail,
  fetchGmailProfile,
  getGmailAccessToken,
  GmailAuthExpiredError,
  GmailMessageDetail,
  GmailProfileInfo,
  googleSignInWithGmail,
  subscribeGmailToken,
} from '../utils/gmailAuth';
import {
  ExtractedEmailPayment,
  extractPaymentFromGmailDetail,
  makeAliasDocId,
  matchReceiptToPlayer,
  ReceiptMatchConfidence,
  stripHtmlToText,
} from '../utils/gmailPayments';
import { GoogleSignInButton } from './GoogleSignInButton';

interface PaymentsHubProps {
  user: User;
  isManagerOrAdmin: boolean;
  players: PlayerProfile[];
  privateInfos: PlayerPrivateInfo[];
  payments: ClubPayment[];
  paymentAliases: PaymentSenderAlias[];
  activeMatch: DropInMatch | null;
  votes: MatchVote[];
  maxPlayers: number;
}

type PaymentsSection = 'ledger' | 'receipts';
type ReceiptFilterScope = 'payments' | 'all';

interface ReceiptRowOverride {
  selectedUid?: string;
  startMonthKey?: string;
  monthCount?: number;
  rememberAlias?: boolean;
  checked?: boolean;
  autoConfirmed?: boolean;
}

interface ActiveProofState {
  email: GmailMessageDetail;
  extractedSender?: string;
  extractedAmount?: number | null;
  currency?: string;
  referenceCode?: string;
  matchedPlayerName?: string;
}

function addMonths(monthKey: string, count: number): string[] {
  const [yrStr, moStr] = monthKey.split('-');
  const yr = Number(yrStr);
  const mo = Number(moStr);
  if (!yr || !mo) return [getMonthKey()];
  const result: string[] = [];
  const safeCount = Math.max(1, Math.min(6, count));
  for (let i = 0; i < safeCount; i++) {
    const d = new Date(yr, mo - 1 + i, 1);
    result.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return result;
}

function formatCurrency(amount: number | null, currency = 'CAD'): string {
  if (amount === null) return '—';
  const formatted = amount.toLocaleString('en-CA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return currency === 'USD' ? `US$${formatted}` : `$${formatted}`;
}

function formatShortDate(internalDateMs: number, iso: string): string {
  const d = internalDateMs ? new Date(internalDateMs) : new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-CA', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatFullDateTime(internalDateMs: number, fallbackDate: string): string {
  const d = internalDateMs ? new Date(internalDateMs) : new Date(fallbackDate);
  if (Number.isNaN(d.getTime())) return fallbackDate;
  return d.toLocaleString('en-CA', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatFileSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const PaymentsHub: React.FC<PaymentsHubProps> = ({
  user,
  isManagerOrAdmin,
  players,
  privateInfos,
  payments,
  paymentAliases,
  activeMatch,
  votes,
  maxPlayers,
}) => {
  const currentMonthKey = getMonthKey();

  const [section, setSection] = useState<PaymentsSection>('ledger');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Club Ledger state
  const currentYearStr = currentMonthKey.slice(0, 4);
  const [memberSearch, setMemberSearch] = useState('');
  const [showLedgerSearch, setShowLedgerSearch] = useState(false);
  const [expandedPlayerUid, setExpandedPlayerUid] = useState<string | null>(null);
  const [detailYear, setDetailYear] = useState<string>(currentYearStr);
  const [detailMonth, setDetailMonth] = useState<string>('all');
  const [togglingKey, setTogglingKey] = useState<string | null>(null);

  // Gmail Receipts state
  const [accessToken, setAccessToken] = useState<string | null>(() => getGmailAccessToken());
  const [connecting, setConnecting] = useState(false);
  const [profileInfo, setProfileInfo] = useState<GmailProfileInfo | null>(null);
  const [receiptScope, setReceiptScope] = useState<ReceiptFilterScope>('payments');
  const [receiptSearchInput, setReceiptSearchInput] = useState('');
  const [receiptServerQuery, setReceiptServerQuery] = useState('');
  const [showReceiptSearch, setShowReceiptSearch] = useState(false);
  const [showReceiptSettings, setShowReceiptSettings] = useState(false);
  const [monthlyFee, setMonthlyFee] = useState<number>(20);
  const [autoConfirmExact, setAutoConfirmExact] = useState<boolean>(false);

  const [extractedReceipts, setExtractedReceipts] = useState<ExtractedEmailPayment[]>([]);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [loadingReceipts, setLoadingReceipts] = useState(false);
  const [loadingMoreReceipts, setLoadingMoreReceipts] = useState(false);
  const [rowOverrides, setRowOverrides] = useState<Record<string, ReceiptRowOverride>>({});
  const [confirming, setConfirming] = useState(false);
  const [showAliases, setShowAliases] = useState(false);
  const [deletingAliasId, setDeletingAliasId] = useState<string | null>(null);

  // Shared Proof Email Inspector state (works from BOTH Club Ledger and Email Receipts)
  const [activeProof, setActiveProof] = useState<ActiveProofState | null>(null);
  const [loadingProofId, setLoadingProofId] = useState<string | null>(null);
  const [proofViewMode, setProofViewMode] = useState<'text' | 'rich'>('text');

  useEffect(() => {
    return subscribeGmailToken((token) => {
      setAccessToken(token);
      if (!token) {
        setProfileInfo(null);
        setExtractedReceipts([]);
        setNextPageToken(null);
        setRowOverrides({});
        setActiveProof(null);
      }
    });
  }, []);

  const playersById = useMemo(() => new Map(players.map((p) => [p.uid, p])), [players]);
  const sortedPlayers = useMemo(
    () =>
      [...players].sort((a, b) =>
        `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`)
      ),
    [players]
  );

  const { confirmedVotes, waitlistedVotes } = useMemo(
    () => partitionAttendingVotes(votes, maxPlayers),
    [votes, maxPlayers]
  );
  const confirmedUidSet = useMemo(() => new Set(confirmedVotes.map((v) => v.uid)), [confirmedVotes]);

  const monthOptions = useMemo(() => {
    const list: string[] = [];
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - 12);
    for (let i = 0; i < 25; i++) {
      const yr = d.getFullYear();
      const mo = String(d.getMonth() + 1).padStart(2, '0');
      list.push(`${yr}-${mo}`);
      d.setMonth(d.getMonth() + 1);
    }
    return list;
  }, []);

  const allKnownMonths = useMemo(() => {
    const set = new Set<string>(monthOptions);
    for (const pay of payments) {
      if (pay.monthKey) set.add(pay.monthKey);
    }
    return Array.from(set).sort();
  }, [monthOptions, payments]);

  const availableYears = useMemo(() => {
    const years = new Set<string>([
      String(Number(currentYearStr) - 1),
      currentYearStr,
      String(Number(currentYearStr) + 1),
    ]);
    for (const mk of allKnownMonths) {
      const y = mk.slice(0, 4);
      if (/^\d{4}$/.test(y)) years.add(y);
    }
    return Array.from(years).sort((a, b) => b.localeCompare(a));
  }, [allKnownMonths, currentYearStr]);

  const MONTH_ABBREVS = [
    { num: '01', label: 'Jan' },
    { num: '02', label: 'Feb' },
    { num: '03', label: 'Mar' },
    { num: '04', label: 'Apr' },
    { num: '05', label: 'May' },
    { num: '06', label: 'Jun' },
    { num: '07', label: 'Jul' },
    { num: '08', label: 'Aug' },
    { num: '09', label: 'Sep' },
    { num: '10', label: 'Oct' },
    { num: '11', label: 'Nov' },
    { num: '12', label: 'Dec' },
  ] as const;

  const paidMonthsByUid = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const pay of payments) {
      if (!pay.paid) continue;
      const list = map.get(pay.uid) || [];
      list.push(pay.monthKey);
      map.set(pay.uid, list);
    }
    for (const [uid, list] of map.entries()) {
      map.set(uid, Array.from(new Set(list)).sort());
    }
    return map;
  }, [payments]);

  const paidKeySet = useMemo(() => {
    const set = new Set<string>();
    for (const pay of payments) {
      if (pay.paid) set.add(`${pay.uid}_${pay.monthKey}`);
    }
    return set;
  }, [payments]);

  const importedMessageIds = useMemo(() => {
    const set = new Set<string>();
    for (const pay of payments) {
      if (pay.paid && pay.gmailMessageId) {
        set.add(pay.gmailMessageId);
      }
    }
    return set;
  }, [payments]);

  const loadedEmailById = useMemo(
    () => new Map(extractedReceipts.map((r) => [r.messageId, r])),
    [extractedReceipts]
  );

  // Build enriched receipt rows (combining extracted email info + roster match + manager edits)
  const receiptRows = useMemo(() => {
    return extractedReceipts.map((item) => {
      const match = matchReceiptToPlayer(
        {
          messageId: item.messageId,
          receivedIso: item.receivedIso,
          subject: item.subject,
          fromHeader: item.fromHeader,
          replyToHeader: '',
          senderName: item.senderName,
          senderEmail: item.senderEmail,
          senderKey: item.senderKey,
          senderLabel: item.senderLabel,
          amount: item.amount,
          currency: item.currency,
          referenceCode: item.referenceCode,
          memo: item.memo,
          suggestedMonthKeys: item.suggestedMonthKeys,
          snippet: item.email.snippet,
        },
        players,
        privateInfos,
        paymentAliases
      );

      const override = rowOverrides[item.messageId] || {};
      const selectedUid = override.selectedUid !== undefined ? override.selectedUid : match.uid;
      const startMonthKey =
        override.startMonthKey || item.suggestedMonthKeys[0] || currentMonthKey;
      const monthCount =
        override.monthCount !== undefined
          ? override.monthCount
          : Math.max(1, Math.min(6, item.suggestedMonthKeys.length || 1));

      const targetMonths = addMonths(startMonthKey, monthCount);
      const alreadyPaid =
        importedMessageIds.has(item.messageId) ||
        (Boolean(selectedUid) &&
          targetMonths.every((mk) => paidKeySet.has(`${selectedUid}_${mk}`)));

      const checked =
        override.checked !== undefined
          ? override.checked
          : Boolean(selectedUid) && item.isPayment && !alreadyPaid;

      const rememberAlias = override.rememberAlias ?? false;
      const autoConfirmed = override.autoConfirmed ?? false;
      const matchedPlayer = selectedUid ? playersById.get(selectedUid) || null : null;

      return {
        item,
        selectedUid,
        matchedPlayer,
        confidence: match.confidence as ReceiptMatchConfidence,
        matchReason: match.reason,
        startMonthKey,
        monthCount,
        targetMonths,
        alreadyPaid,
        checked,
        rememberAlias,
        autoConfirmed,
      };
    });
  }, [
    extractedReceipts,
    players,
    privateInfos,
    paymentAliases,
    rowOverrides,
    currentMonthKey,
    importedMessageIds,
    paidKeySet,
    playersById,
  ]);

  const paymentOnlyReceiptCount = useMemo(
    () => receiptRows.filter((r) => r.item.isPayment).length,
    [receiptRows]
  );

  const pendingConfirmCount = useMemo(
    () => receiptRows.filter((r) => r.item.isPayment && !r.alreadyPaid).length,
    [receiptRows]
  );

  const visibleReceiptRows = useMemo(() => {
    const scoped =
      receiptScope === 'payments' ? receiptRows.filter((r) => r.item.isPayment) : receiptRows;
    const term = receiptSearchInput.trim().toLowerCase();
    if (!term) return scoped;
    return scoped.filter((r) => {
      const playerName = r.matchedPlayer
        ? `${r.matchedPlayer.firstName} ${r.matchedPlayer.lastName}`.toLowerCase()
        : '';
      const amountStr =
        r.item.amount !== null ? `${r.item.amount.toFixed(2)} $${r.item.amount}` : '';
      return (
        r.item.senderName.toLowerCase().includes(term) ||
        r.item.senderEmail.toLowerCase().includes(term) ||
        playerName.includes(term) ||
        amountStr.includes(term) ||
        r.item.memo.toLowerCase().includes(term) ||
        r.item.referenceCode.toLowerCase().includes(term) ||
        r.item.subject.toLowerCase().includes(term)
      );
    });
  }, [receiptRows, receiptScope, receiptSearchInput]);

  // Firestore mutation: confirm 1 or more Gmail receipts into `payments` (+ optional `payment_aliases`)
  const commitReceiptsToFirestore = useCallback(
    async (
      targets: typeof receiptRows,
      isAuto: boolean
    ): Promise<{ confirmedPayments: number; savedAliases: number }> => {
      if (!isManagerOrAdmin) return { confirmedPayments: 0, savedAliases: 0 };
      const actionable = targets.filter((r) => r.selectedUid && !r.alreadyPaid);
      if (actionable.length === 0) {
        return { confirmedPayments: 0, savedAliases: 0 };
      }

      const batch = writeBatch(db);
      let confirmedPayments = 0;
      let savedAliases = 0;
      const queuedPaymentIds = new Set<string>();
      const queuedAliasIds = new Set<string>();

      for (const row of actionable) {
        const months = addMonths(row.startMonthKey, row.monthCount);
        const perMonthAmount =
          row.item.amount !== null && row.item.amount > 0
            ? Math.min(1000, Math.round((row.item.amount / months.length) * 100) / 100)
            : Math.min(1000, Math.max(0, monthlyFee));

        const safeMsgId = row.item.messageId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 128);

        for (const mk of months) {
          const payId = `${row.selectedUid}_${mk}`;
          if (paidKeySet.has(payId) || queuedPaymentIds.has(payId)) continue;
          queuedPaymentIds.add(payId);

          batch.set(
            doc(db, 'payments', payId),
            {
              id: payId,
              uid: row.selectedUid,
              monthKey: mk,
              paid: true,
              amount: perMonthAmount,
              recordedBy: user.uid,
              source: 'gmail',
              gmailMessageId: safeMsgId,
              receiptDateIso: row.item.receivedIso.slice(0, 40),
              updatedAt: serverTimestamp(),
            },
            { merge: true }
          );
          confirmedPayments += 1;
        }

        if (
          row.rememberAlias &&
          row.item.senderKey.length >= 2 &&
          playersById.has(row.selectedUid)
        ) {
          const aliasId = makeAliasDocId(row.item.senderKey);
          if (!queuedAliasIds.has(aliasId)) {
            queuedAliasIds.add(aliasId);
            batch.set(doc(db, 'payment_aliases', aliasId), {
              id: aliasId,
              senderKey: row.item.senderKey.slice(0, 160),
              senderLabel: row.item.senderLabel.slice(0, 160),
              uid: row.selectedUid,
              updatedBy: user.uid,
              updatedAt: serverTimestamp(),
            });
            savedAliases += 1;
          }
        }
      }

      if (confirmedPayments === 0 && savedAliases === 0) {
        return { confirmedPayments: 0, savedAliases: 0 };
      }

      try {
        await batch.commit();
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, 'payments');
      }

      setRowOverrides((prev) => {
        const next = { ...prev };
        for (const row of actionable) {
          next[row.item.messageId] = {
            ...next[row.item.messageId],
            checked: false,
            ...(isAuto ? { autoConfirmed: true } : {}),
          };
        }
        return next;
      });

      return { confirmedPayments, savedAliases };
    },
    [isManagerOrAdmin, monthlyFee, paidKeySet, playersById, user.uid]
  );

  // Fetch receipts from persepolisvfc@gmail.com
  const loadGmailReceipts = useCallback(
    async (
      token: string,
      opts: {
        append?: boolean;
        pageToken?: string;
        queryOverride?: string;
      } = {}
    ) => {
      const q = opts.queryOverride !== undefined ? opts.queryOverride : receiptServerQuery;

      if (opts.append) {
        setLoadingMoreReceipts(true);
      } else {
        setLoadingReceipts(true);
      }
      setError(null);

      try {
        const res = await fetchGmailFullMessagesPage(token, {
          q,
          maxResults: 25,
          pageToken: opts.pageToken,
        });

        const parsed = res.messages.map((detail) =>
          extractPaymentFromGmailDetail(detail, monthlyFee)
        );

        setExtractedReceipts((prev) => {
          if (!opts.append) return parsed;
          const seen = new Set(prev.map((item) => item.messageId));
          const merged = [...prev];
          for (const item of parsed) {
            if (!seen.has(item.messageId)) merged.push(item);
          }
          return merged;
        });
        setNextPageToken(res.nextPageToken);

        // Optional auto-confirmation of exact high-confidence payment matches for managers
        if (!opts.append && isManagerOrAdmin && autoConfirmExact) {
          const exactTargets: typeof receiptRows = [];
          for (const item of parsed) {
            if (!item.isPayment) continue;
            const match = matchReceiptToPlayer(
              {
                messageId: item.messageId,
                receivedIso: item.receivedIso,
                subject: item.subject,
                fromHeader: item.fromHeader,
                replyToHeader: '',
                senderName: item.senderName,
                senderEmail: item.senderEmail,
                senderKey: item.senderKey,
                senderLabel: item.senderLabel,
                amount: item.amount,
                currency: item.currency,
                referenceCode: item.referenceCode,
                memo: item.memo,
                suggestedMonthKeys: item.suggestedMonthKeys,
                snippet: item.email.snippet,
              },
              players,
              privateInfos,
              paymentAliases
            );
            if (match.confidence !== 'high' || !match.uid) continue;
            const startMonthKey = item.suggestedMonthKeys[0] || currentMonthKey;
            const monthCount = Math.max(1, Math.min(6, item.suggestedMonthKeys.length || 1));
            const targetMonths = addMonths(startMonthKey, monthCount);
            const alreadyPaid =
              importedMessageIds.has(item.messageId) ||
              targetMonths.every((mk) => paidKeySet.has(`${match.uid}_${mk}`));
            if (alreadyPaid) continue;

            exactTargets.push({
              item,
              selectedUid: match.uid,
              matchedPlayer: playersById.get(match.uid) || null,
              confidence: match.confidence,
              matchReason: match.reason,
              startMonthKey,
              monthCount,
              targetMonths,
              alreadyPaid: false,
              checked: false,
              rememberAlias: false,
              autoConfirmed: true,
            });
          }

          if (exactTargets.length > 0) {
            const { confirmedPayments } = await commitReceiptsToFirestore(exactTargets, true);
            if (confirmedPayments > 0) {
              setNotice(
                `Auto-confirmed ${confirmedPayments} monthly payment ${
                  confirmedPayments === 1 ? 'entry' : 'entries'
                } from ${exactTargets.length} exact ${
                  exactTargets.length === 1 ? 'receipt' : 'receipts'
                }.`
              );
            }
          }
        }
      } catch (err) {
        if (err instanceof GmailAuthExpiredError) {
          setError(err.message);
        } else {
          setError(err instanceof Error ? err.message : 'Unable to load emails from Gmail.');
        }
      } finally {
        setLoadingReceipts(false);
        setLoadingMoreReceipts(false);
      }
    },
    [
      receiptServerQuery,
      monthlyFee,
      isManagerOrAdmin,
      autoConfirmExact,
      players,
      privateInfos,
      paymentAliases,
      currentMonthKey,
      importedMessageIds,
      paidKeySet,
      playersById,
      commitReceiptsToFirestore,
    ]
  );

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;

    fetchGmailProfile(accessToken)
      .then((info) => {
        if (!cancelled) setProfileInfo(info);
      })
      .catch((err) => {
        if (!cancelled && err instanceof GmailAuthExpiredError) {
          setError(err.message);
        }
      });

    loadGmailReceipts(accessToken);

    return () => {
      cancelled = true;
    };
  }, [accessToken, loadGmailReceipts]);

  const handleConnectGmail = async (switchToReceipts = false) => {
    setError(null);
    setNotice(null);
    setConnecting(true);
    try {
      const { accessToken: token } = await googleSignInWithGmail();
      setAccessToken(token);
      if (switchToReceipts) {
        setSection('receipts');
      }
    } catch (err) {
      const code = (err as { code?: string })?.code || '';
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        setError('Google sign-in popup was closed before finishing.');
      } else {
        setError(err instanceof Error ? err.message : 'Failed to connect Gmail.');
      }
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnectGmail = () => {
    clearGmailAccessToken();
    setError(null);
    setNotice(null);
  };

  // Manual toggle Paid / Unpaid in Club Ledger (preserving active-match waitlist promotion logic)
  const handleTogglePayment = async (uid: string, monthKey: string, nextPaid: boolean) => {
    if (!isManagerOrAdmin) return;
    setError(null);
    setNotice(null);
    const payId = `${uid}_${monthKey}`;
    setTogglingKey(payId);

    try {
      const batch = writeBatch(db);
      batch.set(
        doc(db, 'payments', payId),
        {
          id: payId,
          uid,
          monthKey,
          paid: nextPaid,
          amount: Math.min(1000, Math.max(0, monthlyFee)),
          source: 'manual',
          recordedBy: user.uid,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      let removedFromComing = false;
      let removedFromTeam = false;
      let promotedPlayerName: string | null = null;

      if (!nextPaid && activeMatch && activeMatch.status !== 'completed') {
        const matchMonthKey = getMonthKey(activeMatch.kickoffIso);
        if (matchMonthKey === monthKey) {
          const isComing = votes.some((v) => v.uid === uid && v.attending);
          const wasConfirmed = confirmedUidSet.has(uid);
          if (isComing) {
            batch.delete(doc(db, 'matches', activeMatch.id, 'votes', uid));
            removedFromComing = true;
            if (wasConfirmed && waitlistedVotes.length > 0) {
              const promoted = waitlistedVotes[0];
              if (playersById.has(promoted.uid)) {
                const notifId = `notif_${Date.now()}_${promoted.uid.slice(0, 12)}`;
                batch.set(doc(db, 'notifications', notifId), {
                  id: notifId,
                  recipientUid: promoted.uid,
                  matchId: activeMatch.id,
                  matchTitle: activeMatch.title.slice(0, 120),
                  type: 'waitlist_promoted',
                  message: `A spot opened up for ${activeMatch.title}! You have been moved off the waiting list into the confirmed lineup.`,
                  read: false,
                  createdBy: user.uid,
                  createdAt: serverTimestamp(),
                });
                promotedPlayerName = promoted.playerName;
              }
            }
          }

          if (
            activeMatch.currentFormation?.teams.some((t) =>
              t.players.some((pl) => pl.uid === uid)
            )
          ) {
            const cleanedFormation: TeamFormation = {
              ...activeMatch.currentFormation,
              teams: activeMatch.currentFormation.teams.map((t) => ({
                ...t,
                players: t.players.filter((pl) => pl.uid !== uid),
              })),
            };
            batch.update(doc(db, 'matches', activeMatch.id), {
              currentFormation: cleanedFormation,
              updatedAt: serverTimestamp(),
            });
            removedFromTeam = true;
          }
        }
      }

      await batch.commit();
      const p = playersById.get(uid);
      const memberName = p ? `${p.firstName} ${p.lastName}` : uid;
      const suffix = removedFromComing
        ? removedFromTeam
          ? ' and removed them from Coming and the team sheet.'
          : ' and removed them from Coming.'
        : removedFromTeam
          ? ' and removed them from the team sheet.'
          : '.';
      const waitlistSuffix = promotedPlayerName
        ? ` ${promotedPlayerName} was moved up from the waiting list and notified.`
        : '';
      setNotice(
        `Updated ${memberName} (${monthKey}) to ${nextPaid ? 'Paid' : 'Unpaid'}${suffix}${waitlistSuffix}`
      );
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.WRITE, `payments/${payId}`);
      } catch (wrapped) {
        setError(wrapped instanceof Error ? wrapped.message : 'Failed to update payment status.');
      }
    } finally {
      setTogglingKey(null);
    }
  };

  const handleConfirmReceipts = async (singleRow?: (typeof receiptRows)[number]) => {
    if (!isManagerOrAdmin) return;
    setError(null);
    setNotice(null);
    setConfirming(true);
    try {
      const target = singleRow
        ? [singleRow]
        : visibleReceiptRows.filter((r) => r.checked && r.selectedUid && !r.alreadyPaid);
      const { confirmedPayments, savedAliases } = await commitReceiptsToFirestore(target, false);
      if (confirmedPayments > 0) {
        const aliasNote =
          savedAliases > 0
            ? ` Saved ${savedAliases} sender ${savedAliases === 1 ? 'alias' : 'aliases'}.`
            : '';
        setNotice(
          `Confirmed ${confirmedPayments} monthly payment ${
            confirmedPayments === 1 ? 'entry' : 'entries'
          } into Club Ledger.${aliasNote}`
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to confirm selected payments.');
    } finally {
      setConfirming(false);
    }
  };

  const handleDeleteAlias = async (aliasId: string) => {
    if (!isManagerOrAdmin) return;
    setDeletingAliasId(aliasId);
    setError(null);
    try {
      await deleteDoc(doc(db, 'payment_aliases', aliasId));
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.DELETE, `payment_aliases/${aliasId}`);
      } catch (wrapped) {
        setError(wrapped instanceof Error ? wrapped.message : 'Could not delete sender alias.');
      }
    } finally {
      setDeletingAliasId(null);
    }
  };

  // Open proof email from Email Receipts row
  const handleToggleReceiptProof = (row: (typeof receiptRows)[number]) => {
    if (activeProof?.email.id === row.item.messageId) {
      setActiveProof(null);
      return;
    }
    setProofViewMode('text');
    setActiveProof({
      email: row.item.email,
      extractedSender: row.item.senderName || row.item.senderEmail || 'Not detected',
      extractedAmount: row.item.amount,
      currency: row.item.currency,
      referenceCode: row.item.referenceCode,
      matchedPlayerName: row.matchedPlayer
        ? `${row.matchedPlayer.firstName} ${row.matchedPlayer.lastName}`
        : undefined,
    });
  };

  // Open proof email directly from a Gmail-confirmed Club Ledger row
  const handleOpenLedgerProof = async (payment: ClubPayment, playerName: string) => {
    const msgId = payment.gmailMessageId;
    if (!msgId) return;
    if (activeProof?.email.id === msgId) {
      setActiveProof(null);
      return;
    }

    // Use already-loaded message if available
    const cached = loadedEmailById.get(msgId);
    if (cached) {
      setProofViewMode('text');
      setActiveProof({
        email: cached.email,
        extractedSender: cached.senderName || cached.senderEmail || playerName,
        extractedAmount: cached.amount ?? payment.amount,
        currency: cached.currency,
        referenceCode: cached.referenceCode,
        matchedPlayerName: playerName,
      });
      return;
    }

    if (!accessToken) {
      setError(`Connect Gmail above to view the original ${ALLOWED_GMAIL_SENDER} email proof.`);
      return;
    }

    setLoadingProofId(msgId);
    setError(null);
    try {
      const detail = await fetchGmailMessageDetail(accessToken, msgId);
      const parsed = extractPaymentFromGmailDetail(detail, monthlyFee);
      setProofViewMode('text');
      setActiveProof({
        email: detail,
        extractedSender: parsed.senderName || parsed.senderEmail || playerName,
        extractedAmount: parsed.amount ?? payment.amount,
        currency: parsed.currency,
        referenceCode: parsed.referenceCode,
        matchedPlayerName: playerName,
      });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Unable to load the linked email proof from Gmail.'
      );
    } finally {
      setLoadingProofId(null);
    }
  };

  // Club Ledger computed metrics (Current Month)
  const filteredLedgerPlayers = useMemo(() => {
    return sortedPlayers.filter((p) => {
      if (!memberSearch.trim()) return true;
      return `${p.firstName} ${p.lastName}`
        .toLowerCase()
        .includes(memberSearch.trim().toLowerCase());
    });
  }, [sortedPlayers, memberSearch]);

  const paidCountForCurrentMonth = useMemo(
    () =>
      filteredLedgerPlayers.filter((p) =>
        (paidMonthsByUid.get(p.uid) || []).includes(currentMonthKey)
      ).length,
    [filteredLedgerPlayers, paidMonthsByUid, currentMonthKey]
  );

  const collectedAmountForCurrentMonth = useMemo(() => {
    const filteredUidSet = new Set(filteredLedgerPlayers.map((p) => p.uid));
    let sum = 0;
    for (const pay of payments) {
      if (!pay.paid || !filteredUidSet.has(pay.uid)) continue;
      if (pay.monthKey !== currentMonthKey) continue;
      sum += Number(pay.amount) || 20;
    }
    return Math.round(sum * 100) / 100;
  }, [filteredLedgerPlayers, payments, currentMonthKey]);

  const readySelectedReceiptsCount = useMemo(
    () =>
      visibleReceiptRows.filter((r) => r.checked && Boolean(r.selectedUid) && !r.alreadyPaid)
        .length,
    [visibleReceiptRows]
  );

  const receiptsExtractedTotal = useMemo(() => {
    let sum = 0;
    for (const r of visibleReceiptRows) {
      if (r.item.amount !== null) sum += r.item.amount;
    }
    return Math.round(sum * 100) / 100;
  }, [visibleReceiptRows]);

  const proofPlainText = activeProof
    ? activeProof.email.plainBody.trim() ||
      stripHtmlToText(activeProof.email.htmlBody) ||
      activeProof.email.snippet
    : '';

  const sandboxedProofHtml = activeProof?.email.htmlBody
    ? `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;padding:16px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-size:13px;line-height:1.55;color:#0f172a;word-break:break-word;}img{max-width:100%;height:auto;}a{color:#047857;}</style></head><body>${activeProof.email.htmlBody}</body></html>`
    : '';

  return (
    <div className="space-y-5">
      {/* Minimal Header, View Switcher & Compact KPI Strip */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">
            Payments
          </h1>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <div className="inline-flex items-center p-1 bg-slate-100 rounded-lg">
              <button
                type="button"
                onClick={() => setSection('ledger')}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap transition-colors ${
                  section === 'ledger'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Ledger
              </button>
              <button
                type="button"
                onClick={() => setSection('receipts')}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap transition-colors ${
                  section === 'receipts'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Receipts{accessToken ? ` (${paymentOnlyReceiptCount})` : ''}
              </button>
            </div>

            {!accessToken ? (
              <button
                type="button"
                disabled={connecting}
                onClick={() => handleConnectGmail(true)}
                title={`Connect Gmail (${ALLOWED_GMAIL_SENDER})`}
                aria-label="Connect Gmail"
                className="px-3 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 disabled:opacity-50 transition-colors"
              >
                {connecting ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Mail className="w-3.5 h-3.5" />
                )}
                Gmail
              </button>
            ) : (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={loadingReceipts}
                  onClick={() => loadGmailReceipts(accessToken)}
                  title={`Sync receipts from ${ALLOWED_GMAIL_SENDER}${profileInfo?.emailAddress ? ` (${profileInfo.emailAddress})` : ''}`}
                  aria-label="Sync Gmail receipts"
                  className="p-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 disabled:opacity-50 transition-colors"
                >
                  <RefreshCw className={`w-4 h-4 ${loadingReceipts ? 'animate-spin' : ''}`} />
                </button>
                <button
                  type="button"
                  onClick={handleDisconnectGmail}
                  title="Disconnect Gmail"
                  aria-label="Disconnect Gmail"
                  className="p-2 rounded-lg border border-slate-200 bg-white hover:bg-rose-50 hover:border-rose-200 hover:text-rose-700 text-slate-500 transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Hairline-Divided 4-Metric KPI Strip */}
        <div className="grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 divide-x divide-slate-200 border-t border-slate-200 bg-slate-50/50">
          <div className="px-4 py-3">
            <div className="text-[11px] font-medium text-slate-500">
              Paid (Current Month)
            </div>
            <div className="mt-0.5 font-mono-tabular text-xl font-bold text-emerald-700">
              {paidCountForCurrentMonth}
              <span className="text-xs font-medium text-slate-400">
                /{filteredLedgerPlayers.length}
              </span>
            </div>
          </div>

          <div className="px-4 py-3">
            <div className="text-[11px] font-medium text-slate-500">Unpaid</div>
            <div className="mt-0.5 font-mono-tabular text-xl font-bold text-amber-700">
              {Math.max(0, filteredLedgerPlayers.length - paidCountForCurrentMonth)}
            </div>
          </div>

          <div className="px-4 py-3">
            <div className="text-[11px] font-medium text-slate-500">Collected</div>
            <div className="mt-0.5 font-mono-tabular text-xl font-bold text-slate-900">
              {formatCurrency(collectedAmountForCurrentMonth)}
            </div>
          </div>

          <div className="px-4 py-3">
            <div className="text-[11px] font-medium text-slate-500">Receipts</div>
            <div className="mt-0.5 flex items-baseline gap-2">
              <span className="font-mono-tabular text-xl font-bold text-slate-900">
                {accessToken ? paymentOnlyReceiptCount : '—'}
              </span>
              {accessToken && pendingConfirmCount > 0 && isManagerOrAdmin && (
                <button
                  type="button"
                  onClick={() => setSection('receipts')}
                  className="text-[11px] font-semibold text-emerald-700 hover:underline whitespace-nowrap"
                >
                  {pendingConfirmCount} new
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Feedback Banners */}
      {error && (
        <div className="px-3.5 py-2.5 rounded-xl bg-red-50 border border-red-200 text-xs text-red-800 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span className="truncate">{error}</span>
          </div>
          <button
            type="button"
            onClick={() => setError(null)}
            aria-label="Dismiss error"
            className="p-1 text-red-700 hover:text-red-900 shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {notice && (
        <div className="px-3.5 py-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span className="truncate">{notice}</span>
          </div>
          <button
            type="button"
            onClick={() => setNotice(null)}
            aria-label="Dismiss notice"
            className="p-1 text-emerald-700 hover:text-emerald-950 shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Main Content + Shared Proof Email Drawer */}
      <div className="grid lg:grid-cols-12 gap-5 items-start">
        <div className={activeProof ? 'hidden lg:block lg:col-span-7 space-y-4' : 'lg:col-span-12 space-y-4'}>
          {/* ==================== SECTION 1: CLUB LEDGER ==================== */}
          {section === 'ledger' && (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              {/* Minimal Toolbar */}
              <div className="px-4 py-3 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2.5">
                <span className="text-xs font-medium text-slate-500 font-mono-tabular">
                  {filteredLedgerPlayers.length}/{players.length} members
                </span>

                <div className="flex items-center gap-1.5">
                  {showLedgerSearch || memberSearch ? (
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        type="text"
                        autoFocus
                        value={memberSearch}
                        onChange={(e) => setMemberSearch(e.target.value)}
                        placeholder="Member..."
                        className="pl-7 pr-7 py-1.5 w-44 rounded-lg border border-slate-300 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-600"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setMemberSearch('');
                          setShowLedgerSearch(false);
                        }}
                        aria-label="Close search"
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setShowLedgerSearch(true)}
                      title="Search members"
                      aria-label="Search members"
                      className="p-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors"
                    >
                      <Search className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                    <tr>
                      <th className="py-3 px-5 font-semibold">Member</th>
                      <th className="py-3 px-4 font-semibold">Status (Current Month)</th>
                      <th className="py-3 px-4 font-semibold text-center">Paid Months</th>
                      {isManagerOrAdmin && (
                        <th className="py-3 px-5 font-semibold text-right">Add Payments</th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredLedgerPlayers.length === 0 ? (
                      <tr>
                        <td
                          colSpan={isManagerOrAdmin ? 4 : 3}
                          className="py-10 px-5 text-center text-slate-500"
                        >
                          No matching members found.
                        </td>
                      </tr>
                    ) : (
                      filteredLedgerPlayers.map((p) => {
                        const playerPaidMonths = paidMonthsByUid.get(p.uid) || [];
                        const isPaidCurrentMonth = playerPaidMonths.includes(currentMonthKey);
                        const currentMonthPayment = payments.find(
                          (pay) =>
                            pay.uid === p.uid &&
                            pay.monthKey === currentMonthKey &&
                            pay.paid
                        );
                        const isExpanded = expandedPlayerUid === p.uid;
                        const toggleId = `${p.uid}_${currentMonthKey}`;
                        const fullName = `${p.firstName} ${p.lastName}`;

                        const openPlayerDetails = () => {
                          if (isExpanded) {
                            setExpandedPlayerUid(null);
                          } else {
                            setExpandedPlayerUid(p.uid);
                            setDetailYear(currentYearStr);
                            setDetailMonth('all');
                          }
                        };

                        const yearPaidCount = playerPaidMonths.filter((mk) =>
                          mk.startsWith(`${detailYear}-`)
                        ).length;

                        const visibleDetailMonths =
                          detailMonth === 'all'
                            ? MONTH_ABBREVS
                            : MONTH_ABBREVS.filter((m) => m.num === detailMonth);

                        return (
                          <React.Fragment key={p.uid}>
                            <tr className="hover:bg-slate-50/70 transition-colors">
                              <td className="py-3 px-5 align-middle whitespace-nowrap">
                                <div className="font-semibold text-slate-900">{fullName}</div>
                                <div className="text-[11px] text-slate-500 capitalize">
                                  {p.role}
                                </div>
                              </td>

                              {/* Status (Current Month): Toggle Switch for Managers + Status + Proof */}
                              <td className="py-3 px-4 align-middle whitespace-nowrap">
                                <div className="inline-flex items-center gap-2.5">
                                  {isManagerOrAdmin && (
                                    <button
                                      type="button"
                                      role="switch"
                                      aria-checked={isPaidCurrentMonth}
                                      aria-label={`Toggle current month payment for ${fullName}`}
                                      disabled={togglingKey === toggleId}
                                      onClick={() =>
                                        handleTogglePayment(
                                          p.uid,
                                          currentMonthKey,
                                          !isPaidCurrentMonth
                                        )
                                      }
                                      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:ring-offset-1 disabled:opacity-50 ${
                                        isPaidCurrentMonth ? 'bg-emerald-600' : 'bg-slate-300'
                                      }`}
                                    >
                                      <span
                                        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-xs transition-transform ${
                                          isPaidCurrentMonth ? 'translate-x-4.5' : 'translate-x-1'
                                        }`}
                                      />
                                    </button>
                                  )}

                                  {isPaidCurrentMonth ? (
                                    <div className="inline-flex items-center gap-1.5">
                                      <span className="font-semibold text-emerald-700 font-mono-tabular">
                                        Paid · {formatCurrency(currentMonthPayment?.amount ?? 20)}
                                      </span>
                                      {currentMonthPayment?.source === 'gmail' &&
                                        currentMonthPayment.gmailMessageId && (
                                          <button
                                            type="button"
                                            disabled={
                                              loadingProofId ===
                                              currentMonthPayment.gmailMessageId
                                            }
                                            onClick={() =>
                                              handleOpenLedgerProof(
                                                currentMonthPayment,
                                                fullName
                                              )
                                            }
                                            title={
                                              activeProof?.email.id ===
                                              currentMonthPayment.gmailMessageId
                                                ? 'Hide email proof'
                                                : 'View email proof'
                                            }
                                            aria-label="View email proof"
                                            className={`p-1 rounded-md transition-colors ${
                                              activeProof?.email.id ===
                                              currentMonthPayment.gmailMessageId
                                                ? 'text-emerald-800 bg-emerald-50'
                                                : 'text-slate-400 hover:text-emerald-700 hover:bg-slate-100'
                                            }`}
                                          >
                                            {loadingProofId ===
                                            currentMonthPayment.gmailMessageId ? (
                                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                            ) : (
                                              <FileText className="w-3.5 h-3.5" />
                                            )}
                                          </button>
                                        )}
                                    </div>
                                  ) : (
                                    <span className="font-semibold text-amber-700">Unpaid</span>
                                  )}
                                </div>
                              </td>

                              {/* Paid Months: Numeric Count (Clickable for Year/Month Details) */}
                              <td className="py-3 px-4 align-middle text-center whitespace-nowrap">
                                <button
                                  type="button"
                                  onClick={openPlayerDetails}
                                  title="View paid months details"
                                  aria-expanded={isExpanded}
                                  className={`min-w-[34px] px-2.5 py-1 rounded-md font-mono-tabular text-xs font-bold border transition-colors ${
                                    isExpanded
                                      ? 'bg-emerald-700 border-emerald-700 text-white'
                                      : playerPaidMonths.length > 0
                                        ? 'bg-slate-50 border-slate-200 text-slate-900 hover:border-emerald-500 hover:text-emerald-800'
                                        : 'bg-white border-slate-200 text-slate-400 hover:border-slate-300 hover:text-slate-600'
                                  }`}
                                >
                                  {playerPaidMonths.length}
                                </button>
                              </td>

                              {/* Add Payments: Calendar Icon Opening Year/Month Filter Picker */}
                              {isManagerOrAdmin && (
                                <td className="py-3 px-5 align-middle text-right whitespace-nowrap">
                                  <button
                                    type="button"
                                    onClick={openPlayerDetails}
                                    title={isExpanded ? 'Close payment calendar' : 'Add or manage payments'}
                                    aria-label={`Add payments for ${fullName}`}
                                    aria-expanded={isExpanded}
                                    className={`p-1.5 rounded-lg border transition-colors inline-flex items-center justify-center ${
                                      isExpanded
                                        ? 'border-emerald-700 bg-emerald-50 text-emerald-800'
                                        : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-600'
                                    }`}
                                  >
                                    <CalendarDays className="w-4 h-4" />
                                  </button>
                                </td>
                              )}
                            </tr>

                            {/* Expandable Year (YYYY) + 3-Letter Month (Jan-Dec) Details & Add Payments Drawer */}
                            {isExpanded && (
                              <tr className="bg-slate-50/85">
                                <td colSpan={isManagerOrAdmin ? 4 : 3} className="px-5 py-3.5">
                                  <div className="space-y-3">
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                      <div className="flex flex-wrap items-center gap-2">
                                        <select
                                          value={detailYear}
                                          onChange={(e) => setDetailYear(e.target.value)}
                                          aria-label="Filter year"
                                          className="px-2.5 py-1 rounded-md border border-slate-300 bg-white text-xs font-mono-tabular font-semibold text-slate-900"
                                        >
                                          {availableYears.map((yr) => (
                                            <option key={yr} value={yr}>
                                              {yr}
                                            </option>
                                          ))}
                                        </select>

                                        <select
                                          value={detailMonth}
                                          onChange={(e) => setDetailMonth(e.target.value)}
                                          aria-label="Filter month"
                                          className="px-2.5 py-1 rounded-md border border-slate-300 bg-white text-xs font-semibold text-slate-900"
                                        >
                                          <option value="all">All</option>
                                          {MONTH_ABBREVS.map((m) => (
                                            <option key={m.num} value={m.num}>
                                              {m.label}
                                            </option>
                                          ))}
                                        </select>

                                        <span className="text-[11px] font-mono-tabular text-slate-500">
                                          {yearPaidCount}/12 paid in {detailYear}
                                        </span>
                                      </div>

                                      <button
                                        type="button"
                                        onClick={() => setExpandedPlayerUid(null)}
                                        aria-label="Close details"
                                        className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-200/60"
                                      >
                                        <X className="w-3.5 h-3.5" />
                                      </button>
                                    </div>

                                    <div
                                      className={`grid gap-1.5 ${
                                        visibleDetailMonths.length === 1
                                          ? 'grid-cols-1 max-w-[220px]'
                                          : 'grid-cols-4 sm:grid-cols-6 md:grid-cols-12'
                                      }`}
                                    >
                                      {visibleDetailMonths.map((m) => {
                                        const mk = `${detailYear}-${m.num}`;
                                        const payRecord = payments.find(
                                          (pay) =>
                                            pay.uid === p.uid &&
                                            pay.monthKey === mk &&
                                            pay.paid
                                        );
                                        const paidInMk = Boolean(payRecord);
                                        const isCurrent = mk === currentMonthKey;

                                        return (
                                          <div
                                            key={mk}
                                            className="flex flex-col items-stretch gap-1"
                                          >
                                            <button
                                              type="button"
                                              disabled={
                                                !isManagerOrAdmin ||
                                                togglingKey === `${p.uid}_${mk}`
                                              }
                                              onClick={() => {
                                                if (isManagerOrAdmin) {
                                                  handleTogglePayment(p.uid, mk, !paidInMk);
                                                }
                                              }}
                                              title={
                                                isManagerOrAdmin
                                                  ? `${m.label} ${detailYear}: click to mark ${paidInMk ? 'unpaid' : 'paid'}`
                                                  : `${m.label} ${detailYear}: ${paidInMk ? 'Paid' : 'Unpaid'}`
                                              }
                                              className={`px-2 py-1.5 rounded-md border text-[11px] font-semibold transition-colors flex items-center justify-center gap-1 disabled:cursor-default ${
                                                paidInMk
                                                  ? 'bg-emerald-700 border-emerald-700 text-white hover:bg-emerald-800'
                                                  : isCurrent
                                                    ? 'bg-amber-50 border-amber-300 text-amber-900 hover:bg-amber-100'
                                                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-100'
                                              }`}
                                            >
                                              <span>{m.label}</span>
                                              {paidInMk && <Check className="w-3 h-3 shrink-0" />}
                                            </button>

                                            {payRecord?.source === 'gmail' &&
                                              payRecord.gmailMessageId && (
                                                <button
                                                  type="button"
                                                  onClick={() =>
                                                    handleOpenLedgerProof(payRecord, fullName)
                                                  }
                                                  title={`Email proof for ${m.label} ${detailYear}`}
                                                  className="text-[10px] text-emerald-700 hover:underline inline-flex items-center justify-center gap-0.5"
                                                >
                                                  <FileText className="w-2.5 h-2.5" />
                                                  <span>Proof</span>
                                                </button>
                                              )}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ==================== SECTION 2: EMAIL RECEIPTS ==================== */}
          {section === 'receipts' && (
            <>
              {!accessToken ? (
                <div className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-4">
                  <DollarSign className="w-7 h-7 text-emerald-700 mx-auto" />
                  <h2 className="font-display text-lg font-bold text-slate-900">
                    Connect Gmail ({ALLOWED_GMAIL_SENDER})
                  </h2>
                  <div className="flex justify-center">
                    <GoogleSignInButton
                      onClick={() => handleConnectGmail(true)}
                      loading={connecting}
                      label="Sign in with Google"
                    />
                  </div>
                </div>
              ) : (
                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                  {/* Minimal Receipts Toolbar */}
                  <div className="px-4 py-3 border-b border-slate-200 space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2.5">
                      <div className="flex items-center gap-3">
                        <div className="inline-flex items-center p-1 bg-slate-100 rounded-lg">
                          <button
                            type="button"
                            onClick={() => setReceiptScope('payments')}
                            className={`px-2.5 py-1 rounded-md text-xs font-semibold whitespace-nowrap transition-colors ${
                              receiptScope === 'payments'
                                ? 'bg-white text-slate-900 shadow-xs'
                                : 'text-slate-600 hover:text-slate-900'
                            }`}
                          >
                            Payments ({paymentOnlyReceiptCount})
                          </button>
                          <button
                            type="button"
                            onClick={() => setReceiptScope('all')}
                            className={`px-2.5 py-1 rounded-md text-xs font-semibold whitespace-nowrap transition-colors ${
                              receiptScope === 'all'
                                ? 'bg-white text-slate-900 shadow-xs'
                                : 'text-slate-600 hover:text-slate-900'
                            }`}
                          >
                            All ({extractedReceipts.length})
                          </button>
                        </div>

                        <span className="text-xs font-mono-tabular font-semibold text-slate-700">
                          {formatCurrency(receiptsExtractedTotal)}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5">
                        {(showReceiptSearch || receiptSearchInput || receiptServerQuery) ? (
                          <form
                            onSubmit={(e) => {
                              e.preventDefault();
                              setActiveProof(null);
                              setReceiptServerQuery(receiptSearchInput.trim());
                            }}
                            className="flex items-center gap-1"
                          >
                            <div className="relative">
                              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                              <input
                                type="text"
                                autoFocus
                                value={receiptSearchInput}
                                onChange={(e) => setReceiptSearchInput(e.target.value)}
                                placeholder="Search..."
                                className="pl-7 pr-7 py-1.5 w-44 rounded-lg border border-slate-300 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-600"
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  setReceiptSearchInput('');
                                  setReceiptServerQuery('');
                                  setShowReceiptSearch(false);
                                }}
                                aria-label="Close receipt search"
                                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </form>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setShowReceiptSearch(true)}
                            title="Search receipts"
                            aria-label="Search receipts"
                            className="p-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors"
                          >
                            <Search className="w-3.5 h-3.5" />
                          </button>
                        )}

                        {isManagerOrAdmin && (
                          <button
                            type="button"
                            onClick={() => setShowReceiptSettings((prev) => !prev)}
                            title="Sync settings"
                            aria-label="Toggle sync settings"
                            className={`p-2 rounded-lg border transition-colors ${
                              showReceiptSettings || autoConfirmExact
                                ? 'border-emerald-700 bg-emerald-50 text-emerald-800'
                                : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                            }`}
                          >
                            <SlidersHorizontal className="w-3.5 h-3.5" />
                          </button>
                        )}

                        {isManagerOrAdmin && readySelectedReceiptsCount > 0 && (
                          <button
                            type="button"
                            disabled={confirming}
                            onClick={() => handleConfirmReceipts()}
                            title={`Confirm ${readySelectedReceiptsCount} selected`}
                            className="px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold inline-flex items-center gap-1 whitespace-nowrap disabled:opacity-50 transition-colors"
                          >
                            {confirming ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Check className="w-3.5 h-3.5" />
                            )}
                            {readySelectedReceiptsCount}
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Collapsible Manager Sync Settings (Closed by Default) */}
                    {isManagerOrAdmin && showReceiptSettings && (
                      <div className="pt-2.5 border-t border-slate-100 flex flex-wrap items-center gap-4 text-xs">
                        <label className="inline-flex items-center gap-2 text-slate-700 font-medium">
                          <span>Fee ($)</span>
                          <input
                            type="number"
                            min={1}
                            max={500}
                            value={monthlyFee}
                            onChange={(e) =>
                              setMonthlyFee(Math.max(1, Number(e.target.value) || 20))
                            }
                            className="w-16 px-2 py-1 rounded-md border border-slate-300 bg-white font-mono-tabular font-semibold text-slate-900"
                          />
                        </label>

                        <label className="inline-flex items-center gap-2 text-slate-700 font-medium cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={autoConfirmExact}
                            onChange={(e) => setAutoConfirmExact(e.target.checked)}
                            className="rounded border-slate-300 text-emerald-700 focus:ring-emerald-600"
                          />
                          Auto-confirm exact matches
                        </label>
                      </div>
                    )}
                  </div>

                  {/* Extracted Receipts Table */}
                  {loadingReceipts ? (
                    <div className="p-6 space-y-2.5">
                      {[0, 1, 2, 3, 4].map((i) => (
                        <div
                          key={i}
                          className="h-11 rounded-lg bg-slate-100 animate-pulse flex items-center justify-between px-4"
                        >
                          <div className="h-3 w-44 rounded bg-slate-200" />
                          <div className="h-3 w-20 rounded bg-slate-200" />
                        </div>
                      ))}
                    </div>
                  ) : visibleReceiptRows.length === 0 ? (
                    <div className="p-10 text-center space-y-2">
                      <DollarSign className="w-6 h-6 text-slate-300 mx-auto" />
                      <p className="text-sm font-semibold text-slate-800">
                        {receiptScope === 'payments' && extractedReceipts.length > 0
                          ? 'No payment amounts detected in loaded emails'
                          : 'No emails found'}
                      </p>
                      <p className="text-xs text-slate-500 max-w-md mx-auto">
                        {receiptScope === 'payments' && extractedReceipts.length > 0
                          ? `Loaded ${extractedReceipts.length} emails from ${ALLOWED_GMAIL_SENDER}. Switch to All Emails to inspect them.`
                          : `No emails from ${ALLOWED_GMAIL_SENDER} matched your current filter.`}
                      </p>
                      {receiptScope === 'payments' && extractedReceipts.length > 0 && (
                        <div className="pt-1">
                          <button
                            type="button"
                            onClick={() => setReceiptScope('all')}
                            className="px-3.5 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold whitespace-nowrap"
                          >
                            Show All Emails ({extractedReceipts.length})
                          </button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                          <tr>
                            {isManagerOrAdmin && (
                              <th className="py-3 px-3 w-8">
                                <span className="sr-only">Select</span>
                              </th>
                            )}
                            <th className="py-3 px-4 font-semibold">Sender</th>
                            <th className="py-3 px-3 font-semibold text-right">Amount</th>
                            <th className="py-3 px-3 font-semibold whitespace-nowrap">Date</th>
                            {isManagerOrAdmin && (
                              <>
                                <th className="py-3 px-3 font-semibold">Club Player &amp; Month</th>
                                <th className="py-3 px-3 font-semibold text-right">Sync</th>
                              </>
                            )}
                            <th className="py-3 px-4 font-semibold text-right">Proof</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {visibleReceiptRows.map((row) => {
                            const isProofSelected = activeProof?.email.id === row.item.messageId;
                            const displaySender =
                              row.item.senderName ||
                              row.item.senderEmail ||
                              'Sender not detected';
                            const isMissingSender = !row.item.senderName && !row.item.senderEmail;

                            return (
                              <tr
                                key={row.item.messageId}
                                className={`transition-colors ${
                                  isProofSelected
                                    ? 'bg-emerald-50/75'
                                    : row.alreadyPaid
                                      ? 'bg-slate-50/40'
                                      : 'hover:bg-slate-50/70'
                                }`}
                              >
                                {isManagerOrAdmin && (
                                  <td className="py-3 px-3 align-top">
                                    <input
                                      type="checkbox"
                                      disabled={row.alreadyPaid || !row.selectedUid}
                                      checked={!row.alreadyPaid && row.checked}
                                      onChange={(e) =>
                                        setRowOverrides((prev) => ({
                                          ...prev,
                                          [row.item.messageId]: {
                                            ...prev[row.item.messageId],
                                            checked: e.target.checked,
                                          },
                                        }))
                                      }
                                      aria-label={`Select payment from ${displaySender}`}
                                      className="mt-1 rounded border-slate-300 text-emerald-700 focus:ring-emerald-600 disabled:opacity-40"
                                    />
                                  </td>
                                )}

                                <td className="py-3 px-4 align-top max-w-[230px]">
                                  <div
                                    className={`text-sm font-semibold truncate ${
                                      isMissingSender ? 'text-amber-700' : 'text-slate-900'
                                    }`}
                                  >
                                    {displaySender}
                                  </div>
                                  <div
                                    className="text-[11px] text-slate-500 truncate mt-0.5"
                                    title={row.item.memo || row.item.subject}
                                  >
                                    {row.item.memo
                                      ? row.item.memo
                                      : row.item.referenceCode
                                        ? `Ref ${row.item.referenceCode}`
                                        : row.item.subject}
                                  </div>
                                </td>

                                <td className="py-3 px-3 align-top text-right whitespace-nowrap">
                                  {row.item.amount !== null ? (
                                    <span className="font-mono-tabular text-sm font-bold text-emerald-700">
                                      {formatCurrency(row.item.amount, row.item.currency)}
                                    </span>
                                  ) : (
                                    <span className="font-mono-tabular text-slate-400">—</span>
                                  )}
                                </td>

                                <td className="py-3 px-3 align-top whitespace-nowrap font-mono-tabular text-slate-600">
                                  {formatShortDate(row.item.internalDateMs, row.item.receivedIso)}
                                </td>

                                {isManagerOrAdmin && (
                                  <>
                                    <td className="py-3 px-3 align-top min-w-[215px] space-y-1.5">
                                      <div className="flex items-center gap-1.5">
                                        <select
                                          disabled={row.alreadyPaid}
                                          value={row.selectedUid}
                                          onChange={(e) => {
                                            const nextUid = e.target.value;
                                            setRowOverrides((prev) => ({
                                              ...prev,
                                              [row.item.messageId]: {
                                                ...prev[row.item.messageId],
                                                selectedUid: nextUid,
                                                checked: Boolean(nextUid),
                                                rememberAlias:
                                                  Boolean(nextUid) &&
                                                  Boolean(row.item.senderKey) &&
                                                  row.confidence !== 'high',
                                              },
                                            }));
                                          }}
                                          aria-label={`Assign club player for ${displaySender}`}
                                          className="flex-1 min-w-[130px] px-2 py-1 rounded-md border border-slate-300 bg-white text-xs font-medium text-slate-800 disabled:opacity-60"
                                        >
                                          <option value="">Select player...</option>
                                          {sortedPlayers.map((p) => (
                                            <option key={p.uid} value={p.uid}>
                                              {p.firstName} {p.lastName}
                                            </option>
                                          ))}
                                        </select>

                                        <select
                                          disabled={row.alreadyPaid}
                                          value={row.startMonthKey}
                                          onChange={(e) =>
                                            setRowOverrides((prev) => ({
                                              ...prev,
                                              [row.item.messageId]: {
                                                ...prev[row.item.messageId],
                                                startMonthKey: e.target.value,
                                              },
                                            }))
                                          }
                                          aria-label="Payment month"
                                          className="px-1.5 py-1 rounded-md border border-slate-300 bg-white font-mono-tabular text-[11px] font-semibold text-slate-800 disabled:opacity-60"
                                        >
                                          {Array.from(
                                            new Set([...allKnownMonths, row.startMonthKey])
                                          )
                                            .sort()
                                            .map((mk) => (
                                              <option key={mk} value={mk}>
                                                {mk}
                                              </option>
                                            ))}
                                        </select>

                                        <select
                                          disabled={row.alreadyPaid}
                                          value={row.monthCount}
                                          onChange={(e) =>
                                            setRowOverrides((prev) => ({
                                              ...prev,
                                              [row.item.messageId]: {
                                                ...prev[row.item.messageId],
                                                monthCount: Number(e.target.value),
                                              },
                                            }))
                                          }
                                          aria-label="Months covered"
                                          className="px-1 py-1 rounded-md border border-slate-300 bg-white font-mono-tabular text-[11px] font-semibold text-slate-700 disabled:opacity-60"
                                        >
                                          {[1, 2, 3, 4, 5, 6].map((n) => (
                                            <option key={n} value={n}>
                                              {n}m
                                            </option>
                                          ))}
                                        </select>
                                      </div>

                                      <div className="flex flex-wrap items-center gap-2 text-[11px]">
                                        <span
                                          className={
                                            row.confidence === 'high'
                                              ? 'text-emerald-700 font-medium'
                                              : row.confidence === 'medium'
                                                ? 'text-amber-700 font-medium'
                                                : 'text-slate-400'
                                          }
                                        >
                                          {row.matchReason}
                                        </span>

                                        {!row.alreadyPaid &&
                                          row.selectedUid &&
                                          row.item.senderKey && (
                                            <label className="inline-flex items-center gap-1 text-slate-600 cursor-pointer">
                                              <input
                                                type="checkbox"
                                                checked={row.rememberAlias}
                                                onChange={(e) =>
                                                  setRowOverrides((prev) => ({
                                                    ...prev,
                                                    [row.item.messageId]: {
                                                      ...prev[row.item.messageId],
                                                      rememberAlias: e.target.checked,
                                                    },
                                                  }))
                                                }
                                                className="rounded border-slate-300 text-emerald-700 focus:ring-emerald-600"
                                              />
                                              Remember
                                            </label>
                                          )}
                                      </div>
                                    </td>

                                    <td className="py-3 px-3 align-top text-right whitespace-nowrap">
                                      {row.autoConfirmed || row.alreadyPaid ? (
                                        <span
                                          title={row.autoConfirmed ? 'Auto-confirmed' : 'Confirmed'}
                                          className="inline-flex items-center justify-end text-emerald-700"
                                        >
                                          <CheckCircle2 className="w-4 h-4" />
                                        </span>
                                      ) : row.selectedUid ? (
                                        <button
                                          type="button"
                                          disabled={confirming}
                                          onClick={() => handleConfirmReceipts(row)}
                                          title="Confirm paid"
                                          aria-label={`Confirm payment for ${displaySender}`}
                                          className="p-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white transition-colors disabled:opacity-50"
                                        >
                                          <Check className="w-3.5 h-3.5" />
                                        </button>
                                      ) : (
                                        <span className="text-[11px] text-amber-700">—</span>
                                      )}
                                    </td>
                                  </>
                                )}

                                <td className="py-3 px-4 align-top text-right whitespace-nowrap">
                                  <button
                                    type="button"
                                    onClick={() => handleToggleReceiptProof(row)}
                                    title={isProofSelected ? 'Hide email proof' : 'View email proof'}
                                    aria-label={isProofSelected ? 'Hide email proof' : 'View email proof'}
                                    className={`p-1.5 rounded-lg transition-colors ${
                                      isProofSelected
                                        ? 'text-emerald-800 bg-emerald-100'
                                        : 'text-slate-500 hover:text-emerald-700 hover:bg-slate-100'
                                    }`}
                                  >
                                    <FileText className="w-4 h-4" />
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {nextPageToken && (
                    <div className="p-3.5 border-t border-slate-200 bg-slate-50/70 flex justify-center">
                      <button
                        type="button"
                        disabled={loadingMoreReceipts}
                        onClick={() =>
                          accessToken &&
                          loadGmailReceipts(accessToken, {
                            append: true,
                            pageToken: nextPageToken,
                          })
                        }
                        className="px-4 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-xs font-semibold text-slate-700 inline-flex items-center gap-1.5 whitespace-nowrap disabled:opacity-50"
                      >
                        {loadingMoreReceipts && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                        {loadingMoreReceipts ? 'Loading older receipts...' : 'Load Older Receipts'}
                      </button>
                    </div>
                  )}

                  {/* Saved Sender Aliases Drawer (Managers) */}
                  {isManagerOrAdmin && paymentAliases.length > 0 && (
                    <div className="border-t border-slate-200">
                      <button
                        type="button"
                        onClick={() => setShowAliases((prev) => !prev)}
                        className="w-full px-5 py-2.5 flex items-center justify-between text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors"
                      >
                        <span className="inline-flex items-center gap-1.5">
                          <BookmarkCheck className="w-3.5 h-3.5 text-emerald-700" />
                          Saved Sender Aliases ({paymentAliases.length})
                        </span>
                        {showAliases ? (
                          <ChevronUp className="w-3.5 h-3.5" />
                        ) : (
                          <ChevronDown className="w-3.5 h-3.5" />
                        )}
                      </button>

                      {showAliases && (
                        <div className="px-5 pb-4 pt-1 divide-y divide-slate-100">
                          {paymentAliases.map((alias) => {
                            const p = playersById.get(alias.uid);
                            return (
                              <div
                                key={alias.id}
                                className="py-2 flex items-center justify-between gap-3 text-xs"
                              >
                                <div className="min-w-0">
                                  <span className="font-medium text-slate-900">
                                    {alias.senderLabel}
                                  </span>
                                  <span className="text-slate-400 mx-1.5">&rarr;</span>
                                  <span className="font-semibold text-emerald-800">
                                    {p ? `${p.firstName} ${p.lastName}` : alias.uid}
                                  </span>
                                </div>
                                <button
                                  type="button"
                                  disabled={deletingAliasId === alias.id}
                                  onClick={() => handleDeleteAlias(alias.id)}
                                  className="text-slate-400 hover:text-rose-600 p-1 shrink-0 disabled:opacity-40"
                                  title="Remove alias"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* ==================== SHARED SECONDARY EMAIL PROOF INSPECTOR ==================== */}
        {activeProof && (
          <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col max-h-[760px] lg:sticky lg:top-20">
            <div className="px-5 py-4 border-b border-slate-200 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setActiveProof(null)}
                    className="lg:hidden p-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-100"
                    aria-label="Back to payments"
                  >
                    <ArrowLeft className="w-4 h-4" />
                  </button>
                  <h2 className="font-display text-base font-bold text-slate-900">
                    Email Proof
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveProof(null)}
                  title="Close proof"
                  aria-label="Close email proof"
                  className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="pt-2 border-t border-slate-100 flex items-baseline justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-[11px] font-medium text-slate-500">Extracted Sender</div>
                  <div className="text-sm font-bold text-slate-900 truncate">
                    {activeProof.extractedSender || 'Not detected'}
                  </div>
                  {activeProof.matchedPlayerName &&
                    activeProof.matchedPlayerName.toLowerCase() !==
                      (activeProof.extractedSender || '').toLowerCase() && (
                      <div className="text-[11px] text-emerald-700 font-medium truncate">
                        Club member: {activeProof.matchedPlayerName}
                      </div>
                    )}
                </div>
                <div className="text-right shrink-0">
                  <div className="text-[11px] font-medium text-slate-500">Amount</div>
                  <div className="font-mono-tabular text-lg font-bold text-emerald-700">
                    {formatCurrency(activeProof.extractedAmount ?? null, activeProof.currency)}
                  </div>
                </div>
              </div>
            </div>

            <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50/50 space-y-2 text-xs text-slate-600">
              <div className="font-semibold text-slate-900 break-words">
                {activeProof.email.subject}
              </div>
              <div className="space-y-1 text-[11px]">
                <div className="break-all">
                  <span className="font-semibold text-slate-700">From:</span>{' '}
                  {activeProof.email.from}
                </div>
                <div className="font-mono-tabular">
                  <span className="font-semibold text-slate-700 font-sans">Received:</span>{' '}
                  {formatFullDateTime(activeProof.email.internalDateMs, activeProof.email.date)}
                </div>
                {activeProof.referenceCode && (
                  <div className="font-mono-tabular">
                    <span className="font-semibold text-slate-700 font-sans">Reference:</span>{' '}
                    {activeProof.referenceCode}
                  </div>
                )}
              </div>

              {activeProof.email.attachments.length > 0 && (
                <div className="pt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-600">
                  {activeProof.email.attachments.map((att, idx) => (
                    <span key={`${att.filename}_${idx}`} className="inline-flex items-center gap-1">
                      <Paperclip className="w-3 h-3 text-slate-400 shrink-0" />
                      <span className="truncate max-w-[180px] font-medium text-slate-700">
                        {att.filename}
                      </span>
                      {att.size > 0 && (
                        <span className="font-mono-tabular text-slate-400">
                          ({formatFileSize(att.size)})
                        </span>
                      )}
                    </span>
                  ))}
                </div>
              )}

              {activeProof.email.htmlBody && (
                <div className="pt-1 flex items-center justify-between">
                  <span className="text-[11px] text-slate-500">Email format</span>
                  <div className="inline-flex items-center p-0.5 rounded-lg bg-slate-200/70">
                    <button
                      type="button"
                      onClick={() => setProofViewMode('text')}
                      className={`px-2.5 py-1 rounded-md text-[11px] font-semibold whitespace-nowrap transition-colors ${
                        proofViewMode === 'text'
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Plain Text
                    </button>
                    <button
                      type="button"
                      onClick={() => setProofViewMode('rich')}
                      className={`px-2.5 py-1 rounded-md text-[11px] font-semibold whitespace-nowrap transition-colors ${
                        proofViewMode === 'rich'
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      HTML Email
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-5 bg-white">
              {proofViewMode === 'rich' && sandboxedProofHtml ? (
                <iframe
                  title={activeProof.email.subject}
                  sandbox=""
                  srcDoc={sandboxedProofHtml}
                  className="w-full h-[420px] border border-slate-200 rounded-lg bg-white"
                />
              ) : (
                <div className="text-xs text-slate-800 leading-relaxed whitespace-pre-wrap break-words font-sans">
                  {proofPlainText || '(This email has no readable text content.)'}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
