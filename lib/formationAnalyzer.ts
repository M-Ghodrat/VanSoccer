import { GoogleGenAI, Type } from '@google/genai';

export interface AnalyzePlayerInput {
  uid: string;
  name: string;
  age: number;
  goalieOption: 'none' | 'willing' | 'only_goalie';
  favoritePositions: string[];
  avgSkill: number;
  avgStamina: number;
  assessedPositions: string[];
  pastTeammateCounts: Record<string, number>;
}

export interface AnalyzeRequestBody {
  matchTitle: string;
  teamCount: 2 | 3 | 4;
  teamColors: string[];
  players: AnalyzePlayerInput[];
}

export class ApiHttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const POSITION_DEFAULT_COORDS: Record<string, { x: number; y: number }> = {
  GK: { x: 50, y: 88 },
  LB: { x: 18, y: 70 },
  CB: { x: 50, y: 72 },
  RB: { x: 82, y: 70 },
  CDM: { x: 50, y: 56 },
  LM: { x: 16, y: 46 },
  CM: { x: 50, y: 45 },
  RM: { x: 84, y: 46 },
  CAM: { x: 50, y: 33 },
  LW: { x: 20, y: 22 },
  RW: { x: 80, y: 22 },
  ST: { x: 50, y: 15 },
};

const VALID_GOALIE_OPTIONS = new Set(['none', 'willing', 'only_goalie']);

function sanitizeIncomingRequest(rawBody: unknown): AnalyzeRequestBody {
  if (!rawBody || typeof rawBody !== 'object') {
    throw new ApiHttpError(400, 'Invalid request payload.');
  }

  const body = rawBody as Partial<AnalyzeRequestBody>;
  if (!Array.isArray(body.players) || body.players.length < 2) {
    throw new ApiHttpError(400, 'At least 2 attending players are required for formation analysis.');
  }

  if (body.players.length > 60) {
    throw new ApiHttpError(400, 'Too many players in a single formation request (max 60).');
  }

  const requestedCount = Number(body.teamCount);
  const teamCount: 2 | 3 | 4 =
    requestedCount === 2 || requestedCount === 3 || requestedCount === 4
      ? requestedCount
      : body.players.length >= 28
        ? 4
        : 2;

  if (body.players.length < teamCount) {
    throw new ApiHttpError(
      400,
      `At least ${teamCount} attending players are required to form ${teamCount} teams.`
    );
  }

  const defaultColors = ['Red', 'Blue', 'Black', 'Yellow'];
  const teamColors = Array.from({ length: teamCount }, (_, i) => {
    const raw = Array.isArray(body.teamColors) ? body.teamColors[i] : undefined;
    return typeof raw === 'string' && raw.trim()
      ? raw.trim().slice(0, 30)
      : defaultColors[i];
  });

  const matchTitle =
    typeof body.matchTitle === 'string' && body.matchTitle.trim()
      ? body.matchTitle.trim().slice(0, 120)
      : 'Weekly Drop-In Match';

  const players: AnalyzePlayerInput[] = body.players.map((raw, idx) => {
    const p = (raw || {}) as Partial<AnalyzePlayerInput>;
    const uid =
      typeof p.uid === 'string' && p.uid.trim()
        ? p.uid.trim().slice(0, 128)
        : `player_${idx}`;
    const name =
      typeof p.name === 'string' && p.name.trim()
        ? p.name.trim().slice(0, 100)
        : `Player ${idx + 1}`;
    const age = Number.isFinite(Number(p.age))
      ? Math.max(12, Math.min(99, Math.round(Number(p.age))))
      : 28;
    const goalieOption: 'none' | 'willing' | 'only_goalie' =
      typeof p.goalieOption === 'string' && VALID_GOALIE_OPTIONS.has(p.goalieOption)
        ? (p.goalieOption as 'none' | 'willing' | 'only_goalie')
        : 'none';
    const favoritePositions = Array.isArray(p.favoritePositions)
      ? p.favoritePositions
          .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
          .slice(0, 3)
          .map((v) => v.trim().slice(0, 16))
      : ['CM'];
    const assessedPositions = Array.isArray(p.assessedPositions)
      ? p.assessedPositions
          .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
          .slice(0, 3)
          .map((v) => v.trim().slice(0, 16))
      : [];
    const avgSkill = Number.isFinite(Number(p.avgSkill))
      ? Math.max(0, Math.min(100, Number(p.avgSkill)))
      : 50;
    const avgStamina = Number.isFinite(Number(p.avgStamina))
      ? Math.max(0, Math.min(100, Number(p.avgStamina)))
      : 50;

    const pastTeammateCounts: Record<string, number> = {};
    if (p.pastTeammateCounts && typeof p.pastTeammateCounts === 'object') {
      const entries = Object.entries(p.pastTeammateCounts).slice(0, 60);
      for (const [k, v] of entries) {
        const num = Number(v);
        if (typeof k === 'string' && k.length <= 128 && Number.isFinite(num) && num > 0) {
          pastTeammateCounts[k] = Math.min(999, Math.round(num));
        }
      }
    }

    return {
      uid,
      name,
      age,
      goalieOption,
      favoritePositions: favoritePositions.length > 0 ? favoritePositions : ['CM'],
      avgSkill,
      avgStamina,
      assessedPositions,
      pastTeammateCounts,
    };
  });

  return {
    matchTitle,
    teamCount,
    teamColors,
    players,
  };
}

