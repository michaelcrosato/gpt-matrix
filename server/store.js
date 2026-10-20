import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { defaults, now } from './domain.js';

export class Store {
  constructor(dir) {
    fs.mkdirSync(dir, { recursive: true });
    this.dir = dir;
    this.db = new DatabaseSync(path.join(dir, 'hub.sqlite'));
    this.db.exec(
      'PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS experiments(id TEXT PRIMARY KEY, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY, experiment_id TEXT NOT NULL, data TEXT NOT NULL); CREATE INDEX IF NOT EXISTS run_experiment ON runs(experiment_id); CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS templates(id TEXT PRIMARY KEY, data TEXT NOT NULL);'
    );
  }
  list(table) {
    return this.db
      .prepare(`SELECT data FROM ${table}`)
      .all()
      .map((r) => JSON.parse(r.data));
  }
  runStates() {
    return this.db
      .prepare(
        "SELECT id,experiment_id AS experimentId,json_extract(data,'$.status') AS status FROM runs ORDER BY rowid"
      )
      .all();
  }
  runsWithStatus(status) {
    return this.db
      .prepare("SELECT data FROM runs WHERE json_extract(data,'$.status')=? ORDER BY rowid")
      .all(status)
      .map((r) => JSON.parse(r.data));
  }
  runSummaries() {
    return this.db
      .prepare(
        "SELECT json_remove(data,'$.prompt','$.command','$.telemetry.finalText') AS data FROM runs ORDER BY rowid"
      )
      .all()
      .map((r) => JSON.parse(r.data));
  }
  get(table, id) {
    const row = this.db.prepare(`SELECT data FROM ${table} WHERE id=?`).get(id);
    return row ? JSON.parse(row.data) : null;
  }
  save(table, obj) {
    if (table === 'runs')
      this.db
        .prepare('INSERT INTO runs VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data')
        .run(obj.id, obj.experimentId, JSON.stringify(obj));
    else
      this.db
        .prepare(
          `INSERT INTO ${table} VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data`
        )
        .run(obj.id, JSON.stringify(obj));
    return obj;
  }
  patch(table, id, fields) {
    const obj = this.get(table, id);
    if (!obj) return null;
    return this.save(table, { ...obj, ...fields });
  }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const val = fn();
      this.db.exec('COMMIT');
      return val;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
  settings() {
    const row = this.db.prepare("SELECT data FROM settings WHERE key='main'").get();
    return { ...structuredClone(defaults), ...(row ? JSON.parse(row.data) : {}) };
  }
  saveSettings(value) {
    this.db
      .prepare(
        "INSERT INTO settings VALUES('main',?) ON CONFLICT(key) DO UPDATE SET data=excluded.data"
      )
      .run(JSON.stringify(value));
    return value;
  }
  event(id, event) {
    fs.appendFileSync(
      path.join(this.dir, 'runs', id, 'events.jsonl'),
      JSON.stringify({ at: now(), ...event }) + '\n'
    );
  }
  close() {
    this.db.close();
  }
}
