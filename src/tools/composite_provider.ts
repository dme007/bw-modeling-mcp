import { BwClient, decodeXmlEntities, freshRead } from '../bw-client.js';

const HCPR_ACCEPT = [
  'application/vnd.sap.bw.modeling.hcpr-v1_0_0+xml',
  'application/vnd.sap.bw.modeling.hcpr-v1_4_0+xml',
  'application/vnd.sap.bw.modeling.hcpr-v1_7_0+xml',
  'application/vnd.sap.bw.modeling.hcpr-v1_8_0+xml',
  'application/vnd.sap.bw.modeling.hcpr-v1_9_0+xml',
  'application/vnd.sap.bw.modeling.hcpr-v1_10_0+xml',
  'application/vnd.sap.bw.modeling.hcpr-v1_11_0+xml',
  'application/vnd.sap.bw.modeling.hcpr-v1_12_0+xml',
  'application/vnd.sap.bw.modeling.hcpr-v1_13_0+xml',
  'application/vnd.sap.bw.modeling.hcpr-v1_14_0+xml',
  'application/vnd.sap.bw.modeling.hcpr-v1_15_0+xml',
  'application/vnd.sap.bw.modeling.hcpr-v9_99_9+xml',
].join(',');

function attr(str: string, key: string): string {
  return str.match(new RegExp(`\\b${key}="([^"]*)"`)) ?.[1] ?? '';
}

