import { formatPhoneNumber } from './utils/phone';

export type UserRole = 'player' | 'manager' | 'admin';

export type PhotoStatus = 'none' | 'pending' | 'approved' | 'rejected';

export type GoalieOption = 'none' | 'willing' | 'only_goalie';

export type MatchStatus = 'open' | 'locked' | 'completed';

export const SOCCER_POSITIONS = [
  'GK',
  'LB',
  'CB',
  'RB',
  'CDM',
  'LM',
  'CM',
  'RM',
  'CAM',
  'LW',
  'RW',
  'ST',
] as const;

export type SoccerPosition = (typeof SOCCER_POSITIONS)[number];

export const POSITION_LABELS: Record<string, string> = {
  GK: 'Goalkeeper',
  LB: 'Left Back',
  CB: 'Center Back',
  RB: 'Right Back',
  CDM: 'Defensive Mid',
  LM: 'Left Mid',
  CM: 'Center Mid',
  RM: 'Right Mid',
  CAM: 'Attacking Mid',
  LW: 'Left Wing',
  RW: 'Right Wing',
  ST: 'Striker',
};

export const STANDARD_TEAM_COLORS = ['Red', 'Blue', 'Black', 'Yellow'] as const;
export type StandardTeamColor = (typeof STANDARD_TEAM_COLORS)[number];

export interface TeamColorStyle {
  bg: string;
  border: string;
  text: string;
  hex: string;
  ring: string;
}

export const TEAM_COLOR_PALETTE: Record<string, TeamColorStyle> = {
  Red: {
    bg: 'bg-red-600',
    border: 'border-red-300',
    text: 'text-white',
    hex: '#dc2626',
    ring: 'ring-red-400',
  },
  Blue: {
    bg: 'bg-blue-600',
    border: 'border-blue-300',
    text: 'text-white',
    hex: '#2563eb',
    ring: 'ring-blue-400',
  },
  Black: {
    bg: 'bg-slate-900',
    border: 'border-slate-500',
    text: 'text-white',
    hex: '#0f172a',
    ring: 'ring-slate-400',
  },
  Yellow: {
    bg: 'bg-yellow-400',
    border: 'border-yellow-200',
    text: 'text-slate-950',
    hex: '#facc15',
    ring: 'ring-yellow-300',
  },
};

const LEGACY_COLOR_ALIAS: Record<string, StandardTeamColor> = {
  Crimson: 'Red',
  Tangerine: 'Red',
  Cobalt: 'Blue',
  Violet: 'Blue',
  Charcoal: 'Black',
  Emerald: 'Black',
  Gold: 'Yellow',
  White: 'Yellow',
};

export function normalizeStandardTeamColor(color: string | undefined, fallbackIdx = 0): StandardTeamColor {
  if (color && (STANDARD_TEAM_COLORS as readonly string[]).includes(color)) {
    return color as StandardTeamColor;
  }
  if (color && LEGACY_COLOR_ALIAS[color]) {
    return LEGACY_COLOR_ALIAS[color];
  }
  return STANDARD_TEAM_COLORS[fallbackIdx % STANDARD_TEAM_COLORS.length];
}

export function getTeamColorPalette(color: string | undefined, fallbackIdx = 0): TeamColorStyle {
  const normalized = normalizeStandardTeamColor(color, fallbackIdx);
  return TEAM_COLOR_PALETTE[normalized];
}

export type PitchCollarStyle = 'crew' | 'polo' | 'high';

export const MAX_PLAYER_BUSINESSES = 5;

export interface PlayerBusinessInfo {
  id?: string;
  businessName: string;
  category: string;
  tagline: string;
  phone: string;
  website: string;
  address: string;
  logoUrl?: string;
  allowPromotion: boolean;
}

export const BUSINESS_CATEGORY_SUGGESTIONS = [
  'Real Estate',
  'Construction & Trades',
  'Auto Services',
  'Food & Hospitality',
  'Health & Dental',
  'Tech & IT',
  'Finance & Accounting',
  'Legal Services',
  'Retail & E-Commerce',
  'Fitness & Wellness',
  'Consulting',
  'Other',
] as const;

