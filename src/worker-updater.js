const GITHUB_API = "https://api.github.com";
const CLOUDFLARE_API = "https://api.cloudflare.com/client/v4";
const MAX_FILES = 100;
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const SOURCE_EXTENSIONS = new Set([".js", ".mjs", ".json", ".txt"]);

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
  let parsed;
  try {
    parsed = JSON.parse(configuration);
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

function workerMetadata(target, wrangler, assetToken) {
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
    bindings.push({ name: binding.binding, type: "workflow", workflow_name: binding.name });
  }
  if (wrangler.ai?.binding) bindings.push({ name: wrangler.ai.binding, type: "ai" });
  if (assetToken) bindings.push({ name: "ASSETS", type: "assets" });

  const metadata = {
    main_module: target.mainModule,
    compatibility_date: wrangler.compatibility_date || "2026-07-19",
    bindings,
  };
  if (wrangler.compatibility_flags) metadata.compatibility_flags = wrangler.compatibility_flags;
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

function githubHeaders(token) {
  return {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function readRepository(target, githubToken, fetchImpl) {
  const base = `${GITHUB_API}/repos/${target.owner}/${target.repo}`;
  const repository = await requestJson(base, { headers: githubHeaders(githubToken) }, fetchImpl);
  const branch = target.branch || repository.default_branch;
  const commit = await requestJson(
    `${base}/commits/${encodeURIComponent(branch)}`,
    { headers: githubHeaders(githubToken) },
    fetchImpl
  );
  const archiveResponse = await fetchImpl(
    `${base}/tarball/${encodeURIComponent(commit.sha)}`,
    { headers: githubHeaders(githubToken) }
  );
  const archive = await readArchive(archiveResponse);
  const files = [...archive.entries()]
    .filter(([path]) => path === "wrangler.toml" || (
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
  const wranglerFile = contents.get("wrangler.toml");
  if (!wranglerFile) throw new Error("Target repository must contain wrangler.toml");
  const wrangler = parseWranglerToml(new TextDecoder().decode(wranglerFile));
  return { sha: commit.sha, contents, wrangler };
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
  return { Authorization: `Bearer ${token}` };
}

function base64(bytes) {
  let encoded = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    encoded += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(encoded);
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

export async function updateWorker(
  target,
  { token, githubToken, accountId, fetchImpl = fetch } = {}
) {
  if (!token) throw new Error("ACCESS_TOKEN is not configured");
  target = { ...target, accountId: target.accountId || accountId };
  if (!target.accountId) throw new Error(`No Cloudflare account ID configured for ${target.name}`);
  const repository = await readRepository(target, githubToken, fetchImpl);
  target = {
    ...target,
    mainModule: repository.wrangler.main || target.mainModule,
    assetsDirectory: (repository.wrangler.assets?.directory || target.assetsDirectory).replace(/^\.\//, ""),
  };
  const assets = [...repository.contents.entries()]
    .filter(([path]) => path.startsWith(`${target.assetsDirectory}/`))
    .map(([path, bytes]) => ({ path: path.slice(target.assetsDirectory.length + 1), bytes }));
  const assetToken = await uploadAssets(target, assets, token, fetchImpl);
  const modules = [...repository.contents.entries()]
    .filter(([path]) => SOURCE_EXTENSIONS.has(path.slice(path.lastIndexOf("."))) && !path.startsWith(`${target.assetsDirectory}/`));
  const form = new FormData();
  form.append("metadata", new Blob([JSON.stringify(
    workerMetadata(target, repository.wrangler, assetToken)
  )], { type: "application/json" }), "metadata.json");
  for (const [path, bytes] of modules) {
    form.append(path, new Blob([bytes], { type: path.endsWith(".js") || path.endsWith(".mjs") ? "application/javascript+module" : "application/json" }), path);
  }
  const result = await requestJson(
    `${CLOUDFLARE_API}/accounts/${target.accountId}/workers/scripts/${encodeURIComponent(target.worker)}`,
    { method: "PUT", headers: cloudflareHeaders(token), body: form },
    fetchImpl
  );
  return { name: target.name, status: "deployed", sha: repository.sha, worker: target.worker, result };
}

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
