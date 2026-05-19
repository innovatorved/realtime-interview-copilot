import { desktopCapturer, type Session } from "electron";
import { isTrustedOrigin } from "./origin";

/** Auto-grant media / display-capture permissions for our own app so the
 *  first getDisplayMedia() call does not silently fail. The OS-level
 *  Screen Recording permission (macOS) is still enforced by the system.
 *
 *  Only grants when the request comes from our own trusted renderer
 *  origin; OS-level Screen Recording / Microphone prompts still gate
 *  actual access. */
export function installPermissionRequestHandler(s: Session): void {
  s.setPermissionRequestHandler((wc, permission, callback, details) => {
    const origin = details?.requestingUrl || wc.getURL() || "";
    if (!isTrustedOrigin(origin)) {
      callback(false);
      return;
    }
    if (
      permission === "media" ||
      permission === "display-capture" ||
      permission === "notifications"
    ) {
      callback(true);
      return;
    }
    callback(false);
  });

  /** Synchronous permission check handler — required in packaged builds
   *  where the page loads from file:// / app://.
   *
   *  For "media" we unconditionally return true. This handler is just a
   *  synchronous fast-path; the real security enforcement is in
   *  setPermissionRequestHandler (which receives the full requestingUrl,
   *  not the opaque "null" origin that file:// pages produce). If we
   *  return false here, Chromium short-circuits the getUserMedia call
   *  BEFORE it reaches the OS — so the macOS mic-permission dialog never
   *  appears and the user can't grant access at all. */
  s.setPermissionCheckHandler((_wc, permission, _requestingOrigin) => {
    if (permission === "media") {
      return true;
    }
    return false;
  });
}

/** Route renderer getDisplayMedia() calls to system audio loopback, so we
 *  capture loudspeaker output natively without requiring BlackHole /
 *  VB-Audio virtual devices. We still attach the primary screen as the
 *  required video source (Chromium rejects audio-only display media) and
 *  the renderer immediately stops the video track. */
export function installDisplayMediaHandler(s: Session): void {
  s.setDisplayMediaRequestHandler(
    async (_request, callback) => {
      try {
        const sources = await desktopCapturer.getSources({ types: ["screen"] });
        if (sources.length === 0) {
          callback({});
          return;
        }
        callback({ video: sources[0], audio: "loopback" });
      } catch (err) {
        console.error("Failed to provide loopback audio source:", err);
        callback({});
      }
    },
    { useSystemPicker: false },
  );
}
