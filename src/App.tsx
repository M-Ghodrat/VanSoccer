import React, { useEffect, useMemo, useRef, useState } from 'react';
import { onIdTokenChanged, signOut, User } from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  AlertTriangle,
  Archive,
  Award,
  BarChart3,
  BellRing,
  BookOpen,
  CalendarCheck,
  CheckCircle2,
  ClipboardList,
  DollarSign,
  LogOut,
  Megaphone,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Shield,
  X,
} from 'lucide-react';
import {
  auth,
  BOOTSTRAPPED_ADMIN_EMAIL,
  db,
  handleFirestoreError,
  OperationType,
} from './firebase';
import {
  ClubNotification,
  ClubPayment,
  ClubSettings,
  DEFAULT_RIBBON_CONFIG,
  DropInMatch,
  EducationPost,
  FinalizedPlayerTeamEntry,
  MatchVote,
  PaymentSenderAlias,
  PlayerPhotoSubmission,
  PlayerPrivateInfo,
  PlayerProfile,
  PlayerRating,
  RibbonConfig,
} from './types';
import {
  DEFAULT_CLUB_SETTINGS,
  DEFAULT_MAX_PLAYERS,
  formatMatchDisplayTitle,
  getMonthKey,
  isRedundantMatchTitle,
  partitionAttendingVotes,
} from './utils/clubUtils';
import { isTestPlayerUid, seedTestPlayers, TEST_PLAYERS_DISMISSED_KEY } from './utils/testPlayers';
import { AuthGate } from './components/AuthGate';
import { ProfileView } from './components/ProfileView';
import { MatchdayView } from './components/MatchdayView';
import { MatchesView } from './components/MatchesView';
import { ManagerHub } from './components/ManagerHub';
import { StatsView } from './components/StatsView';
import { EducationView } from './components/EducationView';
import { AdminHub } from './components/AdminHub';
import { PaymentsHub } from './components/PaymentsHub';
import { ClubRibbon } from './components/ClubRibbon';
import { RibbonManager } from './components/RibbonManager';
import { PlayerRatingDeck } from './components/PlayerRatingDeck';
import { clearGmailAccessToken } from './utils/gmailAuth';

type AppTab =
  | 'lineup'
  | 'matchday'
  | 'matches'
  | 'stats'
  | 'education'
  | 'ratings'
  | 'payments'
  | 'setting'
  | 'admin'
  | 'ribbon'
  | 'profile';

