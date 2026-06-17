import fs from 'fs';
import path from 'path';
import os from 'os';
import { BwClient } from './bw-client.js';
import { dispatchTool } from './dispatch.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TestPlan {
  adso?: { name: string; transformation_uuid?: string; dtp_uuid?: string };
  infoobject?: { name: string };
  infoarea?: { name: string };
  query?: { name: string };
  process_chain?: { name: string; first_variant?: { type: string; name: string } };
  composite_provider?: { name: string };
  ckf?: { name: string };
  rkf?: { name: string };
  structure?: { name: string };
  datasource?: { name: string; source_system: string };
  source_system?: { name: string };
  search?: { term: string; type?: string };
  xref?: { type: string; name: string };
  filter_values?: { characteristic: string; search: string };
  dataflow?: { object_name: string; object_type: string };
}

interface CheckResult {
  tool: string;
  argSummary: string;
  status: 'ok' | 'failed' | 'skipped';
  durationMs: number;
  message: string;
  output?: string;
  error?: string;
}

const DEFAULT_PLAN_CANDIDATES = [
  './.bwc.test.json',
  path.join(os.homedir(), '.config', 'bw-cli-test.json'),
  path.join(os.homedir(), '.bwc.test.json'),
];

// ── Plan loading / writing ────────────────────────────────────────────────────

export function findPlanPath(explicit?: string): string | null {
  if (explicit) return fs.existsSync(explicit) ? explicit : null;
  for (const cand of DEFAULT_PLAN_CANDIDATES) {
    if (fs.existsSync(cand)) return cand;
  }
  return null;
}

export function loadPlan(explicit?: string): { plan: TestPlan; source: string | null } {
  const p = findPlanPath(explicit);
  if (!p) return { plan: {}, source: null };
  const plan = JSON.parse(fs.readFileSync(p, 'utf-8')) as TestPlan;
  return { plan, source: p };
}

export function planSkeleton(): TestPlan {
  return {
    adso: { name: 'YOUR_ADSO_HERE' },
    infoobject: { name: 'YOUR_INFOOBJECT_HERE' },
    infoarea: { name: 'YOUR_INFOAREA_HERE' },
    query: { name: 'YOUR_QUERY_HERE' },
    process_chain: { name: 'YOUR_CHAIN_HERE' },
    composite_provider: { name: 'YOUR_HCPR_HERE' },
    ckf: { name: 'YOUR_CKF_HERE' },
    rkf: { name: 'YOUR_RKF_HERE' },
    structure: { name: 'YOUR_STRUCTURE_HERE' },
    datasource: { name: 'YOUR_DATASOURCE_HERE', source_system: 'YOUR_SOURCE_SYSTEM_HERE' },
    source_system: { name: 'YOUR_SOURCE_SYSTEM_HERE' },
    search: { term: 'Z*', type: 'ADSO' },
    xref: { type: 'ADSO', name: 'YOUR_ADSO_HERE' },
    filter_values: { characteristic: 'YOUR_CHARACTERISTIC_HERE', search: '*' },
    dataflow: { object_name: 'YOUR_ADSO_HERE', object_type: 'ADSO' },
  };
}

export function writePlan(plan: TestPlan, target: string): void {
  fs.writeFileSync(target, JSON.stringify(plan, null, 2) + '\n', 'utf-8');
}

/**
 * Try to auto-discover one example object per type using bw_search.
 * Falls back to the skeleton placeholder if a type has no result.
 */
export async function buildAutoPlan(client: BwClient): Promise<TestPlan> {
  const skel = planSkeleton();
  const findFirst = async (objectType: string): Promise<string | null> => {
    try {
      const out = await dispatchTool(client, 'bw_search', { search_term: '*', object_type: objectType });
      // bw_search output starts with "BW Search: …\n\nFound N result(s):\n\n1. NAME (TYPE) — …"
      const m = out.match(/^\s*1\.\s+(\S+)/m);
      return m?.[1] ?? null;
    } catch {
      return null;
    }
  };
  const adso = await findFirst('ADSO');
  const iobj = await findFirst('IOBJ');
  const area = await findFirst('AREA');
  const query = await findFirst('ELEM');
  const chain = await findFirst('RSPC');
  const hcpr = await findFirst('HCPR');
  const rsds = await findFirst('RSDS');
  const lsys = await findFirst('LSYS');

  return {
    ...skel,
    ...(adso && { adso: { name: adso } }),
    ...(iobj && { infoobject: { name: iobj } }),
    ...(area && { infoarea: { name: area } }),
    ...(query && { query: { name: query } }),
    ...(chain && { process_chain: { name: chain } }),
    ...(hcpr && { composite_provider: { name: hcpr } }),
    ...(rsds && lsys && { datasource: { name: rsds, source_system: lsys } }),
    ...(lsys && { source_system: { name: lsys } }),
    ...(adso && { xref: { type: 'ADSO', name: adso } }),
    ...(adso && { dataflow: { object_name: adso, object_type: 'ADSO' } }),
    ...(iobj && { filter_values: { characteristic: iobj, search: '*' } }),
  };
}

