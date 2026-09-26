"""Reduce a pinned MITRE ATT&CK Enterprise release to the compact JSON the
/coverage page and the content schemas need: tactics (in matrix order) and
active techniques / sub-techniques (IDs, names, tactic membership).

Source: mitre-attack/attack-stix-data on GitHub (the official STIX 2.1
distribution). The release and its SHA-256 are pinned below, so the build
never silently moves to a different ATT&CK version; bump both together on
purpose. Revoked and deprecated objects are dropped, which is what makes a
retired technique ID fail the content schema instead of quietly rendering.

Standard library only. Offline, run by hand; the site only reads the output.

Usage:
    python3 scripts/prepare_attack_data.py
"""

from __future__ import annotations

import hashlib
import json
import urllib.request
from pathlib import Path

ATTACK_VERSION = "19.2"
SOURCE_URL = (
    "https://raw.githubusercontent.com/mitre-attack/attack-stix-data/master/"
    f"enterprise-attack/enterprise-attack-{ATTACK_VERSION}.json"
)
SOURCE_SHA256 = "dc1639caa5501d720e280cf1cbd8fbe009884a0c9b3e6e9ed9d0c25166c3d8f4"

# Required by the ATT&CK Terms of Use
# (https://attack.mitre.org/resources/legal-and-branding/terms-of-use/).
ATTRIBUTION = (
    "© 2026 The MITRE Corporation. This work is reproduced and distributed "
    "with the permission of The MITRE Corporation."
)
TRADEMARK = (
    "MITRE ATT&CK and ATT&CK are registered trademarks of The MITRE "
    "Corporation. This site is not affiliated with or endorsed by MITRE."
)

SCRIPT_DIR = Path(__file__).resolve().parent
CACHE = SCRIPT_DIR / ".cache" / f"enterprise-attack-{ATTACK_VERSION}.json"
OUT = SCRIPT_DIR.parent / "src" / "content" / "data" / "attack" / "enterprise.json"


def fetch() -> dict:
    CACHE.parent.mkdir(parents=True, exist_ok=True)
    if not CACHE.exists():
        print(f"Downloading {SOURCE_URL}")
        urllib.request.urlretrieve(SOURCE_URL, CACHE)
    digest = hashlib.sha256(CACHE.read_bytes()).hexdigest()
    if digest != SOURCE_SHA256:
        raise RuntimeError(
            f"SHA-256 mismatch for {CACHE.name}: expected {SOURCE_SHA256}, got {digest}. "
            "Delete the cached file to re-download, and only update the pinned hash "
            "after checking why it changed."
        )
    return json.loads(CACHE.read_text())


def attack_id(obj: dict) -> str | None:
    for ref in obj.get("external_references", []):
        if ref.get("source_name") == "mitre-attack":
            return ref.get("external_id")
    return None


def active(obj: dict) -> bool:
    return not obj.get("revoked") and not obj.get("x_mitre_deprecated")


def main() -> None:
    bundle = fetch()
    objects = bundle["objects"]
    by_stix_id = {o["id"]: o for o in objects}

    collection = next(o for o in objects if o["type"] == "x-mitre-collection")
    if collection.get("x_mitre_version") != ATTACK_VERSION:
        raise RuntimeError(f"Bundle says version {collection.get('x_mitre_version')}, expected {ATTACK_VERSION}")

    matrix = next(o for o in objects if o["type"] == "x-mitre-matrix" and active(o))
    tactics = []
    for ref in matrix["tactic_refs"]:
        t = by_stix_id[ref]
        tactics.append({"id": attack_id(t), "shortname": t["x_mitre_shortname"], "name": t["name"]})
    tactic_names = {t["shortname"] for t in tactics}

    techniques = []
    subtechniques = []
    for o in objects:
        if o["type"] != "attack-pattern" or not active(o):
            continue
        tid = attack_id(o)
        if not tid:
            continue
        if o.get("x_mitre_is_subtechnique"):
            subtechniques.append([tid, o["name"]])
            continue
        phases = [
            p["phase_name"]
            for p in o.get("kill_chain_phases", [])
            if p.get("kill_chain_name") == "mitre-attack" and p["phase_name"] in tactic_names
        ]
        techniques.append([tid, o["name"], sorted(set(phases), key=[t["shortname"] for t in tactics].index)])

    techniques.sort(key=lambda t: t[0])
    subtechniques.sort(key=lambda t: t[0])
    parent_ids = {t[0] for t in techniques}
    orphans = [s[0] for s in subtechniques if s[0].split(".")[0] not in parent_ids]
    if orphans:
        raise RuntimeError(f"Sub-techniques without an active parent: {orphans[:5]}")

    out = {
        "domain": "enterprise-attack",
        "version": ATTACK_VERSION,
        "modified": collection.get("modified"),
        "source": SOURCE_URL,
        "attribution": ATTRIBUTION,
        "trademark": TRADEMARK,
        "tactics": tactics,
        "techniques": techniques,
        "subtechniques": subtechniques,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, separators=(",", ":"), ensure_ascii=False) + "\n")
    print(
        f"ATT&CK Enterprise {ATTACK_VERSION}: {len(tactics)} tactics, {len(techniques)} techniques, "
        f"{len(subtechniques)} sub-techniques -> {OUT.relative_to(SCRIPT_DIR.parent)} "
        f"({OUT.stat().st_size / 1024:.1f} KB)"
    )


if __name__ == "__main__":
    main()
