import { cp, mkdir, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = new URL("../", import.meta.url);
const nextOutput = new URL("../.next/", import.meta.url);
const standaloneOutput = new URL("../.next/standalone/", import.meta.url);
const hostingerOutput = new URL("../.hostinger/", import.meta.url);

const nextCli = fileURLToPath(new URL("../node_modules/next/dist/bin/next", import.meta.url));
const result = spawnSync(process.execPath, [nextCli, "build"], {
  cwd: fileURLToPath(projectRoot),
  env: {
    ...process.env,
    HOSTINGER_BUILD: "1",
    NEXT_DIST_DIR: ".next",
  },
  stdio: "inherit",
});

if (result.status !== 0) {
  if (result.error) console.error(result.error);
  process.exit(result.status ?? 1);
}

await rm(hostingerOutput, { recursive: true, force: true });
await mkdir(hostingerOutput, { recursive: true });
await cp(standaloneOutput, hostingerOutput, { recursive: true });
await mkdir(new URL(".next/", hostingerOutput), { recursive: true });
await cp(new URL("static/", nextOutput), new URL(".next/static/", hostingerOutput), { recursive: true });
await cp(new URL("../public/", import.meta.url), new URL("public/", hostingerOutput), { recursive: true });

console.log("Prepared Hostinger standalone output in .hostinger/");