function sanitizeFormationOutput(
  raw: {
    summary?: string;
    teams?: {
      teamIndex: number;
      teamName: string;
      color: string;
      formationShape: string;
      players: {
        uid: string;
        assignedPosition: string;
        pitchX: number;
        pitchY: number;
        rationale: string;
      }[];
    }[];
  },
  body: AnalyzeRequestBody
) {
  const playerMap = new Map(body.players.map((p) => [p.uid, p]));
  const assignedUids = new Set<string>();
  const teamCount = body.teamCount;
  const rawTeams = Array.isArray(raw.teams) ? raw.teams : [];

  const teams = Array.from({ length: teamCount }, (_, idx) => {
    const aiTeam = rawTeams.find((t) => t.teamIndex === idx) || rawTeams[idx];
    const color = body.teamColors[idx] || ['Red', 'Blue', 'Black', 'Yellow'][idx];
    const players: {
      uid: string;
      name: string;
      age: number;
      avgSkill: number;
      avgStamina: number;
      goalieOption: 'none' | 'willing' | 'only_goalie';
      assignedPosition: string;
      pitchX: number;
      pitchY: number;
      rationale: string;
    }[] = [];

    if (aiTeam?.players) {
      for (const slot of aiTeam.players) {
        if (assignedUids.has(slot.uid)) continue;
        const p = playerMap.get(slot.uid);
        if (!p) continue;
        assignedUids.add(slot.uid);
        const pos =
          slot.assignedPosition || p.assessedPositions[0] || p.favoritePositions[0] || 'CM';
        const fallbackCoord = POSITION_DEFAULT_COORDS[pos] || { x: 50, y: 45 };
        const pitchX = Math.max(
          10,
          Math.min(90, Number.isFinite(slot.pitchX) ? slot.pitchX : fallbackCoord.x)
        );
        const pitchY = Math.max(
          10,
          Math.min(90, Number.isFinite(slot.pitchY) ? slot.pitchY : fallbackCoord.y)
        );
        players.push({
          uid: p.uid,
          name: p.name,
          age: p.age,
          avgSkill: p.avgSkill,
          avgStamina: p.avgStamina,
          goalieOption: p.goalieOption,
          assignedPosition: pos,
          pitchX,
          pitchY,
          rationale: slot.rationale || 'Balanced role fit',
        });
      }
    }

    return {
      teamIndex: idx,
      teamName: aiTeam?.teamName || `Team ${color}`,
      color,
      formationShape: aiTeam?.formationShape || 'Balanced',
      players,
    };
  });

  // Ensure zero missing players if model omitted anyone
  const missingPlayers = body.players.filter((p) => !assignedUids.has(p.uid));
  for (const p of missingPlayers) {
    teams.sort((a, b) => a.players.length - b.players.length);
    const targetTeam = teams[0];
    const pos =
      p.goalieOption === 'only_goalie'
        ? 'GK'
        : p.assessedPositions[0] || p.favoritePositions[0] || 'CM';
    const coord = POSITION_DEFAULT_COORDS[pos] || { x: 50, y: 48 };
    targetTeam.players.push({
      uid: p.uid,
      name: p.name,
      age: p.age,
      avgSkill: p.avgSkill,
      avgStamina: p.avgStamina,
      goalieOption: p.goalieOption,
      assignedPosition: pos,
      pitchX: coord.x,
      pitchY: coord.y,
      rationale: 'Auto-balanced into shortest squad',
    });
  }

  teams.sort((a, b) => a.teamIndex - b.teamIndex);

  return {
    generatedAtIso: new Date().toISOString(),
    summary:
      raw.summary ||
      'Teams balanced across skill, stamina, age distribution, goalkeeper availability, and fresh teammate pairings.',
    teams,
  };
}

