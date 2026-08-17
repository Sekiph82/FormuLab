"""Phase 14 Session 6 — the unified decision-trace schema.

**One real gap Sessions 1-5 left open**: every WINNING decision (which
ingredient filled a role, at what concentration, from which evidence) was
already persisted somewhere real — `ingredient_origins`, `comparable_stats`,
`mass_balance`, `manufacturing.steps`, `quality_gate`, `evidence_links`,
`score`. What was never persisted anywhere was the REJECTED side of a
decision: which OTHER candidates were considered for a role and why they
did not win. This module exists to close exactly that gap — not to
duplicate the winning-side data those other structures already own.

**Deliberately narrow scope, to avoid duplicating the same truth in
multiple conflicting files** (this session's own explicit instruction).
`traceability.json`/`card["trace_events"]` hold ONLY genuinely new
information: role-level candidate selection/rejection events. Everything
else a decision trace would want to show (why this concentration, why
this process step, why this safety/regulatory finding) already has its
own real, structured, authoritative home on the card — a trace event that
needed one of those facts REFERENCES it by id/key rather than copying it.

**No fake confidence.** `TraceEvent.status` is a real, already-computed
status string when one exists (e.g. a `ConcentrationResolution.source_type`,
a `formula_state`); it is never invented for this module's own sake.
"""

from __future__ import annotations

import re
import time
from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional

SCHEMA_VERSION = 1

# Decision types this module actually emits. Named and closed, not an
# open-ended free-text field — every event's `decision_type` is one of
# these.
DECISION_INGREDIENT_SELECTED = "ingredient_selected"
DECISION_INGREDIENT_REJECTED = "ingredient_rejected"
DECISION_ROLE_COVERAGE = "role_coverage"


@dataclass(frozen=True)
class TraceEvent:
    decision_id: str
    formula_version_id: str
    decision_type: str
    subject_type: str
    """`"ingredient"` or `"role"`."""
    subject: str
    """Ingredient display name, or the role name for a `role_coverage` event."""
    result: str
    """`"selected"` | `"rejected"` | `"covered"` | `"missing"`."""
    rationale: str
    source_type: str
    """The same origin vocabulary `provenance.IngredientOrigin`/`engine.py`
    already use — `scientific_evidence`/`supplier_data`/
    `deterministic_rule`/`user_required`/`"" ` (unknown/not applicable)."""
    source_ids: List[str] = field(default_factory=list)
    rule_id: str = ""
    evidence_ids: List[str] = field(default_factory=list)
    input_values: Dict[str, Any] = field(default_factory=dict)
    output_values: Dict[str, Any] = field(default_factory=dict)
    status: str = ""
    validation_required: bool = False
    schema_version: int = SCHEMA_VERSION

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


_id_counters: Dict[str, int] = {}


def _next_id(version_id: str) -> str:
    n = _id_counters.get(version_id, 0) + 1
    _id_counters[version_id] = n
    return f"trace-{version_id}-{n:04d}"


def reset_id_counter(version_id: str) -> None:
    """Called once per version at the start of trace collection so
    `decision_id`s are stable/deterministic within one run rather than
    accumulating across an entire process's lifetime (relevant for tests
    that build several formulas in one process)."""
    _id_counters[version_id] = 0


def selected_event(
    version_id: str, role: str, ingredient: str, origins: List[str],
    source_ids: List[str], evidence_ids: List[str], rationale: str,
    input_values: Optional[Dict[str, Any]] = None, output_values: Optional[Dict[str, Any]] = None,
    status: str = "", validation_required: bool = False,
) -> TraceEvent:
    return TraceEvent(
        decision_id=_next_id(version_id), formula_version_id=version_id,
        decision_type=DECISION_INGREDIENT_SELECTED, subject_type="ingredient", subject=ingredient,
        result="selected", rationale=rationale,
        source_type=(origins[0] if origins else ""), source_ids=source_ids,
        evidence_ids=evidence_ids, input_values=input_values or {}, output_values=output_values or {},
        status=status, validation_required=validation_required,
    )


def rejected_event(
    version_id: str, role: str, ingredient: str, rationale: str,
    source_type: str = "", rule_id: str = "", input_values: Optional[Dict[str, Any]] = None,
) -> TraceEvent:
    return TraceEvent(
        decision_id=_next_id(version_id), formula_version_id=version_id,
        decision_type=DECISION_INGREDIENT_REJECTED, subject_type="ingredient", subject=ingredient,
        result="rejected", rationale=rationale, source_type=source_type, rule_id=rule_id,
        input_values=input_values or {},
    )


def role_coverage_event(
    version_id: str, role: str, level: str, covered: bool, rationale: str,
) -> TraceEvent:
    return TraceEvent(
        decision_id=_next_id(version_id), formula_version_id=version_id,
        decision_type=DECISION_ROLE_COVERAGE, subject_type="role", subject=role,
        result="covered" if covered else "missing", rationale=rationale,
        source_type="deterministic_rule", output_values={"level": level},
    )
