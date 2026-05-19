/** Web Audio analyser that drives a live RMS level meter.
 *
 *  Kept separate from the MediaRecorder pipeline so analysing audio
 *  never starves the encoder. Returns a thin handle with `start` /
 *  `stop` so the React hook can keep a single ref slot. */

export interface LevelMeterHandle {
  start: (media: MediaStream, onLevel: (value: number) => void) => void;
  stop: () => void;
}

export function createLevelMeter(): LevelMeterHandle {
  let ctx: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let rafId: number | null = null;

  function start(media: MediaStream, onLevel: (value: number) => void) {
    try {
      const AudioCtxCtor: typeof AudioContext | undefined =
        typeof window === "undefined"
          ? undefined
          : (window.AudioContext ??
            (window as unknown as { webkitAudioContext?: typeof AudioContext })
              .webkitAudioContext);
      if (!AudioCtxCtor) return;

      ctx = new AudioCtxCtor();
      // Ensure the context is running — in packaged Electron builds the
      // autoplay policy can leave it suspended, producing perpetual
      // silence from the analyser even when the mic stream is live.
      if (ctx.state === "suspended") {
        ctx.resume().catch(() => {
          /* best-effort; if it fails we just show no level */
        });
      }
      const source = ctx.createMediaStreamSource(media);
      analyser = ctx.createAnalyser();
      // Small FFT keeps the RAF cheap; we only need a rough RMS.
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.3;
      source.connect(analyser);

      const buffer = new Uint8Array(analyser.fftSize);
      const tick = () => {
        // Lost reference (stop() raced us) — bail.
        if (!analyser) return;
        analyser.getByteTimeDomainData(buffer);
        // RMS of the centered waveform. byteTimeDomainData is unsigned
        // (128 = silence); centre it then normalise to [0, 1].
        let sumSq = 0;
        for (let i = 0; i < buffer.length; i++) {
          const v = (buffer[i] - 128) / 128;
          sumSq += v * v;
        }
        const rms = Math.sqrt(sumSq / buffer.length);
        // Compress a bit so quiet speech looks meaningful (~0.05 RMS
        // becomes ~0.4 displayed) without clipping a normal voice.
        const display = Math.min(1, rms * 4);
        onLevel(display);
        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
    } catch (err) {
      // Level meter is a nice-to-have, not a hard requirement. If the
      // Web Audio context fails to construct (rare; happens in some
      // sandboxed iframes), recording can still proceed without it.
      console.warn("[useAskMic] audio level meter unavailable:", err);
    }
  }

  function stop() {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    if (analyser) {
      try {
        analyser.disconnect();
      } catch {
        /* already disconnected */
      }
      analyser = null;
    }
    if (ctx) {
      ctx.close().catch(() => {
        /* already closed */
      });
      ctx = null;
    }
  }

  return { start, stop };
}
