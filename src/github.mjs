// No SDK, checkout, or code/artifacts from the failing run are required.
export class GitHub {
  constructor(token, request = fetch) {
    this.token = token;
    this.request = request;
  }

  async call(path, method = "GET", body) {
    const response = await this.request(`https://api.github.com${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
      redirect: "error",
    });
    if (!response.ok) {
      // Never include API bodies, tokens, or log contents in Actions output.
      const error = new Error(`GitHub ${method} ${path.split("?")[0]} returned ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return response.status === 204 ? undefined : response.json();
  }

  async list(path, key) {
    const results = [];
    for (let page = 1; page <= 100; page++) {
      const response = await this.call(
        `${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`,
      );
      const items = key ? response[key] : response;
      if (!Array.isArray(items)) throw new Error("Unexpected GitHub list response");
      results.push(...items);
      if (items.length < 100) return results;
    }
    throw new Error("GitHub pagination limit reached; refusing an incomplete safety check");
  }
}
