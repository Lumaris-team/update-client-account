const GITHUB_API = "https://api.github.com";
const CLOUDFLARE_API = "https://api.cloudflare.com/client/v4";
const MAX_FILES = 100;
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const SOURCE_EXTENSIONS = new Set([".js", ".mjs", ".json", ".txt"]);
const DEPENDENCY_EXTENSIONS = new Set([".js", ".mjs"]);

function dependencyVersion(version) {
  return version.replace(/^[~^<>=\s]*/g, "").split(" ")[0];
}

async function bundleDependencies(contents, packageJson, fetchImpl) {
  const sourceFiles = [...contents.entries()]
    .filter(([path]) => DEPENDENCY_EXTENSIONS.has(path.slice(path.lastIndexOf("."))));
  const dependencies = packageJson?.dependencies || {};
  for (const [name, version] of Object.entries(dependencies)) {
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const imported = sourceFiles.some(([, bytes]) =>
      new TextDecoder().decode(bytes).match(new RegExp(`(?:from|import\\s*\\()\\s*["']${escapedName}`))
    );
    if (!imported) continue;
    const entry = await fetchImpl(
      `https://esm.sh/${encodeURIComponent(name)}@${encodeURIComponent(dependencyVersion(version))}?bundle&target=es2022`
    );
    if (!entry.ok) throw new Error(`Cannot bundle npm dependency ${name} (${entry.status})`);
    const entryText = await entry.text();
    const bundlePath = entryText.match(/from ["'](\/[^"']+\.m?js)["']/)?.[1];
    const bundleResponse = await fetchImpl(bundlePath ? `https://esm.sh${bundlePath}` : entry.url);
    if (!bundleResponse.ok) throw new Error(`Cannot download npm bundle ${name} (${bundleResponse.status})`);
    const dependencyBytes = new Uint8Array(await bundleResponse.arrayBuffer());
    const dependencyFile = name.replace(/[^A-Za-z0-9._-]/g, "_") + ".mjs";
    for (const [path, bytes] of sourceFiles) {
      const text = new TextDecoder().decode(bytes);
      if (!new RegExp(`(?:from|import\\s*\\()\\s*["']${escapedName}["']`).test(text)) continue;
      const directory = path.slice(0, path.lastIndexOf("/"));
      const dependencyPath = `${directory}/${dependencyFile}`;
      contents.set(dependencyPath, dependencyBytes);
      contents.set(path, new TextEncoder().encode(text.replace(
        new RegExp(`(["'])${escapedName}\\1`, "g"), `$1./${dependencyFile}$1`
      )));
    }
  }
  return contents;
}

function repositoryParts(value) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error("Each repository must be a GitHub repository URL");
  }
  const match = value.trim().match(
    /^(?:https?:\/\/github\.com\/|git@github\.com:)([^/:\s]+)\/([^/\s]+?)(?:\.git)?\/?$/
  );
  if (!match) throw new Error(`Unsupported GitHub repository URL: ${value}`);
  return { owner: match[1], repo: match[2] };
}

export function parseRepositoryUrl(value) {
  return repositoryParts(value);
}

export function parseConfiguration(configuration) {
  if (typeof configuration !== "string" || configuration.trim() === "") {
    throw new Error("CONFIGURATION is missing or empty");
  }

  let source = configuration.trim().replace(/^\uFEFF/, "");
  if (source.startsWith("'") && source.endsWith("'")) {
    source = source.slice(1, -1);
  }

  let parsed;
  try {
    parsed = JSON.parse(source);
    if (typeof parsed === "string") parsed = JSON.parse(parsed.trim());
  } catch {
    throw new Error("CONFIGURATION must contain valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("CONFIGURATION must be a JSON object");
  }

  return Object.entries(parsed).map(([name, value]) => {
    const target = typeof value === "string" ? { repository: value } : value;
    if (!target || typeof target !== "object") {
      throw new Error(`Configuration for ${name} must be a repository URL or object`);
    }
    const repository = target.repository || target.url;
    const parts = repositoryParts(repository);
    return {
      name,
      ...parts,
      branch: target.branch,
      worker: target.worker || name,
      accountId: target.accountId,
      assetsDirectory: target.assetsDirectory || "src/frontend",
      mainModule: target.mainModule || "src/index.js",
    };
  });
}

function tomlValue(value) {
  const trimmed = value.trim().replace(/,$/, "");
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) return JSON.parse(trimmed);
  if (trimmed === "true" || trimmed === "false") return trimmed === "true";
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed.slice(1, -1).split(",").map((item) => tomlValue(item)).filter((item) => item !== "");
  }
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return Object.fromEntries(trimmed.slice(1, -1).split(",").map((item) => {
      const [key, ...parts] = item.split("=");
      return [key.trim(), tomlValue(parts.join("="))];
    }));
  }
  const number = Number(trimmed);
  return Number.isNaN(number) ? trimmed : number;
}

