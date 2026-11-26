import React, { useEffect, useState } from 'react';
import { deleteUser, EmailAuthProvider, reauthenticateWithCredential, User } from 'firebase/auth';
import { deleteDoc, doc, serverTimestamp, updateDoc, writeBatch } from 'firebase/firestore';
import {
  AlertTriangle,
  Briefcase,
  Camera,
  CheckCircle2,
  Clock,
  Crop,
  ExternalLink,
  ImagePlus,
  MapPin,
  Pencil,
  Phone,
  Plus,
  Save,
  Trash2,
  User as UserIcon,
  X,
} from 'lucide-react';
import { BOOTSTRAPPED_ADMIN_EMAIL, db, handleFirestoreError, OperationType } from '../firebase';
import {
  BUSINESS_CATEGORY_SUGGESTIONS,
  normalizeSafeHttpUrl,
  normalizeSafeImageUrl,
  PlayerBusinessInfo,
  PlayerPhotoSubmission,
  PlayerPrivateInfo,
  PlayerProfile,
  POSITION_LABELS,
  SOCCER_POSITIONS,
} from '../types';
import { calculateAgeFromDob } from '../utils/clubUtils';
import { compressBrandImageFile } from '../utils/imageUpload';
import { CircularPhotoCropper, CroppedPhotoResult } from './CircularPhotoCropper';

interface ProfileViewProps {
  user: User;
  profile: PlayerProfile | null;
  privateInfo: PlayerPrivateInfo | null;
  photoSubmission: PlayerPhotoSubmission | null;
  isOnboarding: boolean;
  onProfileSaved?: () => void;
}