export async function analyzeFormationRequest(rawBody: unknown) {
  if (process.env.ENABLE_AI_FORMATIONS !== 'true') {
    throw new ApiHttpError(503, 'AI formations are disabled. Use the manual team builder.');
  }
  const body = sanitizeIncomingRequest(rawBody);
  const playerAliases = new Map(body.players.map((player, index) => [player.uid, `player_${index + 1}`]));
  if (playerAliases.size !== body.players.length) throw new ApiHttpError(400, 'Duplicate players.');
  const originalIds = new Map([...playerAliases].map(([uid, alias]) => [alias, uid]));
  const positions = (values: string[]) => values.filter((value) => Object.hasOwn(POSITION_DEFAULT_COORDS, value));
  const lineupInputs = body.players.map((player) => ({
    uid: playerAliases.get(player.uid),
    goalieOption: player.goalieOption,
    favoritePositions: positions(player.favoritePositions),
    assessedPositions: positions(player.assessedPositions),
    avgSkill: player.avgSkill,
    avgStamina: player.avgStamina,
    pastTeammateCounts: Object.fromEntries([...playerAliases].flatMap(([uid, alias]) =>
      player.pastTeammateCounts[uid] > 0 ? [[alias, player.pastTeammateCounts[uid]]] : []
    )),
  }));

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new ApiHttpError(500, 'GEMINI_API_KEY is not configured in server environment.');
  }

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });

  const prompt = `You are a head tactician for a Vancouver drop-in soccer club.
Analyze the ${body.players.length} attending players and split them into exactly ${body.teamCount} balanced teams.

HARD CONSTRAINTS & GOALS:
1. Every single player UID in the input list MUST appear in exactly one team. Do not omit or duplicate any player.
2. Team sizes must be as equal as possible (differ by at most 1 player).
3. Goalkeepers:
   - Players with goalieOption === "only_goalie" MUST be assigned position "GK" (pitchX: 50, pitchY: 88). Distribute them across separate teams.
   - If a team does not have an "only_goalie" player, assign a player with goalieOption === "willing" to "GK" (pitchX: 50, pitchY: 88).
   - Players with goalieOption === "none" should NOT be placed in GK unless no willing/only_goalie players exist at all.
4. Balance across teams:
   - Equalize average skill (0-100 scale) and average stamina (0-100 scale) across all ${body.teamCount} teams.
   - Match players to their manager-assessed positions first, then their favorite positions.
   - Promote fresh chemistry: look at each player's "pastTeammateCounts" map and try to group players who have low shared match counts (0 or low numbers) together rather than keeping the exact same cliques every week.
5. Pitch Coordinates (for each team's 2D tactical field view):
   - pitchX: 12 (left touchline) to 88 (right touchline). Spread wingers/fullbacks wide and center-backs/strikers central so player markers NEVER overlap!
   - pitchY: 88 (own goal line / GK) up to 14 (attacking striker). Defenders ~66-74, defensive mids ~54-58, central/wide mids ~40-48, attacking mids ~30-35, wingers/strikers ~14-24.
   - Use standard position codes: GK, LB, CB, RB, CDM, LM, CM, RM, CAM, LW, RW, ST.

ATTENDING PLAYERS DATA:
${JSON.stringify(lineupInputs)}`;

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: prompt,
    config: {
      systemInstruction:
        'You are an expert football squad builder. Return strictly valid JSON matching the schema. Balance skill, stamina, age, goalkeeper coverage, positional fit, and teammate novelty while preventing overlapping pitch coordinates.',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          summary: {
            type: Type.STRING,
            description:
              'Concise 2-3 sentence tactical overview explaining how teams were balanced across skill, stamina, age, goalies, and fresh pairings.',
          },
          teams: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                teamIndex: { type: Type.INTEGER },
                teamName: { type: Type.STRING },
                color: { type: Type.STRING },
                formationShape: {
                  type: Type.STRING,
                  description: 'Formation label e.g. 1-4-3-3 or 1-2-3-1',
                },
                players: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      uid: { type: Type.STRING },
                      assignedPosition: { type: Type.STRING },
                      pitchX: { type: Type.NUMBER },
                      pitchY: { type: Type.NUMBER },
                      rationale: { type: Type.STRING },
                    },
                    required: ['uid', 'assignedPosition', 'pitchX', 'pitchY', 'rationale'],
                  },
                },
              },
              required: ['teamIndex', 'teamName', 'color', 'formationShape', 'players'],
            },
          },
        },
        required: ['summary', 'teams'],
      },
    },
  });

  const rawText = (response.text ?? '{}').trim();
  const parsed = JSON.parse(rawText) as Parameters<typeof sanitizeFormationOutput>[0];
  for (const team of parsed.teams ?? []) {
    for (const player of team.players ?? []) player.uid = originalIds.get(player.uid) ?? '';
  }
  return sanitizeFormationOutput(parsed, body);
}