export function parseWranglerToml(source) {
  const config = { vars: {}, kv_namespaces: [], d1_databases: [], workflows: [] };
  let section = "";
  let current = null;
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+#.*$/, "").trim();
    if (!line) continue;
    const arrayTable = line.match(/^\[\[([^\]]+)\]\]$/);
    const table = arrayTable || line.match(/^\[([^\]]+)\]$/);
    if (table) {
      section = table[1];
      current = arrayTable ? {} : null;
      if (arrayTable && section === "kv_namespaces") config.kv_namespaces.push(current);
      if (arrayTable && section === "d1_databases") config.d1_databases.push(current);
      if (arrayTable && section === "workflows") config.workflows.push(current);
      continue;
    }
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    const value = tomlValue(line.slice(separator + 1));
    if (section === "vars" || section === "env.production.vars") config.vars[key] = value;
    else if (current) current[key] = value;
    else if (!section) config[key] = value;
    else config[section] = { ...(config[section] || {}), [key]: value };
  }
  return config;
}

export function parseWranglerJsonc(source) {
  const json = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/,\s*([}\]])/g, "$1");
  return JSON.parse(json);
}

function tarText(bytes, start, length) {
  return new TextDecoder().decode(bytes.subarray(start, start + length)).replace(/\0.*$/, "");
}

async function readArchive(response) {
  if (!response.ok || !response.body) {
    throw new Error(`Cannot download repository archive (${response.status})`);
  }
  const decompressed = await new Response(
    response.body.pipeThrough(new DecompressionStream("gzip"))
  ).arrayBuffer();
  const bytes = new Uint8Array(decompressed);
  const contents = new Map();
  for (let offset = 0; offset + 512 <= bytes.length;) {
    const name = tarText(bytes, offset, 100);
    if (!name) break;
    const size = parseInt(tarText(bytes, offset + 124, 12).trim() || "0", 8);
    const dataStart = offset + 512;
    if (name && size >= 0) contents.set(name.slice(name.indexOf("/") + 1), bytes.slice(dataStart, dataStart + size));
    offset = dataStart + Math.ceil(size / 512) * 512;
  }
  return contents;
}

function existingBindings(settings) {
  const bindings = settings?.bindings ||
    settings?.metadata?.bindings ||
    settings?.result?.bindings ||
    settings?.result?.settings?.bindings ||
    settings?.result?.metadata?.bindings;
  return Array.isArray(bindings) ? bindings : [];
}

