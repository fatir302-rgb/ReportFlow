const API_BASE = "https://api.clockify.me/api/v1";

async function clockifyFetch<T>(apiKey: string, path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { "X-Api-Key": apiKey, Accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Clockify request failed (${response.status}): ${text.slice(0, 300)}`);
  }
  return response.json() as Promise<T>;
}

export async function validateClockifyKey(apiKey: string) {
  return clockifyFetch<{ id: string; name?: string; email?: string }>(apiKey, "/user");
}

export async function getClockifyWorkspaces(apiKey: string) {
  return clockifyFetch<Array<{ id: string; name: string }>>(apiKey, "/workspaces");
}

export async function getClockifyProjects(apiKey: string, workspaceId: string) {
  const all: Array<{ id: string; name: string; archived?: boolean }> = [];
  let page = 1;
  while (true) {
    const batch = await clockifyFetch<Array<{ id: string; name: string; archived?: boolean }>>(
      apiKey,
      `/workspaces/${encodeURIComponent(workspaceId)}/projects?page=${page}&page-size=200&sort-column=NAME&sort-order=ASCENDING`
    );
    all.push(...batch);
    if (batch.length < 200) break;
    page += 1;
  }
  return all;
}
