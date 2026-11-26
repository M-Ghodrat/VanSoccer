import React, { useEffect, useMemo, useState } from 'react';
import { User } from 'firebase/auth';
import { deleteDoc, doc, getDoc, serverTimestamp, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { Camera, Check, Crop, Phone, Shield, Trash2, Upload, User as UserIcon, UserPlus, Users, X } from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import {
  DropInMatch,
  getPlayerBusinesses,
  PlayerPhotoSubmission,
  PlayerPrivateInfo,
  PlayerProfile,
  PlayerRating,
  UserRole,
} from '../types';
import { isTestPlayerUid, removeAllTestPlayers, seedTestPlayers } from '../utils/testPlayers';
import { CircularPhotoCropper, CroppedPhotoResult } from './CircularPhotoCropper';
import { PlayerKitShouldersSvg } from './SoccerPitch';

interface AdminHubProps {
  user: User;
  profile: PlayerProfile;
  players: PlayerProfile[];
  privateInfos: PlayerPrivateInfo[];
  photoSubmissions: PlayerPhotoSubmission[];
  ratings: PlayerRating[];
  matches: DropInMatch[];
}

export const AdminHub: React.FC<AdminHubProps> = ({
  user,
  profile,
  players,
  privateInfos,
  photoSubmissions,
  ratings,
  matches,
}) => {
  const [subTab, setSubTab] = useState<'photos' | 'roles' | 'directory'>('photos');
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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
        <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
          Admin
        </h1>

        <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg">
          {[
            {
              id: 'photos' as const,
              label: `Photos (${pendingPhotos.length + orphanedPendingPlayers.length})`,
            },
            { id: 'roles' as const, label: 'Roles' },
            { id: 'directory' as const, label: 'Directory' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setSubTab(tab.id);
                setError(null);
                setNotice(null);
              }}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                subTab === tab.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
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
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="p-4 border-b border-slate-200 flex items-center gap-2">
            <Phone className="w-4 h-4 text-emerald-700" />
            <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
              <Users className="w-4 h-4 hidden" />
              Player Contact & Emergency Directory
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                <tr>
                  <th className="py-3 px-4 font-semibold">Player</th>
                  <th className="py-3 px-4 font-semibold">DOB</th>
                  <th className="py-3 px-4 font-semibold">Phone</th>
                  <th className="py-3 px-4 font-semibold">Emergency Contact</th>
                  <th className="py-3 px-4 font-semibold">Email</th>
                  <th className="py-3 px-4 font-semibold">Business</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {players.map((p) => {
                  const priv = privateById.get(p.uid);
                  return (
                    <tr key={p.uid} className="hover:bg-slate-50">
                      <td className="py-3 px-4 font-semibold text-slate-900">
                        {p.firstName} {p.lastName}
                      </td>
                      <td className="py-3 px-4 font-mono-tabular text-slate-600">{priv?.dob || '—'}</td>
                      <td className="py-3 px-4 font-mono-tabular text-slate-700">{priv?.phone || '—'}</td>
                      <td className="py-3 px-4 font-mono-tabular font-semibold text-red-700">
                        {priv?.emergencyContact || '—'}
                      </td>
                      <td className="py-3 px-4 text-slate-600">{priv?.email || '—'}</td>
                      <td className="py-3 px-4 text-slate-700">
                        {(() => {
                          const list = getPlayerBusinesses(p);
                          if (list.length === 0) return '—';
                          return (
                            <div className="space-y-1.5">
                              {list.map((biz, idx) => (
                                <div key={biz.id || idx}>
                                  <div className="font-semibold text-slate-900">
                                    {biz.businessName}
                                  </div>
                                  {biz.category && (
                                    <div className="text-[11px] text-slate-500">
                                      {biz.category}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          );
                        })()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
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
