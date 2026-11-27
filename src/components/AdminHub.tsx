import { savePlayerBusinesses } from '../utils/playerBusinesses';
import React, { useEffect, useMemo, useState } from 'react';
import { User } from 'firebase/auth';
import { collection, onSnapshot, deleteDoc, doc, getDoc, serverTimestamp, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import {
  Briefcase,
  Camera,
  Check,
  CheckCircle2,
  Crop,
  ImagePlus,
  Pencil,
  Plus,
  Search,
  Shield,
  Trash2,
  Upload,
  User as UserIcon,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import {
  DropInMatch,
  getPlayerBusinesses,
  MAX_PLAYER_BUSINESSES,
  normalizeSafeHttpUrl,
  normalizeSafeImageUrl,
  PlayerBusinessInfo,
  PlayerPhotoSubmission,
  PlayerPrivateInfo,
  PlayerProfile,
  PlayerRating,
  UserRole,
} from '../types';
import { isTestPlayerUid, removeAllTestPlayers, seedTestPlayers } from '../utils/testPlayers';
import { compressBrandImageFile } from '../utils/imageUpload';
import { formatPhoneNumber } from '../utils/phone';
import { BusinessCategorySelect } from './BusinessCategorySelect';
import { CircularPhotoCropper, CroppedPhotoResult } from './CircularPhotoCropper';
import { PlayerKitShouldersSvg } from './SoccerPitch';

function makeBusinessId(): string {
  return `biz_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function sanitizeBusinessEntry(biz: PlayerBusinessInfo): PlayerBusinessInfo {
  const safeId =
    biz.id && /^[a-zA-Z0-9_-]{1,64}$/.test(biz.id) ? biz.id : makeBusinessId();
  const safeUrl = biz.website ? normalizeSafeHttpUrl(biz.website) : '';
  const safeLogo = biz.logoUrl ? normalizeSafeImageUrl(biz.logoUrl) : '';
  return {
    id: safeId,
    businessName: biz.businessName.trim().slice(0, 80),
    category: (biz.category || '').trim().slice(0, 50),
    tagline: (biz.tagline || '').trim().slice(0, 160),
    phone: formatPhoneNumber(biz.phone),
    website: safeUrl,
    address: (biz.address || '').trim().slice(0, 120),
    logoUrl: safeLogo,
    allowPromotion: biz.allowPromotion !== false,
  };
}

interface AdminHubProps {
  user: User;
  profile: PlayerProfile;
  players: PlayerProfile[];
  privateInfos: PlayerPrivateInfo[];
  photoSubmissions: PlayerPhotoSubmission[];
  ratings: PlayerRating[];
  matches: DropInMatch[];
  initialSubTab?: 'photos' | 'roles' | 'directory';
}

export const AdminHub: React.FC<AdminHubProps> = ({
  user,
  profile,
  players,
  privateInfos,
  photoSubmissions,
  ratings,
  matches,
  initialSubTab,
}) => {
  const [subTab, setSubTab] = useState<'photos' | 'roles' | 'directory'>(() => {
    return initialSubTab || 'directory';
  });
  const [rejectionNotes, setRejectionNotes] = useState<Record<string, string>>({});
  const [busyUid, setBusyUid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [adminCropTarget, setAdminCropTarget] = useState<{
    mode: 'pending' | 'approved';
    uid: string;
    playerName: string;
    imageSrc: string;
    initialSkinTone?: string;
  } | null>(null);
  const [savingCroppedPhoto, setSavingCroppedPhoto] = useState(false);

  // Business management state (used in Directory member actions)
  const [directorySearch, setDirectorySearch] = useState('');
  const [editingBusinessTarget, setEditingBusinessTarget] = useState<{
    playerUid: string;
    business: PlayerBusinessInfo | null;
  } | null>(null);
  const [deletingBusinessTarget, setDeletingBusinessTarget] = useState<{
    playerUid: string;
    business: PlayerBusinessInfo;
  } | null>(null);
  const [savingBusiness, setSavingBusiness] = useState(false);
  const [uploadingBizLogo, setUploadingBizLogo] = useState(false);

  // Modal form fields
  const [formPlayerUid, setFormPlayerUid] = useState('');
  const [formBizId, setFormBizId] = useState('');
  const [formBizName, setFormBizName] = useState('');
  const [formBizCategory, setFormBizCategory] = useState('');
  const [formBizTagline, setFormBizTagline] = useState('');
  const [formBizPhone, setFormBizPhone] = useState('');
  const [formBizWebsite, setFormBizWebsite] = useState('');
  const [formBizAddress, setFormBizAddress] = useState('');
  const [formBizLogoUrl, setFormBizLogoUrl] = useState('');
  const [formBizAllowPromotion, setFormBizAllowPromotion] = useState(true);

  const [privateBusinesses, setPrivateBusinesses] = useState<Map<string, PlayerBusinessInfo[]> | null>(null);
  useEffect(() => onSnapshot(collection(db, 'player_business_private'), (snapshot) => {
    setPrivateBusinesses(new Map(snapshot.docs.map((record) => [record.id, record.data().businesses])));
  }, (error) => setError(error.message)), []);
  const businessEntries = (player: PlayerProfile) => getPlayerBusinesses({
    businesses: [...getPlayerBusinesses(player), ...(privateBusinesses?.get(player.uid) ?? [])],
  });

  const [approvedUids, setApprovedUids] = useState<Set<string>>(new Set());
  useEffect(() => onSnapshot(collection(db, 'members'), (snapshot) => {
    setApprovedUids(new Set(snapshot.docs.map((record) => record.id)));
  }, (error) => setError(error.message)), []);

  const changeMembership = async (uid: string, approve: boolean) => {
    setError(null);
    try {
      const member = doc(db, 'members', uid);
      if (approve) {
        await setDoc(member, { approvedBy: user.uid, approvedAt: serverTimestamp() });
      } else {
        await deleteDoc(member);
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not update membership.');
    }
  };

  const playersById = useMemo(() => new Map(players.map((p) => [p.uid, p])), [players]);
  const privateById = useMemo(() => new Map(privateInfos.map((i) => [i.uid, i])), [privateInfos]);

  const [fallbackSubmissions, setFallbackSubmissions] = useState<PlayerPhotoSubmission[]>([]);

  useEffect(() => {
    let cancelled = false;
    const pendingPlayers = players.filter((p) => p.photoStatus === 'pending');
    const missingFromList = pendingPlayers.filter(
      (p) => !photoSubmissions.some((s) => s.uid === p.uid)
    );

    if (missingFromList.length === 0) {
      setFallbackSubmissions([]);
      return;
    }

    Promise.all(
      missingFromList.map(async (p) => {
        try {
          const snap = await getDoc(doc(db, 'player_photos', p.uid));
          if (snap.exists()) {
            return snap.data() as PlayerPhotoSubmission;
          }
        } catch {
          // ignore
        }
        return null;
      })
    ).then((results) => {
      if (!cancelled) {
        setFallbackSubmissions(
          results.filter((item): item is PlayerPhotoSubmission => Boolean(item && item.pendingPhotoData))
        );
      }
    });

    return () => {
      cancelled = true;
    };
  }, [players, photoSubmissions]);

  const pendingPhotos = useMemo(() => {
    const byUid = new Map<string, PlayerPhotoSubmission>();
    for (const s of photoSubmissions) {
      if (s.status === 'pending') byUid.set(s.uid, s);
    }
    for (const s of fallbackSubmissions) {
      if (!byUid.has(s.uid)) byUid.set(s.uid, s);
    }
    return Array.from(byUid.values());
  }, [photoSubmissions, fallbackSubmissions]);

  const orphanedPendingPlayers = useMemo(
    () =>
      players.filter(
        (p) =>
          p.photoStatus === 'pending' &&
          !pendingPhotos.some((sub) => sub.uid === p.uid)
      ),
    [players, pendingPhotos]
  );

  // Automatically adjust subTab if initialSubTab prop changes or if photos subtab is active with 0 photos left
  useEffect(() => {
    if (initialSubTab) {
      setSubTab(initialSubTab);
    }
  }, [initialSubTab]);

  useEffect(() => {
    // If photos subtab is active but there are no photos pending review, switch to directory
    if (subTab === 'photos' && pendingPhotos.length === 0 && orphanedPendingPlayers.length === 0) {
      setSubTab('directory');
    }
  }, [subTab, pendingPhotos.length, orphanedPendingPlayers.length]);

  const filteredDirectoryPlayers = useMemo(() => {
    const term = directorySearch.trim().toLowerCase();
    if (!term) return players;
    return players.filter((p) => {
      const priv = privateById.get(p.uid);
      const name = `${p.firstName} ${p.lastName}`.toLowerCase();
      const email = (priv?.email || '').toLowerCase();
      const phone = formatPhoneNumber(priv?.phone).toLowerCase();
      const em = formatPhoneNumber(priv?.emergencyContact).toLowerCase();
      const bList = businessEntries(p);
      const bNames = bList.map((b) => b.businessName.toLowerCase()).join(' ');
      return (
        name.includes(term) ||
        email.includes(term) ||
        phone.includes(term) ||
        em.includes(term) ||
        bNames.includes(term)
      );
    });
  }, [players, privateById, directorySearch]);

  const handleResetOrphanedStatus = async (player: PlayerProfile) => {
    setError(null);
    setNotice(null);
    setBusyUid(player.uid);
    try {
      await updateDoc(doc(db, 'players', player.uid), {
        photoStatus: 'none',
        updatedAt: serverTimestamp(),
      });
      setNotice(`Cleared incomplete photo status for ${player.firstName} ${player.lastName}. They can upload a photo cleanly now.`);
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.UPDATE, `players/${player.uid}`);
      } catch (wrapped) {
        setError(wrapped instanceof Error ? wrapped.message : 'Failed to reset status.');
      }
    } finally {
      setBusyUid(null);
    }
  };

  const handlePhotoDecision = async (submission: PlayerPhotoSubmission, approve: boolean) => {
    setError(null);
    setNotice(null);
    setBusyUid(submission.uid);
    const player = playersById.get(submission.uid);
    const reason = (rejectionNotes[submission.uid] || 'Please upload a clearer face photo.').slice(0, 300);

    try {
      const hasPlayerDoc = Boolean(player) || (await getDoc(doc(db, 'players', submission.uid))).exists();
      const batch = writeBatch(db);
      batch.update(doc(db, 'player_photos', submission.uid), {
        status: approve ? 'approved' : 'rejected',
        rejectionReason: approve ? '' : reason,
      });
      if (hasPlayerDoc) {
        batch.update(doc(db, 'players', submission.uid), {
          photoStatus: approve ? 'approved' : 'rejected',
          approvedPhotoUrl: approve ? submission.pendingPhotoData : '',
          approvedPitchPhotoUrl: approve
            ? submission.pendingPitchPhotoData || submission.pendingPhotoData
            : '',
          pitchSkinTone: approve
            ? submission.pitchSkinTone || ''
            : player?.pitchSkinTone || '',
          updatedAt: serverTimestamp(),
        });
      }
      await batch.commit();

      setFallbackSubmissions((prev) => prev.filter((s) => s.uid !== submission.uid));
      setNotice(
        approve
          ? `Approved photo for ${player ? `${player.firstName} ${player.lastName}` : submission.uid}. Their warning banner has been cleared.`
          : `Declined photo for ${player ? `${player.firstName} ${player.lastName}` : submission.uid}.`
      );
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.UPDATE, `player_photos/${submission.uid}`);
      } catch (wrapped) {
        setError(wrapped instanceof Error ? wrapped.message : 'Failed to process photo review.');
      }
    } finally {
      setBusyUid(null);
    }
  };

  const handleAdminUploadPhotoFile = (
    targetPlayer: PlayerProfile,
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null);
    setNotice(null);

    const reader = new FileReader();
    reader.onerror = () => setError('Could not read the selected image file.');
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setAdminCropTarget({
          mode: 'approved',
          uid: targetPlayer.uid,
          playerName: `${targetPlayer.firstName} ${targetPlayer.lastName}`,
          imageSrc: reader.result,
          initialSkinTone: targetPlayer.pitchSkinTone || '',
        });
      } else {
        setError('Invalid image file.');
      }
    };
    reader.readAsDataURL(file);
  };

  const handleAdminSaveCroppedPhoto = async ({
    profilePhotoDataUrl,
    pitchPhotoDataUrl,
    skinTone,
  }: CroppedPhotoResult) => {
    if (!adminCropTarget) return;
    setError(null);
    setNotice(null);
    setSavingCroppedPhoto(true);
    const { mode, uid, playerName } = adminCropTarget;

    try {
      if (mode === 'pending') {
        await updateDoc(doc(db, 'player_photos', uid), {
          pendingPhotoData: profilePhotoDataUrl,
          pendingPitchPhotoData: pitchPhotoDataUrl,
          pitchSkinTone: skinTone,
        });
        setFallbackSubmissions((prev) =>
          prev.map((s) =>
            s.uid === uid
              ? {
                  ...s,
                  pendingPhotoData: profilePhotoDataUrl,
                  pendingPitchPhotoData: pitchPhotoDataUrl,
                  pitchSkinTone: skinTone,
                }
              : s
          )
        );
        setNotice(`Updated framing for ${playerName}'s pending photo. You can approve it whenever ready.`);
      } else {
        await updateDoc(doc(db, 'players', uid), {
          approvedPhotoUrl: profilePhotoDataUrl,
          approvedPitchPhotoUrl: pitchPhotoDataUrl,
          pitchSkinTone: skinTone,
          photoStatus: 'approved',
          updatedAt: serverTimestamp(),
        });
        setNotice(`Saved adjusted profile & pitch photos for ${playerName}.`);
      }
      setAdminCropTarget(null);
    } catch (err) {
      try {
        handleFirestoreError(
          err,
          OperationType.UPDATE,
          mode === 'pending' ? `player_photos/${uid}` : `players/${uid}`
        );
      } catch (wrapped) {
        setError(wrapped instanceof Error ? wrapped.message : 'Failed to save adjusted photo.');
      }
    } finally {
      setSavingCroppedPhoto(false);
    }
  };

  const handleRoleChange = async (targetPlayer: PlayerProfile, nextRole: UserRole) => {
    setError(null);
    setNotice(null);
    setBusyUid(targetPlayer.uid);

    try {
      if (nextRole === 'admin') {
        const priv = privateById.get(targetPlayer.uid);
        await setDoc(doc(db, 'admins', targetPlayer.uid), {
          uid: targetPlayer.uid,
          email: priv?.email || 'admin@vancitypitch.ca',
          grantedBy: user.uid,
          createdAt: serverTimestamp(),
        });
        await setDoc(doc(db, 'managers', targetPlayer.uid), {
          uid: targetPlayer.uid,
          grantedBy: user.uid,
          createdAt: serverTimestamp(),
        });
      } else if (nextRole === 'manager') {
        try {
          await deleteDoc(doc(db, 'admins', targetPlayer.uid));
        } catch {
          // ignore if didn't exist
        }
        await setDoc(doc(db, 'managers', targetPlayer.uid), {
          uid: targetPlayer.uid,
          grantedBy: user.uid,
          createdAt: serverTimestamp(),
        });
      } else {
        try {
          await deleteDoc(doc(db, 'admins', targetPlayer.uid));
        } catch {
          // ignore
        }
        try {
          await deleteDoc(doc(db, 'managers', targetPlayer.uid));
        } catch {
          // ignore
        }
      }

      await updateDoc(doc(db, 'players', targetPlayer.uid), {
        role: nextRole,
        updatedAt: serverTimestamp(),
      });

      setNotice(`Updated ${targetPlayer.firstName} ${targetPlayer.lastName} to ${nextRole}.`);
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.UPDATE, `players/${targetPlayer.uid}`);
      } catch (wrapped) {
        setError(wrapped instanceof Error ? wrapped.message : 'Failed to change user role.');
      }
    } finally {
      setBusyUid(null);
    }
  };

  const testPlayers = useMemo(() => players.filter((p) => isTestPlayerUid(p.uid)), [players]);
  const [managingTestRoster, setManagingTestRoster] = useState(false);

  const handleSeedTestPlayers = async () => {
    setError(null);
    setNotice(null);
    setManagingTestRoster(true);
    try {
      await seedTestPlayers(user, profile);
      setNotice('Created 9 test players with scouting ratings and emergency contacts.');
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.WRITE, 'players');
      } catch (wrapped) {
        setError(wrapped instanceof Error ? wrapped.message : 'Failed to create test players.');
      }
    } finally {
      setManagingTestRoster(false);
    }
  };

  const handleRemoveTestPlayers = async () => {
    setError(null);
    setNotice(null);
    setManagingTestRoster(true);
    try {
      const count = await removeAllTestPlayers(players, ratings, matches);
      setNotice(`Removed ${count} test player records, scouting ratings, and match votes.`);
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.DELETE, 'players');
      } catch (wrapped) {
        setError(wrapped instanceof Error ? wrapped.message : 'Failed to remove test players.');
      }
    } finally {
      setManagingTestRoster(false);
    }
  };

  // Open Business Editor
  const openEditBusinessModal = (playerUid: string, business: PlayerBusinessInfo | null) => {
    setError(null);
    setNotice(null);
    setFormPlayerUid(playerUid);
    setEditingBusinessTarget({ playerUid, business });
    if (business) {
      setFormBizId(business.id || makeBusinessId());
      setFormBizName(business.businessName);
      setFormBizCategory(business.category || '');
      setFormBizTagline(business.tagline || '');
      setFormBizPhone(formatPhoneNumber(business.phone));
      setFormBizWebsite(business.website || '');
      setFormBizAddress(business.address || '');
      setFormBizLogoUrl(business.logoUrl || '');
      setFormBizAllowPromotion(business.allowPromotion !== false);
    } else {
      setFormBizId(makeBusinessId());
      setFormBizName('');
      setFormBizCategory('');
      setFormBizTagline('');
      setFormBizPhone('');
      setFormBizWebsite('');
      setFormBizAddress('');
      setFormBizLogoUrl('');
      setFormBizAllowPromotion(true);
    }
  };

  const closeBusinessModal = () => {
    setEditingBusinessTarget(null);
    setDeletingBusinessTarget(null);
    setError(null);
  };

  const handleUploadLogoFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null);
    setUploadingBizLogo(true);
    try {
      const dataUrl = await compressBrandImageFile(file, 220);
      setFormBizLogoUrl(dataUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not compress business logo.');
    } finally {
      setUploadingBizLogo(false);
    }
  };

  const handleSaveBusinessSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formPlayerUid) {
      setError('Please select a member.');
      return;
    }
    const targetPlayer = playersById.get(formPlayerUid);
    if (!targetPlayer) {
      setError('Player record not found.');
      return;
    }

    const cleanName = formBizName.trim().slice(0, 80);
    if (!cleanName) {
      setError('Business name is required.');
      return;
    }

    const rawUrl = formBizWebsite.trim();
    const safeUrl = rawUrl ? normalizeSafeHttpUrl(rawUrl) : '';
    if (rawUrl && !safeUrl) {
      setError('Please enter a valid website URL (e.g. https://example.com).');
      return;
    }

    const currentBusinesses = businessEntries(targetPlayer);
    const isNew = !editingBusinessTarget?.business;

    if (isNew && currentBusinesses.length >= MAX_PLAYER_BUSINESSES) {
      setError(`This member already has the maximum of ${MAX_PLAYER_BUSINESSES} businesses.`);
      return;
    }

    const normalizedTargetName = cleanName.toLowerCase();
    const hasDuplicateName = currentBusinesses.some((b) => {
      if (!isNew && editingBusinessTarget?.business?.id && b.id === editingBusinessTarget.business.id) {
        return false;
      }
      return b.businessName.trim().toLowerCase() === normalizedTargetName;
    });
    if (hasDuplicateName) {
      setError(`This member already has a business named "${cleanName}". Please use a distinct name.`);
      return;
    }

    const entry: PlayerBusinessInfo = sanitizeBusinessEntry({
      id: formBizId || makeBusinessId(),
      businessName: cleanName,
      category: formBizCategory,
      tagline: formBizTagline,
      phone: formBizPhone,
      website: safeUrl,
      address: formBizAddress,
      logoUrl: formBizLogoUrl ? normalizeSafeImageUrl(formBizLogoUrl) : '',
      allowPromotion: formBizAllowPromotion,
    });

    const nextList = isNew
      ? [...currentBusinesses, entry]
      : currentBusinesses.map((b) => (b.id === entry.id ? entry : b));

    setSavingBusiness(true);
    setError(null);
    try {
      if (!privateBusinesses) throw new Error('Business details are still loading.');
      await savePlayerBusinesses(formPlayerUid, nextList);

      setNotice(
        isNew
          ? `Added business "${entry.businessName}" for ${targetPlayer.firstName} ${targetPlayer.lastName}.`
          : `Updated business "${entry.businessName}" for ${targetPlayer.firstName} ${targetPlayer.lastName}.`
      );
      closeBusinessModal();
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.UPDATE, `players/${formPlayerUid}`);
      } catch (wrapped) {
        setError(wrapped instanceof Error ? wrapped.message : 'Failed to save business.');
      }
    } finally {
      setSavingBusiness(false);
    }
  };

  const handleConfirmDeleteBusiness = async () => {
    if (!deletingBusinessTarget) return;
    const { playerUid, business } = deletingBusinessTarget;
    const targetPlayer = playersById.get(playerUid);
    if (!targetPlayer) return;

    setSavingBusiness(true);
    setError(null);
    try {
      const current = businessEntries(targetPlayer);
      const nextList = current.filter((b) => b.id !== business.id);

      if (!privateBusinesses) throw new Error('Business details are still loading.');
      await savePlayerBusinesses(playerUid, nextList);

      setNotice(
        `Deleted "${business.businessName}" for ${targetPlayer.firstName} ${targetPlayer.lastName}.`
      );
      closeBusinessModal();
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.UPDATE, `players/${playerUid}`);
      } catch (wrapped) {
        setError(wrapped instanceof Error ? wrapped.message : 'Failed to delete business.');
      }
    } finally {
      setSavingBusiness(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
        <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
          Admin Hub
        </h1>

        <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-200/70 rounded-lg">
          {[
            ...(pendingPhotos.length + orphanedPendingPlayers.length > 0
              ? [
                  {
                    id: 'photos' as const,
                    label: `Review Photos (${pendingPhotos.length + orphanedPendingPlayers.length})`,
                    highlight: true,
                  },
                ]
              : []),
            { id: 'directory' as const, label: `Directory (${players.length})`, highlight: false },
            { id: 'roles' as const, label: 'Roles', highlight: false },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setSubTab(tab.id);
                setError(null);
                setNotice(null);
              }}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap flex items-center gap-1.5 ${
                subTab === tab.id
                  ? tab.highlight
                    ? 'bg-amber-600 text-white shadow-sm'
                    : 'bg-white text-slate-900 shadow-sm'
                  : tab.highlight
                    ? 'bg-amber-100 text-amber-900 hover:bg-amber-200 font-bold'
                    : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">{error}</div>
      )}
      {notice && (
        <div className="p-3.5 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-800">{notice}</div>
      )}

      {subTab === 'photos' && (
        <div className="space-y-6">
          {pendingPhotos.length === 0 && orphanedPendingPlayers.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-2">
              <Camera className="w-9 h-9 text-slate-400 mx-auto" />
              <h2 className="font-display text-2xl font-bold text-slate-900">All Photos Reviewed</h2>
            </div>
          ) : (
            <>
              {pendingPhotos.length > 0 && (
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
                  {pendingPhotos.map((sub) => {
                    const player = playersById.get(sub.uid);
                    return (
                      <div key={sub.uid} className="bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col">
                        <div className="relative aspect-square bg-slate-100 overflow-hidden">
                          <img
                            src={sub.pendingPhotoData}
                            alt={player ? `${player.firstName} ${player.lastName}` : 'Pending upload'}
                            className="w-full h-full object-cover"
                          />
                          {/* Mini Live Pitch Jersey Preview Badge */}
                          <div
                            title="Pitch preview (head & neck on jersey)"
                            className="absolute bottom-2 right-2 w-[84px] h-[90px] rounded-lg pitch-stripes shadow-md border border-white/60 flex items-end justify-center overflow-hidden pb-0.5"
                          >
                            <div className="relative w-[78px] h-[102px] flex justify-center scale-[0.82] origin-bottom">
                              <div className="absolute bottom-0 left-0 w-[78px] h-[29px] z-10">
                                <PlayerKitShouldersSvg
                                  color="Blue"
                                  teamIndex={1}
                                  layer="back"
                                  skinTone={sub.pitchSkinTone}
                                  className="w-[78px] h-[29px]"
                                />
                              </div>
                              <img
                                src={sub.pendingPitchPhotoData || sub.pendingPhotoData}
                                alt="Pitch preview"
                                className="absolute bottom-[7px] left-1/2 -translate-x-1/2 w-[76px] h-[95px] object-contain object-bottom z-20"
                              />
                              <div className="absolute bottom-0 left-0 w-[78px] h-[29px] z-30">
                                <PlayerKitShouldersSvg
                                  color="Blue"
                                  teamIndex={1}
                                  layer="front"
                                  skinTone={sub.pitchSkinTone}
                                  className="w-[78px] h-[29px]"
                                />
                              </div>
                            </div>
                          </div>
                        </div>
                        <div className="p-4 space-y-3 flex-1 flex flex-col justify-between">
                          <div>
                            <div className="text-sm font-semibold text-slate-900">
                              {player ? `${player.firstName} ${player.lastName}` : sub.uid}
                            </div>
                            <div className="text-xs text-slate-500">
                              {player ? `Age ${player.age} · ${player.favoritePositions.join(' / ')}` : 'Pending member'}
                            </div>
                          </div>

                          <div className="space-y-2">
                            <input
                              type="text"
                              value={rejectionNotes[sub.uid] || ''}
                              onChange={(e) =>
                                setRejectionNotes((prev) => ({ ...prev, [sub.uid]: e.target.value }))
                              }
                              placeholder="Rejection note (optional)"
                              className="w-full px-3 py-1.5 rounded-lg border border-slate-300 text-xs"
                            />
                            <button
                              type="button"
                              disabled={busyUid === sub.uid}
                              onClick={() =>
                                setAdminCropTarget({
                                  mode: 'pending',
                                  uid: sub.uid,
                                  playerName: player
                                    ? `${player.firstName} ${player.lastName}`
                                    : sub.uid,
                                  imageSrc: sub.pendingPhotoData,
                                  initialSkinTone:
                                    sub.pitchSkinTone || player?.pitchSkinTone || '',
                                })
                              }
                              className="w-full py-2 px-3 rounded-lg border border-slate-300 bg-slate-50 hover:bg-slate-100 text-slate-800 text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
                            >
                              <Crop className="w-3.5 h-3.5" /> Adjust Position / Zoom / Cutout
                            </button>
                            <div className="grid grid-cols-2 gap-2">
                              <button
                                type="button"
                                disabled={busyUid === sub.uid}
                                onClick={() => handlePhotoDecision(sub, true)}
                                className="py-2 px-3 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold inline-flex items-center justify-center gap-1"
                              >
                                <Check className="w-3.5 h-3.5" /> Approve
                              </button>
                              <button
                                type="button"
                                disabled={busyUid === sub.uid}
                                onClick={() => handlePhotoDecision(sub, false)}
                                className="py-2 px-3 rounded-lg border border-red-200 text-red-700 hover:bg-red-50 text-xs font-semibold inline-flex items-center justify-center gap-1"
                              >
                                <X className="w-3.5 h-3.5" /> Reject
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {orphanedPendingPlayers.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 space-y-3">
                  <div className="text-sm font-semibold text-amber-900">
                    Incomplete Photo Uploads ({orphanedPendingPlayers.length})
                  </div>
                  <p className="text-xs text-amber-800">
                    These players show pending status without an uploaded image file. Clear their status so they can upload again.
                  </p>
                  <div className="divide-y divide-amber-200/70 bg-white rounded-lg border border-amber-200">
                    {orphanedPendingPlayers.map((p) => (
                      <div key={p.uid} className="px-4 py-3 flex items-center justify-between gap-3 text-xs">
                        <span className="font-semibold text-slate-900">
                          {p.firstName} {p.lastName}
                        </span>
                        <button
                          type="button"
                          disabled={busyUid === p.uid}
                          onClick={() => handleResetOrphanedStatus(p)}
                          className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-semibold whitespace-nowrap"
                        >
                          Clear Pending Flag
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {subTab === 'roles' && (
        <div className="space-y-4">
          <div className="bg-slate-900 text-white rounded-xl px-4 py-3 flex items-center justify-between gap-3">
            <span className="text-xs font-semibold">
              Test Players ({testPlayers.length})
            </span>
            <div className="flex items-center gap-2 shrink-0">
              {testPlayers.length > 0 ? (
                <button
                  type="button"
                  disabled={managingTestRoster}
                  onClick={handleRemoveTestPlayers}
                  title="Remove all test players"
                  className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap disabled:opacity-60"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  {managingTestRoster ? '...' : 'Remove'}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={managingTestRoster}
                  onClick={handleSeedTestPlayers}
                  title="Create 9 test players"
                  className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap disabled:opacity-60"
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  {managingTestRoster ? '...' : 'Seed 9'}
                </button>
              )}
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="p-4 border-b border-slate-200 flex items-center gap-2">
              <Shield className="w-4 h-4 text-emerald-700" />
              <h2 className="text-sm font-semibold text-slate-900">Access Levels ({players.length} Members)</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                  <tr>
                    <th className="py-3 px-4 font-semibold">Member</th>
                    <th className="py-3 px-4 font-semibold">Email</th>
                    <th className="py-3 px-4 font-semibold">Photo</th>
                    <th className="py-3 px-4 font-semibold">Current Role</th>
                    <th className="py-3 px-4 font-semibold text-right">Change Access Level</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {players.map((p) => {
                    const priv = privateById.get(p.uid);
                    const isTest = isTestPlayerUid(p.uid);
                    return (
                      <tr key={p.uid} className="hover:bg-slate-50">
                        <td className="py-3 px-4 font-semibold text-slate-900">
                          <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-full bg-slate-100 border border-slate-200 overflow-hidden flex items-center justify-center shrink-0">
                              {p.approvedPhotoUrl ? (
                                <img
                                  src={p.approvedPhotoUrl}
                                  alt={`${p.firstName} ${p.lastName}`}
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <UserIcon className="w-4 h-4 text-slate-400" />
                              )}
                            </div>
                            <span>
                              {p.firstName} {p.lastName}
                              {isTest && (
                                <span className="ml-2 text-[10px] font-medium uppercase tracking-wide text-slate-500">
                                  (Test)
                                </span>
                              )}
                            </span>
                          </div>
                        </td>
                        <td className="py-3 px-4 text-slate-600">{priv?.email || '—'}</td>
                        <td className="py-3 px-4">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-slate-600 mr-1">{p.photoStatus}</span>
                            {p.approvedPhotoUrl && (
                              <button
                                type="button"
                                onClick={() =>
                                  setAdminCropTarget({
                                    mode: 'approved',
                                    uid: p.uid,
                                    playerName: `${p.firstName} ${p.lastName}`,
                                    imageSrc: p.approvedPhotoUrl,
                                    initialSkinTone: p.pitchSkinTone || '',
                                  })
                                }
                                className="px-2 py-1 rounded-md border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 text-[11px] font-semibold inline-flex items-center gap-1 whitespace-nowrap"
                              >
                                <Crop className="w-3 h-3" /> Adjust
                              </button>
                            )}
                            <label className="px-2 py-1 rounded-md border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer whitespace-nowrap">
                              <Upload className="w-3 h-3" /> {p.approvedPhotoUrl ? 'Replace' : 'Upload'}
                              <input
                                type="file"
                                accept="image/*"
                                onChange={(e) => handleAdminUploadPhotoFile(p, e)}
                                className="hidden"
                              />
                            </label>
                          </div>
                        </td>
                        <td className="py-3 px-4 font-mono-tabular font-semibold text-slate-900">{p.role}</td>
                        <td className="py-3 px-4 text-right">
                          <select
                            disabled={busyUid === p.uid || p.uid === user.uid || isTest}
                            value={p.role}
                            onChange={(e) => handleRoleChange(p, e.target.value as UserRole)}
                            className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-medium disabled:opacity-50"
                          >
                            <option value="player">Player</option>
                            <option value="manager">Manager</option>
                            <option value="admin">Admin</option>
                          </select>
                          {p.role === 'player' && !isTest && (
                            <button type="button" className="ml-2 text-xs underline"
                              onClick={() => void changeMembership(p.uid, !approvedUids.has(p.uid))}>
                              {approvedUids.has(p.uid) ? 'Revoke access' : 'Approve member'}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {subTab === 'directory' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-3.5 rounded-xl border border-slate-200">
            <div className="relative flex-1 min-w-[240px] max-w-md">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={directorySearch}
                onChange={(e) => setDirectorySearch(e.target.value)}
                placeholder="Search member, phone, email, business..."
                className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />
            </div>
            <div className="text-xs text-slate-500 font-medium">
              Showing {filteredDirectoryPlayers.length} of {players.length} members
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="p-4 border-b border-slate-200 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-emerald-700" />
                <h2 className="text-sm font-semibold text-slate-900">
                  Player Contact, Personal Info & Businesses
                </h2>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                  <tr>
                    <th className="py-3 px-4 font-semibold">Player</th>
                    <th className="py-3 px-4 font-semibold">DOB / Age</th>
                    <th className="py-3 px-4 font-semibold">Personal Phone</th>
                    <th className="py-3 px-4 font-semibold">Emergency Contact</th>
                    <th className="py-3 px-4 font-semibold">Email</th>
                    <th className="py-3 px-4 font-semibold">Businesses</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredDirectoryPlayers.map((p) => {
                    const priv = privateById.get(p.uid);
                    const bList = businessEntries(p);
                    return (
                      <tr key={p.uid} className="hover:bg-slate-50">
                        <td className="py-3 px-4 font-semibold text-slate-900">
                          <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-full bg-slate-100 border border-slate-200 overflow-hidden flex items-center justify-center shrink-0">
                              {p.approvedPhotoUrl ? (
                                <img
                                  src={p.approvedPhotoUrl}
                                  alt={`${p.firstName} ${p.lastName}`}
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <UserIcon className="w-4 h-4 text-slate-400" />
                              )}
                            </div>
                            <div>
                              <div>
                                {p.firstName} {p.lastName}
                              </div>
                              <div className="text-[10px] text-slate-500 capitalize">
                                {p.role} · {p.appearances} apps
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="py-3 px-4 font-mono-tabular text-slate-600">
                          <div>{priv?.dob || '—'}</div>
                          <div className="text-[10px] text-slate-400">Age {p.age}</div>
                        </td>
                        <td className="py-3 px-4 font-mono-tabular text-slate-700">
                          {priv?.phone ? (
                            <a href={`tel:${formatPhoneNumber(priv.phone)}`} className="hover:underline text-emerald-700 font-medium">
                              {formatPhoneNumber(priv.phone)}
                            </a>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="py-3 px-4 font-mono-tabular font-semibold text-red-700">
                          {formatPhoneNumber(priv?.emergencyContact) || '—'}
                        </td>
                        <td className="py-3 px-4 text-slate-600">
                          {priv?.email ? (
                            <a href={`mailto:${priv.email}`} className="hover:underline">
                              {priv.email}
                            </a>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="py-3 px-4">
                          <div className="space-y-1.5">
                            {bList.map((biz) => (
                              <div
                                key={biz.id || biz.businessName}
                                className="flex items-center justify-between gap-2 p-1.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-800"
                              >
                                <div className="min-w-0">
                                  <div className="font-semibold truncate">{biz.businessName}</div>
                                  {biz.category && (
                                    <div className="text-[10px] text-slate-500 truncate">{biz.category}</div>
                                  )}
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                  <button
                                    type="button"
                                    onClick={() => openEditBusinessModal(p.uid, biz)}
                                    title="Edit Business"
                                    className="p-1 rounded text-slate-500 hover:text-slate-800 hover:bg-slate-200"
                                  >
                                    <Pencil className="w-3 h-3" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setDeletingBusinessTarget({ playerUid: p.uid, business: biz })}
                                    title="Delete Business"
                                    className="p-1 rounded text-red-500 hover:text-red-700 hover:bg-red-50"
                                  >
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                </div>
                              </div>
                            ))}

                            {bList.length < MAX_PLAYER_BUSINESSES && (
                              <button
                                type="button"
                                onClick={() => openEditBusinessModal(p.uid, null)}
                                className="text-[11px] text-emerald-700 hover:text-emerald-800 font-semibold inline-flex items-center gap-1 py-0.5"
                              >
                                <Plus className="w-3 h-3" /> Add Business
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}


      {/* Admin Business Editor Modal */}
      {editingBusinessTarget && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-lg w-full p-5 sm:p-6 space-y-4 shadow-xl border border-slate-200 my-8">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Briefcase className="w-5 h-5 text-emerald-700" />
                <h3 className="font-bold text-base text-slate-900">
                  {editingBusinessTarget.business ? 'Edit Member Business' : 'Add Member Business'}
                </h3>
              </div>
              <button
                type="button"
                onClick={closeBusinessModal}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveBusinessSubmit} className="space-y-4 text-xs">
              {/* Member Selection */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Member / Owner *
                </label>
                <select
                  disabled={Boolean(editingBusinessTarget.business)}
                  value={formPlayerUid}
                  onChange={(e) => setFormPlayerUid(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-600 disabled:bg-slate-100"
                >
                  {players.map((p) => (
                    <option key={p.uid} value={p.uid}>
                      {p.firstName} {p.lastName} ({p.role})
                    </option>
                  ))}
                </select>
              </div>

              {/* Logo Upload */}
              <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200">
                <div className="w-14 h-14 rounded-lg bg-white border border-slate-200 overflow-hidden shrink-0 flex items-center justify-center p-1">
                  {formBizLogoUrl ? (
                    <img
                      src={formBizLogoUrl}
                      alt="Logo preview"
                      className="w-full h-full object-contain"
                    />
                  ) : (
                    <ImagePlus className="w-5 h-5 text-slate-400" />
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 font-semibold text-slate-800 cursor-pointer inline-flex items-center gap-1.5">
                    <Upload className="w-3.5 h-3.5 text-emerald-700" />
                    {uploadingBizLogo ? '...' : formBizLogoUrl ? 'Change Logo' : 'Upload Logo'}
                    <input
                      type="file"
                      accept="image/*"
                      disabled={uploadingBizLogo}
                      onChange={handleUploadLogoFile}
                      className="hidden"
                    />
                  </label>
                  {formBizLogoUrl && (
                    <button
                      type="button"
                      onClick={() => setFormBizLogoUrl('')}
                      className="px-2.5 py-1.5 text-rose-700 hover:bg-rose-50 font-semibold rounded-lg"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>

              {/* Name & Category */}
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Business Name *
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={80}
                    value={formBizName}
                    onChange={(e) => setFormBizName(e.target.value)}
                    placeholder="e.g. Pacific Coast Dental"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Category
                  </label>
                  <BusinessCategorySelect
                    value={formBizCategory}
                    onChange={setFormBizCategory}
                  />
                </div>
              </div>

              {/* Tagline / Member Offer */}
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Description / Member Offer
                </label>
                <input
                  type="text"
                  maxLength={160}
                  value={formBizTagline}
                  onChange={(e) => setFormBizTagline(e.target.value)}
                  placeholder="Short description or club member promotion"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                />
              </div>

              {/* Phone, Website, Address */}
              <div className="grid sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Phone</label>
                  <input
                    type="tel"
                    inputMode="numeric"
                    maxLength={12}
                    value={formBizPhone}
                    onChange={(e) => setFormBizPhone(formatPhoneNumber(e.target.value))}
                    placeholder="604-555-0142"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-mono-tabular focus:outline-none focus:ring-2 focus:ring-emerald-600"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Website</label>
                  <input
                    type="text"
                    maxLength={300}
                    value={formBizWebsite}
                    onChange={(e) => setFormBizWebsite(e.target.value)}
                    placeholder="https://..."
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">City / Address</label>
                  <input
                    type="text"
                    maxLength={120}
                    value={formBizAddress}
                    onChange={(e) => setFormBizAddress(e.target.value)}
                    placeholder="North Vancouver"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                  />
                </div>
              </div>

              {/* Promotion status */}
              <label className="flex items-center gap-2 font-medium text-slate-700 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={formBizAllowPromotion}
                  onChange={(e) => setFormBizAllowPromotion(e.target.checked)}
                  className="rounded border-slate-300 text-emerald-700 focus:ring-emerald-600"
                />
                <span>Allow featuring in club ads & announcements ribbon</span>
              </label>

              {/* Modal buttons */}
              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={closeBusinessModal}
                  className="px-3.5 py-2 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingBusiness || uploadingBizLogo}
                  className="px-4 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-semibold inline-flex items-center gap-1.5 disabled:opacity-60"
                >
                  <Check className="w-4 h-4" />
                  {savingBusiness ? 'Saving...' : 'Save Business'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Business Confirmation Dialog */}
      {deletingBusinessTarget && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-5 space-y-4 shadow-xl border border-red-200 text-slate-900">
            <div className="flex items-center gap-2.5 text-red-700">
              <Trash2 className="w-5 h-5 shrink-0" />
              <h3 className="font-bold text-base">Delete Business?</h3>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              Are you sure you want to delete{' '}
              <span className="font-semibold text-slate-900">
                "{deletingBusinessTarget.business.businessName}"
              </span>{' '}
              for{' '}
              <span className="font-semibold text-slate-900">
                {playersById.get(deletingBusinessTarget.playerUid)?.firstName}{' '}
                {playersById.get(deletingBusinessTarget.playerUid)?.lastName}
              </span>
              ? This action cannot be undone.
            </p>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={closeBusinessModal}
                disabled={savingBusiness}
                className="px-3.5 py-2 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteBusiness}
                disabled={savingBusiness}
                className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-60"
              >
                <Trash2 className="w-3.5 h-3.5" />
                {savingBusiness ? 'Deleting...' : 'Confirm Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {adminCropTarget && (
        <CircularPhotoCropper
          key={`${adminCropTarget.uid}_${adminCropTarget.imageSrc.slice(-24)}`}
          imageSrc={adminCropTarget.imageSrc}
          title={`Adjust Photo · ${adminCropTarget.playerName}`}
          busy={savingCroppedPhoto}
          confirmLabel={
            adminCropTarget.mode === 'pending' ? 'Save Adjusted Pending Photo' : 'Save & Approve Photo'
          }
          initialSkinTone={adminCropTarget.initialSkinTone || undefined}
          externalError={error}
          onCancel={() => {
            if (!savingCroppedPhoto) setAdminCropTarget(null);
          }}
          onConfirm={handleAdminSaveCroppedPhoto}
        />
      )}
    </div>
  );
};
