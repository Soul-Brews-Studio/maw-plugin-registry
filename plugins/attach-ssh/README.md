# attach-ssh

Tier 3 (remote-live) SSH + tmux attach strategy for `maw attach`.

When `maw attach <name>` (or `maw a <name>`) resolves to a session running on
a federation peer, the built-in attach plugin hands control off to any
installed plugin that declares the `attach:strategy` capability with
`strategy.tier: 3`. This plugin is the reference implementation — it SSHes
into the peer and runs `tmux attach -t <session>` so your terminal takes
over the remote pane. Extracted from the built-in attach (#1262) so the
SSH + tmux glue can be disabled, replaced, or evolved independently. See
[../attach](../attach) for the cascade host.

## Install

```
maw plugin install attach-ssh
```