export function normalizeSafeHttpUrl(raw: string): string {
  const trimmed = raw.trim().replace(/[\r\n]+/g, '');
  if (!trimmed) return '';

  const candidate = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : /^[a-zA-Z0-9][a-zA-Z0-9.-]*\.[a-zA-Z]{2,}([/:?#].*)?$/.test(trimmed)
      ? `https://${trimmed}`
      : '';

  if (!candidate) return '';

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return '';
    }
    if (!parsed.hostname || !parsed.hostname.includes('.')) {
      return '';
    }
    const normalized = parsed.toString();
    return normalized.length <= 300 ? normalized : normalized.slice(0, 300);
  } catch {
    return '';
  }
}

export function normalizeSafeImageUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (/^data:image\/(png|jpeg|jpg|webp);base64,[a-zA-Z0-9+/=]+$/i.test(trimmed)) {
    return trimmed.length <= 80000 ? trimmed : '';
  }
  return normalizeSafeHttpUrl(trimmed);
}

export interface PlayerProfile {
  uid: string;
  firstName: string;
  lastName: string;
  age: number;
  favoritePositions: string[];
  photoStatus: PhotoStatus;
  approvedPhotoUrl: string;
  approvedPitchPhotoUrl?: string;
  pitchCollarStyle?: PitchCollarStyle;
  pitchSkinTone?: string;
  role: UserRole;
  appearances: number;
  username?: string;
  business?: PlayerBusinessInfo | null;
  businesses?: PlayerBusinessInfo[];
  createdAt?: unknown;
  updatedAt?: unknown;
}

export function getPlayerBusinesses(
  profile?: Pick<PlayerProfile, 'business' | 'businesses'> | null
): PlayerBusinessInfo[] {
  if (!profile) return [];
  const list: PlayerBusinessInfo[] = [];

  if (Array.isArray(profile.businesses)) {
    list.push(
      ...profile.businesses.filter(
        (b): b is PlayerBusinessInfo =>
          Boolean(b && typeof b.businessName === 'string' && b.businessName.trim().length > 0)
      )
    );
  } else if (
    profile.business &&
    typeof profile.business.businessName === 'string' &&
    profile.business.businessName.trim().length > 0
  ) {
    list.push(profile.business);
  }

  // Deduplicate by ID and normalized business name
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();
  const deduped: PlayerBusinessInfo[] = [];

  for (const b of list) {
    const idKey = b.id && b.id.trim() ? b.id.trim() : null;
    const nameKey = b.businessName.trim().toLowerCase();

    if (idKey && seenIds.has(idKey)) continue;

    if (seenNames.has(nameKey)) {
      // Merge newer details into the existing entry if previous was incomplete
      const existingIdx = deduped.findIndex(
        (d) => d.businessName.trim().toLowerCase() === nameKey
      );
      if (existingIdx !== -1) {
        const prev = deduped[existingIdx];
        if (!prev.website && b.website) prev.website = b.website;
        if (!prev.phone && b.phone) prev.phone = formatPhoneNumber(b.phone);
        if (!prev.logoUrl && b.logoUrl) prev.logoUrl = b.logoUrl;
        if (!prev.tagline && b.tagline) prev.tagline = b.tagline;
        if (!prev.address && b.address) prev.address = b.address;
        if (!prev.category && b.category) prev.category = b.category;
      }
      continue;
    }

    if (idKey) seenIds.add(idKey);
    seenNames.add(nameKey);
    deduped.push({ ...b, phone: formatPhoneNumber(b.phone) });
    if (deduped.length >= MAX_PLAYER_BUSINESSES) break;
  }

  return deduped;
}

export function findPlayerBusinessLogo(
  profile?: Pick<PlayerProfile, 'business' | 'businesses'> | null,
  businessTitle?: string
): string {
  const list = getPlayerBusinesses(profile);
  if (list.length === 0) return '';
  if (businessTitle && businessTitle.trim()) {
    const normalized = businessTitle.trim().toLowerCase();
    const exact = list.find((b) => b.businessName.trim().toLowerCase() === normalized);
    if (exact?.logoUrl) return exact.logoUrl;
  }
  const firstWithLogo = list.find((b) => Boolean(b.logoUrl));
  return firstWithLogo?.logoUrl || '';
}

