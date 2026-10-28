# Database Migration System

This application uses a migration system to manage database schema changes safely across different environments and deployment scenarios.

## Features

- **Version Tracking**: Current schema version stored in `schema_versions` table
- **Automatic Migration**: Migrations run automatically on startup if pending migrations exist
- **Reproducible Setup**: Same initial schema regardless of database state
- **Environment Safety**: Migrate database without risking data corruption
- **Rollback Support**: Each migration is versioned for easy rollback

## Current Schema Version: 2

The current database supports:
- Users with authentication
- 3D models with multiple image files
- Tag-based organization
- Favorites and collections
- API token authentication

## Migration Files Structure

Located in `server/migrations/`:

```
migrations/
├── index.ts           # Migration runner and version tracking
├── 001_initial_schema.ts     v1: Initial database setup
├── 002_add_metadata_columns.ts   v2: Add metadata columns
└── README.md          # This file
```

## Migration System Usage

### Automatic Deployment

On application startup, the system:
1. Checks current version in `schema_versions` table
2. Applies any pending migrations in order
3. Records each applied migration with timestamp

### Manual Migration Execution

Apply a specific migration manually:

```typescript
import { runMigrations } from './server/migrations';
import db from './server/db';

runMigrations(db);
```

## Adding New Migrations

1. Create new migration file: `server/migrations/003_add_new_feature.ts`

2. Export migration function:

```typescript
export function v3_add_feature(db: Database): { version: number; timestamp: string } {
  console.log('[MIGRATION v3] Your migration steps...');
  
  // Apply schema changes
  db.exec(`ALTER TABLE ...`);
  
  // Record migration
  const insert = db.prepare(`
    INSERT OR IGNORE INTO schema_versions (version, applied_at)
    VALUES (?, CURRENT_TIMESTAMP)
  `);
  insert.run(3);
  
  return { version: 3, timestamp: new Date().toISOString() };
}
```

3. Update `server/migrations/index.ts` to register the new migration:

```typescript
import { v3_add_feature } from './003_add_new_feature';

export function runMigrations(db: Database): void {
  const currentVersion = getCurrentVersion(db);
  
  console.log(`[Migration System] Current version: ${currentVersion}`);
  
  for (const [versionNum, migrationFunc] of Object.entries({
    // Existing migrations...
    3: v3_add_feature,
    // Add more as needed
  })) {
    const version = parseInt(versionNum, 10);
    
    if (version > currentVersion) {
      console.log(`[Migration System] Applying migration v${version}...`);
      const { version: appliedVersion } = migrationFunc(db);
      // Record migration in database
    }
  }
}

export function getCurrentVersion(db: Database): number {
  const row = db.prepare(`
    SELECT version FROM schema_versions WHERE id = 1
  `).get() as { version: numner } | null;
  return row?.version || 0;
}
```

4. Increment `SCHEMA_VERSION` in `server/db.ts`:

```typescript
export const SCHEMA_VERSION = 3;
```

## Migration Best Practices

1. **Atomic Changes**: Each migration should be all-or-nothing
2. **Reversible**: Document how to rollback if needed
3. **Data Preserving**: Never delete user data without backup
4. **Backwards Compatible**: Consider existing data in your migrations
5. **Idempotent**: Can run multiple times safely

## Rollback Procedure

If a migration fails:

```bash
# Edit the database directly or through a script
sqlite3 data/vault.db <<EOF
DELETE FROM schema_versions WHERE id = 1;
EOF
```

This will require re-applying all migrations from the beginning.

## Schema Versions History

| Version | Date      | Description                  |
|---------|-----------|------------------------------|
| v1      | Initial   | Initial database schema      |
| v2      | Current   | Add metadata columns         |
| v3+     | Future    | New features being planned   |

## Troubleshooting

### Migration fails to apply
```bash
# Check current version
sqlite3 data/vault.db "SELECT version FROM schema_versions WHERE id = 1;"

# View all tables
sqlite3 data/vault.db ".schema"

# Check migration logs
npm run dev
```

### Need to reset migrations
⚠️ **Warning: Destroys all data!**

```bash
# Backup your database first!
cp data/vault.db data/vault.db.backup

# Reset and re-create
rm data/vault.db
rm data/*.db-wal 2>/dev/null || true
npm run build
npm start
```

## Security Notes

- Migration system uses deterministic schema changes
- No user data is modified during migrations unless necessary
- Always seed with a known hash for consistent environments