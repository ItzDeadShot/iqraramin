---
title: "HDSE-IDS: Heterogeneous Deep Stacked Ensemble for Intrusion Detection"
type: research
status: completed
year: 2026
tags: [deep-learning, ensembles, intrusion-detection, cross-domain]
links:
  paper: "https://doi.org/10.1080/09540091.2025.2599708"
  # TODO(Q): add `repo:` once the code is cleaned up and public.
# Mapped from the attack classes in the four evaluation datasets: DoS/DDoS
# (all four), scanning/reconnaissance (UNSW-NB15, BoT-IoT, ToN-IoT),
# password/brute force (ToN-IoT, CIC-2018), web attacks and injection
# (CIC-2018, ToN-IoT).
# TODO(Q): confirm these fit what the paper claims.
# relation is one of: detects | mitigates | studies
attack:
  - { id: T1498, relation: detects }
  - { id: T1046, relation: detects }
  - { id: T1110, relation: detects }
  - { id: T1190, relation: detects }
featured: true
summary: >
  A stacked ensemble for intrusion detection that holds up when the network
  changes. GRU, LSTM, DNN and MLP base models are each trained on a
  different NetFlow dataset and then frozen, and a meta-learner combines
  them, so every domain's decision boundary survives into the final model.
---

## Overview

Intrusion detectors trained on one network tend to fall apart on another.
HDSE-IDS tackles that cross-domain generalization gap by keeping each base
model specialized to the dataset it was trained on (frozen, so its
domain-specific decision boundary is preserved) and learning only how to
combine them.

Evaluated across four NetFlow v2 benchmarks: NF-UNSW-NB15, NF-BoT-IoT,
NF-ToN-IoT and NF-CSE-CIC-IDS2018.

Published in Connection Science (Taylor & Francis), 2026.

<!-- TODO(Q): add headline results and a link to the code once it's public. -->
