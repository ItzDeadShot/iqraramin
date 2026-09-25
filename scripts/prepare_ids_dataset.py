"""Build the compact IDS dataset used by the federated poisoning sandbox
(Piece 1) and the evade-my-detector piece (Piece 2).

Source dataset: NSL-KDD (Tavallaee, Bagheri, Lu, Ghorbani, "A Detailed
Analysis of the KDD CUP 99 Data Set," IEEE CISDA 2009). The official host
(unb.ca/cic/datasets/nsl.html) currently returns "this dataset is no longer
available"; its stated terms permit redistribution and mirroring in any
form provided both the dataset and the paper above are cited, so this
script pulls from a long-standing community mirror instead (see MIRROR_*
below) and pins that mirror's file hashes so a silently changed or
corrupted download fails loudly instead of quietly producing different
numbers. See DATASET_LICENSE below and the citation note written into
every output file.

This script only ever touches your local machine at build time. Nothing it
downloads or computes here ships to the browser; only the small JSON files
it writes under src/content/data/ids/ are committed and read by the site.

Usage:
    pip install -r scripts/requirements.txt
    python3 scripts/prepare_ids_dataset.py
"""

from __future__ import annotations

import hashlib
import json
import urllib.request
from pathlib import Path

import numpy as np
import pandas as pd

SEED = 42
RNG = np.random.default_rng(SEED)

SCRIPT_DIR = Path(__file__).resolve().parent
CACHE_DIR = SCRIPT_DIR / ".cache"
OUT_DIR = SCRIPT_DIR.parent / "src" / "content" / "data" / "ids"

# Pinned mirror + hashes: the official UNB/CIC host currently returns "this
# dataset is no longer available" (see module docstring), so we depend on
# this community mirror instead. Pinning the SHA-256 means a change to the
# mirror's file contents (accidental or not) fails the build loudly rather
# than silently shifting every downstream number.
MIRROR_FILES = {
    "KDDTrain+.txt": {
        "url": "https://raw.githubusercontent.com/defcom17/NSL_KDD/master/KDDTrain%2B.txt",
        "sha256": "1b86d2f957b33082081bba410fe129b475efebcc13c9014c3f447c8271aadf95",
    },
    "KDDTest+.txt": {
        "url": "https://raw.githubusercontent.com/defcom17/NSL_KDD/master/KDDTest%2B.txt",
        "sha256": "fa46b0935342616aa83b7c2578db355b6a7aaabbc492248172c7a1e8b7ab8f84",
    },
}

DATASET_LICENSE = (
    "NSL-KDD dataset. Cite: M. Tavallaee, E. Bagheri, W. Lu, A. Ghorbani, "
    "'A Detailed Analysis of the KDD CUP 99 Data Set,' 2nd IEEE Symposium "
    "on Computational Intelligence for Security and Defense Applications "
    "(CISDA), 2009. Original terms (unb.ca/cic/datasets/nsl.html) permit "
    "redistribution and mirroring in any form with this citation retained. "
    "Mirror: https://github.com/defcom17/NSL_KDD"
)

COLUMNS = [
    "duration", "protocol_type", "service", "flag", "src_bytes", "dst_bytes",
    "land", "wrong_fragment", "urgent", "hot", "num_failed_logins",
    "logged_in", "num_compromised", "root_shell", "su_attempted", "num_root",
    "num_file_creations", "num_shells", "num_access_files",
    "num_outbound_cmds", "is_host_login", "is_guest_login", "count",
    "srv_count", "serror_rate", "srv_serror_rate", "rerror_rate",
    "srv_rerror_rate", "same_srv_rate", "diff_srv_rate", "srv_diff_host_rate",
    "dst_host_count", "dst_host_srv_count", "dst_host_same_srv_rate",
    "dst_host_diff_srv_rate", "dst_host_same_src_port_rate",
    "dst_host_srv_diff_host_rate", "dst_host_serror_rate",
    "dst_host_srv_serror_rate", "dst_host_rerror_rate",
    "dst_host_srv_rerror_rate", "label", "difficulty",
]

