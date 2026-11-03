/**
 * TypeScript Type Definitions for SLAG3D Database
 */

import { Database } from 'better-sqlite3';

// Current application schema version
export const SCHEMA_VERSION: number = 2;

// Database connection type
export interface DatabaseConnection extends Database {
  exec(sql: string, params?: any[]): void;
  prepare(sql: string): PreparedStatement<any>;
}

// Schema version table
export interface SchemaVersionTable {
  id: number;          // Always 1
  version: number;     // Current schema version
  applied_at: string;  // ISO timestamp
}

// User type
export interface User {
  id: string;
  username: string;
  password_hash: string;
  role: 'user' | 'admin';
  created_at: string;
  updated_at: string;
}

// Model (3D artwork) type
export interface Model {
  id: string;
  user_id: string;
  title: string;
  description?: string;
  thumbnail_path?: string;
  thumbnail_status: 'pending' | 'processing' | 'completed' | 'failed';
  width?: number;      // model canvas width
  height?: number;     // model canvas height
  created_at: string;
  updated_at: string;
}

// File attached to a model
export interface ModelFile {
  id: string;
  model_id: string;
  filename: string;
  original_name: string;
  mime_type: string;
  file_size: number;
  file_path: string;
  width?: number;      // image dimensions
  height?: number;     // image dimensions  
  is_primary_3d: 0 | 1;
  created_at: string;
}

// Tag for organization
export interface Tag {
  id: string;
  name: string;
  created_at: string;
}

// Model-Tag relationship
export interface ModelTag {
  model_id: string;
  tag_id: string;
  created_at: string;
}

// User Favorites
export interface Favorite {
  user_id: string;
  model_id: string;
  created_at: string;
}

// Collection (group of models)
export interface Collection {
  id: string;
  user_id: string;
  name: string;
  description?: string;
  parent_folder_id?: string;
  created_at: string;
  updated_at: string;
}

// Collection-Model relationship in user collections
export interface CollectionModel {
  collection_id: string;
  model_id: string;
  added_at: string;
}

// Authentication Token
export interface AuthToken {
  token: string;      // UUID token
  user_id: string;
  created_at: string;
}

// File system path utilities
export type UploadPath = `${string}/${string}`;
export type ThumbnailPath = `${string}/${string}`;
export type ImageBuffer = Buffer;

// API response types
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface ModelApiResponse extends ApiResponse<Model> {
  files?: ModelFile[];
  tags?: Tag[];
}

export interface UserListApiRespone extends ApiResponse<User[]> {
  total: number;
}

export interface CollectionApiResponse extends ApiResponse<Collection> {
  models?: Model[];
}

// Migration result type
export interface MigrationResult {
  version: number;
  timestamp: string;
}

// Application configuration
export interface AppConfig {
  db_path: string;
  schema_version: number;
  seed_database: boolean;
}

// Database state
export interface DatabaseState {
  db: DatabaseConnection;
  currentVersion: number;
  needsMigration: boolean;
}
