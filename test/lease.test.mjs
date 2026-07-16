import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LEASE_DEFAULTS,
  countLive,
  grant,
  hasLive,
  parseLeases,
  pruneExpired,
  reconcile,
  release,
  serializeLeases,
  touch,
  ttlSecFor,
} from "../lib/curtain/lease.mjs";

test("grant + serialize + parse round-trips", () => {
  const l = grant([], "subagent", "syn-1", 1000, {});
  const round = parseLeases(serializeLeases(l));
  assert.deepEqual(round, [
    {
      kind: "subagent",
      id: "syn-1",
      exp: 1000 + LEASE_DEFAULTS.subagentTtlSec,
    },
  ]);
});

test("expired leases stop counting without any event", () => {
  const l = grant([], "subagent", "syn-1", 1000, {});
  assert.equal(countLive(l, 1060).subagent, 1);
  assert.equal(countLive(l, 1000 + 121).subagent, 0); // TTL 120 elapsed
  assert.equal(hasLive(l, 1200), false);
});

test("watcher lease expires after its own TTL (RC2 bound)", () => {
  const l = grant([], "watcher", "loop", 1000, {});
  assert.equal(countLive(l, 1000 + 899).watcher, 1);
  assert.equal(countLive(l, 1000 + 901).watcher, 0);
});

test("reconcile to empty clears the kind (RC1 primitive)", () => {
  let l = grant([], "subagent", "a", 1000, {});
  l = grant(l, "subagent", "b", 1000, {});
  l = grant(l, "turn", "t", 1000, {});
  l = reconcile(l, "subagent", [], 1001, {});
  assert.equal(countLive(l, 1001).subagent, 0);
  assert.equal(countLive(l, 1001).turn, 1); // other kinds untouched
});

test("grant refreshes exp idempotently; release removes; touch re-arms live only", () => {
  let l = grant([], "subagent", "a", 1000, {});
  l = grant(l, "subagent", "a", 1100, {});
  assert.equal(l.length, 1);
  assert.equal(l[0].exp, 1100 + 120);
  l = grant(l, "bg_shell", "s", 1100, {});
  l = release(l, "bg_shell", "s");
  assert.equal(countLive(l, 1100).bg_shell, 0);
  // expired lease not resurrected by touch
  l = touch(l, 1100 + 121, {});
  assert.equal(hasLive(l, 1100 + 121), false);
});

test("parse tolerates garbage and id sanitization strips separators", () => {
  assert.deepEqual(parseLeases("bogus,,subagent:x:notanum,:::"), []);
  const l = grant([], "subagent", "a,b:c", 1000, {});
  assert.equal(l[0].id, "a_b_c");
});

test("cfg overrides TTLs", () => {
  assert.equal(ttlSecFor("watcher", { watcherTtlSec: 60 }), 60);
  const l = grant([], "watcher", "w", 1000, { watcherTtlSec: 60 });
  assert.equal(countLive(l, 1061).watcher, 0);
});

test("pruneExpired drops only expired", () => {
  let l = grant([], "subagent", "a", 1000, {});
  l = grant(l, "watcher", "w", 1000, {});
  const pruned = pruneExpired(l, 1000 + 121);
  assert.equal(pruned.length, 1);
  assert.equal(pruned[0].kind, "watcher");
});
