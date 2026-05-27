#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';

import { createClientFromEnv } from './bw-client.js';
import { dispatchTool, UnknownToolError } from './dispatch.js';
import { loadDotenv } from './dotenv.js';

// Load .env if present; explicit env (e.g. from MCP client config) always wins.
const loadedEnv = loadDotenv();
if (loadedEnv) {
  process.stderr.write(`[bw-modeling-mcp] loaded env from ${loadedEnv}\n`);
}

// Single shared client instance (CSRF token + session cookies are reused)
const client = createClientFromEnv();

const server = new Server(
  { name: 'bw-modeling-mcp', version: '0.1.0' },
  { capabilities: { tools: {} } }
);

// ── Tool definitions ─────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'bw_search',
      description:
        'Universal search for BW objects by name or description. Use this whenever the user wants to find, list, or look up any BW object — aDSOs, queries (ELEM), transformations (TRFN), DTPs (DTPA), InfoObjects (IOBJ), InfoSources (ISFS), CompositeProviders (HCPR), DataSources (RSDS), InfoAreas (AREA), process chains (PRCH), and any other TLOGO type. ' +
        'Supports wildcards (e.g. "Z*" to find all objects starting with Z). ' +
        'Pass object_type to restrict results to a single type; omit it to search across all types. ' +
        'Prefer this tool over type-specific get/list tools whenever the object name is unknown or a pattern is given.',
      inputSchema: {
        type: 'object',
        properties: {
          search_term: {
            type: 'string',
            description: 'Search string. Wildcards supported: * matches any sequence, ? matches a single character. Example: "Z*" finds all objects whose name starts with Z.',
          },
          object_type: {
            type: 'string',
            description:
              'Optional TLOGO filter to restrict results to one object type. Common values: ADSO (aDSO), ELEM (BEx/BW query), TRFN (transformation), DTPA (DTP), IOBJ (InfoObject), ISFS (InfoSource), HCPR (CompositeProvider), RSDS (DataSource), AREA (InfoArea), PRCH (process chain). Leave empty to search all types.',
          },
        },
        required: ['search_term'],
      },
    },
    {
      name: 'bw_xref',
      description:
        'Find where-used / dependencies for a BW object. Returns all objects that reference the given object. ' +
        'Use this to find the Transformation and DTPs that reference an aDSO, or to find which DTPs depend on a Transformation. ' +
        'Use object_type=DTPA to find the process chain(s) a DTP belongs to — this is preferred over bw_get_dtp when only the process chain is needed.',
      inputSchema: {
        type: 'object',
        properties: {
          object_type: {
            type: 'string',
            description: 'Object type: ADSO, TRFN, DTPA, IOBJ, etc.',
          },
          object_name: {
            type: 'string',
            description: 'Object name (e.g. "ADSO_NAME" or "TRFN_UUID_KEY").',
          },
          source_system: {
            type: 'string',
            description: 'Required for object_type "RSDS". Logical source system name (e.g. "LSYS_NAME"). The correct padded objectName is built automatically.',
          },
        },
        required: ['object_type', 'object_name'],
      },
    },
    {
      name: 'bw_get_adso',
      description:
        'Read an aDSO (Advanced DataStore Object) structure — fields, settings, version.',
      inputSchema: {
        type: 'object',
        properties: {
          adso_name: {
            type: 'string',
            description: 'aDSO name (e.g. "ADSO_NAME").',
          },
          format: {
            type: 'string',
            enum: ['text', 'raw'],
            description: 'Output format. "text" (default): compact human-readable summary. "raw": raw XML from BW.',
          },
        },
        required: ['adso_name'],
      },
    },
    {
      name: 'bw_create_adso',
      description:
        'Create a new aDSO shell. ' +
        'action "from_template" (default): proposes fields/keys/settings from a template object — pass template_name. Without template_name creates an empty standard shell. ' +
        'The template can be an existing aDSO (template_type "ADSO", default) or a DataSource (template_type "RSDS"); for RSDS, source_system is required and the server proposes the DataSource fields. ' +
        'action "empty": creates a minimal empty aDSO with the given adso_type preset (no fields). ' +
        'After creation the aDSO is inactive — add fields with bw_update_adso, then call bw_activate.',
      inputSchema: {
        type: 'object',
        properties: {
          adso_name: {
            type: 'string',
            description: 'Name for the new aDSO (e.g. "ADSO_NAME").',
          },
          label: {
            type: 'string',
            description: 'Description / label for the new aDSO.',
          },
          info_area: {
            type: 'string',
            description: 'InfoArea to create the aDSO in (e.g. "NEXTJUICE").',
          },
          action: {
            type: 'string',
            enum: ['from_template', 'empty'],
            description: '"from_template" (default) or "empty".',
          },
          template_name: {
            type: 'string',
            description: 'Template object to propose fields from (action "from_template" only). An aDSO name when template_type is "ADSO", or a DataSource name when template_type is "RSDS".',
          },
          template_type: {
            type: 'string',
            enum: ['ADSO', 'RSDS'],
            description: 'Type of the template object for action "from_template": "ADSO" (default) to copy from an existing aDSO, or "RSDS" to propose fields from a DataSource. When "RSDS", source_system is required.',
          },
          source_system: {
            type: 'string',
            description: 'Source system name of the DataSource. Required when template_type is "RSDS".',
          },
          adso_type: {
            type: 'string',
            enum: ['standard', 'staging_inbound_only', 'staging_compress', 'staging_reporting', 'datamart', 'direct_update'],
            description: 'aDSO type preset for action "empty" (default "standard").',
          },
          package: {
            type: 'string',
            description: 'Development package (default "$TMP").',
          },
          write_interface: {
            type: 'boolean',
            description: 'Enable write interface (pushMode="true"). Default false.',
          },
        },
        required: ['adso_name', 'label', 'info_area'],
      },
    },
    {
      name: 'bw_update_adso',
      description:
        'Add/remove fields, change aDSO type/settings, manage key fields, or update individual field properties. ' +
        'action "add_field" (default): add one or more InfoObject-backed fields — infoobject_name required. ' +
        'action "remove_field": removes the field from the aDSO (and from the key if it was a key field). ' +
        'action "add_pure_field": add one or more pure (non-InfoObject) fields — pass fields array with name, label, data_type, optional length/precision/scale/aggregation_behavior/is_key. ' +
        'action "update_settings": change aDSO type preset and/or individual boolean flags — no infoobject_name needed. ' +
        'action "manage_keys": replace the complete key field list — pass key_fields array (empty = no key fields). ' +
        'action "update_field_properties": modify sidDeterminationMode, aggregationBehavior, fixedCurrency/Unit, or descriptions of a single field — pass field_name and properties. ' +
        'Returns a lock_handle that must be passed to bw_activate to complete the operation. ' +
        'Sequence: bw_update_adso → bw_activate (adso) → bw_activate (trfn) → bw_activate (each dtpa).',
      inputSchema: {
        type: 'object',
        properties: {
          adso_name: {
            type: 'string',
            description: 'aDSO name (e.g. "ADSO_NAME").',
          },
          infoobject_name: {
            type: 'string',
            description: 'InfoObject name or comma-separated list to add or remove (e.g. "IOBJ_NAME" or "IOBJ_A,IOBJ_B"). Required for add_field and remove_field.',
          },
          action: {
            type: 'string',
            enum: ['add_field', 'remove_field', 'add_pure_field', 'update_settings', 'manage_keys', 'update_field_properties'],
            description: '"add_field" (default), "remove_field", "add_pure_field", "update_settings", "manage_keys", or "update_field_properties".',
          },
          fields: {
            type: 'array',
            description: 'Pure field definitions for action "add_pure_field".',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'Field name (uppercase).' },
                label: { type: 'string', description: 'Field description.' },
                data_type: { type: 'string', description: 'Data type (user-facing names). Fixed length, do not pass length: INT1, INT2, INT4, INT8, FLTP, DATS, TIMS, LANG, CUKY, UNIT, DF16_RAW. No length: CURR, QUAN, STRING, RAWSTRING. User-defined length: CHAR, NUMC, RAW, SSTRING. User-defined length+precision: DEC. Precision only: DF16_DEC, DF34_DEC. Fixed length: D16N (16), D34N (34).' },
                length: { type: 'number', description: 'Length for character types (CHAR, NUMC).' },
                precision: { type: 'number', description: 'Precision (total digits) for DEC. For CURR/QUAN use scale instead.' },
                scale: { type: 'number', description: 'Decimal places for CURR, QUAN, DEC (maps to XML precision attribute for CURR/QUAN).' },
                aggregation_behavior: { type: 'string', enum: ['SUM', 'MIN', 'MAX', 'AVG', 'LAST', 'NONE'], description: 'Aggregation (default SUM for numeric types). Use NONE for no aggregation.' },
                is_key: { type: 'boolean', description: 'If true, also injects a <keyElement> entry.' },
              },
              required: ['name', 'label', 'data_type'],
            },
          },
          field_name: {
            type: 'string',
            description: 'Field name to modify (only for action "update_field_properties"), e.g. "FIELD_NAME" or "AMOUNT_P".',
          },
          properties: {
            type: 'object',
            description: 'Field properties to update (only for action "update_field_properties").',
            properties: {
              sid_determination_mode: {
                type: 'string',
                enum: ['N', 'R', 'S', 'M'],
                description: 'Master data check mode (InfoObject-backed fields only). N=none, R=reporting only, S=load/activate, M=load+SID.',
              },
              local_description: {
                description: 'Local description override (InfoObject-backed). String to override, null to clear (revert to InfoObject text).',
              },
              aggregation_behavior: {
                type: 'string',
                enum: ['SUM', 'MIN', 'MAX', 'AVG', 'LAST', 'NONE'],
                description: 'Aggregation behavior (pure fields only). Use NONE for no aggregation.',
              },
              fixed_currency: {
                description: 'Fixed currency code (pure CURR fields). String to set, null to switch to dynamic currency.',
              },
              fixed_unit: {
                description: 'Fixed unit of measure (pure QUAN fields). String to set, null to switch to dynamic unit.',
              },
              description: {
                type: 'string',
                description: 'Description label for pure fields (sets <localProperties><descriptions label="..."/>).',
              },
            },
          },
          key_fields: {
            type: 'array',
            items: { type: 'string' },
            description: 'List of field names that should be key fields (only for action "manage_keys"). Empty array removes all key fields.',
          },
          settings: {
            type: 'object',
            description: 'Settings to apply (only for action "update_settings").',
            properties: {
              adso_type: {
                type: 'string',
                enum: ['standard', 'staging_inbound_only', 'staging_compress', 'staging_reporting', 'datamart', 'direct_update'],
                description: 'aDSO type preset. Sets activateData, cubeDeltaOnly, directUpdate, isReportingObject, noAqDeletion.',
              },
              write_changelog: { type: 'boolean', description: 'Write change log (Standard type sub-option).' },
              snap_shot_scenario: { type: 'boolean', description: 'Snapshot support (Standard type sub-option).' },
              unique_data_records: { type: 'boolean', description: 'Unique records (Standard type sub-option).' },
              planning_mode: { type: 'boolean', description: 'Planning enabled.' },
              write_interface: { type: 'boolean', description: 'Enable or disable write interface (pushMode).' },
              label: { type: 'string', description: 'aDSO description text.' },
            },
          },
          transport: {
            type: 'string',
            description: 'Transport request number (e.g. DEVK900123). Only required if the BW system requires transport assignment.',
          },
        },
        required: ['adso_name'],
      },
    },
    {
      name: 'bw_create_infoobject',
      description:
        'Create a new InfoObject — Characteristic (CHA) or Key Figure (KYF) — inactive. ' +
        'Sequence: lock → POST create → unlock. ' +
        'After creation call bw_activate with object_type "iobj" to activate.',
      inputSchema: {
        type: 'object',
        properties: {
          infoobject_type: {
            type: 'string',
            enum: ['CHA', 'KYF'],
            description: 'InfoObject type: CHA (Characteristic) or KYF (Key Figure). Default "CHA".',
          },
          name: {
            type: 'string',
            description: 'InfoObject name, max 9 characters (e.g. "IOBJ_NAME").',
          },
          info_area: {
            type: 'string',
            description: 'InfoArea to assign the InfoObject to (e.g. "NEXTJUICE").',
          },
          description: {
            type: 'string',
            description: 'Short and long description text.',
          },
          // CHA-specific
          data_type: {
            type: 'string',
            enum: ['CHAR', 'NUMC', 'DATS', 'TIMS', 'SNUMC'],
            description: 'CHA only. ABAP data type. Default "CHAR".',
          },
          length: {
            type: 'number',
            description: 'CHA only. Field length. Default 10.',
          },
          conversion_routine: {
            type: 'string',
            description: 'CHA only. Conversion routine (e.g. "ALPHA"). Default "ALPHA" for CHAR/NUMC, "" for others.',
          },
          with_master_data: {
            type: 'boolean',
            description: 'CHA only. Generate master data tables. Default false.',
          },
          with_texts: {
            type: 'boolean',
            description: 'CHA only. Generate text tables. Default false.',
          },
          referenced_infoobject: {
            type: 'string',
            description: 'CHA only. Reference to an existing InfoObject (e.g. "IOBJ_NAME"). Omit withMasterData/withTexts — they are inherited. Default "".',
          },
          compound_infoobjects: {
            type: 'array',
            items: { type: 'string' },
            description: 'Technical names of the compound parent InfoObjects, in order. CHA only. Example: ["COMPND_IOBJ_NAME"].',
          },
          // KYF-specific
          object_specific_data_type: {
            type: 'string',
            enum: ['DEC', 'CURR', 'FLTP', 'QUAN', 'DATS', 'INT4', 'INT8', 'TIMS'],
            description: 'KYF only. Data type. Default "DEC". keyfigureType and semantics are derived automatically.',
          },
          aggregation_type: {
            type: 'string',
            enum: ['SUM', 'MAX', 'MIN'],
            description: 'KYF only. Aggregation type. Default "SUM".',
          },
          fixed_unit: {
            type: 'string',
            description: 'Fixed unit of measure for QUAN key figures (e.g. "KWH", "M3"). Required when object_specific_data_type is QUAN.',
          },
          fixed_currency: {
            type: 'string',
            description: 'Fixed currency for CURR key figures (e.g. "EUR"). Required when object_specific_data_type is CURR.',
          },
          // common
          package: {
            type: 'string',
            description: 'Development package. Default "$TMP".',
          },
          transport: {
            type: 'string',
            description: 'Transport request number (e.g. DEVK900123). Only required if the BW system requires transport assignment.',
          },
        },
        required: ['name', 'info_area', 'description'],
      },
    },
    {
      name: 'bw_create_infoarea',
      description:
        'Create a new InfoArea. The InfoArea is immediately active after creation — no activation step needed.',
      inputSchema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'InfoArea name, max 12 characters (e.g. "NEXTJUICE").',
          },
          parent_info_area: {
            type: 'string',
            description: 'Parent InfoArea name. Omit to create at root level.',
          },
          description: {
            type: 'string',
            description: 'Description text for the InfoArea.',
          },
          package: {
            type: 'string',
            description: 'Development package. Default "$TMP".',
          },
        },
        required: ['name'],
      },
    },
    {
      name: 'bw_create_transformation',
      description:
        'Create a new Transformation between two BW objects (aDSO, DataSource, InfoSource, etc.). ' +
        'The Transformation name is server-generated (32-char UUID-like key). ' +
        'Created inactive — call bw_activate with object_type "trfn" afterwards.',
      inputSchema: {
        type: 'object',
        properties: {
          source_object_type: {
            type: 'string',
            description: 'Source object type. Valid values: HCPR (CompositeProvider), ADSO (aDSO), RSDS (DataSource — requires source_system), HAAP (HANA Analysis Process), IOBJ (InfoObject), TRCS (InfoSource), QVIW (Query).',
          },
          source_object_name: {
            type: 'string',
            description: 'Technical name of the source object.',
          },
          target_object_type: {
            type: 'string',
            description: 'Target object type. Valid values: ADSO (aDSO), IOBJ (InfoObject), TRCS (InfoSource), DEST (Open Hub Destination).',
          },
          target_object_name: {
            type: 'string',
            description: 'Technical name of the target object.',
          },
          package: {
            type: 'string',
            description: 'Development package. Default "$TMP".',
          },
          source_system: {
            type: 'string',
            description: 'Source system name. Required when source_object_type is RSDS (DataSource).',
          },
          copy_from_transformation: {
            type: 'string',
            description: 'Technical name of an existing Transformation to copy rules from.',
          },
        },
        required: ['source_object_type', 'source_object_name', 'target_object_type', 'target_object_name'],
      },
    },
    {
      name: 'bw_move_object',
      description:
        'Move a BW object (aDSO, InfoObject, InfoArea, …) to a different InfoArea. ' +
        'Single POST operation — no lock/unlock needed.',
      inputSchema: {
        type: 'object',
        properties: {
          object_type: {
            type: 'string',
            description: 'BW object type URL segment (e.g. "adso", "iobj", "area").',
          },
          object_name: {
            type: 'string',
            description: 'Technical name of the object to move (e.g. "OBJECT_NAME").',
          },
          target_info_area: {
            type: 'string',
            description: 'Technical name of the target InfoArea (e.g. "MCPBW").',
          },
        },
        required: ['object_type', 'object_name', 'target_info_area'],
      },
    },
    {
      name: 'bw_get_infoobject',
      description:
        'Read an InfoObject definition (must already exist in the system). Returns the full XML including data type, length, conversion routine, and descriptions.',
      inputSchema: {
        type: 'object',
        properties: {
          infoobject_name: {
            type: 'string',
            description: 'InfoObject name (e.g. "IOBJ_NAME").',
          },
        },
        required: ['infoobject_name'],
      },
    },
    {
      name: 'bw_update_infoobject',
      description:
        'Update a Characteristic InfoObject: change description and/or replace the attribute list. ' +
        'Replaces all existing attributes with the supplied list (pass an empty array to remove all). ' +
        'Also supports Key Figure (KYF) updates: set fixed_unit or fixed_currency. ' +
        'Sequence: lock → GET → PUT → activate → unlock — all in one call.',
      inputSchema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'InfoObject name (e.g. "IOBJ_NAME").',
          },
          description: {
            type: 'string',
            description: 'New short and long description text. Omit to keep existing.',
          },
          transport: {
            type: 'string',
            description: 'Workbench transport order number (e.g. "DEVK900000"). Required when object is in a non-local package.',
          },
          fixed_unit: {
            type: 'string',
            description: 'KYF only. Fixed unit of measure (e.g. "KWH", "M3"). Sets fixedUnit on a QUAN key figure.',
          },
          fixed_currency: {
            type: 'string',
            description: 'KYF only. Fixed currency (e.g. "EUR"). Sets fixedCurrency on a CURR key figure.',
          },
          attributes: {
            type: 'array',
            description: 'New attribute list. Omit or pass [] to remove all attributes.',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'Technical name of the referenced InfoObject (e.g. "ATTR_IOBJ_NAME").' },
                type: { type: 'string', enum: ['DIS', 'NAV'], description: 'Attribute type: DIS (Display) or NAV (Navigation).' },
                time_dependent: { type: 'boolean', description: 'Time-dependent attribute (NAV only, default false).' },
                display_in_query: { type: 'boolean', description: 'Display in query (default true).' },
                use_text_of_original_characteristic: { type: 'boolean', description: 'Use text of original characteristic (default true).' },
              },
              required: ['name', 'type'],
            },
          },
        },
        required: ['name'],
      },
    },
    {
      name: 'bw_get_transformation',
      description:
        'Read a Transformation structure — source/target segments, mapping rules. ' +
        'Transformation names are UUID-like generated keys (e.g. "TRFN_UUID_KEY"). ' +
        'Use bw_xref on the aDSO to find the transformation name.',
      inputSchema: {
        type: 'object',
        properties: {
          transformation_name: {
            type: 'string',
            description: 'Transformation name (UUID-like key, e.g. "TRFN_UUID_KEY").',
          },
          format: {
            type: 'string',
            enum: ['text', 'raw'],
            description: 'Output format. "text" (default): compact human-readable summary. "raw": raw XML from BW.',
          },
        },
        required: ['transformation_name'],
      },
    },
    {
      name: 'bw_update_transformation',
      description:
        'Map a source field to a target InfoObject in a Transformation, or convert an existing rule to a field routine (StepRoutine) or formula rule (StepFormula). ' +
        'rule_type="direct" (default): changes a StepNoUpdate/StepInitial rule to StepDirect. ' +
        'rule_type="routine": converts an existing StepDirect, StepInitial, or StepNoUpdate rule to StepRoutine (AMDP field routine). ' +
        'rule_type="formula": converts an existing rule to StepFormula — no ABAP class generated, BW evaluates the formula natively. ' +
        'rule_type="constant": sets a fixed constant value on the target field — no source field needed. ' +
        'For routine/formula on StepNoUpdate rules, source_field is required. ' +
        'For routine/formula on StepDirect/StepInitial rules, source_field is ignored (field is already mapped). ' +
        'source_field is always ignored for rule_type="constant". ' +
        'Returns a lock_handle for bw_activate.',
      inputSchema: {
        type: 'object',
        properties: {
          transformation_name: {
            type: 'string',
            description: 'Transformation name (UUID-like key).',
          },
          source_field: {
            type: 'string',
            description:
              'Source field name in the source segment (e.g. "FIELD_NAME"). ' +
              'Required for rule_type="direct" if the existing rule has no source mapping. ' +
              'Also required for routine/formula when the target has no source mapping yet (StepNoUpdate). ' +
              'Required for rule_type="lookup".',
          },
          target_infoobject: {
            type: 'string',
            description: 'Target InfoObject name in the target segment (e.g. "IOBJ_NAME").',
          },
          rule_type: {
            type: 'string',
            enum: ['direct', 'routine', 'formula', 'constant', 'lookup', 'no_update'],
            description:
              'Rule type to assign. "direct" (default): maps source field directly (StepDirect). ' +
              '"routine": converts the rule to an AMDP field routine (StepRoutine) — the server generates the ABAP class automatically. ' +
              '"formula": converts the rule to a formula rule (StepFormula) — requires the formula parameter. ' +
              '"constant": sets a fixed constant value (StepConstant) — requires the constant_value parameter, source_field is ignored. ' +
              '"lookup": converts the rule to a StepRead (Lookup) rule — requires lookup_object and lookup_object_type. ' +
              '"no_update": reverts any existing mapping back to StepNoUpdate (no mapping, field stays empty). ' +
              'IMPORTANT: AMDP SQLSCRIPT methods only allow ASCII 7-bit characters — no German umlauts or special symbols in code or comments.',
          },
          formula: {
            type: 'string',
            description:
              'Formula expression for rule_type="formula" (required). ' +
              'Source fields are referenced by their technical field name: use /BIC/FIELDNAME for custom InfoObjects (e.g. "/BIC/FIELD_NAME + 10"), ' +
              'or the direct field name for standard InfoObjects. ' +
              'Operators: +, -, *, /. Functions: IF, ABS, CONCATENATE, DATE_YEAR, etc. ' +
              'Comparison operators < > <= >= <> are supported (will be XML-escaped automatically).',
          },
          constant_value: {
            type: 'string',
            description:
              'Constant value for rule_type="constant" (required). ' +
              'The value is written as-is into the target field during data loading. ' +
              'Example: "X" for a flag field, "USD" for a currency field.',
          },
          lookup_object: {
            type: 'string',
            description: 'Name of the InfoObject or aDSO to read from (Nachlese-Objekt). Required for rule_type="lookup".',
          },
          lookup_object_type: {
            type: 'string',
            enum: ['IOBJ', 'ADSO'],
            description: 'Type of the lookup object. "IOBJ" for InfoObject, "ADSO" for aDSO. Required for rule_type="lookup".',
          },
          additional_source_fields: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Additional source fields for rule_type="formula" when the formula references more than one source field. ' +
              'Combined with source_field, all listed fields are registered as inputs on the StepFormula rule. ' +
              'Example: ["QUANTITY_SOLD", "COST_PER_UNIT"].',
          },
          transport: {
            type: 'string',
            description: 'Transport request number (e.g. DEVK900123). Only required if the BW system requires transport assignment.',
          },
        },
        required: ['transformation_name', 'target_infoobject'],
      },
    },
    {
      name: 'bw_delete_transformation_routine',
      description:
        'Remove a Start, End, or Expert routine from a Transformation. ' +
        'Deletes the matching rule from group id="0". If no rules remain, removes the entire group. ' +
        'Returns lock_handle for bw_activate.',
      inputSchema: {
        type: 'object',
        properties: {
          transformation_name: {
            type: 'string',
            description: 'Transformation name (UUID-like key).',
          },
          routine_type: {
            type: 'string',
            enum: ['start', 'end', 'expert'],
            description: 'Routine to remove: "start", "end", or "expert".',
          },
        },
        required: ['transformation_name', 'routine_type'],
      },
    },
    {
      name: 'bw_set_transformation_routine',
      description:
        'Add a Start, End, or Expert routine to a Transformation. ' +
        'Creates the global routine group (group id="0") and ABAP/AMDP method stub. ' +
        'Returns lock_handle for bw_activate.',
      inputSchema: {
        type: 'object',
        properties: {
          transformation_name: {
            type: 'string',
            description: 'Transformation name (UUID-like key).',
          },
          routine_type: {
            type: 'string',
            enum: ['start', 'end', 'expert'],
            description: '"start" → GLOBAL_START, "end" → GLOBAL_END, "expert" → GLOBAL_EXPERT.',
          },
          transport: {
            type: 'string',
            description: 'Transport request number (e.g. DEVK900123). Only required if the BW system requires transport assignment.',
          },
        },
        required: ['transformation_name', 'routine_type'],
      },
    },
    {
      name: 'bw_set_transformation_runtime',
      description:
        'Switch a Transformation between HANA and ABAP runtime. ' +
        'Only changes the HANARuntime attribute — no rule changes. ' +
        'If the runtime already matches the target value, returns early without a PUT. ' +
        'Returns a lock_handle for bw_activate.',
      inputSchema: {
        type: 'object',
        properties: {
          transformation_name: {
            type: 'string',
            description: 'Transformation name (UUID-like key).',
          },
          runtime: {
            type: 'string',
            enum: ['hana', 'abap'],
            description: '"hana" sets HANARuntime="true", "abap" sets HANARuntime="false".',
          },
          transport: {
            type: 'string',
            description: 'Transport request number (e.g. DEVK900123). Only required if the BW system requires transport assignment.',
          },
        },
        required: ['transformation_name', 'runtime'],
      },
    },
    {
      name: 'bw_activate',
      description:
        'Activate one BW object (aDSO, Transformation, DTP, InfoObject, InfoSource, or DataSource). ' +
        'Pass the lock_handle from bw_update_adso or bw_update_transformation. ' +
        'For DTP and DataSource (rsds) activation use lock_handle="" (no lock needed — standalone activation). ' +
        'For object_type "rsds" also pass source_system (a DataSource is identified by DataSource name plus source system). ' +
        'Unlock is sent automatically after activation (not for DTPs or DataSources). ' +
        'The response lists any DTPs deactivated by impact analysis — these must be re-activated.',
      inputSchema: {
        type: 'object',
        properties: {
          object_type: {
            type: 'string',
            enum: ['adso', 'trfn', 'dtpa', 'iobj', 'trcs', 'rsds'],
            description: 'Object type: adso, trfn, dtpa, iobj, trcs, or rsds (DataSource).',
          },
          object_name: {
            type: 'string',
            description: 'Object name (e.g. "OBJECT_NAME" or "DTP_..."). For rsds, the DataSource name.',
          },
          lock_handle: {
            type: 'string',
            description:
              'Lock handle from bw_update_adso or bw_update_transformation. ' +
              'Use empty string "" for DTP and DataSource (rsds) activation.',
          },
          source_system: {
            type: 'string',
            description: 'Source system name. Required when object_type is "rsds" (e.g. "LSYS_NAME").',
          },
          transport: {
            type: 'string',
            description: 'Transport request number. Required on systems with transport obligation.',
          },
        },
        required: ['object_type', 'object_name', 'lock_handle'],
      },
    },
    {
      name: 'bw_delete',
      description:
        'Delete a BW object permanently (aDSO, InfoObject, Transformation, DTP, etc.). ' +
        'Sequence: lock (with /m) → DELETE → unlock. No activation needed — deletion is immediate. ' +
        'Dependency note: delete aDSOs before their InfoObjects, not the other way around.',
      inputSchema: {
        type: 'object',
        properties: {
          object_type: {
            type: 'string',
            description: 'BW object type: adso, iobj, trfn, dtpa, etc.',
          },
          object_name: {
            type: 'string',
            description: 'Technical object name (e.g. "OBJECT_NAME").',
          },
        },
        required: ['object_type', 'object_name'],
      },
    },
    {
      name: 'bw_unlock',
      description:
        'Release a lock on a BW object without activating it. ' +
        'Use this to discard changes and free the lock, e.g. after an aborted create or update. ' +
        'DTPs do not need unlocking.',
      inputSchema: {
        type: 'object',
        properties: {
          object_type: {
            type: 'string',
            enum: ['adso', 'trfn', 'trcs', 'iobj', 'area'],
            description: 'Object type: adso, trfn, trcs, iobj, or area (InfoArea).',
          },
          object_name: {
            type: 'string',
            description: 'Object name (e.g. "OBJECT_NAME").',
          },
        },
        required: ['object_type', 'object_name'],
      },
    },
    {
      name: 'bw_get_infosource',
      description: 'Read an InfoSource (TRCS) structure — fields, key fields, label, InfoArea, version status.',
      inputSchema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'InfoSource name (e.g. "INFOSOURCE_NAME").',
          },
        },
        required: ['name'],
      },
    },
    {
      name: 'bw_get_infoarea',
      description: 'Read an InfoArea definition — name, label, parent area, object status.',
      inputSchema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'InfoArea name (e.g. "NEXTJUICE").',
          },
        },
        required: ['name'],
      },
    },
    {
      name: 'bw_create_infosource',
      description:
        'Create a new InfoSource (TRCS) shell. ' +
        'Optionally copy fields from an existing aDSO, CompositeProvider, DataSource, or InfoObject via copy_from_* parameters. ' +
        'Created inactive — call bw_activate with object_type "trcs" afterwards. ' +
        'To add fields after creation use bw_update_infosource.',
      inputSchema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'InfoSource name (e.g. "INFOSOURCE_NAME").',
          },
          description: {
            type: 'string',
            description: 'Description / label for the InfoSource.',
          },
          info_area: {
            type: 'string',
            description: 'InfoArea to create the InfoSource in (e.g. "MCPBW").',
          },
          package: {
            type: 'string',
            description: 'Development package (default "$TMP").',
          },
          copy_from_object_name: {
            type: 'string',
            description: 'Technical name of the source object to copy fields from. Required when copy_from_object_type is set.',
          },
          copy_from_object_type: {
            type: 'string',
            enum: ['ADSO', 'HCPR', 'RSDS', 'IOBJ'],
            description: 'Type of the source object: ADSO (aDSO), HCPR (CompositeProvider), RSDS (DataSource), IOBJ (InfoObject).',
          },
          copy_from_object_sub_type: {
            type: 'string',
            enum: ['ATTR', 'TEXT', 'HIER'],
            description: 'SubType for IOBJ only: ATTR (Attribute), TEXT (Text), HIER (Hierarchy).',
          },
          copy_from_source_system: {
            type: 'string',
            description: 'Source system name (required when copy_from_object_type is RSDS, e.g. "PC_FILE").',
          },
        },
        required: ['name', 'description', 'info_area'],
      },
    },
    {
      name: 'bw_update_infosource',
      description:
        'Update an InfoSource — change description and/or replace the complete field list. ' +
        'Provide fields as an array; the entire existing field list is replaced. ' +
        'Each field can reference an InfoObject (set infoobject_name) or be a local field (omit infoobject_name). ' +
        'Returns a lock_handle for bw_activate.',
      inputSchema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'InfoSource name (e.g. "INFOSOURCE_NAME").',
          },
          description: {
            type: 'string',
            description: 'New description text (optional — omit to leave unchanged).',
          },
          fields: {
            type: 'array',
            description: 'Complete list of fields. Replaces all existing fields. Omit to leave fields unchanged.',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'Field name (uppercase).' },
                infoobject_name: { type: 'string', description: 'InfoObject name to bind this field to (omit for local fields).' },
                type: { type: 'string', description: 'Data type (e.g. CHAR, NUMC, DEC, CURR, DATS).' },
                length: { type: 'number', description: 'Field length.' },
                label: { type: 'string', description: 'Field label / description.' },
                is_key: { type: 'boolean', description: 'If true, also adds a keyElement entry.' },
                aggregation_behavior: {
                  type: 'string',
                  enum: ['NONE', 'SUM', 'MIN', 'MAX', 'AVG', 'LAST'],
                  description: 'Aggregation behavior (default "NONE").',
                },
              },
              required: ['name', 'type', 'length', 'label'],
            },
          },
          transport: {
            type: 'string',
            description: 'Transport request number (e.g. DEVK900123). Only required if the BW system requires transport assignment.',
          },
        },
        required: ['name'],
      },
    },
    {
      name: 'bw_get_dtps',
      description:
        'List DTPs (Data Transfer Processes) that depend on a BW object. ' +
        'Uses the xref endpoint filtered to DTPA object type. ' +
        'Use object_type=TRFN and the transformation name to find DTPs after activating a transformation.',
      inputSchema: {
        type: 'object',
        properties: {
          object_type: {
            type: 'string',
            description: 'Object type of the referenced object: ADSO, TRFN, IOBJ, etc.',
          },
          object_name: {
            type: 'string',
            description: 'Object name to find dependent DTPs for.',
          },
        },
        required: ['object_type', 'object_name'],
      },
    },
    {
      name: 'bw_get_dtp',
      description:
        'Read a DTP (Data Transfer Process) definition — source, target, transformation, extraction settings, and filter fields (selections and routines). ' +
        'Use bw_xref on an aDSO to find the DTP name first. ' +
        'To find only the process chain a DTP belongs to, use bw_xref with object_type=DTPA instead — it is faster and avoids loading the full DTP definition.',
      inputSchema: {
        type: 'object',
        properties: {
          dtp_name: {
            type: 'string',
            description: 'DTP name (e.g. "DTP_...").',
          },
        },
        required: ['dtp_name'],
      },
    },
    {
      name: 'bw_get_process_chain',
      description:
        'Read a Process Chain (RSPC) definition — header metadata, scheduling and monitoring ' +
        'settings, all steps (nodes) with type, variant, and last execution status, ' +
        'step dependencies (edges) with branch conditions for DECISION nodes, ' +
        'and inline variant details. ' +
        'By default (include_variant_details=true), automatically fetches and embeds the full ' +
        'variant configuration for each step that has detail available. ' +
        'Steps without variant detail (DTP_LOAD, OR, AND, EXOR, CHAIN) are shown without extra detail — ' +
        'for DTP_LOAD use bw_get_dtp, for CHAIN use bw_get_process_chain recursively. ' +
        'Set include_variant_details=false for a faster structural overview without variant detail. ' +
        'Use bw_search with object_type=PRCH to find chain names first.',
      inputSchema: {
        type: 'object',
        properties: {
          chain_name: {
            type: 'string',
            description: 'Process chain technical name (e.g. "CHAIN_NAME"). Case-insensitive.',
          },
          format: {
            type: 'string',
            enum: ['text', 'raw'],
            description: 'Output format. "text" (default): compact human-readable summary. "raw": full parsed JSON.',
          },
          include_variant_details: {
            type: 'boolean',
            description: 'If true (default), fetches variant configuration detail for each step automatically and includes it inline. Set to false to skip variant detail fetching for faster response on large chains.',
          },
        },
        required: ['chain_name'],
      },
    },
    {
      name: 'bw_get_process_variant',
      description:
        'Read the detail configuration of a single Process Variant from a Process Chain step. ' +
        'Covers all process types: ABAP (report name + selection variant), ADSOACT (aDSO activation), ' +
        'ADSOREM (request cleanup), PLSWITCHL/PLSWITCHP (planning mode switch), DTP_LOAD, ' +
        'DECISION, and any other type — oDetail is returned as indented JSON for unknown types. ' +
        'Get process_type and variant_name from bw_get_process_chain output (sProcessType and sProcessVariant fields). ' +
        'Use format="raw" to see the full unformatted JSON.',
      inputSchema: {
        type: 'object',
        properties: {
          process_type: {
            type: 'string',
            description: 'Process type technical name from the chain step (e.g. "ABAP", "DTP_LOAD", "ADSOACT", "ADSOREM", "PLSWITCHL", "PLSWITCHP", "DECISION"). Case-insensitive.',
          },
          variant_name: {
            type: 'string',
            description: 'Process variant technical name from the chain step (e.g. "ILV_...", "DTP_...", "DEL_..."). Case-insensitive.',
          },
          format: {
            type: 'string',
            enum: ['text', 'raw'],
            description: 'Output format. "text" (default): readable summary with oDetail as indented JSON. "raw": full parsed JSON.',
          },
        },
        required: ['process_type', 'variant_name'],
      },
    },
    {
      name: 'bw_list_requests',
      description:
        'List the recent load requests of an InfoProvider from the runtime request monitor, ' +
        'with decoded request status, record counts and timestamps. ' +
        'Returns one entry per request including the internal request TSN, which is the ' +
        'input for bw_get_request. Read-only. ' +
        'Use bw_search to find the target technical name first. ' +
        'Performance: listing cost scales with the number of returned rows because each row ' +
        'is enriched on the backend (a per-row cross-reference read). top bounds the result set; ' +
        'created_from and status only help by returning fewer rows, not by making a row cheaper. ' +
        'For providers with long load histories, use a narrow created_from window or a small top.',
      inputSchema: {
        type: 'object',
        properties: {
          target: {
            type: 'string',
            description: 'Target InfoProvider technical name (e.g. "OBJECT_NAME"). Case-insensitive.',
          },
          target_type: {
            type: 'string',
            description: 'Target object type (default "ADSO").',
          },
          storage: {
            type: 'string',
            description: 'Comma-separated storage area codes (default "AQ,AX,AT").',
          },
          status: {
            type: 'string',
            description: 'Comma-separated request status codes to include (default "N,GG,GR,YG,RR,YR,RG,U,Y,X").',
          },
          created_from: {
            type: 'string',
            description:
              'Optional server-side lower time bound, ISO 8601 with milliseconds and Z ' +
              '(24 chars, e.g. "YYYY-MM-DDTHH:MM:SS.000Z"). Returns only requests created at or ' +
              'after this time (open upper bound = now). Narrows the result set, which reduces ' +
              'per-row backend enrichment cost. Recommended for providers with long load histories.',
          },
          top: {
            type: 'number',
            description:
              'Upper cap on the number of requests to return (default 3). Each returned row triggers ' +
              'an expensive per-row backend read, so keep this small; raise it only when needed.',
          },
        },
        required: ['target'],
      },
    },
    {
      name: 'bw_get_request',
      description:
        'Full status analysis of one load request in a single call, bundling the request ' +
        'header, DTP information (including start, finish and duration), the process step ' +
        'chain and the message log. Read-only. ' +
        'The request TSN comes from bw_list_requests output.',
      inputSchema: {
        type: 'object',
        properties: {
          request_tsn: {
            type: 'string',
            description: 'Internal request TSN from bw_list_requests output.',
          },
          storage: {
            type: 'string',
            description: 'Storage area code (default "AQ").',
          },
          format: {
            type: 'string',
            enum: ['text', 'raw'],
            description: 'Output format. "text" (default): readable summary. "raw": full parsed JSON of all four payloads.',
          },
        },
        required: ['request_tsn'],
      },
    },
    {
      name: 'bw_activate_request',
      description:
        'Activate loaded data (DSO request activation): move a finished load from the Inbound ' +
        'Table into the active data table and change log. This is the runtime request activation, ' +
        'NOT the modeling-object activation done by bw_activate. ' +
        'Only applies to aDSOs that have an activation step (not inbound-only staging aDSOs). ' +
        'Activates all previous loads up to the given request. ' +
        'Asynchronous: a successful call starts activation; monitor completion via ' +
        'bw_list_requests / bw_get_request.',
      inputSchema: {
        type: 'object',
        properties: {
          request_tsn: {
            type: 'string',
            description: 'Load request TSN to activate (from bw_list_requests / bw_run_dtp output).',
          },
          storage: {
            type: 'string',
            description: 'Storage area code the request lives in (default "AQ").',
          },
        },
        required: ['request_tsn'],
      },
    },
    {
      name: 'bw_create_dtp',
      description:
        'Create a new DTP (Data Transfer Process) for an existing Transformation and activate it. ' +
        'The DTP name is server-generated. ' +
        'Optionally set a filter on one source field (Equal operator). ' +
        'After creation the DTP is activated automatically. ' +
        'IMPORTANT: Before calling this tool, always check the full transformation chain. ' +
        'Single-step chain (e.g. ADSO->ADSO): use trfn_name only. ' +
        'Two-step chain (e.g. ADSO->TRCS->ADSO): use trfn_name for the first transformation and trfn_name_2 for the second; ' +
        'source_name/source_type = the start object, target_name/target_type = the end object. ' +
        'Omitting trfn_name_2 in a two-step chain causes a persistent HTTP 500 error. ' +
        'Use bw_get_transformation or bw_xref to determine the chain before creating the DTP. ' +
        'DataSource source: set source_type "RSDS" and pass source_system (the DataSource source system). ' +
        'source_name is then the plain DataSource name; the tool builds the RSDS compound source key internally.',
      inputSchema: {
        type: 'object',
        properties: {
          trfn_name: {
            type: 'string',
            description: 'Technical name of the existing Transformation (UUID-like key).',
          },
          trfn_name_2: {
            type: 'string',
            description: 'Optional second transformation in a multi-step chain. Include when the DTP spans two transformations (e.g. ADSO→TRCS→ADSO).',
          },
          source_name: {
            type: 'string',
            description: 'Source object name (e.g. "SOURCE_NAME").',
          },
          source_type: {
            type: 'string',
            description: 'Source object type (e.g. "ADSO", "TRCS", "RSDS"). Use "RSDS" for a DataSource source — source_system is then required.',
          },
          source_system: {
            type: 'string',
            description: 'Source system name of the DataSource. Required when source_type is "RSDS".',
          },
          target_name: {
            type: 'string',
            description: 'Target object name (e.g. "TARGET_NAME").',
          },
          target_type: {
            type: 'string',
            description: 'Target object type (e.g. "ADSO").',
          },
          description: {
            type: 'string',
            description: 'Optional DTP description text (default: empty).',
          },
          package: {
            type: 'string',
            description: 'Development package (default "$TMP").',
          },
          filter_field: {
            type: 'string',
            description: 'Field name to filter on. Requires filter_dta_name and filter_value.',
          },
          filter_dta_name: {
            type: 'string',
            description: 'Internal dtaName for the filter field.',
          },
          filter_value: {
            type: 'string',
            description: 'Filter value for the Equal selection (e.g. "PL_001").',
          },
        },
        required: ['trfn_name', 'source_name', 'source_type', 'target_name', 'target_type'],
      },
    },
    {
      name: 'bw_run_dtp',
      description:
        'Start (execute) a run of an existing, active DTP. ' +
        'Triggers the load with a single request and returns the new run request id. ' +
        'The returned request_id is the RSPM request TSN: pass it straight into ' +
        'bw_get_request (as request_tsn) to monitor load status — no bw_list_requests lookup needed.',
      inputSchema: {
        type: 'object',
        properties: {
          dtp_name: {
            type: 'string',
            description: 'Technical name of the DTP to run (e.g. "DTP_...").',
          },
        },
        required: ['dtp_name'],
      },
    },
    {
      name: 'bw_set_dtp_filter_routine',
      description:
        'Set an ABAP filter routine on a DTP filter field. Use this only when custom ABAP code is needed for the filter logic, not for simple value filters.',
      inputSchema: {
        type: 'object',
        properties: {
          dtp_name: {
            type: 'string',
            description: 'DTP name (e.g. "DTP_...").',
          },
          field_name: {
            type: 'string',
            description: 'Filter field name as it appears in the DTP XML fields element.',
          },
          routine_code: {
            type: 'string',
            description: 'ABAP routine code (plain text, without FORM/ENDFORM wrapper).',
          },
          global_code: {
            type: 'string',
            description: 'Optional global declarations for the routine.',
          },
        },
        required: ['dtp_name', 'field_name', 'routine_code'],
      },
    },
    {
      name: 'bw_update_dtp',
      description:
        'Update DTP properties: description, simple value filter (e.g. field = value), and/or extraction mode (Full vs Delta). Use this for setting filter values on existing filter fields. ' +
        'Note: switching extraction mode between Delta and Full (and back) has BW delta-init implications — a later delta load may require re-initialization of the delta on the source.',
      inputSchema: {
        type: 'object',
        properties: {
          dtp_name: {
            type: 'string',
            description: 'DTP name to update (e.g. "DTP_...").',
          },
          description: {
            type: 'string',
            description: 'New description text for the DTP.',
          },
          filter_field: {
            type: 'string',
            description: 'Field name to filter on. Requires filter_value.',
          },
          filter_dta_name: {
            type: 'string',
            description: 'Internal dtaName for the filter field. Reserved for future use.',
          },
          filter_value: {
            type: 'string',
            description: 'Filter value(s) for the selection. Comma-separated for multiple values (e.g. "VAL1,VAL2").',
          },
          filter_excluding: {
            type: 'boolean',
            description: 'If true, the filter excludes the given values (excluding="true"). Default false (inclusive).',
          },
          filter_clear_fields: {
            type: 'string',
            description: 'Comma-separated list of field names whose filter selections should be removed entirely.',
          },
          extraction_mode: {
            type: 'string',
            enum: ['full', 'delta'],
            description: 'Switch the DTP extraction mode. "full" sets extractionMode="F"; "delta" sets extractionMode="D" (only valid for delta-capable sources). Switching modes has delta-init implications — see the tool note.',
          },
          transport: {
            type: 'string',
            description: 'Transport request number. Required on systems with transport obligation.',
          },
          transport_lock_holder: {
            type: 'string',
            description: 'Transport lock holder. The transport request that currently owns the object lock. Required on some systems when updating an existing object.',
          },
        },
        required: ['dtp_name'],
      },
    },
    {
      name: 'bw_get_push_schema',
      description:
        'Fetch the JSON schema for an aDSO write interface. ' +
        'Returns field names, data types, and required fields. ' +
        'Use this before bw_push_data to know what fields to include in records.',
      inputSchema: {
        type: 'object',
        properties: {
          adso_name: {
            type: 'string',
            description: 'aDSO technical name (e.g. "ADSO_NAME").',
          },
        },
        required: ['adso_name'],
      },
    },
    {
      name: 'bw_push_data',
      description:
        'Push data records directly into an aDSO inbound table via the SAP BW/4HANA write interface. ' +
        'The aDSO must have write_interface enabled (pushMode="true"). ' +
        'Use bw_get_push_schema first to verify field names and types. ' +
        'Success = HTTP 204 (SAP returns empty body). ' +
        'DATS fields must be formatted as YYYYMMDD strings. INT4 fields as JSON integers.',
      inputSchema: {
        type: 'object',
        properties: {
          adso_name: {
            type: 'string',
            description: 'aDSO technical name (e.g. "ADSO_NAME").',
          },
          records: {
            type: 'array',
            description: 'Array of record objects. Field names must match aDSO field names exactly (uppercase).',
            items: { type: 'object' },
          },
          mode: {
            type: 'string',
            enum: ['one_step', 'messaging'],
            description: 'Push mode. "one_step" (default): implicit request per call. "messaging": uses ?request=MESSAGING param.',
          },
        },
        required: ['adso_name', 'records'],
      },
    },
    {
      name: 'bw_get_query',
      description:
        'Read a BW Query definition — variables, filter, layout (rows/columns/free characteristics), ' +
        'calculated and restricted measures, exceptions, and cell definitions. ' +
        'Tries the active version first; falls back to the inactive version if not found. ' +
        'format="text" (default): compact human-readable output. format="raw": full parsed JSON.',
      inputSchema: {
        type: 'object',
        properties: {
          query_name: {
            type: 'string',
            description: 'Technical name of the query (e.g. "QUERY_NAME").',
          },
          format: {
            type: 'string',
            enum: ['text', 'raw'],
            description: '"text" (default): structured human-readable output. "raw": full parsed JSON.',
          },
        },
        required: ['query_name'],
      },
    },
    {
      name: 'bw_get_composite_provider',
      description:
        'Read a CompositeProvider (HCPR) structure — general info, view node type (Union/Join), ' +
        'source providers (inputs) with mapping counts, fields with dimension classification, ' +
        'join condition, and temporal join details. Returns the inactive version.',
      inputSchema: {
        type: 'object',
        properties: {
          composite_provider_name: {
            type: 'string',
            description: 'Technical name of the CompositeProvider (e.g. "HCPR_NAME").',
          },
        },
        required: ['composite_provider_name'],
      },
    },
    {
      name: 'bw_list_contents',
      description:
        'Read the direct children of any node in the BW repository tree. ' +
        'The path parameter maps to the navigation hierarchy: ' +
        'use "/" or "" for all InfoAreas, ' +
        '"area/{name}" for InfoArea contents (object type folders), ' +
        '"area/{name}/{folder}" for objects within a folder (e.g. "area/MYAREA/adso"), ' +
        '"{type}/{name}" to expand an object (e.g. "hcpr/CP_NAME" → sub-folders), ' +
        '"{type}/{name}/{subfolder}" for objects within a sub-folder (e.g. "adso/ADSO_NAME/trfn"). ' +
        'Returns name, description, object_type, object_subtype, status, has_children, ' +
        'self_url, fiori_only, and children_path (pass directly to bw_list_contents to drill down).',
      inputSchema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description:
              'Repository path to list. Use "/" or "" for all InfoAreas. ' +
              'Examples: "area/MYAREA", "area/MYAREA/hcpr", "hcpr/CP_NAME", "hcpr/CP_NAME/elem_ckf", "adso/ADSO_NAME/trfn".',
          },
        },
        required: ['path'],
      },
    },
    {
      name: 'bw_list_source_systems',
      description:
        'List logical source systems (LSYS) registered in the BW datasource structure. ' +
        'If source_system_type is provided, lists only source systems of that type (e.g. "ODP_SAP", "ODP_BW", "FILE"). ' +
        'If omitted, lists all source systems across all types. ' +
        'Returns each LSYS with name, description, source_system_type, status, self_url, and children_path ' +
        '(pass children_path directly to bw_list_datasources as the source_system argument).',
      inputSchema: {
        type: 'object',
        properties: {
          source_system_type: {
            type: 'string',
            description:
              'Optional source system type filter. Known values: ODP_BW, ODP_SAP, ODP_CDS, ODP, FILE. ' +
              'Omit to list all source systems.',
          },
        },
        required: [],
      },
    },
    {
      name: 'bw_list_datasources',
      description:
        'List all DataSources (RSDS) available under a logical source system. ' +
        'Recursively traverses the full application component (APCO) hierarchy — may take time for large systems. ' +
        'Returns each DataSource with name, source_system, description, status, self_url, and apco_path ' +
        '(ordered list of application component titles from root to the DataSource). ' +
        'Optional apco_path_filter restricts the result to a hierarchy subtree and also prunes traversal.',
      inputSchema: {
        type: 'object',
        properties: {
          source_system: {
            type: 'string',
            description: 'Logical source system name (e.g. "LSYS_NAME"). Case-insensitive.',
          },
          format: {
            type: 'string',
            enum: ['text', 'raw'],
            description: 'Output format. "text" (default): compact plain-text table. "raw": raw XML feed bodies from BW.',
          },
          apco_path_filter: {
            type: 'string',
            description:
              'Optional APCO hierarchy filter. A contiguous sequence of APCO names, "/"-style separated by ">". ' +
              'May start at any depth in the hierarchy (not root-anchored). Example: "LEVEL_1 > LEVEL_2" returns ' +
              'every DataSource that lives under a path containing LEVEL_1 directly followed by LEVEL_2. ' +
              'Each segment matches case-insensitively against the APCO display title OR the technical APCO name (trimmed). ' +
              'A single segment like "IS-U" returns all DataSources under any APCO subtree named "IS-U", at any depth.',
          },
        },
        required: ['source_system'],
      },
    },
    {
      name: 'bw_get_source_system',
      description:
        'Read the metadata of a single logical source system (LSYS) — type, description, connection details, and maintenance properties.',
      inputSchema: {
        type: 'object',
        properties: {
          source_system: {
            type: 'string',
            description: 'Logical source system name (e.g. "LSYS_NAME"). Case-insensitive.',
          },
        },
        required: ['source_system'],
      },
    },
    {
      name: 'bw_get_datasource',
      description:
        'Read the full structure of a DataSource (RSDS) — metadata, all fields with types and properties, and adapter configuration.',
      inputSchema: {
        type: 'object',
        properties: {
          datasource_name: {
            type: 'string',
            description: 'Technical name of the DataSource (e.g. "DS_NAME").',
          },
          source_system: {
            type: 'string',
            description: 'Logical source system name (e.g. "LSYS_NAME").',
          },
          format: {
            type: 'string',
            enum: ['text', 'raw'],
            description: 'Output format. "text" (default): compact human-readable summary. "raw": raw XML from BW.',
          },
        },
        required: ['datasource_name', 'source_system'],
      },
    },
    {
      name: 'bw_preview_datasource',
      description:
        'Fetch a live data preview / sample rows from a DataSource (RSDS) — ' +
        'reads the first N rows directly from the source system and returns them ' +
        'as a formatted table with field names as column headers. ' +
        'Use this when the user wants to see, sample, preview, or inspect the actual ' +
        'data behind a DataSource (e.g. "show me data from DS_X", "preview 50 rows", ' +
        '"what does DS_X look like"). ' +
        'For data from an aDSO, CompositeProvider, or BEx query, use bw_query_data instead.',
      inputSchema: {
        type: 'object',
        properties: {
          datasource_name: {
            type: 'string',
            description: 'DataSource name (e.g. "DS_NAME"). Case-insensitive.',
          },
          source_system: {
            type: 'string',
            description: 'Logical source system name (e.g. "LSYS_NAME"). Case-insensitive.',
          },
          records: {
            type: 'number',
            description: 'Number of records to fetch (default: 20). SAP returns at most this many rows.',
          },
        },
        required: ['datasource_name', 'source_system'],
      },
    },
    {
      name: 'bw_get_ckf',
      description:
        'Read a global Calculated Key Figure (CKF) defined at CompositeProvider level. ' +
        'Returns technical name, description, formula (recursively resolved), metadata, ' +
        'and the full dependency graph of referenced CKF/RKF sub-components.',
      inputSchema: {
        type: 'object',
        properties: {
          component_name: {
            type: 'string',
            description: 'Technical name of the CKF (e.g. "CKF_NAME").',
          },
        },
        required: ['component_name'],
      },
    },
    {
      name: 'bw_get_rkf',
      description:
        'Read a global Restricted Key Figure (RKF) defined at CompositeProvider level. ' +
        'Returns technical name, description, base measure, characteristic filters, metadata, ' +
        'and the full dependency graph of referenced CKF/RKF sub-components.',
      inputSchema: {
        type: 'object',
        properties: {
          component_name: {
            type: 'string',
            description: 'Technical name of the RKF (e.g. "RKF_NAME").',
          },
        },
        required: ['component_name'],
      },
    },
    {
      name: 'bw_get_structure',
      description:
        'Read a global Structure defined at CompositeProvider level. ' +
        'Returns the ordered member list with type (Selection/Formula), referenced component ' +
        'or IOBJ name, characteristic filters, and the full dependency graph.',
      inputSchema: {
        type: 'object',
        properties: {
          component_name: {
            type: 'string',
            description: 'Technical name of the Structure (e.g. "STR_NAME").',
          },
        },
        required: ['component_name'],
      },
    },
    {
      name: 'bw_query_data',
      description:
        'Execute a BW query or preview data from a provider (CompositeProvider, aDSO, etc.) via the BICS reporting endpoint. ' +
        'ALWAYS call the appropriate read tool first before querying data: ' +
        'bw_get_composite_provider for a CompositeProvider (is_provider=true), ' +
        'bw_get_adso for an aDSO (is_provider=true), ' +
        'bw_get_query for a BEx Query — this gives you the available fields, key figures, ' +
        'and the query structure before you attempt a data call. ' +
        'Then perform a GET (no state/variables) first to discover the current axis layout, ' +
        'characteristic ids, variables, and background filters before sending any POST. ' +
        'IMPORTANT — always call bw_get_filter_values before applying any filter or variable value. ' +
        'This is the only way to know the correct internal key format for a characteristic ' +
        '(e.g. date/time characteristics like 0CALMONTH, 0CALYEAR, 0CALDAY may use non-obvious formats). ' +
        'Never guess or assume filter value formats — always look them up first. ' +
        'If the GET response shows inputRequired="true", variables must be filled via POST before data is available. ' +
        'If unsure whether a BEx Query exists for the desired analysis, use bw_search or bw_list_contents first ' +
        'before falling back to a direct provider call (is_provider=true). ' +
        'Result is rendered as a formatted table with hierarchy indentation. ' +
        'KEY FIGURE STRUCTURE FILTER: to restrict which key figures appear in the result, apply filterValues ' +
        'directly on the structure dimension (isStructure=true) in state.infoObjects — use the technical name ' +
        'of the calculated or restricted key figure as the low value (e.g. "CKF_NAME" or "RKF_NAME"). ' +
        'Hierarchical children of the filtered member are included automatically. ' +
        'This is the correct approach because ad-hoc threshold filters on key figure values are not supported ' +
        'via the state mechanism; only structure-member selection is possible this way. ' +
        'CRITICAL: variable id and name values in the variablesContainer are session-specific ' +
        'and change between GET calls. Always extract variable id and name exactly from the ' +
        'variablesContainer in the GET response and use them immediately in the next POST — ' +
        'never reuse IDs from a previous GET call or from bw_get_query output. ' +
        'The variable name includes trailing spaces and a 4-digit suffix (e.g. "VARNAME                       0004") ' +
        'that must be copied verbatim from the GET response. ' +
        'format="raw" returns XML.',
      inputSchema: {
        type: 'object',
        properties: {
          comp_id: {
            type: 'string',
            description: 'BEx Query name or InfoProvider name (ADSO, HCPR, etc.) to query.',
          },
          is_provider: {
            type: 'boolean',
            description:
              'Set to true when comp_id is an InfoProvider name (CompositeProvider, aDSO, etc.) ' +
              'rather than a BEx Query name. Adds the required "!" prefix to the compid URL parameter. ' +
              'If unsure whether a query exists for the desired analysis, use bw_search or ' +
              'bw_list_contents first to check before falling back to a direct provider call.',
          },
          format: {
            type: 'string',
            enum: ['text', 'raw'],
            description: '"text" (default): structured human-readable output. "raw": raw XML response body.',
          },
          state: {
            type: 'object',
            description:
              'Axis layout and optional per-characteristic filters. ' +
              'All InfoObjects from the query must be listed (even those staying on FREE axis). ' +
              'id values must come from the GET metadata response.',
            properties: {
              infoObjects: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    name: { type: 'string', description: 'InfoObject technical name.' },
                    id: { type: 'string', description: 'id from the GET metadata response.' },
                    axis: { type: 'string', enum: ['ROWS', 'COLUMNS', 'FREE'], description: 'Target axis.' },
                    hierarchy: {
                      type: 'object',
                      description:
                        'Active hierarchy for this characteristic. Required when filtering by hierarchy node (nodeId=1). ' +
                        'Copy id, name, hryId, hryDateFrom, hryDateTo from the <hierarchy> element in the GET response.',
                      properties: {
                        id: { type: 'string', description: 'Hierarchy id attribute from GET response.' },
                        name: { type: 'string', description: 'Hierarchy name (technical name).' },
                        hryId: { type: 'string', description: 'hryId attribute (display name / variant).' },
                        hryDateFrom: { type: 'string', description: 'Validity from date (YYYYMMDD). Defaults to 00000000.' },
                        hryDateTo: { type: 'string', description: 'Validity to date (YYYYMMDD). Defaults to 99991231.' },
                      },
                      required: ['id', 'name', 'hryId'],
                    },
                    filterValues: {
                      type: 'array',
                      description:
                        'Optional filter selections for this characteristic. ' +
                        'Also works on structure dimensions (isStructure=true on ROWS or COLUMNS): ' +
                        'set low to the technical name of a key figure, calculated key figure, or restricted key figure ' +
                        '(e.g. "CKF_NAME") to restrict the result to that structure member and its children. ' +
                        'This is the only supported way to filter by key figure in BICS.',
                      items: {
                        type: 'object',
                        properties: {
                          low: { type: 'string', description: 'Filter value in external key format (e.g. altName or CHAVL_EXT). Use this for members that have a named external key.' },
                          lowInt: { type: 'string', description: 'Filter value in internal key format (e.g. GUID like 00O2...). Use when the member has no altName and only an internal GUID is known. Sends presentationMode="INT" in BICS XML.' },
                          lowText: { type: 'string', description: 'Display text for the value (optional).' },
                          high: { type: 'string', description: 'Upper bound for interval operator BT.' },
                          op: { type: 'string', description: 'Operator: EQ (default), BT, GT, LT, GE, LE.' },
                          sign: { type: 'string', description: 'I=include (default), E=exclude.' },
                          nodeId: { type: 'number', description: 'Node selection mode: 0=leaf member (default), 1=hierarchy node (use when filtering a collapsed hierarchy node like a group).' },
                        },
                      },
                    },
                  },
                  required: ['name', 'id', 'axis'],
                },
              },
            },
            required: ['infoObjects'],
          },
          variables: {
            type: 'array',
            description:
              'Variable values to fill. name must match exactly as returned by GET (may contain trailing spaces). ' +
              'id and other metadata fields come from the GET variablesContainer response.',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'Variable technical name (exact, including trailing spaces).' },
                id: { type: 'string', description: 'Variable id from the GET response.' },
                txt: { type: 'string', description: 'Variable label (optional, for readability).' },
                altName: { type: 'string', description: 'altName from the GET response (optional).' },
                type: { type: 'string', description: 'Variable type (default "charMember").' },
                inputEnabled: { type: 'boolean', description: 'Whether the variable accepts input (default true).' },
                mandatory: { type: 'boolean', description: 'Whether the variable is mandatory.' },
                iobj: { type: 'string', description: 'InfoObject the variable is based on.' },
                values: {
                  type: 'array',
                  description: 'List of select values to assign.',
                  items: {
                    type: 'object',
                    properties: {
                      low: { type: 'string', description: 'Value (CHAVL_INT internal key format).' },
                      high: { type: 'string', description: 'Upper bound for interval (op=BT).' },
                      op: { type: 'string', description: 'Operator: EQ (default) or BT.' },
                      sign: { type: 'string', description: 'I=include (default).' },
                    },
                    required: ['low'],
                  },
                },
              },
              required: ['name', 'id', 'values'],
            },
          },
          from_row: {
            type: 'number',
            description: 'Start row for pagination (default 0).',
          },
          to_row: {
            type: 'number',
            description: 'End row for pagination (default 1000).',
          },
          drill_operations: {
            type: 'array',
            description:
              'Optional. Expand or collapse hierarchy nodes or key figure structure nodes in the current result. ' +
              'Each operation targets one node by its 1-based tuple index. ' +
              'drill_state: 3 = expand, 2 = collapse. ' +
              'element_idx: which dimension within the tuple (1 = first, 2 = second, etc.) — ' +
              'use 2 when ROWS has multiple dimensions and the target node is on the second one. ' +
              'Requires the full state and variables to be sent again in the same POST (stateless endpoint). ' +
              'Use after an initial bw_query_data call to drill into a collapsed structure node or hierarchy node.',
            items: {
              type: 'object',
              properties: {
                axis: { type: 'string', enum: ['ROWS', 'COLUMNS'] },
                drill_state: { type: 'number', description: '3 = expand, 2 = collapse.' },
                tuple_idx: { type: 'number', description: '1-based index of the tuple in the current result.' },
                element_idx: { type: 'number', description: '1-based index of the dimension within the tuple.' },
              },
              required: ['axis', 'drill_state', 'tuple_idx', 'element_idx'],
            },
          },
        },
        required: ['comp_id'],
      },
    },
    {
      name: 'bw_get_filter_values',
      description:
        'Look up valid characteristic values for use in query filters or variable inputs. ' +
        'Returns CHAVL_INT (internal key) — always use this value when setting filter selectValues or variable inputs; ' +
        'CHAVL_EXT and CHAVL_INT often differ for date-type characteristics. ' +
        'Supports wildcard search: use "*" to return all values, "2022*" for prefix match. ' +
        'Optionally scope results to a specific InfoProvider (recommended when values differ by provider).',
      inputSchema: {
        type: 'object',
        properties: {
          characteristic_name: {
            type: 'string',
            description: 'InfoObject technical name to get values for (e.g. "IOBJ_NAME").',
          },
          search_string: {
            type: 'string',
            description: 'Wildcard search pattern. "*" returns all values up to max_rows. Prefix with text to filter (e.g. "2022*").',
          },
          info_provider: {
            type: 'string',
            description: 'Optional. Scopes the value list to a specific InfoProvider (ADSO, HCPR, etc.). Omit to read from master data directly.',
          },
          max_rows: {
            type: 'number',
            description: 'Maximum number of values to return (default 201).',
          },
        },
        required: ['characteristic_name', 'search_string'],
      },
    },
    {
      name: 'bw_get_roles',
      description:
        'Load the complete BW query role hierarchy as shown in the "Publish to Role" dialog. ' +
        'Returns all roles (ROLE nodes) and their folder structure (FOLDER nodes) with nodeids. ' +
        'Use this to discover role names and folder names needed for bw_set_query_roles. ' +
        'Optionally filter to roles whose name starts with a given prefix.',
      inputSchema: {
        type: 'object',
        properties: {
          role_filter: {
            type: 'string',
            description: 'Optional prefix to filter results. Only ROLE nodes whose name starts with this prefix are included (e.g. "BW:").',
          },
        },
        required: [],
      },
    },
    {
      name: 'bw_get_query_roles',
      description:
        'Get all roles and folders where a specific BW query is currently published. ' +
        'Returns the role name, description, and folder for each assignment. ' +
        'If the query is not published anywhere, returns a clear message.',
      inputSchema: {
        type: 'object',
        properties: {
          query_name: {
            type: 'string',
            description: 'Technical name of the BW query (case-insensitive).',
          },
        },
        required: ['query_name'],
      },
    },
    {
      name: 'bw_set_query_roles',
      description:
        'Publish or unpublish a BW query in a role or folder. ' +
        'action "add": assigns the query to the given role or folder. ' +
        'action "remove": removes the query from the given role or folder. ' +
        'Use bw_get_roles to discover role/folder names and bw_get_query_roles to see current assignments.',
      inputSchema: {
        type: 'object',
        properties: {
          query_name: {
            type: 'string',
            description: 'Technical name of the BW query (case-insensitive).',
          },
          action: {
            type: 'string',
            enum: ['add', 'remove'],
            description: '"add" to publish, "remove" to unpublish.',
          },
          target_name: {
            type: 'string',
            description:
              'For target_type "role": the name attribute of the ROLE node (e.g. from bw_get_roles). ' +
              'For target_type "folder": the txt (display name) of the FOLDER node.',
          },
          target_type: {
            type: 'string',
            enum: ['role', 'folder'],
            description: '"role" to assign at role level, "folder" to assign into a specific subfolder.',
          },
          parent_role_name: {
            type: 'string',
            description: 'Required when target_type is "folder". The name attribute of the parent ROLE node that contains the target folder.',
          },
        },
        required: ['query_name', 'action', 'target_name', 'target_type'],
      },
    },
    {
      name: 'bw_get_role_queries',
      description:
        'List all BW queries published in BW roles (via the "Publish to Role" mechanism). ' +
        'Returns each role with its assigned queries, including technical name, description, object type, and InfoProvider. ' +
        'Note: only SAP_BW_QUERY objects are returned; PFCG menu entries of other types (e.g. AFO workbooks added as transactions) are not included. ' +
        'Use role_name to filter to a specific role; omit it to see all roles with published queries.',
      inputSchema: {
        type: 'object',
        properties: {
          role_name: {
            type: 'string',
            description: 'Optional. Technical name of the role to filter by (e.g. from bw_get_roles). Omit to return all roles.',
          },
        },
        required: [],
      },
    },
    {
      name: 'bw_get_dataflow',
      description:
        'Trace the data flow graph for a BW object. ' +
        'Returns a tree (≤ 30 nodes) or flat table (> 30 nodes) showing all connected objects ' +
        '(ADSO, RSDS, TRFN, DTPA, TRCS, IOBJ, HCPR, LSYS, ELEM) with their type, name, description, and status. ' +
        'BW direction convention: "upwards" traverses towards BW target objects (ADSO, TRFN, TRCS, IOBJ); ' +
        '"downwards" traverses towards source systems (LSYS, RSDS). ' +
        'Use this to understand the full lineage of an object without navigating each connection manually. ' +
        'IMPORTANT: Always print the complete tool result verbatim as a fenced code block in your chat response — never omit or summarize it.',
      inputSchema: {
        type: 'object',
        properties: {
          object_name: {
            type: 'string',
            description: 'Technical name of the BW object (e.g. "ADSO_NAME", "DS_NAME").',
          },
          object_type: {
            type: 'string',
            description: 'BW object type: ADSO, RSDS, HCPR, TRFN, DTPA, IOBJ, TRCS, LSYS.',
          },
          source_system: {
            type: 'string',
            description: 'Required when object_type is RSDS. Logical source system name (e.g. "LSYS_NAME").',
          },
          direction: {
            type: 'string',
            enum: ['upwards', 'downwards', 'both'],
            description: 'Direction to traverse: "upwards" (towards BW target objects: ADSO, TRFN, TRCS, IOBJ), "downwards" (towards source systems: LSYS, RSDS), or "both". Default "both".',
          },
          levels: {
            type: 'number',
            description: 'Number of levels to expand in each direction. -1 = all levels (default).',
          },
          format: {
            type: 'string',
            enum: ['text', 'raw'],
            description: 'Output format. "text" (default): tree or flat table. "raw": raw XML from BW.',
          },
        },
        required: ['object_name', 'object_type'],
      },
    },
  ],
}));

// ── Tool handlers ─────────────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    const text = await dispatchTool(
      client,
      name,
      args as Record<string, unknown> | undefined,
    );
    return { content: [{ type: 'text', text }] };
  } catch (error: unknown) {
    if (error instanceof UnknownToolError) {
      throw new McpError(ErrorCode.MethodNotFound, error.message);
    }
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: `Error: ${message}` }],
      isError: true,
    };
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  try {
    await client.loadMediaTypes();
  } catch (err) {
    process.stderr.write(`[bw-modeling-mcp] Warning: discovery failed, using hardcoded media type fallbacks (${err})\n`);
  }
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Log to stderr only (stdout is used for MCP protocol messages)
  process.stderr.write('bw-modeling-mcp server started\n');
}

main().catch((err) => {
  process.stderr.write(`Fatal error: ${err}\n`);
  process.exit(1);
});
