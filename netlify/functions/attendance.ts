import { updateAttendance } from '../../lib/attendance';
import { ApiHttpError } from '../../lib/formationAnalyzer';

export default async function handler(request: Request) {
  if (request.method !== 'POST') return new Response(null, { status: 405 });
  try {
    const input = await request.json().catch(() => null);
    await updateAttendance(request.headers.get('authorization'), input);
    return new Response(null, { status: 204 });
  } catch (error) {
    if (error instanceof ApiHttpError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    console.error('Attendance update failed:', error);
    return Response.json({ error: 'Could not update attendance.' }, { status: 500 });
  }
}
