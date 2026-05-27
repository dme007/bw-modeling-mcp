import fs from 'fs';
import path from 'path';
import os from 'os';
import type { BwConfig } from './bw-client.js';

export interface CliFlags {
  url?: string;
  user?: string;
  password?: string;
  client?: string;
  language?: string;
  configFile?: string;
}

const DEFAULT_FILE_CANDIDATES = [
  './.bwc.json',
  './bw-cli.json',
  path.join(os.homedir(), '.config', 'bw-cli.json'),
  path.join(os.homedir(), '.bwc.json'),
  path.join(os.homedir(), '.bw-cli.json'),
];

interface FileConfig {
  url?: string;
  user?: string;
  password?: string;
  client?: string;
  language?: string;
}

function readConfigFile(explicitPath?: string): { config: FileConfig; source: string | null } {
  if (explicitPath) {
    if (!fs.existsSync(explicitPath)) {
      throw new Error(`Config file not found: ${explicitPath}`);
    }
    const config = JSON.parse(fs.readFileSync(explicitPath, 'utf-8')) as FileConfig;
    return { config, source: explicitPath };
  }
  for (const candidate of DEFAULT_FILE_CANDIDATES) {
    if (fs.existsSync(candidate)) {
      const config = JSON.parse(fs.readFileSync(candidate, 'utf-8')) as FileConfig;
      return { config, source: candidate };
    }
  }
  return { config: {}, source: null };
}

export interface ResolvedConfig extends BwConfig {
  configFileSource: string | null;
}

/**
 * Merge config in the conventional CLI priority:
 *   CLI flags > environment > config file > defaults.
 * A more specific source overrides a more general one.
 */
export function resolveConfig(flags: CliFlags): ResolvedConfig {
  const { config: fileCfg, source: configFileSource } = readConfigFile(flags.configFile);

  const url = flags.url ?? process.env.BW_URL ?? fileCfg.url;
  const user = flags.user ?? process.env.BW_USER ?? fileCfg.user;
  const password = flags.password ?? process.env.BW_PASSWORD ?? fileCfg.password;
  const client = flags.client ?? process.env.BW_CLIENT ?? fileCfg.client ?? '001';
  const language = flags.language ?? process.env.BW_LANGUAGE ?? fileCfg.language;

  const missing: string[] = [];
  if (!url) missing.push('url (BW_URL / --url / config.url)');
  if (!user) missing.push('user (BW_USER / --user / config.user)');
  if (!password) missing.push('password (BW_PASSWORD / --password / config.password)');
  if (missing.length > 0) {
    throw new Error(`Missing required configuration: ${missing.join(', ')}`);
  }

  return { url: url!, user: user!, password: password!, client, language, configFileSource };
}
