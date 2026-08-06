# runtime/opencode-profile

The FormuLab **OpenCode profile** — the config + skills the app ships and applies
to the bundled OpenCode runtime (not a user's global OpenCode).

The desktop app runs OpenCode with an app-private config/data dir (isolated via
`XDG_CONFIG_HOME`/`XDG_DATA_HOME`), so nothing here touches `~/.config/opencode`.

## Contents (planned)

```text
opencode.json      # base config applied to the bundled runtime (providers, defaults)
skills/            # First-party scientific skills (Markdown, agentskills.io format)
agents/            # optional custom agents
```

## How it maps at runtime

- The user's provider key (from Settings) is merged into the app-private `opencode.json`
  by the `configure_opencode` Rust command; the sidecar is restarted to pick it up.
- Skills are NOT shipped from here: first-party skills live in
  `runtime/skills/core/` (bundled as the `skills-core/` app resource).
  Third-party skill packs fetched into `runtime/skills/external/` by
  `scripts/dev/fetch-skills.sh` are not currently deployed into any
  running profile (verified against current source, Phase 12 Session 2)
  — see `runtime/skills/README.md`'s own correction note. The app's
  Skills page lists OpenCode's real `GET /api/skill?directory=<workspace>`.

Keep this bundle versioned with the app; it must not carry the user's own keys or sessions.
