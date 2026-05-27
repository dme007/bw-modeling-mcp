#!/usr/bin/env node
import { createClientFromConfig } from './bw-client.js';
import { resolveConfig, CliFlags } from './config.js';
import { createLogger, LogLevel } from './logger.js';
import { dispatchTool, TOOL_NAMES, UnknownToolError } from './dispatch.js';
import { loadDotenv } from './dotenv.js';

interface ParsedArgs {
  command: string | null;
  flags: Record<string, string | boolean>;
  positional: string[];
}

const KNOWN_GLOBAL_FLAGS = new Set([
  'url', 'user', 'password', 'client', 'language',
  'config', 'env-file', 'verbose', 'v', 'vv', 'help', 'h',
  'args-json',
]);

function parseArgs(argv: string[]): ParsedArgs {
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];
  let command: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];

    if (token.startsWith('--')) {
      const eq = token.indexOf('=');
      if (eq > -1) {
        flags[token.slice(2, eq)] = token.slice(eq + 1);
      } else {
        const key = token.slice(2);
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith('--') && !next.startsWith('-')) {
          flags[key] = next;
          i++;
        } else {
          flags[key] = true;
        }
      }
    } else if (token.startsWith('-') && token.length > 1) {
      // short flags: -v, -vv, -h
      flags[token.slice(1)] = true;
    } else if (command === null) {
      command = token;
    } else {
      positional.push(token);
    }
  }

  return { command, flags, positional };
}

function logLevelFrom(flags: Record<string, string | boolean>): LogLevel {
  if (flags.vv || flags.verbose === 'verbose') return 'verbose';
  if (flags.v || flags.verbose) return 'compact';
  return 'silent';
}

function printGlobalHelp(): void {
  process.stderr.write(`bw-cli — CLI for bw-modeling-mcp tools

Usage:
  bw-cli <tool-name> [--key value]... [--args-json '<json>']
  bw-cli ping
  bw-cli list-tools
  bw-cli --help

Configuration (priority: CLI flags > env > config file):
  --url <url>            BW system URL  (env: BW_URL)
  --user <user>          SAP user       (env: BW_USER)
  --password <pw>        SAP password   (env: BW_PASSWORD)
  --client <n>           SAP client     (env: BW_CLIENT, default 001)
  --language <code>      SAP language   (env: BW_LANGUAGE)
  --config <path>        JSON config file. If omitted, the first existing file from this list is used:
                           ./.bwc.json
                           ./bw-cli.json
                           ~/.config/bw-cli.json
                           ~/.bwc.json
                           ~/.bw-cli.json
  --env-file <path>      .env file with BW_* variables. Auto-discovers ./.env or ./.env.local
                         if omitted. Existing shell env always wins over file values.

Logging:
  -v / --verbose         Log each HTTP request on stderr (status + duration)
  -vv                    Verbose: full headers, request body, response body

Tool arguments:
  --key value            Set a tool argument (string/number/boolean parsed automatically).
                         Nested values: use --args-json instead.
  --args-json '<json>'   Pass the full args object as JSON. Overrides individual --key flags.

Examples:
  bw-cli ping
  bw-cli bw_get_adso --adso_name ZADSO_DEMO
  bw-cli bw_search --search_term 'Z*' --object_type ADSO -v
  bw-cli bw_query_data --args-json '{"comp_id":"ADSO_X","is_provider":true}' -vv

Run \`bw-cli list-tools\` to see all available tools.
`);
}

function printToolList(): void {
  process.stderr.write('Available tools:\n');
  for (const name of TOOL_NAMES) {
    process.stderr.write(`  ${name}\n`);
  }
  process.stderr.write('\nplus built-ins:  ping, list-tools\n');
}

/**
 * Convert flag values to their natural JS types:
 *   "true"/"false" → boolean, numeric strings → number, otherwise string.
 * Reserved global flags are skipped.
 */
