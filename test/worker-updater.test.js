import test from "node:test";
import assert from "node:assert/strict";
import { parseConfiguration, parseRepositoryUrl } from "../src/worker-updater.js";

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
    { name: "worker1", owner: "acme", repo: "one" },
  ]);
});

test("rejects malformed configuration and non-GitHub URLs", () => {
  assert.throws(() => parseConfiguration("[]"), /JSON object/);
  assert.throws(() => parseRepositoryUrl("https://gitlab.com/acme/worker"), /Unsupported/);
});
