import fs from "node:fs";
import path from "node:path";
import {
  isSha256Digest,
  readJson,
  readText,
  relativeToRepo,
  repoPath,
  walkFiles
} from "./lib/common.mjs";

const failures = [];
const releaseMode = process.argv.includes("--release") || process.env.SAFI_RELEASE_CHECK === "1";
const exactVersion = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function fail(message) {
  failures.push(message);
}

function checkPinnedReference(reference, label) {
  if (!reference) {
    fail(`${label} is empty.`);
    return;
  }
  if (reference === "scratch") {
    return;
  }
  if (reference.includes("@sha256:")) {
    return;
  }

  const lastSegment = reference.split("/").pop() ?? "";
  if (!lastSegment.includes(":")) {
    fail(`${label} has no explicit tag or digest: ${reference}`);
  }
  if (/(^|[:/])latest(@|$)/.test(reference)) {
    fail(`${label} uses the forbidden latest tag: ${reference}`);
  }
}

const manifestPath = repoPath("manifest/pinned-versions.json");
if (!fs.existsSync(manifestPath)) {
  fail("manifest/pinned-versions.json is missing.");
} else {
  const manifest = readJson(manifestPath);

  if (!manifest.release) {
    fail("manifest.release is missing.");
  }
  if (!manifest.sow) {
    fail("manifest.sow is missing.");
  }

  const packageSections = [
    { file: "apps/web/package.json", section: "spa" },
    { file: "services/trusted-api/package.json", section: "trustedApi" },
    { file: "tests/package.json", section: "tests" }
  ];

  for (const { file, section } of packageSections) {
    const absolute = repoPath(file);
    if (!fs.existsSync(absolute)) {
      fail(`${file} is missing.`);
      continue;
    }

    const packageJson = readJson(absolute);
    const expected = manifest[section] ?? {};
    const dependencies = {
      ...(packageJson.dependencies ?? {}),
      ...(packageJson.devDependencies ?? {})
    };

    if (manifest.release && packageJson.version !== manifest.release) {
      fail(`${file} version ${packageJson.version} does not match manifest.release ${manifest.release}.`);
    }

    for (const [name, version] of Object.entries(dependencies)) {
      if (!exactVersion.test(version)) {
        fail(`${file} dependency ${name} is not an exact version: ${version}`);
      }
    }

    for (const [name, version] of Object.entries(expected)) {
      if (name === "node" || name === "npm") {
        continue;
      }
      if (!(name in dependencies)) {
        fail(`${file} is missing manifest-pinned dependency ${name}@${version}.`);
      } else if (dependencies[name] !== version) {
        fail(`${file} dependency ${name} is ${dependencies[name]}, expected ${version}.`);
      }
    }

    const lockPath = repoPath(path.dirname(file), "package-lock.json");
    if (!fs.existsSync(lockPath)) {
      fail(`${relativeToRepo(lockPath)} is missing.`);
      continue;
    }

    const lock = readJson(lockPath);
    if (lock.lockfileVersion !== 3) {
      fail(`${relativeToRepo(lockPath)} lockfileVersion is ${lock.lockfileVersion}, expected 3.`);
    }

    const root = lock.packages?.[""] ?? {};
    const rootDependencies = {
      ...(root.dependencies ?? {}),
      ...(root.devDependencies ?? {})
    };

    for (const [name, version] of Object.entries(dependencies)) {
      if (rootDependencies[name] !== version) {
        fail(
          `${relativeToRepo(lockPath)} root dependency ${name} is ${rootDependencies[name] ?? "missing"}, expected ${version}.`
        );
      }
      const locked = lock.packages?.[`node_modules/${name}`]?.version;
      if (!locked) {
        fail(`${relativeToRepo(lockPath)} does not contain a resolved entry for ${name}.`);
      } else if (locked !== version) {
        fail(`${relativeToRepo(lockPath)} resolved ${name} to ${locked}, expected ${version}.`);
      }
    }
  }

  const containers = manifest.containers ?? {};
  const digests = manifest.digests ?? {};
  const expectedContainerKeys = [
    "windmill",
    "windmillPostgres",
    "calnode",
    "caddy",
    "trustedApi",
    "web"
  ];

  for (const key of expectedContainerKeys) {
    if (!(key in containers)) {
      fail(`manifest.containers.${key} is missing.`);
    }
  }
  for (const key of Object.keys(containers)) {
    if (!expectedContainerKeys.includes(key)) {
      fail(`manifest.containers has an unexpected key: ${key}`);
    }
  }
  for (const key of expectedContainerKeys) {
    if (!(key in digests)) {
      fail(`manifest.digests.${key} is missing.`);
    }
  }
  for (const key of Object.keys(digests)) {
    if (!expectedContainerKeys.includes(key)) {
      fail(`manifest.digests has an unexpected key: ${key}`);
    }
  }

  for (const [key, image] of Object.entries(containers)) {
    checkPinnedReference(image, `manifest.containers.${key}`);
  }

  const awsOnly = manifest.awsOnly ?? {};
  const awsOnlyContainers = awsOnly.containers ?? {};
  for (const [key, image] of Object.entries(awsOnlyContainers)) {
    checkPinnedReference(image, `manifest.awsOnly.containers.${key}`);
  }
  if (awsOnly.region && !/^[a-z]{2}-[a-z]+-\d$/.test(awsOnly.region)) {
    fail(`manifest.awsOnly.region is not a valid AWS region: ${awsOnly.region}`);
  }
  if (awsOnly.bedrockModel && !/^[a-z0-9.-]+:[a-z0-9.-]+$/.test(awsOnly.bedrockModel)) {
    fail(`manifest.awsOnly.bedrockModel is not a valid model id: ${awsOnly.bedrockModel}`);
  }

  if (releaseMode) {
    for (const [key, digest] of Object.entries(digests)) {
      if (!isSha256Digest(digest)) {
        fail(`manifest.digests.${key} is not a resolved sha256 digest: ${digest}`);
      }
    }
  }

  const composePath = repoPath("docker-compose.yml");
  if (!fs.existsSync(composePath)) {
    fail("docker-compose.yml is missing.");
  } else {
    const compose = readText(composePath);
    const composeImages = [...compose.matchAll(/^\s*image:\s*["']?([^"'\s#]+)["']?\s*(?:#.*)?$/gm)].map(
      (match) => match[1]
    );

    for (const image of composeImages) {
      checkPinnedReference(image, "docker-compose.yml image");
    }

    const expectedComposeImages = [
      containers.windmill,
      containers.windmillPostgres,
      containers.calnode
    ];
    for (const image of expectedComposeImages) {
      if (!composeImages.includes(image)) {
        fail(`docker-compose.yml does not use the manifest-pinned image ${image}.`);
      }
    }

    for (const image of composeImages) {
      if (!Object.values(containers).includes(image)) {
        fail(`docker-compose.yml uses an image that is not in manifest.containers: ${image}`);
      }
    }
  }

  const overlayComposeFiles = walkFiles(repoPath("deploy")).filter((file) =>
    /^docker-compose.*\.ya?ml$/.test(path.basename(file))
  );
  for (const overlayFile of overlayComposeFiles) {
    const label = relativeToRepo(overlayFile);
    const overlayImages = [...readText(overlayFile).matchAll(/^\s*image:\s*["']?([^"'\s#]+)["']?\s*(?:#.*)?$/gm)].map(
      (match) => match[1]
    );
    for (const image of overlayImages) {
      checkPinnedReference(image, `${label} image`);
      if (!Object.values(containers).includes(image) && !Object.values(awsOnlyContainers).includes(image)) {
        fail(`${label} uses an image that is not pinned in the manifest: ${image}`);
      }
    }
    if (label === "deploy/aws/docker-compose.aws.yml") {
      for (const image of Object.values(awsOnlyContainers)) {
        if (!overlayImages.includes(image)) {
          fail(`${label} does not use the manifest-pinned image ${image}.`);
        }
      }
    }
  }

  const dockerfiles = walkFiles(repoPath(".")).filter((file) => path.basename(file).startsWith("Dockerfile"));
  if (dockerfiles.length === 0) {
    fail("No Dockerfiles were found.");
  }

  for (const dockerfile of dockerfiles) {
    const text = readText(dockerfile);
    const fromImages = [...text.matchAll(/^\s*FROM\s+(?:--\S+\s+)*["']?([^"'\s]+)["']?/gim)].map(
      (match) => match[1]
    );
    const label = relativeToRepo(dockerfile);
    if (fromImages.length === 0) {
      fail(`${label} has no FROM instruction.`);
    }
    for (const image of fromImages) {
      checkPinnedReference(image, `${label} FROM`);
      if (image.startsWith("node:")) {
        const expectedNode = label.includes("trusted-api") ? manifest.trustedApi?.node : manifest.spa?.node;
        if (expectedNode && !image.startsWith(`node:${expectedNode}-`) && image !== `node:${expectedNode}`) {
          fail(`${label} uses ${image}, expected node ${expectedNode}.`);
        }
      }
      if (image.startsWith("caddy:") && image !== containers.caddy) {
        fail(`${label} uses ${image}, expected ${containers.caddy}.`);
      }
    }
  }

  const browserFiles = walkFiles(repoPath("apps/web"), {
    ignore: ["node_modules", ".git", "dist", "dist-ssr", "playwright-report", "test-results", "package-lock.json"]
  }).filter((file) => /\.(ts|tsx|js|jsx|mjs|cjs|html|css|json|example)$/i.test(file));

  const forbiddenInBrowser = [
    "SUPABASE_SERVICE_ROLE_KEY",
    "WINDMILL_CHAT_TOKEN",
    "WINDMILL_ADMIN_TOKEN",
    "CALNODE_API_KEY",
    "SAFI_INTERNAL_TOKEN",
    "SAFI_CONTEXT_SECRET",
    "service_role"
  ];

  for (const file of browserFiles) {
    const text = readText(file);
    for (const token of forbiddenInBrowser) {
      if (text.includes(token)) {
        fail(`${relativeToRepo(file)} references privileged token ${token}.`);
      }
    }
  }
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`FAIL: ${failure}`);
  }
  process.exitCode = 1;
} else {
  console.log(
    `PASS: pinned dependencies, lockfiles, container tags${releaseMode ? ", release digests" : ""} and browser secret boundary.`
  );
}
