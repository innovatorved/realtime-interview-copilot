/**
 * Central feature flag registry.
 *
 * THIS IS THE ONLY PLACE NEW FLAGS ARE DECLARED. Adding a flag is a
 * single entry here — no schema change, no new admin endpoint, no new
 * admin-UI work (the admin dashboard auto-renders any flag exposed by
 * the `/feature-flag/registry` endpoint).
 *
 * Why a registry?
 *   - Unknown flag keys arriving from any API are rejected early, so
 *     admins can't typo a flag and silently miss it.
 *   - The registry doubles as documentation: each flag carries a human
 *     description that surfaces in the admin UI tooltip.
 *   - Defaults live alongside the declaration so callers who never
 *     write a row still get the intended behaviour.
 *
 * Example (do not enable until a value-schema is decided):
 *   multi_window: {
 *     description: "Allow opening the assistant in a second window",
 *     defaultEnabled: false,
 *     hasValue: false,
 *   },
 */

export interface FlagDefinition {
  /** Human-readable summary shown in the admin UI. */
  description: string;
  /** Default returned when no row exists for the (user, flag) pair. */
  defaultEnabled: boolean;
  /**
   * Whether this flag uses the optional `valueJson` payload. Boolean-only
   * flags should leave this `false`. The service layer enforces this on
   * write so non-spec values are rejected at the registry boundary.
   */
  hasValue: boolean;
}

export const FLAG_REGISTRY = {
  byok: {
    description:
      "User can configure their own Deepgram-compatible and OpenAI-compatible API endpoints (token + URL) and the renderer will call those directly instead of the shared worker provider.",
    defaultEnabled: false,
    hasValue: false,
  },
} as const satisfies Record<string, FlagDefinition>;

export type FlagKey = keyof typeof FLAG_REGISTRY;

export const FLAG_KEYS = Object.keys(FLAG_REGISTRY) as FlagKey[];

export function isKnownFlag(key: string): key is FlagKey {
  return Object.prototype.hasOwnProperty.call(FLAG_REGISTRY, key);
}

export function getFlagDefinition(key: FlagKey): FlagDefinition {
  return FLAG_REGISTRY[key];
}
