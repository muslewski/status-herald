export const main = (argv) => {
  const [verb] = argv;
  try {
    if (verb === "--version" || verb === "-v") {
      process.stdout.write("herald 0.0.0\n");
      return;
    }
    process.stderr.write("usage: herald <render|curtain> ...\n");
    process.exitCode = 1;
  } catch (e) {
    process.stderr.write(`${e?.message ?? e}\n`);
    process.exitCode = 1;
  }
};
