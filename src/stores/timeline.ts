import { create } from "zustand";
import type { Project, Track, Clip, MediaAsset } from "../types";

export interface TimelineState {
  // Project data
  project: Project | null;
  tracks: Track[];
  selectedClipId: string | null;
  selectedTrackId: string | null;

  // Playback
  playheadMs: number;
  playing: boolean;
  durationMs: number;

  // View
  pxPerMs: number; // zoom level
  scrollX: number; // horizontal scroll in px
  scrollY: number;

  // Undo/redo
  history: Track[][];
  historyIndex: number;

  // Actions
  setProject: (project: Project) => void;
  setTracks: (tracks: Track[]) => void;

  // Playback
  setPlayheadMs: (ms: number) => void;
  setPlaying: (playing: boolean) => void;

  // View
  setZoom: (pxPerMs: number) => void;
  setScrollX: (px: number) => void;
  setScrollY: (px: number) => void;

  // Selection
  selectClip: (clipId: string | null) => void;
  selectTrack: (trackId: string | null) => void;

  // Track mutations
  addTrackLocal: (track: Track) => void;
  removeTrackLocal: (trackId: string) => void;
  updateTrackLocal: (trackId: string, data: Partial<Track>) => void;

  // Clip mutations (with undo support)
  addClipLocal: (trackId: string, clip: Clip) => void;
  addClipsBatch: (items: Array<{ trackId: string; clip: Clip }>) => void;
  removeClipLocal: (clipId: string) => void;
  updateClipLocal: (clipId: string, data: Partial<Clip>) => void;
  moveClipLocal: (clipId: string, newTrackId: string, newStartMs: number) => void;
  splitClipLocal: (clipId: string, left: Clip, right: Clip) => void;

  // Undo/redo
  pushHistory: () => void;
  undo: () => void;
  redo: () => void;

  // Computed
  computeDuration: () => number;
}

const MAX_HISTORY = 50;

function calcDuration(tracks: Track[]): number {
  let max = 0;
  for (const t of tracks) {
    for (const c of t.clips) {
      const end = c.timelineStartMs + (c.mediaEndMs - c.mediaStartMs);
      if (end > max) max = end;
    }
  }
  return max;
}

export const useTimeline = create<TimelineState>((set, get) => ({
  project: null,
  tracks: [],
  selectedClipId: null,
  selectedTrackId: null,
  playheadMs: 0,
  playing: false,
  durationMs: 0,
  pxPerMs: 0.1, // 100px per second
  scrollX: 0,
  scrollY: 0,
  history: [],
  historyIndex: -1,

  setProject: (project) => set({
    project,
    tracks: project.tracks,
    durationMs: calcDuration(project.tracks),
    playheadMs: 0,
    playing: false,
    selectedClipId: null,
    history: [project.tracks],
    historyIndex: 0,
  }),

  setTracks: (tracks) => set({ tracks, durationMs: calcDuration(tracks) }),

  setPlayheadMs: (ms) => set({ playheadMs: Math.max(0, ms) }),
  setPlaying: (playing) => set({ playing }),

  setZoom: (pxPerMs) => set({ pxPerMs: Math.max(0.01, Math.min(1, pxPerMs)) }),
  setScrollX: (px) => set({ scrollX: Math.max(0, px) }),
  setScrollY: (px) => set({ scrollY: Math.max(0, px) }),

  selectClip: (clipId) => set({ selectedClipId: clipId }),
  selectTrack: (trackId) => set({ selectedTrackId: trackId }),

  pushHistory: () => {
    const { tracks, history, historyIndex } = get();
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(JSON.parse(JSON.stringify(tracks)));
    if (newHistory.length > MAX_HISTORY) newHistory.shift();
    set({ history: newHistory, historyIndex: newHistory.length - 1 });
  },

  undo: () => {
    const { history, historyIndex } = get();
    if (historyIndex <= 0) return;
    const newIndex = historyIndex - 1;
    const tracks = JSON.parse(JSON.stringify(history[newIndex]));
    set({ tracks, historyIndex: newIndex, durationMs: calcDuration(tracks) });
  },

  redo: () => {
    const { history, historyIndex } = get();
    if (historyIndex >= history.length - 1) return;
    const newIndex = historyIndex + 1;
    const tracks = JSON.parse(JSON.stringify(history[newIndex]));
    set({ tracks, historyIndex: newIndex, durationMs: calcDuration(tracks) });
  },

  addTrackLocal: (track) => set((s) => ({
    tracks: [...s.tracks, track],
  })),

  removeTrackLocal: (trackId) => set((s) => ({
    tracks: s.tracks.filter((t) => t.id !== trackId),
  })),

  updateTrackLocal: (trackId, data) => set((s) => ({
    tracks: s.tracks.map((t) => t.id === trackId ? { ...t, ...data } : t),
  })),

  addClipLocal: (trackId, clip) => {
    get().pushHistory();
    set((s) => {
      const tracks = s.tracks.map((t) =>
        t.id === trackId ? { ...t, clips: [...t.clips, clip] } : t
      );
      return { tracks, durationMs: calcDuration(tracks) };
    });
  },

  addClipsBatch: (items) => {
    get().pushHistory();
    set((s) => {
      let tracks = s.tracks;
      for (const { trackId, clip } of items) {
        tracks = tracks.map((t) =>
          t.id === trackId ? { ...t, clips: [...t.clips, clip] } : t
        );
      }
      return { tracks, durationMs: calcDuration(tracks) };
    });
  },

  removeClipLocal: (clipId) => {
    get().pushHistory();
    set((s) => {
      const tracks = s.tracks.map((t) => ({
        ...t,
        clips: t.clips.filter((c) => c.id !== clipId),
      }));
      return {
        tracks,
        durationMs: calcDuration(tracks),
        selectedClipId: s.selectedClipId === clipId ? null : s.selectedClipId,
      };
    });
  },

  updateClipLocal: (clipId, data) => {
    set((s) => {
      const tracks = s.tracks.map((t) => ({
        ...t,
        clips: t.clips.map((c) => c.id === clipId ? { ...c, ...data } : c),
      }));
      return { tracks, durationMs: calcDuration(tracks) };
    });
  },

  moveClipLocal: (clipId, newTrackId, newStartMs) => {
    get().pushHistory();
    set((s) => {
      let movedClip: Clip | null = null;
      // Remove from old track
      let tracks = s.tracks.map((t) => ({
        ...t,
        clips: t.clips.filter((c) => {
          if (c.id === clipId) { movedClip = c; return false; }
          return true;
        }),
      }));
      // Add to new track
      if (movedClip) {
        tracks = tracks.map((t) =>
          t.id === newTrackId
            ? { ...t, clips: [...t.clips, { ...movedClip!, timelineStartMs: Math.max(0, newStartMs) }] }
            : t
        );
      }
      return { tracks, durationMs: calcDuration(tracks) };
    });
  },

  splitClipLocal: (clipId, left, right) => {
    get().pushHistory();
    set((s) => {
      const tracks = s.tracks.map((t) => ({
        ...t,
        clips: t.clips.flatMap((c) =>
          c.id === clipId ? [left, right] : [c]
        ),
      }));
      return { tracks, durationMs: calcDuration(tracks) };
    });
  },

  computeDuration: () => calcDuration(get().tracks),
}));