ATTACK_CATEGORY = {
    "normal": "normal",
    # DoS
    "back": "dos", "land": "dos", "neptune": "dos", "pod": "dos",
    "smurf": "dos", "teardrop": "dos", "mailbomb": "dos", "apache2": "dos",
    "processtable": "dos", "udpstorm": "dos", "worm": "dos",
    # Probe
    "satan": "probe", "ipsweep": "probe", "nmap": "probe",
    "portsweep": "probe", "mscan": "probe", "saint": "probe",
    # R2L
    "ftp_write": "r2l", "guess_passwd": "r2l", "imap": "r2l",
    "multihop": "r2l", "phf": "r2l", "spy": "r2l", "warezclient": "r2l",
    "warezmaster": "r2l", "sendmail": "r2l", "named": "r2l",
    "snmpgetattack": "r2l", "snmpguess": "r2l", "xlock": "r2l",
    "xsnoop": "r2l", "httptunnel": "r2l",
    # U2R
    "buffer_overflow": "u2r", "loadmodule": "u2r", "perl": "u2r",
    "rootkit": "u2r", "ps": "u2r", "sqlattack": "u2r", "xterm": "u2r",
}
CATEGORY_CODE = {"normal": 0, "dos": 1, "probe": 2, "r2l": 3, "u2r": 4, "unknown": 5}

# Feature key -> (human label, unit, description, transform)
# transform is applied before standardizing (see transform_features()); it
# does not change the raw-unit min/max below, which are for slider display.
FEATURE_SPECS = [
    ("duration", "Duration", "seconds",
     "Length of the connection.", "log1p"),
    ("src_bytes", "Bytes sent", "bytes",
     "Bytes sent from source to destination.", "log1p"),
    ("dst_bytes", "Bytes received", "bytes",
     "Bytes sent back from destination to source.", "log1p"),
    ("count", "Host connections (2s)", "connections",
     "Connections to the same destination host in the last 2 seconds.", "none"),
    ("srv_count", "Service connections (2s)", "connections",
     "Connections to the same destination service in the last 2 seconds.", "none"),
    ("serror_rate", "SYN error rate", "fraction",
     "Fraction of recent connections to this host that were half-open (SYN error).", "none"),
    ("same_srv_rate", "Same-service rate", "fraction",
     "Fraction of recent connections to this host using the same service.", "none"),
    ("dst_host_count", "Host connections (window)", "connections",
     "Connections to this destination host over a longer historical window.", "none"),
    ("dst_host_srv_count", "Host+service connections (window)", "connections",
     "Connections to this destination host and service over that same window.", "none"),
    ("flag_is_error", "Error/incomplete flag", "boolean",
     "Whether the connection ended in an error or incomplete state instead of closing cleanly.", "none"),
    ("logged_in", "Authenticated", "boolean",
     "Whether the connection successfully authenticated.", "none"),
    ("is_priv_port", "Recognized service", "boolean",
     "Whether the destination is a recognized, well-known service rather than an unclassified high port.", "none"),
]
FEATURE_KEYS = [f[0] for f in FEATURE_SPECS]
FEATURE_TRANSFORM = {f[0]: f[4] for f in FEATURE_SPECS}

# --- Per-sample, attack-aware locks for Piece 2 -----------------------
#
# Whether a feature is realistically adjustable depends on which attack the
# sample is. These two tables replace a single global "locked" set:
# STRUCTURAL_LOCKS always apply (independent of attack type); CATEGORY_LOCKS
# adds attack-specific ones (e.g. a SYN flood's own error rate is what
# defines it as a SYN flood, so it isn't something you can dial down and
# still have the same attack). Every unlocked feature gets a short
# plain-language "cost" note about what changing it costs the attacker.
STRUCTURAL_LOCKS = {
    "logged_in": "Faking a successful login means actually compromising valid credentials, a separate problem from anything else in this flow record.",
    "is_priv_port": "This identifies which service is being targeted. Changing it means attacking a different service, not evading detection on this one.",
}

CATEGORY_LOCKS = {
    "dos": {
        "flag_is_error": "A SYN flood's whole mechanism is half-open connections; turning this off means it stops being this attack.",
        "serror_rate": "Same signature: this rate sitting near 1.0 is what makes it a SYN flood in the first place.",
    },
    "probe": {},
    "r2l": {},
    "u2r": {},
}

