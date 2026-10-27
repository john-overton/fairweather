/* Client side of Fairweather push. State lives in localStorage['wx.push']; the browser is the source of truth. */
import type { PushPrefs, SavedLocation } from '@/lib/types';

import { BASE, api } from './base';
import { store } from './store';

export interface PushState {
  on: boolean;
  endpoint?: string;
  auth?: string;
  prefs: PushPrefs;
}

export const DEFAULT_PREFS: PushPrefs = { alertMin: 'watch', rainSoon: true, briefTime: null, quietStart: '22:00', quietEnd: '06:00' };

export const loadPushState = (): PushState => {
  const s = store.get<Partial<PushState>>('wx.push', {});
  return { on: !!s.on, endpoint: s.endpoint, auth: s.auth, prefs: { ...DEFAULT_PREFS, ...s.prefs } };
};
export const savePushState = (s: PushState) => store.set('wx.push', s);

export type PushSupport = 'ok' | 'ios-install' | 'unsupported';

export function pushSupport(): PushSupport {
  if (typeof window === 'undefined') return 'unsupported';
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
  if (ios && !standalone) return 'ios-install';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
  return 'ok';
}

const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const locPayload = (locs: SavedLocation[]) => locs.map((l, i) => ({ ...l, primary: i === 0 }));

function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function pushApi(path: string, method: string, body: unknown, auth?: string) {
  const res = await fetch(api(`push/${path}`), {
    method,
    headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) },
    body: JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((j as { error?: string }).error || `Request failed (${res.status})`);
  return j;
}

async function subscribeAndRegister(locations: SavedLocation[], prefs: PushPrefs): Promise<PushState> {
  const reg = await navigator.serviceWorker.ready;
  const keyRes = await fetch(api('push/vapid-key'));
  const { key, error } = await keyRes.json();
  if (!keyRes.ok) throw new Error(error || 'Notifications are not set up on this server yet.');
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) });
  const json = sub.toJSON();
  await pushApi('subscribe', 'POST', { subscription: json, locations: locPayload(locations), prefs, tz: tz() });
  return { on: true, endpoint: json.endpoint, auth: json.keys?.auth, prefs };
}

/** Called only from the toggle tap, never on load. */
export async function enablePush(locations: SavedLocation[], prefs: PushPrefs): Promise<PushState> {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Notifications are blocked for this site. Allow them in your browser settings, then try again.');
  const s = await subscribeAndRegister(locations, prefs);
  savePushState(s);
  return s;
}

export async function disablePush(state: PushState): Promise<PushState> {
  try {
    if (state.endpoint && state.auth) await pushApi('subscribe', 'DELETE', { endpoint: state.endpoint }, state.auth);
    const reg = await navigator.serviceWorker.getRegistration(BASE);
    await (await reg?.pushManager.getSubscription())?.unsubscribe();
  } catch { /* server copy is cleaned up by the sweep */ }
  const s = { on: false, prefs: state.prefs };
  savePushState(s);
  return s;
}

export async function syncPush(state: PushState, locations: SavedLocation[]) {
  if (!state.on || !state.endpoint || !state.auth) return;
  await pushApi('prefs', 'PUT', { endpoint: state.endpoint, locations: locPayload(locations), prefs: state.prefs, tz: tz() }, state.auth);
}

export async function sendTestPush(state: PushState) {
  if (!state.endpoint || !state.auth) throw new Error('Turn notifications on first.');
  await pushApi('test', 'POST', { endpoint: state.endpoint }, state.auth);
}

/**
 * On app open: heartbeat, or resubscribe silently if the browser's subscription is gone
 * but storage says on and permission is still granted.
 */
export async function pushOnLoad(locations: SavedLocation[]): Promise<PushState | null> {
  const state = loadPushState();
  if (!state.on || pushSupport() !== 'ok' || Notification.permission !== 'granted') return null;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  const json = sub?.toJSON();
  try {
    if (!json?.endpoint) {
      const s = await subscribeAndRegister(locations, state.prefs);
      savePushState(s);
      return s;
    }
    if (json.endpoint !== state.endpoint && state.endpoint && state.auth) {
      await pushApi('heartbeat', 'POST', { oldEndpoint: state.endpoint, subscription: json }, state.auth);
      const s = { ...state, endpoint: json.endpoint, auth: json.keys?.auth };
      savePushState(s);
      return s;
    }
    await pushApi('heartbeat', 'POST', { endpoint: json.endpoint }, json.keys?.auth);
  } catch {
    // Server lost the row (e.g. cleaned up): register again
    const s = await subscribeAndRegister(locations, state.prefs).catch(() => null);
    if (s) savePushState(s);
    return s;
  }
  return state;
}
