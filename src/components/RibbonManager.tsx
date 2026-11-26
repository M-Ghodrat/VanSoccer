import React, { useEffect, useMemo, useRef, useState } from 'react';
import { User } from 'firebase/auth';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import {
  ArrowDown,
  ArrowUp,
  Briefcase,
  Check,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Globe,
  ImagePlus,
  Loader2,
  MapPin,
  Megaphone,
  Newspaper,
  Pencil,
  Phone,
  Plus,
  Trash2,
  User as UserIcon,
  X,
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import {
  normalizeSafeHttpUrl,
  normalizeSafeImageUrl,
  PlayerProfile,
  RibbonConfig,
  RibbonItem,
  RibbonItemType,
  RibbonMode,
  RibbonSpeed,
} from '../types';
import { compressBrandImageFile } from '../utils/imageUpload';
import { ClubRibbon } from './ClubRibbon';

interface RibbonManagerProps {
  user: User;
  ribbonConfig: RibbonConfig;
  players: PlayerProfile[];
}

const MAX_RIBBON_ITEMS = 20;

const TYPE_OPTIONS: {
  id: RibbonItemType;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  accentClass: string;
}[] = [
  { id: 'business', label: 'Business', icon: Briefcase, accentClass: 'text-emerald-700' },
  { id: 'news', label: 'News', icon: Newspaper, accentClass: 'text-sky-700' },
  { id: 'announcement', label: 'Announcement', icon: Megaphone, accentClass: 'text-amber-700' },
];

function makeRibbonItemId(): string {
  return `rbn_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

interface LocalRibbonState {
  enabled: boolean;
  mode: RibbonMode;
  speed: RibbonSpeed;
  items: RibbonItem[];
}

export const RibbonManager: React.FC<RibbonManagerProps> = ({
  user,
  ribbonConfig,
  players,
}) => {
  const [state, setState] = useState<LocalRibbonState>({
    enabled: ribbonConfig.enabled,
    mode: ribbonConfig.mode,
    speed: ribbonConfig.speed,
    items: Array.isArray(ribbonConfig.items) ? ribbonConfig.items : [],
  });
  const stateRef = useRef<LocalRibbonState>(state);
  stateRef.current = state;

  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [error, setError] = useState<string | null>(null);
  const writeSeqRef = useRef(0);
  const pendingWritesRef = useRef(0);
  const savedTimerRef = useRef<number | null>(null);

  // Collapsible composer & member businesses picker
  const [showComposer, setShowComposer] = useState(false);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [draftType, setDraftType] = useState<RibbonItemType>('announcement');
  const [draftTitle, setDraftTitle] = useState('');
  const [draftText, setDraftText] = useState('');
  const [draftCategory, setDraftCategory] = useState('');
  const [draftOwnerName, setDraftOwnerName] = useState('');
  const [draftLinkedUid, setDraftLinkedUid] = useState('');
  const [draftPhone, setDraftPhone] = useState('');
  const [draftWebsite, setDraftWebsite] = useState('');
  const [draftAddress, setDraftAddress] = useState('');
  const [draftImageUrl, setDraftImageUrl] = useState('');
  const [uploadingImg, setUploadingImg] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [showMemberBusinesses, setShowMemberBusinesses] = useState(true);

  useEffect(() => {
    // Only sync incoming Firestore snapshot when no local write is currently in flight
    if (pendingWritesRef.current > 0) return;
    const next: LocalRibbonState = {
      enabled: ribbonConfig.enabled,
      mode: ribbonConfig.mode,
      speed: ribbonConfig.speed,
      items: Array.isArray(ribbonConfig.items) ? ribbonConfig.items : [],
    };
    stateRef.current = next;
    setState(next);
  }, [ribbonConfig]);

  useEffect(() => {
    return () => {
      if (savedTimerRef.current) {
        window.clearTimeout(savedTimerRef.current);
      }
    };
  }, []);

  const playersById = useMemo(() => new Map(players.map((p) => [p.uid, p])), [players]);

  const sortedPlayers = useMemo(
    () =>
      [...players].sort((a, b) =>
        `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`)
      ),
    [players]
  );

  const promotableMemberBusinesses = useMemo(() => {
    return players
      .filter(
        (p) =>
          p.business &&
          p.business.businessName.trim().length > 0 &&
          p.business.allowPromotion !== false
      )
      .sort((a, b) =>
        (a.business?.businessName || '').localeCompare(b.business?.businessName || '')
      );
  }, [players]);

  const previewConfig: RibbonConfig = useMemo(
    () => ({
      enabled: state.enabled,
      mode: state.mode,
      speed: state.speed,
      items: state.items,
      updatedBy: user.uid,
    }),
    [state, user.uid]
  );

  const commitChange = async (updater: (prev: LocalRibbonState) => LocalRibbonState) => {
    const next = updater(stateRef.current);
    stateRef.current = next;
    setState(next);
    setError(null);

    const seq = ++writeSeqRef.current;
    pendingWritesRef.current += 1;
    setSaveState('saving');
    if (savedTimerRef.current) {
      window.clearTimeout(savedTimerRef.current);
      savedTimerRef.current = null;
    }

    try {
      const sanitizedItems: RibbonItem[] = next.items.slice(0, MAX_RIBBON_ITEMS).map((it) => {
        const clean: RibbonItem = {
          id: it.id.slice(0, 64),
          type: it.type,
          title: it.title.trim().slice(0, 80),
          text: (it.text || '').trim().slice(0, 180),
          active: Boolean(it.active),
        };
        if (it.imageUrl) {
          const safeImg = normalizeSafeImageUrl(it.imageUrl);
          if (safeImg) clean.imageUrl = safeImg;
        }
        if (it.linkedPlayerUid) clean.linkedPlayerUid = it.linkedPlayerUid.slice(0, 128);
        if (it.ownerName) clean.ownerName = it.ownerName.slice(0, 80);
        if (it.category) clean.category = it.category.slice(0, 50);
        if (it.phone) clean.phone = it.phone.slice(0, 30);
        if (it.website) {
          const safe = normalizeSafeHttpUrl(it.website);
          if (safe) clean.website = safe;
        }
        if (it.address) clean.address = it.address.slice(0, 120);
        return clean;
      });

      await setDoc(doc(db, 'ribbon', 'config'), {
        enabled: next.enabled,
        mode: next.mode,
        speed: next.speed,
        items: sanitizedItems,
        updatedBy: user.uid,
        updatedAt: serverTimestamp(),
      });

      if (seq === writeSeqRef.current) {
        setSaveState('saved');
        savedTimerRef.current = window.setTimeout(() => {
          setSaveState('idle');
        }, 1800);
      }
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.WRITE, 'ribbon/config');
      } catch (wrapped) {
        setError(wrapped instanceof Error ? wrapped.message : 'Failed to save ribbon settings.');
      }
      if (seq === writeSeqRef.current) {
        setSaveState('idle');
      }
    } finally {
      pendingWritesRef.current = Math.max(0, pendingWritesRef.current - 1);
    }
  };

  const resetComposer = () => {
    setEditingItemId(null);
    setDraftType('announcement');
    setDraftTitle('');
    setDraftText('');
    setDraftCategory('');
    setDraftOwnerName('');
    setDraftLinkedUid('');
    setDraftPhone('');
    setDraftWebsite('');
    setDraftAddress('');
    setDraftImageUrl('');
    setFormError(null);
    setShowComposer(false);
  };

  const openNewComposer = () => {
    resetComposer();
    setShowComposer(true);
  };

  const openEditComposer = (item: RibbonItem) => {
    setEditingItemId(item.id);
    setDraftType(item.type);
    setDraftTitle(item.title);
    setDraftText(item.text || '');
    setDraftCategory(item.category || '');
    setDraftOwnerName(item.ownerName || '');
    setDraftLinkedUid(item.linkedPlayerUid || '');
    setDraftPhone(item.phone || '');
    setDraftWebsite(item.website || '');
    setDraftAddress(item.address || '');
    setDraftImageUrl(item.imageUrl || '');
    setFormError(null);
    setShowComposer(true);
  };

  const handleLinkPlayerChange = (uid: string) => {
    setDraftLinkedUid(uid);
    if (!uid) {
      setDraftOwnerName('');
      return;
    }
    const p = playersById.get(uid);
    if (!p) return;
    setDraftOwnerName(`${p.firstName} ${p.lastName}`.trim());
    if (p.business) {
      if (!draftTitle.trim() && p.business.businessName) setDraftTitle(p.business.businessName);
      if (!draftCategory.trim() && p.business.category) setDraftCategory(p.business.category);
      if (!draftText.trim() && p.business.tagline) setDraftText(p.business.tagline);
      if (!draftPhone.trim() && p.business.phone) setDraftPhone(p.business.phone);
      if (!draftWebsite.trim() && p.business.website) setDraftWebsite(p.business.website);
      if (!draftAddress.trim() && p.business.address) setDraftAddress(p.business.address);
      if (!draftImageUrl && p.business.logoUrl) setDraftImageUrl(p.business.logoUrl);
    }
  };

  const handleUploadItemImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setFormError(null);
    setUploadingImg(true);
    try {
      const dataUrl = await compressBrandImageFile(file, 220);
      setDraftImageUrl(dataUrl);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to process image.');
    } finally {
      setUploadingImg(false);
    }
  };

  const handleApplyItemDraft = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const cleanTitle = draftTitle.trim().slice(0, 80);
    if (!cleanTitle) {
      setFormError('Title is required.');
      return;
    }

    const rawWebsite = draftWebsite.trim();
    const safeWebsite = rawWebsite ? normalizeSafeHttpUrl(rawWebsite) : '';
    if (rawWebsite && !safeWebsite) {
      setFormError('Enter a valid website URL (e.g. https://example.com).');
      return;
    }

    const safeImage = draftImageUrl ? normalizeSafeImageUrl(draftImageUrl) : '';

    if (!editingItemId && stateRef.current.items.length >= MAX_RIBBON_ITEMS) {
      setFormError(`Maximum ${MAX_RIBBON_ITEMS} ribbon items allowed.`);
      return;
    }

    const nextItem: RibbonItem = {
      id: editingItemId || makeRibbonItemId(),
      type: draftType,
      title: cleanTitle,
      text: draftText.trim().slice(0, 180),
      active: true,
      ...(safeImage ? { imageUrl: safeImage } : {}),
      ...(draftLinkedUid ? { linkedPlayerUid: draftLinkedUid.slice(0, 128) } : {}),
      ...(draftOwnerName.trim() ? { ownerName: draftOwnerName.trim().slice(0, 80) } : {}),
      ...(draftCategory.trim() ? { category: draftCategory.trim().slice(0, 50) } : {}),
      ...(draftPhone.trim() ? { phone: draftPhone.trim().slice(0, 30) } : {}),
      ...(safeWebsite ? { website: safeWebsite } : {}),
      ...(draftAddress.trim() ? { address: draftAddress.trim().slice(0, 120) } : {}),
    };

    const currentEditingId = editingItemId;
    resetComposer();

    void commitChange((prev) => ({
      ...prev,
      items: currentEditingId
        ? prev.items.map((it) =>
            it.id === currentEditingId ? { ...nextItem, active: it.active } : it
          )
        : [...prev.items, nextItem],
    }));
  };

  const handleFeatureMemberBusiness = (player: PlayerProfile) => {
    const biz = player.business;
    if (!biz || !biz.businessName.trim()) return;
    if (stateRef.current.items.length >= MAX_RIBBON_ITEMS) {
      setError(`Maximum ${MAX_RIBBON_ITEMS} ribbon items allowed.`);
      return;
    }

    const ownerName = `${player.firstName} ${player.lastName}`.trim();
    const safeWebsite = biz.website ? normalizeSafeHttpUrl(biz.website) : '';
    const safeLogo = biz.logoUrl ? normalizeSafeImageUrl(biz.logoUrl) : '';
    const newItem: RibbonItem = {
      id: makeRibbonItemId(),
      type: 'business',
      title: biz.businessName.trim().slice(0, 80),
      text: (biz.tagline || biz.category || '').trim().slice(0, 180),
      active: true,
      ...(safeLogo ? { imageUrl: safeLogo } : {}),
      linkedPlayerUid: player.uid,
      ownerName: ownerName.slice(0, 80),
      ...(biz.category.trim() ? { category: biz.category.trim().slice(0, 50) } : {}),
      ...(biz.phone.trim() ? { phone: biz.phone.trim().slice(0, 30) } : {}),
      ...(safeWebsite ? { website: safeWebsite } : {}),
      ...(biz.address.trim() ? { address: biz.address.trim().slice(0, 120) } : {}),
    };

    void commitChange((prev) => ({
      ...prev,
      items: [...prev.items, newItem],
    }));
  };

  const handleMoveItem = (index: number, delta: -1 | 1) => {
    const targetIndex = index + delta;
    if (targetIndex < 0 || targetIndex >= stateRef.current.items.length) return;
    void commitChange((prev) => {
      const nextItems = [...prev.items];
      const [moved] = nextItems.splice(index, 1);
      nextItems.splice(targetIndex, 0, moved);
      return { ...prev, items: nextItems };
    });
  };

  const handleToggleItemActive = (id: string) => {
    void commitChange((prev) => ({
      ...prev,
      items: prev.items.map((it) => (it.id === id ? { ...it, active: !it.active } : it)),
    }));
  };

  const handleDeleteItem = (id: string) => {
    if (editingItemId === id) {
      resetComposer();
    }
    void commitChange((prev) => ({
      ...prev,
      items: prev.items.filter((it) => it.id !== id),
    }));
  };

  return (
    <div className="space-y-5">
      {/* Page Header */}
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 pb-4">
        <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
          Ribbon
        </h1>

        <div className="flex items-center gap-2 text-xs min-h-[24px]">
          {saveState === 'saving' && (
            <span className="inline-flex items-center gap-1.5 text-slate-500 font-medium">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Saving...
            </span>
          )}
          {saveState === 'saved' && (
            <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
              <Check className="w-3.5 h-3.5" />
              Saved
            </span>
          )}
        </div>
      </div>

      {error && (
        <div className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">
          {error}
        </div>
      )}

      {/* Live Preview */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
          <span className="font-semibold text-slate-700">Preview</span>
          <span className="font-mono-tabular">
            {state.enabled ? 'Visible' : 'Hidden'} ·{' '}
            {state.mode === 'moving' ? `Moving (${state.speed})` : 'Static'}
          </span>
        </div>
        <ClubRibbon config={previewConfig} playersById={playersById} isPreview={true} />
      </div>

      {/* Display Controls (Auto-saved on click) */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 flex flex-wrap items-center gap-5">
        {/* Visible Toggle */}
        <div className="flex items-center gap-2.5">
          <span className="text-xs font-semibold text-slate-700">Ribbon</span>
          <button
            type="button"
            role="switch"
            aria-checked={state.enabled}
            onClick={() => void commitChange((prev) => ({ ...prev, enabled: !prev.enabled }))}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              state.enabled ? 'bg-emerald-700' : 'bg-slate-300'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                state.enabled ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>

        {/* Moving / Static Segmented Control */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-700">Style</span>
          <div className="inline-flex items-center p-0.5 bg-slate-100 border border-slate-200 rounded-lg">
            {(
              [
                { id: 'moving', label: 'Moving' },
                { id: 'static', label: 'Static' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => void commitChange((prev) => ({ ...prev, mode: opt.id }))}
                className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                  state.mode === opt.id
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Speed Control (only in Moving mode) */}
        {state.mode === 'moving' && (
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-700">Speed</span>
            <div className="inline-flex items-center p-0.5 bg-slate-100 border border-slate-200 rounded-lg">
              {(
                [
                  { id: 'slow', label: 'Slow' },
                  { id: 'normal', label: 'Normal' },
                  { id: 'fast', label: 'Fast' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => void commitChange((prev) => ({ ...prev, speed: opt.id }))}
                  className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                    state.speed === opt.id
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Member Businesses Quick-Pick */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <button
          type="button"
          onClick={() => setShowMemberBusinesses((v) => !v)}
          className="w-full px-4 py-3 flex items-center justify-between gap-3 text-left hover:bg-slate-50 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Briefcase className="w-4 h-4 text-emerald-700 shrink-0" />
            <span className="text-sm font-semibold text-slate-900">
              Member Businesses ({promotableMemberBusinesses.length})
            </span>
          </div>
          {showMemberBusinesses ? (
            <ChevronUp className="w-4 h-4 text-slate-400" />
          ) : (
            <ChevronDown className="w-4 h-4 text-slate-400" />
          )}
        </button>

        {showMemberBusinesses && (
          <div className="border-t border-slate-200 divide-y divide-slate-100">
            {promotableMemberBusinesses.length === 0 ? (
              <div className="px-4 py-6 text-center text-xs text-slate-500">
                No member businesses added yet.
              </div>
            ) : (
              promotableMemberBusinesses.map((p) => {
                const biz = p.business!;
                const alreadyFeatured = state.items.some((it) => it.linkedPlayerUid === p.uid);
                const safeLogo = biz.logoUrl ? normalizeSafeImageUrl(biz.logoUrl) : '';
                const safeWeb = biz.website ? normalizeSafeHttpUrl(biz.website) : '';
                return (
                  <div
                    key={p.uid}
                    className="px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs"
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      {/* Business Logo */}
                      {safeLogo ? (
                        <div className="w-11 h-11 rounded-lg bg-slate-50 border border-slate-200 overflow-hidden shrink-0 flex items-center justify-center p-1">
                          <img
                            src={safeLogo}
                            alt={biz.businessName}
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-contain"
                          />
                        </div>
                      ) : (
                        <div className="w-11 h-11 rounded-lg bg-slate-100 border border-slate-200 shrink-0 flex items-center justify-center text-slate-400">
                          <Briefcase className="w-4 h-4" />
                        </div>
                      )}

                      <div className="min-w-0 flex-1 space-y-0.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-semibold text-slate-900">{biz.businessName}</span>
                          {biz.category && (
                            <>
                              <span aria-hidden="true" className="text-slate-300">
                                ·
                              </span>
                              <span className="text-slate-500">{biz.category}</span>
                            </>
                          )}
                          <span aria-hidden="true" className="text-slate-300">
                            ·
                          </span>
                          <span className="inline-flex items-center gap-1.5 text-slate-600 font-medium">
                            {p.approvedPhotoUrl ? (
                              <img
                                src={p.approvedPhotoUrl}
                                alt={`${p.firstName} ${p.lastName}`}
                                referrerPolicy="no-referrer"
                                className="w-5 h-5 rounded-full object-cover border border-slate-200 shrink-0"
                              />
                            ) : (
                              <span className="w-5 h-5 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0">
                                <UserIcon className="w-3 h-3 text-slate-400" />
                              </span>
                            )}
                            <span>
                              {p.firstName} {p.lastName}
                            </span>
                          </span>
                        </div>

                        {biz.tagline && (
                          <div className="text-slate-600 truncate max-w-xl">{biz.tagline}</div>
                        )}

                        {(biz.phone || biz.address || safeWeb) && (
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
                            {biz.phone && (
                              <span className="inline-flex items-center gap-1 font-mono-tabular">
                                <Phone className="w-3 h-3 text-slate-400" />
                                {biz.phone}
                              </span>
                            )}
                            {biz.address && (
                              <span className="inline-flex items-center gap-1">
                                <MapPin className="w-3 h-3 text-slate-400" />
                                {biz.address}
                              </span>
                            )}
                            {safeWeb && (
                              <span className="inline-flex items-center gap-1 text-emerald-700">
                                <Globe className="w-3 h-3" />
                                {safeWeb.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/+$/, '')}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    <button
                      type="button"
                      disabled={alreadyFeatured}
                      onClick={() => handleFeatureMemberBusiness(p)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1 whitespace-nowrap shrink-0 transition-colors ${
                        alreadyFeatured
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 cursor-default'
                          : 'bg-slate-900 hover:bg-slate-800 text-white'
                      }`}
                    >
                      {alreadyFeatured ? (
                        <>
                          <Check className="w-3.5 h-3.5" />
                          Added
                        </>
                      ) : (
                        <>
                          <Plus className="w-3.5 h-3.5" />
                          Feature
                        </>
                      )}
                    </button>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* Ribbon Content Items */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-slate-900">
            Content ({state.items.length})
          </h2>
          <button
            type="button"
            onClick={() => (showComposer ? resetComposer() : openNewComposer())}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap transition-colors ${
              showComposer
                ? 'border border-slate-300 bg-white hover:bg-slate-50 text-slate-700'
                : 'bg-slate-900 hover:bg-slate-800 text-white'
            }`}
          >
            {showComposer ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
            {showComposer ? 'Close' : 'Add Item'}
          </button>
        </div>

        {/* Collapsible Add / Edit Form (Auto-saves on Add / Update) */}
        {showComposer && (
          <form
            onSubmit={handleApplyItemDraft}
            className="p-4 sm:p-5 bg-slate-50 border-b border-slate-200 space-y-4"
          >
            {formError && (
              <div className="px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">
                {formError}
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                {TYPE_OPTIONS.map((opt) => {
                  const Icon = opt.icon;
                  const active = draftType === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setDraftType(opt.id)}
                      className={`px-3 py-1.5 rounded-lg border text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap ${
                        active
                          ? 'bg-slate-900 border-slate-900 text-white'
                          : 'bg-white border-slate-300 text-slate-700 hover:border-slate-400'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      {opt.label}
                    </button>
                  );
                })}
              </div>

              {draftType === 'business' && (
                <div className="flex items-center gap-2">
                  <label className="text-xs font-semibold text-slate-600 whitespace-nowrap">
                    Member
                  </label>
                  <select
                    value={draftLinkedUid}
                    onChange={(e) => handleLinkPlayerChange(e.target.value)}
                    className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-600"
                  >
                    <option value="">None (external)</option>
                    {sortedPlayers.map((p) => (
                      <option key={p.uid} value={p.uid}>
                        {p.firstName} {p.lastName}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Title *</label>
                <input
                  type="text"
                  required
                  maxLength={80}
                  value={draftTitle}
                  onChange={(e) => setDraftTitle(e.target.value)}
                  placeholder={
                    draftType === 'business'
                      ? 'Business name'
                      : draftType === 'news'
                        ? 'Headline'
                        : 'Announcement title'
                  }
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Message</label>
                <input
                  type="text"
                  maxLength={180}
                  value={draftText}
                  onChange={(e) => setDraftText(e.target.value)}
                  placeholder="Short detail or offer"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                />
              </div>
            </div>

            <div className="grid sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Website</label>
                <input
                  type="text"
                  maxLength={180}
                  value={draftWebsite}
                  onChange={(e) => setDraftWebsite(e.target.value)}
                  placeholder="https://..."
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-xs focus:outline-none focus:ring-2 focus:ring-emerald-600"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Phone</label>
                <input
                  type="tel"
                  maxLength={30}
                  value={draftPhone}
                  onChange={(e) => setDraftPhone(e.target.value)}
                  placeholder="(604) 555-0100"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-xs font-mono-tabular focus:outline-none focus:ring-2 focus:ring-emerald-600"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Location</label>
                <input
                  type="text"
                  maxLength={120}
                  value={draftAddress}
                  onChange={(e) => setDraftAddress(e.target.value)}
                  placeholder="North Vancouver"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-xs focus:outline-none focus:ring-2 focus:ring-emerald-600"
                />
              </div>
            </div>

            {/* Logo / Ad Image Upload */}
            <div className="flex flex-wrap items-center gap-3">
              <div className="w-14 h-14 rounded-lg bg-white border border-slate-300 overflow-hidden shrink-0 flex items-center justify-center p-1">
                {draftImageUrl && normalizeSafeImageUrl(draftImageUrl) ? (
                  <img
                    src={normalizeSafeImageUrl(draftImageUrl)}
                    alt="Ribbon media preview"
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <ImagePlus className="w-5 h-5 text-slate-400" />
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-xs font-semibold text-slate-800 inline-flex items-center gap-1.5 cursor-pointer transition-colors">
                  <ImagePlus className="w-3.5 h-3.5 text-emerald-700" />
                  {uploadingImg
                    ? 'Processing...'
                    : draftImageUrl
                      ? 'Change Logo / Image'
                      : 'Upload Logo / Image'}
                  <input
                    type="file"
                    accept="image/*"
                    disabled={uploadingImg}
                    onChange={handleUploadItemImage}
                    className="hidden"
                  />
                </label>
                {draftImageUrl && (
                  <button
                    type="button"
                    onClick={() => setDraftImageUrl('')}
                    className="px-2.5 py-1.5 rounded-lg text-xs font-semibold text-rose-700 hover:bg-rose-50"
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={resetComposer}
                className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-xs font-semibold text-slate-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={uploadingImg}
                className="px-4 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold disabled:opacity-50"
              >
                {editingItemId ? 'Update' : 'Add'}
              </button>
            </div>
          </form>
        )}

        {/* Item Rows */}
        {state.items.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs text-slate-500">
            No ribbon items yet.
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {state.items.map((item, idx) => {
              const typeMeta = TYPE_OPTIONS.find((t) => t.id === item.type) || TYPE_OPTIONS[2];
              const Icon = typeMeta.icon;
              const linkedPlayer = item.linkedPlayerUid
                ? playersById.get(item.linkedPlayerUid)
                : undefined;
              const rawImg = item.imageUrl || linkedPlayer?.business?.logoUrl || '';
              const safeImg = rawImg ? normalizeSafeImageUrl(rawImg) : '';
              const safeWeb = item.website ? normalizeSafeHttpUrl(item.website) : '';
              const ownerAvatar = linkedPlayer?.approvedPhotoUrl || '';
              return (
                <div
                  key={item.id}
                  className={`px-4 py-3 flex items-center justify-between gap-3 text-xs ${
                    item.active ? '' : 'opacity-50 bg-slate-50/70'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    {safeImg ? (
                      <div className="w-11 h-11 rounded-lg bg-white border border-slate-200 overflow-hidden shrink-0 flex items-center justify-center p-1">
                        <img
                          src={safeImg}
                          alt={item.title}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-contain"
                        />
                      </div>
                    ) : (
                      <div className="w-11 h-11 rounded-lg bg-slate-100 border border-slate-200 shrink-0 flex items-center justify-center">
                        <Icon className={`w-4 h-4 ${typeMeta.accentClass}`} />
                      </div>
                    )}
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={`font-semibold ${typeMeta.accentClass}`}>
                          {typeMeta.label}
                        </span>
                        <span aria-hidden="true" className="text-slate-300">
                          ·
                        </span>
                        <span className="font-semibold text-slate-900 truncate">{item.title}</span>
                        {item.ownerName && (
                          <>
                            <span aria-hidden="true" className="text-slate-300">
                              ·
                            </span>
                            <span className="inline-flex items-center gap-1.5 text-slate-500">
                              {ownerAvatar && (
                                <img
                                  src={ownerAvatar}
                                  alt={item.ownerName}
                                  referrerPolicy="no-referrer"
                                  className="w-4 h-4 rounded-full object-cover border border-slate-200 shrink-0"
                                />
                              )}
                              <span>{item.ownerName}</span>
                            </span>
                          </>
                        )}
                      </div>
                      {item.text && (
                        <div className="text-slate-600 truncate">{item.text}</div>
                      )}
                      {(item.phone || item.address || safeWeb) && (
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
                          {item.phone && (
                            <span className="inline-flex items-center gap-1 font-mono-tabular">
                              <Phone className="w-3 h-3 text-slate-400" />
                              {item.phone}
                            </span>
                          )}
                          {item.address && (
                            <span className="inline-flex items-center gap-1">
                              <MapPin className="w-3 h-3 text-slate-400" />
                              {item.address}
                            </span>
                          )}
                          {safeWeb && (
                            <span className="inline-flex items-center gap-1 text-emerald-700">
                              <Globe className="w-3 h-3" />
                              {safeWeb.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/+$/, '')}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      disabled={idx === 0}
                      onClick={() => handleMoveItem(idx, -1)}
                      title="Move up"
                      aria-label="Move item up"
                      className="p-1.5 rounded-md text-slate-400 hover:text-slate-800 hover:bg-slate-100 disabled:opacity-30"
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={idx === state.items.length - 1}
                      onClick={() => handleMoveItem(idx, 1)}
                      title="Move down"
                      aria-label="Move item down"
                      className="p-1.5 rounded-md text-slate-400 hover:text-slate-800 hover:bg-slate-100 disabled:opacity-30"
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleToggleItemActive(item.id)}
                      title={item.active ? 'Hide item' : 'Show item'}
                      aria-label={item.active ? 'Hide item' : 'Show item'}
                      className="p-1.5 rounded-md text-slate-500 hover:text-slate-900 hover:bg-slate-100"
                    >
                      {item.active ? (
                        <Eye className="w-3.5 h-3.5 text-emerald-700" />
                      ) : (
                        <EyeOff className="w-3.5 h-3.5 text-slate-400" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => openEditComposer(item)}
                      title="Edit item"
                      aria-label="Edit item"
                      className="p-1.5 rounded-md text-slate-500 hover:text-slate-900 hover:bg-slate-100"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteItem(item.id)}
                      title="Delete item"
                      aria-label="Delete item"
                      className="p-1.5 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