// ── Check definitions ─────────────────────────────────────────────────────────

interface Check {
  name: string;
  /** Build args object, or return null to skip. Receives auto-resolve cache. */
  buildArgs: (plan: TestPlan, cache: ResolveCache) => Promise<Record<string, unknown> | null>;
  /** Short text for the "args" column (e.g. "ZADSO_DEMO"). */
  describe?: (args: Record<string, unknown>) => string;
  /** One-line summary derived from the tool's text output (truncated). */
  summarize?: (output: string) => string;
}

interface ResolveCache {
  client: BwClient;
  // Resolved on demand, cached for the run
  transformationFor?: Map<string, string | null>;   // adsoName → trfn uuid
  dtpFor?: Map<string, string | null>;              // adsoName → dtp uuid
  firstVariantFor?: Map<string, { type: string; name: string } | null>;
}

async function resolveTransformationFor(adsoName: string, cache: ResolveCache): Promise<string | null> {
  if (!cache.transformationFor) cache.transformationFor = new Map();
  if (cache.transformationFor.has(adsoName)) return cache.transformationFor.get(adsoName)!;
  try {
    const out = await dispatchTool(cache.client, 'bw_xref', { object_type: 'ADSO', object_name: adsoName });
    // Look for "1. <UUID> (TRFN) …" — TRFN names are 32-char hex
    const m = out.match(/^\s*\d+\.\s+([0-9A-F]{32})\s+\(TRFN\)/m);
    const uuid = m?.[1] ?? null;
    cache.transformationFor.set(adsoName, uuid);
    return uuid;
  } catch {
    cache.transformationFor.set(adsoName, null);
    return null;
  }
}

async function resolveDtpFor(adsoName: string, cache: ResolveCache): Promise<string | null> {
  if (!cache.dtpFor) cache.dtpFor = new Map();
  if (cache.dtpFor.has(adsoName)) return cache.dtpFor.get(adsoName)!;
  try {
    const out = await dispatchTool(cache.client, 'bw_get_dtps', { object_type: 'ADSO', object_name: adsoName });
    const m = out.match(/^\s*\d+\.\s+([0-9A-F]{32})/m);
    const uuid = m?.[1] ?? null;
    cache.dtpFor.set(adsoName, uuid);
    return uuid;
  } catch {
    cache.dtpFor.set(adsoName, null);
    return null;
  }
}

async function resolveFirstVariantOf(chainName: string, cache: ResolveCache): Promise<{ type: string; name: string } | null> {
  if (!cache.firstVariantFor) cache.firstVariantFor = new Map();
  if (cache.firstVariantFor.has(chainName)) return cache.firstVariantFor.get(chainName)!;
  try {
    const out = await dispatchTool(cache.client, 'bw_get_process_chain', { chain_name: chainName, include_variant_details: false });
    // Match the first "type=ABAP variant=PROG_X" pattern (output format dependent)
    const m = out.match(/type[=:]\s*([A-Z_0-9]+)[\s,]+variant[=:]\s*(\S+)/i);
    const v = m ? { type: m[1], name: m[2] } : null;
    cache.firstVariantFor.set(chainName, v);
    return v;
  } catch {
    cache.firstVariantFor.set(chainName, null);
    return null;
  }
}

