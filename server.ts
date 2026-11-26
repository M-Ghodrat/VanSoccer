import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenAI, Type } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;

interface AnalyzePlayerInput {
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

interface AnalyzeRequestBody {
  matchTitle: string;
  teamCount: 2 | 3 | 4;
  teamColors: string[];
  players: AnalyzePlayerInput[];
}

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

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

function sanitizeFormationOutput(
  raw: {
    summary: string;
    teams: {
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

  const teams = Array.from({ length: teamCount }, (_, idx) => {
    const aiTeam = raw.teams.find((t) => t.teamIndex === idx) || raw.teams[idx];
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
        const pos = slot.assignedPosition || p.assessedPositions[0] || p.favoritePositions[0] || 'CM';
        const fallbackCoord = POSITION_DEFAULT_COORDS[pos] || { x: 50, y: 45 };
        const pitchX = Math.max(10, Math.min(90, Number.isFinite(slot.pitchX) ? slot.pitchX : fallbackCoord.x));
        const pitchY = Math.max(10, Math.min(90, Number.isFinite(slot.pitchY) ? slot.pitchY : fallbackCoord.y));
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
    summary: raw.summary || 'Teams balanced across skill, stamina, age distribution, goalkeeper availability, and fresh teammate pairings.',
    teams,
  };
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: 'vancity-pitch' });
  });

  app.post('/api/formation/analyze', async (req, res) => {
    try {
      const body = req.body as AnalyzeRequestBody;
      if (!body || !Array.isArray(body.players) || body.players.length < 2) {
        res.status(400).json({ error: 'At least 2 attending players are required for formation analysis.' });
        return;
      }

      if (!process.env.GEMINI_API_KEY) {
        res.status(500).json({ error: 'GEMINI_API_KEY is not configured in server environment.' });
        return;
      }

      const requestedCount = Number(body.teamCount);
      const teamCount: 2 | 3 | 4 =
        requestedCount === 2 || requestedCount === 3 || requestedCount === 4
          ? requestedCount
          : body.players.length >= 28
            ? 4
            : 2;
      if (body.players.length < teamCount) {
        res.status(400).json({ error: `At least ${teamCount} attending players are required to form ${teamCount} teams.` });
        return;
      }
      const teamColors = (body.teamColors || ['Red', 'Blue', 'Black', 'Yellow']).slice(0, teamCount);

      const prompt = `You are a head tactician for a Vancouver drop-in soccer club.
Analyze the ${body.players.length} attending players for "${body.matchTitle}" and split them into exactly ${teamCount} balanced teams (${teamColors.join(', ')}).

HARD CONSTRAINTS & GOALS:
1. Every single player UID in the input list MUST appear in exactly one team. Do not omit or duplicate any player.
2. Team sizes must be as equal as possible (differ by at most 1 player).
3. Goalkeepers:
   - Players with goalieOption === "only_goalie" MUST be assigned position "GK" (pitchX: 50, pitchY: 88). Distribute them across separate teams.
   - If a team does not have an "only_goalie" player, assign a player with goalieOption === "willing" to "GK" (pitchX: 50, pitchY: 88).
   - Players with goalieOption === "none" should NOT be placed in GK unless no willing/only_goalie players exist at all.
4. Balance across teams:
   - Equalize average skill (0-100 scale), average stamina (0-100 scale), and average age across all ${teamCount} teams.
   - Match players to their manager-assessed positions first, then their favorite positions.
   - Promote fresh chemistry: look at each player's "pastTeammateCounts" map and try to group players who have low shared match counts (0 or low numbers) together rather than keeping the exact same cliques every week.
5. Pitch Coordinates (for each team's 2D tactical field view):
   - pitchX: 12 (left touchline) to 88 (right touchline). Spread wingers/fullbacks wide and center-backs/strikers central so player markers NEVER overlap!
   - pitchY: 88 (own goal line / GK) up to 14 (attacking striker). Defenders ~66-74, defensive mids ~54-58, central/wide mids ~40-48, attacking mids ~30-35, wingers/strikers ~14-24.
   - Use standard position codes: GK, LB, CB, RB, CDM, LM, CM, RM, CAM, LW, RW, ST.

ATTENDING PLAYERS DATA:
${JSON.stringify(body.players, null, 2)}`;

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
                description: 'Concise 2-3 sentence tactical overview explaining how teams were balanced across skill, stamina, age, goalies, and fresh pairings.',
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
      const parsed = JSON.parse(rawText);
      const formation = sanitizeFormationOutput(parsed, {
        ...body,
        teamCount,
        teamColors,
      });

      res.json(formation);
    } catch (error) {
      console.error('Formation analysis failed:', error);
      const message = error instanceof Error ? error.message : 'Failed to generate AI formation.';
      res.status(500).json({ error: message });
    }
  });

  // Serve local MediaPipe Vision WASM assets for fast, offline-safe portrait background removal
  const mediapipeWasmPath = path.resolve(
    __dirname,
    'node_modules',
    '@mediapipe',
    'tasks-vision',
    'wasm'
  );
  app.use('/mediapipe/wasm', express.static(mediapipeWasmPath, { maxAge: '7d' }));

  // Same-origin cached proxy for MediaPipe selfie multiclass model (segments background, hair, skin, face, clothes, accessories)
  let cachedMulticlassModel: Buffer | null = null;
  app.get('/api/mediapipe-model/selfie-multiclass', async (_req, res) => {
    try {
      if (!cachedMulticlassModel) {
        const modelResp = await fetch(
          'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite'
        );
        if (!modelResp.ok) {
          throw new Error(`Multiclass model download failed (${modelResp.status})`);
        }
        cachedMulticlassModel = Buffer.from(await modelResp.arrayBuffer());
      }
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.send(cachedMulticlassModel);
    } catch (err) {
      console.error('Failed to serve MediaPipe multiclass segmenter model:', err);
      res.status(502).json({ error: 'Could not load head-and-neck segmentation model.' });
    }
  });

  // Same-origin cached proxy for fallback MediaPipe selfie segmentation model
  let cachedSelfieModel: Buffer | null = null;
  app.get('/api/mediapipe-model/selfie-segmenter', async (_req, res) => {
    try {
      if (!cachedSelfieModel) {
        const modelResp = await fetch(
          'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite'
        );
        if (!modelResp.ok) {
          throw new Error(`Model download failed (${modelResp.status})`);
        }
        cachedSelfieModel = Buffer.from(await modelResp.arrayBuffer());
      }
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.send(cachedSelfieModel);
    } catch (err) {
      console.error('Failed to serve MediaPipe selfie segmenter model:', err);
      res.status(502).json({ error: 'Could not load background removal model.' });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Vancity Pitch server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
