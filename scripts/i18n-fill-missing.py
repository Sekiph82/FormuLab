"""Mirror new English keys into the other locales.

The locale parity test requires every locale to carry the same key set. The new
Formula Builder, Materials and Cost surfaces ship with their English source
strings in every locale: an untranslated string a user can read beats a missing
key, and beats a machine translation of safety-relevant text ("recorded verbatim
from the SDS") that nobody who speaks the language has checked.

This is recorded as a known limitation in docs/IMPLEMENTATION_STATUS.md. Running
this script again after translating is harmless: it only fills keys that are
absent, and never overwrites an existing translation.
"""
import json
import os

BASE = "apps/desktop/src/i18n/locales"
SOURCE = "en"
NAMESPACES = ["session.json", "nav.json"]


def fill_missing(src, dst):
    """Copy keys present in src but absent in dst. Existing values are kept."""
    added = 0
    for k, v in src.items():
        if isinstance(v, dict):
            if not isinstance(dst.get(k), dict):
                dst[k] = {}
            added += fill_missing(v, dst[k])
        elif k not in dst:
            dst[k] = v
            added += 1
    return added


locales = [d for d in os.listdir(BASE) if d != SOURCE and os.path.isdir(os.path.join(BASE, d))]
total = 0
for ns in NAMESPACES:
    src = json.load(open(os.path.join(BASE, SOURCE, ns), encoding="utf-8"))
    for loc in locales:
        path = os.path.join(BASE, loc, ns)
        if not os.path.exists(path):
            continue
        dst = json.load(open(path, encoding="utf-8"))
        n = fill_missing(src, dst)
        total += n
        with open(path, "w", encoding="utf-8") as f:
            json.dump(dst, f, indent=2, ensure_ascii=False)
            f.write("\n")
        if n:
            print(f"{loc}/{ns}: +{n}")

print(f"filled {total} key(s) across {len(locales)} locale(s)")
