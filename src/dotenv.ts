import fs from 'fs';
import path from 'path';

const DEFAULT_CANDIDATES = ['./.env', './.env.local'];

/**
 * Parse a .env-style file. Supports:
 *   KEY=value
 *   KEY="value with spaces"
 *   KEY='value'
 *   # comment lines
 *   blank lines
 * Surrounding whitespace is trimmed. Quotes are stripped if matched.
 * No variable interpolation, no multi-line, no escape sequences — keep it simple.
 */
export function parseEnvFile(contents: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

/**
 * Load a .env file into process.env. Existing process.env values are NOT
 * overwritten — explicit shell exports always win over .env.
 *
 * If `filePath` is omitted, auto-discovers ./.env then ./.env.local.
 * Returns the source path actually loaded, or null if nothing was found.
 */
export function loadDotenv(filePath?: string): string | null {
  let source: string | null = null;
  if (filePath) {
    if (!fs.existsSync(filePath)) return null;
    source = filePath;
  } else {
    for (const candidate of DEFAULT_CANDIDATES) {
      if (fs.existsSync(candidate)) {
        source = candidate;
        break;
      }
    }
  }
  if (!source) return null;

  const parsed = parseEnvFile(fs.readFileSync(source, 'utf-8'));
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
  return path.resolve(source);
}