export function workerMetadata(target, wrangler, assetToken, settings) {
  const bindings = [];
  for (const [name, text] of Object.entries(wrangler.vars || {})) {
    bindings.push({ name, type: "plain_text", text: String(text) });
  }
  for (const binding of wrangler.kv_namespaces || []) {
    if (!binding.binding || !binding.id) throw new Error("Every KV binding needs binding and id");
    bindings.push({ name: binding.binding, type: "kv_namespace", namespace_id: binding.id });
  }
  for (const binding of wrangler.d1_databases || []) {
    if (!binding.binding || !binding.database_id) {
      throw new Error("Every D1 binding needs binding and database_id");
    }
    bindings.push({ name: binding.binding, type: "d1", id: binding.database_id });
  }
  for (const binding of wrangler.workflows || []) {
    if (!binding.binding || !binding.name) throw new Error("Every Workflow binding needs binding and name");
    bindings.push({
      name: binding.binding,
      type: "workflow",
      workflow_name: binding.name,
      script_name: target.worker,
    });
  }
  for (const binding of wrangler.secret_texts || []) {
    if (!binding.name || typeof binding.text !== "string") {
      throw new Error("Every secret text binding needs name and text");
    }
    if (binding.text === "") continue;
    bindings.push({ type: "secret_text", name: binding.name, text: binding.text });
  }
  for (const binding of wrangler.secrets_store_secrets || []) {
    if (!binding.binding || !binding.store_id || !binding.secret_name) {
      throw new Error("Every Secret Store binding needs binding, store_id and secret_name");
    }
    bindings.push({
      name: binding.binding,
      type: "secrets_store_secret",
      store_id: binding.store_id,
      secret_name: binding.secret_name,
    });
  }
  if (wrangler.ai?.binding) bindings.push({ name: wrangler.ai.binding, type: "ai" });
  if (assetToken) bindings.push({ name: "ASSETS", type: "assets" });
  const configuredNames = new Set(bindings.map(({ name }) => name));
  for (const binding of existingBindings(settings)) {
    if (binding?.name && !configuredNames.has(binding.name)) {
      bindings.push({ name: binding.name, type: "inherit" });
    }
  }

  const metadata = {
    main_module: target.mainModule,
    compatibility_date: wrangler.compatibility_date || "2026-07-19",
    bindings,
  };
  if (wrangler.compatibility_flags) metadata.compatibility_flags = wrangler.compatibility_flags;
  if (wrangler.observability) metadata.observability = wrangler.observability;
  if (assetToken) {
    metadata.assets = {
      jwt: assetToken,
      ...(wrangler.assets?.html_handling ? { config: { html_handling: wrangler.assets.html_handling } } : {}),
    };
  }

  return metadata;
}

async function requestJson(url, options = {}, fetchImpl = fetch) {
  const response = await fetchImpl(url, options);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Request failed (${response.status}): ${body.slice(0, 300)}`);
  }
  return response.json();
}

async function readLatestVersion(target, token, fetchImpl) {
  const response = await fetchImpl(
    `${CLOUDFLARE_API}/accounts/${target.accountId}/workers/scripts/${encodeURIComponent(target.worker)}/versions`,
    { headers: cloudflareHeaders(token) }
  );
  if (!response.ok) return null;
  const body = await response.json();
  return Array.isArray(body.result) ? body.result[0] || null : null;
}

async function verifySecretStoreBindings(target, wrangler, token, latestVersion, fetchImpl) {
  const required = wrangler.secrets_store_secrets || [];
  if (!required.length) return;
  const bindings = existingBindings(latestVersion);
  if (!bindings.length) {
    throw new Error(
      `Cloudflare did not report bindings for ${target.worker}; expected MAIN_USERNAME and MAIN_PASSWORD`
    );
  }
  const names = new Set(bindings.map((binding) => binding.name));
  for (const binding of required) {
    if (!names.has(binding.binding)) {
      throw new Error(
        `Secret Store binding '${binding.binding}' was missing after deploying ${target.worker}`
      );
    }
  }
}

function githubHeaders(token) {
  return {
    Accept: "application/vnd.github+json",
    "User-Agent": "Lumaris-update-client-account",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function readRepository(target, githubToken, fetchImpl) {
  const branches = target.branch ? [target.branch] : ["main", "master"];
  let archive;
  let branch;
  for (const candidate of branches) {
    const archiveResponse = await fetchImpl(
      `https://codeload.github.com/${target.owner}/${target.repo}/tar.gz/refs/heads/${encodeURIComponent(candidate)}`
    );
    if (archiveResponse.ok) {
      archive = await readArchive(archiveResponse);
      branch = candidate;
      break;
    }
  }
  if (!archive) {
    throw new Error(
      `Cannot download public GitHub repository ${target.owner}/${target.repo}; configure its branch explicitly`
    );
  }
  const files = [...archive.entries()]
    .filter(([path]) => path === "wrangler.toml" || path === "wrangler.jsonc" || path === "package.json" || (
      (path.startsWith("src/") || path.startsWith(target.assetsDirectory)) &&
      (path.startsWith(`${target.assetsDirectory}/`) ||
        SOURCE_EXTENSIONS.has(path.slice(path.lastIndexOf("."))))
    ))
    .map(([path, bytes]) => ({ path, size: bytes.length, bytes }));
  if (files.length > MAX_FILES) {
    throw new Error(`The target contains ${files.length} files; the limit is ${MAX_FILES}`);
  }
  const contents = new Map();
  for (const file of files) {
    if (file.bytes.length > MAX_FILE_SIZE) {
      throw new Error(`File ${file.path} exceeds the ${MAX_FILE_SIZE} byte limit`);
    }
    contents.set(file.path, file.bytes);
  }
  const packageJsonFile = contents.get("package.json");
  const packageJson = packageJsonFile
    ? JSON.parse(new TextDecoder().decode(packageJsonFile))
    : null;
  await bundleDependencies(contents, packageJson, fetchImpl);
  const wranglerFile = contents.get("wrangler.jsonc") || contents.get("wrangler.toml");
  if (!wranglerFile) throw new Error("Target repository must contain wrangler.jsonc or wrangler.toml");
  const wrangler = contents.has("wrangler.jsonc")
    ? parseWranglerJsonc(new TextDecoder().decode(wranglerFile))
    : parseWranglerToml(new TextDecoder().decode(wranglerFile));
  return { sha: branch, contents, wrangler };
}

