import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  loadDotEnv,
  optionalEnv,
  readJson,
  repoPath,
  stripTrailingSlash,
  writeJson
} from "./lib/common.mjs";

loadDotEnv();

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoPath("."),
    encoding: "utf8",
    timeout: options.timeout ?? 30_000,
    shell: options.shell ?? false
  });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: (result.stdout ?? "").trim(),
    stderr: (result.stderr ?? "").trim() || (result.error ? result.error.message : "")
  };
}

async function checkService(name, url) {
  if (!url) {
    return { name, url: null, status: "SKIPPED", detail: "URL not configured" };
  }

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    const text = await response.text();
    return {
      name,
      url,
      status: response.ok ? "PASS" : "FAIL",
      httpStatus: response.status,
      detail: text.slice(0, 1_000)
    };
  } catch (error) {
    return {
      name,
      url,
      status: "FAIL",
      detail: error instanceof Error ? error.message : String(error)
    };
  }
}

function gitValue(args) {
  const result = run("git", args);
  return result.ok ? result.stdout : "";
}

async function main() {
  const manifestPath = repoPath("manifest/pinned-versions.json");
  const manifest = fs.existsSync(manifestPath) ? readJson(manifestPath) : null;
  const head = gitValue(["rev-parse", "HEAD"]);
  const branch = gitValue(["branch", "--show-current"]);
  const status = gitValue(["status", "--porcelain=v1"]);
  const capturedAt = new Date();
  const requestedRunId = argumentValue("--run-id");
  const runId =
    requestedRunId ??
    `${capturedAt.toISOString().replaceAll(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}-${(head || "no-head").slice(0, 12)}`;

  if (!/^[A-Za-z0-9._-]+$/.test(runId)) {
    throw new Error("Run id may contain only letters, numbers, dot, underscore and hyphen.");
  }

  const outputDir = repoPath("evidence", "runs", runId);
  fs.mkdirSync(outputDir, { recursive: true });

  const urls = {
    platform: optionalEnv("PUBLIC_PLATFORM_URL") ? stripTrailingSlash(optionalEnv("PUBLIC_PLATFORM_URL")) : null,
    windmill: optionalEnv("PUBLIC_WINDMILL_BASE_URL")
      ? stripTrailingSlash(optionalEnv("PUBLIC_WINDMILL_BASE_URL"))
      : null,
    booking: optionalEnv("PUBLIC_BOOKING_URL") ? stripTrailingSlash(optionalEnv("PUBLIC_BOOKING_URL")) : null
  };

  const checks = [
    await checkService("platform health", urls.platform ? `${urls.platform}/api/healthz` : null),
    await checkService("windmill version", urls.windmill ? `${urls.windmill}/api/version` : null),
    await checkService("calnode health", urls.booking ? `${urls.booking}/healthz` : null)
  ];

  for (const [name, value] of [
    ["PUBLIC_PLATFORM_URL", urls.platform],
    ["PUBLIC_WINDMILL_BASE_URL", urls.windmill],
    ["PUBLIC_BOOKING_URL", urls.booking]
  ]) {
    if (!value) {
      checks.push({ name, url: null, status: "FAIL", detail: `${name} is not set` });
    }
  }

  const composePs = run("docker", ["compose", "ps"], { timeout: 60_000 });
  const npmVersion = run("npm", ["--version"], { shell: process.platform === "win32" });

  const evidence = {
    runId,
    capturedAt: capturedAt.toISOString(),
    repository: {
      sha: head || "UNCOMMITTED_NO_HEAD",
      branch: branch || null,
      workingTree: status ? "dirty" : "clean",
      status: status ? status.split(/\r?\n/).slice(0, 200) : []
    },
    runtime: {
      node: process.version,
      npm: npmVersion.ok ? npmVersion.stdout : null
    },
    manifest: manifest ? { release: manifest.release, sow: manifest.sow } : null,
    urls,
    checks,
    dockerComposePs: {
      ok: composePs.ok,
      output: composePs.ok ? composePs.stdout : composePs.stderr || composePs.stdout
    }
  };

  writeJson(path.join(outputDir, "environment.json"), evidence);
  fs.writeFileSync(path.join(outputDir, "docker-compose-ps.txt"), `${evidence.dockerComposePs.output}\n`);
  if (manifest) {
    writeJson(path.join(outputDir, "manifest.json"), manifest);
  }

  const rows = checks
    .map((check) => `| ${check.name} | ${check.url ?? "-"} | ${check.status} | ${check.httpStatus ?? "-"} |`)
    .join("\n");
  const markdown = `# Environment evidence - ${runId}

- Captured at: ${evidence.capturedAt}
- Repository SHA: ${evidence.repository.sha}
- Branch: ${evidence.repository.branch ?? "(detached)"}
- Working tree: ${evidence.repository.workingTree}
- Node: ${evidence.runtime.node}
- npm: ${evidence.runtime.npm ?? "unavailable"}
- Manifest release: ${evidence.manifest?.release ?? "missing"}
- SOW: ${evidence.manifest?.sow ?? "missing"}
- Platform URL: ${urls.platform ?? "not configured"}
- Windmill URL: ${urls.windmill ?? "not configured"}
- Booking URL: ${urls.booking ?? "not configured"}

## Service checks

| Check | URL | Status | HTTP |
| --- | --- | --- | --- |
${rows}

## Docker Compose

\`\`\`text
${evidence.dockerComposePs.output || "(no output)"}
\`\`\`

## Notes

This capture contains public URLs and health responses only. It contains no passwords, API keys, service-role keys, tokens or session data. Attach acceptance screenshots and logs to this directory; \`evidence/runs/\` is gitignored.
`;

  fs.writeFileSync(path.join(outputDir, "environment.md"), markdown);

  const files = fs
    .readdirSync(outputDir)
    .filter((file) => file !== "SHA256SUMS.txt" && fs.statSync(path.join(outputDir, file)).isFile())
    .sort();
  const sums = files.map((file) => {
    const digest = crypto.createHash("sha256").update(fs.readFileSync(path.join(outputDir, file))).digest("hex");
    return `${digest}  ${file}`;
  });
  fs.writeFileSync(path.join(outputDir, "SHA256SUMS.txt"), `${sums.join("\n")}\n`);

  console.log(`Evidence written to ${outputDir}`);
  for (const check of checks) {
    console.log(`${check.status.padEnd(7)} ${check.name}${check.url ? ` (${check.url})` : ""}`);
  }

  if (checks.some((check) => check.status === "FAIL")) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`FAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
