// Single source of truth for the CLI version string. Reads package.json at
// runtime so the binary always matches the package it ships from.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

let cached;

/**
 * @returns {string}
 */
export const version = () => {
  if (cached) return cached;
  const pkg = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "package.json",
  );
  cached = JSON.parse(readFileSync(pkg, "utf8")).version;
  return cached;
};
