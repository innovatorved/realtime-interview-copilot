"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { useAskMic } from "@/hooks/useAskMic";

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
    if (disabledRef.current) return;
    if (askMicRef.current.state !== "idle") return;
    onArmRef.current?.();
    void askMicRef.current.start();
  }, []);

  /** Stop recording + auto-submit via onFinal. */
  const commitRecording = useCallback(() => {
    if (askMicRef.current.state === "idle") return;
    void askMicRef.current.stop();
  }, []);

  /** Drop recording without submitting (drag-off / blur / Esc). */
  const cancelRecording = useCallback(() => {
    if (askMicRef.current.state === "idle") return;
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
      setIsTapLocked(true);
    } else if (micState === "fetching-key" || micState === "connecting") {
      // The mic hasn't finished connecting yet (slow network / cold
      // key endpoint). Committing now would tear down the in-flight
      // session before any audio is captured. Promote to tap-toggle
      // so the session survives and the user can tap again to commit
      // once it's actually recording.
      setIsTapLocked(true);
    } else {
      // Long hold → press-to-talk; release submits.
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
      if (e.metaKey || e.altKey || e.shiftKey) return;
      if (e.code !== "Space") return;
      if (e.repeat) {
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
      if (
        e.code !== "Space" &&
        e.code !== "ControlLeft" &&
        e.code !== "ControlRight"
      )
        return;
      if (pressStartedAtRef.current === null && !isTapLockedRef.current) return;
      e.preventDefault();
      onPressUp();
    };

    const onWindowBlur = () => {
      if (pressStartedAtRef.current !== null) {
        pressStartedAtRef.current = null;
        cancelRecording();
      }
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
