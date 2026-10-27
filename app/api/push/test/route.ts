import { NextResponse } from 'next/server';

import { jsonError, rateLimited } from '@/lib/http';
import { authorizedSub, sendPush } from '@/lib/push';

export const dynamic = 'force-dynamic';

/** Sends one test notification to the caller. Rate limited to 3 an hour. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { endpoint?: string } | null;
  const sub = authorizedSub(body?.endpoint, req.headers.get('authorization'));
  if (!sub) return jsonError(401, 'Unknown subscription. Turn notifications off and on again.');
  if (rateLimited(`test:${sub.id}`, 3, 3600_000)) return jsonError(429, 'Test limit reached (3 an hour). Try again later.');
  const status = await sendPush(sub, {
    title: 'Fairweather test',
    body: 'Notifications are working. Alerts, rain soon, and briefs will arrive like this.',
    url: '/fairweather#now',
    tag: 'test',
  }, { urgency: 'normal', ttl: 600 });
  if (status < 200 || status >= 300) return jsonError(502, `The push service answered ${status || 'with a network error'}. Try again shortly.`);
  return NextResponse.json({ ok: true });
}