export interface PlayerPrivateInfo {
  uid: string;
  email: string;
  dob: string;
  phone: string;
  emergencyContact: string;
  updatedAt?: unknown;
}

export interface PlayerPhotoSubmission {
  uid: string;
  pendingPhotoData: string;
  pendingPitchPhotoData?: string;
  pitchCollarStyle?: PitchCollarStyle;
  pitchSkinTone?: string;
  status: 'pending' | 'approved' | 'rejected';
  rejectionReason: string;
  submittedAt?: unknown;
}

export const RADAR_STAT_KEYS = [
  'attack',
  'technique',
  'stamina',
  'defense',
  'speed',
  'physics',
] as const;

export type RadarStatKey = (typeof RADAR_STAT_KEYS)[number];

export const RADAR_STAT_META: Record<RadarStatKey, { label: string; short: string }> = {
  attack: { label: 'Attack', short: 'ATT' },
  technique: { label: 'Technique', short: 'TEC' },
  stamina: { label: 'Stamina', short: 'STA' },
  defense: { label: 'Defense', short: 'DEF' },
  speed: { label: 'Speed', short: 'SPD' },
  physics: { label: 'Physics', short: 'PHY' },
};

export interface PlayerRating {
  id: string;
  playerId: string;
  managerId: string;
  managerName: string;
  skill: number; // Synced with overall for backward compatibility
  overall?: number;
  attack?: number;
  technique?: number;
  stamina: number;
  defense?: number;
  speed?: number;
  physics?: number;
  assessedPositions: string[];
  notes: string;
  updatedAt?: unknown;
}

export interface AggregatedPlayerRating {
  playerId: string;
  avgOverall: number;
  avgSkill: number;
  avgAttack: number;
  avgTechnique: number;
  avgStamina: number;
  avgDefense: number;
  avgSpeed: number;
  avgPhysics: number;
  ratingCount: number;
  consensusPositions: string[];
}

export type SkillArrowThresholds = [number, number, number, number];

export const DEFAULT_SKILL_ARROW_THRESHOLDS: SkillArrowThresholds = [25, 40, 60, 75];

export function normalizeSkillArrowThresholds(
  input?: number[] | null
): SkillArrowThresholds {
  if (
    Array.isArray(input) &&
    input.length === 4 &&
    input.every((n) => typeof n === 'number' && Number.isFinite(n))
  ) {
    const [t0, t1, t2, t3] = input.map((n) => Math.round(n));
    if (t0 >= 1 && t0 < t1 && t1 < t2 && t2 < t3 && t3 <= 99) {
      return [t0, t1, t2, t3];
    }
  }
  return [...DEFAULT_SKILL_ARROW_THRESHOLDS] as SkillArrowThresholds;
}

export interface ClubSettings {
  pollOpenDay: number; // 0 = Sun .. 6 = Sat (default 1 = Mon)
  pollOpenTime: string; // "12:00"
  pollLockDay: number; // default 3 = Wed
  pollLockTime: string; // "18:00"
  matchDay: number; // default 4 = Thu
  matchTime: string; // "20:00"
  matchLocation: string;
  defaultTeamColors: string[];
  maxPlayers?: number; // Player cap before low-chance waiting list (default 22)
  skillArrowThresholds?: SkillArrowThresholds; // 4 ascending cutoffs for 5 skill arrows
  updatedBy: string;
  updatedAt?: unknown;
}

export interface FormationPlayerSlot {
  uid: string;
  name: string;
  age: number;
  avgOverall?: number;
  avgSkill: number;
  avgAttack?: number;
  avgTechnique?: number;
  avgStamina: number;
  avgDefense?: number;
  avgSpeed?: number;
  avgPhysics?: number;
  goalieOption: GoalieOption;
  assignedPosition: string;
  pitchX: number;
  pitchY: number;
  rationale: string;
}

