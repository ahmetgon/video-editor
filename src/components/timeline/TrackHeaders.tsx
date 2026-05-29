import { useState } from "react";
import { useTimeline } from "../../stores/timeline";
import { api } from "../../api";

const TRACK_HEIGHT = 60;
const TRACK_GAP = 2;

export function TrackHeaders({ projectId }: { projectId: string }) {
  const tracks = useTimeline((s) => s.tracks);
  const [addingTrack, setAddingTrack] = useState(false);

  async function addTrack(type: "VIDEO" | "AUDIO") {
    setAddingTrack(true);
    try {
      const count = tracks.filter((t) => t.type === type).length + 1;
      const name = `${type === "VIDEO" ? "Video" : "Audio"} ${count}`;
      const track = await api.addTrack(projectId, { name, type });
      useTimeline.getState().addTrackLocal(track);
    } catch (e) {
      console.error("Track eklenemedi:", e);
    }
    setAddingTrack(false);
  }

  function toggleMute(trackId: string, currentMuted: boolean) {
    const newMuted = !currentMuted;
    useTimeline.getState().updateTrackLocal(trackId, { muted: newMuted });
    api.updateTrack(trackId, { muted: newMuted }).catch(() => {});
  }

  function toggleLock(trackId: string, currentLocked: boolean) {
    const newLocked = !currentLocked;
    useTimeline.getState().updateTrackLocal(trackId, { locked: newLocked });
    api.updateTrack(trackId, { locked: newLocked }).catch(() => {});
  }

  function deleteTrack(trackId: string) {
    if (tracks.length <= 1) return;
    useTimeline.getState().removeTrackLocal(trackId);
    api.deleteTrack(trackId).catch(() => {});
  }

  return (
    <div className="w-[140px] flex-shrink-0 bg-[#0d0d0d] border-r border-[#222] flex flex-col">
      {/* Ruler spacer */}
      <div
        className="flex items-center px-2 border-b border-[#222]"
        style={{ height: 28 }}
      >
        <span className="text-[9px] text-gray-600 uppercase tracking-wider">
          Kanallar
        </span>
      </div>

      {/* Track rows */}
      <div className="flex-1 overflow-hidden">
        {tracks.map((track) => (
          <div
            key={track.id}
            className="flex flex-col justify-center px-2 border-b border-[#1a1a1a]"
            style={{ height: TRACK_HEIGHT + TRACK_GAP }}
          >
            <div className="flex items-center justify-between">
              <span
                className={`text-[11px] font-medium truncate max-w-[70px] ${
                  track.muted
                    ? "text-gray-600 line-through"
                    : track.type === "VIDEO"
                      ? "text-blue-300"
                      : "text-green-300"
                }`}
              >
                {track.name}
              </span>
              <div className="flex items-center gap-0.5">
                <button
                  onClick={() => toggleMute(track.id, track.muted)}
                  className={`w-5 h-5 flex items-center justify-center rounded text-[10px] transition-colors ${
                    track.muted
                      ? "bg-red-900/50 text-red-400"
                      : "text-gray-500 hover:text-white hover:bg-gray-700"
                  }`}
                  title={track.muted ? "Sesi ac" : "Sustur"}
                >
                  {track.muted ? "M" : "♪"}
                </button>
                <button
                  onClick={() => toggleLock(track.id, track.locked)}
                  className={`w-5 h-5 flex items-center justify-center rounded text-[10px] transition-colors ${
                    track.locked
                      ? "bg-yellow-900/50 text-yellow-400"
                      : "text-gray-600 hover:text-white hover:bg-gray-700"
                  }`}
                  title={track.locked ? "Kilidi ac" : "Kilitle"}
                >
                  {track.locked ? "🔒" : "🔓"}
                </button>
                <button
                  onClick={() => deleteTrack(track.id)}
                  className="w-5 h-5 flex items-center justify-center rounded text-[10px] text-gray-600 hover:text-red-400 hover:bg-gray-800 transition-colors disabled:opacity-30"
                  title="Track sil"
                  disabled={tracks.length <= 1}
                >
                  ×
                </button>
              </div>
            </div>
            <span
              className={`text-[9px] mt-0.5 ${
                track.type === "VIDEO"
                  ? "text-blue-500/60"
                  : "text-green-500/60"
              }`}
            >
              {track.type}
            </span>
          </div>
        ))}
      </div>

      {/* Add track buttons */}
      <div className="border-t border-gray-800 p-1.5 flex gap-1">
        <button
          onClick={() => addTrack("VIDEO")}
          disabled={addingTrack}
          className="flex-1 text-[9px] py-1 bg-blue-900/20 hover:bg-blue-900/40 text-blue-400 rounded disabled:opacity-50 transition-colors"
        >
          + Video
        </button>
        <button
          onClick={() => addTrack("AUDIO")}
          disabled={addingTrack}
          className="flex-1 text-[9px] py-1 bg-green-900/20 hover:bg-green-900/40 text-green-400 rounded disabled:opacity-50 transition-colors"
        >
          + Audio
        </button>
      </div>
    </div>
  );
}
