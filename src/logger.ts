import type { AxiosInstance, InternalAxiosRequestConfig, AxiosResponse } from 'axios';

export type LogLevel = 'silent' | 'compact' | 'verbose';

export interface HttpLogger {
  level: LogLevel;
  attach(http: AxiosInstance): void;
}

interface RequestMeta {
  startedAt: number;
}

const REQUEST_META = Symbol('bw-cli:requestMeta');

function colorStatus(status: number): string {
  // ANSI: red 4xx/5xx, green 2xx, yellow 3xx, dim otherwise
  if (status >= 500) return `\x1b[31m${status}\x1b[0m`;
  if (status >= 400) return `\x1b[31m${status}\x1b[0m`;
  if (status >= 300) return `\x1b[33m${status}\x1b[0m`;
  if (status >= 200) return `\x1b[32m${status}\x1b[0m`;
  return `${status}`;
}

function truncate(s: string, max = 2000): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + `\n… [truncated, ${s.length - max} more bytes]`;
}

function stringifyHeaders(headers: Record<string, unknown> | undefined): string {
  if (!headers) return '';
  return Object.entries(headers)
    .filter(([k]) => k.toLowerCase() !== 'authorization')
    .map(([k, v]) => `  ${k}: ${v}`)
    .join('\n');
}

export function createLogger(level: LogLevel): HttpLogger {
  return {
    level,
    attach(http: AxiosInstance): void {
      if (level === 'silent') return;

      http.interceptors.request.use((config: InternalAxiosRequestConfig) => {
        (config as any)[REQUEST_META] = { startedAt: Date.now() } satisfies RequestMeta;
        if (level === 'verbose') {
          const method = (config.method ?? 'GET').toUpperCase();
          const url = (config.baseURL ?? '') + (config.url ?? '');
          process.stderr.write(`\n→ ${method} ${url}\n`);
          const headers = stringifyHeaders(config.headers as Record<string, unknown>);
          if (headers) process.stderr.write(headers + '\n');
          if (config.data) {
            const body = typeof config.data === 'string' ? config.data : JSON.stringify(config.data);
            process.stderr.write(`\n${truncate(body)}\n`);
          }
        }
        return config;
      });

      http.interceptors.response.use(
        (response: AxiosResponse) => {
          const meta = (response.config as any)[REQUEST_META] as RequestMeta | undefined;
          const ms = meta ? Date.now() - meta.startedAt : 0;
          const method = (response.config.method ?? 'GET').toUpperCase();
          const url = (response.config.baseURL ?? '') + (response.config.url ?? '');
          if (level === 'compact') {
            process.stderr.write(`→ ${method} ${url} ${colorStatus(response.status)} (${ms}ms)\n`);
            if (response.status >= 400) {
              const body = typeof response.data === 'string'
                ? response.data
                : JSON.stringify(response.data);
              process.stderr.write(`${truncate(body, 1500)}\n`);
            }
          } else {
            process.stderr.write(`\n← ${colorStatus(response.status)} ${method} ${url} (${ms}ms)\n`);
            const respHeaders = stringifyHeaders(response.headers as Record<string, unknown>);
            if (respHeaders) process.stderr.write(respHeaders + '\n');
            const body = typeof response.data === 'string'
              ? response.data
              : JSON.stringify(response.data);
            if (body) process.stderr.write(`\n${truncate(body)}\n`);
          }
          return response;
        },
        (error) => {
          process.stderr.write(`✗ Network error: ${error?.message ?? error}\n`);
          return Promise.reject(error);
        }
      );
    },
  };
}
