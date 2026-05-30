import { useTimeline } from "../../stores/timeline";
import { api } from "../../api";

export function Toolbar({
  projectTitle,
  onBack,
  onExport,
}: {
  projectTitle: string;
  onBack: () => void;
  onExport: () => void;
}) {
  const playing = useTimeline((s) => s.playing);
  const setPlaying = useTimeline((s) => s.setPlaying);
  const pxPerMs = useTimeline((s) => s.pxPerMs);
  const setZoom = useTimeline((s) => s.setZoom);
  const undo = useTimeline((s) => s.undo);
  const redo = useTimeline((s) => s.redo);
  const historyIndex = useTimeline((s) => s.historyIndex);
  const historyLength = useTimeline((s) => s.history.length);
  const selectedClipId = useTimeline((s) => s.selectedClipId);

  const zoomPercent = Math.round(pxPerMs * 1000);

  function handleSplit() {
    const state = useTimeline.getState();
    const ph = state.playheadMs;

    if (state.selectedClipId) {
      // Split selected clip
      const clip = state.tracks.flatMap((t) => t.clips).find((c) => c.id === state.selectedClipId);
      if (clip) {
        const clipEnd = clip.timelineStartMs + (clip.mediaEndMs - clip.mediaStartMs) / (clip.speed || 1);
        if (ph > clip.timelineStartMs && ph < clipEnd) {
          api.splitClip(clip.id, ph).then(({ left, right }) => {
            useTimeline.getState().splitClipLocal(clip.id, left, right);
          }).catch(() => {});
        }
      }
    } else {
      // Split all clips at playhead
      splitAllAtPlayhead();
    }
  }

  async function splitAllAtPlayhead() {
    const state = useTimeline.getState();
    const ph = state.playheadMs;
    const clipsToSplit = state.tracks.flatMap((t) => t.clips).filter((clip) => {
      const clipEnd = clip.timelineStartMs + (clip.mediaEndMs - clip.mediaStartMs) / (clip.speed || 1);
      return ph > clip.timelineStartMs && ph < clipEnd;
    });

    for (const clip of clipsToSplit) {
      try {
        const { left, right } = await api.splitClip(clip.id, ph);
        useTimeline.getState().splitClipLocal(clip.id, left, right);
      } catch {}
    }
  }

  function handleDelete() {
    const state = useTimeline.getState();
    if (state.selectedClipId) {
      api.deleteClip(state.selectedClipId).catch(() => {});
      state.removeClipLocal(state.selectedClipId);
    }
  }

  return (
    <div className="h-10 bg-gray-900 border-b border-gray-800 flex items-center px-3 gap-2 flex-shrink-0">
      <button
        onClick={onBack}
        className="text-xs text-gray-400 hover:text-white"
      >
        ← Projeler
      </button>

      <div className="w-px h-5 bg-gray-700" />

      <span className="text-sm font-medium truncate max-w-[200px]">{projectTitle}</span>

      <div className="flex-1" />

      {/* Undo/Redo */}
      <button
        onClick={undo}
        disabled={historyIndex <= 0}
        className="text-xs px-2 py-1 bg-gray-800 hover:bg-gray-700 rounded disabled:opacity-30"
        title="Geri al (Ctrl+Z)"
      >
        ↩
      </button>
      <button
        onClick={redo}
        disabled={historyIndex >= historyLength - 1}
        className="text-xs px-2 py-1 bg-gray-800 hover:bg-gray-700 rounded disabled:opacity-30"
        title="Ileri al (Ctrl+Y)"
      >
        ↪
      </button>

      <div className="w-px h-5 bg-gray-700" />

      {/* Playback */}
      <button
        onClick={() => setPlaying(!playing)}
        className="text-sm px-3 py-1 bg-gray-800 hover:bg-gray-700 rounded"
        title="Space"
      >
        {playing ? "⏸ Durdur" : "▶ Oynat"}
      </button>

      <div className="w-px h-5 bg-gray-700" />

      {/* Split */}
      <button
        onClick={handleSplit}
        className="text-xs px-2 py-1 bg-gray-800 hover:bg-gray-700 rounded"
        title="Bol (S = secili klip, Shift+S = tum klipler)"
      >
        ✂ Bol
      </button>

      {/* Delete */}
      <button
        onClick={handleDelete}
        disabled={!selectedClipId}
        className="text-xs px-2 py-1 bg-gray-800 hover:bg-gray-700 rounded disabled:opacity-30"
        title="Sil (Del)"
      >
        🗑 Sil
      </button>

      <div className="w-px h-5 bg-gray-700" />

      {/* Zoom */}
      <button
        onClick={() => setZoom(pxPerMs / 1.3)}
        className="text-xs px-2 py-1 bg-gray-800 hover:bg-gray-700 rounded"
      >
        −
      </button>
      <span className="text-xs text-gray-500 w-12 text-center">{zoomPercent}%</span>
      <button
        onClick={() => setZoom(pxPerMs * 1.3)}
        className="text-xs px-2 py-1 bg-gray-800 hover:bg-gray-700 rounded"
      >
        +
      </button>

      <div className="w-px h-5 bg-gray-700" />

      {/* Export */}
      <button
        onClick={onExport}
        className="text-xs px-3 py-1 bg-green-700 hover:bg-green-600 rounded font-medium"
      >
        Export
      </button>
    </div>
  );
}
