# attach-ssh

Explicit SSH + tmux attach command and Tier 3 strategy for `maw attach`.

The host-side Tier 3 dispatcher that used to call `attach:strategy` plugins is
currently dormant, so this plugin also exposes a direct CLI command:

```sh
maw plugin install attach-ssh
maw plugin enable attach-ssh
maw attach-ssh m5:54-mawjs --dry-run
maw attach-ssh m5 54-mawjs
maw attach-ssh m5:54-mawjs --ssh-alias m5.wg
```

`--ssh-alias` defaults to the node name. The remote command is:

```sh
ssh -tt <ssh-alias> "tmux attach-session -t '<session>'"
```

The default export still carries `default.execute(target)` for future hosts that
load the plugin as an `attach:strategy` with `strategy.tier: 3`.
