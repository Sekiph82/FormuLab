# Phase 6 Final Closure — Live Verification Script

Run this in the live app (already launched from the rebuilt exe — shortcut
`C:\Users\sekip\Desktop\FormuLab.lnk` confirmed pointing to it, SHA-256
`76ee2528c271118f40a357ac7d74fb7422e8186d9f80db6b7ed4d97f5332e6f1`). Use
`Ctrl+K` (command palette) to jump to any workspace by typing its name if
the sidebar item isn't visible.

Prefix every test record with `TEST-` and leave it in place afterward —
do not delete anything you create. If you hit a real bug, stop and note
the exact error message; don't work around it.

## 0. Confirm the label is honest

Open **Data Exchange** (Ctrl+K → "Data Exchange"). Confirm the Template
Library shows all 24 cards. Pick any 2-3 at random and expand "Field
documentation" to confirm it renders real columns, not a placeholder.

## 1. Stability Protocols + Stability Results (the two brand-new handlers)

1. Open **Stability**. Create a new study `TEST-STAB-001` for any
   existing formula version, with at least 1 storage condition, 1 time
   point, and 1 required test attached (through the normal Stability UI
   — this is the "real parent" the import can never fabricate).
2. Go to **Data Exchange** → Stability Protocols card. Download the
   blank CSV, the blank Excel, and the example-filled CSV.
3. Build a small CSV with 1-2 rows: `protocol_code=TEST-STAB-001`,
   a `condition_code` that ISN'T one of the seed codes shown in the
   column documentation (to trigger a real validation error), plus a
   valid row.
4. Upload it. Confirm preview shows the bad row failing with a message
   naming the unrecognized condition code, and the good row previews as
   create/update.
5. Download the error report. Confirm it names the exact bad value.
6. Fix the file (use a real seed condition code) and re-upload. Commit.
7. Go back into the Stability workspace and confirm the study's
   protocol now really includes that condition/time-point/test
   combination — not just an import-history log entry.
8. In Data Exchange, export **current data** for Stability Protocols and
   confirm the row you just committed appears.
9. Re-import the exact same file. Confirm every row now shows
   `unchanged` in preview, and commit does not create a duplicate.
10. Repeat steps 2-9 for **Stability Results**, generating at least one
    real sample first (through Stability's own "generate pull points" /
    sample flow), then importing a result against it. Leave one row's
    `numeric_value` blank — confirm after commit that no result record
    with a zero/fabricated value was created, and the time point simply
    shows as not-yet-tested.
11. Check **Import History** for both — confirm both jobs show real row
    counts, not "completed" with 0/0 (that bug is what this closure
    fixed — if you see it, that's a real regression, stop and report
    it).

## 2. Dossier Evidence Metadata (the idempotency/linking fix)

1. Open **Dossiers**. Create dossier `TEST-DOSS-001` for any formula, add
   a manual requirement `TEST-REQ-001` (through the Dossiers UI, or via
   the Dossier Requirements Data Exchange template first — either is a
   legitimate "real parent").
2. In Data Exchange → Dossier Evidence Metadata: build a file with
   `dossier_code=TEST-DOSS-001`, `requirement_code=TEST-REQ-001`,
   `evidence_code=TEST-EVID-001`, plus one row naming a
   `requirement_code` that doesn't exist — confirm that row fails
   preview with a clear "No requirement" message.
3. Commit the valid row. Open the Dossiers workspace, find dossier
   `TEST-DOSS-001`, and confirm the evidence now shows up **linked to**
   requirement `TEST-REQ-001` with a "proposed" link status awaiting
   your review (not silently missing, not auto-accepted).
4. Accept the proposed link as a human, through the Dossiers UI. Confirm
   it becomes "accepted" and counts toward the requirement.
5. Re-import the exact same evidence row (same `evidence_code`) with a
   changed `title`. Confirm the existing evidence item is **updated**,
   not duplicated, and no second link is created.
6. Export current data for Dossier Evidence Metadata; confirm the row
   round-trips with the same `evidence_code`/`requirement_code`.

## 3. Label Content

1. Open **Claims & Labels**. Create label `TEST-LBL-001` for any formula
   version (through the real workspace).
2. Import a Label Content row for it (`label_code=TEST-LBL-001`,
   `label_revision=1`, `block_type=product_name`, etc.). Commit.
3. Confirm the block appears on the label in the Claims & Labels
   workspace, status draft.
4. Re-import the same natural key — confirm it creates a new content
   revision (this template is intentionally append-only, so this should
   NOT be flagged as a bug), and the old revision is still visible in
   history, not overwritten.
5. Export current data; confirm the row appears (note: the `panel`
   column will be blank in the export — that's a known, documented
   limitation, not a bug to report).

## 4. DOE Factors and Responses

1. Open **Design of Experiments**. Create study `TEST-DOE-001`.
2. Import one factor row and one response row via the DOE Factors and
   Responses template. Commit.
3. Confirm both appear in the DOE workspace for that study.
4. Export current data; confirm both rows appear with the correct
   `record_type`.
5. Re-import the same factor with a changed `name` — confirm it updates
   in place (not a duplicate).

## 5. Costing Assumptions (structured fields, not notes)

1. Import a Costing Assumptions row with
   `freight_percent=3`, `duty_percent=0`, `tax_percent=16`,
   `target_margin_percent=30` for a new or existing profile code.
   Commit.
2. Open the factory/costing profile editor in the app and confirm those
   four values show up as real structured fields — NOT inside a notes
   text blob.
3. Run (or re-run) a cost calculation against a formula using that
   profile. Confirm the landed cost reflects the imported freight/duty/
   tax percentages when the formula's materials don't already specify
   their own per-shipment freight/duty/tax.

## 6. Restart persistence

Close FormuLab entirely and relaunch it (via the desktop shortcut only).
Confirm every `TEST-` record created above (the stability study/results,
the dossier/evidence/link, the label content, the DOE study/factor/
response, the costing profile) is all still present, unchanged.

## What to report back

For each of the 6 sections above: pass / fail, and for any fail the
exact error text or screenshot. I'll fold the results into the Phase 6
closure log and give a final, honest completion status.
