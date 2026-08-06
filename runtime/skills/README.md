# runtime/skills

Scientific skills, layered:

```text
skills/
  core/      # self-authored skills specific to this app (traceability-review;
             # other dirs are roadmap placeholders until they get a SKILL.md)
  external/  # third-party skill packs, fetched by script — git-ignored
  user/      # user-installed / custom skills (live in the runtime workspace)
```

Core skills are bundled as the `skills-core/` app resource; directories
without a `SKILL.md` are skipped. `external/` is fetched by CI/dev scripts
but not currently deployed into the running app — see the correction
below.

## Third-party document skills: docx / pdf / pptx / xlsx (fetched, not bundled)

The docx / pdf / pptx / xlsx skills come from Anthropic's
[anthropics/skills](https://github.com/anthropics/skills) repo. `fetch-skills.sh`
pins them into `external/anthropic-skills/` (each skill directory keeps its
own `LICENSE.txt` — read it before relying on this content; it is not
Apache-2.0, see the fetch script's own note). Bump via
`ANTHROPIC_SKILLS_COMMIT` in `fetch-skills.sh`.

**Correction (Phase 12 Session 2, verified directly against current
source)**: this directory is fetched by CI but is **not** currently
deployed anywhere — `tauri.conf.json`'s `bundle.resources` does not
include `runtime/skills/external/`, and no `runtime.rs`/
`deploy_bundled_skills` function (previously described here) exists in
the current Rust source. A prior scientific skills pack that WAS wired
through that mechanism has been removed entirely (see PROGRESS.md/git
history for when the mechanism itself was removed) — this doc is
corrected to describe what actually ships today, not what shipped in an
earlier build.

## Third-party skills

Do **not** enable large third-party collections (e.g. ~148 K-Dense skills) by
default. Use curated install, enable by domain, and always surface each skill's
license, dependencies, and risk.

Each skill directory must contain a `SKILL.md`.
