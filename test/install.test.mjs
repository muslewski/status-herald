import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  EVENTS,
  hookCommand,
  hooksInstalled,
  install,
  mergeHooks,
  uninstall,
} from "../lib/curtain/install.mjs";

const tmp = () => join(mkdtempSync(join(tmpdir(), "herald-")), "settings.json");
const CMD = hookCommand();
const allCmds = (s) =>
  Object.values(s.hooks)
    .flat()
    .flatMap((g) => g.hooks.map((h) => h.command));

test("the wired command is absolute, not a bare name", () => {
  // The whole fix: a bare `herald` exits 127 in a hook environment that lacks
  // the nvm shim on PATH. An absolute node + bin entry starts regardless.
  assert.match(CMD, /^"\/.*node.*" "\/.*bin\/herald" curtain hook$/);
});

test("install into a fresh file wires every state-moving event", () => {
  const p = tmp();
  const r = install(p);
  assert.equal(r.ok, true);
  assert.equal(r.changed, true);
  const s = JSON.parse(readFileSync(p, "utf8"));
  assert.equal(hooksInstalled(s), true);
  assert.deepEqual(Object.keys(s.hooks).sort(), [...EVENTS].sort());
});

test("install migrates a bare herald hook to the absolute command", () => {
  // A pre-2.x install wired the bare `herald curtain hook`. Upgrading must
  // replace it, not sit alongside it -- otherwise the bare one keeps failing.
  const p = tmp();
  writeFileSync(
    p,
    JSON.stringify({
      hooks: {
        Stop: [
          { hooks: [{ type: "command", command: "herald curtain hook" }] },
        ],
      },
    }),
  );
  install(p);
  const s = JSON.parse(readFileSync(p, "utf8"));
  const cmds = allCmds(s);
  assert.equal(
    cmds.filter((c) => c === "herald curtain hook").length,
    0,
    "bare hook migrated away",
  );
  assert.equal(
    cmds.filter((c) => c === CMD).length,
    EVENTS.length,
    "absolute on every event",
  );
});

test("install rewrites a stale-absolute hook (node upgrade self-heals)", () => {
  const p = tmp();
  const stale = `"/old/node/bin/node" "/old/repo/bin/herald" curtain hook`;
  writeFileSync(
    p,
    JSON.stringify({
      hooks: { Stop: [{ hooks: [{ type: "command", command: stale }] }] },
    }),
  );
  install(p);
  const cmds = allCmds(JSON.parse(readFileSync(p, "utf8")));
  assert.equal(cmds.includes(stale), false, "stale path removed");
  assert.equal(cmds.filter((c) => c === CMD).length, EVENTS.length);
});

test("install migrates the legacy event hooks away instead of doubling up", () => {
  const p = tmp();
  writeFileSync(
    p,
    JSON.stringify({
      hooks: {
        Stop: [
          {
            hooks: [{ type: "command", command: "herald curtain event done" }],
          },
        ],
        UserPromptSubmit: [
          {
            hooks: [
              { type: "command", command: "herald curtain event working" },
            ],
          },
          { hooks: [{ type: "command", command: "some-other-tool" }] },
        ],
      },
    }),
  );
  const r = install(p);
  assert.equal(r.ok, true);
  const cmds = allCmds(JSON.parse(readFileSync(p, "utf8")));
  assert.equal(
    cmds.filter((c) => c.startsWith("herald curtain event")).length,
    0,
    "legacy herald hooks removed",
  );
  assert.equal(cmds.filter((c) => c === CMD).length, EVENTS.length);
  assert.ok(cmds.includes("some-other-tool"), "foreign hooks untouched");
});

test("uninstall removes legacy hooks too", () => {
  const p = tmp();
  writeFileSync(
    p,
    JSON.stringify({
      hooks: {
        Stop: [
          {
            hooks: [{ type: "command", command: "herald curtain event done" }],
          },
        ],
      },
    }),
  );
  uninstall(p);
  const s = JSON.parse(readFileSync(p, "utf8"));
  assert.deepEqual(s.hooks.Stop, []);
});

test("install preserves unrelated keys and backs up", () => {
  const p = tmp();
  writeFileSync(
    p,
    JSON.stringify({ model: "opus", hooks: { Stop: [] } }, null, 2),
  );
  const r = install(p);
  assert.equal(r.ok, true);
  assert.equal(existsSync(`${p}.bak`), true);
  const s = JSON.parse(readFileSync(p, "utf8"));
  assert.equal(s.model, "opus");
  assert.equal(hooksInstalled(s), true);
});

test("install is idempotent (second run makes no change)", () => {
  const p = tmp();
  install(p);
  const r2 = install(p);
  assert.equal(r2.changed, false);
});

test("install aborts untouched on malformed JSON", () => {
  const p = tmp();
  writeFileSync(p, "{ not json ");
  const r = install(p);
  assert.equal(r.ok, false);
  assert.match(r.reason, /malformed/);
  assert.equal(readFileSync(p, "utf8"), "{ not json ");
});

test("uninstall removes exactly the herald hooks", () => {
  const p = tmp();
  install(p);
  const r = uninstall(p);
  assert.equal(r.changed, true);
  const s = JSON.parse(readFileSync(p, "utf8"));
  assert.equal(hooksInstalled(s), false);
});

// Entry-level drop: a foreign command co-located in the same group as herald
// must survive uninstall. Pre-r003 dropWhere filtered whole groups, which
// silently deleted co-located foreign hooks on uninstall/migrate.
test("removeHooks keeps foreign command in a mixed group", () => {
  const p = tmp();
  const cmd = hookCommand();
  writeFileSync(
    p,
    JSON.stringify({
      hooks: {
        Stop: [
          {
            hooks: [
              { type: "command", command: cmd },
              { type: "command", command: "foreign-sidecar" },
            ],
          },
        ],
      },
    }),
  );
  const r = uninstall(p);
  assert.equal(r.ok, true);
  const settings = JSON.parse(readFileSync(p, "utf8"));
  const cmds = (settings.hooks.Stop || []).flatMap((g) =>
    (g.hooks || []).map((h) => h.command),
  );
  assert.ok(cmds.includes("foreign-sidecar"), "foreign kept");
  assert.equal(
    cmds.some((c) => c === cmd),
    false,
    "herald removed",
  );
});

test("install does not overwrite the pristine .bak on an idempotent re-run", () => {
  const p = tmp();
  writeFileSync(p, JSON.stringify({ model: "opus" }, null, 2));
  install(p);
  const bakAfterFirst = readFileSync(`${p}.bak`, "utf8");
  install(p);
  assert.equal(readFileSync(`${p}.bak`, "utf8"), bakAfterFirst);
  const bak = JSON.parse(bakAfterFirst);
  assert.equal(bak.model, "opus");
  assert.equal("hooks" in bak && bak.hooks?.UserPromptSubmit != null, false);
});

test("mergeHooks does not duplicate an already-present hook", () => {
  const s = { hooks: { UserPromptSubmit: [entry(CMD)] } };
  const changed = mergeHooks(s);
  const count = s.hooks.UserPromptSubmit.filter((g) =>
    g.hooks.some((h) => h.command === CMD),
  ).length;
  assert.equal(count, 1);
  assert.equal(changed, true); // the other events still added
});

function entry(command) {
  return { hooks: [{ type: "command", command }] };
}
