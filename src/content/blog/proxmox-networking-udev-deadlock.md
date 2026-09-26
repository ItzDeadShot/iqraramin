---
title: "Proxmox networking dead after every reboot: a udev deadlock caused by Dell's iDRAC Service Module"
date: 2026-09-24
tags: [proxmox, systemd, udev, dell-idrac, troubleshooting]
summary: >
  networking.service failed on every boot of a Proxmox VE 9.2 host but
  started fine by hand. The cause was a udev rule from Dell's iDRAC Service
  Module that blocked the udev queue until ifupdown2 gave up.
---

**Summary:** On a Proxmox VE 9.2 host, `networking.service` failed on every boot but started fine when run manually. The cause was not the network configuration. Dell's iDRAC Service Module (iSM) installs a udev rule that launches a SysV init script from inside a udev worker. The script takes over a minute, so the udev event queue never drains, `udevadm settle` times out after 120 seconds, `ifupdown2-pre.service` fails, and systemd skips `networking.service` as a failed dependency.

---

## Environment

| Component | Version / detail |
|---|---|
| Hypervisor | Proxmox VE 9.2.11 (Debian 13 "Trixie") |
| Kernel | 6.14.x |
| Storage | LVM-thin (not ZFS) |
| Hardware | Dell PowerEdge with iDRAC |
| Relevant package | `dcism` (iDRAC Service Module), installed from Dell's Ubuntu 24.04 "noble" repository |
| Network stack | `ifupdown2` |

Worth noting up front: iSM is not supported on Debian or Proxmox. Dell ships builds for RHEL, SLES, Ubuntu, ESXi and Windows. The Ubuntu `noble` package installs on Trixie because both ship `libcurl4t64`, but "installs" and "supported" are different things. This bug is a direct consequence of that gap.

---

## Symptoms

After every reboot:

- No network connectivity on the host.
- `systemctl status networking.service` reported the unit as failed/dead.
- Running `systemctl restart networking.service` manually **succeeded immediately**.
- `/etc/network/interfaces` was valid and unchanged.

That last pair is the important signature. **A config that fails at boot but succeeds minutes later is a timing problem, not a syntax problem.** I initially assumed a stale bridge stanza was at fault, having recently removed one. That was wrong, and the logs said so straight away.

---

## Diagnosis

### 1. Read the actual failure, not the unit state

```bash
sudo journalctl -u networking.service -b --no-pager
```

```
Sep 09 11:59:31 pve1 systemd[1]: Dependency failed for networking.service - Network initialization.
Sep 09 11:59:31 pve1 systemd[1]: networking.service: Job networking.service/start failed with result 'dependency'.
Sep 09 12:03:55 pve1 systemd[1]: Starting networking.service - Network initialization...
Sep 09 12:03:55 pve1 networking[3358]: networking: Configuring network interfaces
Sep 09 12:03:57 pve1 systemd[1]: Finished networking.service - Network initialization.
```

Two things fall out of this immediately:

- **`result 'dependency'`** means the unit never executed. systemd refused to start it because a prerequisite failed. There is no point reading `/etc/network/interfaces` at all.
- The 12:03:55 entry is the manual restart, which **finished in two seconds**. The configuration is fine.

### 2. Find the failed unit

```bash
sudo systemctl --failed
```

```
UNIT                        LOAD   ACTIVE SUB    DESCRIPTION
● systemd-udev-settle.service loaded failed failed Wait for udev To Complete Device Initialization
```

### 3. Walk the dependency

`networking.service` depends on `ifupdown2-pre.service`:

```bash
sudo journalctl -u ifupdown2-pre.service -b --no-pager
```

```
Sep 09 11:57:30 pve1 systemd[1]: Starting ifupdown2-pre.service - Helper to synchronize boot up for ifupdown...
Sep 09 11:59:31 pve1 udevadm[1439]: Timed out while waiting for udev queue to empty.
Sep 09 11:59:31 pve1 systemd[1]: ifupdown2-pre.service: Main process exited, code=exited, status=1/FAILURE
Sep 09 11:59:31 pve1 systemd[1]: Failed to start ifupdown2-pre.service
```

`ifupdown2-pre.service` runs `udevadm settle` to wait for device enumeration to finish before network configuration begins. It waited from **11:57:30 to 11:59:31** (121 seconds, precisely the default `udevadm settle` timeout), then failed.

### 4. Find what is blocking the queue

```bash
sudo journalctl -b --no-pager | grep -iE "udev|probe|timeout"
```

```
Sep 09 11:58:31 pve1 systemd-udevd[1428]: 1-4.3.3: Worker [1642] processing SEQNUM=13623 is taking a long time
Sep 09 11:58:31 pve1 (udev-worker)[1642]: 1-4.3.3: Spawned process '/etc/init.d/dcismeng start &' [1787] is taking longer than 59s to complete.
```

There it is.

---

## Root cause

The failure chain, in order:

1. During boot, the iDRAC USB NIC appears as USB device `1-4.3.3`. iSM creates this virtual interface to talk to the BMC in-band.
2. An iSM udev rule matches that device and its `RUN` directive executes `/etc/init.d/dcismeng start &`.
3. udev **waits for the worker to finish**. The iSM init script takes more than a minute to complete.
4. The udev event queue therefore never empties.
5. `udevadm settle`, called by `ifupdown2-pre.service`, times out after 120 seconds and exits non-zero.
6. `ifupdown2-pre.service` fails.
7. systemd skips `networking.service` because its dependency failed.
8. The host boots with no network.