export interface FormationTeam {
  teamIndex: number;
  teamName: string;
  color: string;
  formationShape: string;
  players: FormationPlayerSlot[];
}

export interface TeamFormation {
  generatedAtIso: string;
  summary: string;
  teams: FormationTeam[];
}

export interface FinalizedPlayerTeamEntry {
  uid: string;
  name: string;
  teamIndex: number;
  teamColor: string;
  assignedPosition: string;
}

export interface ClubPayment {
  id: string; // `${uid}_${monthKey}`
  uid: string;
  monthKey: string; // "YYYY-MM"
  paid: boolean;
  amount: number;
  recordedBy: string;
  source?: 'manual' | 'gmail';
  gmailMessageId?: string;
  receiptDateIso?: string;
  updatedAt?: unknown;
}

export interface PaymentSenderAlias {
  id: string;
  senderKey: string;
  senderLabel: string;
  uid: string;
  updatedBy: string;
  updatedAt?: unknown;
}

export interface PostMatchGoalEvent {
  id: string;
  scorerUid: string;
  scorerName: string;
  teamIndex: number;
  teamColor: string;
}

export interface PostMatchGame {
  id: string;
  homeTeamIndex: number;
  homeTeamColor: string;
  awayTeamIndex: number;
  awayTeamColor: string;
  homeScore: number;
  awayScore: number;
  goals: PostMatchGoalEvent[];
}

export interface PostGameStats {
  games?: PostMatchGame[];
  absentUids: string[];
  lateUids: string[];
  playerMatchRatings?: Record<string, number>;
  bestPlayerUid?: string;
  topScorerUid?: string;
  notes?: string;
  updatedBy?: string;
  updatedAt?: unknown;
}

