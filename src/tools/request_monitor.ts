import { BwClient, createClientFromEnv } from '../bw-client.js';

// Every GET in the runtime manage family returns HTTP 415 unless it carries
// Content-Type: application/json, even though GET has no body.
const GET_HEADERS = { 'Content-Type': 'application/json', Accept: '*/*' };

interface User {
  firstName?: string;
  lastName?: string;
  fullName?: string;
  username?: string;
}

interface RequestListItem {
  requestTsn?: string;
  requestTsnExternal?: string;
  storage?: string;
  lastTimeStamp?: string;
  records?: number;
  user?: User;
  requestStatus?: string;
  statusTooltip?: string;
  // The process-level completion signal. For some green inbound loads requestStatus
  // still reads "Y" (in process) while lastProcessStatus is already "G" (green) — so
  // these are surfaced alongside requestStatus rather than overriding it.
  lastProcessStatus?: string;
  lastAction?: string;
}

interface DtpInformation {
  dataTransferProcess?: string;
  dtpDescription?: string;
  processModeDescription?: string;
  requestStart?: string;
  requestFinish?: string;
  requestDuration?: string;
  packageSize?: number;
}

interface ProcessStep {
  processTsn?: string;
  processTsnExternal?: string;
  processType?: string;
  processTypeDescription?: string;
  processStatus?: string;
  timestamp?: string;
}

interface LogMessage {
  message?: string;
  severity?: string;
  longText?: string;
}

interface DomainText {
  key?: string;
  text?: string;
}

// Module-scope caches for the system domain text maps. The status tables are
// stable for the process lifetime, so they are fetched once and reused.
let requestStatusMap: Map<string, string> | null = null;
let processStatusMap: Map<string, string> | null = null;

async function fetchDomainMap(client: BwClient, domain: string): Promise<Map<string, string>> {
  const url = `/sap/bc/http/sap/bw4/v1/system/domains/${domain}/texts`;
  const result = await client.rawGet(url, GET_HEADERS);
  const parsed = JSON.parse(result.body) as DomainText[];
  const map = new Map<string, string>();
  for (const entry of parsed) {
    if (entry.key !== undefined) {
      map.set(entry.key, entry.text ?? entry.key);
    }
  }
  return map;
}

async function getRequestStatusMap(client: BwClient): Promise<Map<string, string>> {
  if (!requestStatusMap) {
    requestStatusMap = await fetchDomainMap(client, 'rspm_request_status');
  }
  return requestStatusMap;
}

async function getProcessStatusMap(client: BwClient): Promise<Map<string, string>> {
  if (!processStatusMap) {
    processStatusMap = await fetchDomainMap(client, 'rspm_process_status');
  }
  return processStatusMap;
}

function decodeStatus(map: Map<string, string>, code: string | undefined): string {
  const raw = code ?? '';
  const text = map.get(raw);
  return text ? `${text} (${raw})` : raw;
}

