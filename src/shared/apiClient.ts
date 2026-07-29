import type { DataScope } from "../../shared/contracts/index.js";

export type ApiRequest = <T>(path: string, init?: RequestInit) => Promise<T>;

export function createApiClient(dataScope: DataScope): { request: ApiRequest } {
  return {
    async request<T>(path: string, init?: RequestInit) {
      const response = await fetch(path, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          "X-Data-Scope": dataScope,
          ...(init?.headers ?? {})
        }
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Request failed: ${response.status}`);
      }
      return response.json() as Promise<T>;
    }
  };
}
