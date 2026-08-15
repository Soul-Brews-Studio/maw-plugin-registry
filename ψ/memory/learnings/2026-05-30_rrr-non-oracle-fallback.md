---
pattern: When a skill's preconditions fail, confirm with the human before using its "last resort" fallback — silent fallthrough produces correct-looking output in the wrong place.
date: 2026-05-30
source: "rrr: maw-plugin-registry"
concepts: [skill-preconditions, oracle-root-detection, fallback-paths, ask-before-falling-through, retro-hygiene]
---

# Confirm before falling through to a skill's last-resort path

## The rule

When a skill detects that its expected environment is missing (Oracle root not
found, vault path absent, required config file missing, etc.) and the skill spec
offers a "last resort: do X anyway with a warning" branch — do not silently take
that branch. Print the warning, then **ask the human** whether to proceed with the
fallback or abort.

## Why

The fallback path is engineered so the skill technically completes — files get
written, exit codes are zero, the user sees a success message. But the files land
in the wrong directory (often the current working repo instead of the Oracle
vault), creating shaped litter that looks like real artifacts.

In this case, `/rrr` ran in `maw-plugin-registry`, a non-Oracle repo with no
`CLAUDE.md` and no `ψ/`. The skill's last-resort branch creates `ψ/` under the
repo root and writes the retro there. The retro is well-formed; it is also
homeless — it will never be picked up by the Oracle memory layer because that
directory isn't part of any Oracle's vault.

A one-sentence confirmation ("you're not in an Oracle repo, write to pwd-ψ or
abort?") costs nothing and prevents the litter.

## How to apply

When a skill's preconditions check (oracle root, vault symlink, config presence)
fails:

1. Print the diagnostic (what was expected, what was found).
2. Print the "last resort" plan as a question, not a statement.
3. Wait for confirmation before writing anything.

Counter-case: do **not** ask when the skill is explicitly designed for the
fallback context (e.g. a `--anywhere` flag, or a skill whose entire purpose is to
run outside Oracle repos). The rule is about silent fallthrough, not all
fallthrough.

## Related

- [[rrr-skill-spec]] — the skill that triggered this lesson
- [[anti-rationalization-guard]] — same family: produce honest output, even when
  the easy path is to ship something that looks fine