### Why the trailing `&` doesn't help

Dell's packagers clearly anticipated a slow start and appended `&` to background the script. It doesn't work: a process spawned from a udev `RUN` rule keeps the worker slot occupied regardless of shell backgrounding, because udev tracks the worker rather than the immediate child. The queue stays blocked.

**udev `RUN` rules must be fast and non-blocking.** Starting a system service from one is a packaging error. This is well-established udev guidance and is exactly the kind of platform assumption that breaks when an RPM-lineage package is repackaged for a distribution nobody tested it on.

---

## Resolution

### Option A: remove iSM (recommended)

```bash
sudo systemctl disable dcismeng
sudo apt remove --purge dcism dcism-osc
```

Confirm the udev rule is actually gone:

```bash
ls /lib/udev/rules.d/ /etc/udev/rules.d/ | grep -iE "dcism|ism|dell"
```

This is the right call for most Proxmox hosts. Everything you genuinely manage a PowerEdge with (power control, firmware updates via Lifecycle Controller, sensor readings, virtual media, remote console) works **out-of-band and needs no OS agent at all**. What iSM adds is host OS name and IP visibility in the iDRAC dashboard, OS-level SNMP alerts, LC log replication into the system log, and SupportAssist collection.

Trading reliable boot-time networking for a populated hostname field in the iDRAC UI is a bad deal.

### Option B: keep iSM, remove the udev hook

Locate the offending rule and comment out the `RUN` line that invokes the init script:

```bash
grep -rl "dcismeng" /lib/udev/rules.d/ /etc/udev/rules.d/
```

Then let systemd start the service normally, after udev has settled:

```bash
sudo systemctl enable dcismeng
```

iSM still functions; it simply starts at a sane point in the boot sequence instead of blocking device enumeration.

**Caveat:** an iSM package update may restore the rule. Re-check after every upgrade.

### Option C: make `udevadm settle` non-fatal (not recommended)

```bash
sudo systemctl edit ifupdown2-pre.service
```

```ini
[Service]
TimeoutStartSec=300
ExecStart=
ExecStart=/bin/sh -c '/sbin/udevadm settle --timeout=240 || true'
```

The `|| true` makes the timeout non-fatal so `networking.service` starts regardless.

This treats the symptom and leaves a stuck udev queue on every boot. That has knock-on effects: most notably it interferes with PCI passthrough, where VFIO depends on clean and predictable device binding. Use it only as a temporary measure while you plan A or B.

---

## Verification

```bash
sudo reboot
```

Then:

```bash
systemctl status networking.service --no-pager
systemctl --failed
sudo journalctl -u ifupdown2-pre.service -b --no-pager
ip -br addr
```

`ifupdown2-pre.service` should complete in well under a second, and `systemctl --failed` should be empty.

---

## Side finding: a deprecated unit pulled in by ZFS

The same logs surfaced an unrelated wart:

```
Sep 09 11:57:31 pve1 udevadm[1440]: systemd-udev-settle.service is deprecated.
Please fix zfs-import-cache.service not to pull it in.
```

`systemd-udev-settle.service` is deprecated upstream, and `zfs-import-cache.service` still depends on it. On this host ZFS wasn't in use at all; Proxmox simply ships the units enabled by default.

It was not a cause of the outage, only another casualty of the same blocked queue. On a non-ZFS host it can be masked to clean up the failed-unit list:

```bash
sudo systemctl mask zfs-import-cache.service
```

Don't do this if any pool is in use.

---

## Takeaways

**`result 'dependency'` means stop reading your config.** The unit never ran. Walk the dependency chain instead: `systemctl list-dependencies <unit> --all` and `systemctl --failed` will get you there in two commands.

**"Fails at boot, works manually" is a timing signature.** Configuration errors fail consistently. Something that succeeds once the system is idle is waiting on something that isn't ready yet.

**Read the timestamps.** The 121-second gap between start and failure matched a documented default exactly. That single observation identified the mechanism before the cause was known.

**Vendor agents on unsupported distributions carry real costs.** iSM on Proxmox isn't merely "unsupported in principle": it ships a udev rule that actively breaks boot on a systemd/ifupdown2 host. The cost was not visible at install time; it appeared on the next reboot, potentially long after anyone would connect the two events.

**Check the boot path before you need it.** A host that comes up with no network is only recoverable out-of-band. Confirm iDRAC or IPMI access works *before* the reboot that needs it. And note that iSM's `Enable-iDRACAccessHostRoute` feature routes iDRAC access *through the host OS*, so it is useless in exactly this scenario, where the host has no network.

---

## Useful commands

```bash
# What failed at boot, and why
systemctl --failed
journalctl -b -p err --no-pager
journalctl -u <unit> -b --no-pager

# Dependency chain
systemctl list-dependencies networking.service --all

# udev queue state
udevadm settle --timeout=5; echo "exit: $?"
journalctl -b -u systemd-udevd --no-pager | tail -80

# Validate network config without applying it
ifquery --check -a

# Find rules referencing a binary
grep -rl "<name>" /lib/udev/rules.d/ /etc/udev/rules.d/
```
