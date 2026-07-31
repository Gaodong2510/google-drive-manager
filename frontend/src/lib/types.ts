export type CloudProvider = "drive" | "onedrive" | "123pan" | "webdav";

export type DriveAccount = {
  id: number;
  name: string;
  remote_name: string;
  provider: CloudProvider | string;
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
  onedrive_drive_id?: string | null;
  onedrive_drive_type?: string | null;
  webdav_url?: string | null;
  webdav_vendor?: string | null;
  created_at: string;
  updated_at: string;
};

export type Mount = {
  id: number;
  name: string;
  account_id: number;
  account_name?: string | null;
  remote_name?: string | null;
  provider?: CloudProvider | string;
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

export type TrafficMount = {
  mount_id: number;
  mount_name: string;
  account_id: number;
  account_name?: string | null;
  provider?: string;
  team_drive?: boolean;
  status: string;
  today_bytes: number;
  session_bytes: number;
  rc_ok: boolean;
  last_sample_at?: string | null;
};

export type Traffic = {
  timezone: string;
  day: string;
  today_bytes: number;
  session_bytes: number;
  next_reset_at: string;
  seconds_until_reset: number;
  note?: string;
  mounts: TrafficMount[];
  history: { day: string; bytes_total: number }[];
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
  traffic?: Traffic | null;
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

export type UploadEvent = {
  time?: string | null;
  event: string;
  path: string;
  message: string;
  size_bytes?: number | null;
  job_id?: string | null;
  percent?: number | null;
  speed?: string | null;
  eta?: string | null;
  source?: string; // vfs | copy
};

export type TransferJob = {
  id: string;
  status: string;
  mode: string;
  percent: number;
  transferred: string;
  total: string;
  speed: string;
  eta: string;
  message: string;
  error: string;
  src_paths: string[];
  dest_dir: string;
  current_src: string;
  items_done: number;
  items_total: number;
  files_total?: number;
  files_done?: number;
  size_bytes?: number;
  created_at?: string | null;
  updated_at?: string | null;
  finished_at?: string | null;
  can_close?: boolean;
};

export type MountUpload = {
  mount_id: number;
  mount_name: string;
  local_path: string;
  status: string;
  rc_enabled: boolean;
  rc_port?: number | null;
  objects: number;
  in_use: number;
  to_upload: number;
  uploading: number;
  cache_total_bytes: number;
  cache_total_display: string;
  last_cleaned_at?: string | null;
  transfer_bytes?: number | null;
  transfer_total_bytes?: number | null;
  transfer_percent?: number | null;
  transfer_speed_bps?: number | null;
  transfer_eta?: string | null;
  transfers_done?: number | null;
  transfers_total?: number | null;
  errors: number;
  recent_events: UploadEvent[];
  active: boolean;
  source: string;
  note?: string | null;
};

export type UploadStatus = {
  mounts: MountUpload[];
  copy_jobs?: TransferJob[];
  summary: {
    to_upload: number;
    uploading: number;
    errors: number;
    active_mounts: number;
    total_speed_bps: number;
    any_active: boolean;
    copy_active?: number;
    copy_total?: number;
  };
};
