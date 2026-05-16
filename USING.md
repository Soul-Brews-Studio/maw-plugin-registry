# Using maw plugins

This guide is for people running the `maw` CLI who want to discover, install,
trust, enable, disable, or remove community plugins from the maw plugin
registry.

If you are writing or submitting a plugin, start with
[CONTRIBUTING.md](./CONTRIBUTING.md) instead.

## Quick start

```bash
# Find plugins by name or summary.
maw plugin search shell

# Inspect the public registry maw will use.
maw plugin registry
maw plugin info shellenv

# Install a plugin from the registry.
maw plugin install shellenv

# See installed commands and disabled plugins.
maw plugin ls
maw plugin ls --all
maw plugin info shellenv

# Enable or disable installed plugin commands.
maw plugin enable shellenv
maw plugin disable shellenv

# Upgrade/reinstall by installing again with overwrite.
maw plugin install shellenv --force

# Remove without deleting forever; maw archives the old install under /tmp.
maw plugin remove shellenv
```

There is no separate `maw plugin upgrade` verb in current maw builds. Use
`maw plugin install <name> --force` to replace an existing install with the
currently resolved registry source.

### Worked example: shellenv

`shellenv` loads `.envrc` / shell environment context so `maw` commands behave
like the shell you are already using.

```bash
maw plugin search shellenv
maw plugin info shellenv
maw plugin install shellenv
maw plugin enable shellenv
maw plugin ls --all

# Later, if you do not want it active:
maw plugin disable shellenv

# Or archive/remove the installed copy:
maw plugin remove shellenv
```

When a command is installed but disabled, maw prints an actionable hint such as:

```text
✗ 'shellenv' is installed but disabled.
  Run: maw plugin enable shellenv
```

## Where things live

- Public registry: `https://maw.soulbrews.studio/registry.json`
  - Override with `MAW_REGISTRY_URL`.
- Registry cache: `~/.maw/registry-cache.json`
  - 5-minute TTL; used as fallback when the network fails.
  - Override with `MAW_REGISTRY_CACHE`.
- Installed plugins: `~/.maw/plugins/<name>/`
  - Override install root with `MAW_PLUGINS_DIR`.
- Trust pins: `~/.maw/plugins.lock`
  - SHA-256 pins over approved plugin artifacts/sources.
  - Override with `MAW_PLUGINS_LOCK`.

The registry repo is static. The CLI fetches `registry.json`, resolves a plugin
name to a source, then installs that source into your local plugin directory.
Some maw builds also support curated packages when the registry publishes a
`packages` section; this registry currently lists plugins directly.

## Trust model

There are two layers:

1. **Registry = advisory.** It tells maw where a plugin version is expected to
   come from: name, version, source, summary, author, license, and optional
   SHA-256.
2. **`plugins.lock` = adversarial gate.** Your local lockfile records the
   approved `{ version, source, sha256 }` for a plugin. On pinned installs, the
   bytes maw installs must match the local lock entry, not just the registry
   entry or the tarball's own manifest.

That split matters: if the public registry were compromised or stale, a pinned
local install still refuses unexpected bytes because the local `sha256` does not
match.

Useful commands:

```bash
# Add/update a local trust pin from a tarball.
maw plugin pin <name> <tarball> [--version <version>]

# Remove a local trust pin.
maw plugin unpin <name>

# Install and write a pin when the source supports it.
maw plugin install <source> --pin
```

For day-to-day first-party registry plugins, `maw plugin install <name>` is the
normal path. Use pins when you need stronger supply-chain reproducibility or are
installing from a peer/direct source.

## Source format in registry listings

Registry entries use this source shape:

```text
owner/repo[/subpath][@ref]
```

You may see it in `maw plugin info <name>` or in `registry.json`.

- `owner/repo`: plugin at the root of a GitHub repo, default resolved ref.
- `owner/repo@v1.2.3`: whole-repo plugin pinned to a tag, branch, or SHA.
- `owner/repo/plugin-name`: plugin in a monorepo subpath. A single segment can
  resolve to `plugins/<name>` when present.
- `owner/repo/path/to/plugin@v1.2.3`: monorepo subpath pinned to a specific ref.

Examples:

```text
soul-brews-studio/maw-plugin-registry/shellenv@v0.1.0-shellenv
soul-brews-studio/maw-plugin-registry/fleet-ui@v0.1.0-fleet-ui
```

You can also install direct sources without a registry entry:

```bash
maw plugin install owner/repo[/subpath][@ref]
maw plugin install https://example.com/plugin.tgz
maw plugin install ./local-plugin-dir --link
```

## Capability model

Each plugin has a `plugin.json` manifest. The manifest can advertise surfaces
and capabilities so users can decide whether a plugin is appropriate before
enabling it.

Common surfaces:

- `cli`: adds a `maw <command>` command or aliases.
- `api`: adds API routes to the maw server.
- `engine.serve`: describes a persistent plugin process that can be
  started/managed by engine-aware maw builds.
- `capabilities`: advisory strings such as `proc:*`, `net:*`, `tmux:*`, or
  plugin-owned namespaces that describe what the plugin may use.
- `tier`: default loading tier: `core`, `standard`, or `extra`. Disabled/extra
  plugins may need `maw plugin enable <name>`.

Capabilities are not a replacement for reading the plugin source, but they are a
fast risk signal. For example, a UI-only plugin is very different from a plugin
that can spawn processes, talk to the network, or control tmux panes.

## Troubleshooting

### `plugin '<name>' not in registry`

Check spelling and search first:

```bash
maw plugin search <keyword>
maw plugin registry
```

If you have a direct GitHub source, bypass the registry:

```bash
maw plugin install owner/repo[/subpath][@ref]
```

### Registry fetch fails

`maw plugin search`, `maw plugin info`, and registry-name installs fetch
`https://maw.soulbrews.studio/registry.json` by default. If fetch fails and a
matching cache exists, maw falls back to `~/.maw/registry-cache.json` and prints
a warning. If there is no cache, check network access or point maw at a mirror:

```bash
MAW_REGISTRY_URL=https://your-mirror.example/registry.json maw plugin search shell
```

### Lock or hash mismatch

A mismatch means the bytes being installed do not match the local trust pin.
Do not bypass it blindly.

Safe recovery path:

1. Re-run `maw plugin info <name>` and confirm the source/version you intended.
2. Inspect the plugin's upstream release or source diff.
3. If the change is expected, regenerate the pin from the trusted tarball:

```bash
maw plugin pin <name> <tarball> [--version <version>]
maw plugin install <source> --force --pin
```

### Installed but disabled

Enable it:

```bash
maw plugin enable <name>
```

List disabled plugins:

```bash
maw plugin ls --all
```

### Existing install blocks reinstall

Use `--force` to archive the old copy and replace it:

```bash
maw plugin install <name> --force
```

## Pointers

- Public marketplace UI: <https://maw.soulbrews.studio>
- Registry manifest: <https://maw.soulbrews.studio/registry.json>
- Author/submission guide: [CONTRIBUTING.md](./CONTRIBUTING.md)
- Registry schema: [schema/registry.json](./schema/registry.json)
- Plugin manifest schema: [schema/plugin.json](./schema/plugin.json)
- maw-js plugin command source: <https://github.com/Soul-Brews-Studio/maw-js/tree/alpha/src/commands/plugins/plugin>