CATEGORY_COSTS = {
    "dos": {
        "duration": "Shorter connections finish faster and move less traffic per attempt.",
        "src_bytes": "Smaller packets reduce bandwidth footprint but need more connections for the same effect.",
        "dst_bytes": "A real SYN flood rarely gets a response anyway; this is already close to zero.",
        "count": "Fewer connections per window looks less like a flood, but is a weaker attack.",
        "srv_count": "Same tradeoff as connection count, scoped to one service.",
        "same_srv_rate": "Spreading across services looks less targeted, but dilutes the flood.",
        "dst_host_count": "Fewer hosts touched per window reduces blast radius and visibility.",
        "dst_host_srv_count": "Same tradeoff, scoped to host and service together.",
    },
    "probe": {
        "duration": "Longer pauses between probes look more like normal traffic, but the scan takes longer.",
        "src_bytes": "Probe packets are already minimal; there is little room to change this.",
        "dst_bytes": "Mostly set by what the target sends back, outside the attacker's control.",
        "count": "Fewer connections per window means a slower scan; it takes longer to map the target.",
        "srv_count": "Same tradeoff, scoped to one service.",
        "serror_rate": "Drops naturally as scan speed drops, or by switching from a SYN scan to a full-connect scan: noisier per probe, but statistically quieter here.",
        "flag_is_error": "Looking like completed connections instead of half-open ones means switching scan technique entirely.",
        "same_srv_rate": "Spreading probes across services looks broader, less like targeting one thing.",
        "dst_host_count": "Fewer hosts probed per window is a slower, quieter sweep.",
        "dst_host_srv_count": "Same tradeoff, scoped to host and service together.",
    },
    "r2l": {
        "duration": "A slower attempt blends in with a legitimate slow connection.",
        "src_bytes": "Login payloads are already small; little room to change this without breaking the protocol.",
        "dst_bytes": "Mostly set by the server's response, outside the attacker's control.",
        "count": "Fewer attempts per window looks less like guessing, but is slower to succeed.",
        "srv_count": "Same tradeoff, scoped to this service.",
        "serror_rate": "Already low since this attack completes a normal handshake; little to change here.",
        "flag_is_error": "This attack already completes a clean connection; there is nothing to hide here.",
        "same_srv_rate": "Repeated attempts naturally concentrate on one service.",
        "dst_host_count": "Fewer hosts targeted per window is quieter, but narrower.",
        "dst_host_srv_count": "Same tradeoff, scoped to host and service together.",
    },
    "u2r": {
        "duration": "This activity happens locally after access; network-level duration carries a weak signal either way.",
        "src_bytes": "Weak signal for this attack type; the exploit runs locally, not over the wire.",
        "dst_bytes": "Same, weak signal here since the exploit runs locally.",
        "count": "Weak signal; this attack rarely shows up as unusual connection volume.",
        "srv_count": "Weak signal, same reason.",
        "serror_rate": "Weak signal; this attack does not depend on connection errors.",
        "flag_is_error": "Weak signal here; this attack already completes a normal connection.",
        "same_srv_rate": "Weak signal for this attack type.",
        "dst_host_count": "Weak signal for this attack type.",
        "dst_host_srv_count": "Weak signal for this attack type.",
    },
}

N_CLIENTS = 8

# Deliberately oversample rare categories (real NSL-KDD train proportions are
# roughly dos 78%, probe 20%, r2l 1.7%, u2r 0.1%) so every category has
# enough rows for a client to be visibly skewed toward it. See
# balanced_sample() for how the rare ones (u2r especially) get topped up.
POOL_BENIGN = 1000
POOL_CATEGORY_TARGETS = {"dos": 500, "probe": 250, "r2l": 150, "u2r": 100}
TEST_BENIGN = 300
TEST_CATEGORY_TARGETS = {"dos": 150, "probe": 75, "r2l": 50, "u2r": 25}

# Non-IID clients: every client keeps the same benign share as the IID
# scheme (1000 benign / 8 = 125 each) but only a bounded, per-category
# malicious share, so every client stays majority-benign while still being
# clearly skewed toward one attack category. 125 benign : 50 malicious is
# ~71% benign. All 4 categories have at least 100 pool rows (2 clients x 50)
# without needing to resample with replacement.
NONIID_MALICIOUS_PER_CLIENT = 50

SAMPLE_CONFIDENCE_FLOOR = 0.6


def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def download(name: str) -> Path:
    spec = MIRROR_FILES[name]
    dest = CACHE_DIR / name
    dest.parent.mkdir(parents=True, exist_ok=True)
    if not dest.exists():
        print(f"Downloading {spec['url']}")
        urllib.request.urlretrieve(spec["url"], dest)

    actual = sha256_of(dest)
    if actual != spec["sha256"]:
        raise RuntimeError(
            f"SHA-256 mismatch for {name}: expected {spec['sha256']}, got "
            f"{actual}. The mirror content may have changed; delete "
            f"{dest} to re-download, then verify before updating the "
            f"pinned hash in MIRROR_FILES."
        )
    return dest


