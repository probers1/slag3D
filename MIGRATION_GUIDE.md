# Database Migration System

## Overview

Versioned schema management for safe SQLite upgrades across dev, Docker, and LXC deployments.

## Latest Registered Migration: 5

| Version | Description | Schema effect |
|---------|-------------|---------------|
| v1 | Initial schema | users, models, files, tags, model_tags, favorites, collections, collection_models, auth_tokens (9 tables) |
| v2 | Metadata enhancement | Idempotently ensures width/height on models and files and created_at/updated_at on files/collections (mostly a no-op on fresh v1 databases) |
| v3 | Abandoned, never registered | `003_add_soft_delete_flag.ts` remains on disk but is not imported by the runner |
| v4 | Soft delete for users | `is_deleted`, `deleted_at` on users |
| v5 | PDF document support | `item_type` on models (`model` / `document`) |

The effective version is stored in the DB's single `schema_versions` row. There is no authoritative
`SCHEMA_VERSION` constant in `server/db.ts`; the declaration in `server/types.d.ts` is stale (2) and
should not be relied on.

## Schema Tracking Table

```sql
schema_versions (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  version INTEGER NOT NULL UNIQUE,
  applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

Only one row exists: it records the latest applied version, not a per-migration history.

## Automatic Migration Flow

On startup:

1. `server.ts` validates the three required secrets, then calls `initDatabase()`; failure exits the
   process.
2. `initDatabase()` creates `schema_versions` if absent and calls `runMigrations(db)`.
3. The runner executes registered migrations in order — **v1, v2, v4, v5** — skipping any where
   `currentVersion >= version`. v3 is intentionally omitted.
4. Each applied migration overwrites the single `schema_versions` row with the new version and a
   fresh timestamp; the migration function's returned `timestamp` is not stored.
5. `ensureItemTypeColumn()` then runs unconditionally to repair databases that report a higher
   version but lack `models.item_type`. Do not remove this repair.
6. The admin is seeded only if requested and `users` is empty; upload directories are prepared
   after DB init.
7. Migration errors abort startup. An unexpected failure in the migration system itself falls back
   to `applyFallbackTables()`, which creates the complete v5 schema and stamps version 5.

## Migration Files

Files in `server/migrations/`:

```
001_initial_schema.ts                  -- base tables
002_add_metadata_columns.ts            -- width/height and timestamp columns
003_add_soft_delete_flag.ts            -- legacy; exists but is NOT registered
004_add_soft_delete_flag_for_users.ts  -- user soft delete
005_add_item_type.ts                   -- models.item_type + ensureItemTypeColumn()
```

Only files imported and listed in the `migrations` array in `server/migrations/index.ts` actually
run; a file's presence in the directory is not enough. Each migration function returns
`{ version: number; timestamp: string }`.

## Adding Migrations

1. Create `server/migrations/006_<feature>.ts` exporting a function that returns
   `{ version: 6, timestamp: new Date().toISOString() }`.
2. Import it in `server/migrations/index.ts` and add `{ version: 6, func: ... }` to the `migrations`
   array. There is no `SCHEMA_VERSION` constant to bump.
3. Mirror any new columns/constraints in `applyFallbackTables()` in `server/db.ts`.
4. If application code queries the new column immediately, add an idempotent `ensure...Column()`
   and call it unconditionally from `initDatabase()`, following the `ensureItemTypeColumn()` pattern.

## Verification Commands

`.env` is loaded into the application process, not your shell. Before using `${DB_PATH:-...}`,
export it into the shell (`set -a; . ./.env; set +a`) or pass `DB_PATH=/data/vault.db` explicitly;
otherwise these commands can target a different DB than the app uses.

```bash
# Local dev path; Docker uses /data/vault.db, and DB_PATH overrides both.
sqlite3 "${DB_PATH:-data/vault.db}" \
  "SELECT id, version, applied_at FROM schema_versions WHERE id = 1;"
# Example: 1|5|2026-11-24T12:34:56.789Z

sqlite3 "${DB_PATH:-data/vault.db}" "PRAGMA table_info(models);"  # confirm item_type exists
```

A DB from another build may report a version higher than 5 while still needing the `item_type`
repair; check the actual columns, not just the stored version. `server/migrations/test_migrations.sh`
checks `server/data/vault.db` and is not a reliable runtime verification tool.

## Downgrades / Rollback

⚠️ There are no down migrations. Resetting `schema_versions` only resets bookkeeping — it does not
revert schema changes or data, and a partial migration can leave the DB in a mixed state.

```bash
# Stop the server first. The DB is WAL mode, so do not copy only vault.db while it is running.
sqlite3 "${DB_PATH:-data/vault.db}" ".backup '${DB_PATH:-data/vault.db}.backup'"

# Only if you intentionally want to re-run migrations from scratch:
sqlite3 "${DB_PATH:-data/vault.db}" "DELETE FROM schema_versions;"
# Restart the app, then verify every expected table/column (v1 may re-seed an admin if users is empty).
```

Prefer targeted SQL repairs over a full reset, especially when the stored version came from a newer
build.

## Schema Versions History

| Version | Description | Date |
|---------|-------------|------|
| v1 | Base tables (users, models, files, etc.) | Initial |
| v2 | Metadata columns on models/files | 2026 |
| v3 | Abandoned, never registered (legacy file remains) | — |
| v4 | Soft delete flag for users | Oct 2026 |
| v5 | `item_type` on models for PDF documents | Nov 2026 |

---
**Last Updated**: Nov 2026 — Version 5 active
