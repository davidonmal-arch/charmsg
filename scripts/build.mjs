import { readdir, readFile, access } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { execFileSync } from "node:child_process";

let checked = 0;
async function check(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!["node_modules", ".git", ".firebase"].includes(entry.name)) await check(filename);
    } else if (/\.(mjs|js)$/.test(entry.name)) {
      execFileSync(process.execPath, ["--check", filename], { stdio: "inherit" });
      const source = await readFile(filename, "utf8");
      for (const match of source.matchAll(/(?:from\s*|import\s*\()["'](\.[^"']+)["']/g)) {
        await access(resolve(dirname(filename), match[1].split(/[?#]/)[0]));
      }
      checked++;
    }
  }
}
await check("js");
await check("functions");
await check("scripts");
for (const filename of ["index.html", "sw.js", "css/style.css", "manifest.webmanifest"]) await access(filename);
console.log(`Build validation passed for ${checked} JavaScript files and static entry points.`);
