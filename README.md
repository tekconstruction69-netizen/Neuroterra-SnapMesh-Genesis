# Neuroterra SnapMesh Genesis

> Heterogeneous AI compute over consented devices — planned, measured,
> and verified locally by an autonomous scheduler. No cloud AI in the
> runtime loop. Built with Muse for the Meta Global AI Developer
> Hackathon 2026 (Push the Frontier).

## The scientific problem

How do you run the same AI workload across devices with different CPUs,
GPUs, NPUs, memory, numeric formats, operators, operating systems, and
network links — minimizing total time, transfers, conversions, and
numeric-error risk? Genesis answers with a typed compute graph, honestly
detected capabilities, a deterministic arbiter for every plan, and an
adaptive scheduler (NT-ADAPT) that must *prove* a distributed plan beats
the local one before it distributes anything.

## Architecture

- `mesh-net` — P2P transport: Ed25519 NT identities, LAN discovery,
  heartbeats, X25519 ephemeral sessions + AES-256-GCM, one-hop relay.
- `mesh-compute` — Whitelisted ops only, sandboxed workers (time/memory/
  result caps), redundant execution with a 2/3 quorum, signed receipts.
- `mesh-safety` / `mesh-app` — START/STOP control, CPU/memory budgets,
  local dashboard. No arbitrary code from the network, ever.
- `nt-compat` — Measured backend detection (Node CPU fp32/fp64/int8,
  ONNX Runtime when installed). Missing hardware is reported missing.
- `nt-fusion` — Typed DAG with mandatory explicit `cast` nodes; a
  deterministic planner; every AI-proposed plan is re-validated.
- `nt-ucp` / `nt-pq` — Signed capability manifests, authenticated
  negotiation with replay protection, hybrid post-quantum sessions.
  A negotiation proves agreement on names, never real execution —
  execution trust comes from receipts + quorum/recomputation.
- `neurocore` — Autonomous scheduler (no Muse calls at runtime):
  learned costs (bounded EWMA), NT-ADAPT global placement with
  cumulative-memory feasibility, uncertainty-pessimistic costing,
  measured capability probes, tolerance-based verification, and an
  explicit local fallback when distribution does not pay.

## What is actually proven

All results below are from a single Windows host (Node.js 24); raw logs
are in `bench-logs/`. Emulated asymmetries are labeled as such.

- Test suites (sequential): neurocore 16/16, nt-fusion 7/7,
  nt-compat 5/5, mesh-flux 7/7, plus M1/M2 networking and safety suites
  documented in `docs/PROGRESS.md` and `docs/JOURNAL.md`.
- NT-ADAPT vs greedy placement (`scripts/bench-ntadapt.js`, 7 reps):
  0 bytes transferred vs 4096 for the greedy planner on a slow-link
  chain, and a feasible plan where the current scheduler exceeds a
  cumulative memory cap. On symmetric small graphs, NT-ADAPT is
  *slower* (search overhead) and correctly falls back to local.
- End-to-end local scenario with real ONNX Runtime inference,
  failure injection + replanning, and deterministic duplicate results
  (`scripts/m6-e2e-local.js`).

## Honest limits

- Two physical machines over LAN: procedure ready, **not yet executed**
  (no second device was available; nothing is simulated as physical).
- GPU/NPU acceleration: absent on the test host and reported as such.
- NAT traversal: research only. Cloud fallback (Baseten): key presence
  detected, call not implemented in the prototype.
- Quorum detects isolated liars; it is not a cryptographic proof of
  correct execution. Receipts prove accountability, not accuracy.

## Install and run

Requirements: Node.js 18+ (24 recommended), Windows or any Node OS.

```powershell
# Unit + integration checks (run sequentially)
node --test neurocore/test/unit.test.js neurocore/test/adapt.test.js
node --test nt-fusion/test/unit.test.js
node --test nt-compat/test/unit.test.js

# Reproducible scheduler comparison and end-to-end scenario
node scripts/bench-ntadapt.js --reps 7
node scripts/m6-e2e-local.js

# Local control app (loopback only)
node mesh-app/server.js
```

LAN two-PC procedure (explicit consent on both machines, private LAN,
firewall never modified by scripts): see `docs/M6_TEST_PLAN.md`.

## Documentation

Start with `docs/NT_ADAPT_RND/` (state of the art, hypotheses, protocol
contracts, scheduler architecture, experimental plan, results, limits),
then `docs/M6_ARCHITECTURE.md`, `docs/ARCHITECTURE.md`, and the
session-by-session `docs/JOURNAL.md`. Work is all-new for this
hackathon; reuse and third-party pieces are declared in
`docs/COMPLIANCE.md` (single optional dependency: `onnxruntime-node`).

## License

MIT (see module `package.json` files).