function md5(bytes) {
  // Cloudflare asset manifests require an MD5 hex digest.
  const words = new Uint32Array(16);
  const bitLength = bytes.length * 8;
  const padded = new Uint8Array((((bytes.length + 8) >> 6) + 1) * 64);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  new DataView(padded.buffer).setUint32(padded.length - 8, bitLength, true);
  const k = Array.from({ length: 64 }, (_, i) =>
    Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32)
  );
  const shifts = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  let a = 0x67452301;
  let b = 0xefcdab89;
  let c = 0x98badcfe;
  let d = 0x10325476;
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) words[i] = new DataView(padded.buffer).getUint32(offset + i * 4, true);
    let aa = a, bb = b, cc = c, dd = d;
    for (let i = 0; i < 64; i++) {
      let f, g;
      if (i < 16) { f = (bb & cc) | (~bb & dd); g = i; }
      else if (i < 32) { f = (dd & bb) | (~dd & cc); g = (5 * i + 1) % 16; }
      else if (i < 48) { f = bb ^ cc ^ dd; g = (3 * i + 5) % 16; }
      else { f = cc ^ (bb | ~dd); g = (7 * i) % 16; }
      const sum = (aa + f + k[i] + words[g]) >>> 0;
      const shift = shifts[(i % 4) + (i >= 16 ? (i >= 32 ? (i >= 48 ? 12 : 8) : 4) : 0)];
      aa = dd; dd = cc; cc = bb;
      bb = (bb + ((sum << shift) | (sum >>> (32 - shift)))) >>> 0;
    }
    a = (a + aa) >>> 0; b = (b + bb) >>> 0; c = (c + cc) >>> 0; d = (d + dd) >>> 0;
  }
  return [a, b, c, d].map((word) => new Uint8Array(new Uint32Array([word]).buffer))
    .map((bytes) => Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0")).join(""))
    .join("");
}

function cloudflareHeaders(token) {
  if (!token) {
    throw new Error("CLOUDFLARE_ACCOUNT_TOKEN is not configured");
  }
  return { Authorization: `Bearer ${token}` };
}

