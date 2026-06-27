import { BwClient } from '../bw-client.js';

const BASE = '/sap/bc/http/sap/bw4/v1/modeling/processchains';
const JSON_CT = 'application/json';

const COLLECTORS = new Set(['AND', 'OR', 'XOR']);

const TRIGGER_SCHEDULE_DETAIL = {
  startdttyp: 'I',
  sdlstrttimestamp: '',
  maximumDelay: 0,
  tmzone: '',
  recurrencyPattern: '',
  prdmins: 0,
  prdhours: 0,
  prddays: 0,
  prdweeks: 0,
  prdmonths: 0,
  prdbehav: '',
  calendarid: '',
  eventtype: '',
  eventid: [],
  eventparm: '',
  operationMode: '',
  onlyOnce: false,
  wdCalendarid: '',
  wdayno: 0,
  wdaycdir: '',
  wdPrdmonths: 0,
  wdSystemtimezone: '',
  sdlstrttm: '',
  notbefore: '',
};

// ── Input types ────────────────────────────────────────────────────────────────

interface StepDtpLoad {
  id: string;
  type: 'DTP_LOAD';
  dtp: string;
  description?: string;
}

interface StepAdsoAct {
  id: string;
  type: 'ADSOACT';
  datastores: string[];
  requestsSequential?: boolean;
  errorOnNonActivation?: boolean;
}

interface StepCollector {
  id: string;
  type: 'AND' | 'OR' | 'XOR';
}

interface StepGeneric {
  id: string;
  type: string;
  object: string;
  description?: string;
}

export type Step = StepDtpLoad | StepAdsoAct | StepCollector | StepGeneric;

export interface EdgeDef {
  from: string;
  to: string;
  status?: 'neutral' | 'positive' | 'negative';
}

export interface CreateProcessChainParams {
  name: string;
  infoarea: string;
  description: string;
  steps: Step[];
  edges: EdgeDef[];
  activate?: boolean;
}

export interface UpdateProcessChainParams {
  name: string;
  description?: string;
  infoarea?: string;
  steps: Step[];
  edges: EdgeDef[];
  activate?: boolean;
}

// ── Low-level helpers ──────────────────────────────────────────────────────────

function writeHeaders(csrf: string): Record<string, string> {
  return {
    'Content-Type': JSON_CT,
    Accept: '*/*',
    'x-csrf-token': csrf,
    'X-Requested-With': 'XMLHttpRequest',
  };
}

// Force the client to discard its cached CSRF token so the next getCsrfToken()
// fetches a fresh one from the server. Needed because rawPost/rawPut don't null
// the token on completion, so the same token would be reused across all write
// steps of the flow even if the server has rotated it.
function refreshCsrf(client: BwClient): void {
  client.clearCsrfToken();
}

function buildNode(step: Step, inlineKeyMap: Map<string, string>): object {
  if (step.type === 'DTP_LOAD') {
    const s = step as StepDtpLoad;
    return {
      sProcessType: 'DTP_LOAD',
      bIsReference: true,
      sProcessVariant: s.dtp,
      sVariantDescription: s.description ?? '',
      iAutoRepeatWaitDuration: 0,
    };
  }
  if (step.type === 'ADSOACT') {
    return {
      sProcessType: 'ADSOACT',
      bIsReference: false,
      sProcessVariant: inlineKeyMap.get(step.id)!,
      iAutoRepeatWaitDuration: 0,
    };
  }
  if (COLLECTORS.has(step.type)) {
    return { sProcessType: step.type };
  }
  const g = step as StepGeneric;
  return {
    sProcessType: g.type,
    bIsReference: true,
    sProcessVariant: g.object,
    sVariantDescription: g.description ?? '',
    iAutoRepeatWaitDuration: 0,
  };
}

function buildAdsoActVariant(step: StepAdsoAct, inlineKeyMap: Map<string, string>): object {
  return {
    sProcessVariant: inlineKeyMap.get(step.id)!,
    sVariantDescription: '',
    oDetail: {
      sId: '',
      DATASTORES: step.datastores.map((ds) => ({ DATASTORE: ds, DESCRIPTION: '', HOTCOLDFLAG: '' })),
      NOCONDENSE: step.requestsSequential ?? false,
      NOREQACTWARN: step.errorOnNonActivation ?? false,
    },
    aSocket: [],
  };
}

function defaultEdgeStatus(fromId: string, nodeTypeMap: Map<string, string>): string {
  const fromType = nodeTypeMap.get(fromId);
  if (fromType === 'TRIGGER' || (fromType !== undefined && COLLECTORS.has(fromType))) {
    return 'neutral';
  }
  return 'positive';
}

