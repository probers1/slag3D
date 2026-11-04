#!/usr/bin/env node
/**
 * Create or update the SLAG3D administrator account.
 *
 * Uses ADMIN_USER / ADMIN_PASSWORD from the environment (.env is loaded from
 * the current working directory), or an explicit password as the first arg:
 *
 *   node scripts/set-admin-password.js 'NewStrongPassword123'
 *
 * Safe to run while the server is running; SQLite WAL supports concurrent
 * writers. The username is never changed if it already exists.
 */

import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';

function resolveDbPath() {
  const configured = process.env.DB_PATH?.trim();
  if (configured) return path.resolve(configured);

  if (fs.existsSync('/data') && fs.statSync('/data').isDirectory()) {
    return path.join('/data', 'vault.db');
  }

  return path.resolve(process.cwd(), 'data', 'vault.db');
}

function fail(message) {
  console.error(`[set-admin] ${message}`);
  process.exit(1);
}

const dbPath = resolveDbPath();
if (!fs.existsSync(dbPath)) {
  fail(`Database not found at ${dbPath}. Start SLAG3D once so it can create the schema, then retry.`);
}

const username = (process.env.ADMIN_USER || 'admin').trim() || 'admin';
const password = process.argv[2] || process.env.ADMIN_PASSWORD;

if (!password) {
  fail('No password provided. Set ADMIN_PASSWORD in .env or pass a password as the first argument.');
}

const db = new Database(dbPath);
db.pragma('busy_timeout = 5000');

const userColumns = db.prepare('PRAGMA table_info(users)').all().map((column) => column.name);
if (userColumns.length === 0) {
  fail('The users table does not exist yet. Start SLAG3D once, then retry.');
}

const hasSoftDelete = userColumns.includes('is_deleted');
const hasDeletedAt = userColumns.includes('deleted_at');
const hasUpdatedAt = userColumns.includes('updated_at');

const passwordHash = bcrypt.hashSync(password, 10);
const existing = db
  .prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE')
  .get(username);

if (existing) {
  const updates = ['password_hash = ?', "role = 'admin'"];
  const params = [passwordHash];

  if (hasSoftDelete) {
    updates.push('is_deleted = 0');
  }
  if (hasDeletedAt) {
    updates.push('deleted_at = NULL');
  }
  if (hasUpdatedAt) {
    updates.push('updated_at = CURRENT_TIMESTAMP');
  }

  params.push(existing.id);
  db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  console.log(`[set-admin] Password reset for existing admin "${username}".`);
} else {
  const columns = ['id', 'username', 'password_hash', 'role'];
  const values = [crypto.randomUUID(), username, passwordHash, 'admin'];

  if (hasSoftDelete) {
    columns.push('is_deleted');
    values.push(0);
  }

  const placeholders = columns.map(() => '?').join(', ');
  db.prepare(`INSERT INTO users (${columns.join(', ')}) VALUES (${placeholders})`).run(...values);
  console.log(`[set-admin] Created admin account "${username}".`);
}

if (password.length < 12) {
  console.warn('[set-admin] Warning: this password is shorter than the 12-character policy used by the UI.');
}

db.close();