def load_split(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path, names=COLUMNS, header=None)

    unmapped = sorted(set(df["label"]) - set(ATTACK_CATEGORY))
    if unmapped:
        raise ValueError(f"Unmapped attack labels in {path.name}: {unmapped}")

    df["category"] = df["label"].map(ATTACK_CATEGORY)
    df["binary_label"] = (df["label"] != "normal").astype(int)
    df["flag_is_error"] = (df["flag"] != "SF").astype(int)
    df["is_priv_port"] = (~df["service"].isin(["private", "other"])).astype(int)
    return df


def transform_features(X_raw: np.ndarray) -> np.ndarray:
    X = X_raw.copy()
    for i, key in enumerate(FEATURE_KEYS):
        if FEATURE_TRANSFORM[key] == "log1p":
            X[:, i] = np.log1p(X[:, i])
    return X


def balanced_sample(df: pd.DataFrame, n_benign: int, category_targets: dict) -> pd.DataFrame:
    """Sample n_benign benign rows plus a stratified malicious set.

    NSL-KDD is extremely imbalanced across attack categories (u2r is 52 of
    ~58k malicious training rows), so a plain random malicious sample would
    almost never include u2r or r2l at all. We instead target an explicit
    count per category, sampling with replacement only when the category
    doesn't have enough unique rows to cover the target (this only happens
    for u2r in the training pool; every duplicated row is an identical,
    real record, not a synthetic one).
    """
    benign = df[df["binary_label"] == 0]
    benign_sample = benign.sample(n=min(n_benign, len(benign)), random_state=SEED)

    malicious_parts = []
    for category, target in category_targets.items():
        available = df[df["category"] == category]
        if len(available) == 0:
            continue
        replace = target > len(available)
        malicious_parts.append(
            available.sample(n=target, replace=replace, random_state=SEED)
        )
    malicious_sample = pd.concat(malicious_parts)

    combined = pd.concat([benign_sample, malicious_sample])
    return combined.sample(frac=1, random_state=SEED).reset_index(drop=True)


def build_partitions(df: pd.DataFrame) -> tuple[dict, list[dict]]:
    n = len(df)
    all_idx = RNG.permutation(n)
    iid = [chunk.tolist() for chunk in np.array_split(all_idx, N_CLIENTS)]

    benign_idx = RNG.permutation(df.index[df["binary_label"] == 0].to_numpy())
    benign_chunks = [c.tolist() for c in np.array_split(benign_idx, N_CLIENTS)]

    category_groups = {
        "dos": [0, 1], "probe": [2, 3], "r2l": [4, 5], "u2r": [6, 7],
    }
    non_iid = [list(chunk) for chunk in benign_chunks]
    for category, client_ids in category_groups.items():
        cat_idx = df.index[df["category"] == category].to_numpy()
        needed = NONIID_MALICIOUS_PER_CLIENT * len(client_ids)
        if len(cat_idx) < needed:
            raise ValueError(
                f"Non-IID partition needs {needed} '{category}' rows but "
                f"the pool only has {len(cat_idx)}; lower "
                f"NONIID_MALICIOUS_PER_CLIENT or raise that category's "
                f"POOL_CATEGORY_TARGETS."
            )
        cat_idx = RNG.permutation(cat_idx)[:needed]
        for i, chunk in enumerate(np.array_split(cat_idx, len(client_ids))):
            non_iid[client_ids[i]].extend(chunk.tolist())

    report = []
    for i, idxs in enumerate(non_iid):
        labels = df.loc[idxs, "binary_label"]
        n_benign_c = int((labels == 0).sum())
        n_mal_c = int((labels == 1).sum())
        report.append({
            "client": i,
            "n": len(idxs),
            "benign": n_benign_c,
            "malicious": n_mal_c,
            "benignRatio": round(n_benign_c / len(idxs), 3),
        })

    return {"iid": iid, "nonIid": [sorted(c) for c in non_iid]}, report


def sigmoid(z: np.ndarray) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-z))