export interface DropInMatch {
  id: string;
  title: string;
  weekKey: string;
  location: string;
  kickoffIso: string;
  pollOpensAtIso: string;
  pollLocksAtIso: string;
  status: MatchStatus;
  teamCount: 2 | 3 | 4;
  teamColors: string[];
  aiOriginalFormation?: TeamFormation | null;
  currentFormation?: TeamFormation | null;
  finalizedPlayerTeams?: FinalizedPlayerTeamEntry[] | null;
  formationAttendingUids?: string[] | null;
  postGameStats?: PostGameStats | null;
  createdBy: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface MatchVote {
  uid: string;
  matchId: string;
  attending: boolean;
  goalieOption: GoalieOption;
  playerName: string;
  joinedAt?: unknown;
  updatedAt?: unknown;
}

export interface ClubNotification {
  id: string;
  recipientUid: string;
  matchId: string;
  matchTitle: string;
  type: 'waitlist_promoted';
  message: string;
  read: boolean;
  createdBy: string;
  createdAt?: unknown;
}

export interface EducationPost {
  id: string;
  title: string;
  category: 'Tactics' | 'Positioning' | 'Conditioning' | 'Rules & Fair Play';
  targetPositions: string[];
  summary: string;
  content: string;
  authorId: string;
  authorName: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export type RibbonItemType = 'business' | 'news' | 'announcement';
export type RibbonMode = 'moving' | 'static';
export type RibbonSpeed = 'slow' | 'normal' | 'brisk' | 'fast';
export type RibbonWidth = 'full' | 'wide' | 'compact';
export type RibbonHeight = 'slim' | 'standard' | 'tall';
export type RibbonDirection = 'left' | 'right';

export interface RibbonLuxuryPreset {
  id: string;
  name: string;
  bgColor: string;
  accentColor: string;
  textColor: string;
  borderAccent: boolean;
}

export const RIBBON_LUXURY_PRESETS: RibbonLuxuryPreset[] = [
  {
    id: 'obsidian_pitch',
    name: 'Obsidian Pitch',
    bgColor: '#0F172A',
    accentColor: '#10B981',
    textColor: '#F8FAFC',
    borderAccent: false,
  },
  {
    id: 'imperial_crimson',
    name: 'Imperial Crimson & Gold',
    bgColor: '#450A0A',
    accentColor: '#F59E0B',
    textColor: '#FEF2F2',
    borderAccent: true,
  },
  {
    id: 'royal_champagne',
    name: 'Royal Navy & Champagne',
    bgColor: '#0B1D3A',
    accentColor: '#E5C17B',
    textColor: '#F8FAFC',
    borderAccent: true,
  },
  {
    id: 'emerald_velvet',
    name: 'Emerald Velvet & Gold',
    bgColor: '#062B22',
    accentColor: '#D4AF37',
    textColor: '#ECFDF5',
    borderAccent: true,
  },
  {
    id: 'midnight_bronze',
    name: 'Midnight Espresso & Bronze',
    bgColor: '#1C1410',
    accentColor: '#D99B52',
    textColor: '#FAF5F0',
    borderAccent: true,
  },
  {
    id: 'burgundy_royale',
    name: 'Burgundy Royale',
    bgColor: '#3B0A22',
    accentColor: '#F2C97D',
    textColor: '#FDF2F8',
    borderAccent: true,
  },
  {
    id: 'alabaster_pearl',
    name: 'Alabaster Pearl',
    bgColor: '#F8F6F1',
    accentColor: '#B45309',
    textColor: '#1C1917',
    borderAccent: true,
  },
  {
    id: 'graphite_platinum',
    name: 'Graphite Platinum',
    bgColor: '#18181B',
    accentColor: '#D4D4D8',
    textColor: '#FAFAFA',
    borderAccent: false,
  },
];

export interface RibbonItem {
  id: string;
  type: RibbonItemType;
  title: string;
  text: string;
  active: boolean;
  imageUrl?: string;
  linkedPlayerUid?: string;
  ownerName?: string;
  category?: string;
  phone?: string;
  website?: string;
  address?: string;
  startsAtIso?: string;
  expiresAtIso?: string;
}

export interface RibbonConfig {
  enabled: boolean;
  mode: RibbonMode;
  speed: RibbonSpeed;
  items: RibbonItem[];
  themePreset?: string;
  bgColor?: string;
  accentColor?: string;
  textColor?: string;
  width?: RibbonWidth;
  height?: RibbonHeight;
  direction?: RibbonDirection;
  autoRotateSeconds?: number;
  borderAccent?: boolean;
  showControls?: boolean;
  updatedBy: string;
  updatedAt?: unknown;
}

export const DEFAULT_RIBBON_CONFIG: RibbonConfig = {
  enabled: false,
  mode: 'moving',
  speed: 'normal',
  items: [],
  themePreset: 'obsidian_pitch',
  bgColor: '#0F172A',
  accentColor: '#10B981',
  textColor: '#F8FAFC',
  width: 'full',
  height: 'standard',
  direction: 'left',
  autoRotateSeconds: 8,
  borderAccent: false,
  showControls: true,
  updatedBy: 'system',
};

export function isValidHexColor(value: string | undefined): value is string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value.trim());
}

export function isRibbonItemLive(item: RibbonItem, nowMs: number = Date.now()): boolean {
  if (!item.active || !item.title.trim()) return false;
  if (item.startsAtIso) {
    const startMs = Date.parse(item.startsAtIso);
    if (!Number.isNaN(startMs) && nowMs < startMs) return false;
  }
  if (item.expiresAtIso) {
    const endMs = Date.parse(item.expiresAtIso);
    if (!Number.isNaN(endMs) && nowMs >= endMs) return false;
  }
  return true;
}

export function getRibbonItemScheduleStatus(
  item: RibbonItem,
  nowMs: number = Date.now()
): 'expired' | 'scheduled' | 'active' | 'hidden' {
  if (!item.active) return 'hidden';
  if (item.expiresAtIso) {
    const endMs = Date.parse(item.expiresAtIso);
    if (!Number.isNaN(endMs) && nowMs >= endMs) return 'expired';
  }
  if (item.startsAtIso) {
    const startMs = Date.parse(item.startsAtIso);
    if (!Number.isNaN(startMs) && nowMs < startMs) return 'scheduled';
  }
  return 'active';
}
