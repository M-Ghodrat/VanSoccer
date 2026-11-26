import React, { useEffect, useMemo, useRef, useState } from 'react';
import { User } from 'firebase/auth';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Briefcase,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronUp,
  ChevronsLeftRight,
  Clock,
  Eye,
  EyeOff,
  Gauge,
  Globe,
  ImagePlus,
  Loader2,
  MapPin,
  Megaphone,
  Newspaper,
  PanelTop,
  Pencil,
  Phone,
  Play,
  Plus,
  RotateCcw,
  Square,
  Timer,
  Trash2,
  User as UserIcon,
  X,
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import {
  findPlayerBusinessLogo,
  getPlayerBusinesses,
  getRibbonItemScheduleStatus,
  isValidHexColor,
  normalizeSafeHttpUrl,
  normalizeSafeImageUrl,
  PlayerBusinessInfo,
  PlayerProfile,
  RIBBON_LUXURY_PRESETS,
  RibbonConfig,
  RibbonDirection,
  RibbonHeight,
  RibbonItem,
  RibbonItemType,
  RibbonLuxuryPreset,
  RibbonMode,
  RibbonSpeed,
  RibbonWidth,
} from '../types';
import { compressBrandImageFile } from '../utils/imageUpload';
import { ClubRibbon } from './ClubRibbon';

