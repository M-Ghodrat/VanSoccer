export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  try {
    const body = (await req.json().catch(() => ({}))) as { username?: unknown };
    const rawUsername = typeof body.username === 'string' ? body.username : '';
    const normalized = rawUsername
      .trim()
      .toLowerCase()
      .replace(/^@+/, '')
      .replace(/[^a-z0-9._-]/g, '');

    if (normalized.length < 3 || normalized.length > 30) {
      return Response.json(
        { error: 'Please enter a valid username (3–30 characters).' },
        { status: 400 }
      );
    }

    const projectId =
      process.env.FIREBASE_PROJECT_ID || 'ai-studio-1910f007-6af5-4d25-bfd7-8fb424f269d7';
    const databaseId =
      process.env.FIREBASE_DATABASE_ID || 'ai-studio-1910f007-6af5-4d25-bfd7-8fb424f269d7';

    const docUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
      projectId
    )}/databases/${encodeURIComponent(databaseId)}/documents/usernames/${encodeURIComponent(
      normalized
    )}`;

    const docResp = await fetch(docUrl);
    if (docResp.status === 404) {
      return Response.json(
        { error: 'Username not found. Please check your username or sign in with your email address.' },
        { status: 404 }
      );
    }
    if (!docResp.ok) {
      return Response.json(
        { error: 'Could not look up username right now.' },
        { status: 502 }
      );
    }

    const docJson = (await docResp.json()) as {
      fields?: {
        email?: { stringValue?: string };
      };
    };
    const email = docJson.fields?.email?.stringValue?.trim() || '';
    if (!email) {
      return Response.json({ error: 'Username not found.' }, { status: 404 });
    }

    return Response.json({ email }, { status: 200 });
  } catch (error) {
    console.error('Username lookup failed:', error);
    return Response.json({ error: 'Failed to look up username.' }, { status: 500 });
  }
}
