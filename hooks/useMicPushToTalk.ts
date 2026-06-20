"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { useAskMic } from "@/hooks/useAskMic";
import { dbg } from "@/lib/debug";

type AskMicHandle = ReturnType<typeof useAskMic>;

interface UseMicPushToTalkOptions {
  /**
   * Called immediately when a hold gesture begins (pointer down, plain
   * Space, or Ctrl+Space keydown). Use to focus the input / open a
   * drawer / clear stale state before the WS connects.
   */
  onArm?: () => void;
  /**
   * If `false` the global Space / Ctrl+Space push-to-talk hotkey is
   * not bound. Defaults to `true`. Set to `false` on a non-active
   * surface so two surfaces don't fight for the same keystroke.
   */
  enableHotkey?: boolean;
  /**
   * If `true`, ignore both pointer and key gestures. Wired to the
   * surface's `isLoading` flag so a hold attempt during an in-flight
   * completion can't kick off a duplicate request before the previous
   * one finishes.
   */
  disabled?: boolean;
}

/**
 * A press shorter than this many ms is treated as a TAP (enter
 * tap-toggle mode); anything longer is a HOLD (release commits).
 * 200ms is the sweet spot: long enough to filter accidental taps,
 * short enough that holding feels instant.
 */
const TAP_THRESHOLD_MS = 200;

/**
 * Combined tap-toggle + press-to-talk gesture binding for the Ask AI
 * mic. ONE button / ONE key (Space) supports two flows:
 *
 *   - TAP  (press <200ms then release) → start recording in toggle
 *           mode; the second tap stops + auto-submits. Useful for
 *           longer questions where you don't want to hold the button.
 *   - HOLD (press ≥200ms then release) → walkie-talkie; recording
 *           runs while pressed, release commits + auto-submits.
 *           Useful for quick, in-the-flow utterances.
 *
 * The global hotkey is plain `Space` when no text-editable element is
 * focused, or the focused text-editable is empty (typical state right
 * after the Ask AI surface opens and autofocuses its input). Once the
 * user has typed something, Space goes through normally — but
 * `Ctrl+Space` is always available as an explicit "start the mic
 * regardless" override.
 *
 * In both flows, drag-off (pointer-cancel) or window-blur drops the
 * recording without submitting — so abandoning a press never sends a
 * half-formed question.
 *
 * Returns:
 *  - `pointerHandlers` — spread onto the mic button.
 *  - `keyboardHandlers` — for the same button to be operable from
 *     keyboard (Space/Enter when focused).
 *  - `isTapLocked` — true while the user is in tap-toggle recording
 *     mode. Lets the button render a distinct "locked-on" visual so
 *     the gesture is discoverable.
 */
