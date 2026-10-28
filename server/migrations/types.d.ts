/**
 * Migration System Type Definitions
 */

import Database from 'better-sqlite3';

export interface MigrationResult {
  applied: number[];
  skipped: number[];
  errors: Record<number, Error>;
}

export type MigrationFunction = (db: Database) => {
  version: number;
  timestamp: string;
};

export interface SchemaVersion {
  id: number;          // Always 1 for single version tracking
  version: number;     // Current schema version
  applied_at: string;  // ISO timestamp when migration was applied
}
