/** Public Ask AI mic types. Kept in a tiny module so the hook + helper
 *  modules can share them without circular imports. */

export type AskMicState =
  | "idle"
  | "fetching-key"
  | "connecting"
  | "recording"
  | "stopping";