async function resolveSecretStoreBindings(wrangler, target, token, fetchImpl) {
  const bindings = wrangler.secrets_store_secrets || [];
  if (!bindings.length) return wrangler;
  const response = await requestJson(
    CLOUDFLARE_API + "/accounts/" + target.accountId + "/secrets_store/stores",
    { headers: cloudflareHeaders(token) },
    fetchImpl
  );
  const stores = response.result || [];
  
  let store = null;
  if (stores.length === 0) {
    throw new Error("No Secrets Store exists in the Cloudflare account");
  } else if (stores.length === 1) {
    store = stores[0];
  } else {
    store = stores.find((item) => bindings.some((binding) =>
      binding.store_id === item.id || binding.store_id === item.name
    )) || stores[0];
  }
  if (!store?.id) throw new Error("Could not resolve the Secrets Store ID");

  const secretsResponse = await requestJson(
    CLOUDFLARE_API + "/accounts/" + target.accountId + "/secrets_store/stores/" + encodeURIComponent(store.id) + "/secrets",
    { headers: cloudflareHeaders(token) },
    fetchImpl
  );
  const availableSecrets = secretsResponse.result || [];
  for (const binding of bindings) {
    if (!availableSecrets.some((secret) => secret.name === binding.secret_name)) {
      throw new Error(
        `Secret Store secret '${binding.secret_name}' was not found for binding '${binding.binding}'`
      );
    }
  }
  
  return {
    ...wrangler,
    secrets_store_secrets: bindings.map((binding) => {
      return { ...binding, store_id: store.id };
    }),
  };
}

async function resolveD1Bindings(wrangler, target, token, fetchImpl) {
  const bindings = wrangler.d1_databases || [];
  if (!bindings.length) return wrangler;
  const response = await requestJson(
    `${CLOUDFLARE_API}/accounts/${target.accountId}/d1/database`,
    { headers: cloudflareHeaders(token) },
    fetchImpl
  );
  const databases = response.result || [];
  return {
    ...wrangler,
    d1_databases: bindings.map((binding) => {
      if (binding.database_id && !binding.database_id.startsWith("__D1_ID_")) return binding;
      const database = databases.find((item) => item.name === binding.database_name);
      if (!database?.uuid) {
        throw new Error(`D1 database '${binding.database_name}' was not found`);
      }
      return { ...binding, database_id: database.uuid };
    }),
  };
}

function base64(bytes) {
  let encoded = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    encoded += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(encoded);
}

async function workerExists(target, token, fetchImpl) {
  const response = await fetchImpl(
    `${CLOUDFLARE_API}/accounts/${target.accountId}/workers/scripts/${encodeURIComponent(target.worker)}`,
    { headers: cloudflareHeaders(token) }
  );
  if (response.ok) return true;
  if (response.status === 404) return false;
  const body = await response.text();
  throw new Error(
    `Cannot inspect Worker ${target.worker} (${response.status}): ${body.slice(0, 300)}`
  );
}

async function enableWorkerSubdomain(target, token, fetchImpl) {
  const endpoint = `${CLOUDFLARE_API}/accounts/${target.accountId}/workers/subdomain`;
  const headers = cloudflareHeaders(token);
  const existing = await fetchImpl(endpoint, { headers });
  let response;
  if (existing.ok) {
    response = await existing.json();
  } else if (existing.status === 404) {
    response = await requestJson(endpoint, {
      method: "PUT",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    }, fetchImpl);
  } else {
    const body = await existing.text();
    throw new Error(`Cannot inspect Workers subdomain (${existing.status}): ${body.slice(0, 300)}`);
  }
  const subdomain = response.result?.subdomain || response.result?.name;
  return subdomain ? `${target.worker}.${subdomain}.workers.dev` : null;
}

async function uploadAssets(target, assets, token, fetchImpl) {
  if (!assets.length) return null;
  const manifest = Object.fromEntries(assets.map(({ path, bytes }) => [
    `/${path}`, { hash: md5(bytes), size: bytes.length },
  ]));
  const base = `${CLOUDFLARE_API}/accounts/${target.accountId}/workers/scripts/${encodeURIComponent(target.worker)}`;
  const session = await requestJson(`${base}/assets-upload-session`, {
    method: "POST",
    headers: { ...cloudflareHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ manifest }),
  }, fetchImpl);
  for (const bucket of session.result?.buckets || []) {
    const form = new FormData();
    for (const hash of bucket) {
      const asset = assets.find(({ bytes }) => md5(bytes) === hash);
      if (asset) form.append(hash, base64(asset.bytes));
    }
    await requestJson(`${CLOUDFLARE_API}/accounts/${target.accountId}/workers/assets/upload?base64=true`, {
      method: "POST", headers: cloudflareHeaders(session.result.jwt), body: form,
    }, fetchImpl);
  }
  return session.result.jwt;
}