export async function bwGetCompositeProvider(
  client: BwClient,
  compositeProviderName: string
): Promise<string> {
  const path = `/sap/bw/modeling/hcpr/${compositeProviderName.toLowerCase()}/m`;
  // Fresh session, not this client: a session that has just written the object serves its
  // own pinned model buffer afterwards, which drops attributes the write did set.
  const result = await freshRead(path, HCPR_ACCEPT);

  const xml = result.body;
  const objectStatus = result.headers['object_status'] ?? result.headers['OBJECT_STATUS'] ?? 'unknown';
  const timestamp = result.headers['timestamp'] ?? result.headers['TIMESTAMP'] ?? '';

  // Root element attributes
  const rootAttrs = xml.match(/<Composite:compositeView\b([\s\S]*?)>/)?.[1] ?? '';
  const cpName = attr(rootAttrs, 'name');
  const temporalJoinFlag = attr(rootAttrs, 'temporalJoin');
  const stackableFlag = attr(rootAttrs, 'stackable');
  const defaultNode = attr(rootAttrs, 'defaultNode');
  const aggregationBehaviour = attr(rootAttrs, 'aggregationBehaviour');

  const description = decodeXmlEntities(xml.match(/<endUserTexts\b[^>]*\blabel="([^"]*)"/)?.[1] ?? '');

  // tlogoProperties block (opening tag only — attributes span multiple lines)
  const tlogoAttrs = xml.match(/<tlogoProperties\b([\s\S]*?)>/)?.[1] ?? '';
  const responsible = attr(tlogoAttrs, 'adtcore:responsible');
  const changedAt = attr(tlogoAttrs, 'adtcore:changedAt');
  const changedBy = attr(tlogoAttrs, 'adtcore:changedBy');
  const infoArea = xml.match(/<infoArea>([^<]+)<\/infoArea>/)?.[1] ?? '';
  const packageName = xml.match(/adtcore:packageRef[^>]*adtcore:name="([^"]+)"/)?.[1] ?? '';

  // viewNode
  const viewNodeMatch = xml.match(/<viewNode\b([\s\S]*?)>([\s\S]*?)<\/viewNode>/);
  const viewNodeAttrs = viewNodeMatch?.[1] ?? '';
  const viewNodeBody = viewNodeMatch?.[2] ?? '';
  const viewNodeName = attr(viewNodeAttrs, 'name');

  // Strip namespace prefix and normalise type name
  const rawViewType = attr(viewNodeAttrs, 'xsi:type');
  const localViewType = rawViewType.split(':').pop() ?? rawViewType;
  const viewType = localViewType === 'JoinNode' ? 'Join' : localViewType === 'Union' ? 'Union' : localViewType;

  // Fields
  const fields: Array<Record<string, unknown>> = [];
  const elemRegex = /<element\b([\s\S]*?)(?:\/>|>([\s\S]*?)<\/element>)/g;
  let em: RegExpExecArray | null;
  while ((em = elemRegex.exec(viewNodeBody)) !== null) {
    const elemAttrs = em[1];
    const name = attr(elemAttrs, 'name');
    if (!name) continue;
    const infoObjectName = attr(elemAttrs, 'infoObjectName');
    const elemBody = em[2] ?? '';
    const dimension = attr(elemAttrs, 'dimension');
    const dimName = dimension.match(/#\/\/\/([^§]*)§/)?.[1] ?? dimension;
    // The __KEYFIGURES dimension only exists in models that are modelled with dimensions;
    // a plain Union node carries no dimension at all. The element body always says what
    // the field is, so read that first and keep the dimension as a fallback.
    const isKeyFigure =
      /consumptionViewProperties\b[^>]*objectType="KYF"/.test(elemBody) ||
      /<localProperties\b[^>]*LocalKeyfigureProperties/.test(elemBody) ||
      dimName.includes('__KEYFIGURES');
    fields.push({
      name,
      ...(infoObjectName ? { info_object_name: infoObjectName } : {}),
      dimension: dimName,
      is_key_figure: isKeyFigure,
    });
  }

  const totalFields = fields.length;
  const keyFigureCount = fields.filter(f => f['is_key_figure']).length;
  const characteristicCount = totalFields - keyFigureCount;

  // Inputs (source providers)
  const inputs: Array<Record<string, unknown>> = [];
  const inputRegex = /<input\b([\s\S]*?)>([\s\S]*?)<\/input>/g;
  let im: RegExpExecArray | null;
  while ((im = inputRegex.exec(viewNodeBody)) !== null) {
    const inputAttrs = im[1];
    const inputBody = im[2];
    const name = attr(inputAttrs, 'name');
    if (!name) continue;
    const alias = attr(inputAttrs, 'alias');
    const lastModified = attr(inputAttrs, 'lastModified');
    const providerType = alias.split('.')[1] ?? '';
    const allMappings = [...inputBody.matchAll(/<mapping\b[^>]*/g)];
    const constantMappings = allMappings
      .filter(m => m[0].includes('ConstantElementMapping'))
      .map(m => ({
        target: attr(m[0], 'targetName'),
        value: attr(m[0], 'value'),
      }));
    inputs.push({
      name,
      alias,
      ...(lastModified ? { last_modified: lastModified } : {}),
      provider_type: providerType,
      mapping_count: allMappings.length,
      regular_mapping_count: allMappings.length - constantMappings.length,
      constant_mappings: constantMappings,
    });
  }

  // Build result
  const output: Record<string, unknown> = {
    object_type: 'hcpr',
    name: cpName.toUpperCase(),
    description,
    object_status: objectStatus,
    timestamp,
    temporal_join: temporalJoinFlag === 'true',
    stackable: stackableFlag === 'true',
    aggregation_behaviour: aggregationBehaviour,
    default_node: defaultNode,
    info_area: infoArea,
    package: packageName,
    responsible_user: responsible,
    last_changed_at: changedAt,
    last_changed_by: changedBy,
    view_node: { name: viewNodeName, type: viewType },
    inputs,
    fields: {
      total: totalFields,
      characteristic_count: characteristicCount,
      key_figure_count: keyFigureCount,
      list: fields,
    },
  };

  // Join condition (Join CPs only)
  if (viewType === 'Join') {
    const joinMatch = viewNodeBody.match(/<join\b([\s\S]*?)>([\s\S]*?)<\/join>/);
    if (joinMatch) {
      const joinAttrs = joinMatch[1];
      const joinBody = joinMatch[2];
      // "#///J1/J1.IOBJ.2" → last non-empty path segment = alias
      const extractAlias = (ref: string) => ref.split('/').filter(Boolean).pop() ?? '';
      const leftKeys = [...joinBody.matchAll(/<leftElementName>([^<]+)<\/leftElementName>/g)].map(m => m[1]);
      const rightKeys = [...joinBody.matchAll(/<rightElementName>([^<]+)<\/rightElementName>/g)].map(m => m[1]);
      output['join_condition'] = {
        join_type: attr(joinAttrs, 'joinType'),
        cardinality: attr(joinAttrs, 'cardinality'),
        left_input_alias: extractAlias(attr(joinAttrs, 'leftInput')),
        right_input_alias: extractAlias(attr(joinAttrs, 'rightInput')),
        left_key_fields: leftKeys,
        right_key_fields: rightKeys,
      };
    }
  }

  // Temporal join details
  if (temporalJoinFlag === 'true') {
    const extractAlias = (ref: string) => ref.split('/').filter(Boolean).pop() ?? '';
    const aqRef = xml.match(/<temporalJoinProvider\b[^>]*type="AQ"[^>]*input="([^"]*)"/)?.[1] ?? '';
    const cqRef = xml.match(/<temporalJoinProvider\b[^>]*type="CQ"[^>]*input="([^"]*)"/)?.[1] ?? '';

    const operands = [...xml.matchAll(/<temporalOperand\b([\s\S]*?)(?:\/>|>)/g)].map(m => {
      const opAttrs = m[1];
      const temporalArg = attr(opAttrs, 'temporalArgument');
      const field = temporalArg.split('/').filter(Boolean).pop() ?? temporalArg;
      return {
        type: attr(opAttrs, 'type'),
        field,
        input_alias: extractAlias(attr(opAttrs, 'input')),
      };
    });

    output['temporal_join_details'] = {
      anchor_query_alias: extractAlias(aqRef),
      characteristic_query_alias: extractAlias(cqRef),
      operands,
    };
  }

  return JSON.stringify(output, null, 2);
}

