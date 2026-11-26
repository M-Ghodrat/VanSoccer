import {
  analyzeFormationRequest,
  ApiHttpError,
  verifyFirebaseBearerToken,
} from '../../lib/formationAnalyzer';

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed.' }, { status: 405 });
  }

  try {
    await verifyFirebaseBearerToken(req.headers.get('authorization'));
    const body = await req.json();
    const formation = await analyzeFormationRequest(body);
    return Response.json(formation, { status: 200 });
  } catch (error) {
    if (error instanceof ApiHttpError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    console.error('Netlify formation analysis failed:', error);
    const message =
      error instanceof Error ? error.message : 'Failed to generate AI formation.';
    return Response.json({ error: message }, { status: 500 });
  }
}