interface RibbonManagerProps {
  user: User;
  ribbonConfig: RibbonConfig;
  players: PlayerProfile[];
  onAppliedConfig?: (config: RibbonConfig) => void;
  onDirtyChange?: (dirty: boolean) => void;
  registerApplyHandler?: (handler: (() => Promise<boolean>) | null) => void;
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

const DURATION_PRESETS: { id: string; label: string; hours: number | null }[] = [
  { id: 'always', label: 'Always', hours: null },
  { id: '24h', label: '24 Hours', hours: 24 },
  { id: '3d', label: '3 Days', hours: 72 },
  { id: '7d', label: '7 Days', hours: 168 },
  { id: '14d', label: '14 Days', hours: 336 },
  { id: '30d', label: '30 Days', hours: 720 },
];

const AUTO_ROTATE_OPTIONS = [
  { value: 5, label: '5s' },
  { value: 8, label: '8s' },
  { value: 12, label: '12s' },
  { value: 20, label: '20s' },
];

const SPEED_DISPLAY_LABEL: Record<RibbonSpeed, string> = {
  slow: '0.5×',
  normal: '1×',
  brisk: '1.5×',
  fast: '2×',
};

function makeRibbonItemId(): string {
  return `rbn_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function getAutoContrastText(bgHex: string): string {
  const clean = bgHex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16) || 15;
  const g = parseInt(clean.slice(2, 4), 16) || 23;
  const b = parseInt(clean.slice(4, 6), 16) || 42;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.62 ? '#1C1917' : '#F8FAFC';
}

function isoToLocalDatetimeInput(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localDatetimeInputToIso(localStr: string): string {
  if (!localStr.trim()) return '';
  const d = new Date(localStr);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString();
}

function formatShortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatRemainingTime(expiresAtIso: string, nowMs: number): string {
  const diffMs = Date.parse(expiresAtIso) - nowMs;
  if (Number.isNaN(diffMs) || diffMs <= 0) return 'Expired';
  const totalHours = Math.ceil(diffMs / (1000 * 60 * 60));
  if (totalHours < 24) return `${totalHours}h left`;
  const days = Math.ceil(totalHours / 24);
  return `${days}d left`;
}

interface LocalRibbonState {
  enabled: boolean;
  mode: RibbonMode;
  speed: RibbonSpeed;
  themePreset: string;
  bgColor: string;
  accentColor: string;
  textColor: string;
  width: RibbonWidth;
  height: RibbonHeight;
  direction: RibbonDirection;
  autoRotateSeconds: number;
  borderAccent: boolean;
  showControls: boolean;
  items: RibbonItem[];
}

function configToLocalState(cfg: RibbonConfig): LocalRibbonState {
  return {
    enabled: cfg.enabled,
    mode: cfg.mode || 'moving',
    speed: cfg.speed || 'normal',
    themePreset: cfg.themePreset || 'obsidian_pitch',
    bgColor: isValidHexColor(cfg.bgColor) ? cfg.bgColor : '#0F172A',
    accentColor: isValidHexColor(cfg.accentColor) ? cfg.accentColor : '#10B981',
    textColor: isValidHexColor(cfg.textColor) ? cfg.textColor : '#F8FAFC',
    width: cfg.width || 'full',
    height: cfg.height || 'standard',
    direction: cfg.direction || 'left',
    autoRotateSeconds:
      typeof cfg.autoRotateSeconds === 'number' && cfg.autoRotateSeconds > 0
        ? cfg.autoRotateSeconds
        : 8,
    borderAccent: Boolean(cfg.borderAccent),
    showControls: cfg.showControls !== false,
    items: Array.isArray(cfg.items) ? cfg.items : [],
  };
}

function buildSanitizedRibbonConfig(next: LocalRibbonState, uid: string): RibbonConfig {
  const validTypes: RibbonItemType[] = ['business', 'news', 'announcement'];
  const sanitizedItems: RibbonItem[] = next.items
    .filter((it) => Boolean(it && typeof it.title === 'string' && it.title.trim().length > 0))
    .slice(0, MAX_RIBBON_ITEMS)
    .map((it) => {
      const safeId =
        typeof it.id === 'string' && it.id.trim().length > 0
          ? it.id.trim().slice(0, 64)
          : makeRibbonItemId();
      const safeType: RibbonItemType = validTypes.includes(it.type) ? it.type : 'announcement';
      const clean: RibbonItem = {
        id: safeId,
        type: safeType,
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
      if (it.startsAtIso && it.startsAtIso.trim()) {
        clean.startsAtIso = it.startsAtIso.trim().slice(0, 40);
      }
      if (it.expiresAtIso && it.expiresAtIso.trim()) {
        clean.expiresAtIso = it.expiresAtIso.trim().slice(0, 40);
      }
      return clean;
    });

  const safeBg = isValidHexColor(next.bgColor) ? next.bgColor.toUpperCase() : '#0F172A';
  const safeAccent = isValidHexColor(next.accentColor)
    ? next.accentColor.toUpperCase()
    : '#10B981';
  const safeText = isValidHexColor(next.textColor) ? next.textColor.toUpperCase() : '#F8FAFC';
  const rawRotate = typeof next.autoRotateSeconds === 'number' ? next.autoRotateSeconds : 8;
  const safeRotate = rawRotate > 0 ? Math.max(5, Math.min(120, Math.round(rawRotate))) : 8;

  return {
    enabled: Boolean(next.enabled),
    mode: next.mode === 'static' ? 'static' : 'moving',
    speed:
      next.speed === 'slow' || next.speed === 'brisk' || next.speed === 'fast'
        ? next.speed
        : 'normal',
    themePreset: (next.themePreset || 'custom').slice(0, 40),
    bgColor: safeBg,
    accentColor: safeAccent,
    textColor: safeText,
    width: next.width === 'wide' || next.width === 'compact' ? next.width : 'full',
    height: next.height === 'slim' || next.height === 'tall' ? next.height : 'standard',
    direction: next.direction === 'right' ? 'right' : 'left',
    autoRotateSeconds: safeRotate,
    borderAccent: Boolean(next.borderAccent),
    showControls: Boolean(next.showControls),
    items: sanitizedItems,
    updatedBy: uid,
  };
}

export const RibbonManager: React.FC<RibbonManagerProps> = ({
  user,
  ribbonConfig,
  players,
  onAppliedConfig,
  onDirtyChange,
  registerApplyHandler,
}) => {
  const [state, setState] = useState<LocalRibbonState>(() => configToLocalState(ribbonConfig));
  const stateRef = useRef<LocalRibbonState>(state);
  stateRef.current = state;

  const onAppliedConfigRef = useRef(onAppliedConfig);
  onAppliedConfigRef.current = onAppliedConfig;

  const onDirtyChangeRef = useRef(onDirtyChange);
  onDirtyChangeRef.current = onDirtyChange;

  const [nowMs, setNowMs] = useState(() => Date.now());
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [error, setError] = useState<string | null>(null);
  const savedTimerRef = useRef<number | null>(null);

  // Compact icon-bar collapsible panel ('motion' | 'size' | 'color' | null)
  const [openPanel, setOpenPanel] = useState<'motion' | 'size' | 'color' | null>(null);

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
  const [draftStartsLocal, setDraftStartsLocal] = useState('');
  const [draftExpiresLocal, setDraftExpiresLocal] = useState('');
  const [draftDurationPreset, setDraftDurationPreset] = useState<string>('always');
  const [draftActive, setDraftActive] = useState(true);
  const [uploadingImg, setUploadingImg] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [showMemberBusinesses, setShowMemberBusinesses] = useState(true);
  const [quickFeatureDurationHours, setQuickFeatureDurationHours] = useState<number | null>(null);

  const savedSnapshotKey = useMemo(
    () => JSON.stringify(buildSanitizedRibbonConfig(configToLocalState(ribbonConfig), user.uid)),
    [ribbonConfig, user.uid]
  );

  const draftSnapshotKey = useMemo(
    () => JSON.stringify(buildSanitizedRibbonConfig(state, user.uid)),
    [state, user.uid]
  );

  const isDirty = draftSnapshotKey !== savedSnapshotKey;
  const isDirtyRef = useRef(isDirty);
  isDirtyRef.current = isDirty;

  useEffect(() => {
    const t = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  // Keep draft synced with external Firestore updates only when user has no unapplied edits
  useEffect(() => {
    if (isDirtyRef.current) return;
    const next = configToLocalState(ribbonConfig);
    stateRef.current = next;
    setState(next);
  }, [ribbonConfig]);

  useEffect(() => {
    onDirtyChangeRef.current?.(isDirty);
  }, [isDirty]);

  useEffect(() => {
    return () => {
      onDirtyChangeRef.current?.(false);
      if (savedTimerRef.current) {
        window.clearTimeout(savedTimerRef.current);
      }
    };
  }, []);

  // Warn before closing or refreshing the browser tab when there are unapplied changes
  useEffect(() => {
    if (!isDirty) return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);

  // Close open compact toolbar popover on Escape
  useEffect(() => {
    if (!openPanel) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenPanel(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [openPanel]);

  const playersById = useMemo(() => new Map(players.map((p) => [p.uid, p])), [players]);

  const sortedPlayers = useMemo(
    () =>
      [...players].sort((a, b) =>
        `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`)
      ),
    [players]
  );

  const promotableMemberBusinesses = useMemo(() => {
    const entries: {
      key: string;
      player: PlayerProfile;
      business: PlayerBusinessInfo;
    }[] = [];
    for (const p of players) {
      const list = getPlayerBusinesses(p);
      list.forEach((biz, idx) => {
        if (biz.businessName.trim().length > 0 && biz.allowPromotion !== false) {
          entries.push({
            key: `${p.uid}_${biz.id || idx}`,
            player: p,
            business: biz,
          });
        }
      });
    }
    return entries.sort((a, b) =>
      a.business.businessName.localeCompare(b.business.businessName)
    );
  }, [players]);

  const linkedPlayerBusinesses = useMemo(() => {
    if (!draftLinkedUid) return [];
    return getPlayerBusinesses(playersById.get(draftLinkedUid));
  }, [draftLinkedUid, playersById]);

  const previewConfig: RibbonConfig = useMemo(
    () => ({
      enabled: state.enabled,
      mode: state.mode,
      speed: state.speed,
      themePreset: state.themePreset,
      bgColor: state.bgColor,
      accentColor: state.accentColor,
      textColor: state.textColor,
      width: state.width,
      height: state.height,
      direction: state.direction,
      autoRotateSeconds: state.autoRotateSeconds,
      borderAccent: state.borderAccent,
      showControls: state.showControls,
      items: state.items,
      updatedBy: user.uid,
    }),
    [state, user.uid]
  );

  const updateDraft = (updater: (prev: LocalRibbonState) => LocalRibbonState) => {
    const next = updater(stateRef.current);
    stateRef.current = next;
    setState(next);
    setError(null);
    if (saveState === 'saved') {
      setSaveState('idle');
    }
  };

  const handleApply = async (): Promise<boolean> => {
    setError(null);
    setSaveState('saving');
    if (savedTimerRef.current) {
      window.clearTimeout(savedTimerRef.current);
      savedTimerRef.current = null;
    }
    try {
      const payload = buildSanitizedRibbonConfig(stateRef.current, user.uid);
      await setDoc(doc(db, 'ribbon', 'config'), {
        ...payload,
        updatedAt: serverTimestamp(),
      });
      onAppliedConfigRef.current?.(payload);
      setSaveState('saved');
      savedTimerRef.current = window.setTimeout(() => {
        setSaveState('idle');
      }, 2200);
      return true;
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.WRITE, 'ribbon/config');
      } catch (wrapped) {
        setError(wrapped instanceof Error ? wrapped.message : 'Failed to apply banner settings.');
      }
      setSaveState('idle');
      return false;
    }
  };

  const handleApplyRef = useRef(handleApply);
  handleApplyRef.current = handleApply;

  useEffect(() => {
    registerApplyHandler?.(() => handleApplyRef.current());
    return () => {
      registerApplyHandler?.(null);
    };
  }, [registerApplyHandler]);

  const handleDiscard = () => {
    const reverted = configToLocalState(ribbonConfig);
    stateRef.current = reverted;
    setState(reverted);
    setError(null);
    setSaveState('idle');
  };

  const applyLuxuryPreset = (preset: RibbonLuxuryPreset) => {
    updateDraft((prev) => ({
      ...prev,
      themePreset: preset.id,
      bgColor: preset.bgColor,
      accentColor: preset.accentColor,
      textColor: preset.textColor,
      borderAccent: preset.borderAccent,
    }));
  };

  const handleCustomBgColor = (hex: string) => {
    if (!isValidHexColor(hex)) return;
    const upper = hex.toUpperCase();
    updateDraft((prev) => ({
      ...prev,
      themePreset: 'custom',
      bgColor: upper,
      textColor: getAutoContrastText(upper),
    }));
  };

  const handleCustomAccentColor = (hex: string) => {
    if (!isValidHexColor(hex)) return;
    updateDraft((prev) => ({
      ...prev,
      themePreset: 'custom',
      accentColor: hex.toUpperCase(),
    }));
  };

  const handleCustomTextColor = (hex: string) => {
    if (!isValidHexColor(hex)) return;
    updateDraft((prev) => ({
      ...prev,
      themePreset: 'custom',
      textColor: hex.toUpperCase(),
    }));
  };

  const editingItem = useMemo(
    () => (editingItemId ? state.items.find((it) => it.id === editingItemId) || null : null),
    [editingItemId, state.items]
  );

  const isEditingExistingBusiness = useMemo(() => {
    if (!editingItem || editingItem.type !== 'business') return false;
    if (editingItem.linkedPlayerUid) return true;
    const normalizedTitle = editingItem.title.trim().toLowerCase();
    return players.some((p) =>
      getPlayerBusinesses(p).some(
        (b) => b.businessName.trim().toLowerCase() === normalizedTitle
      )
    );
  }, [editingItem, players]);

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
    setDraftStartsLocal('');
    setDraftExpiresLocal('');
    setDraftDurationPreset('always');
    setDraftActive(true);
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
    setDraftStartsLocal(isoToLocalDatetimeInput(item.startsAtIso));
    setDraftExpiresLocal(isoToLocalDatetimeInput(item.expiresAtIso));
    setDraftDurationPreset(item.expiresAtIso || item.startsAtIso ? 'custom' : 'always');
    setDraftActive(Boolean(item.active));
    setFormError(null);
    setShowComposer(true);
  };

  const handleSelectDurationPreset = (presetId: string, hours: number | null) => {
    setDraftDurationPreset(presetId);
    if (hours === null) {
      setDraftStartsLocal('');
      setDraftExpiresLocal('');
      return;
    }
    const baseMs = draftStartsLocal ? Date.parse(draftStartsLocal) : Date.now();
    const startMs = Number.isNaN(baseMs) ? Date.now() : baseMs;
    const endIso = new Date(startMs + hours * 60 * 60 * 1000).toISOString();
    setDraftExpiresLocal(isoToLocalDatetimeInput(endIso));
  };

  const applyMemberBusinessToDraft = (biz: PlayerBusinessInfo, overwrite = false) => {
    if ((overwrite || !draftTitle.trim()) && biz.businessName) setDraftTitle(biz.businessName);
    if ((overwrite || !draftCategory.trim()) && biz.category) setDraftCategory(biz.category);
    if ((overwrite || !draftText.trim()) && biz.tagline) setDraftText(biz.tagline);
    if ((overwrite || !draftPhone.trim()) && biz.phone) setDraftPhone(biz.phone);
    if ((overwrite || !draftWebsite.trim()) && biz.website) setDraftWebsite(biz.website);
    if ((overwrite || !draftAddress.trim()) && biz.address) setDraftAddress(biz.address);
    if ((overwrite || !draftImageUrl) && biz.logoUrl) setDraftImageUrl(biz.logoUrl);
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
    const businesses = getPlayerBusinesses(p);
    if (businesses.length > 0) {
      applyMemberBusinessToDraft(businesses[0], false);
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

    const startsAtIso = localDatetimeInputToIso(draftStartsLocal);
    const expiresAtIso = localDatetimeInputToIso(draftExpiresLocal);
    if (startsAtIso && expiresAtIso && Date.parse(expiresAtIso) <= Date.parse(startsAtIso)) {
      setFormError('End date must be after start date.');
      return;
    }

    // For existing member businesses, preserve business profile fields untouched and only update ad schedule/status
    if (isEditingExistingBusiness && editingItem) {
      const targetId = editingItem.id;
      const nextActive = draftActive;
      resetComposer();

      updateDraft((prev) => ({
        ...prev,
        items: prev.items.map((it) => {
          if (it.id !== targetId) return it;
          const updated: RibbonItem = {
            ...it,
            active: nextActive,
          };
          if (startsAtIso) {
            updated.startsAtIso = startsAtIso;
          } else {
            delete updated.startsAtIso;
          }
          if (expiresAtIso) {
            updated.expiresAtIso = expiresAtIso;
          } else {
            delete updated.expiresAtIso;
          }
          return updated;
        }),
      }));
      return;
    }

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
      setFormError(`Maximum ${MAX_RIBBON_ITEMS} banner items allowed.`);
      return;
    }

    const nextItem: RibbonItem = {
      id: editingItemId || makeRibbonItemId(),
      type: draftType,
      title: cleanTitle,
      text: draftText.trim().slice(0, 180),
      active: editingItemId ? draftActive : true,
      ...(safeImage ? { imageUrl: safeImage } : {}),
      ...(draftLinkedUid ? { linkedPlayerUid: draftLinkedUid.slice(0, 128) } : {}),
      ...(draftOwnerName.trim() ? { ownerName: draftOwnerName.trim().slice(0, 80) } : {}),
      ...(draftCategory.trim() ? { category: draftCategory.trim().slice(0, 50) } : {}),
      ...(draftPhone.trim() ? { phone: draftPhone.trim().slice(0, 30) } : {}),
      ...(safeWebsite ? { website: safeWebsite } : {}),
      ...(draftAddress.trim() ? { address: draftAddress.trim().slice(0, 120) } : {}),
      ...(startsAtIso ? { startsAtIso } : {}),
      ...(expiresAtIso ? { expiresAtIso } : {}),
    };

    const currentEditingId = editingItemId;
    resetComposer();

    updateDraft((prev) => ({
      ...prev,
      items: currentEditingId
        ? prev.items.map((it) => (it.id === currentEditingId ? nextItem : it))
        : [...prev.items, nextItem],
    }));
  };

  const handleFeatureMemberBusiness = (player: PlayerProfile, biz: PlayerBusinessInfo) => {
    if (!biz || !biz.businessName.trim()) return;
    if (stateRef.current.items.length >= MAX_RIBBON_ITEMS) {
      setError(`Maximum ${MAX_RIBBON_ITEMS} ribbon items allowed.`);
      return;
    }

    const ownerName = `${player.firstName} ${player.lastName}`.trim();
    const safeWebsite = biz.website ? normalizeSafeHttpUrl(biz.website) : '';
    const safeLogo = biz.logoUrl ? normalizeSafeImageUrl(biz.logoUrl) : '';
    const expiresAtIso =
      quickFeatureDurationHours !== null
        ? new Date(Date.now() + quickFeatureDurationHours * 60 * 60 * 1000).toISOString()
        : undefined;

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
      ...(expiresAtIso ? { expiresAtIso } : {}),
    };

    updateDraft((prev) => ({
      ...prev,
      items: [...prev.items, newItem],
    }));
  };

  const handleExtendItem = (id: string, extraDays: number) => {
    updateDraft((prev) => ({
      ...prev,
      items: prev.items.map((it) => {
        if (it.id !== id) return it;
        const currentEnd = it.expiresAtIso ? Date.parse(it.expiresAtIso) : NaN;
        const baseMs = !Number.isNaN(currentEnd) && currentEnd > Date.now() ? currentEnd : Date.now();
        return {
          ...it,
          active: true,
          expiresAtIso: new Date(baseMs + extraDays * 24 * 60 * 60 * 1000).toISOString(),
        };
      }),
    }));
  };

  const handleMoveItem = (index: number, delta: -1 | 1) => {
    const targetIndex = index + delta;
    if (targetIndex < 0 || targetIndex >= stateRef.current.items.length) return;
    updateDraft((prev) => {
      const nextItems = [...prev.items];
      const [moved] = nextItems.splice(index, 1);
      nextItems.splice(targetIndex, 0, moved);
      return { ...prev, items: nextItems };
    });
  };

  const handleToggleItemActive = (id: string) => {
    updateDraft((prev) => ({
      ...prev,
      items: prev.items.map((it) => (it.id === id ? { ...it, active: !it.active } : it)),
    }));
  };

  const handleDeleteItem = (id: string) => {
    if (editingItemId === id) {
      resetComposer();
    }
    updateDraft((prev) => ({
      ...prev,
      items: prev.items.filter((it) => it.id !== id),
    }));
  };

  const activePresetName = useMemo(() => {
    const match = RIBBON_LUXURY_PRESETS.find(
      (preset) =>
        state.themePreset === preset.id ||
        (state.bgColor.toUpperCase() === preset.bgColor.toUpperCase() &&
          state.accentColor.toUpperCase() === preset.accentColor.toUpperCase())
    );
    return match ? match.name : 'Custom';
  }, [state.themePreset, state.bgColor, state.accentColor]);

  const togglePanel = (panel: 'motion' | 'size' | 'color') => {
    setOpenPanel((curr) => (curr === panel ? null : panel));
  };

  return (
    <div className="space-y-4">
      {/* Page Header with Explicit Apply / Discard */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
        <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
          Ads & Announcements
        </h1>

        <div className="flex items-center gap-2">
          {isDirty ? (
            <span className="text-xs font-medium text-amber-700 mr-1 hidden sm:inline">
              Unapplied changes
            </span>
          ) : saveState === 'saved' ? (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 mr-1">
              <Check className="w-3.5 h-3.5" />
              Applied
            </span>
          ) : null}

          {isDirty && (
            <button
              type="button"
              disabled={saveState === 'saving'}
              onClick={handleDiscard}
              title="Discard unapplied changes"
              aria-label="Discard unapplied changes"
              className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 inline-flex items-center gap-1.5 transition-colors disabled:opacity-50"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Discard</span>
            </button>
          )}

          <button
            type="button"
            disabled={!isDirty || saveState === 'saving'}
            onClick={() => void handleApply()}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition-colors ${
              isDirty
                ? 'bg-emerald-700 hover:bg-emerald-800 text-white'
                : 'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed'
            }`}
          >
            {saveState === 'saving' ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Applying...
              </>
            ) : (
              <>
                <Check className="w-3.5 h-3.5" />
                Apply
              </>
            )}
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">
          {error}
        </div>
      )}

      {/* Live Preview + Compact Icon-First Toolbar */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {/* Live Preview Canvas */}
        <div className="p-3 bg-slate-100/80 border-b border-slate-200/80 space-y-2">
          <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-slate-700">Preview</span>
              {!state.enabled && (
                <button
                  type="button"
                  onClick={() => updateDraft((prev) => ({ ...prev, enabled: true }))}
                  className="px-1.5 py-0.5 rounded bg-amber-50 border border-amber-200 text-amber-800 hover:bg-amber-100 font-semibold transition-colors"
                >
                  Hidden · Enable
                </button>
              )}
            </div>
            <span className="font-mono-tabular text-slate-400">
              {state.mode === 'moving'
                ? `${SPEED_DISPLAY_LABEL[state.speed] || '1×'} · ${state.direction}`
                : `static · ${state.autoRotateSeconds}s`}{' '}
              · {state.width} · {state.height}
            </span>
          </div>
          <ClubRibbon config={previewConfig} playersById={playersById} isPreview={true} />
        </div>

        {/* Compact Icon-First Control Bar */}
        <div className="px-3 py-2 flex items-center justify-between gap-2 bg-white">
          <div className="flex items-center gap-1.5 flex-wrap">
            {/* 1. Visibility 1-click toggle */}
            <button
              type="button"
              onClick={() => updateDraft((prev) => ({ ...prev, enabled: !prev.enabled }))}
              title={state.enabled ? 'Banner visible (click to hide)' : 'Banner hidden (click to show)'}
              aria-label={state.enabled ? 'Hide banner' : 'Show banner'}
              aria-pressed={state.enabled}
              className={`h-8 w-8 rounded-lg border inline-flex items-center justify-center transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-600/40 ${
                state.enabled
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100'
                  : 'bg-slate-50 border-slate-200 text-slate-400 hover:text-slate-700 hover:bg-slate-100'
              }`}
            >
              {state.enabled ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
            </button>

            <span aria-hidden="true" className="w-px h-5 bg-slate-200 mx-0.5" />

            {/* 2. Motion & Timing Popover Trigger */}
            <button
              type="button"
              onClick={() => togglePanel('motion')}
              title={
                state.mode === 'moving'
                  ? `Motion: Moving (${SPEED_DISPLAY_LABEL[state.speed] || '1×'}, ${state.direction})`
                  : `Motion: Static (${state.autoRotateSeconds}s)`
              }
              aria-label="Motion and timing options"
              aria-expanded={openPanel === 'motion'}
              className={`h-8 px-2 rounded-lg border inline-flex items-center gap-1 transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-600/40 ${
                openPanel === 'motion'
                  ? 'bg-slate-900 border-slate-900 text-white'
                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300'
              }`}
            >
              {state.mode === 'moving' ? (
                <Play className="w-3.5 h-3.5" />
              ) : (
                <Square className="w-3.5 h-3.5" />
              )}
              <ChevronDown
                className={`w-3 h-3 transition-transform ${
                  openPanel === 'motion' ? 'rotate-180 opacity-90' : 'opacity-60'
                }`}
              />
            </button>

            {/* 3. Dimensions (Width & Height) Popover Trigger */}
            <button
              type="button"
              onClick={() => togglePanel('size')}
              title={`Dimensions: ${state.width} width, ${state.height} height`}
              aria-label="Width and height options"
              aria-expanded={openPanel === 'size'}
              className={`h-8 px-2 rounded-lg border inline-flex items-center gap-1 transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-600/40 ${
                openPanel === 'size'
                  ? 'bg-slate-900 border-slate-900 text-white'
                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300'
              }`}
            >
              <svg
                viewBox="0 0 16 16"
                fill="none"
                aria-hidden="true"
                className="w-4 h-4"
              >
                <rect
                  x="1.5"
                  y="4.5"
                  width="13"
                  height="7"
                  rx="1.5"
                  stroke="currentColor"
                  strokeWidth="1.4"
                />
                <path
                  d="M4.5 8h7"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                />
              </svg>
              <ChevronDown
                className={`w-3 h-3 transition-transform ${
                  openPanel === 'size' ? 'rotate-180 opacity-90' : 'opacity-60'
                }`}
              />
            </button>

            {/* 4. Colors & Presets Popover Trigger */}
            <button
              type="button"
              onClick={() => togglePanel('color')}
              title={`Colors: ${activePresetName} (${state.bgColor})`}
              aria-label="Colors and luxury presets"
              aria-expanded={openPanel === 'color'}
              className={`h-8 px-2 rounded-lg border inline-flex items-center gap-1.5 transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-600/40 ${
                openPanel === 'color'
                  ? 'bg-slate-900 border-slate-900 text-white'
                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300'
              }`}
            >
              <span
                style={{
                  backgroundColor: state.bgColor,
                  borderTopColor: state.accentColor,
                  borderTopWidth: '3px',
                }}
                className="w-4 h-4 rounded-[4px] border border-slate-300/90 shrink-0 block"
              />
              <ChevronDown
                className={`w-3 h-3 transition-transform ${
                  openPanel === 'color' ? 'rotate-180 opacity-90' : 'opacity-60'
                }`}
              />
            </button>

            <span aria-hidden="true" className="w-px h-5 bg-slate-200 mx-0.5" />

            {/* 5. Accent Trim 1-click toggle */}
            <button
              type="button"
              onClick={() => updateDraft((prev) => ({ ...prev, borderAccent: !prev.borderAccent }))}
              title={`Accent trim: ${state.borderAccent ? 'On' : 'Off'}`}
              aria-label="Toggle accent trim"
              aria-pressed={state.borderAccent}
              className={`h-8 w-8 rounded-lg border inline-flex items-center justify-center transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-600/40 ${
                state.borderAccent
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100'
                  : 'bg-white border-slate-200 text-slate-400 hover:text-slate-700 hover:bg-slate-50'
              }`}
            >
              <PanelTop className="w-4 h-4" />
            </button>

            {/* 6. Viewer Controls 1-click toggle */}
            <button
              type="button"
              onClick={() => updateDraft((prev) => ({ ...prev, showControls: !prev.showControls }))}
              title={`Viewer controls (pause / arrows): ${state.showControls ? 'On' : 'Off'}`}
              aria-label="Toggle viewer controls"
              aria-pressed={state.showControls}
              className={`h-8 w-8 rounded-lg border inline-flex items-center justify-center transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-600/40 ${
                state.showControls
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100'
                  : 'bg-white border-slate-200 text-slate-400 hover:text-slate-700 hover:bg-slate-50'
              }`}
            >
              <ChevronsLeftRight className="w-4 h-4" />
            </button>
          </div>

          {openPanel && (
            <button
              type="button"
              onClick={() => setOpenPanel(null)}
              title="Close options"
              aria-label="Close options"
              className="h-7 w-7 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 inline-flex items-center justify-center shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* On-Demand Compact Drawer: Motion */}
        {openPanel === 'motion' && (
          <div className="px-3 py-2.5 bg-slate-50/90 border-t border-slate-200 flex flex-wrap items-center gap-3">
            {/* Mode: Moving / Static */}
            <div
              className="inline-flex items-center p-0.5 bg-white border border-slate-200 rounded-lg"
              role="group"
              aria-label="Motion style"
            >
              {(
                [
                  { id: 'moving', label: 'Moving', Icon: Play },
                  { id: 'static', label: 'Static', Icon: Square },
                ] as const
              ).map(({ id, label, Icon }) => (
                <button
                  key={id}
                  type="button"
                  title={label}
                  aria-label={label}
                  onClick={() => updateDraft((prev) => ({ ...prev, mode: id }))}
                  className={`h-7 px-2.5 rounded-md inline-flex items-center gap-1.5 text-xs font-semibold transition-colors ${
                    state.mode === id
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Icon className="w-3 h-3" />
                  <span>{label}</span>
                </button>
              ))}
            </div>

            {state.mode === 'moving' ? (
              <>
                <span aria-hidden="true" className="w-px h-5 bg-slate-200" />
                {/* Speed */}
                <div className="inline-flex items-center gap-1.5" title="Scroll speed">
                  <Gauge className="w-3.5 h-3.5 text-slate-400" />
                  <div className="inline-flex items-center p-0.5 bg-white border border-slate-200 rounded-lg">
                    {(
                      [
                        { id: 'slow', short: '0.5×', tip: 'Slow (0.5×)' },
                        { id: 'normal', short: '1×', tip: 'Normal (1×)' },
                        { id: 'brisk', short: '1.5×', tip: 'Brisk (1.5×)' },
                        { id: 'fast', short: '2×', tip: 'Fast (2×)' },
                      ] as const
                    ).map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        title={`Speed: ${opt.tip}`}
                        aria-label={`Speed: ${opt.tip}`}
                        onClick={() => updateDraft((prev) => ({ ...prev, speed: opt.id }))}
                        className={`h-7 px-2 rounded-md text-[11px] font-mono-tabular font-semibold transition-colors ${
                          state.speed === opt.id
                            ? 'bg-slate-900 text-white'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        {opt.short}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Direction */}
                <div
                  className="inline-flex items-center p-0.5 bg-white border border-slate-200 rounded-lg"
                  role="group"
                  aria-label="Scroll direction"
                >
                  {(
                    [
                      { id: 'left', tip: 'Scroll left', Icon: ArrowLeft },
                      { id: 'right', tip: 'Scroll right', Icon: ArrowRight },
                    ] as const
                  ).map(({ id, tip, Icon }) => (
                    <button
                      key={id}
                      type="button"
                      title={tip}
                      aria-label={tip}
                      onClick={() => updateDraft((prev) => ({ ...prev, direction: id }))}
                      className={`h-7 w-7 rounded-md inline-flex items-center justify-center transition-colors ${
                        state.direction === id
                          ? 'bg-slate-900 text-white'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <>
                <span aria-hidden="true" className="w-px h-5 bg-slate-200" />
                {/* Auto-Rotate Interval */}
                <div className="inline-flex items-center gap-1.5" title="Auto-rotate interval">
                  <Timer className="w-3.5 h-3.5 text-slate-400" />
                  <div className="inline-flex items-center p-0.5 bg-white border border-slate-200 rounded-lg">
                    {AUTO_ROTATE_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        title={`Auto-rotate every ${opt.label}`}
                        aria-label={`Auto-rotate every ${opt.label}`}
                        onClick={() =>
                          updateDraft((prev) => ({ ...prev, autoRotateSeconds: opt.value }))
                        }
                        className={`h-7 px-2 rounded-md text-[11px] font-mono-tabular font-semibold transition-colors ${
                          state.autoRotateSeconds === opt.value
                            ? 'bg-slate-900 text-white'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* On-Demand Compact Drawer: Width & Height */}
        {openPanel === 'size' && (
          <div className="px-3 py-2.5 bg-slate-50/90 border-t border-slate-200 flex flex-wrap items-center gap-3">
            {/* Width visual glyphs */}
            <div className="inline-flex items-center gap-1.5">
              <div
                className="inline-flex items-center p-0.5 bg-white border border-slate-200 rounded-lg"
                role="group"
                aria-label="Banner width"
              >
                {(
                  [
                    { id: 'full', tip: 'Full width', barW: 16, barX: 1 },
                    { id: 'wide', tip: 'Wide width', barW: 12, barX: 3 },
                    { id: 'compact', tip: 'Compact width', barW: 8, barX: 5 },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    title={opt.tip}
                    aria-label={opt.tip}
                    onClick={() => updateDraft((prev) => ({ ...prev, width: opt.id }))}
                    className={`h-7 w-9 rounded-md inline-flex items-center justify-center transition-colors ${
                      state.width === opt.id
                        ? 'bg-slate-900 text-white'
                        : 'text-slate-500 hover:text-slate-900'
                    }`}
                  >
                    <svg viewBox="0 0 18 14" fill="none" aria-hidden="true" className="w-4.5 h-3.5">
                      <rect
                        x="0.75"
                        y="1.75"
                        width="16.5"
                        height="10.5"
                        rx="1.5"
                        stroke="currentColor"
                        strokeOpacity="0.28"
                        strokeWidth="1.2"
                      />
                      <rect
                        x={opt.barX}
                        y="5"
                        width={opt.barW}
                        height="4"
                        rx="1"
                        fill="currentColor"
                      />
                    </svg>
                  </button>
                ))}
              </div>
              <span className="text-[11px] font-medium text-slate-500 capitalize">
                {state.width}
              </span>
            </div>

            <span aria-hidden="true" className="w-px h-5 bg-slate-200" />

            {/* Height visual glyphs */}
            <div className="inline-flex items-center gap-1.5">
              <div
                className="inline-flex items-center p-0.5 bg-white border border-slate-200 rounded-lg"
                role="group"
                aria-label="Banner height"
              >
                {(
                  [
                    { id: 'slim', tip: 'Slim height', barH: 2.5, barY: 5.75 },
                    { id: 'standard', tip: 'Standard height', barH: 5, barY: 4.5 },
                    { id: 'tall', tip: 'Tall height', barH: 8, barY: 3 },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    title={opt.tip}
                    aria-label={opt.tip}
                    onClick={() => updateDraft((prev) => ({ ...prev, height: opt.id }))}
                    className={`h-7 w-9 rounded-md inline-flex items-center justify-center transition-colors ${
                      state.height === opt.id
                        ? 'bg-slate-900 text-white'
                        : 'text-slate-500 hover:text-slate-900'
                    }`}
                  >
                    <svg viewBox="0 0 18 14" fill="none" aria-hidden="true" className="w-4.5 h-3.5">
                      <rect
                        x="2"
                        y={opt.barY}
                        width="14"
                        height={opt.barH}
                        rx="1"
                        fill="currentColor"
                      />
                    </svg>
                  </button>
                ))}
              </div>
              <span className="text-[11px] font-medium text-slate-500 capitalize">
                {state.height}
              </span>
            </div>
          </div>
        )}

        {/* On-Demand Compact Drawer: Luxury Presets & Custom Palette */}
        {openPanel === 'color' && (
          <div className="px-3 py-2.5 bg-slate-50/90 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1.5">
              {RIBBON_LUXURY_PRESETS.map((preset) => {
                const isSelected =
                  state.themePreset === preset.id ||
                  (state.bgColor.toUpperCase() === preset.bgColor.toUpperCase() &&
                    state.accentColor.toUpperCase() === preset.accentColor.toUpperCase());
                return (
                  <button
                    key={preset.id}
                    type="button"
                    title={preset.name}
                    aria-label={preset.name}
                    onClick={() => applyLuxuryPreset(preset)}
                    style={{
                      backgroundColor: preset.bgColor,
                      borderTopColor: preset.accentColor,
                      borderTopWidth: '3px',
                    }}
                    className={`w-7 h-7 rounded-md border flex items-center justify-center transition-transform ${
                      isSelected
                        ? 'ring-2 ring-emerald-600 ring-offset-1 border-slate-400 scale-105'
                        : 'border-slate-300 hover:scale-105'
                    }`}
                  >
                    {isSelected && (
                      <Check
                        style={{ color: preset.textColor }}
                        className="w-3.5 h-3.5 drop-shadow-xs"
                      />
                    )}
                  </button>
                );
              })}

              <span aria-hidden="true" className="w-px h-5 bg-slate-200 mx-1" />

              {/* Compact Custom Color Pickers */}
              <label
                title={`Background color (${state.bgColor})`}
                className="h-7 px-1.5 rounded-md border border-slate-200 bg-white hover:border-slate-300 inline-flex items-center gap-1 cursor-pointer text-[10px] font-semibold text-slate-500"
              >
                <input
                  type="color"
                  aria-label="Background color"
                  value={state.bgColor}
                  onChange={(e) => handleCustomBgColor(e.target.value)}
                  className="w-4 h-4 rounded cursor-pointer border-0 bg-transparent p-0"
                />
                <span>BG</span>
              </label>

              <label
                title={`Accent color (${state.accentColor})`}
                className="h-7 px-1.5 rounded-md border border-slate-200 bg-white hover:border-slate-300 inline-flex items-center gap-1 cursor-pointer text-[10px] font-semibold text-slate-500"
              >
                <input
                  type="color"
                  aria-label="Accent color"
                  value={state.accentColor}
                  onChange={(e) => handleCustomAccentColor(e.target.value)}
                  className="w-4 h-4 rounded cursor-pointer border-0 bg-transparent p-0"
                />
                <span>AC</span>
              </label>

              <label
                title={`Text color (${state.textColor})`}
                className="h-7 px-1.5 rounded-md border border-slate-200 bg-white hover:border-slate-300 inline-flex items-center gap-1 cursor-pointer text-[10px] font-semibold text-slate-500"
              >
                <input
                  type="color"
                  aria-label="Text color"
                  value={state.textColor}
                  onChange={(e) => handleCustomTextColor(e.target.value)}
                  className="w-4 h-4 rounded cursor-pointer border-0 bg-transparent p-0"
                />
                <span>TX</span>
              </label>
            </div>

            <span className="text-[11px] font-medium text-slate-500 truncate">
              {activePresetName}
            </span>
          </div>
        )}
      </div>

      {/* Member Businesses Quick-Pick */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setShowMemberBusinesses((v) => !v)}
            className="flex items-center gap-2 text-left hover:text-emerald-800 transition-colors"
          >
            <Briefcase className="w-4 h-4 text-emerald-700 shrink-0" />
            <span className="text-sm font-semibold text-slate-900">
              Member Businesses ({promotableMemberBusinesses.length})
            </span>
            {showMemberBusinesses ? (
              <ChevronUp className="w-4 h-4 text-slate-400" />
            ) : (
              <ChevronDown className="w-4 h-4 text-slate-400" />
            )}
          </button>

          {showMemberBusinesses && promotableMemberBusinesses.length > 0 && (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-slate-500 font-medium whitespace-nowrap">
                Feature duration:
              </span>
              <select
                value={quickFeatureDurationHours === null ? 'always' : String(quickFeatureDurationHours)}
                onChange={(e) =>
                  setQuickFeatureDurationHours(
                    e.target.value === 'always' ? null : Number(e.target.value)
                  )
                }
                aria-label="Default duration when featuring a member business"
                className="px-2 py-1 rounded-lg border border-slate-200 bg-slate-50 text-xs font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-600"
              >
                {DURATION_PRESETS.map((opt) => (
                  <option
                    key={opt.id}
                    value={opt.hours === null ? 'always' : String(opt.hours)}
                  >
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {showMemberBusinesses && (
          <div className="border-t border-slate-200 divide-y divide-slate-100">
            {promotableMemberBusinesses.length === 0 ? (
              <div className="px-4 py-6 text-center text-xs text-slate-500">
                No member businesses added yet.
              </div>
            ) : (
              promotableMemberBusinesses.map(({ key, player: p, business: biz }) => {
                const normalizedName = biz.businessName.trim().toLowerCase();
                const alreadyFeatured = state.items.some(
                  (it) =>
                    it.linkedPlayerUid === p.uid &&
                    it.title.trim().toLowerCase() === normalizedName
                );
                const safeLogo = biz.logoUrl ? normalizeSafeImageUrl(biz.logoUrl) : '';
                const safeWeb = biz.website ? normalizeSafeHttpUrl(biz.website) : '';
                return (
                  <div
                    key={key}
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
                      onClick={() => handleFeatureMemberBusiness(p, biz)}
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
            {showComposer ? 'Close' : 'Add Ad / Notice'}
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

            {isEditingExistingBusiness && editingItem ? (
              <div className="p-3.5 rounded-lg bg-white border border-slate-200 flex items-start gap-3">
                {(() => {
                  const linked = editingItem.linkedPlayerUid
                    ? playersById.get(editingItem.linkedPlayerUid)
                    : undefined;
                  const rawLogo =
                    editingItem.imageUrl || findPlayerBusinessLogo(linked, editingItem.title);
                  const safeLogo = rawLogo ? normalizeSafeImageUrl(rawLogo) : '';
                  return safeLogo ? (
                    <div className="w-12 h-12 rounded-lg bg-slate-50 border border-slate-200 overflow-hidden shrink-0 flex items-center justify-center p-1">
                      <img
                        src={safeLogo}
                        alt={editingItem.title}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-contain"
                      />
                    </div>
                  ) : (
                    <div className="w-12 h-12 rounded-lg bg-slate-100 border border-slate-200 shrink-0 flex items-center justify-center text-emerald-700">
                      <Briefcase className="w-5 h-5" />
                    </div>
                  );
                })()}
                <div className="min-w-0 flex-1 space-y-1 text-xs">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-semibold text-emerald-700">Business</span>
                    <span aria-hidden="true" className="text-slate-300">
                      ·
                    </span>
                    <span className="font-semibold text-slate-900">{editingItem.title}</span>
                    {editingItem.category && (
                      <>
                        <span aria-hidden="true" className="text-slate-300">
                          ·
                        </span>
                        <span className="text-slate-500">{editingItem.category}</span>
                      </>
                    )}
                    {editingItem.ownerName && (
                      <>
                        <span aria-hidden="true" className="text-slate-300">
                          ·
                        </span>
                        <span className="text-slate-500">{editingItem.ownerName}</span>
                      </>
                    )}
                  </div>
                  {editingItem.text && <p className="text-slate-600">{editingItem.text}</p>}
                  <p className="text-[11px] text-slate-500">
                    Business details are managed in the member&apos;s Profile. Adjust the display
                    schedule and visibility below.
                  </p>
                </div>
              </div>
            ) : (
              <>
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
                    <div className="flex flex-wrap items-center gap-2">
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
                      {linkedPlayerBusinesses.length > 1 && (
                        <select
                          aria-label="Prefill from member business"
                          defaultValue=""
                          onChange={(e) => {
                            const idx = Number(e.target.value);
                            if (!Number.isNaN(idx) && linkedPlayerBusinesses[idx]) {
                              applyMemberBusinessToDraft(linkedPlayerBusinesses[idx], true);
                            }
                            e.target.value = '';
                          }}
                          className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-600"
                        >
                          <option value="">Load business...</option>
                          {linkedPlayerBusinesses.map((biz, idx) => (
                            <option key={biz.id || idx} value={idx}>
                              {biz.businessName}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  )}
                </div>

                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Title *
                    </label>
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
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Message
                    </label>
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
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Website
                    </label>
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
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Phone
                    </label>
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
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Location
                    </label>
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
              </>
            )}

            {/* Display Duration & Schedule */}
            <div
              className={`${isEditingExistingBusiness ? '' : 'pt-3 border-t border-slate-200'} space-y-2.5`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                  <CalendarClock className="w-3.5 h-3.5 text-emerald-700" />
                  <span>Display Duration</span>
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  {DURATION_PRESETS.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => handleSelectDurationPreset(opt.id, opt.hours)}
                      className={`px-2.5 py-1 rounded-md text-[11px] font-semibold border transition-colors whitespace-nowrap ${
                        draftDurationPreset === opt.id
                          ? 'bg-slate-900 border-slate-900 text-white'
                          : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-medium text-slate-500 mb-1">
                    Starts (optional — leave blank for immediately)
                  </label>
                  <input
                    type="datetime-local"
                    value={draftStartsLocal}
                    onChange={(e) => {
                      setDraftStartsLocal(e.target.value);
                      setDraftDurationPreset('custom');
                    }}
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-mono-tabular focus:outline-none focus:ring-2 focus:ring-emerald-600"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-500 mb-1">
                    Ends / Expires (optional — leave blank for always)
                  </label>
                  <input
                    type="datetime-local"
                    value={draftExpiresLocal}
                    onChange={(e) => {
                      setDraftExpiresLocal(e.target.value);
                      setDraftDurationPreset(e.target.value ? 'custom' : 'always');
                    }}
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-mono-tabular focus:outline-none focus:ring-2 focus:ring-emerald-600"
                  />
                </div>
              </div>

              {editingItemId && (
                <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer select-none pt-1">
                  <input
                    type="checkbox"
                    checked={draftActive}
                    onChange={(e) => setDraftActive(e.target.checked)}
                    className="rounded border-slate-300 text-emerald-700 focus:ring-emerald-600"
                  />
                  <span>Active (show in banner during scheduled window)</span>
                </label>
              )}
            </div>

            {/* Logo / Ad Image Upload (only for non-member-business items) */}
            {!isEditingExistingBusiness && (
              <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-slate-200">
                <div className="w-14 h-14 rounded-lg bg-white border border-slate-300 overflow-hidden shrink-0 flex items-center justify-center p-1">
                  {draftImageUrl && normalizeSafeImageUrl(draftImageUrl) ? (
                    <img
                      src={normalizeSafeImageUrl(draftImageUrl)}
                      alt="Banner media preview"
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
            )}

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
            No ads or announcements yet.
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {state.items.map((item, idx) => {
              const typeMeta = TYPE_OPTIONS.find((t) => t.id === item.type) || TYPE_OPTIONS[2];
              const Icon = typeMeta.icon;
              const linkedPlayer = item.linkedPlayerUid
                ? playersById.get(item.linkedPlayerUid)
                : undefined;
              const rawImg = item.imageUrl || findPlayerBusinessLogo(linkedPlayer, item.title);
              const safeImg = rawImg ? normalizeSafeImageUrl(rawImg) : '';
              const safeWeb = item.website ? normalizeSafeHttpUrl(item.website) : '';
              const ownerAvatar = linkedPlayer?.approvedPhotoUrl || '';
              const scheduleStatus = getRibbonItemScheduleStatus(item, nowMs);
              const isDimmed = scheduleStatus === 'hidden' || scheduleStatus === 'expired';

              return (
                <div
                  key={item.id}
                  className={`px-4 py-3 flex items-center justify-between gap-3 text-xs ${
                    isDimmed ? 'opacity-60 bg-slate-50/70' : ''
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
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
                        <span
                          className={`inline-flex items-center gap-1 font-medium ${
                            scheduleStatus === 'expired'
                              ? 'text-rose-700'
                              : scheduleStatus === 'scheduled'
                                ? 'text-amber-700'
                                : item.expiresAtIso
                                  ? 'text-emerald-700'
                                  : 'text-slate-400'
                          }`}
                        >
                          <Clock className="w-3 h-3 shrink-0" />
                          {scheduleStatus === 'expired' && item.expiresAtIso
                            ? `Expired ${formatShortDate(item.expiresAtIso)}`
                            : scheduleStatus === 'scheduled' && item.startsAtIso
                              ? `Starts ${formatShortDate(item.startsAtIso)}`
                              : item.expiresAtIso
                                ? `Ends ${formatShortDate(item.expiresAtIso)} (${formatRemainingTime(item.expiresAtIso, nowMs)})`
                                : 'Always active'}
                        </span>
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
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    {(scheduleStatus === 'expired' || item.expiresAtIso) && (
                      <button
                        type="button"
                        onClick={() => handleExtendItem(item.id, 7)}
                        title="Extend display by 7 days"
                        className="px-2 py-1 rounded-md text-[11px] font-semibold text-emerald-700 hover:bg-emerald-50 border border-emerald-200 whitespace-nowrap"
                      >
                        +7d
                      </button>
                    )}
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