const CHECKS: Check[] = [
  { name: 'bw_list_source_systems', buildArgs: async () => ({}) },
  { name: 'bw_list_contents', buildArgs: async () => ({ path: '' }) },
  { name: 'bw_get_roles', buildArgs: async () => ({}) },
  { name: 'bw_get_role_queries', buildArgs: async () => ({}) },

  {
    name: 'bw_search',
    buildArgs: async (p) => p.search ? { search_term: p.search.term, object_type: p.search.type } : null,
    describe: (a) => `${a.search_term}${a.object_type ? `,${a.object_type}` : ''}`,
  },
  {
    name: 'bw_xref',
    buildArgs: async (p) => p.xref ? { object_type: p.xref.type, object_name: p.xref.name } : null,
    describe: (a) => `${a.object_type} ${a.object_name}`,
  },
  {
    name: 'bw_get_adso',
    buildArgs: async (p) => p.adso ? { adso_name: p.adso.name } : null,
    describe: (a) => a.adso_name as string,
  },
  {
    name: 'bw_get_infoobject',
    buildArgs: async (p) => p.infoobject ? { infoobject_name: p.infoobject.name } : null,
    describe: (a) => a.infoobject_name as string,
  },
  {
    name: 'bw_get_infoarea',
    buildArgs: async (p) => p.infoarea ? { name: p.infoarea.name } : null,
    describe: (a) => a.name as string,
  },
  {
    name: 'bw_get_query',
    buildArgs: async (p) => p.query ? { query_name: p.query.name } : null,
    describe: (a) => a.query_name as string,
  },
  {
    name: 'bw_get_query_roles',
    buildArgs: async (p) => p.query ? { query_name: p.query.name } : null,
    describe: (a) => a.query_name as string,
  },
  {
    name: 'bw_get_process_chain',
    buildArgs: async (p) => p.process_chain ? { chain_name: p.process_chain.name } : null,
    describe: (a) => a.chain_name as string,
  },
  {
    name: 'bw_get_process_variant',
    buildArgs: async (p, cache) => {
      const explicit = p.process_chain?.first_variant;
      if (explicit) return { process_type: explicit.type, variant_name: explicit.name };
      if (!p.process_chain?.name) return null;
      const v = await resolveFirstVariantOf(p.process_chain.name, cache);
      return v ? { process_type: v.type, variant_name: v.name } : null;
    },
    describe: (a) => `${a.process_type} ${a.variant_name}`,
  },
  {
    name: 'bw_get_composite_provider',
    buildArgs: async (p) => p.composite_provider ? { composite_provider_name: p.composite_provider.name } : null,
    describe: (a) => a.composite_provider_name as string,
  },
  {
    name: 'bw_get_ckf',
    buildArgs: async (p) => p.ckf ? { component_name: p.ckf.name } : null,
    describe: (a) => a.component_name as string,
  },
  {
    name: 'bw_get_rkf',
    buildArgs: async (p) => p.rkf ? { component_name: p.rkf.name } : null,
    describe: (a) => a.component_name as string,
  },
  {
    name: 'bw_get_structure',
    buildArgs: async (p) => p.structure ? { component_name: p.structure.name } : null,
    describe: (a) => a.component_name as string,
  },
  {
    name: 'bw_list_datasources',
    buildArgs: async (p) => p.source_system ? { source_system: p.source_system.name } : null,
    describe: (a) => a.source_system as string,
  },
  {
    name: 'bw_get_source_system',
    buildArgs: async (p) => p.source_system ? { source_system: p.source_system.name } : null,
    describe: (a) => a.source_system as string,
  },
  {
    name: 'bw_get_datasource',
    buildArgs: async (p) => p.datasource ? { datasource_name: p.datasource.name, source_system: p.datasource.source_system } : null,
    describe: (a) => `${a.datasource_name}@${a.source_system}`,
  },
  {
    name: 'bw_preview_datasource',
    buildArgs: async (p) => p.datasource ? { datasource_name: p.datasource.name, source_system: p.datasource.source_system, records: 5 } : null,
    describe: (a) => `${a.datasource_name}@${a.source_system}`,
  },
  {
    name: 'bw_get_filter_values',
    buildArgs: async (p) => p.filter_values ? { characteristic_name: p.filter_values.characteristic, search_string: p.filter_values.search } : null,
    describe: (a) => `${a.characteristic_name} '${a.search_string}'`,
  },
  {
    name: 'bw_get_dataflow',
    buildArgs: async (p) => p.dataflow ? { object_name: p.dataflow.object_name, object_type: p.dataflow.object_type } : null,
    describe: (a) => `${a.object_type} ${a.object_name}`,
  },
  {
    name: 'bw_get_dtps',
    buildArgs: async (p) => p.xref ? { object_type: p.xref.type, object_name: p.xref.name } : null,
    describe: (a) => `${a.object_type} ${a.object_name}`,
  },
  {
    name: 'bw_get_transformation',
    buildArgs: async (p, cache) => {
      const explicit = p.adso?.transformation_uuid;
      if (explicit) return { transformation_name: explicit };
      if (!p.adso?.name) return null;
      const uuid = await resolveTransformationFor(p.adso.name, cache);
      return uuid ? { transformation_name: uuid } : null;
    },
    describe: (a) => (a.transformation_name as string).slice(0, 12) + '…',
  },
  {
    name: 'bw_get_dtp',
    buildArgs: async (p, cache) => {
      const explicit = p.adso?.dtp_uuid;
      if (explicit) return { dtp_name: explicit };
      if (!p.adso?.name) return null;
      const uuid = await resolveDtpFor(p.adso.name, cache);
      return uuid ? { dtp_name: uuid } : null;
    },
    describe: (a) => (a.dtp_name as string).slice(0, 12) + '…',
  },
  {
    name: 'bw_get_push_schema',
    buildArgs: async (p) => p.adso ? { adso_name: p.adso.name } : null,
    describe: (a) => a.adso_name as string,
  },
];

