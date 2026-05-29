export interface AuthUser {
  email: string;
  name: string;
  photo?: string;
}

export interface MediaAsset {
  id: string;
  projectId: string;
  filename: string;
  filePath: string;
  type: "VIDEO" | "AUDIO" | "IMAGE";
  durationMs: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  sampleRate: number | null;
  channels: number | null;
  fileSize: number;
  waveformPath: string | null;
  thumbnailPath: string | null;
  createdAt: string;
}

export interface VolumeKeyframe {
  t: number; // time ms relative to clip start (0 = beginning)
  v: number; // volume 0-1
}

export interface Clip {
  id: string;
  trackId: string;
  mediaAssetId: string;
  mediaAsset: MediaAsset;
  name: string;
  timelineStartMs: number;
  mediaStartMs: number;
  mediaEndMs: number;
  volume: number;
  volumeKeyframes?: string; // JSON "[{t,v},...]"
}

export interface Track {
  id: string;
  projectId: string;
  name: string;
  type: "VIDEO" | "AUDIO";
  order: number;
  volume: number;
  muted: boolean;
  locked: boolean;
  clips: Clip[];
}

export interface Project {
  id: string;
  title: string;
  width: number;
  height: number;
  fps: number;
  durationMs: number;
  media: MediaAsset[];
  tracks: Track[];
  createdAt: string;
  updatedAt: string;
  _count?: { media: number; tracks: number };
}

export interface WaveformData {
  peaksPerSecond: number;
  peaks: number[];
}
