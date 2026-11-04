import { spawnSync } from "node:child_process";
import { isSha256Digest, readJson, repoPath, writeJson } from "./lib/common.mjs";

const manifestPath = repoPath("manifest/pinned-versions.json");
const checkOnly = process.argv.includes("--check");
const requireAll = process.argv.includes("--require-all") || process.argv.includes("--release");
const force = process.argv.includes("--force");
const onlyIndex = process.argv.indexOf("--only");
const only = onlyIndex >= 0 ? (process.argv[onlyIndex + 1] ?? "").split(",").map((item) => item.trim()).filter(Boolean) : null;

function parseImageReference(reference) {
  const [withoutDigest, digest] = reference.split("@");
  const parts = withoutDigest.split("/");
  const first = parts[0] ?? "";
  const hasSlash = withoutDigest.includes("/");
  const registry =
    hasSlash && (first.includes(".") || first === "localhost" || /:\d+$/.test(first))
      ? parts.shift()
      : "docker.io";
  let name = parts.join("/");
  const lastSlash = name.lastIndexOf("/");
  const lastColon = name.lastIndexOf(":");
  let tag = "latest";
  if (lastColon > lastSlash) {
    tag = name.slice(lastColon + 1);
    name = name.slice(0, lastColon);
  }
  if (registry === "docker.io") {
    if (!name.includes("/")) {
      name = `library/${name}`;
    }
  }
  return { registry, name, tag, digest };
}

async function registryToken(image) {
  if (image.registry === "ghcr.io") {
    const response = await fetch(`https://ghcr.io/token?service=ghcr.io&scope=repository:${image.name}:pull`);
    if (!response.ok) {
      throw new Error(`GHCR token request failed with HTTP ${response.status}.`);
    }
    const payload = await response.json();
    return payload.token;
  }

  if (image.registry === "docker.io") {
    const response = await fetch(
      `https://auth.docker.io/token?service=registry.docker.io&scope=repository:${image.name}:pull`
    );
    if (!response.ok) {
      throw new Error(`Docker Hub token request failed with HTTP ${response.status}.`);
    }
    const payload = await response.json();
    return payload.token;
  }

  const response = await fetch(
    `https://${image.registry}/token?service=${encodeURIComponent(image.registry)}&scope=repository:${image.name}:pull`
  );
  if (!response.ok) {
    return null;
  }
  const payload = await response.json();
  return payload.token ?? null;
}

async function registryDigest(reference) {
  const image = parseImageReference(reference);
  if (image.digest) {
    return image.digest;
  }

  const registryHost = image.registry === "docker.io" ? "registry-1.docker.io" : image.registry;
  const token = await registryToken({ ...image, registry: image.registry === "docker.io" ? "docker.io" : image.registry });
  const headers = {
    accept: [
      "application/vnd.oci.image.index.v1+json",
      "application/vnd.docker.distribution.manifest.list.v2+json",
      "application/vnd.oci.image.manifest.v1+json",
      "application/vnd.docker.distribution.manifest.v2+json"
    ].join(", "),
    ...(token ? { authorization: `Bearer ${token}` } : {})
  };

  const manifestUrl = `https://${registryHost}/v2/${image.name}/manifests/${encodeURIComponent(image.tag)}`;
  let response = await fetch(manifestUrl, { method: "HEAD", headers });
  if (!response.ok) {
    response = await fetch(manifestUrl, { headers });
  }
  if (!response.ok) {
    throw new Error(`Registry returned HTTP ${response.status} for ${reference}.`);
  }

  const digest = response.headers.get("docker-content-digest");
  if (!digest) {
    throw new Error(`Registry did not return a digest for ${reference}.`);
  }
  return digest;
}

function dockerImageDigest(reference) {
  const repoDigests = spawnSync(
    "docker",
    ["image", "inspect", "--format", "{{json .RepoDigests}}", reference],
    { encoding: "utf8", timeout: 30_000 }
  );
  if (repoDigests.status !== 0) {
    return null;
  }

  try {
    const digests = JSON.parse(repoDigests.stdout.trim() || "[]");
    return digests.map((value) => String(value).split("@")[1]).find(Boolean) ?? null;
  } catch {
    return null;
  }
}

async function resolveDigest(reference) {
  try {
    return await registryDigest(reference);
  } catch (registryError) {
    const local = dockerImageDigest(reference);
    if (local) {
      return local;
    }
    throw registryError;
  }
}

async function main() {
  const manifest = readJson(manifestPath);
  const containers = manifest.containers ?? {};
  const digests = manifest.digests ?? {};
  const keys = Object.keys(containers).filter((key) => !only || only.includes(key));
  if (keys.length === 0) {
    throw new Error("No manifest container keys selected.");
  }

  const unresolved = [];
  let changed = false;

  for (const key of keys) {
    const reference = containers[key];
    const current = digests[key];
    if (!checkOnly && !force && isSha256Digest(current)) {
      console.log(`${key}: already pinned to ${current}`);
      continue;
    }

    try {
      const digest = await resolveDigest(reference);
      if (!isSha256Digest(digest)) {
        throw new Error(`Resolved digest is not sha256: ${digest}`);
      }
      console.log(`${key}: ${reference} -> ${digest}`);
      if (!checkOnly && digests[key] !== digest) {
        digests[key] = digest;
        changed = true;
      }
    } catch (error) {
      unresolved.push(key);
      console.error(`${key}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (!checkOnly && changed) {
    writeJson(manifestPath, { ...manifest, digests });
    console.log(`Updated ${manifestPath}`);
  }

  if (unresolved.length > 0) {
    if (requireAll) {
      throw new Error(`Could not resolve digests for: ${unresolved.join(", ")}`);
    }
    console.warn(
      `WARNING: unresolved digests for ${unresolved.join(", ")}. Build/push the local image or supply registry access, then rerun.`
    );
  }

  if (checkOnly) {
    console.log("Check-only mode: manifest was not modified.");
  }
}

main().catch((error) => {
  console.error(`FAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
