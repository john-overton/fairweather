import { NextResponse } from 'next/server';

import { jsonError } from '@/lib/http';
import { vapidPublicKey } from '@/lib/push';

export const dynamic = 'force-dynamic';

export function GET() {
  const key = vapidPublicKey();
  if (!key) return jsonError(503, 'Notifications are not set up on this server yet.');
  return NextResponse.json({ key });
}
