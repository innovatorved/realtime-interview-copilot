"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isTrustedOrigin = isTrustedOrigin;
/** Origin trust check shared by navigation gating, window-open gating, and
 *  the permission request handler.
 *
 *  Trusted origins are:
 *   - `file://` (packaged renderer)
 *   - `http(s)://localhost` / `127.0.0.1` (dev server)
 *
 *  Anything else (random http(s) host, custom scheme, malformed URL) is
 *  rejected so a hijacked link in the renderer cannot navigate the main
 *  window to a third-party origin or request privileged Electron APIs. */
function isTrustedOrigin(originUrl) {
    try {
        const u = new URL(originUrl);
        if (u.protocol === "file:")
            return true;
        if (u.protocol === "http:" || u.protocol === "https:") {
            if (u.hostname === "localhost" || u.hostname === "127.0.0.1")
                return true;
        }
        return false;
    }
    catch {
        return false;
    }
}