export function useMicPushToTalk(
  askMic: AskMicHandle,
  {
    onArm,
    enableHotkey = true,
    disabled = false,
  }: UseMicPushToTalkOptions = {},
) {
  // The current "gesture in flight" press timestamp. Null when no
  // pointer/key is currently pressed. We use this to classify the
  // release as tap (short) vs hold (long).
  const pressStartedAtRef = useRef<number | null>(null);
  // True while the user is in tap-toggle mode (recording continues,
  // next tap stops + submits). Exposed via state so the button can
  // change colour to indicate the locked-on state.
  const [isTapLocked, setIsTapLocked] = useState(false);
  const isTapLockedRef = useRef(false);
  isTapLockedRef.current = isTapLocked;

  const askMicRef = useRef(askMic);
  const onArmRef = useRef(onArm);
  const disabledRef = useRef(disabled);
  useEffect(() => {
    askMicRef.current = askMic;
    onArmRef.current = onArm;
    disabledRef.current = disabled;
  });

  /** Start recording (idempotent — won't double-arm an active session). */
  const armRecording = useCallback(() => {
    if (disabledRef.current) {
      dbg("ptt", "armRecording skipped — disabled");
      return;
    }
    if (askMicRef.current.state !== "idle") {
      dbg("ptt", "armRecording skipped — state is", askMicRef.current.state);
      return;
    }
    dbg("ptt", "armRecording → start()");
    onArmRef.current?.();
    void askMicRef.current.start();
  }, []);

  /** Stop recording + auto-submit via onFinal. */
  const commitRecording = useCallback(() => {
    if (askMicRef.current.state === "idle") return;
    dbg("ptt", "commitRecording → stop()");
    void askMicRef.current.stop();
  }, []);

  /** Drop recording without submitting (drag-off / blur / Esc). */
  const cancelRecording = useCallback(() => {
    if (askMicRef.current.state === "idle") return;
    dbg("ptt", "cancelRecording → cancel()");
    void askMicRef.current.cancel();
    setIsTapLocked(false);
  }, []);

  /**
   * One unified press-down handler shared by pointer + keyboard. We
   * always start recording immediately on press so the first ms of
   * speech isn't lost waiting for the hold-vs-tap classification.
   *
   * Behaviour by current state:
   *   - In tap-locked mode (recording from a previous tap) → this
   *     press is the "second tap" that stops + submits.
   *   - Otherwise → arm a new recording, remember the press time so
   *     the matching release can classify it as tap or hold.
   */
  const onPressDown = useCallback(() => {
    if (disabledRef.current) return;
    if (isTapLockedRef.current) {
      // Second tap of the toggle flow → commit + clear lock.
      dbg("ptt", "press down while tap-locked → committing");
      setIsTapLocked(false);
      commitRecording();
      pressStartedAtRef.current = null;
      return;
    }
    pressStartedAtRef.current = performance.now();
    armRecording();
  }, [armRecording, commitRecording]);

  /**
   * Release classifier. If the press was shorter than the tap threshold
   * we keep recording (tap-toggle mode). If it was longer, we commit
   * the recording now.
   */
  const onPressUp = useCallback(() => {
    const startedAt = pressStartedAtRef.current;
    pressStartedAtRef.current = null;
    if (startedAt === null) {
      // No matching press (focus moved mid-gesture). Don't act.
      return;
    }
    if (askMicRef.current.state === "idle") {
      // Recording was cancelled/failed before release — nothing to do.
      return;
    }
    const heldMs = Math.round(performance.now() - startedAt);
    const micState = askMicRef.current.state;
    if (heldMs < TAP_THRESHOLD_MS) {
      // Quick tap → enter tap-toggle mode; recording keeps running
      // until the user taps again.
      dbg(
        "ptt",
        `release after ${heldMs}ms → TAP (tap-locked, keep recording)`,
      );
      setIsTapLocked(true);
    } else if (micState === "fetching-key" || micState === "connecting") {
      // The mic hasn't finished connecting yet (slow network / cold
      // key endpoint). Committing now would tear down the in-flight
      // session before any audio is captured. Promote to tap-toggle
      // so the session survives and the user can tap again to commit
      // once it's actually recording.
      dbg(
        "ptt",
        `release after ${heldMs}ms but mic still ${micState} → promoting to tap-lock`,
      );
      setIsTapLocked(true);
    } else {
      // Long hold → press-to-talk; release submits.
      dbg("ptt", `release after ${heldMs}ms → HOLD (committing)`);
      setIsTapLocked(false);
      commitRecording();
    }
  }, [commitRecording]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (e.button !== 0) return; // left button only
      e.preventDefault();
      try {
        (e.target as Element).setPointerCapture?.(e.pointerId);
      } catch {
        /* setPointerCapture is best-effort */
      }
      onPressDown();
    },
    [onPressDown],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      try {
        (e.target as Element).releasePointerCapture?.(e.pointerId);
      } catch {
        /* releasePointerCapture is best-effort */
      }
      onPressUp();
    },
    [onPressUp],
  );

  const onPointerCancel = useCallback(() => {
    pressStartedAtRef.current = null;
    cancelRecording();
  }, [cancelRecording]);

  // Keyboard repeat fires while the key is held — we ignore repeats
  // (only the FIRST keydown arms; release is the only "real" event).
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLElement>) => {
      if (e.repeat) return;
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        onPressDown();
      }
    },
    [onPressDown],
  );

  const onKeyUp = useCallback(
    (e: React.KeyboardEvent<HTMLElement>) => {
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        onPressUp();
      }
    },
    [onPressUp],
  );

  // Global Space / Ctrl+Space hotkey, works from anywhere when enabled.
  useEffect(() => {
    if (!enableHotkey) return;

    /**
     * Decide whether to intercept this Space keydown for the mic. The
     * goal is "Space starts/holds the mic" without breaking ordinary
     * typing in the question textarea.
     *
     * Intercept when ANY of:
     *   - tap-toggle is already active (recording in progress from a
     *     prior tap) — the user needs Space to stop+send regardless
     *     of what now lives in the textarea.
     *   - Ctrl is held (explicit "force mic" override).
     *   - The event target is NOT a text-editable element (the user
     *     hasn't clicked into any input — e.g. they just opened Ask AI
     *     and the body still has focus, or focus is on a non-input
     *     element).
     *   - The event target IS a text-editable element but its value
     *     is currently empty (the typical state right after Ask AI's
     *     autofocus — pressing Space at that moment to start the mic
     *     is intuitive and never collides with real typing because
     *     there's nothing to type into).
     */
    const shouldIntercept = (e: KeyboardEvent): boolean => {
      if (isTapLockedRef.current) return true;
      if (e.ctrlKey) return true;
      const target = e.target as HTMLElement | null;
      if (!target) return true;
      if (target.isContentEditable) return false;
      const tag = target.tagName;
      if (tag !== "INPUT" && tag !== "TEXTAREA") return true;
      // Empty input/textarea → safe to steal the keystroke.
      const value = (target as HTMLInputElement | HTMLTextAreaElement).value;
      return typeof value === "string" && value.length === 0;
    };

    const onWindowKeyDown = (e: KeyboardEvent) => {
      // Block Meta/Alt/Shift+Space — those are reserved for OS / app
      // shortcuts (Spotlight, special character pickers, etc.) and
      // stealing them would surprise users. Ctrl is allowed because
      // we treat it as an explicit override.
      if (e.metaKey || e.altKey || e.shiftKey) return;
      if (e.code !== "Space") return;
      if (e.repeat) {
        // Still preventDefault on repeats if we initiated a press or
        // are tap-locked — otherwise the browser inserts space chars
        // into the focused input while the user is holding the key.
        if (pressStartedAtRef.current !== null || isTapLockedRef.current) {
          e.preventDefault();
        }
        return;
      }
      if (!shouldIntercept(e)) return;
      e.preventDefault();
      onPressDown();
    };

    const onWindowKeyUp = (e: KeyboardEvent) => {
      // Treat releasing Space (or Ctrl, when Ctrl+Space was used as
      // the override) as the release signal.
      if (
        e.code !== "Space" &&
        e.code !== "ControlLeft" &&
        e.code !== "ControlRight"
      )
        return;
      // Only respond if we initiated a press (otherwise spurious
      // Ctrl/Space releases from unrelated shortcuts would re-trigger).
      if (pressStartedAtRef.current === null && !isTapLockedRef.current) return;
      e.preventDefault();
      onPressUp();
    };

    const onWindowBlur = () => {
      // Lost focus mid-press — drop the gesture state without
      // committing. We never want a pretend-release to fire because
      // we missed the real keyup.
      if (pressStartedAtRef.current !== null) {
        dbg("ptt", "window blur during press → cancelling");
        pressStartedAtRef.current = null;
        cancelRecording();
      }
      // Tap-locked mode survives blur intentionally: the user might
      // alt-tab to a doc and come back, expecting their session to
      // still be open.
    };
    window.addEventListener("keydown", onWindowKeyDown);
    window.addEventListener("keyup", onWindowKeyUp);
    window.addEventListener("blur", onWindowBlur);
    return () => {
      window.removeEventListener("keydown", onWindowKeyDown);
      window.removeEventListener("keyup", onWindowKeyUp);
      window.removeEventListener("blur", onWindowBlur);
    };
  }, [enableHotkey, onPressDown, onPressUp, cancelRecording]);

  // Sync: if the askMic state goes back to idle externally (e.g. an
  // error tore down the WS, or the consumer called askMic.cancel()
  // directly), clear our tap-lock too — otherwise the button would
  // still look "locked on" with nothing actually recording.
  useEffect(() => {
    if (askMic.state === "idle" && isTapLockedRef.current) {
      dbg("ptt", "askMic returned to idle externally → clearing tap-lock");
      setIsTapLocked(false);
    }
  }, [askMic.state]);

  return {
    pointerHandlers: { onPointerDown, onPointerUp, onPointerCancel },
    keyboardHandlers: { onKeyDown, onKeyUp },
    /** True while the user is in tap-toggle (locked-on) recording mode. */
    isTapLocked,
    /**
     * Imperatively cancel any in-flight recording (tap or hold) and
     * clear tap-lock. Exposed so Esc handlers in the surrounding
     * surface can route an Esc keypress here without duplicating
     * teardown logic.
     */
    cancel: cancelRecording,
  };
}
