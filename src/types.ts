export interface User {
  id: string;
  username: string;
  role: 'admin' | 'user';
  created_at?: string;
}

export interface ModelFile {
  id: string;
  filename: string;
  original_name: string;
  mime_type: string;
  file_size: number;
  file_path: string;
  is_primary_3d: number;
}

export interface ModelItem {
  id: string;
  user_id: string;
  title: string;
  description: string;
  thumbnail_path: string | null;
  thumbnail_status: 'pending' | 'processing' | 'completed' | 'failed';
  created_at: string;
  updated_at: string;
  owner_username: string;
  is_favorited: boolean;
  files_count: number;
  tags: string[];
  primary_file: ModelFile | null;
}

export interface CollectionItem {
  id: string;
  name: string;
  description: string;
  parent_folder_id: string | null;
  created_at: string;
  model_count: number;
  children?: CollectionItem[];
}

export interface TagItem {
  id: string;
  name: string;
  count: number;
}
