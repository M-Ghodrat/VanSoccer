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

export interface PlayerBusinessInfo {
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
  const trimmed = raw.trim().slice(0, 180);
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return parsed.toString().slice(0, 180);
      }
      return '';
    } catch {
      return '';
    }
  }
  if (/^[a-zA-Z0-9][a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(\/.*)?$/.test(trimmed)) {
    return `https://${trimmed}`.slice(0, 180);
  }
  return '';
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
  business?: PlayerBusinessInfo | null;
  createdAt?: unknown;
  updatedAt?: unknown;
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
export type RibbonSpeed = 'slow' | 'normal' | 'fast';

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
}

export interface RibbonConfig {
  enabled: boolean;
  mode: RibbonMode;
  speed: RibbonSpeed;
  items: RibbonItem[];
  updatedBy: string;
  updatedAt?: unknown;
}

export const DEFAULT_RIBBON_CONFIG: RibbonConfig = {
  enabled: false,
  mode: 'moving',
  speed: 'normal',
  items: [],
  updatedBy: 'system',
};
