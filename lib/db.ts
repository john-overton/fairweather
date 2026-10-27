/**
 * Fairweather's own SQLite database (push subscriptions, alert dedupe, delivery log).
 * Lives at data/fairweather.db by default.
 */
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const DB_PATH = process.env.FAIRWEATHER_DB_PATH || path.join(process.cwd(), 'data', 'fairweather.db');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS subscriptions (
  id              INTEGER PRIMARY KEY,
  endpoint        TEXT NOT NULL UNIQUE,
  p256dh          TEXT NOT NULL,
  auth            TEXT NOT NULL,
  tz              TEXT NOT NULL,
  user_agent      TEXT,
  created_at      TEXT NOT NULL,
  last_seen_at    TEXT NOT NULL,
  last_success_at TEXT,
  fail_count      INTEGER NOT NULL DEFAULT 0,
  first_fail_at   TEXT
);
CREATE TABLE IF NOT EXISTS sub_locations (
  id         INTEGER PRIMARY KEY,
  sub_id     INTEGER NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  client_id  TEXT NOT NULL,
  name       TEXT NOT NULL,
  lat        REAL NOT NULL,
  lon        REAL NOT NULL,
  is_primary INTEGER NOT NULL DEFAULT 0,
  zone_ids   TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sub_prefs (
  sub_id      INTEGER PRIMARY KEY REFERENCES subscriptions(id) ON DELETE CASCADE,
  alert_min   TEXT NOT NULL DEFAULT 'watch',
  rain_soon   INTEGER NOT NULL DEFAULT 1,
  brief_time  TEXT,
  quiet_start TEXT NOT NULL DEFAULT '22:00',
  quiet_end   TEXT NOT NULL DEFAULT '06:00'
);
CREATE TABLE IF NOT EXISTS alerts_seen (
  alert_id     TEXT PRIMARY KEY,
  zone_ids     TEXT NOT NULL,
  event        TEXT NOT NULL,
  severity     TEXT NOT NULL,
  sent_version TEXT NOT NULL,
  expires_at   TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS deliveries (
  id       INTEGER PRIMARY KEY,
  sub_id   INTEGER NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  kind     TEXT NOT NULL,
  ref      TEXT,
  sent_at  TEXT NOT NULL,
  status   INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS deliveries_once ON deliveries(sub_id, kind, ref);
CREATE INDEX IF NOT EXISTS sub_locations_sub ON sub_locations(sub_id);
CREATE INDEX IF NOT EXISTS deliveries_sent ON deliveries(sent_at);
`;

let db: Database.Database | null = null;

export function fwDb(): Database.Database {
  if (db) return db;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}

export interface SubRow {
  id: number;
  endpoint: string;
  p256dh: string;
  auth: string;
  tz: string;
  fail_count: number;
  first_fail_at: string | null;
}

export interface SubLocationRow {
  id: number;
  sub_id: number;
  client_id: string;
  name: string;
  lat: number;
  lon: number;
  is_primary: number;
  zone_ids: string;
}

export interface SubPrefsRow {
  sub_id: number;
  alert_min: string;
  rain_soon: number;
  brief_time: string | null;
  quiet_start: string;
  quiet_end: string;
}