export async function bwListRequests(
  client: BwClient,
  target: string,
  targetType: string = 'ADSO',
  storage: string = 'AQ,AX,AT',
  status: string = 'N,GG,GR,YG,RR,YR,RG,U,Y,X',
  top: number = 3,
  createdFrom?: string,
): Promise<string> {
  // top bounds the result set; each returned row triggers an expensive per-row
  // backend enrichment, so createdfrom only helps by shrinking the result set.
  let url =
    `/sap/bc/http/sap/bw4/v1/manage/requests` +
    `?tlogo=${encodeURIComponent(targetType.toLowerCase())}` +
    `&datatarget=${encodeURIComponent(target.toLowerCase())}` +
    `&storage=${encodeURIComponent(storage)}`;

  if (createdFrom) {
    // Server-side lower time bound; the Cockpit drops latestrequests in this case.
    url += `&createdfrom=${encodeURIComponent(createdFrom)}`;
  } else {
    url += `&latestrequests=${top}`;
  }

  url += `&top=${top}` + `&status=${encodeURIComponent(status)}`;

  const result = await client.rawGet(url, GET_HEADERS);
  const requests = JSON.parse(result.body) as RequestListItem[];
  const statusMap = await getRequestStatusMap(client);
  const processStatusMapList = await getProcessStatusMap(client);

  const lines: string[] = [];
  lines.push(`Requests of ${target.toUpperCase()} (${targetType.toUpperCase()}) — ${requests.length} shown`);
  lines.push('');

  if (requests.length === 0) {
    lines.push('(no requests found)');
    return lines.join('\n');
  }

  for (const req of requests) {
    lines.push(`Request: ${req.requestTsnExternal ?? ''}`);
    lines.push(`  Status:       ${decodeStatus(statusMap, req.requestStatus)}`);
    lines.push(`  Last Process: ${decodeStatus(processStatusMapList, req.lastProcessStatus)}`);
    if (req.lastAction) lines.push(`  Last Action:  ${req.lastAction}`);
    lines.push(`  Records:      ${req.records ?? ''}`);
    lines.push(`  Timestamp:    ${req.lastTimeStamp ?? ''}`);
    lines.push(`  User:         ${req.user?.fullName ?? ''}`);
    lines.push(`  TSN:          ${req.requestTsn ?? ''}`);
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

export async function bwGetRequest(
  client: BwClient,
  requestTsn: string,
  storage: string = 'AQ',
  format: 'text' | 'raw' = 'text',
): Promise<string> {
  const s = storage.toLowerCase();
  const headerUrl = `/sap/bc/http/sap/bw4/v1/manage/requests/${encodeURIComponent(requestTsn)}/${s}`;
  const dtpInfoUrl = `/sap/bc/http/sap/bw4/v1/manage/requests/${encodeURIComponent(requestTsn)}/${s}/datatransferprocessinformation`;
  const processesUrl = `/sap/bc/http/sap/bw4/v1/manage/processes?request=${encodeURIComponent(requestTsn)}&storage=${s}`;
  const logsUrl = `/sap/bc/http/sap/bw4/v1/manage/processes/${encodeURIComponent(requestTsn)}/logs?top=100&readMaximumNumberOfResults=true`;

  const [headerRes, dtpInfoRes, processesRes, logsRes] = await Promise.all([
    client.rawGet(headerUrl, GET_HEADERS),
    client.rawGet(dtpInfoUrl, GET_HEADERS),
    client.rawGet(processesUrl, GET_HEADERS),
    client.rawGet(logsUrl, GET_HEADERS),
  ]);

  const header = JSON.parse(headerRes.body) as RequestListItem;
  const dtpInfo = JSON.parse(dtpInfoRes.body) as DtpInformation;
  const processes = JSON.parse(processesRes.body) as ProcessStep[];
  const logs = JSON.parse(logsRes.body) as LogMessage[];

  if (format === 'raw') {
    return JSON.stringify({ header, dtpInformation: dtpInfo, processes, logs }, null, 2);
  }

  const requestStatus = await getRequestStatusMap(client);
  const processStatus = await getProcessStatusMap(client);

  const lines: string[] = [];

  // Section 1 — header
  // Both the header request status and the last process status are shown: for some green
  // inbound loads requestStatus lags at "Y" (in process) while lastProcessStatus already
  // reads "G" (green). Surfacing both keeps a genuinely running request distinguishable
  // from a finished one without remapping requestStatus.
  lines.push(`Request: ${header.requestTsnExternal ?? requestTsn}`);
  lines.push(`  Status:       ${decodeStatus(requestStatus, header.requestStatus)}`);
  lines.push(`  Last Process: ${decodeStatus(processStatus, header.lastProcessStatus)}`);
  lines.push(`  Last Action:  ${header.lastAction ?? ''}`);
  lines.push(`  Tooltip:      ${header.statusTooltip ?? ''}`);
  lines.push(`  Records:      ${header.records ?? ''}`);
  lines.push(`  User:         ${header.user?.fullName ?? ''}`);
  lines.push(`  Timestamp:    ${header.lastTimeStamp ?? ''}`);

  // Section 2 — DTP information
  lines.push('');
  lines.push('── DTP Information ──');
  lines.push(`  DTP:          ${dtpInfo.dataTransferProcess ?? ''}`);
  lines.push(`  Description:  ${dtpInfo.dtpDescription ?? ''}`);
  lines.push(`  Process Mode: ${dtpInfo.processModeDescription ?? ''}`);
  lines.push(`  Start:        ${dtpInfo.requestStart ?? ''}`);
  lines.push(`  Finish:       ${dtpInfo.requestFinish ?? ''}`);
  lines.push(`  Duration:     ${dtpInfo.requestDuration ?? ''}`);
  lines.push(`  Package Size: ${dtpInfo.packageSize ?? ''}`);

  // Section 3 — process steps
  lines.push('');
  lines.push(`── Process Steps (${processes.length}) ──`);
  for (const step of processes) {
    lines.push(`  ${step.processTsnExternal ?? ''} — ${step.processTypeDescription ?? ''}`);
    lines.push(`      Status:    ${decodeStatus(processStatus, step.processStatus)}`);
    lines.push(`      Timestamp: ${step.timestamp ?? ''}`);
  }

  // Section 4 — message log
  lines.push('');
  lines.push(`── Message Log (${logs.length}) ──`);
  for (const log of logs) {
    lines.push(`  [${log.severity ?? ''}] ${log.message ?? ''}`);
    if (log.longText && log.longText.length > 0) {
      lines.push(`      ${log.longText}`);
    }
  }

  return lines.join('\n');
}

/**
 * bw_activate_request — activate loaded data (DSO request activation).
 *
 * Moves a finished load from the Inbound Table into the active data table + change log. This is the
 * runtime RSPM request activation under the BW4 manage API ("Aktivieren" in the load-request
 * details) — NOT the modeling-object activation that bw_activate performs (different endpoint).
 *
 * Single POST to .../manage/requests/{tsn}/{storage}/activate with an empty body; the URL is
 * self-contained and the default activates all previous loads up to this request.
 *
 * Runs in a fresh session (createClientFromEnv()) — like the DTP-activation and DTP-run tools —
 * to avoid a stale shared-session buffer and cross-call session/CSRF collisions.
 *
 * Activation is asynchronous: a 200 means it was kicked off, not that it finished. Completion is
 * monitored via bw_list_requests / bw_get_request.
 */
export async function bwActivateRequest(
  requestTsn: string,
  storage: string = 'AQ',
): Promise<string> {
  const s = storage.toLowerCase();
  const url = `/sap/bc/http/sap/bw4/v1/manage/requests/${encodeURIComponent(requestTsn)}/${s}/activate`;

  const runClient = createClientFromEnv();
  const csrfToken = await runClient.getCsrfToken();

  await runClient.rawPost(url, '', {
    'Content-Type': 'application/json',
    'Accept': '*/*',
    'x-csrf-token': csrfToken,
  });

  return JSON.stringify({
    success: true,
    request_tsn: requestTsn,
    message:
      `Data activation started for request ${requestTsn} (storage ${storage.toUpperCase()}). ` +
      `Activation runs asynchronously; monitor completion via bw_list_requests / bw_get_request.`,
  });
}
