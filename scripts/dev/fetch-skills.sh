#!/usr/bin/env bash
# Fetch the pinned external skill packs into runtime/skills/external/
# (git-ignored; bundled into the installer as Tauri resources).
# Runs locally and in CI so the skills never live in this repo's git history.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

# ---- Anthropic document skills: docx / pdf / pptx / xlsx ----
# From the anthropics/skills repo. Correction (Phase 12 Session 1,
# verified directly against the upstream repo): the repo has no root
# LICENSE file, and the docx/pdf/pptx/xlsx skill directories each carry
# their own LICENSE.txt reading "(c) Anthropic, PBC. All rights
# reserved... governed by your agreement with Anthropic regarding use of
# Anthropic's services" — proprietary, NOT Apache-2.0 as a prior comment
# here incorrectly claimed. Kept by the copy below (each skill directory's
# LICENSE.txt travels with it) so that notice stays attached to the
# content it governs. This directory (runtime/skills/external/) is
# NOT in tauri.conf.json's bundle.resources — it is not embedded in any
# built/signed FormuLab installer today. If that ever changes, this
# license must be re-evaluated first.
ANTHROPIC_SKILLS_COMMIT="${ANTHROPIC_SKILLS_COMMIT:-9d2f1ae187231d8199c64b5b762e1bdf2244733d}"
OFFICE_SKILLS="docx pdf pptx xlsx"
OFFICE_OUT="$ROOT/runtime/skills/external/anthropic-skills"

URL="https://github.com/anthropics/skills/archive/${ANTHROPIC_SKILLS_COMMIT}.tar.gz"
TMP="$(mktemp -d)"
echo "Downloading $URL"
curl -fsSL "$URL" -o "$TMP/skills.tar.gz"
tar -xzf "$TMP/skills.tar.gz" -C "$TMP"

SRC="$(find "$TMP" -maxdepth 1 -type d -name 'skills-*' | head -1)"
rm -rf "$OFFICE_OUT"
mkdir -p "$OFFICE_OUT"
for s in $OFFICE_SKILLS; do
  [ -f "$SRC/skills/$s/SKILL.md" ] || { echo "No skills/$s/SKILL.md in archive" >&2; exit 1; }
  cp -R "$SRC/skills/$s" "$OFFICE_OUT/$s"
done
echo "$ANTHROPIC_SKILLS_COMMIT" > "$OFFICE_OUT/.commit"
rm -rf "$TMP"

echo "Placed anthropic-skills@${ANTHROPIC_SKILLS_COMMIT:0:7} in $OFFICE_OUT:"
ls "$OFFICE_OUT"
