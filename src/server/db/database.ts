// SQLite through node:sqlite. One file on the PVC; ":memory:" in tests.
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { token } from "../di/container.ts";

export interface IDatabase {
    readonly raw: DatabaseSync;
    /** Runs fn inside BEGIN/COMMIT; rolls back on throw. */
    transaction<T>(fn: () => T): T;
    close(): void;
}

export const DatabaseDIToken = token<IDatabase>("Database");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  fields TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  level TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS facets (
  id TEXT PRIMARY KEY,
  note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  facet TEXT NOT NULL,
  card TEXT NOT NULL,
  state INTEGER NOT NULL,
  due INTEGER NOT NULL,
  suspended INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  UNIQUE (note_id, facet)
);
CREATE INDEX IF NOT EXISTS facets_due ON facets (suspended, state, due);
CREATE TABLE IF NOT EXISTS presentations (
  id TEXT PRIMARY KEY,
  facet_id TEXT NOT NULL REFERENCES facets(id) ON DELETE CASCADE,
  html TEXT NOT NULL,
  audio TEXT,
  meta TEXT NOT NULL DEFAULT '{}',
  shown INTEGER NOT NULL DEFAULT 0,
  last_shown INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS presentations_facet ON presentations (facet_id, shown);
CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY,
  facet_id TEXT NOT NULL,
  rating INTEGER NOT NULL,
  ts INTEGER NOT NULL,
  state_before INTEGER NOT NULL,
  due_before INTEGER,
  log TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS reviews_ts ON reviews (ts);
CREATE INDEX IF NOT EXISTS reviews_facet ON reviews (facet_id, ts);
CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  stream TEXT NOT NULL,
  kind TEXT,
  html TEXT NOT NULL,
  audio TEXT,
  meta TEXT NOT NULL DEFAULT '{}',
  tags TEXT NOT NULL DEFAULT '[]',
  expires_at INTEGER,
  repeat_after INTEGER,
  shown INTEGER NOT NULL DEFAULT 0,
  last_shown INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS items_stream ON items (stream, expires_at, shown);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY,
  card_id TEXT NOT NULL,
  stream TEXT NOT NULL,
  type TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS events_ts ON events (ts);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user TEXT NOT NULL, expires_at INTEGER NOT NULL);
`;

export class SqliteDatabase implements IDatabase {
    public readonly raw: DatabaseSync;

    public constructor(path: string) {
        if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
        this.raw = new DatabaseSync(path);
        this.raw.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
        this.raw.exec(SCHEMA);
    }

    public transaction<T>(fn: () => T): T {
        this.raw.exec("BEGIN");
        try {
            const result = fn();
            this.raw.exec("COMMIT");
            return result;
        } catch (e) {
            this.raw.exec("ROLLBACK");
            throw e;
        }
    }

    public close(): void {
        this.raw.close();
    }
}

export const toJson = (v: unknown): string => JSON.stringify(v ?? null);

export function fromJson<T>(s: unknown, fallback: T): T {
    if (typeof s !== "string") return fallback;
    try {
        return JSON.parse(s) as T;
    } catch {
        return fallback;
    }
}

let counter = 0;
/** Short unique id: prefix + random + time + per-process counter (ids within one ms stay distinct). */
export function newId(prefix: string): string {
    counter = (counter + 1) % 1296;
    return (
        prefix +
        Math.random().toString(36).slice(2, 9) +
        Date.now().toString(36).slice(-4) +
        counter.toString(36).padStart(2, "0")
    );
}
