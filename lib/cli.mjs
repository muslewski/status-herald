import { renderCardFrame } from "./surfaces/curtain-card.mjs";
import { computeElapsed } from "./curtain/state.mjs";

const parseFlags = (args) => {
  const f = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) f[args[i].slice(2)] = args[++i];
  }
  return f;
};

const runRender = (args) => {
  const f = parseFlags(args);
  if (f.surface !== "curtain-card") {
    process.stderr.write(`unknown surface: ${f.surface}\n`);
    return 1;
  }
  const nowSec = Math.floor(Date.now() / 1000);
  process.stdout.write(renderCardFrame({
    state: f.state || "idle",
    elapsedSec: computeElapsed(nowSec, f.since),
    cols: Number(f.cols) || 80,
    rows: Number(f.rows) || 24,
  }));
  return 0;
};

export const main = (argv) => {
  const [verb, ...rest] = argv;
  try {
    if (verb === "--version" || verb === "-v") { process.stdout.write("herald 0.0.0\n"); return; }
    if (verb === "render") { process.exitCode = runRender(rest); return; }
    process.stderr.write("usage: herald <render|curtain> ...\n");
    process.exitCode = 1;
  } catch (e) {
    process.stderr.write(`${e?.message ?? e}\n`);
    process.exitCode = 1;
  }
};
