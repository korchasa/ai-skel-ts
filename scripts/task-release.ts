import { runCommand, runNpm } from "./utils.ts";

console.log("--- CREATING RELEASE ---");
await runNpm(["run", "release"]);
await runCommand("git", ["push", "--follow-tags"]);