// ── bw_create_composite_provider ─────────────────────────────────────────────

const HCPR_XMLNS =
  'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ' +
  'xmlns:Composite="http://www.sap.com/bw/modeling/CompositeModel.ecore" ' +
  'xmlns:View="http://www.sap.com/ndb/ViewModelView.ecore" ' +
  'xmlns:adtcore="http://www.sap.com/adt/core"';

/** A source InfoProvider attached to the view node at creation time. */
export interface InitialInputRef {
  providerName: string;
  /** TLOGO-style suffix of the source, e.g. "ADSO" or "CUBE". */
  providerType: string;
}

/**
 * Escape a free-text value for an XML attribute. Labels reach the server verbatim, so an
 * unescaped `&` makes the create fail with HTTP 500 and no usable message.
 */
function escapeXmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Relative entity reference used inside `<input><entity>…</entity></input>`. */
function buildEntityRef(providerName: string): string {
  return `../../../infoprov_dt/a/${providerName.trim().toUpperCase()}.composite#//`;
}

export interface CompositeProviderCreateOptions {
  label: string;
  infoArea: string;
  viewType?: 'Join' | 'Union';
  package?: string;
  stackable?: boolean;
  /** Source InfoProviders to attach right away. A Union without inputs was never observed. */
  inputs?: InitialInputRef[];
}

/**
 * bw_create_composite_provider — create a new CompositeProvider shell.
 *
 * Workflow: lock (CREA) → POST minimal XML → unlock. The result is inactive; activation
 * is a separate step through bw_activate.
 *
 * The XML shape is confirmed against a captured create request: element order is
 * endUserTexts → viewNode → tlogoProperties → runtimeProperties, the view node carries a
 * generic id (U1/J1) rather than the CompositeProvider's name, `defaultNode` on the root
 * is a path reference, and stackable is omitted unless set. Fields and mappings are not
 * part of the create call — they are added afterwards through a full-object PUT.
 *
 * Creating from a template is deliberately absent: a `<template objectName=… tlogo="HCPR"/>`
 * element modelled on the aDSO flow is rejected with HTTP 500 and an empty message, both
 * before and after tlogoProperties. That path needs a captured request before it can be
 * offered as a parameter.
 */