function parseActivateResponse(body: string): {
  success: boolean;
  message: string;
  severity: string;
  log: Array<{ severity: string; message: string }>;
  errors: Array<{ severity: string; message: string }>;
} {
  let data: any;
  try {
    data = JSON.parse(body);
  } catch {
    return { success: false, message: body, severity: 'error', log: [], errors: [] };
  }
  const msg = data.message ?? {};
  const log: Array<{ severity: string; message: string }> = (data.log ?? []).map((e: any) => ({
    severity: String(e.severity ?? ''),
    message: String(e.message ?? ''),
  }));
  const errors = log.filter((e) => e.severity === 'error');
  return {
    success: msg.severity === 'success',
    message: String(msg.message ?? ''),
    severity: String(msg.severity ?? ''),
    log,
    errors,
  };
}

// ── buildModelParts ────────────────────────────────────────────────────────────
//
// Builds the non-trigger part of the model from the high-level step/edge input.
// Step nodes occupy indices 1..n; index 0 is always the trigger (added by caller).
// Returns nodes (without the trigger), edges (already index-based, TRIGGER = 0),
// and the inline variants belonging to the step nodes (without the trigger variant).

function buildModelParts(
  steps: Step[],
  edges: EdgeDef[]
): { stepNodes: object[]; aEdge: object[]; stepInlineVariants: object[] } {
  // node index map: TRIGGER=0, each step id → 1-based position
  const nodeIndexMap = new Map<string, number>([['TRIGGER', 0]]);
  steps.forEach((step, i) => nodeIndexMap.set(step.id, i + 1));

  // node type map for edge default-status calculation
  const nodeTypeMap = new Map<string, string>([['TRIGGER', 'TRIGGER']]);
  steps.forEach((step) => nodeTypeMap.set(step.id, step.type));

  // assign INLINE_n keys to ADSOACT nodes (starting at 1; trigger owns INLINE_0)
  let inlineCounter = 1;
  const inlineKeyMap = new Map<string, string>();
  for (const step of steps) {
    if (step.type === 'ADSOACT') {
      inlineKeyMap.set(step.id, `INLINE_${inlineCounter++}`);
    }
  }

  // validate edge endpoint ids
  for (const edge of edges) {
    if (!nodeIndexMap.has(edge.from)) {
      throw new Error(`Edge 'from' id '${edge.from}' is not a defined step id or "TRIGGER"`);
    }
    if (!nodeIndexMap.has(edge.to)) {
      throw new Error(`Edge 'to' id '${edge.to}' is not a defined step id or "TRIGGER"`);
    }
  }

  const stepNodes = steps.map((s) => buildNode(s, inlineKeyMap));

  const aEdge = edges.map((e) => ({
    iNodeIndexFrom: nodeIndexMap.get(e.from)!,
    iNodeIndexTo: nodeIndexMap.get(e.to)!,
    sStatus: e.status ?? defaultEdgeStatus(e.from, nodeTypeMap),
    sSubStatus: '00',
  }));

  const stepInlineVariants = steps
    .filter((s) => s.type === 'ADSOACT')
    .map((s) => buildAdsoActVariant(s as StepAdsoAct, inlineKeyMap));

  return { stepNodes, aEdge, stepInlineVariants };
}

// helper: activate a chain and return the parsed result
async function activateChain(
  client: BwClient,
  nameLc: string
): Promise<ReturnType<typeof parseActivateResponse>> {
  refreshCsrf(client);
  const csrf = await client.getCsrfToken();
  const res = await client
    .rawPost(`${BASE}/${nameLc}/activate`, '', writeHeaders(csrf))
    .catch((err: Error) => {
      throw new Error(`Activate chain: ${err.message}`);
    });
  refreshCsrf(client);
  return parseActivateResponse(res.body);
}

// helper: attach activation fields to a result object
function attachActivation(
  result: Record<string, unknown>,
  activation: ReturnType<typeof parseActivateResponse>
): void {
  result.activation = {
    success: activation.success,
    message: activation.message,
    severity: activation.severity,
    log: activation.log,
  };
  if (activation.errors.length > 0) {
    result.activationErrors = activation.errors;
  }
}

// ── bw_create_process_chain ────────────────────────────────────────────────────

