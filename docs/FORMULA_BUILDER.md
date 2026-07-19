# Formula Builder

The daily working surface. Open it from **Formulas** in the sidebar.

The agent thread proposes candidates from the literature; the builder is where a
chemist works on the formula itself. They are deliberately separate objects: a
chat transcript is a conversation, and a formula is a record that a batch sheet,
a cost snapshot and an audit will point at years later.

## Workflow

1. **Formulas → New project.** Name it, optionally set a project code (the
   handle a batch record and an ERP row will use — otherwise one is generated).
2. **Pick a product family.** This is the load-bearing choice. It determines
   which packaging SKUs are offered, which structural template applies, and
   whether the product needs preservation and an INCI declaration.
3. **Pick the packaging SKUs** the formula is meant to fill. Pack size does not
   fork the chemistry — a 250 ml bottle and an 8 ml sachet share one formula and
   cost different amounts.
4. **Set market, batch size, brief and target claims.** Claims are aspirational
   until tested; nothing here verifies them.
5. **Edit in the grid**, then **Save version** with a change reason.

The project persists to `data/formulations/<id>/` in the project folder. Nothing
lives only in React state.

## The grid

Core columns are always shown: phase, line number, material, function,
percentage, active-matter %, batch quantity, evidence origin.

Optional columns (**Columns** menu): material code, trade name, INCI name,
supplier, unit price, line cost, notes.

| Action | How |
| --- | --- |
| Add line | Toolbar, or `Ctrl/Cmd+Enter` |
| Remove / duplicate | Row buttons |
| Reorder | Drag the handle |
| Move between phases | Edit the phase cell; any name works, not just A/B/C |
| Navigate | Tab across, arrow keys up and down |
| Paste from Excel | Paste a block into the material or percentage cell |
| Search / filter | Toolbar filter box |
| Pick from library | Magnifier beside the material name |
| Undo / redo | `Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z` |
| Save version | `Ctrl/Cmd+S` |

**Pasting** maps three tab-separated columns onto material name, percentage and
active-matter %, and appends rows if the block is longer than the formula.
Formulators keep their working formulas in Excel; retyping thirty lines to get
one in is the thing that would stop them using the builder.

**Undo** coalesces edits within ~600 ms, so typing `12.5` into a cell is one
step rather than four.

**Picking a library material** copies across only what the library actually
knows. An absent active-matter figure stays absent — it never becomes a
confident 100%.

## Water q.s.

`q.s.` ("quantum satis") is the line that absorbs whatever is left to reach 100%.

It is an **explicit property of the line**, never inferred from the material
name. A formula can hold water that is not the q.s. line (a fixed phase-A
charge), and a q.s. line that is not water (a solvent base, a slurry carrier).

- Toggle q.s. with the checkbox in the last column.
- Setting it on one line clears it on the others; the split between two q.s.
  lines would be ambiguous. Two are allowed only through an explicit override,
  and produce a warning.
- Click the resolved figure to **freeze** the line at that percentage. It then
  stops moving when other lines change.
- Toggling q.s. back on makes it float again.
- Freezing never writes a negative number. If the other ingredients already
  exceed 100%, that stays a validation error (`QS_OVERFLOW`) rather than
  becoming a negative weight someone could be asked to weigh out.

## Calculations

All of it comes from `packages/shared/src/engine/formula.ts`. The UI renders; it
does not calculate. See [PRECISION_POLICY.md](PRECISION_POLICY.md).

- Total %, remaining %, q.s. resolution
- Batch quantity per line at any batch size
- Active-matter contribution per line and in total — 12% of a 70%-active SLES
  contributes 8.4% active matter, not 12%. Conflating the two is how an
  under-active product ships.
- Functional-group totals, raw and active
- Line and total raw-material cost when prices are present

## Validation

Four levels:

| Level | Meaning |
| --- | --- |
| `info` | Worth knowing |
| `warning` | A chemist should look; the formula is usable |
| `error` | Arithmetically or structurally wrong |
| `blocking` | Not coherent enough to cost, export or version |

`blocking` exists because some problems make every derived number meaningless —
a duplicated line id, or a percentage that is not a number. Those short-circuit
before the arithmetic runs, so the screen does not show totals computed over
nonsense.

Findings carry the line and the field, so the list links straight to the cell.

Codes: `TOTAL_NOT_100`, `QS_OVERFLOW`, `QS_ABOVE_100`, `MULTIPLE_QS_LINES`,
`NEGATIVE_PERCENT`, `DUPLICATE_MATERIAL`, `DUPLICATE_LINE_ID`,
`INVALID_DECIMAL`, `MISSING_MATERIAL`, `INVALID_PHASE`,
`TECHNICAL_MAX_EXCEEDED`, `INVALID_BATCH_SIZE`, `INVALID_CURRENCY`,
`NO_PRESERVATIVE`, `NO_PH_ADJUSTER`, `NO_WATER`, `MISSING_INCI`,
`UNKNOWN_ACTIVE_MATTER`, `EMPTY_FORMULA`.

## Functional-group summary

Chips under the grid show each group's raw and active percentage.

When a member of the group has no declared active matter, the group is marked
**incomplete** and the unknown share is named. The figure shown is a lower
bound. It is not rounded up to a guess, and the missing data is not counted as
zero — a specification limit signed off against a number nobody measured is the
outcome this is designed to prevent.

## Templates

Each of the 55 Kenya product families has a structural template
(`packages/shared/src/catalog/templates.ts`) covering 35 distinct product types.

A template lists the functional **roles** a product of this type needs, the
usual phase order, the specification fields it is released against, and the
hazard topics worth raising in review.

Templates carry **no percentages**. A number in a template reads as a
recommendation, and FormuLab has no verified source for "the right level" of
anything. Levels come from the literature pipeline, a supplier's technical data
sheet, or a chemist — each carrying its own provenance.

The template drives validation: whether the product needs a preservative, a pH
adjuster, and an INCI declaration.

## Ingredient declaration

`buildDeclaration` (`packages/shared/src/engine/declaration.ts`) orders the
ingredients by descending percentage, ties broken alphabetically so regenerating
it always produces byte-identical output — artwork approval depends on diffing
that string.

The `≤1%` tail threshold is configurable, since it is a regulatory input rather
than a chemical fact.

The output is always marked **draft**. FormuLab has no verified Kenyan or EAC
labelling ruleset, so it does not claim label compliance. A missing INCI name is
surfaced as a warning and the internal name is used as a visible placeholder —
never an invented INCI name, which would produce a label that looks
authoritative and is wrong.

A human can override the generated text; the override is stored with who made
it, when, and why.

## Known limitations

- The regulatory, compatibility, safety, DOE and stability modules are **not
  implemented**. The template warning topics are prompts to think, not checks.
- Column widths are fixed; resizing is not implemented.
- The new builder, materials and costing screens ship with English strings in
  all locales pending translation.
