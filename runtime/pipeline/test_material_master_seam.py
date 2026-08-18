"""FormuLab v1 (FVL-03.001) — audit-proving tests for the LEGACY
`materials.py` CSV-import path's material seam. See
`docs/FVL03_PLATFORM_INTEGRATION_ARCHITECTURE.md`'s own FVL-03.001
section for the full narrative these tests back with real assertions.

FVL-03.002 closed the generation-path seam for the CANONICAL Material
Master (`master_materials_adapter.py`, proven in
`test_master_materials_adapter.py` and `test_pipeline.py`'s
`test_supplier_material_contributes_a_real_candidate`) — these tests below
still document the separate, still-live, still-unrelated LEGACY CSV-import
path (`materials.py::parse_materials()`, Settings -> General), which
FVL-03.002 deliberately did not touch. They remain accurate as written for
that path; only `test_supplier_candidate_identity_is_text_normalized_
name_not_a_stable_code` was extended (not rewritten) to also prove the new
`material_code` identity now available for a canonical-shaped row."""

import os
import tempfile
import unittest

import engine
import materials as materials_mod
import pipeline
from test_pipeline import seed_library_with_concentrations


class CurrentMaterialSeamTests(unittest.TestCase):
    def test_csv_import_never_produces_a_recommended_range_field(self):
        """The real CSV-import path (`parse_materials`) has no header
        alias for `recommended_min_pct`/`recommended_max_pct` — the exact
        field names `engine.resolve_concentration()`'s own Tier 4 looks
        for (`engine.py`'s own comment: "materials.py's schema has no
        such field today"). Proven here against the REAL parser, not a
        hand-constructed dict."""
        csv_text = (
            "Name,INCI,Price,Currency,Function\n"
            "Chelator X,Chelator X,3.10,USD,chelator\n"
        )
        rows, warnings = materials_mod.parse_materials(csv_text)
        self.assertEqual(len(rows), 1)
        self.assertNotIn("recommended_min_pct", rows[0])
        self.assertNotIn("recommended_max_pct", rows[0])
        self.assertNotIn("technical_max_pct", rows[0])
        self.assertNotIn("code", rows[0])  # no canonical stable identity at all
        self.assertNotIn("active", rows[0])

    def test_real_csv_imported_material_never_reaches_tier_4_concentration(self):
        """A material imported through the REAL, live
        `materials.py::parse_materials()` path — not a hand-constructed
        dict — never carries `recommended_min_pct`/`recommended_max_pct`,
        so `engine.resolve_concentration()`'s own Tier 4 falls straight
        through to Tier 5 (internal engineering table) for it every time.
        `test_engine.py::test_resolves_from_supplier_recommended_range_
        when_present` proves Tier 4 ITSELF works when given the right
        keys; this test proves the real import path never supplies them,
        confirming the gap end-to-end rather than at the isolated-
        dataclass level alone."""
        csv_text = (
            "Name,INCI,Price,Currency,Function\n"
            "Chelator X,Chelator X,3.10,USD,chelator\n"
        )
        rows, _ = materials_mod.parse_materials(csv_text)
        candidate = engine.IngredientCandidate(
            key="chelator-x", display_name="Chelator X", roles=["chelator"],
            origins=[engine.ORIGIN_SUPPLIER_DATA], supplier_material=rows[0],
        )
        resolution = engine.resolve_concentration(candidate, "chelator", [], "balanced")
        self.assertNotEqual(resolution.source_type, "supplier_data")

    def test_legacy_materials_json_path_differs_from_canonical_masterdata_path(self):
        """Documents the exact, real path mismatch: Python's own
        `materials.py::store_path()` writes/reads `<dir>/materials.json`
        directly under whatever `materials_dir` it is given — proven here
        to be a DIFFERENT path shape from the canonical
        `<project_root>/data/master/materials.json` the Rust
        `masterdata.rs` store uses (that file lives one directory level
        deeper, under `master/`, not directly under `data/`)."""
        legacy_path = materials_mod.store_path("/project/data")
        self.assertEqual(legacy_path.replace("\\", "/"), "/project/data/materials.json")
        canonical_shaped_path = "/project/data/master/materials.json"
        self.assertNotEqual(legacy_path.replace("\\", "/"), canonical_shaped_path)

    def test_supplier_candidate_identity_is_text_normalized_name_not_a_stable_code(self):
        """Proves the identity mismatch on the LEGACY row shape: a supplier
        candidate's pool key comes from `normalize_ingredient_key(inci or
        name)` — a derived text key — never from a canonical
        `RawMaterial.code`-equivalent stable identity. `material_id`
        (present in the legacy row) is NOT what the pool keys on; it only
        survives as trailing provenance (`source_ids`), proven separately
        by the existing `test_supplier_material_contributes_a_real_
        candidate` in `test_pipeline.py`.

        FVL-03.002 addition (not a rewrite of the above, still true): a
        CANONICAL-shaped row (carrying `code`) additionally populates the
        new `IngredientCandidate.material_code` real-identity field,
        alongside — never instead of — the same text-key matching."""
        pool = engine.build_candidate_pool(
            {}, {"avoid": []}, [], [{
                "material_id": "totally-different-stable-id",
                "name": "Sodium Benzoate", "inci": "Sodium Benzoate",
                "price": 2.0, "currency": "USD", "function": "preservative",
            }],
        )
        self.assertIn("sodium-benzoate", pool.candidates)
        self.assertNotIn("totally-different-stable-id", pool.candidates)

        canonical_pool = engine.build_candidate_pool(
            {}, {"avoid": []}, [], [{
                "code": "RM-SB-01", "material_code": "RM-SB-01",
                "name": "Sodium Benzoate", "inci": "Sodium Benzoate",
                "function": "preservative",
            }],
        )
        self.assertIn("sodium-benzoate", canonical_pool.candidates)
        self.assertEqual(
            canonical_pool.candidates["sodium-benzoate"].material_code, "RM-SB-01",
        )


if __name__ == "__main__":
    unittest.main()