export const ProfileView: React.FC<ProfileViewProps> = ({
  user,
  profile,
  privateInfo,
  photoSubmission,
  isOnboarding,
  onProfileSaved,
}) => {
  const [firstName, setFirstName] = useState(profile?.firstName || '');
  const [lastName, setLastName] = useState(profile?.lastName || '');
  const [dob, setDob] = useState(privateInfo?.dob || '');
  const [phone, setPhone] = useState(privateInfo?.phone || '');
  const [email, setEmail] = useState(privateInfo?.email || user.email || '');
  const [emergencyContact, setEmergencyContact] = useState(privateInfo?.emergencyContact || '');
  const [pos1, setPos1] = useState(profile?.favoritePositions?.[0] || 'CM');
  const [pos2, setPos2] = useState(profile?.favoritePositions?.[1] || 'CDM');
  const [pos3, setPos3] = useState(profile?.favoritePositions?.[2] || 'CB');

  const [pendingPhotoPreview, setPendingPhotoPreview] = useState<string>(
    photoSubmission?.pendingPhotoData || ''
  );
  const [pendingPitchPhotoPreview, setPendingPitchPhotoPreview] = useState<string>(
    photoSubmission?.pendingPitchPhotoData || ''
  );
  const [pendingSkinTone, setPendingSkinTone] = useState<string>(
    photoSubmission?.pitchSkinTone || profile?.pitchSkinTone || ''
  );
  const [photoDirty, setPhotoDirty] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [isEditing, setIsEditing] = useState(isOnboarding);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleting, setDeleting] = useState(false);

  // Optional Business Info (editable in Profile after registration)
  const [isEditingBusiness, setIsEditingBusiness] = useState(false);
  const [savingBusiness, setSavingBusiness] = useState(false);
  const [bizName, setBizName] = useState(profile?.business?.businessName || '');
  const [bizCategory, setBizCategory] = useState(profile?.business?.category || '');
  const [bizTagline, setBizTagline] = useState(profile?.business?.tagline || '');
  const [bizPhone, setBizPhone] = useState(profile?.business?.phone || '');
  const [bizWebsite, setBizWebsite] = useState(profile?.business?.website || '');
  const [bizAddress, setBizAddress] = useState(profile?.business?.address || '');
  const [bizLogoUrl, setBizLogoUrl] = useState(profile?.business?.logoUrl || '');
  const [uploadingBizLogo, setUploadingBizLogo] = useState(false);
  const [bizAllowPromotion, setBizAllowPromotion] = useState(
    profile?.business ? profile.business.allowPromotion : true
  );

  useEffect(() => {
    if (profile) {
      setFirstName(profile.firstName);
      setLastName(profile.lastName);
      setPos1(profile.favoritePositions[0] || 'CM');
      setPos2(profile.favoritePositions[1] || 'CDM');
      setPos3(profile.favoritePositions[2] || 'CB');
      setBizName(profile.business?.businessName || '');
      setBizCategory(profile.business?.category || '');
      setBizTagline(profile.business?.tagline || '');
      setBizPhone(profile.business?.phone || '');
      setBizWebsite(profile.business?.website || '');
      setBizAddress(profile.business?.address || '');
      setBizLogoUrl(profile.business?.logoUrl || '');
      setBizAllowPromotion(profile.business ? profile.business.allowPromotion : true);
    }
  }, [profile]);

  useEffect(() => {
    if (privateInfo) {
      setDob(privateInfo.dob);
      setPhone(privateInfo.phone);
      setEmail(privateInfo.email);
      setEmergencyContact(privateInfo.emergencyContact);
    }
  }, [privateInfo]);

  useEffect(() => {
    if (photoSubmission && !photoDirty) {
      setPendingPhotoPreview(photoSubmission.pendingPhotoData);
      setPendingPitchPhotoPreview(photoSubmission.pendingPitchPhotoData || '');
      if (photoSubmission.pitchSkinTone !== undefined) {
        setPendingSkinTone(photoSubmission.pitchSkinTone);
      }
    }
  }, [photoSubmission, photoDirty]);

  useEffect(() => {
    if (profile?.photoStatus === 'approved') {
      setPendingPhotoPreview('');
      setPendingPitchPhotoPreview('');
      setPendingSkinTone(profile.pitchSkinTone || '');
      setPhotoDirty(false);
      setSuccessMsg((prev) =>
        prev && prev.toLowerCase().includes('approval') ? null : prev
      );
    }
  }, [profile?.photoStatus, profile?.pitchSkinTone]);

  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [cropperSourceUrl, setCropperSourceUrl] = useState<string | null>(null);
  const [photoSaveError, setPhotoSaveError] = useState<string | null>(null);

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset input value so re-selecting the same image still triggers onChange
    e.target.value = '';
    if (!file) return;
    setError(null);
    setSuccessMsg(null);

    const reader = new FileReader();
    reader.onerror = () => setError('Could not read the selected image file.');
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setCropperSourceUrl(reader.result);
      } else {
        setError('Invalid image file.');
      }
    };
    reader.readAsDataURL(file);
  };

  const handleConfirmCroppedPhoto = async ({
    profilePhotoDataUrl,
    pitchPhotoDataUrl,
    skinTone,
  }: CroppedPhotoResult) => {
    setError(null);
    setPhotoSaveError(null);
    setSuccessMsg(null);
    setUploadingPhoto(true);
    try {
      setPendingPhotoPreview(profilePhotoDataUrl);
      setPendingPitchPhotoPreview(pitchPhotoDataUrl);
      setPendingSkinTone(skinTone);

      if (profile) {
        const batch = writeBatch(db);
        batch.set(doc(db, 'player_photos', user.uid), {
          uid: user.uid,
          pendingPhotoData: profilePhotoDataUrl,
          pendingPitchPhotoData: pitchPhotoDataUrl,
          pitchSkinTone: skinTone,
          status: 'pending',
          rejectionReason: '',
          submittedAt: serverTimestamp(),
        });
        batch.update(doc(db, 'players', user.uid), {
          photoStatus: 'pending',
          updatedAt: serverTimestamp(),
        });
        await batch.commit();
        setPhotoDirty(false);
        setSuccessMsg('Photo saved and sent to admin approval queue.');
      } else {
        setPhotoDirty(true);
      }
      setCropperSourceUrl(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to upload photo.';
      setPhotoSaveError(msg);
      setError(msg);
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);

    if (!firstName.trim() || !lastName.trim()) {
      setError('First name and surname are required.');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
      setError('Please enter a valid date of birth.');
      return;
    }
    if (phone.trim().length < 5 || emergencyContact.trim().length < 5) {
      setError('Valid contact number and emergency contact number are required.');
      return;
    }
    if (new Set([pos1, pos2, pos3]).size < 3) {
      setError('Please choose 3 distinct favorite positions.');
      return;
    }

    setSaving(true);
    const computedAge = calculateAgeFromDob(dob);
    const nextPhotoStatus = photoDirty
      ? 'pending'
      : profile?.photoStatus || (pendingPhotoPreview ? 'pending' : 'none');

    try {
      const isBootstrapAdmin = user.email?.toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL.toLowerCase();

      const batch = writeBatch(db);

      if (!profile) {
        batch.set(doc(db, 'players', user.uid), {
          uid: user.uid,
          firstName: firstName.trim().slice(0, 60),
          lastName: lastName.trim().slice(0, 60),
          age: computedAge,
          favoritePositions: [pos1, pos2, pos3],
          photoStatus: photoDirty ? 'pending' : 'none',
          approvedPhotoUrl: '',
          role: isBootstrapAdmin ? 'admin' : 'player',
          appearances: 0,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else {
        batch.update(doc(db, 'players', user.uid), {
          firstName: firstName.trim().slice(0, 60),
          lastName: lastName.trim().slice(0, 60),
          age: computedAge,
          favoritePositions: [pos1, pos2, pos3],
          photoStatus: photoDirty ? 'pending' : profile.photoStatus,
          updatedAt: serverTimestamp(),
        });
      }

      batch.set(doc(db, 'player_private', user.uid), {
        uid: user.uid,
        email: email.trim().slice(0, 120),
        dob,
        phone: phone.trim().slice(0, 30),
        emergencyContact: emergencyContact.trim().slice(0, 30),
        updatedAt: serverTimestamp(),
      });

      if (photoDirty && pendingPhotoPreview) {
        batch.set(doc(db, 'player_photos', user.uid), {
          uid: user.uid,
          pendingPhotoData: pendingPhotoPreview,
          pendingPitchPhotoData: pendingPitchPhotoPreview || pendingPhotoPreview,
          pitchSkinTone: pendingSkinTone,
          status: 'pending',
          rejectionReason: '',
          submittedAt: serverTimestamp(),
        });
      }

      try {
        await batch.commit();
        setPhotoDirty(false);
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `players/${user.uid}`);
      }

      setSuccessMsg(
        nextPhotoStatus === 'pending'
          ? 'Profile saved. Your uploaded photo is pending admin approval.'
          : 'Profile saved successfully.'
      );
      onProfileSaved?.();
      if (!isOnboarding) setIsEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save profile.');
    } finally {
      setSaving(false);
    }
  };

  const handleUploadBizLogo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null);
    setUploadingBizLogo(true);
    try {
      const dataUrl = await compressBrandImageFile(file, 220);
      setBizLogoUrl(dataUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not process logo image.');
    } finally {
      setUploadingBizLogo(false);
    }
  };

  const handleQuickUploadBizLogo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !profile?.business) return;
    setError(null);
    setSuccessMsg(null);
    setUploadingBizLogo(true);
    try {
      const dataUrl = await compressBrandImageFile(file, 220);
      const safeLogo = normalizeSafeImageUrl(dataUrl);
      const updatedBusiness: PlayerBusinessInfo = {
        businessName: profile.business.businessName,
        category: profile.business.category || '',
        tagline: profile.business.tagline || '',
        phone: profile.business.phone || '',
        website: profile.business.website ? normalizeSafeHttpUrl(profile.business.website) : '',
        address: profile.business.address || '',
        logoUrl: safeLogo,
        allowPromotion: profile.business.allowPromotion,
      };
      await updateDoc(doc(db, 'players', user.uid), {
        business: updatedBusiness,
        updatedAt: serverTimestamp(),
      });
      setBizLogoUrl(safeLogo);
      setSuccessMsg('Business logo updated.');
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.UPDATE, `players/${user.uid}`);
      } catch (wrapped) {
        setError(wrapped instanceof Error ? wrapped.message : 'Could not upload business logo.');
      }
    } finally {
      setUploadingBizLogo(false);
    }
  };

  const handleSaveBusiness = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    setError(null);
    setSuccessMsg(null);

    const cleanName = bizName.trim().slice(0, 80);
    if (!cleanName) {
      setError('Business name is required.');
      return;
    }

    const rawUrl = bizWebsite.trim();
    const safeUrl = rawUrl ? normalizeSafeHttpUrl(rawUrl) : '';
    if (rawUrl && !safeUrl) {
      setError('Please enter a valid website URL (e.g. https://example.com).');
      return;
    }

    const safeLogo = bizLogoUrl ? normalizeSafeImageUrl(bizLogoUrl) : '';

    setSavingBusiness(true);
    try {
      const businessPayload: PlayerBusinessInfo = {
        businessName: cleanName,
        category: bizCategory.trim().slice(0, 50),
        tagline: bizTagline.trim().slice(0, 160),
        phone: bizPhone.trim().slice(0, 30),
        website: safeUrl,
        address: bizAddress.trim().slice(0, 120),
        logoUrl: safeLogo,
        allowPromotion: bizAllowPromotion,
      };
      await updateDoc(doc(db, 'players', user.uid), {
        business: businessPayload,
        updatedAt: serverTimestamp(),
      });
      setIsEditingBusiness(false);
      setSuccessMsg('Business information saved.');
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.UPDATE, `players/${user.uid}`);
      } catch (wrapped) {
        setError(wrapped instanceof Error ? wrapped.message : 'Failed to save business info.');
      }
    } finally {
      setSavingBusiness(false);
    }
  };

  const handleClearBusiness = async () => {
    if (!profile) return;
    setError(null);
    setSuccessMsg(null);
    setSavingBusiness(true);
    try {
      await updateDoc(doc(db, 'players', user.uid), {
        business: null,
        updatedAt: serverTimestamp(),
      });
      setBizName('');
      setBizCategory('');
      setBizTagline('');
      setBizPhone('');
      setBizWebsite('');
      setBizAddress('');
      setBizLogoUrl('');
      setBizAllowPromotion(true);
      setIsEditingBusiness(false);
      setSuccessMsg('Business information removed.');
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.UPDATE, `players/${user.uid}`);
      } catch (wrapped) {
        setError(wrapped instanceof Error ? wrapped.message : 'Failed to remove business info.');
      }
    } finally {
      setSavingBusiness(false);
    }
  };

  const handleDeleteAccount = async () => {
    setError(null);
    setDeleting(true);
    try {
      const hasPasswordProvider = user.providerData.some((p) => p.providerId === 'password');
      if (hasPasswordProvider && deletePassword) {
        const cred = EmailAuthProvider.credential(user.email || '', deletePassword);
        await reauthenticateWithCredential(user, cred);
      }

      try {
        await deleteDoc(doc(db, 'player_photos', user.uid));
      } catch {
        // Optional doc may not exist
      }
      try {
        await deleteDoc(doc(db, 'player_private', user.uid));
      } catch {
        // Optional doc may not exist
      }
      try {
        await deleteDoc(doc(db, 'players', user.uid));
      } catch {
        // Optional doc may not exist
      }

      await deleteUser(user);
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code || '';
      if (code === 'auth/requires-recent-login') {
        setError('For security, please enter your password above to confirm account deletion.');
      } else {
        setError(err instanceof Error ? err.message : 'Could not delete account.');
      }
    } finally {
      setDeleting(false);
    }
  };

  const effectivePhotoStatus = profile?.photoStatus || 'none';
  const displayAvatar =
    effectivePhotoStatus === 'approved' && !photoDirty
      ? profile?.approvedPhotoUrl || pendingPhotoPreview || ''
      : pendingPhotoPreview || profile?.approvedPhotoUrl || '';

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 pb-4">
        <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
          {isOnboarding ? 'Registration' : 'Profile'}
        </h1>
        {!isOnboarding && profile && (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                setIsEditing((v) => !v);
                setError(null);
                setSuccessMsg(null);
              }}
              title={isEditing ? 'Cancel edit' : 'Edit profile'}
              aria-label={isEditing ? 'Cancel edit' : 'Edit profile'}
              className={`p-2 rounded-lg border transition-colors ${
                isEditing
                  ? 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              {isEditing ? <X className="w-4 h-4" /> : <Pencil className="w-4 h-4" />}
            </button>
            <button
              type="button"
              onClick={() => setShowDeleteConfirm((v) => !v)}
              title="Delete account"
              aria-label="Delete account"
              className={`p-2 rounded-lg border transition-colors ${
                showDeleteConfirm
                  ? 'border-red-300 bg-red-50 text-red-700'
                  : 'border-slate-200 bg-white text-slate-500 hover:text-red-700 hover:border-red-200 hover:bg-red-50'
              }`}
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* Compact Photo Status Banner */}
      {effectivePhotoStatus !== 'approved' && (
        <div
          className={`px-3.5 py-2.5 rounded-xl border flex items-center gap-2.5 text-xs ${
            photoDirty && pendingPhotoPreview
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-amber-50 border-amber-200 text-amber-900'
          }`}
        >
          {photoDirty && pendingPhotoPreview ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
          )}
          <span>
            {photoDirty && pendingPhotoPreview
              ? 'Photo ready — click Complete below to save your profile.'
              : effectivePhotoStatus === 'pending'
                ? 'Photo pending admin approval.'
                : effectivePhotoStatus === 'rejected'
                  ? `Photo declined${photoSubmission?.rejectionReason ? `: ${photoSubmission.rejectionReason}` : '.'}`
                  : 'Profile photo missing.'}
          </span>
        </div>
      )}

      {error && (
        <div className="px-3.5 py-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">
          {error}
        </div>
      )}

      {successMsg && (
        <div className="px-3.5 py-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Collapsible Account Deletion Confirmation (Closed by Default) */}
      {showDeleteConfirm && !isOnboarding && (
        <div className="bg-white border border-red-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs font-semibold text-red-800">Permanently delete account?</span>
          <div className="flex flex-wrap items-center gap-2">
            {user.providerData.some((p) => p.providerId === 'password') && (
              <input
                type="password"
                value={deletePassword}
                onChange={(e) => setDeletePassword(e.target.value)}
                placeholder="Password"
                className="px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs"
              />
            )}
            <button
              type="button"
              onClick={handleDeleteAccount}
              disabled={deleting}
              className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold whitespace-nowrap disabled:opacity-60"
            >
              {deleting ? '...' : 'Confirm'}
            </button>
            <button
              type="button"
              onClick={() => setShowDeleteConfirm(false)}
              aria-label="Cancel delete"
              className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Minimal Read-Only Summary View (Default when not onboarding & not editing) */}
      {!isOnboarding && !isEditing && profile ? (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="p-5 flex items-center justify-between gap-4 border-b border-slate-100">
            <div className="flex items-center gap-4 min-w-0">
              <div className="relative w-16 h-16 rounded-full bg-slate-100 border border-slate-200 overflow-hidden flex items-center justify-center shrink-0">
                {displayAvatar ? (
                  <img
                    src={displayAvatar}
                    alt={`${profile.firstName} ${profile.lastName}`}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <UserIcon className="w-7 h-7 text-slate-400" />
                )}
              </div>
              <div className="min-w-0">
                <h2 className="text-lg font-bold text-slate-900 truncate">
                  {profile.firstName} {profile.lastName}
                </h2>
                <div className="text-xs text-slate-500 flex flex-wrap items-center gap-2 mt-0.5 capitalize">
                  <span>{profile.role}</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono-tabular">Age {profile.age}</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono-tabular">{profile.appearances} apps</span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <label
                title="Upload photo"
                className="p-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 cursor-pointer transition-colors"
              >
                <Camera className="w-4 h-4 text-emerald-700" />
                <input
                  type="file"
                  accept="image/*"
                  disabled={uploadingPhoto}
                  onChange={handlePhotoChange}
                  className="hidden"
                />
              </label>
              {displayAvatar && (
                <button
                  type="button"
                  disabled={uploadingPhoto}
                  onClick={() => setCropperSourceUrl(displayAvatar)}
                  title="Crop & zoom photo"
                  aria-label="Crop and zoom photo"
                  className="p-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 transition-colors disabled:opacity-50"
                >
                  <Crop className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          <div className="grid sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-slate-100 text-xs">
            <div className="p-5 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-500">Positions</span>
                <span className="font-mono-tabular font-semibold text-slate-900">
                  {profile.favoritePositions.join(' / ')}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-500">Email</span>
                <span className="font-medium text-slate-900 truncate">{email || '—'}</span>
              </div>
            </div>

            <div className="p-5 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-500">Phone</span>
                <span className="font-mono-tabular font-medium text-slate-900">{phone || '—'}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-500">Emergency</span>
                <span className="font-mono-tabular font-medium text-slate-900">{emergencyContact || '—'}</span>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSaveProfile} className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-6">
          {/* Photo Section */}
          <div className="flex items-center justify-between gap-4 pb-5 border-b border-slate-100">
            <div className="flex items-center gap-4">
              <div className="relative w-16 h-16 rounded-full bg-slate-100 border border-slate-200 overflow-hidden flex items-center justify-center shrink-0">
                {displayAvatar ? (
                  <img
                    src={displayAvatar}
                    alt="Player portrait preview"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <UserIcon className="w-7 h-7 text-slate-400" />
                )}
              </div>
              <div className="space-y-1">
                <h2 className="text-sm font-semibold text-slate-900">Photo</h2>
                {effectivePhotoStatus === 'approved' && !photoDirty && (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Approved
                  </span>
                )}
                {(effectivePhotoStatus === 'pending' || photoDirty) && (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700">
                    <Clock className="w-3.5 h-3.5" /> {photoDirty ? 'Ready' : 'Pending'}
                  </span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              <label
                title="Upload photo"
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-800 cursor-pointer transition-colors"
              >
                <Camera className="w-4 h-4 text-emerald-700" />
                {uploadingPhoto ? '...' : 'Upload'}
                <input type="file" accept="image/*" disabled={uploadingPhoto} onChange={handlePhotoChange} className="hidden" />
              </label>
              {displayAvatar && (
                <button
                  type="button"
                  disabled={uploadingPhoto}
                  onClick={() => setCropperSourceUrl(displayAvatar)}
                  title="Crop & zoom"
                  aria-label="Crop and zoom photo"
                  className="p-2 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 transition-colors disabled:opacity-50"
                >
                  <Crop className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          {/* Personal & Emergency Details */}
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Name *</label>
              <input
                type="text"
                required
                maxLength={60}
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="Marcus"
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Surname *</label>
              <input
                type="text"
                required
                maxLength={60}
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Chen"
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Date of Birth *</label>
              <input
                type="date"
                required
                value={dob}
                onChange={(e) => setDob(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-mono-tabular focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Email *</label>
              <input
                type="email"
                required
                maxLength={120}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Phone *</label>
              <input
                type="tel"
                required
                maxLength={30}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="(604) 555-0142"
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-mono-tabular focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Emergency Phone *</label>
              <input
                type="tel"
                required
                maxLength={30}
                value={emergencyContact}
                onChange={(e) => setEmergencyContact(e.target.value)}
                placeholder="(604) 555-0199"
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-mono-tabular focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />
            </div>
          </div>

          {/* Favorite 3 Positions */}
          <div className="space-y-3 pt-2 border-t border-slate-100">
            <h3 className="text-xs font-semibold text-slate-700">Top 3 Positions</h3>
            <div className="grid sm:grid-cols-3 gap-3">
              {[
                { label: '1st', value: pos1, setter: setPos1 },
                { label: '2nd', value: pos2, setter: setPos2 },
                { label: '3rd', value: pos3, setter: setPos3 },
              ].map((slot) => (
                <div key={slot.label}>
                  <label className="block text-[11px] font-medium text-slate-500 mb-1">{slot.label}</label>
                  <select
                    value={slot.value}
                    onChange={(e) => slot.setter(e.target.value)}
                    className="w-full px-2.5 py-2 rounded-lg border border-slate-300 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-600"
                  >
                    {SOCCER_POSITIONS.map((p) => (
                      <option key={p} value={p}>
                        {p} — {POSITION_LABELS[p]}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
            {!isOnboarding && (
              <button
                type="button"
                onClick={() => setIsEditing(false)}
                className="px-3.5 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold"
              >
                Cancel
              </button>
            )}
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold transition-colors inline-flex items-center gap-1.5 disabled:opacity-60 whitespace-nowrap"
            >
              <Save className="w-3.5 h-3.5" />
              {saving ? 'Saving...' : isOnboarding ? 'Complete' : 'Save'}
            </button>
          </div>
        </form>
      )}

      {/* Optional Business Info Section (Available in Profile after registration) */}
      {!isOnboarding && profile && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Briefcase className="w-4 h-4 text-emerald-700 shrink-0" />
              <h2 className="text-sm font-semibold text-slate-900">Business</h2>
            </div>

            {!isEditingBusiness ? (
              <button
                type="button"
                onClick={() => {
                  setIsEditingBusiness(true);
                  setError(null);
                  setSuccessMsg(null);
                }}
                className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold inline-flex items-center gap-1.5 transition-colors"
              >
                {profile.business?.businessName ? (
                  <>
                    <Pencil className="w-3.5 h-3.5" />
                    Edit
                  </>
                ) : (
                  <>
                    <Plus className="w-3.5 h-3.5" />
                    Add
                  </>
                )}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setIsEditingBusiness(false)}
                aria-label="Cancel business edit"
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {!isEditingBusiness ? (
            profile.business?.businessName ? (
              <div className="p-5 space-y-3 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div className="w-14 h-14 rounded-lg bg-slate-50 border border-slate-200 overflow-hidden shrink-0 flex items-center justify-center p-1">
                      {profile.business.logoUrl && normalizeSafeImageUrl(profile.business.logoUrl) ? (
                        <img
                          src={normalizeSafeImageUrl(profile.business.logoUrl)}
                          alt={profile.business.businessName}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-contain"
                        />
                      ) : (
                        <ImagePlus className="w-5 h-5 text-slate-400" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-bold text-slate-900">
                          {profile.business.businessName}
                        </span>
                        {profile.business.category && (
                          <>
                            <span aria-hidden="true" className="text-slate-300">
                              ·
                            </span>
                            <span className="text-slate-500">{profile.business.category}</span>
                          </>
                        )}
                      </div>
                      {profile.business.tagline && (
                        <p className="text-slate-600 mt-0.5">{profile.business.tagline}</p>
                      )}
                      <div className="flex flex-wrap items-center gap-3 mt-1.5">
                        <label className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 hover:text-emerald-800 cursor-pointer">
                          <ImagePlus className="w-3.5 h-3.5" />
                          {uploadingBizLogo
                            ? 'Uploading...'
                            : profile.business.logoUrl
                              ? 'Change Logo'
                              : 'Upload Logo'}
                          <input
                            type="file"
                            accept="image/*"
                            disabled={uploadingBizLogo}
                            onChange={handleQuickUploadBizLogo}
                            className="hidden"
                          />
                        </label>
                        <span aria-hidden="true" className="text-slate-300">
                          ·
                        </span>
                        <span
                          className={`font-medium ${
                            profile.business.allowPromotion ? 'text-emerald-700' : 'text-slate-400'
                          }`}
                        >
                          {profile.business.allowPromotion ? 'Ribbon eligible' : 'Private'}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {(profile.business.phone ||
                  profile.business.website ||
                  profile.business.address) && (
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-2 border-t border-slate-100 text-slate-600">
                    {profile.business.phone && (
                      <span className="inline-flex items-center gap-1.5 font-mono-tabular">
                        <Phone className="w-3.5 h-3.5 text-slate-400" />
                        {profile.business.phone}
                      </span>
                    )}
                    {profile.business.address && (
                      <span className="inline-flex items-center gap-1.5">
                        <MapPin className="w-3.5 h-3.5 text-slate-400" />
                        {profile.business.address}
                      </span>
                    )}
                    {profile.business.website && normalizeSafeHttpUrl(profile.business.website) && (
                      <a
                        href={normalizeSafeHttpUrl(profile.business.website)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-emerald-700 hover:underline font-medium"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        {profile.business.website.replace(/^https?:\/\//i, '')}
                      </a>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="px-5 py-4 text-xs text-slate-400">
                Not added
              </div>
            )
          ) : (
            <form onSubmit={handleSaveBusiness} className="p-5 space-y-4">
              {/* Business Logo / Image Upload */}
              <div className="flex flex-wrap items-center gap-3 pb-3 border-b border-slate-100">
                <div className="w-14 h-14 rounded-lg bg-slate-50 border border-slate-200 overflow-hidden shrink-0 flex items-center justify-center p-1">
                  {bizLogoUrl && normalizeSafeImageUrl(bizLogoUrl) ? (
                    <img
                      src={normalizeSafeImageUrl(bizLogoUrl)}
                      alt="Business logo"
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-contain"
                    />
                  ) : (
                    <ImagePlus className="w-5 h-5 text-slate-400" />
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-800 inline-flex items-center gap-1.5 cursor-pointer transition-colors">
                    <ImagePlus className="w-3.5 h-3.5 text-emerald-700" />
                    {uploadingBizLogo ? 'Processing...' : bizLogoUrl ? 'Change Logo' : 'Upload Logo'}
                    <input
                      type="file"
                      accept="image/*"
                      disabled={uploadingBizLogo}
                      onChange={handleUploadBizLogo}
                      className="hidden"
                    />
                  </label>
                  {bizLogoUrl && (
                    <button
                      type="button"
                      onClick={() => setBizLogoUrl('')}
                      className="px-2.5 py-1.5 rounded-lg text-xs font-semibold text-rose-700 hover:bg-rose-50"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
              <div className="grid sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Business Name *
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={80}
                    value={bizName}
                    onChange={(e) => setBizName(e.target.value)}
                    placeholder="Business name"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Category
                  </label>
                  <input
                    type="text"
                    list="business-category-options"
                    maxLength={50}
                    value={bizCategory}
                    onChange={(e) => setBizCategory(e.target.value)}
                    placeholder="e.g. Real Estate, Auto, Dental"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                  />
                  <datalist id="business-category-options">
                    {BUSINESS_CATEGORY_SUGGESTIONS.map((cat) => (
                      <option key={cat} value={cat} />
                    ))}
                  </datalist>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Description / Member Offer
                </label>
                <input
                  type="text"
                  maxLength={160}
                  value={bizTagline}
                  onChange={(e) => setBizTagline(e.target.value)}
                  placeholder="Short description or discount for club members"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                />
              </div>

              <div className="grid sm:grid-cols-3 gap-3.5">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Business Phone
                  </label>
                  <input
                    type="tel"
                    maxLength={30}
                    value={bizPhone}
                    onChange={(e) => setBizPhone(e.target.value)}
                    placeholder="(604) 555-0142"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-mono-tabular focus:outline-none focus:ring-2 focus:ring-emerald-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Website / Social
                  </label>
                  <input
                    type="text"
                    maxLength={180}
                    value={bizWebsite}
                    onChange={(e) => setBizWebsite(e.target.value)}
                    placeholder="https://..."
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    City / Address
                  </label>
                  <input
                    type="text"
                    maxLength={120}
                    value={bizAddress}
                    onChange={(e) => setBizAddress(e.target.value)}
                    placeholder="North Vancouver"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                  />
                </div>
              </div>

              <label className="flex items-center gap-2.5 text-xs font-medium text-slate-700 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={bizAllowPromotion}
                  onChange={(e) => setBizAllowPromotion(e.target.checked)}
                  className="rounded border-slate-300 text-emerald-700 focus:ring-emerald-600"
                />
                <span>Allow featuring in club ribbon</span>
              </label>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-slate-100">
                <div>
                  {profile.business?.businessName && (
                    <button
                      type="button"
                      disabled={savingBusiness}
                      onClick={handleClearBusiness}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold text-rose-700 hover:bg-rose-50 inline-flex items-center gap-1"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Remove
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsEditingBusiness(false)}
                    className="px-3.5 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={savingBusiness}
                    className="px-4 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-60"
                  >
                    <Save className="w-3.5 h-3.5" />
                    {savingBusiness ? 'Saving...' : 'Save'}
                  </button>
                </div>
              </div>
            </form>
          )}
        </div>
      )}
      {/* Interactive Circular Photo Crop & Zoom Modal */}
      {cropperSourceUrl && (
        <CircularPhotoCropper
          key={cropperSourceUrl}
          imageSrc={cropperSourceUrl}
          busy={uploadingPhoto}
          confirmLabel={profile ? 'Save & Upload Photo' : 'Apply Photo'}
          initialSkinTone={pendingSkinTone || undefined}
          externalError={photoSaveError}
          onCancel={() => {
            if (!uploadingPhoto) {
              setPhotoSaveError(null);
              setCropperSourceUrl(null);
            }
          }}
          onConfirm={handleConfirmCroppedPhoto}
        />
      )}
    </div>
  );
};
