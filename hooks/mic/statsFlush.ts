/** Periodic flush helper for the Ask AI mic diagnostics HUD.
 *
 *  Mirrors mutable ref counters into React state at ~10 Hz so the HUD
 *  updates smoothly without re-rendering on every audio chunk. */

export interface StatsFlusher {
  start: () => void;
  stop: () => void;
  flush: () => void;
}

export function createStatsFlusher(
  flush: () => void,
  intervalMs = 100,
): StatsFlusher {
  let timer: ReturnType<typeof setInterval> | null = null;

  function start() {
    if (timer) return;
    timer = setInterval(flush, intervalMs);
  }

  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    // One final flush so the HUD reflects the post-stop counters.
    flush();
  }

  return { start, stop, flush };
}
