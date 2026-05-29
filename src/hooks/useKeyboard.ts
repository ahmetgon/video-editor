import { useEffect } from "react";
import { useTimeline } from "../stores/timeline";
import { api } from "../api";

export function useKeyboard() {
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      const state = useTimeline.getState();
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;

      switch (e.code) {
        case "Space":
          e.preventDefault();
          state.setPlaying(!state.playing);
          break;

        case "Delete":
        case "Backspace":
          if (state.selectedClipId) {
            api.deleteClip(state.selectedClipId).catch(() => {});
            state.removeClipLocal(state.selectedClipId);
          }
          break;

        case "KeyS":
          if (!e.ctrlKey && !e.metaKey && state.selectedClipId) {
            // Split at playhead
            const clip = state.tracks.flatMap((t) => t.clips).find((c) => c.id === state.selectedClipId);
            if (clip) {
              const clipEnd = clip.timelineStartMs + (clip.mediaEndMs - clip.mediaStartMs);
              if (state.playheadMs > clip.timelineStartMs && state.playheadMs < clipEnd) {
                api.splitClip(clip.id, state.playheadMs).then(({ left, right }) => {
                  state.splitClipLocal(clip.id, left, right);
                }).catch(() => {});
              }
            }
          }
          break;

        case "KeyZ":
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            if (e.shiftKey) state.redo();
            else state.undo();
          }
          break;

        case "KeyY":
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            state.redo();
          }
          break;

        case "ArrowLeft":
          e.preventDefault();
          state.setPlayheadMs(state.playheadMs - (e.shiftKey ? 1000 : 100));
          break;

        case "ArrowRight":
          e.preventDefault();
          state.setPlayheadMs(state.playheadMs + (e.shiftKey ? 1000 : 100));
          break;

        case "Home":
          e.preventDefault();
          state.setPlayheadMs(0);
          break;

        case "Equal":
        case "NumpadAdd":
          e.preventDefault();
          state.setZoom(state.pxPerMs * 1.3);
          break;

        case "Minus":
        case "NumpadSubtract":
          e.preventDefault();
          state.setZoom(state.pxPerMs / 1.3);
          break;
      }
    }

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);
}