def train_logistic_regression(X: np.ndarray, y: np.ndarray, iters=3000, lr=0.5, l2=1e-3):
    n, d = X.shape
    w = np.zeros(d)
    b = 0.0
    for _ in range(iters):
        p = sigmoid(X @ w + b)
        grad_w = X.T @ (p - y) / n + l2 * w
        grad_b = float(np.mean(p - y))
        w -= lr * grad_w
        b -= lr * grad_b
    return w, b


def main():
    train_raw = load_split(download("KDDTrain+.txt"))
    test_raw = load_split(download("KDDTest+.txt"))
    print("Hash-verified NSL-KDD train/test files against pinned SHA-256.")

    pool = balanced_sample(train_raw, POOL_BENIGN, POOL_CATEGORY_TARGETS)
    test = balanced_sample(test_raw, TEST_BENIGN, TEST_CATEGORY_TARGETS)

    # Scaler is fit on the training pool ONLY; the test set is transformed
    # with those same parameters and never used to compute them.
    X_pool_raw = pool[FEATURE_KEYS].to_numpy(dtype=float)
    y_pool = pool["binary_label"].to_numpy(dtype=float)
    X_test_raw = test[FEATURE_KEYS].to_numpy(dtype=float)
    y_test = test["binary_label"].to_numpy(dtype=float)

    X_pool_t = transform_features(X_pool_raw)
    X_test_t = transform_features(X_test_raw)

    mean = X_pool_t.mean(axis=0)
    std = X_pool_t.std(axis=0)
    std[std < 1e-8] = 1e-8
    benign_mean = X_pool_t[y_pool == 0].mean(axis=0)

    X_pool_std = (X_pool_t - mean) / std
    X_test_std = (X_test_t - mean) / std

    w, b = train_logistic_regression(X_pool_std, y_pool)
    test_pred = (sigmoid(X_test_std @ w + b) >= 0.5).astype(int)
    test_accuracy = float((test_pred == y_test).mean())
    test_benign_n = int((y_test == 0).sum())
    test_malicious_n = int((y_test == 1).sum())
    print(f"Offline logistic regression test accuracy: {test_accuracy:.3f}")
    print(f"Test set class balance: {test_benign_n} benign / {test_malicious_n} malicious "
          f"(n={len(test)}, fit on training pool only)")

    combined_for_range = pd.concat([train_raw, test_raw])[FEATURE_KEYS]
    p01 = combined_for_range.quantile(0.01)
    p99 = combined_for_range.quantile(0.99)

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    feature_schema = {
        "license": DATASET_LICENSE,
        "features": [
            {
                "key": key,
                "label": label,
                "unit": unit,
                "description": desc,
                "min": round(float(p01[key]), 3),
                "max": round(float(p99[key]), 3),
                "transform": transform,
            }
            for key, label, unit, desc, transform in FEATURE_SPECS
        ],
    }
    (OUT_DIR / "feature-schema.json").write_text(json.dumps(feature_schema, indent=2))

    scaler = {
        "license": DATASET_LICENSE,
        "note": "mean/std/benignMean are in TRANSFORMED space (see feature-schema.json's transform field); apply that transform to a raw value before standardizing with these.",
        "featureOrder": FEATURE_KEYS,
        "mean": [round(float(v), 4) for v in mean],
        "std": [round(float(v), 4) for v in std],
        "benignMean": [round(float(v), 4) for v in benign_mean],
    }
    (OUT_DIR / "scaler.json").write_text(json.dumps(scaler, indent=2))

    model = {
        "license": DATASET_LICENSE,
        "kind": "logistic_regression",
        "trainedOn": "standardized, transformed features, see scaler.json",
        "featureOrder": FEATURE_KEYS,
        "weights": [round(float(v), 6) for v in w],
        "bias": round(float(b), 6),
        "testAccuracy": round(test_accuracy, 4),
        "testSetSize": int(len(test)),
        "testBenign": test_benign_n,
        "testMalicious": test_malicious_n,
    }
    (OUT_DIR / "model.json").write_text(json.dumps(model, indent=2))

    def rows_for(df_subset: pd.DataFrame) -> list:
        cols = df_subset[FEATURE_KEYS].to_numpy(dtype=float)
        rows = []
        for i in range(len(df_subset)):
            row = [round(float(v), 3) for v in cols[i]]
            row.append(int(df_subset["binary_label"].iloc[i]))
            row.append(CATEGORY_CODE[df_subset["category"].iloc[i]])
            rows.append(row)
        return rows

    training_pool = {
        "license": DATASET_LICENSE,
        "columns": FEATURE_KEYS + ["label", "categoryCode"],
        "categoryCodes": CATEGORY_CODE,
        "rows": rows_for(pool),
    }
    (OUT_DIR / "training-pool.json").write_text(json.dumps(training_pool))

    test_set = {
        "license": DATASET_LICENSE,
        "columns": FEATURE_KEYS + ["label", "categoryCode"],
        "categoryCodes": CATEGORY_CODE,
        "rows": rows_for(test),
    }
    (OUT_DIR / "test-set.json").write_text(json.dumps(test_set))

    partitions, client_report = build_partitions(pool)
    partitions["license"] = DATASET_LICENSE
    (OUT_DIR / "clients.json").write_text(json.dumps(partitions))

    print("Non-IID client class balance:")
    for row in client_report:
        print(f"  client {row['client']}: n={row['n']} benign={row['benign']} "
              f"malicious={row['malicious']} ({row['benignRatio']*100:.1f}% benign)")

    # Piece 2 needs flows the detector currently flags with real confidence,
    # otherwise there is nothing for the visitor to evade. Some malicious
    # test rows are novel attack variants NSL-KDD deliberately withholds
    # from training (see module docstring), which this linear model already
    # misses at 0.5; those are exactly the wrong picks here even though
    # they're genuinely malicious. The dos sample is chosen as the single
    # highest-confidence candidate to guarantee at least one easy,
    # high-confidence anchor; the rest are randomly chosen among qualifying
    # candidates so the set spans a difficulty range.
    sample_rows = []
    malicious_test = test[test["binary_label"] == 1].copy()
    mt_raw = malicious_test[FEATURE_KEYS].to_numpy(dtype=float)
    mt_t = transform_features(mt_raw)
    probs = sigmoid((((mt_t - mean) / std) @ w) + b)
    malicious_test["model_probability"] = probs

    for category in ["dos", "probe", "r2l", "u2r"]:
        candidates = malicious_test[
            (malicious_test["category"] == category)
            & (malicious_test["model_probability"] >= SAMPLE_CONFIDENCE_FLOOR)
        ]
        if len(candidates) == 0:
            candidates = malicious_test[malicious_test["category"] == category]
        if len(candidates) == 0:
            continue
        if category == "dos":
            row = candidates.loc[candidates["model_probability"].idxmax()]
        else:
            row = candidates.sample(n=1, random_state=SEED).iloc[0]

        x = row[FEATURE_KEYS].to_numpy(dtype=float)
        locked = dict(STRUCTURAL_LOCKS)
        locked.update(CATEGORY_LOCKS[category])
        feature_notes = {}
        for key in FEATURE_KEYS:
            if key in locked:
                feature_notes[key] = {"locked": True, "reason": locked[key]}
            else:
                feature_notes[key] = {
                    "locked": False,
                    "cost": CATEGORY_COSTS[category].get(key, "Adjusting this has no specific documented cost for this attack type."),
                }

        sample_rows.append({
            "attackType": row["label"],
            "category": category,
            "features": {k: round(float(v), 3) for k, v in zip(FEATURE_KEYS, x)},
            "modelProbability": round(float(row["model_probability"]), 4),
            "featureNotes": feature_notes,
        })

    # Sanity check: confirm no two samples are the same underlying row, and
    # the u2r sample in particular isn't a resampled duplicate (the test
    # split's u2r rows are drawn without replacement, unlike the training
    # pool's, but this makes that explicit instead of assumed).
    seen = set()
    for s in sample_rows:
        key = tuple(s["features"].values())
        if key in seen:
            raise RuntimeError(f"Duplicate sample row detected for {s['attackType']}")
        seen.add(key)
    print(f"Confirmed {len(sample_rows)} distinct sample rows (no duplicates).")

    samples = {"license": DATASET_LICENSE, "samples": sample_rows}
    (OUT_DIR / "samples.json").write_text(json.dumps(samples, indent=2))

    print("Sample confidences:")
    for s in sample_rows:
        print(f"  {s['attackType']} ({s['category']}): p(malicious)={s['modelProbability']}")

    for name in ["feature-schema.json", "scaler.json", "model.json",
                 "training-pool.json", "test-set.json", "clients.json", "samples.json"]:
        size_kb = (OUT_DIR / name).stat().st_size / 1024
        print(f"{name}: {size_kb:.1f} KB")


if __name__ == "__main__":
    main()
