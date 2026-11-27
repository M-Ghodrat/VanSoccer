import { requireFormationManager } from '../../lib/clubBackend';
import {
  analyzeFormationRequest,
  ApiHttpError,
} from '../../lib/formationAnalyzer';

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed.' }, { status: 405 });
  }

  try {
    await requireFormationManager(req.headers.get('authorization'));
    const body = await req.json();
    const formation = await analyzeFormationRequest(body);
    return Response.json(formation, { status: 200 });
  } catch (error) {
    if (error instanceof ApiHttpError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    console.error('Netlify formation analysis failed:', error);
    return Response.json({ error: 'Failed to generate AI formation.' }, { status: 500 });
  }
}