export async function bwCreateProcessChain(
  client: BwClient,
  params: CreateProcessChainParams
): Promise<string> {
  const { name, infoarea, description, steps, edges, activate = false } = params;
  const nameLc = name.toLowerCase();

  const { stepNodes, aEdge, stepInlineVariants } = buildModelParts(steps, edges);

  const oHeaderCreate = {
    sLocation: infoarea,
    sDescription: description,
    oSchedulingAttributes: { bTenantSpecific: false, sJobPriority: 'C', bStreaming: false },
    oMonitoringAttributes: {
      bAutoMonitored: false,
      bAutoResetFailures: false,
      bErrorNotification: false,
      bKeepAlive: false,
      bLocalFailuresAsSuccess: false,
    },
  };

  // ── Step 1: Transport check before create ──────────────────────────────────
  // 404 is treated as a soft failure: the endpoint exists but its content-negotiation
  // did not match (known intermittent SAP behaviour). Transport rules are still
  // enforced by the actual POST in Step 2, so we warn and continue rather than abort.
  let transportWarning: string | undefined;
  const csrf1 = await client.getCsrfToken();
  await client
    .rawPost(
      '/sap/bc/http/sap/bw4/v1/modeling/transports/validateobject',
      JSON.stringify({ uri: `${BASE}/${nameLc}`, package: '$TMP' }),
      writeHeaders(csrf1)
    )
    .catch((err: Error) => {
      if (/HTTP 404/.test(err.message)) {
        transportWarning = 'Transport pre-check returned 404 (validateobject); transport rules still apply on save.';
      } else {
        throw new Error(`Transport check (create): ${err.message}`);
      }
    });
  refreshCsrf(client);

  // ── Step 2: Create chain with trigger-only skeleton ────────────────────────
  const csrf2 = await client.getCsrfToken();
  await client
    .rawPost(
      BASE,
      JSON.stringify({
        name,
        model: {
          aNode: [{ sProcessType: 'TRIGGER', bIsReference: false, sProcessVariant: 'INLINE_0' }],
          aEdge: [],
          aInlineVariant: [{ sProcessVariant: 'INLINE_0', oDetail: {}, aSocket: [] }],
          oHeader: oHeaderCreate,
        },
      }),
      writeHeaders(csrf2)
    )
    .catch((err: Error) => {
      throw new Error(`Create chain: ${err.message}`);
    });
  refreshCsrf(client);

  // ── Step 3: GET chain for ETag and server-assigned trigger variant key ─────
  let etag: string;
  let triggerVariantKey: string;
  try {
    const got = await client.rawGet(`${BASE}/${nameLc}`, { Accept: JSON_CT });
    etag = got.headers['etag'] as string;
    if (!etag) throw new Error('No ETag returned by GET after create');
    const getBody = JSON.parse(got.body);
    triggerVariantKey = getBody?.model?.aNode?.[0]?.sProcessVariant ?? 'INLINE_0';
  } catch (err: any) {
    throw new Error(`GET chain for ETag: ${err.message}`);
  }
  refreshCsrf(client);

  // ── Step 4: PUT full model ────────────────────────────────────────────────
  const fullModel = {
    aNode: [
      { sProcessType: 'TRIGGER', bIsReference: false, sProcessVariant: triggerVariantKey },
      ...stepNodes,
    ],
    aEdge,
    aInlineVariant: [
      { sProcessVariant: triggerVariantKey, sVariantDescription: '', oDetail: TRIGGER_SCHEDULE_DETAIL, aSocket: [] },
      ...stepInlineVariants,
    ],
    oHeader: {
      sProcessChainId: name,
      sLocation: infoarea,
      sDescription: description,
      sObjectVersion: 'modified',
      sObjectStatus: 'active',
      bActive: true,
      oSchedulingAttributes: { sExecutionServer: '', sServerType: '', bTenantSpecific: false, sJobPriority: 'C', bStreaming: false },
      oMonitoringAttributes: { bKeepAlive: false, bAutoMonitored: false, bErrorNotification: false, bLocalFailuresAsSuccess: false, bAutoResetFailures: false },
    },
  };

  const csrf4 = await client.getCsrfToken();
  await client
    .rawPut(`${BASE}/${nameLc}`, JSON.stringify(fullModel), {
      'Content-Type': JSON_CT,
      Accept: '*/*',
      'x-csrf-token': csrf4,
      'If-Match': etag,
      'X-Requested-With': 'XMLHttpRequest',
    })
    .catch((err: Error) => {
      throw new Error(`PUT full model: ${err.message}`);
    });
  refreshCsrf(client);

  // ── Step 6: Optional activation ───────────────────────────────────────────
  const result: Record<string, unknown> = {
    chain: name,
    nodes: 1 + stepNodes.length,
    edges: aEdge.length,
    activated: activate,
  };
  if (transportWarning) result.transportWarning = transportWarning;
  if (activate) {
    attachActivation(result, await activateChain(client, nameLc));
  }
  return JSON.stringify(result, null, 2);
}

