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

test("install into a fresh file writes all three hooks", () => {
  const p = tmp();
  const r = install(p);
  assert.equal(r.ok, true);
  assert.equal(r.changed, true);
  const s = JSON.parse(readFileSync(p, "utf8"));
  assert.equal(hooksInstalled(s), true);
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

test("mergeHooks does not duplicate an already-present hook", () => {
  const s = {
    hooks: {
      UserPromptSubmit: [
        {
          hooks: [{ type: "command", command: "herald curtain event working" }],
        },
      ],
    },
  };
  const changed = mergeHooks(s);
  const count = s.hooks.UserPromptSubmit.filter((g) =>
    g.hooks.some((h) => h.command === "herald curtain event working"),
  ).length;
  assert.equal(count, 1);
  assert.equal(changed, true); // Stop + Notification still added
});