// ── Runner ────────────────────────────────────────────────────────────────────

function shortMessage(output: string): string {
  // Take first non-empty line, strip leading icons / status, truncate.
  const line = output.split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? '';
  return line.length > 80 ? line.slice(0, 77) + '…' : line;
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

export interface RunOptions {
  client: BwClient;
  plan: TestPlan;
  include?: Set<string>;
  exclude?: Set<string>;
  failFast?: boolean;
  verbose?: boolean;       // -v: tabular + summary (default behaviour)
  veryVerbose?: boolean;   // -vv: also print tool outputs after each check
}

export async function runTests(opts: RunOptions): Promise<{ exitCode: number; results: CheckResult[] }> {
  const cache: ResolveCache = { client: opts.client };
  const results: CheckResult[] = [];

  const selected = CHECKS.filter((c) => {
    if (opts.include && !opts.include.has(c.name)) return false;
    if (opts.exclude && opts.exclude.has(c.name)) return false;
    return true;
  });

  process.stderr.write(`bw-cli test-run — ${selected.length} checks\n\n`);

  let okCount = 0, failedCount = 0, skippedCount = 0;

  for (const check of selected) {
    const t0 = Date.now();
    let args: Record<string, unknown> | null;
    try {
      args = await check.buildArgs(opts.plan, cache);
    } catch (err) {
      args = null;
      // Treat as skipped — couldn't even build args
      results.push({
        tool: check.name,
        argSummary: '',
        status: 'skipped',
        durationMs: Date.now() - t0,
        message: `arg-build error: ${err instanceof Error ? err.message : err}`,
      });
      writeRow(results[results.length - 1]);
      skippedCount++;
      continue;
    }

    if (args === null) {
      results.push({
        tool: check.name,
        argSummary: '',
        status: 'skipped',
        durationMs: Date.now() - t0,
        message: 'no plan entry',
      });
      writeRow(results[results.length - 1]);
      skippedCount++;
      continue;
    }

    const argSummary = check.describe ? check.describe(args) : '';
    try {
      const output = await dispatchTool(opts.client, check.name, args);
      const result: CheckResult = {
        tool: check.name,
        argSummary,
        status: 'ok',
        durationMs: Date.now() - t0,
        message: shortMessage(output),
        output,
      };
      results.push(result);
      writeRow(result);
      if (opts.veryVerbose) {
        process.stderr.write(indentBlock(output) + '\n');
      }
      okCount++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const result: CheckResult = {
        tool: check.name,
        argSummary,
        status: 'failed',
        durationMs: Date.now() - t0,
        message: shortMessage(message),
        error: message,
      };
      results.push(result);
      writeRow(result);
      if (opts.veryVerbose) {
        process.stderr.write(indentBlock(message) + '\n');
      }
      failedCount++;
      if (opts.failFast) break;
    }
  }

  process.stderr.write(`\nSummary: ${okCount} ok, ${failedCount} failed, ${skippedCount} skipped\n`);
  const exitCode = failedCount > 0 ? 1 : 0;
  return { exitCode, results };
}

function writeRow(r: CheckResult): void {
  const icon = r.status === 'ok' ? '\x1b[32m✓\x1b[0m' : r.status === 'failed' ? '\x1b[31m✗\x1b[0m' : '·';
  const status = r.status === 'ok' ? 'ok' : r.status === 'failed' ? 'failed' : 'skipped';
  const dur = r.status === 'skipped' ? '' : `(${r.durationMs}ms)`;
  process.stderr.write(
    `${icon} ${pad(r.tool, 30)} ${pad(r.argSummary, 28)} ${pad(status, 8)} ${pad(dur, 9)} ${r.message}\n`
  );
}

function indentBlock(text: string): string {
  return text.split('\n').map((l) => '    ' + l).join('\n');
}