export default function App() {
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [isEmailVerified, setIsEmailVerified] = useState(false);
  const [activeTab, setActiveTab] = useState<AppTab>('matchday');
  const [crestError, setCrestError] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const hasSetInitialRoleTabRef = useRef(false);

  const [myProfile, setMyProfile] = useState<PlayerProfile | null>(null);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [myPrivateInfo, setMyPrivateInfo] = useState<PlayerPrivateInfo | null>(null);
  const [myPhotoSubmission, setMyPhotoSubmission] = useState<PlayerPhotoSubmission | null>(null);

  const [settings, setSettings] = useState<ClubSettings>({
    ...DEFAULT_CLUB_SETTINGS,
    updatedBy: 'system',
  });
  const [ribbonConfig, setRibbonConfig] = useState<RibbonConfig>(DEFAULT_RIBBON_CONFIG);
  const [players, setPlayers] = useState<PlayerProfile[]>([]);
  const [playersLoaded, setPlayersLoaded] = useState(false);
  const autoSeededRef = useRef(false);
  const [matches, setMatches] = useState<DropInMatch[]>([]);
  const [payments, setPayments] = useState<ClubPayment[]>([]);
  const [paymentsLoaded, setPaymentsLoaded] = useState(false);
  const [activeMatchVotes, setActiveMatchVotes] = useState<MatchVote[]>([]);
  const [educationPosts, setEducationPosts] = useState<EducationPost[]>([]);
  const [ratings, setRatings] = useState<PlayerRating[]>([]);
  const [allPrivateInfos, setAllPrivateInfos] = useState<PlayerPrivateInfo[]>([]);
  const [paymentAliases, setPaymentAliases] = useState<PaymentSenderAlias[]>([]);
  const [allPhotoSubmissions, setAllPhotoSubmissions] = useState<PlayerPhotoSubmission[]>([]);
  const [notifications, setNotifications] = useState<ClubNotification[]>([]);

  const [isAdminFlag, setIsAdminFlag] = useState(false);
  const [isManagerFlag, setIsManagerFlag] = useState(false);
  const [clockTickMs, setClockTickMs] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setClockTickMs(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  // Auth + ID token listener (tracks emailVerified transitions cleanly)
  useEffect(() => {
    const unsub = onIdTokenChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      const verified = Boolean(firebaseUser?.emailVerified);
      setIsEmailVerified(verified);
      setAuthReady(true);

      if (!firebaseUser || !verified) {
        setMyProfile(null);
        setProfileLoaded(false);
        setPaymentsLoaded(false);
        setIsAdminFlag(false);
        setIsManagerFlag(false);
        return;
      }

      // Bootstrap admin grant document for runtime admin email
      if (firebaseUser.email?.toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL.toLowerCase()) {
        try {
          const adminDocRef = doc(db, 'admins', firebaseUser.uid);
          const snap = await getDoc(adminDocRef);
          if (!snap.exists()) {
            await setDoc(adminDocRef, {
              uid: firebaseUser.uid,
              email: firebaseUser.email,
              grantedBy: 'bootstrap',
              createdAt: serverTimestamp(),
            });
          }
          setIsAdminFlag(true);
          setIsManagerFlag(true);
        } catch {
          setIsAdminFlag(true);
          setIsManagerFlag(true);
        }
      }
    });
    return () => unsub();
  }, []);

  // Core user + club subscriptions (only when signed in & verified)
  useEffect(() => {
    if (!user || !isEmailVerified) return;

    const unsubs: (() => void)[] = [];

    unsubs.push(
      onSnapshot(
        doc(db, 'players', user.uid),
        (snap) => {
          setMyProfile(snap.exists() ? (snap.data() as PlayerProfile) : null);
          setProfileLoaded(true);
        },
        (err) => handleFirestoreError(err, OperationType.GET, `players/${user.uid}`)
      )
    );

    unsubs.push(
      onSnapshot(
        doc(db, 'player_private', user.uid),
        (snap) => {
          setMyPrivateInfo(snap.exists() ? (snap.data() as PlayerPrivateInfo) : null);
        },
        (err) => handleFirestoreError(err, OperationType.GET, `player_private/${user.uid}`)
      )
    );

    unsubs.push(
      onSnapshot(
        doc(db, 'player_photos', user.uid),
        (snap) => {
          setMyPhotoSubmission(snap.exists() ? (snap.data() as PlayerPhotoSubmission) : null);
        },
        (err) => handleFirestoreError(err, OperationType.GET, `player_photos/${user.uid}`)
      )
    );

    unsubs.push(
      onSnapshot(
        doc(db, 'admins', user.uid),
        (snap) => {
          const bootstrap = user.email?.toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL.toLowerCase();
          setIsAdminFlag(snap.exists() || bootstrap);
        },
        () => {
          const bootstrap = user.email?.toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL.toLowerCase();
          setIsAdminFlag(bootstrap);
        }
      )
    );

    unsubs.push(
      onSnapshot(
        doc(db, 'managers', user.uid),
        (snap) => {
          setIsManagerFlag(snap.exists());
        },
        () => setIsManagerFlag(false)
      )
    );

    unsubs.push(
      onSnapshot(
        doc(db, 'settings', 'clubConfig'),
        (snap) => {
          if (snap.exists()) {
            setSettings(snap.data() as ClubSettings);
          }
        },
        (err) => handleFirestoreError(err, OperationType.GET, 'settings/clubConfig')
      )
    );

    unsubs.push(
      onSnapshot(
        doc(db, 'ribbon', 'config'),
        (snap) => {
          if (snap.exists()) {
            setRibbonConfig(snap.data() as RibbonConfig);
          } else {
            setRibbonConfig(DEFAULT_RIBBON_CONFIG);
          }
        },
        (err) => handleFirestoreError(err, OperationType.GET, 'ribbon/config')
      )
    );

    unsubs.push(
      onSnapshot(
        query(collection(db, 'players'), where('role', 'in', ['player', 'manager', 'admin'])),
        (snap) => {
          setPlayers(snap.docs.map((d) => d.data() as PlayerProfile));
          setPlayersLoaded(true);
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'players')
      )
    );

    unsubs.push(
      onSnapshot(
        query(collection(db, 'matches'), where('status', 'in', ['open', 'locked', 'completed'])),
        (snap) => {
          const items = snap.docs.map((d) => d.data() as DropInMatch);
          items.sort((a, b) => {
            const ta = (a.createdAt as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;
            const tb = (b.createdAt as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;
            return tb - ta;
          });
          setMatches(items);
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'matches')
      )
    );

    unsubs.push(
      onSnapshot(
        query(
          collection(db, 'education_posts'),
          where('category', 'in', ['Tactics', 'Positioning', 'Conditioning', 'Rules & Fair Play'])
        ),
        (snap) => {
          const items = snap.docs.map((d) => d.data() as EducationPost);
          items.sort((a, b) => {
            const ta = (a.createdAt as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;
            const tb = (b.createdAt as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;
            return tb - ta;
          });
          setEducationPosts(items);
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'education_posts')
      )
    );

    unsubs.push(
      onSnapshot(
        query(collection(db, 'payments')),
        (snap) => {
          setPayments(
            snap.docs.map((d) => ({
              id: d.id,
              ...(d.data() as Omit<ClubPayment, 'id'>),
            }))
          );
          setPaymentsLoaded(true);
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'payments')
      )
    );

    unsubs.push(
      onSnapshot(
        query(collection(db, 'notifications'), where('recipientUid', '==', user.uid)),
        (snap) => {
          const items = snap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as Omit<ClubNotification, 'id'>),
          }));
          items.sort((a, b) => {
            const ta = (a.createdAt as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;
            const tb = (b.createdAt as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;
            return tb - ta;
          });
          setNotifications(items);
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'notifications')
      )
    );

    unsubs.push(
      onSnapshot(
        query(collection(db, 'player_ratings'), where('skill', '>=', 0), where('skill', '<=', 100)),
        (snap) => {
          setRatings(
            snap.docs.map((d) => ({
              id: d.id,
              ...(d.data() as Omit<PlayerRating, 'id'>),
            }))
          );
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'player_ratings')
      )
    );

    return () => unsubs.forEach((u) => u());
  }, [user, isEmailVerified]);

  const effectiveRole: 'admin' | 'manager' | 'player' = isAdminFlag
    ? 'admin'
    : isManagerFlag
      ? 'manager'
      : myProfile?.role || 'player';

  const isManagerOrAdmin = effectiveRole === 'manager' || effectiveRole === 'admin';
  const isAdmin = effectiveRole === 'admin';

  // Automatic match archiving at kickoff (managers/admins persist completion + team snapshot)
  useEffect(() => {
    if (!user || !isEmailVerified || !isManagerOrAdmin) return;
    const now = clockTickMs;
    for (const m of matches) {
      if ((m.status === 'open' || m.status === 'locked') && new Date(m.kickoffIso).getTime() <= now) {
        const finalizedPlayerTeams: FinalizedPlayerTeamEntry[] =
          m.finalizedPlayerTeams && m.finalizedPlayerTeams.length > 0
            ? m.finalizedPlayerTeams
            : (m.currentFormation?.teams || []).flatMap((team) =>
                team.players.map((pl) => ({
                  uid: pl.uid,
                  name: pl.name,
                  teamIndex: team.teamIndex,
                  teamColor: team.color,
                  assignedPosition: pl.assignedPosition,
                }))
              );
        setDoc(
          doc(db, 'matches', m.id),
          {
            status: 'completed',
            ...(finalizedPlayerTeams.length > 0 ? { finalizedPlayerTeams } : {}),
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        ).catch(() => {});
      }
    }
  }, [user, isEmailVerified, isManagerOrAdmin, matches, clockTickMs]);

  // Manager/Admin privileged subscriptions
  useEffect(() => {
    if (!user || !isEmailVerified || !isManagerOrAdmin) {
      setAllPrivateInfos([]);
      setPaymentAliases([]);
      setAllPhotoSubmissions([]);
      return;
    }

    const unsubs: (() => void)[] = [];

    unsubs.push(
      onSnapshot(
        query(collection(db, 'payment_aliases'), where('uid', '>', '')),
        (snap) => {
          setPaymentAliases(
            snap.docs.map((d) => ({
              id: d.id,
              ...(d.data() as Omit<PaymentSenderAlias, 'id'>),
            }))
          );
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'payment_aliases')
      )
    );

    if (isAdmin) {
      unsubs.push(
        onSnapshot(
          query(collection(db, 'player_private'), where('uid', '>', '')),
          (snap) => {
            setAllPrivateInfos(snap.docs.map((d) => d.data() as PlayerPrivateInfo));
          },
          (err) => handleFirestoreError(err, OperationType.LIST, 'player_private')
        )
      );

      unsubs.push(
        onSnapshot(
          query(
            collection(db, 'player_photos'),
            where('status', '==', 'pending')
          ),
          (snap) => {
            setAllPhotoSubmissions(snap.docs.map((d) => d.data() as PlayerPhotoSubmission));
          },
          (err) => handleFirestoreError(err, OperationType.LIST, 'player_photos')
        )
      );
    }

    return () => unsubs.forEach((u) => u());
  }, [user, isEmailVerified, isManagerOrAdmin, isAdmin]);

  // Seed 9 removable test players once for admin testing unless explicitly dismissed
  useEffect(() => {
    if (
      !user ||
      !isEmailVerified ||
      !isAdmin ||
      !myProfile ||
      !playersLoaded ||
      autoSeededRef.current
    ) {
      return;
    }

    const hasTestPlayers = players.some((p) => p.uid.startsWith('test_player_'));
    const dismissed = localStorage.getItem(TEST_PLAYERS_DISMISSED_KEY) === 'true';
    if (hasTestPlayers || dismissed) {
      autoSeededRef.current = true;
      return;
    }

    autoSeededRef.current = true;
    seedTestPlayers(user, { ...myProfile, role: 'admin' }).catch(() => {
      autoSeededRef.current = false;
    });
  }, [user, isEmailVerified, isAdmin, myProfile, playersLoaded, players]);

  const activeMatch = useMemo(
    () => matches.find((m) => m.status === 'open' || m.status === 'locked') || null,
    [matches]
  );

  const completedMatches = useMemo(
    () =>
      matches
        .filter((m) => m.status === 'completed')
        .sort((a, b) => new Date(b.kickoffIso).getTime() - new Date(a.kickoffIso).getTime()),
    [matches]
  );

  // Active match votes listener
  useEffect(() => {
    if (!user || !isEmailVerified || !activeMatch) {
      setActiveMatchVotes([]);
      return;
    }

    const unsub = onSnapshot(
      query(
        collection(db, 'matches', activeMatch.id, 'votes'),
        where('matchId', '==', activeMatch.id)
      ),
      (snap) => {
        setActiveMatchVotes(snap.docs.map((d) => d.data() as MatchVote));
      },
      (err) => handleFirestoreError(err, OperationType.LIST, `matches/${activeMatch.id}/votes`)
    );

    return () => unsub();
  }, [user, isEmailVerified, activeMatch]);

  const playersById = useMemo(() => new Map(players.map((p) => [p.uid, p])), [players]);
  const myVoteOnActiveMatch = useMemo(
    () => (user ? activeMatchVotes.find((v) => v.uid === user.uid) || null : null),
    [activeMatchVotes, user]
  );

  // Ensure unpaid members are removed from active match Coming votes & team sheets
  useEffect(() => {
    if (
      !user ||
      !isEmailVerified ||
      !isManagerOrAdmin ||
      !paymentsLoaded ||
      !activeMatch ||
      activeMatch.status === 'completed'
    ) {
      return;
    }

    const matchMonthKey = getMonthKey(activeMatch.kickoffIso);
    const paymentMap = new Map<string, boolean>();
    for (const p of payments) {
      if (p.monthKey === matchMonthKey) {
        paymentMap.set(p.uid, p.paid);
      }
    }

    const isInvalidUnpaid = (uid: string) => {
      const explicitStatus = paymentMap.get(uid);
      if (explicitStatus === false) return true;
      if (explicitStatus === true) return false;
      return !isTestPlayerUid(uid);
    };

    const maxPlayers = settings.maxPlayers ?? DEFAULT_MAX_PLAYERS;
    const { confirmedVotes, waitlistedVotes } = partitionAttendingVotes(activeMatchVotes, maxPlayers);
    const confirmedUidSet = new Set(confirmedVotes.map((v) => v.uid));

    const unpaidComingVotes = activeMatchVotes.filter((v) => v.attending && isInvalidUnpaid(v.uid));
    const formationHasUnpaid = Boolean(
      activeMatch.currentFormation?.teams.some((t) => t.players.some((pl) => isInvalidUnpaid(pl.uid)))
    );

    if (unpaidComingVotes.length === 0 && !formationHasUnpaid) return;

    const batch = writeBatch(db);
    let freedConfirmedSpots = 0;
    for (const v of unpaidComingVotes) {
      batch.delete(doc(db, 'matches', activeMatch.id, 'votes', v.uid));
      if (confirmedUidSet.has(v.uid)) {
        freedConfirmedSpots += 1;
      }
    }

    if (freedConfirmedSpots > 0) {
      const eligibleWaitlist = waitlistedVotes.filter((w) => !isInvalidUnpaid(w.uid));
      const promotedList = eligibleWaitlist.slice(0, freedConfirmedSpots);
      promotedList.forEach((promoted, idx) => {
        if (!playersById.has(promoted.uid)) return;
        const notifId = `notif_${Date.now()}_${idx}_${promoted.uid.slice(0, 12)}`;
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
      });
    }

    if (formationHasUnpaid && activeMatch.currentFormation) {
      const cleanedFormation = {
        ...activeMatch.currentFormation,
        teams: activeMatch.currentFormation.teams.map((t) => ({
          ...t,
          players: t.players.filter((pl) => !isInvalidUnpaid(pl.uid)),
        })),
      };
      batch.update(doc(db, 'matches', activeMatch.id), {
        currentFormation: cleanedFormation,
        updatedAt: serverTimestamp(),
      });
    }
    batch.commit().catch(() => {});
  }, [user, isEmailVerified, isManagerOrAdmin, paymentsLoaded, activeMatch, activeMatchVotes, payments, settings.maxPlayers, playersById]);

  // Default managers/admins to Lineup on first profile load, and keep non-managers off restricted tabs
  useEffect(() => {
    if (!user || !isEmailVerified) {
      hasSetInitialRoleTabRef.current = false;
      return;
    }
    if (!profileLoaded) return;

    if (!hasSetInitialRoleTabRef.current) {
      hasSetInitialRoleTabRef.current = true;
      if (isManagerOrAdmin) {
        setActiveTab('lineup');
      }
      return;
    }

    const managerOnlyTabs: AppTab[] = ['lineup', 'payments', 'setting'];
    if (!isManagerOrAdmin && managerOnlyTabs.includes(activeTab)) {
      setActiveTab('matchday');
    } else if (!isAdmin && (activeTab === 'admin' || activeTab === 'ribbon')) {
      setActiveTab(isManagerOrAdmin ? 'lineup' : 'matchday');
    }
  }, [user, isEmailVerified, profileLoaded, isManagerOrAdmin, isAdmin, activeTab]);

  if (!authReady) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-sm font-medium text-slate-600">Loading Perspolis VFC Society...</div>
      </div>
    );
  }

  if (!user || !isEmailVerified) {
    return (
      <AuthGate
        unverifiedUser={user && !isEmailVerified ? user : null}
        onUserVerified={async () => {
          const current = auth.currentUser;
          if (!current) return;
          await current.reload();
          await current.getIdToken(true);
          setUser(auth.currentUser);
          setIsEmailVerified(Boolean(auth.currentUser?.emailVerified));
        }}
      />
    );
  }

  if (!profileLoaded) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-sm font-medium text-slate-600">Loading player roster...</div>
      </div>
    );
  }

  const effectiveProfile: PlayerProfile | null = myProfile
    ? { ...myProfile, role: effectiveRole }
    : null;

  const navItems: {
    id: AppTab;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    visible: boolean;
    disabled?: boolean;
    tier: 'player' | 'manager' | 'admin';
  }[] = [
    { id: 'lineup', label: 'Match', icon: ClipboardList, visible: isManagerOrAdmin, tier: 'manager' },
    { id: 'matchday', label: 'Matchday', icon: CalendarCheck, visible: true, tier: 'player' },
    { id: 'matches', label: 'Matches Archive', icon: Archive, visible: true, tier: 'player' },
    { id: 'stats', label: 'Stats', icon: BarChart3, visible: true, tier: 'player' },
    { id: 'ratings', label: 'Player Cards', icon: Award, visible: true, tier: 'player' },
    { id: 'payments', label: 'Payments', icon: DollarSign, visible: isManagerOrAdmin, tier: 'manager' },
    { id: 'setting', label: 'Setting', icon: Settings, visible: isManagerOrAdmin, tier: 'manager' },
    { id: 'education', label: 'Education', icon: BookOpen, visible: true, disabled: true, tier: 'player' },
    { id: 'admin', label: 'Admin', icon: Shield, visible: isAdmin, tier: 'admin' },
    { id: 'ribbon', label: 'Ribbon', icon: Megaphone, visible: isAdmin, tier: 'admin' },
  ];

  const visibleNavItems = navItems.filter((item) => item.visible);
  const activeNavItem =
    activeTab === 'profile'
      ? { label: 'Profile' }
      : visibleNavItems.find((item) => item.id === activeTab) || visibleNavItems[0];

  const unreadNotifications = notifications.filter((n) => !n.read);

  const dismissNotification = async (notifId: string) => {
    try {
      await updateDoc(doc(db, 'notifications', notifId), { read: true });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `notifications/${notifId}`);
    }
  };

  const showUnvotedNotice =
    Boolean(effectiveProfile) &&
    Boolean(activeMatch) &&
    activeMatch?.status !== 'completed' &&
    !myVoteOnActiveMatch;

  const showPhotoNotice =
    Boolean(effectiveProfile) &&
    effectiveProfile?.photoStatus !== 'approved';

  const handleSelectTab = (tabId: AppTab) => {
    if (tabId === 'education') return;
    setActiveTab(tabId);
    setMobileMenuOpen(false);
  };

  const getNavButtonClasses = (
    _tier: 'player' | 'manager' | 'admin',
    isActive: boolean,
    isDisabled: boolean
  ) => {
    if (isDisabled) {
      return 'text-slate-300 cursor-not-allowed border border-transparent';
    }
    return isActive
      ? 'bg-emerald-50 text-emerald-800 font-semibold border border-emerald-200/70'
      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 border border-transparent';
  };

  const getNavIconClasses = (
    _tier: 'player' | 'manager' | 'admin',
    isActive: boolean,
    isDisabled: boolean
  ) => {
    if (isDisabled) return 'text-slate-300';
    return isActive ? 'text-emerald-700' : 'text-slate-500';
  };

  const handleSignOut = () => {
    clearGmailAccessToken();
    signOut(auth);
  };

  const userInitials = effectiveProfile
    ? `${effectiveProfile.firstName[0] || ''}${effectiveProfile.lastName[0] || ''}`.toUpperCase()
    : (user.email?.[0] || 'U').toUpperCase();

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col md:flex-row">
      {/* Mobile Compact Header (< md) */}
      <div className="md:hidden sticky top-0 z-30 h-12 bg-white border-b border-slate-200 px-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {effectiveProfile && (
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open menu"
              title="Menu"
              className="p-2 rounded-lg text-slate-700 hover:bg-slate-100 transition-colors"
            >
              <Menu className="w-5 h-5" />
            </button>
          )}
          <button
            type="button"
            onClick={() => handleSelectTab(isManagerOrAdmin ? 'lineup' : 'matchday')}
            aria-label="Perspolis Vancouver"
            className="flex items-center gap-2 min-w-0"
          >
            {!crestError ? (
              effectiveProfile ? (
                <>
                  <img
                    src="/assets/aistudio/perspolis_icon.png"
                    alt="Perspolis Vancouver"
                    referrerPolicy="no-referrer"
                    onError={() => setCrestError(true)}
                    className="w-7 h-7 object-contain shrink-0"
                  />
                  <span className="font-display text-base font-bold tracking-tight text-slate-900 truncate">
                    {activeNavItem?.label}
                  </span>
                </>
              ) : (
                <img
                  src="/assets/aistudio/perspolis_logo.png"
                  alt="Perspolis Vancouver"
                  referrerPolicy="no-referrer"
                  onError={() => setCrestError(true)}
                  className="h-7 w-auto object-contain shrink-0"
                />
              )
            ) : (
              <span className="w-7 h-7 rounded-md bg-red-700 text-white font-display font-bold text-xs flex items-center justify-center shrink-0">
                P
              </span>
            )}
          </button>
        </div>

        <button
          type="button"
          onClick={handleSignOut}
          aria-label="Sign Out"
          title="Sign Out"
          className="p-2 rounded-lg text-slate-500 hover:text-rose-700 hover:bg-slate-100 transition-colors shrink-0"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>

      {/* Mobile Slide-Over Left Drawer */}
      {mobileMenuOpen && effectiveProfile && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div
            className="fixed inset-0 bg-slate-900/40"
            onClick={() => setMobileMenuOpen(false)}
            aria-hidden="true"
          />
          <aside className="relative w-60 max-w-[80vw] bg-white border-r border-slate-200 h-full flex flex-col z-10">
            <div className="h-14 px-3.5 border-b border-slate-200 flex items-center justify-between gap-2">
              <div className="flex items-center min-w-0">
                {!crestError ? (
                  <img
                    src="/assets/aistudio/perspolis_logo.png"
                    alt="Perspolis Vancouver"
                    referrerPolicy="no-referrer"
                    onError={() => setCrestError(true)}
                    className="h-8 w-auto max-w-[160px] object-contain shrink-0"
                  />
                ) : (
                  <span className="w-7 h-7 rounded-md bg-red-700 text-white font-display font-bold text-xs flex items-center justify-center shrink-0">
                    P
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                aria-label="Close menu"
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <nav className="flex-1 p-2.5 space-y-1 overflow-y-auto">
              {visibleNavItems.map((item) => {
                const Icon = item.icon;
                const isActive = activeTab === item.id;
                const isDisabled = Boolean(item.disabled);
                return (
                  <button
                    key={item.id}
                    type="button"
                    disabled={isDisabled}
                    aria-disabled={isDisabled || undefined}
                    onClick={() => {
                      if (!isDisabled) handleSelectTab(item.id);
                    }}
                    className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${getNavButtonClasses(
                      item.tier,
                      isActive,
                      isDisabled
                    )}`}
                  >
                    <span className="flex items-center gap-3 min-w-0">
                      <Icon
                        className={`w-4 h-4 shrink-0 ${getNavIconClasses(
                          item.tier,
                          isActive,
                          isDisabled
                        )}`}
                      />
                      <span className="truncate">{item.label}</span>
                    </span>
                    {item.tier === 'manager' && (
                      <span
                        className={`text-[9px] font-mono-tabular font-bold uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0 ${
                          isActive
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-slate-100 text-slate-500'
                        }`}
                      >
                        MGR
                      </span>
                    )}
                    {item.tier === 'admin' && (
                      <span
                        className={`text-[9px] font-mono-tabular font-bold uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0 ${
                          isActive
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        ADM
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>

            <div className="p-3 border-t border-slate-200 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => handleSelectTab('profile')}
                title="Open Profile"
                className={`flex items-center gap-2.5 min-w-0 flex-1 text-left p-1 rounded-lg transition-colors ${
                  activeTab === 'profile' ? 'bg-emerald-50 ring-1 ring-emerald-200' : 'hover:bg-slate-50'
                }`}
              >
                {effectiveProfile.approvedPhotoUrl ? (
                  <img
                    src={effectiveProfile.approvedPhotoUrl}
                    alt={effectiveProfile.firstName}
                    className="w-7 h-7 rounded-full object-cover border border-slate-200 shrink-0"
                  />
                ) : (
                  <span className="w-7 h-7 rounded-full bg-slate-100 border border-slate-200 text-slate-700 text-[11px] font-bold flex items-center justify-center shrink-0">
                    {userInitials}
                  </span>
                )}
                <span className="text-xs font-semibold text-slate-800 truncate">
                  {effectiveProfile.firstName} {effectiveProfile.lastName}
                </span>
              </button>
              <button
                type="button"
                onClick={handleSignOut}
                aria-label="Sign Out"
                title="Sign Out"
                className="p-2 rounded-lg text-slate-500 hover:text-rose-700 hover:bg-rose-50 transition-colors shrink-0"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* Desktop Left Sidebar (md+) */}
      <aside
        className={`hidden md:flex flex-col sticky top-0 h-screen bg-white border-r border-slate-200 shrink-0 transition-[width] duration-150 z-30 ${
          sidebarCollapsed ? 'w-16' : 'w-56'
        }`}
      >
        {/* Brand + Collapse Toggle */}
        <div
          className={`h-14 border-b border-slate-200 flex items-center shrink-0 ${
            sidebarCollapsed ? 'justify-center px-2' : 'justify-between px-3.5'
          }`}
        >
          <button
            type="button"
            onClick={() => handleSelectTab(isManagerOrAdmin ? 'lineup' : 'matchday')}
            title="Perspolis Vancouver"
            aria-label="Perspolis Vancouver"
            className="flex items-center min-w-0 text-left"
          >
            {!crestError ? (
              sidebarCollapsed ? (
                <img
                  src="/assets/aistudio/perspolis_icon.png"
                  alt="Perspolis Vancouver"
                  referrerPolicy="no-referrer"
                  onError={() => setCrestError(true)}
                  className="w-8 h-8 object-contain shrink-0"
                />
              ) : (
                <img
                  src="/assets/aistudio/perspolis_logo.png"
                  alt="Perspolis Vancouver"
                  referrerPolicy="no-referrer"
                  onError={() => setCrestError(true)}
                  className="h-9 w-auto max-w-[152px] object-contain shrink-0"
                />
              )
            ) : (
              <span className="w-8 h-8 rounded-md bg-red-700 text-white font-display font-bold text-sm flex items-center justify-center shrink-0">
                P
              </span>
            )}
          </button>

          {!sidebarCollapsed && (
            <button
              type="button"
              onClick={() => setSidebarCollapsed(true)}
              aria-label="Collapse sidebar"
              title="Collapse sidebar"
              className="p-1.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors shrink-0"
            >
              <PanelLeftClose className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Navigation Links */}
        {effectiveProfile ? (
          <nav className="flex-1 p-2 space-y-1 overflow-y-auto">
            {visibleNavItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              const isDisabled = Boolean(item.disabled);
              return (
                <button
                  key={item.id}
                  type="button"
                  disabled={isDisabled}
                  aria-disabled={isDisabled || undefined}
                  onClick={() => {
                    if (!isDisabled) handleSelectTab(item.id);
                  }}
                  title={
                    isDisabled
                      ? `${item.label} (Inactive)`
                      : item.tier === 'manager'
                        ? `${item.label} (Manager)`
                        : item.tier === 'admin'
                          ? `${item.label} (Admin)`
                          : item.label
                  }
                  aria-label={item.label}
                  className={`w-full flex items-center rounded-lg text-sm transition-colors ${
                    sidebarCollapsed ? 'justify-center p-2.5' : 'justify-between gap-2 px-3 py-2'
                  } ${getNavButtonClasses(item.tier, isActive, isDisabled)}`}
                >
                  <span className={`flex items-center min-w-0 ${sidebarCollapsed ? '' : 'gap-2.5'}`}>
                    <Icon
                      className={`w-[18px] h-[18px] shrink-0 ${getNavIconClasses(
                        item.tier,
                        isActive,
                        isDisabled
                      )}`}
                    />
                    {!sidebarCollapsed && <span className="truncate">{item.label}</span>}
                  </span>
                  {!sidebarCollapsed && item.tier === 'manager' && (
                    <span
                      className={`text-[9px] font-mono-tabular font-bold uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0 ${
                        isActive
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      MGR
                    </span>
                  )}
                  {!sidebarCollapsed && item.tier === 'admin' && (
                    <span
                      className={`text-[9px] font-mono-tabular font-bold uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0 ${
                        isActive
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      ADM
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        ) : (
          <div className="flex-1" />
        )}

        {/* Sidebar Footer: Expand toggle (when collapsed) + User Profile Trigger + Sign Out icon */}
        <div className="p-2 border-t border-slate-200 space-y-1.5 shrink-0">
          {sidebarCollapsed && (
            <button
              type="button"
              onClick={() => setSidebarCollapsed(false)}
              aria-label="Expand sidebar"
              title="Expand sidebar"
              className="w-full flex items-center justify-center p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
            >
              <PanelLeftOpen className="w-4 h-4" />
            </button>
          )}

          <div
            className={`flex items-center ${
              sidebarCollapsed ? 'flex-col gap-1.5 py-1' : 'justify-between gap-2 px-1.5 py-1'
            }`}
          >
            {effectiveProfile && (
              <button
                type="button"
                onClick={() => handleSelectTab('profile')}
                title={`${effectiveProfile.firstName} ${effectiveProfile.lastName} — Profile`}
                className={`flex items-center gap-2.5 min-w-0 text-left rounded-lg transition-colors ${
                  activeTab === 'profile'
                    ? 'bg-emerald-50 ring-1 ring-emerald-200'
                    : 'hover:bg-slate-50'
                } ${sidebarCollapsed ? 'p-1' : 'flex-1 py-1 px-1.5'}`}
              >
                {effectiveProfile.approvedPhotoUrl ? (
                  <img
                    src={effectiveProfile.approvedPhotoUrl}
                    alt={effectiveProfile.firstName}
                    className="w-7 h-7 rounded-full object-cover border border-slate-200 shrink-0"
                  />
                ) : (
                  <span className="w-7 h-7 rounded-full bg-slate-100 border border-slate-200 text-slate-700 text-[11px] font-bold flex items-center justify-center shrink-0">
                    {userInitials}
                  </span>
                )}
                {!sidebarCollapsed && (
                  <span className="text-xs font-semibold text-slate-800 truncate">
                    {effectiveProfile.firstName} {effectiveProfile.lastName}
                  </span>
                )}
              </button>
            )}

            <button
              type="button"
              onClick={handleSignOut}
              aria-label="Sign Out"
              title="Sign Out"
              className="p-2 rounded-lg text-slate-500 hover:text-rose-700 hover:bg-rose-50 transition-colors shrink-0"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Workspace Column */}
      <div className="flex-1 min-w-0 flex flex-col">
        {effectiveProfile && <ClubRibbon config={ribbonConfig} playersById={playersById} />}

        <main className="flex-1 min-w-0 max-w-6xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-5">
        {!effectiveProfile ? (
          <ProfileView
            user={user}
            profile={null}
            privateInfo={myPrivateInfo}
            photoSubmission={myPhotoSubmission}
            isOnboarding={true}
          />
        ) : (
          <>
            {/* Compact Single-Line Actionable Notifications */}
            {(unreadNotifications.length > 0 || showUnvotedNotice || showPhotoNotice) && (
              <div className="space-y-2">
                {unreadNotifications.map((notif) => (
                  <div
                    key={notif.id}
                    className="px-3.5 py-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-950 flex items-center justify-between gap-3 text-xs"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
                      <span className="font-medium truncate">
                        {isRedundantMatchTitle(notif.matchTitle)
                          ? 'Spot opened — Matchday'
                          : `Spot opened — ${notif.matchTitle}`}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {activeTab !== 'matchday' && (
                        <button
                          type="button"
                          onClick={() => {
                            dismissNotification(notif.id);
                            handleSelectTab('matchday');
                          }}
                          className="px-2.5 py-1 rounded-md bg-emerald-700 hover:bg-emerald-800 text-white font-semibold whitespace-nowrap"
                        >
                          Matchday
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => dismissNotification(notif.id)}
                        aria-label="Dismiss notification"
                        title="Dismiss"
                        className="p-1 rounded-md text-emerald-800 hover:bg-emerald-100"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}

                {showUnvotedNotice && activeMatch && activeTab !== 'matchday' && (
                  <div className="px-3.5 py-2.5 rounded-xl bg-emerald-900 text-white flex items-center justify-between gap-3 text-xs">
                    <div className="flex items-center gap-2 min-w-0">
                      <BellRing className="w-4 h-4 text-emerald-300 shrink-0" />
                      <span className="font-medium truncate">
                        Poll open: {formatMatchDisplayTitle(activeMatch)}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleSelectTab('matchday')}
                      className="px-2.5 py-1 rounded-md bg-white text-emerald-950 hover:bg-emerald-50 font-semibold whitespace-nowrap shrink-0"
                    >
                      Vote
                    </button>
                  </div>
                )}

                {showPhotoNotice && activeTab !== 'profile' && (
                  <div className="px-3.5 py-2 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 flex items-center justify-between gap-3 text-xs">
                    <div className="flex items-center gap-2 min-w-0">
                      <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                      <span className="truncate">
                        {effectiveProfile.photoStatus === 'pending'
                          ? 'Photo pending approval'
                          : effectiveProfile.photoStatus === 'rejected'
                            ? 'Photo declined — upload a new one'
                            : 'Profile photo missing'}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleSelectTab('profile')}
                      className="font-semibold text-amber-950 hover:underline whitespace-nowrap shrink-0"
                    >
                      Profile
                    </button>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'matchday' && (
              <MatchdayView
                user={user}
                profile={effectiveProfile}
                settings={settings}
                activeMatch={activeMatch}
                votes={activeMatchVotes}
                payments={payments}
                playersById={playersById}
              />
            )}

            {activeTab === 'matches' && (
              <MatchesView
                currentUserId={user.uid}
                matches={matches}
                activeMatch={activeMatch}
                activeMatchVotes={activeMatchVotes}
                playersById={playersById}
                maxPlayers={settings.maxPlayers ?? DEFAULT_MAX_PLAYERS}
                onNavigateMatchday={() => setActiveTab('matchday')}
                onNavigateManager={isManagerOrAdmin ? () => setActiveTab('lineup') : undefined}
              />
            )}

            {activeTab === 'stats' && (
              <StatsView
                currentUserId={user.uid}
                players={players}
                completedMatches={completedMatches}
              />
            )}

            {activeTab === 'ratings' && (
              <PlayerRatingDeck
                user={user}
                profile={effectiveProfile}
                players={players}
                ratings={ratings}
                completedMatches={completedMatches}
                skillArrowThresholds={settings.skillArrowThresholds}
                canEdit={isManagerOrAdmin}
              />
            )}

            {activeTab === 'education' && (
              <EducationView
                user={user}
                profile={effectiveProfile}
                posts={educationPosts}
              />
            )}

            {activeTab === 'payments' && isManagerOrAdmin && (
              <PaymentsHub
                user={user}
                isManagerOrAdmin={isManagerOrAdmin}
                players={players}
                privateInfos={allPrivateInfos}
                payments={payments}
                paymentAliases={paymentAliases}
                activeMatch={activeMatch}
                votes={activeMatchVotes}
                maxPlayers={settings.maxPlayers ?? DEFAULT_MAX_PLAYERS}
              />
            )}

            {(activeTab === 'lineup' || activeTab === 'setting') &&
              isManagerOrAdmin && (
                <ManagerHub
                  user={user}
                  profile={effectiveProfile}
                  settings={settings}
                  activeMatch={activeMatch}
                  completedMatches={completedMatches}
                  votes={activeMatchVotes}
                  payments={payments}
                  players={players}
                  ratings={ratings}
                  subTab={activeTab === 'setting' ? 'schedule' : 'formation'}
                  onSubTabChange={(next) => {
                    if (next === 'scouting') setActiveTab('ratings');
                    else if (next === 'schedule') setActiveTab('setting');
                    else setActiveTab('lineup');
                  }}
                />
              )}

            {activeTab === 'admin' && isAdmin && (
              <AdminHub
                user={user}
                profile={effectiveProfile}
                players={players}
                privateInfos={allPrivateInfos}
                photoSubmissions={allPhotoSubmissions}
                ratings={ratings}
                matches={matches}
              />
            )}

            {activeTab === 'ribbon' && isAdmin && (
              <RibbonManager
                user={user}
                ribbonConfig={ribbonConfig}
                players={players}
              />
            )}

            {activeTab === 'profile' && (
              <ProfileView
                user={user}
                profile={effectiveProfile}
                privateInfo={myPrivateInfo}
                photoSubmission={myPhotoSubmission}
                isOnboarding={false}
              />
            )}
          </>
        )}
        </main>
      </div>
    </div>
  );
}
