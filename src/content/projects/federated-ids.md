---
title: "Federated Learning for Cross-Silo Intrusion Detection"
type: research
status: active
year: 2026
tags: [federated-learning, intrusion-detection, privacy]
links:
  paper: "https://example.com/placeholder-paper-federated-ids"
# TODO(Q): placeholder ATT&CK mappings, confirm or replace.
# relation is one of: detects | mitigates | studies
attack:
  - { id: T1498, relation: detects }
  - { id: T1046, relation: detects }
  - { id: T1110, relation: detects }
featured: true
summary: >
  A robust aggregation scheme for training intrusion detection models across
  organizational boundaries without centralizing raw traffic data, evaluated
  against poisoning and non-IID client distributions.
---

## Overview

This is placeholder body content for the federated intrusion detection
project. Replace with the real writeup: motivation, method, dataset,
results, and links to the paper or preprint once available.

## Notes

- Threat model considered: a subset of malicious or compromised clients
  submitting poisoned updates.
- Baselines: FedAvg, trimmed-mean, and coordinate-wise median aggregation.
