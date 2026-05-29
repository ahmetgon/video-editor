import { useTimeline } from "../../stores/timeline";

export function Toolbar({
  projectTitle,
  onBack,
}: {
  projectTitle: string;
  onBack: () => void;
}) {
  const playing = useTimeline((s) => s.playing);
  const setPlaying = useTimeline((s) => s.setPlaying);
  const pxPerMs = useTimeline((s) => s.pxPerMs);
  const setZoom = useTimeline((s) => s.setZoom);
  const undo = useTimeline((s) => s.undo);
  const redo = useTimeline((s) => s.redo);
  const historyIndex = useTimeline((s) => s.historyIndex);
  const historyLength = useTimeline((s) => s.history.length);

  const zoomPercent = Math.round(pxPerMs * 1000);

  return (
    <div className="h-10 bg-gray-900 border-b border-gray-800 flex items-center px-3 gap-3 flex-shrink-0">
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
    </div>
  );
}
