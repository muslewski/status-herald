import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  hooksInstalled,
  install,
  mergeHooks,
  uninstall,
} from "../lib/curtain/install.mjs";

const tmp = () => join(mkdtempSync(join(tmpdir(), "herald-")), "settings.json");

test("install into a fresh file wires every state-moving event", () => {
  const p = tmp();
  const r = install(p);
  assert.equal(r.ok, true);
  assert.equal(r.changed, true);
  const s = JSON.parse(readFileSync(p, "utf8"));
  assert.equal(hooksInstalled(s), true);
  assert.deepEqual(Object.keys(s.hooks).sort(), [
    "Notification",
    "Stop",
    "SubagentStart",
    "SubagentStop",
    "UserPromptSubmit",
  ]);
});

test("install migrates the legacy event hooks away instead of doubling up", () => {
  // The old wiring mapped Stop straight to "done". Leaving it in place would let
  // it overwrite the payload-aware state on every turn end.
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
  const s = JSON.parse(readFileSync(p, "utf8"));
  const cmds = Object.values(s.hooks)
    .flat()
    .flatMap((g) => g.hooks.map((h) => h.command));
  assert.equal(
    cmds.filter((c) => c.startsWith("herald curtain event")).length,
    0,
    "legacy herald hooks removed",
  );
  assert.equal(cmds.filter((c) => c === "herald curtain hook").length, 5);
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

test("install does not overwrite the pristine .bak on an idempotent re-run", () => {
  const p = tmp();
  writeFileSync(p, JSON.stringify({ model: "opus" }, null, 2));
  install(p); // 1st: makes .bak = pristine {model:"opus"}
  const bakAfterFirst = readFileSync(`${p}.bak`, "utf8");
  install(p); // 2nd: idempotent, must NOT touch .bak
  assert.equal(readFileSync(`${p}.bak`, "utf8"), bakAfterFirst);
  const bak = JSON.parse(bakAfterFirst);
  assert.equal(bak.model, "opus");
  assert.equal("hooks" in bak && bak.hooks?.UserPromptSubmit != null, false); // .bak has NO herald hooks
});

test("mergeHooks does not duplicate an already-present hook", () => {
  const s = {
    hooks: {
      UserPromptSubmit: [
        { hooks: [{ type: "command", command: "herald curtain hook" }] },
      ],
    },
  };
  const changed = mergeHooks(s);
  const count = s.hooks.UserPromptSubmit.filter((g) =>
    g.hooks.some((h) => h.command === "herald curtain hook"),
  ).length;
  assert.equal(count, 1);
  assert.equal(changed, true); // the other four events still added
});