export async function bwCreateCompositeProvider(
  client: BwClient,
  compositeProviderName: string,
  options: CompositeProviderCreateOptions
): Promise<string> {
  const {
    label,
    infoArea,
    viewType = 'Join',
    package: pkg = '$TMP',
    stackable = false,
    inputs = [],
  } = options;

  const nameUpper = compositeProviderName.toUpperCase();
  const infoAreaUpper = infoArea.toUpperCase();
  // Captured creates carry the system's logon language. A language that is not installed
  // makes the create fail with an unconditional 500.
  const language = process.env.BW_LANGUAGE ?? 'EN';
  const nodeName = viewType === 'Union' ? 'U1' : 'J1';
  const xsiType = viewType === 'Union' ? 'View:Union' : 'View:JoinNode';
  const stackableAttr = stackable ? ' stackable="true"' : '';

  const lockHandle = await client.lock('hcpr', compositeProviderName, {
    'activity_context': 'CREA',
    'parent_name': infoAreaUpper,
    'parent_type': 'AREA',
  });

  const typeSeq = new Map<string, number>();
  const aliases: string[] = [];
  const inputsXml = inputs
    .map((inp) => {
      const type = inp.providerType.trim().toUpperCase();
      const seq = (typeSeq.get(type) ?? 0) + 1;
      typeSeq.set(type, seq);
      const alias = `${nodeName}.${type}.${seq}`;
      aliases.push(alias);
      return (
        `    <input xsi:type="Composite:CompositeInput" alias="${alias}" selectAll="false">\n` +
        `      <entity>${buildEntityRef(inp.providerName)}</entity>\n` +
        `    </input>`
      );
    })
    .join('\n');

  // A join node models an N-way join as N inputs plus one <join> element per pair, so this
  // stub covers the first pair only; further inputs are wired up afterwards per pair.
  const joinStubXml =
    viewType === 'Join' && aliases.length === 2
      ? `    <join leftInput="#///${nodeName}/${aliases[0]}" rightInput="#///${nodeName}/${aliases[1]}" joinType="inner"/>`
      : '';

  const viewNodeBody = [inputsXml, joinStubXml].filter(Boolean).join('\n');

  const body =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<Composite:compositeView ${HCPR_XMLNS} schemaVersion="1.15" name="${nameUpper}" readOnly="false"` +
    ` defaultNode="#///${nodeName}" clientDependent="false"${stackableAttr}>\n` +
    `  <endUserTexts label="${escapeXmlAttr(label)}"/>\n` +
    `  <viewNode xsi:type="${xsiType}" name="${nodeName}">\n` +
    (viewNodeBody ? viewNodeBody + '\n' : '') +
    `  </viewNode>\n` +
    `  <tlogoProperties adtcore:language="${language}" adtcore:name="${nameUpper}"` +
    ` adtcore:type="HCPR" adtcore:masterLanguage="${language}">\n` +
    `    <infoArea>${infoAreaUpper}</infoArea>\n` +
    `  </tlogoProperties>\n` +
    `  <runtimeProperties/>\n` +
    `</Composite:compositeView>`;

  try {
    await client.create('hcpr', compositeProviderName, lockHandle, body, {
      'Development-Class': pkg,
    });
  } catch (err) {
    await client.unlock('hcpr', compositeProviderName).catch(() => {/* ignore */});
    throw err;
  }
  await client.unlock('hcpr', compositeProviderName);

  return JSON.stringify({
    success: true,
    message: `CompositeProvider ${nameUpper} created in package ${pkg}. Call bw_activate to activate.`,
    composite_provider_name: nameUpper,
    object_type: 'hcpr',
    view_type: viewType,
  });
}