// ── bw_update_process_chain ────────────────────────────────────────────────────

export async function bwUpdateProcessChain(
  client: BwClient,
  params: UpdateProcessChainParams
): Promise<string> {
  const { name, description, infoarea, steps, edges, activate = false } = params;
  const nameLc = name.toLowerCase();

  const { stepNodes, aEdge, stepInlineVariants } = buildModelParts(steps, edges);

  // ── Step 1: GET current chain for ETag and existing trigger/header ─────────
  let etag: string;
  let triggerNode: any;
  let triggerVariantKey: string;
  let triggerVariant: any;
  let currentHeader: any;
  try {
    const got = await client.rawGet(`${BASE}/${nameLc}`, { Accept: JSON_CT });
    etag = got.headers['etag'] as string;
    if (!etag) throw new Error('No ETag returned by GET');
    const current = JSON.parse(got.body);
    const model = current.model ?? current;
    const rawTrigger = (model.aNode ?? []).find((n: any) => n.sProcessType === 'TRIGGER');
    if (!rawTrigger) throw new Error('GET response contains no TRIGGER node (unexpected format)');
    triggerVariantKey = rawTrigger.sProcessVariant;
    // Reconstruct trigger node with minimal fields — using the raw server node
    // causes RSPC020 ("no starter") when changing from sequential to parallel topology.
    triggerNode = { sProcessType: 'TRIGGER', bIsReference: false, sProcessVariant: triggerVariantKey };
    // Always reconstruct the trigger variant fresh — using the server's oDetail verbatim
    // causes HTTP 500 (ABAP offset error) on PUT when the chain topology changes.
    triggerVariant = { sProcessVariant: triggerVariantKey, sVariantDescription: '', oDetail: TRIGGER_SCHEDULE_DETAIL, aSocket: [] };
    currentHeader = model.oHeader ?? {};
  } catch (err: any) {
    throw new Error(`GET chain '${name}': ${err.message}`);
  }

  // ── Step 2: Assemble the full replacement model ────────────────────────────
  const fullModel = {
    aNode: [triggerNode, ...stepNodes],
    aEdge,
    aInlineVariant: [triggerVariant, ...stepInlineVariants].filter(Boolean),
    oHeader: {
      ...currentHeader,
      sDescription: description ?? currentHeader.sDescription,
      sLocation: infoarea ?? currentHeader.sLocation,
    },
  };

  // ── Step 3: PUT the full model with If-Match ─────────────────────────────
  refreshCsrf(client);
  const csrf2u = await client.getCsrfToken();
  await client
    .rawPut(`${BASE}/${nameLc}`, JSON.stringify(fullModel), {
      'Content-Type': JSON_CT,
      Accept: '*/*',
      'x-csrf-token': csrf2u,
      'If-Match': etag,
      'X-Requested-With': 'XMLHttpRequest',
    })
    .catch((err: Error) => {
      const stale = err.message.includes('HTTP 412');
      throw new Error(
        stale
          ? `PUT model failed: ETag is stale (412 Precondition Failed) — the chain was modified between the GET and PUT. Re-read and retry. ${err.message}`
          : `PUT full model: ${err.message}`
      );
    });
  refreshCsrf(client);

  // ── Step 5: Optional activation ───────────────────────────────────────────
  const result: Record<string, unknown> = {
    chain: name,
    nodes: 1 + stepNodes.length,
    edges: aEdge.length,
    activated: activate,
  };
  if (activate) {
    attachActivation(result, await activateChain(client, nameLc));
  }
  return JSON.stringify(result, null, 2);
}

// ── bw_activate_process_chain ─────────────────────────────────────────────────

export async function bwActivateProcessChain(client: BwClient, name: string): Promise<string> {
  refreshCsrf(client);
  const csrf = await client.getCsrfToken();
  const res = await client
    .rawPost(`${BASE}/${name.toLowerCase()}/activate`, '', writeHeaders(csrf))
    .catch((err: Error) => {
      throw new Error(`Activate process chain '${name}': ${err.message}`);
    });
  refreshCsrf(client);

  const parsed = parseActivateResponse(res.body);
  const result: Record<string, unknown> = {
    chain: name.toUpperCase(),
    success: parsed.success,
    message: parsed.message,
    severity: parsed.severity,
    log: parsed.log,
  };
  if (parsed.errors.length > 0) {
    result.errors = parsed.errors;
  }
  return JSON.stringify(result, null, 2);
}
