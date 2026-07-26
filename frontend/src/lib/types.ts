export type DriveAccount = {
  id: number;
  name: string;
  remote_name: string;
  email?: string | null;
  status: string;
  last_check_at?: string | null;
  last_error?: string | null;
  total_bytes?: number | null;
  used_bytes?: number | null;
  free_bytes?: number | null;
  notes?: string | null;
  has_token: boolean;
  mount_count: number;
  running_mounts: number;
  team_drive: boolean;
  root_folder_id?: string | null;
  created_at: string;
  updated_at: string;
};

export type Mount = {
  id: number;
  name: string;
  account_id: number;
  account_name?: string | null;
  remote_name?: string | null;
  remote_path: string;
  local_path: string;
  mode: string;
  params: Record<string, any>;
  cache_dir?: string | null;
  enabled: boolean;
  auto_start: boolean;
  status: string;
  pid?: number | null;
  started_at?: string | null;
  uptime_seconds?: number | null;
  last_error?: string | null;
  restart_count: number;
  consecutive_failures: number;
  watchdog_paused: boolean;
  cache_size_bytes: number;
  created_at: string;
  updated_at: string;
  command_preview: string[];
};

export type Dashboard = {
  system: {
    cpu_percent: number;
    memory_percent: number;
    memory_used: number;
    memory_total: number;
    disk_percent: number;
    disk_used: number;
    disk_total: number;
    uptime_seconds: number;
    net_upload_speed: number;
    net_download_speed: number;
    load_avg: number[];
  };
  accounts_total: number;
  mounts_total: number;
  mounts_running: number;
  mounts_error: number;
  mounts_stopped: number;
  total_cache_bytes: number;
  rclone_installed: boolean;
  rclone_version?: string | null;
  rclone_mount_processes: number;
  watchdog_running: boolean;
  disk_warnings: { path: string; percent: number; level: string; message: string }[];
  mounts: Mount[];
};

export type FileEntry = {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  mtime?: number | null;
  ext?: string | null;
};

export type TaskLog = {
  id: number;
  task_type: string;
  mount_id?: number | null;
  account_id?: number | null;
  status: string;
  message: string;
  detail?: string | null;
  created_at: string;
};
