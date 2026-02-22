import path from 'path';
import { app } from 'electron';
import sqlite3 from 'sqlite3';

let db: sqlite3.Database | null = null;

export function getDb() {
  if (db) return db;

  const dbPath = path.join(app.getPath('userData'), 'reader.db');
  console.log('[Electron][DB] dbPath:', dbPath);

  db = new sqlite3.Database(dbPath);
  return db;
}

export function initDb() {
  const d = getDb();
  console.log('[Electron][DB] initDb ✅');

  d.serialize(() => {
    d.run(`
      CREATE TABLE IF NOT EXISTS progress (
        docId TEXT NOT NULL,
        nodeId TEXT NOT NULL,
        visitedAt INTEGER NOT NULL,
        PRIMARY KEY (docId, nodeId)
      )
    `);

    d.run(`
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);

    d.run(
      `INSERT OR IGNORE INTO meta(key,value) VALUES('dbVersion','1')`
    );
  });
}