"""Build the compact IDS dataset used by the federated poisoning sandbox
(Piece 1) and the evade-my-detector piece (Piece 2).

Source dataset: NSL-KDD (Tavallaee, Bagheri, Lu, Ghorbani, "A Detailed
Analysis of the KDD CUP 99 Data Set," IEEE CISDA 2009). The official host
(unb.ca/cic/datasets/nsl.html) currently returns "this dataset is no longer
available"; its stated terms permit redistribution and mirroring in any
form provided both the dataset and the paper above are cited, so this
script pulls from a long-standing community mirror instead. See
DATASET_LICENSE below and the citation note written into every output file.

This script only ever touches your local machine at build time. Nothing it
downloads or computes here ships to the browser; only the small JSON files
it writes under src/content/data/ids/ are committed and read by the site.

Usage:
    pip install -r scripts/requirements.txt
    python3 scripts/prepare_ids_dataset.py
"""

from __future__ import annotations

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

TRAIN_URL = "https://raw.githubusercontent.com/defcom17/NSL_KDD/master/KDDTrain%2B.txt"
TEST_URL = "https://raw.githubusercontent.com/defcom17/NSL_KDD/master/KDDTest%2B.txt"

DATASET_LICENSE = (
    "NSL-KDD dataset. Cite: M. Tavallaee, E. Bagheri, W. Lu, A. Ghorbani, "
    "'A Detailed Analysis of the KDD CUP 99 Data Set,' 2nd IEEE Symposium "
    "on Computational Intelligence for Security and Defense Applications "
    "(CISDA), 2009. Original terms (unb.ca/cic/datasets/nsl.html) permit "
    "redistribution and mirroring in any form with this citation retained."
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

# Feature key -> (column source, human label, unit, description, locked, locked_reason)
FEATURE_SPECS = [
    ("duration", "Duration", "seconds",
     "Length of the connection.", False, None),
    ("src_bytes", "Bytes sent", "bytes",
     "Bytes sent from source to destination.", False, None),
    ("dst_bytes", "Bytes received", "bytes",
     "Bytes sent back from destination to source.", False, None),
    ("count", "Host connections (2s)", "connections",
     "Connections to the same destination host in the last 2 seconds.", False, None),
    ("srv_count", "Service connections (2s)", "connections",
     "Connections to the same destination service in the last 2 seconds.", False, None),
    ("serror_rate", "SYN error rate", "fraction",
     "Fraction of recent connections to this host that were half-open (SYN error).", False, None),
    ("same_srv_rate", "Same-service rate", "fraction",
     "Fraction of recent connections to this host using the same service.", False, None),
    ("dst_host_count", "Host connections (window)", "connections",
     "Connections to this destination host over a longer historical window.", False, None),
    ("dst_host_srv_count", "Host+service connections (window)", "connections",
     "Connections to this destination host and service over that same window.", False, None),
    ("flag_is_error", "Error/incomplete flag", "boolean",
     "Whether the connection ended in an error or incomplete state instead of closing cleanly.",
     True, "This falls out of the attack mechanism itself, for example a half-open scan produces it by construction. Changing it usually means abandoning the technique, not evading it."),
    ("logged_in", "Authenticated", "boolean",
     "Whether the connection successfully authenticated.",
     True, "Faking a successful login means actually compromising valid credentials, which is a separate problem from anything else in this flow record."),
    ("is_priv_port", "Recognized service", "boolean",
     "Whether the destination is a recognized, well-known service rather than an unclassified high port.",
     True, "This identifies which service is being targeted. Changing it means attacking a different service, not evading detection on this one."),
]
FEATURE_KEYS = [f[0] for f in FEATURE_SPECS]

N_CLIENTS = 8

# Deliberately oversample rare categories (real NSL-KDD train proportions are
# roughly dos 78%, probe 20%, r2l 1.7%, u2r 0.1%) so every category has
# enough rows for a client to be visibly skewed toward it. See
# balanced_sample() for how the rare ones (u2r especially) get topped up.
POOL_BENIGN = 1000
POOL_CATEGORY_TARGETS = {"dos": 500, "probe": 250, "r2l": 150, "u2r": 100}
TEST_BENIGN = 300
TEST_CATEGORY_TARGETS = {"dos": 150, "probe": 75, "r2l": 50, "u2r": 25}


def download(url: str, dest: Path) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if not dest.exists():
        print(f"Downloading {url}")
        urllib.request.urlretrieve(url, dest)
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


def balanced_sample(df: pd.DataFrame, n_benign: int, category_targets: dict) -> pd.DataFrame:
    """Sample n_benign benign rows plus a stratified malicious set.

    NSL-KDD is extremely imbalanced across attack categories (u2r is 52 of
    ~58k malicious training rows), so a plain random malicious sample would
    almost never include u2r or r2l at all. We instead target an explicit
    count per category, sampling with replacement only when the category
    doesn't have enough unique rows to cover the target (this only happens
    for u2r; every duplicated row is an identical, real record, not a
    synthetic one).
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


def build_partitions(df: pd.DataFrame) -> dict:
    n = len(df)
    all_idx = RNG.permutation(n)
    iid = [chunk.tolist() for chunk in np.array_split(all_idx, N_CLIENTS)]

    benign_idx = RNG.permutation(df.index[df["binary_label"] == 0].to_numpy())
    benign_chunks = [c.tolist() for c in np.array_split(benign_idx, N_CLIENTS)]

    category_groups = {
        "dos": [0, 1], "probe": [2, 3], "r2l": [4, 5], "u2r": [6, 7],
    }
    non_iid = [list(chunk) for chunk in benign_chunks]
    leftover = []
    for category, client_ids in category_groups.items():
        cat_idx = RNG.permutation(df.index[df["category"] == category].to_numpy())
        if len(cat_idx) == 0:
            continue
        for i, chunk in enumerate(np.array_split(cat_idx, len(client_ids))):
            non_iid[client_ids[i]].extend(chunk.tolist())
    # anything not "dos/probe/r2l/u2r" among malicious rows (shouldn't happen
    # given ATTACK_CATEGORY covers all labels, kept as a safety net)
    assigned = {i for client in non_iid for i in client}
    for idx in df.index[df["binary_label"] == 1]:
        if idx not in assigned:
            leftover.append(idx)
    for i, idx in enumerate(leftover):
        non_iid[i % N_CLIENTS].append(idx)

    return {"iid": iid, "nonIid": [sorted(c) for c in non_iid]}


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
    train_raw = load_split(download(TRAIN_URL, CACHE_DIR / "KDDTrain+.txt"))
    test_raw = load_split(download(TEST_URL, CACHE_DIR / "KDDTest+.txt"))

    pool = balanced_sample(train_raw, POOL_BENIGN, POOL_CATEGORY_TARGETS)
    test = balanced_sample(test_raw, TEST_BENIGN, TEST_CATEGORY_TARGETS)

    X_pool_raw = pool[FEATURE_KEYS].to_numpy(dtype=float)
    y_pool = pool["binary_label"].to_numpy(dtype=float)
    X_test_raw = test[FEATURE_KEYS].to_numpy(dtype=float)
    y_test = test["binary_label"].to_numpy(dtype=float)

    mean = X_pool_raw.mean(axis=0)
    std = X_pool_raw.std(axis=0)
    std[std < 1e-8] = 1e-8
    benign_mean = X_pool_raw[y_pool == 0].mean(axis=0)

    X_pool_std = (X_pool_raw - mean) / std
    X_test_std = (X_test_raw - mean) / std

    w, b = train_logistic_regression(X_pool_std, y_pool)
    test_pred = (sigmoid(X_test_std @ w + b) >= 0.5).astype(int)
    test_accuracy = float((test_pred == y_test).mean())
    print(f"Offline logistic regression test accuracy: {test_accuracy:.3f}")

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
                "locked": locked,
                "lockedReason": reason,
            }
            for key, label, unit, desc, locked, reason in FEATURE_SPECS
        ],
    }
    (OUT_DIR / "feature-schema.json").write_text(json.dumps(feature_schema, indent=2))

    scaler = {
        "license": DATASET_LICENSE,
        "featureOrder": FEATURE_KEYS,
        "mean": [round(float(v), 4) for v in mean],
        "std": [round(float(v), 4) for v in std],
        "benignMean": [round(float(v), 4) for v in benign_mean],
    }
    (OUT_DIR / "scaler.json").write_text(json.dumps(scaler, indent=2))

    model = {
        "license": DATASET_LICENSE,
        "kind": "logistic_regression",
        "trainedOn": "standardized features, see scaler.json",
        "featureOrder": FEATURE_KEYS,
        "weights": [round(float(v), 6) for v in w],
        "bias": round(float(b), 6),
        "testAccuracy": round(test_accuracy, 4),
        "testSetSize": int(len(test)),
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

    partitions = build_partitions(pool)
    partitions["license"] = DATASET_LICENSE
    (OUT_DIR / "clients.json").write_text(json.dumps(partitions))

    # Piece 2 needs flows the detector currently flags with real confidence,
    # otherwise there is nothing for the visitor to evade. Some malicious
    # test rows are novel attack variants NSL-KDD deliberately withholds
    # from training (see module docstring), which this linear model already
    # misses at 0.5, those are exactly the wrong picks here even though
    # they're genuinely malicious.
    CONFIDENCE_FLOOR = 0.6
    sample_rows = []
    malicious_test = test[test["binary_label"] == 1].copy()
    probs = sigmoid((((malicious_test[FEATURE_KEYS].to_numpy(dtype=float) - mean) / std) @ w) + b)
    malicious_test["model_probability"] = probs

    for category in ["dos", "probe", "r2l", "u2r"]:
        candidates = malicious_test[
            (malicious_test["category"] == category)
            & (malicious_test["model_probability"] >= CONFIDENCE_FLOOR)
        ]
        if len(candidates) == 0:
            candidates = malicious_test[malicious_test["category"] == category]
        if len(candidates) == 0:
            continue
        row = candidates.sample(n=1, random_state=SEED).iloc[0]
        x = row[FEATURE_KEYS].to_numpy(dtype=float)
        sample_rows.append({
            "attackType": row["label"],
            "category": category,
            "features": {k: round(float(v), 3) for k, v in zip(FEATURE_KEYS, x)},
            "modelProbability": round(float(row["model_probability"]), 4),
        })
    samples = {"license": DATASET_LICENSE, "samples": sample_rows}
    (OUT_DIR / "samples.json").write_text(json.dumps(samples, indent=2))

    for name in ["feature-schema.json", "scaler.json", "model.json",
                 "training-pool.json", "test-set.json", "clients.json", "samples.json"]:
        size_kb = (OUT_DIR / name).stat().st_size / 1024
        print(f"{name}: {size_kb:.1f} KB")


if __name__ == "__main__":
    main()
