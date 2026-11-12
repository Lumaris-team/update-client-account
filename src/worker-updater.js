const GITHUB_API = "https://api.github.com";

export function parseRepositoryUrl(value) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error("Each CONFIGURATION value must be a GitHub repository URL");
  }

  const input = value.trim();
  const match = input.match(
    /^(?:https?:\/\/github\.com\/|git@github\.com:)([^/:\s]+)\/([^/\s]+?)(?:\.git)?\/?$/
  );

  if (!match) {
    throw new Error(`Unsupported GitHub repository URL: ${value}`);
  }

  return { owner: match[1], repo: match[2] };
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

  return Object.entries(parsed).map(([name, value]) => ({
    name,
    ...parseRepositoryUrl(value),
  }));
}

async function githubRequest(path, token, fetchImpl) {
  const response = await fetchImpl(`${GITHUB_API}${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub API ${response.status}: ${body.slice(0, 300)}`);
  }

  return response.json();
}

async function dispatchWorkflow({ owner, repo, workflow, ref, sha, token, fetchImpl }) {
  const response = await fetchImpl(
    `${GITHUB_API}/repos/${owner}/${repo}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({
        ref,
        inputs: { commit_sha: sha },
      }),
    }
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Workflow dispatch ${response.status}: ${body.slice(0, 300)}`);
  }
}

export async function updateWorker(
  target,
  { token, fetchImpl = fetch, workflow = "deploy-worker.yml" } = {}
) {
  const repository = await githubRequest(
    `/repos/${target.owner}/${target.repo}`,
    token,
    fetchImpl
  );
  const ref = repository.default_branch;
  const latestCommit = await githubRequest(
    `/repos/${target.owner}/${target.repo}/commits/${encodeURIComponent(ref)}`,
    token,
    fetchImpl
  );
  const runs = await githubRequest(
    `/repos/${target.owner}/${target.repo}/actions/workflows/${encodeURIComponent(
      workflow
    )}/runs?branch=${encodeURIComponent(ref)}&status=success&per_page=1`,
    token,
    fetchImpl
  );
  const deployedSha = runs.workflow_runs?.[0]?.head_sha;

  if (deployedSha === latestCommit.sha) {
    return { name: target.name, status: "up-to-date", sha: latestCommit.sha };
  }

  await dispatchWorkflow({
    ...target,
    workflow,
    ref,
    sha: latestCommit.sha,
    token,
    fetchImpl,
  });

  return {
    name: target.name,
    status: "dispatched",
    sha: latestCommit.sha,
    previousSha: deployedSha || null,
  };
}

export async function updateWorkers(
  configuration,
  { token, fetchImpl = fetch, workflow = "deploy-worker.yml" } = {}
) {
  if (!token) {
    throw new Error("FULL_ACCESS_TOKEN is not configured");
  }

  const targets = parseConfiguration(configuration);
  const results = [];

  for (const target of targets) {
    try {
      results.push(await updateWorker(target, { token, fetchImpl, workflow }));
    } catch (error) {
      results.push({
        name: target.name,
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return results;
}
