import { useEffect, useRef } from "react";
import { useTimeline } from "../stores/timeline";

export function usePlayback() {
  const rafRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const playing = useTimeline((s) => s.playing);
  const durationMs = useTimeline((s) => s.durationMs);

  useEffect(() => {
    if (!playing) {
      cancelAnimationFrame(rafRef.current);
      return;
    }

    lastTimeRef.current = performance.now();

    const tick = (now: number) => {
      const delta = now - lastTimeRef.current;
      lastTimeRef.current = now;

      const state = useTimeline.getState();
      const next = state.playheadMs + delta;

      if (next >= durationMs) {
        state.setPlayheadMs(0);
        state.setPlaying(false);
        return;
      }

      state.setPlayheadMs(next);
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(rafRef.current);
  }, [playing, durationMs]);
}
