/**
 * team-agent — aggregator. Re-exports all cmd* + lib utilities.
 *
 * Module structure:
 *   lib/      — pure utilities (uuid, config, helpers, yaml, presets)
 *   cmd/      — subcommand implementations
 *   index.ts  — entry router (dispatches to cmd/*)
 *   impl.ts   — this file (re-export aggregator)
 */

// Re-export lib utilities (used by tests + external callers)
export { generateReadableUuid, resolveParentUuid, UUID_RE } from "./lib/uuid";
export { parseSimpleYaml, resolveTemplate } from "./lib/yaml";
export { PRESETS, renderCharterYaml } from "./lib/presets";
export { parseMemberSpec } from "./lib/helpers";

// Re-export subcommands
export { cmdHelp } from "./cmd/help";
export { cmdCreate, cmdSpawn, cmdLs, cmdMsg, cmdShutdown, cmdKill, cmdDelete } from "./cmd/team";
export { cmdUuid } from "./cmd/uuid";
export { cmdCleanup } from "./cmd/cleanup";
export { cmdFrom, cmdQuick, cmdInit } from "./cmd/charter";
export { cmdWizard } from "./cmd/wizard";
export { cmdBring } from "./cmd/bring";
export { cmdTutorial } from "./cmd/tutorial";
