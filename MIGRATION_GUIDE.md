# Database Migration System

## Overview
Versioned schema management ensuring safe database upgrades across environments.

## Current Version: 4

| Version | Description | Tables Added |
|---------|-------------|--------------|
| v1 | Initial schema | users, models, files, tags, model_tags, favorites, collections, collection_models, auth_tokens (9 total) |
| v2 | Metadata enhancement | width/height columns on models and files |
| v3 | Soft delete for users | soft_delete flag |

## Schema Tracking Table

```sql
schema_versions (id INTEGER PRIMARY KEY CHECK(id=1), version INT UNIQUE, applied_at DATETIME)
```

## Automatic Migration Flow

On startup, the system:
1. Queries `schema_versions` for current version
2. Executes pending migrations in order (001_prefix.ts → 004_prefix.ts)
3. Records timestamp of each applied migration

## File Convention

Migration files in `server/migrations/`:
```
001_initial_schema.ts     -- Creates all base tables
002_add_metadata_columns.ts  -- Adds width/height columns  
003_...                     -- Soft delete preparation (skipped)
004_add_soft_delete_flag_for_users.ts  -- Implements soft delete for users
```

**Naming**: Prefixed with zero-padded version number. **Export**: Must return `{ version: number; timestamp: string }`.

## Adding Migrations

1. Create file: `server/migrations/005_new_feature.ts`
2. Export function:
```typescript
export function v5_new_feature(db: Database): { version: number; timestamp: string } {
  // Apply schema changes
  db.exec(`ALTER TABLE ...`)
  return { version: 5, timestamp: new Date().toISOString() };
}
```
3. Update `server/db.ts`: `export const SCHEMA_VERSION = 6;`

## Verification Commands

```bash
# Check applied migrations
sqlite3 data/vault.db "SELECT * FROM schema_versions;"

# Expected output:
# id  version  applied_at
# 1   4
```

## Rollback Procedure

⚠️ Warning: Resetting requires re-running all migrations.

```bash
# Backup first
cp data/vault.db data/vault.db.backup

# Reset version tracking
sqlite3 data/vault.db "DELETE FROM schema_versions;"

# Restart app - migrations will re-apply on startup
```

## Schema Versions History

| Version | Description | Date |
|---------|-------------|------|
| v1 | Base tables (users, models, files, etc.) | Initial |
| v2 | Metadata columns on models/files | 2026 |
| v4 | Soft delete flag for users | Oct 2026 |

---
**Last Updated**: Nov 2026 — Version 4 active