function buildToolArgs(
  flags: Record<string, string | boolean>,
): Record<string, unknown> {
  if (typeof flags['args-json'] === 'string') {
    try {
      return JSON.parse(flags['args-json'] as string) as Record<string, unknown>;
    } catch (err) {
      throw new Error(`--args-json: invalid JSON: ${(err as Error).message}`);
    }
  }

  const args: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(flags)) {
    if (KNOWN_GLOBAL_FLAGS.has(key)) continue;
    if (typeof value === 'boolean') {
      args[key] = value;
      continue;
    }
    if (value === 'true') { args[key] = true; continue; }
    if (value === 'false') { args[key] = false; continue; }
    if (value !== '' && !isNaN(Number(value))) {
      args[key] = Number(value);
      continue;
    }
    args[key] = value;
  }
  return args;
}

async function runPing(client: ReturnType<typeof createClientFromConfig>): Promise<void> {
  process.stderr.write('Pinging BW system…\n');
  // Triggers CSRF fetch + session establishment via systeminfo endpoint.
  await client.loadMediaTypes();
  process.stderr.write('✓ CSRF token fetched, session established.\n');
  process.stderr.write(`Session cookies: ${JSON.stringify(Object.keys(client.sessionInfo()))}\n`);
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const { command, flags } = parseArgs(argv);

  if (!command || flags.help || flags.h) {
    printGlobalHelp();
    return command ? 0 : 1;
  }

  if (command === 'list-tools') {
    printToolList();
    return 0;
  }

  const envFile = typeof flags['env-file'] === 'string' ? flags['env-file'] as string : undefined;
  const loadedEnvFile = loadDotenv(envFile);
  if (loadedEnvFile) {
    process.stderr.write(`[config] loaded env file ${loadedEnvFile}\n`);
  } else if (envFile) {
    process.stderr.write(`Env file not found: ${envFile}\n`);
    return 2;
  }

  const cliFlags: CliFlags = {
    url: typeof flags.url === 'string' ? flags.url : undefined,
    user: typeof flags.user === 'string' ? flags.user : undefined,
    password: typeof flags.password === 'string' ? flags.password : undefined,
    client: typeof flags.client === 'string' ? flags.client : undefined,
    language: typeof flags.language === 'string' ? flags.language : undefined,
    configFile: typeof flags.config === 'string' ? flags.config : undefined,
  };

  let config;
  try {
    config = resolveConfig(cliFlags);
  } catch (err) {
    process.stderr.write(`Configuration error: ${(err as Error).message}\n`);
    return 2;
  }

  if (config.configFileSource) {
    process.stderr.write(`[config] loaded ${config.configFileSource}\n`);
  }
  process.stderr.write(`[config] URL=${config.url}  USER=${config.user}  CLIENT=${config.client}${config.language ? `  LANG=${config.language}` : ''}\n`);

  const logger = createLogger(logLevelFrom(flags));
  const client = createClientFromConfig(config, logger);

  try {
    if (command === 'ping') {
      await runPing(client);
      return 0;
    }

    if (!TOOL_NAMES.includes(command as typeof TOOL_NAMES[number])) {
      process.stderr.write(`Unknown command/tool: ${command}\n\n`);
      printToolList();
      return 1;
    }

    // Tools that need media types resolved (most write operations); cheap to always run.
    await client.loadMediaTypes().catch((err) => {
      process.stderr.write(`[warn] discovery failed: ${err}\n`);
    });

    const toolArgs = buildToolArgs(flags);
    const result = await dispatchTool(client, command, toolArgs);
    process.stdout.write(result);
    if (!result.endsWith('\n')) process.stdout.write('\n');
    return 0;
  } catch (err) {
    if (err instanceof UnknownToolError) {
      process.stderr.write(`${err.message}\n`);
      return 1;
    }
    process.stderr.write(`\n✗ ${(err as Error).message ?? err}\n`);
    return 1;
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`Fatal: ${err?.stack ?? err}\n`);
    process.exit(1);
  },
);