/**
 * Deploy a Cloudflare Worker using the Cloudflare API.
 * Uses multipart/form-data with metadata and all module file parts.
 */
async function deployWorkerViaApi(accountId, token, workerName, modules, metadata) {
  const scriptUrl = `${CLOUDFLARE_API}/accounts/${accountId}/workers/scripts/${encodeURIComponent(workerName)}`;
  
  // Create multipart form data
  const formData = new FormData();
  const moduleName = metadata?.main_module || "src/index.js";
  
  // Add metadata part
  const metadataBlob = new Blob([JSON.stringify({
    ...(metadata || {}),
    "main_module": moduleName,
  })], { type: "application/json" });
  formData.append("metadata", metadataBlob);
  
  // Add all module file parts with correct content type
  for (const module of modules) {
    const moduleBlob = new Blob([module.content], { type: "application/javascript+module" });
    formData.append(module.name, moduleBlob);
  }
  
  const response = await fetch(scriptUrl, {
    method: "PUT",
    headers: {
      ...cloudflareHeaders(token),
    },
    body: formData,
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Cloudflare API error (${response.status}): ${errorText}`);
  }
  
  const result = await response.json();
  
  return {
    name: workerName,
    status: "updated",
    worker: workerName,
  };
}

export async function updateWorker(
  target,
  { token, githubToken, accountId, fetchImpl = fetch } = {}
) {
  if (!token) throw new Error("CLOUDFLARE_ACCOUNT_TOKEN is not configured");
  target = { ...target, accountId: target.accountId || accountId };
  if (!target.accountId) throw new Error(`No Cloudflare account ID configured for ${target.name}`);
  const existed = await workerExists(target, token, fetchImpl);
  const previousSettings = existed ? await readLatestVersion(target, token, fetchImpl) : null;
  const repository = await readRepository(target, githubToken, fetchImpl);
  target = {
    ...target,
    mainModule: repository.wrangler.main || target.mainModule,
    assetsDirectory: (repository.wrangler.assets?.directory || target.assetsDirectory).replace(/^\.\//, ""),
  };
  repository.wrangler = await resolveD1Bindings(repository.wrangler, target, token, fetchImpl);
  repository.wrangler = await resolveSecretStoreBindings(repository.wrangler, target, token, fetchImpl);
  const assets = [...repository.contents.entries()]
    .filter(([path]) => path.startsWith(`${target.assetsDirectory}/`))
    .map(([path, bytes]) => ({ path: path.slice(target.assetsDirectory.length + 1), bytes }));
  const assetToken = await uploadAssets(target, assets, token, fetchImpl);
  
  // Deploy the worker via Cloudflare API (replaces npx wrangler deploy)
  const metadata = workerMetadata(target, repository.wrangler, assetToken, previousSettings);
  
  // Collect all modules needed for deployment
  const modules = [...repository.contents.entries()]
    .filter(([path]) =>
      SOURCE_EXTENSIONS.has(path.slice(path.lastIndexOf("."))) &&
      path !== "wrangler.toml" &&
      path !== "wrangler.jsonc" &&
      path !== "package.json" &&
      !path.startsWith(`${target.assetsDirectory}/`)
    )
    .map(([path, bytes]) => ({
      name: path,
      content: new TextDecoder().decode(bytes),
    }));
  
  const deployResult = await deployWorkerViaApi(
    accountId,
    token,
    target.name,
    modules,
    metadata
  );
  console.error("[UPDATE-CLIENT] worker deploy termine : " + JSON.stringify(deployResult));
  return {
    name: target.name,
    status: existed ? "updated" : "created",
    sha: repository.sha,
    worker: target.worker,
    deployResult,
  };}

export async function updateWorkers(
  configuration,
  { token, githubToken, accountId, fetchImpl = fetch } = {}
) {
  const results = [];
  for (const target of parseConfiguration(configuration)) {
    try {
      results.push(await updateWorker(target, { token, githubToken, accountId, fetchImpl }));
    } catch (error) {
      results.push({ name: target.name, status: "error", error: error instanceof Error ? error.message : String(error) });
    }
  }
  return results;
}
