export default async function handler(): Promise<Response> {
  return Response.json({ status: 'ok', service: 'perspolis-vancouver' }, { status: 200 });
}
