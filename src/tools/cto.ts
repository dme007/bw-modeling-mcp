import { BwClient } from '../bw-client.js';
import { bwGetDatasource } from './datasource.js';

export interface ChangePackageArgs {
  objectName: string;
  objectType: string;
  package: string;
  transport?: string;
  sourceSystem?: string;
}

const CTO_MEDIA_TYPE = 'application/vnd.sap.bw.modeling.cto-v1_1_0+xml';

/**
 * Build the transport object name (TADIR OBJ_NAME) for a CTO write.
 *
 * Most TLOGO types use the plain uppercase technical name. RSDS (DataSource) is the
 * exception: its key is compound, and TADIR stores it as the DataSource name padded to
 * 30 characters followed by the source system (source system at offset 31). Passing the
 * bare DataSource name — or the name with a single space before the source system —
 * produces an orphan TADIR entry that cto/write happily reports as written while the real
 * DataSource's package stays empty. See payloads/change_package.md and the RSDS notes.
 */
function buildTransportName(typeUpper: string, nameUpper: string, sourceSystemUpper?: string): string {
  if (typeUpper === 'RSDS') {
    return `${nameUpper.padEnd(30, ' ')}${sourceSystemUpper ?? ''}`;
  }
  return nameUpper;
}

/**
 * bw_change_package — reassign an object to a package and record it on a transport.
 * Endpoint, body and response shape: see payloads/change_package.md.
 *
 * Does not lock and does not activate. After a successful write the object is inactive
 * and must be re-activated with bw_activate (passing the same transport).
 */
export async function bwChangePackage(
  client: BwClient,
  args: ChangePackageArgs
): Promise<string> {
  const nameUpper = args.objectName.toUpperCase();
  const typeUpper = args.objectType.toUpperCase();
  const sourceSystemUpper = args.sourceSystem?.toUpperCase();

  // RSDS (DataSource) has a compound key — the source system is mandatory, mirroring
  // bw_activate's handling of object_type "rsds".
  if (typeUpper === 'RSDS' && !sourceSystemUpper) {
    return JSON.stringify(
      {
        success: false,
        object_name: nameUpper,
        object_type: typeUpper,
        message:
          'object_type "RSDS" requires source_system (a DataSource is identified by DataSource name plus source system).',
      },
      null,
      2
    );
  }

  const transportName = buildTransportName(typeUpper, nameUpper, sourceSystemUpper);

  const params = new URLSearchParams();
  // Transport param is "corrnum" on this endpoint, not "corrNr" (see payload doc).
  if (args.transport) {
    params.set('corrnum', args.transport);
  }
  params.set('package', args.package);
  params.set('simulate', 'false');

  const path = `/sap/bw/modeling/cto/write?${params.toString()}`;

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bwCTO:transport xmlns:bwCTO="http://www.sap.com/bw/cto"><objects><object name="${transportName}" isTransportName="true" type="${typeUpper}" pgmid="R3TR" operation="I" genflag=""></object></objects></bwCTO:transport>`;

  const response = await client.postRaw(path, xml, CTO_MEDIA_TYPE);

  const writeResultMatch = response.match(/writeResult="([^"]*)"/);
  const writeResult = writeResultMatch ? writeResultMatch[1] : '';
  const writeOk = writeResult === 'S';

  const messages: string[] = [];
  const msgRegex = /<message[^>]*>([^<]+)<\/message>/g;
  let match: RegExpExecArray | null;
  while ((match = msgRegex.exec(response)) !== null) {
    if (match[1].trim()) messages.push(match[1].trim());
  }

  // writeResult="S" alone is not proof the package was applied to the real object:
  // a wrong key (notably a mis-built RSDS key) produces an orphan TADIR entry that
  // still reports success. Verify by re-reading the object and confirming the package
  // actually landed. The re-read is type-specific, so currently only RSDS is verified.
  let verifiedPackage: string | null = null;
  let resolved: boolean | null = null;
  if (writeOk && typeUpper === 'RSDS') {
    try {
      const raw = await bwGetDatasource(client, nameUpper, sourceSystemUpper!, 'raw');
      verifiedPackage =
        raw.match(/<adtcore:packageRef\b[\s\S]*?\badtcore:name="([^"]*)"/)?.[1]?.trim() || '';
      resolved = verifiedPackage.toUpperCase() === args.package.toUpperCase();
    } catch {
      // The DataSource key did not resolve to an existing object at all.
      resolved = false;
      verifiedPackage = '';
    }
  }

  const success = writeOk && resolved !== false;

  const result: Record<string, unknown> = {
    success,
    object_name: nameUpper,
    object_type: typeUpper,
    package: args.package,
    transport: args.transport ?? null,
    write_result: writeResult,
  };
  if (sourceSystemUpper) {
    result['source_system'] = sourceSystemUpper;
  }
  if (messages.length > 0) {
    result['messages'] = messages;
  }

  if (writeOk && resolved === false) {
    // The endpoint reported success but the package never reached the real object.
    result['verified_package'] = verifiedPackage;
    result['message'] =
      typeUpper === 'RSDS'
        ? `cto/write returned writeResult="S" but the DataSource "${nameUpper}" / source system "${sourceSystemUpper}" still has package "${verifiedPackage}". ` +
          'The transport key likely did not resolve to the real DataSource (an orphan TADIR entry may have been created). ' +
          'No package change was applied — assign the package manually via RSA1 and remove any orphan entry from the transport.'
        : `cto/write returned writeResult="S" but the package was not applied to "${nameUpper}".`;
  } else if (success) {
    if (verifiedPackage !== null) {
      result['verified_package'] = verifiedPackage;
    }
    result['next_step'] =
      'Object is now inactive. Re-activate it with bw_activate, passing the same transport.';
  }

  return JSON.stringify(result, null, 2);
}
