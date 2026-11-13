import test from "node:test";
import assert from "node:assert/strict";
import {
  parseConfiguration,
  parseRepositoryUrl,
  parseWranglerToml,
} from "../src/worker-updater.js";

test("parses HTTPS and SSH GitHub repository URLs", () => {
  assert.deepEqual(parseRepositoryUrl("https://github.com/acme/worker.git"), {
    owner: "acme",
    repo: "worker",
  });
  assert.deepEqual(parseRepositoryUrl("git@github.com:acme/worker"), {
    owner: "acme",
    repo: "worker",
  });
});

test("parses the documented configuration shape", () => {
  assert.deepEqual(parseConfiguration('{"worker1":"https://github.com/acme/one"}'), [
    {
      name: "worker1",
      owner: "acme",
      repo: "one",
      branch: undefined,
      worker: "worker1",
      accountId: undefined,
      assetsDirectory: "src/frontend",
      mainModule: "src/index.js",
    },
  ]);
});

test("parses a complete deployment target", () => {
  assert.deepEqual(parseConfiguration(JSON.stringify({
    dashboard: {
      repository: "https://github.com/acme/dashboard",
      worker: "dashboard-prod",
      accountId: "account",
      branch: "production",
      assetsDirectory: "public",
      mainModule: "src/worker.js",
    },
  })), [{
    name: "dashboard",
    owner: "acme",
    repo: "dashboard",
    worker: "dashboard-prod",
    accountId: "account",
    branch: "production",
    assetsDirectory: "public",
    mainModule: "src/worker.js",
  }]);
});

test("parses Wrangler bindings", () => {
  const config = parseWranglerToml(`
    main = "src/index.js"
    compatibility_date = "2026-07-19"
    [vars]
    MODE = "production"
    [assets]
    directory = "./src/frontend"
    [[kv_namespaces]]
    binding = "CACHE"
    id = "kv-id"
    [[d1_databases]]
    binding = "DB"
    database_id = "d1-id"
    [[workflows]]
    name = "grades"
    binding = "GRADES"
  `);
  assert.equal(config.main, "src/index.js");
  assert.equal(config.vars.MODE, "production");
  assert.equal(config.assets.directory, "./src/frontend");
  assert.deepEqual(config.kv_namespaces[0], { binding: "CACHE", id: "kv-id" });
  assert.deepEqual(config.d1_databases[0], { binding: "DB", database_id: "d1-id" });
  assert.deepEqual(config.workflows[0], { name: "grades", binding: "GRADES" });
});

test("rejects malformed configuration and non-GitHub URLs", () => {
  assert.throws(() => parseConfiguration("[]"), /JSON object/);
  assert.throws(() => parseRepositoryUrl("https://gitlab.com/acme/worker"), /Unsupported/);
});
