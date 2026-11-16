"""Merge the legacy workspace (<root>/data, used until July 2026) into the active data root.

Until the data root moved to the project folder, `active-workspace.txt` and `base-workspace.txt`
pointed at `<root>/data`, so sessions, formula cards and literature from that period live under
`<root>/data/data`, `<root>/data/formulas` and `<root>/data/.FormuLab`. Settings warns that this
second folder holds real data. This script copies everything the active root lacks and never
changes a record the active root already has:

- files missing from the active root are copied;
- record lists gain only rows whose code/id is missing (existing rows, e.g. safety rules, stay);
- the formula-card index, literature index and evidence cache gain only missing entries;
- the AI request log gains only lines it lacks, kept in time order;
- the runs index gains only runs it lacks.

The legacy folder itself is left untouched. Run with --apply to write; without it, it only reports.
"""
import filecmp
import json
import os
import shutil
import sqlite3
import sys

ROOT = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith("--") else ".")
OLD = os.path.join(ROOT, "data")
APPLY = "--apply" in sys.argv
JSON_MERGED = {"data/master", "formulas/index.json", "data/literature/index.json",
               "data/literature/evidence_cache.json", "data/safety/ai_request_log.jsonl"}


def load(path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def save(path, value, indent):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(value, fh, ensure_ascii=False, indent=indent)
    os.replace(tmp, path)


def key(row):
    return row.get("code") or row.get("id")


def copy_missing(rel, report):
    src, dst = os.path.join(OLD, rel), os.path.join(ROOT, rel)
    copied = kept = 0
    for base, _, files in os.walk(src):
        for name in files:
            s = os.path.join(base, name)
            r = os.path.relpath(s, src)
            d = os.path.join(dst, r)
            if os.path.exists(d):
                kept += 0 if filecmp.cmp(s, d, shallow=False) else 1
                continue
            copied += 1
            if APPLY:
                os.makedirs(os.path.dirname(d), exist_ok=True)
                shutil.copy2(s, d)
    report[rel] = {"copied": copied, "active_version_kept": kept}


def merge_rows(src, dst, report, label):
    old, new = load(src), load(dst)
    have = {key(r) for r in new}
    extra = [r for r in old if key(r) not in have]
    report[label] = {"added": len(extra)}
    if extra and APPLY:
        save(dst, new + extra, 2)


def main():
    if not os.path.isdir(os.path.join(OLD, "data")) and not os.path.isdir(os.path.join(OLD, "formulas")):
        print(json.dumps({"legacy_workspace": "none"}))
        return
    report = {}
    for rel in ["data/sessions", "data/literature/pdfs", "data/formulations", "formulas"]:
        copy_missing(rel, report)
    legacy_master = os.path.join(OLD, "data", "master")
    for name in sorted(os.listdir(legacy_master)) if os.path.isdir(legacy_master) else []:
        dst = os.path.join(ROOT, "data", "master", name)
        if os.path.exists(dst):
            merge_rows(os.path.join(legacy_master, name), dst, report, f"data/master/{name}")
        else:
            report[f"data/master/{name}"] = {"copied": 1}
            if APPLY:
                shutil.copy2(os.path.join(legacy_master, name), dst)

    index_src, index_dst = os.path.join(OLD, "formulas", "index.json"), os.path.join(ROOT, "formulas", "index.json")
    if os.path.exists(index_src):
        old, new = load(index_src), load(index_dst)
        have = {r["file"] for r in new}
        extra = [r for r in old if r["file"] not in have]
        report["formulas/index.json"] = {"added": len(extra)}
        if extra and APPLY:
            save(index_dst, new + extra, 2)

    lit_old, lit_new = os.path.join(OLD, "data", "literature"), os.path.join(ROOT, "data", "literature")
    if os.path.exists(os.path.join(lit_old, "index.json")):
        old, new = load(os.path.join(lit_old, "index.json")), load(os.path.join(lit_new, "index.json"))
        ident = lambda p: (p.get("doi") or "").lower() or (p.get("title") or "").strip().lower()
        have = {ident(p) for p in new}
        extra = []
        for paper in old:
            if ident(paper) not in have:
                have.add(ident(paper))
                extra.append(paper)
        report["data/literature/index.json"] = {"added": len(extra)}
        if extra and APPLY:
            save(os.path.join(lit_new, "index.json"), new + extra, 2)
    if os.path.exists(os.path.join(lit_old, "evidence_cache.json")):
        old, new = load(os.path.join(lit_old, "evidence_cache.json")), load(os.path.join(lit_new, "evidence_cache.json"))
        extra = {k: v for k, v in old.items() if k not in new}
        report["data/literature/evidence_cache.json"] = {"added": len(extra)}
        if extra and APPLY:
            save(os.path.join(lit_new, "evidence_cache.json"), {**new, **extra}, 2)

    log_old, log_new = os.path.join(OLD, "data", "safety", "ai_request_log.jsonl"), os.path.join(ROOT, "data", "safety", "ai_request_log.jsonl")
    if os.path.exists(log_old):
        with open(log_new, encoding="utf-8") as fh:
            new = [line for line in fh.read().splitlines() if line.strip()]
        with open(log_old, encoding="utf-8") as fh:
            extra = [line for line in fh.read().splitlines() if line.strip() and line not in set(new)]
        report["data/safety/ai_request_log.jsonl"] = {"added": len(extra)}
        if extra and APPLY:
            lines = sorted(new + extra, key=lambda line: json.loads(line).get("at", ""))
            with open(log_new + ".tmp", "w", encoding="utf-8") as fh:
                fh.write("\n".join(lines) + "\n")
            os.replace(log_new + ".tmp", log_new)

    runs_old, runs_new = os.path.join(OLD, ".FormuLab", "runs.db"), os.path.join(ROOT, ".FormuLab", "runs.db")
    if os.path.exists(runs_old) and os.path.exists(runs_new):
        db = sqlite3.connect(runs_new)
        db.execute("ATTACH DATABASE ? AS legacy", (runs_old,))
        cols = [c[1] for c in db.execute("PRAGMA main.table_info(runs)")]
        pk = [c[1] for c in db.execute("PRAGMA main.table_info(runs)") if c[5]] or cols[:1]
        missing = db.execute(f"SELECT COUNT(*) FROM legacy.runs l WHERE NOT EXISTS (SELECT 1 FROM main.runs m WHERE "
                             + " AND ".join(f"m.{c} = l.{c}" for c in pk) + ")").fetchone()[0]
        report[".FormuLab/runs.db"] = {"added": missing}
        if missing and APPLY:
            db.execute(f"INSERT INTO main.runs ({','.join(cols)}) SELECT {','.join(cols)} FROM legacy.runs l WHERE NOT EXISTS "
                       "(SELECT 1 FROM main.runs m WHERE " + " AND ".join(f"m.{c} = l.{c}" for c in pk) + ")")
            db.commit()
        db.close()
    print(json.dumps({"applied": APPLY, **report}, indent=1))


if __name__ == "__main__":
    main()
