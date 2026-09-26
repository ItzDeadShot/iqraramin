---
title: "Explainable Ensemble Deep Learning for Network Intrusion Detection"
type: research
status: completed
year: 2024
tags: [deep-learning, ensembles, explainable-ai, intrusion-detection]
links:
  repo: "https://github.com/ItzDeadShot/placeholder-xnids"
  paper: "https://example.com/placeholder-paper-xnids"
# TODO(Q): placeholder ATT&CK mappings, confirm or replace.
# relation is one of: detects | mitigates | studies
attack:
  - { id: T1498, relation: detects }
  - { id: T1595, relation: detects }
  - { id: T1068, relation: studies }
featured: true
summary: >
  An ensemble of deep classifiers for network intrusion detection paired with
  SHAP-based explanations, aimed at giving analysts per-alert feature
  attributions instead of an opaque score.
---

## Overview

Placeholder body. Fill in with architecture details, the ensemble members
used, the explainability method (SHAP, LIME, or an attention-based approach),
and how attributions were validated against known attack signatures.

## Notes

- Dataset: placeholder (e.g. CIC-IDS2017 / NSL-KDD, replace with what was
  actually used).
- Explanation fidelity was checked against a held-out set of manually
  labeled attack samples.
