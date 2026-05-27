import { BwClient } from './bw-client.js';
import { bwGetAdso, bwCreateAdso, FieldDef, bwUpdateAdso, bwUpdateAdsoAddPureField, bwUpdateAdsoSettings, AdsoSettings, bwUpdateAdsoManageKeys, bwUpdateAdsoFieldProperties, FieldProperties } from './tools/adso.js';
import { bwGetInfoObject, bwCreateInfoObject, bwUpdateInfoObject, AttributeDef } from './tools/infoobject.js';
import { bwGetTransformation, bwUpdateTransformation, bwCreateTransformation, bwSetTransformationRuntime, bwSetTransformationRoutine, bwDeleteTransformationRoutine } from './tools/transformation.js';
import { bwActivate } from './tools/activation.js';
import { bwGetDtps, bwGetDtp, bwCreateDtp, bwRunDtp, bwUpdateDtp, bwSetDtpFilterRoutine } from './tools/dtp.js';
import { bwSearch, bwXref } from './tools/search.js';
import { bwDelete } from './tools/delete.js';
import { bwCreateInfoArea, bwMoveObject, bwGetInfoarea } from './tools/infoarea.js';
import { bwCreateInfosource, bwUpdateInfosource, bwGetInfosource, InfosourceField } from './tools/infosource.js';
import { bwPushData, bwGetPushSchema } from './tools/push.js';
import { bwGetQuery } from './tools/query.js';
import { bwGetCompositeProvider } from './tools/composite_provider.js';
import { bwGetCkf, bwGetRkf, bwGetStructure } from './tools/cp_components.js';
import { bwListContents } from './tools/repository.js';
import { bwListSourceSystems, bwListDatasources, bwGetSourceSystem, bwGetDatasource, bwPreviewDatasource } from './tools/datasource.js';
import { bwGetDataflow } from './tools/dataflow.js';
import { bwQueryData, bwGetFilterValues, InfoObjectState, VariableInput, DrillOperation } from './tools/reporting.js';
import { bwGetRoles, bwGetQueryRoles, bwSetQueryRoles, bwGetRoleQueries } from './tools/roles.js';
import { bwGetProcessChain } from './tools/processchain.js';
import { bwGetProcessVariant } from './tools/processvariant.js';
import { bwListRequests, bwGetRequest, bwActivateRequest } from './tools/request_monitor.js';

export const TOOL_NAMES = [
  'bw_search',
  'bw_xref',
  'bw_get_adso',
  'bw_create_adso',
  'bw_update_adso',
  'bw_create_infoobject',
  'bw_create_infoarea',
  'bw_create_transformation',
  'bw_move_object',
  'bw_get_infoobject',
  'bw_update_infoobject',
  'bw_get_transformation',
  'bw_update_transformation',
  'bw_delete_transformation_routine',
  'bw_set_transformation_routine',
  'bw_set_transformation_runtime',
  'bw_activate',
  'bw_delete',
  'bw_unlock',
  'bw_get_infosource',
  'bw_get_infoarea',
  'bw_create_infosource',
  'bw_update_infosource',
  'bw_get_dtps',
  'bw_get_dtp',
  'bw_get_process_chain',
  'bw_get_process_variant',
  'bw_create_dtp',
  'bw_set_dtp_filter_routine',
  'bw_update_dtp',
  'bw_get_push_schema',
  'bw_push_data',
  'bw_get_query',
  'bw_list_contents',
  'bw_list_source_systems',
  'bw_list_datasources',
  'bw_get_source_system',
  'bw_get_datasource',
  'bw_preview_datasource',
  'bw_get_composite_provider',
  'bw_get_ckf',
  'bw_get_rkf',
  'bw_get_structure',
  'bw_query_data',
  'bw_get_filter_values',
  'bw_get_roles',
  'bw_get_query_roles',
  'bw_set_query_roles',
  'bw_get_role_queries',
  'bw_get_dataflow',
  'bw_run_dtp',
  'bw_list_requests',
  'bw_get_request',
  'bw_activate_request',
] as const;

export class UnknownToolError extends Error {
  constructor(name: string) {
    super(`Unknown tool: ${name}`);
    this.name = 'UnknownToolError';
  }
}

/**
 * Dispatch a tool call to its implementation. Returns the textual result.
 * Used by both the MCP server (index.ts) and the CLI (cli.ts).
 */
export async function dispatchTool(
  client: BwClient,
  name: string,
  args: Record<string, unknown> | undefined,
): Promise<string> {
  switch (name) {
    case 'bw_search':
      return bwSearch(
        client,
        args?.search_term as string,
        args?.object_type as string | undefined,
      );

    case 'bw_xref':
      return bwXref(
        client,
        args?.object_type as string,
        args?.object_name as string,
        args?.source_system as string | undefined,
      );

    case 'bw_get_adso':
      return bwGetAdso(
        client,
        args?.adso_name as string,
        args?.format as 'text' | 'raw' | undefined ?? 'text',
      );

    case 'bw_create_adso':
      return bwCreateAdso(
        client,
        args?.adso_name as string,
        args?.label as string,
        args?.info_area as string,
        (args?.action as 'from_template' | 'empty') ?? 'from_template',
        args?.template_name as string | undefined,
        (args?.template_type as 'ADSO' | 'RSDS') ?? 'ADSO',
        args?.source_system as string | undefined,
        (args?.adso_type as string) ?? 'standard',
        (args?.package as string) ?? '$TMP',
        (args?.write_interface as boolean) ?? false
      );

    case 'bw_update_adso': {
      if (args?.action === 'update_settings') {
        const s = (args?.settings ?? {}) as Record<string, unknown>;
        const settings: AdsoSettings = {
          adsoType: s['adso_type'] as AdsoSettings['adsoType'],
          writeChangelog: s['write_changelog'] as boolean | undefined,
          snapShotScenario: s['snap_shot_scenario'] as boolean | undefined,
          uniqueDataRecords: s['unique_data_records'] as boolean | undefined,
          planningMode: s['planning_mode'] as boolean | undefined,
          writeInterface: s['write_interface'] as boolean | undefined,
          label: s['label'] as string | undefined,
        };
        (Object.keys(settings) as Array<keyof AdsoSettings>).forEach(
          (k) => settings[k] === undefined && delete settings[k]
        );
        settings.transport = args?.transport as string | undefined;
        return bwUpdateAdsoSettings(client, args?.adso_name as string, settings);
      }
      if (args?.action === 'manage_keys') {
        return bwUpdateAdsoManageKeys(
          client,
          args?.adso_name as string,
          (args?.key_fields as string[]) ?? [],
          args?.transport as string | undefined
        );
      }
      if (args?.action === 'add_pure_field') {
        const rawFields = (args?.fields as Array<Record<string, unknown>>) ?? [];
        const fieldDefs: FieldDef[] = rawFields.map((f) => ({
          name: f['name'] as string,
          label: f['label'] as string,
          dataType: f['data_type'] as string,
          length: f['length'] as number | undefined,
          precision: f['precision'] as number | undefined,
          scale: f['scale'] as number | undefined,
          aggregationBehavior: f['aggregation_behavior'] as string | undefined,
          isKey: f['is_key'] as boolean | undefined,
        }));
        return bwUpdateAdsoAddPureField(client, args?.adso_name as string, fieldDefs, args?.transport as string | undefined);
      }
      if (args?.action === 'update_field_properties') {
        const p = (args?.properties ?? {}) as Record<string, unknown>;
        const fp: FieldProperties = {};
        if (p['sid_determination_mode'] !== undefined) fp.sidDeterminationMode = p['sid_determination_mode'] as FieldProperties['sidDeterminationMode'];
        if ('local_description' in p) fp.localDescription = p['local_description'] as string | null;
        if (p['aggregation_behavior'] !== undefined) fp.aggregationBehavior = p['aggregation_behavior'] as FieldProperties['aggregationBehavior'];
        if ('fixed_currency' in p) fp.fixedCurrency = p['fixed_currency'] as string | null;
        if ('fixed_unit' in p) fp.fixedUnit = p['fixed_unit'] as string | null;
        if (p['description'] !== undefined) fp.description = p['description'] as string;
        fp.transport = args?.transport as string | undefined;
        return bwUpdateAdsoFieldProperties(
          client,
          args?.adso_name as string,
          args?.field_name as string,
          fp
        );
      }
      return bwUpdateAdso(
        client,
        args?.adso_name as string,
        args?.infoobject_name as string,
        (args?.action as 'add_field' | 'remove_field') ?? 'add_field',
        args?.transport as string | undefined
      );
    }

    case 'bw_create_infoobject':
      return bwCreateInfoObject(client, {
        infoobject_type: args?.infoobject_type as 'CHA' | 'KYF' | undefined,
        name: args?.name as string,
        info_area: args?.info_area as string,
        description: args?.description as string,
        data_type: args?.data_type as string | undefined,
        length: args?.length as number | undefined,
        conversion_routine: args?.conversion_routine as string | undefined,
        with_master_data: args?.with_master_data as boolean | undefined,
        with_texts: args?.with_texts as boolean | undefined,
        referenced_infoobject: args?.referenced_infoobject as string | undefined,
        compound_infoobjects: args?.compound_infoobjects as string[] | undefined,
        object_specific_data_type: args?.object_specific_data_type as string | undefined,
        aggregation_type: args?.aggregation_type as string | undefined,
        fixed_unit: args?.fixed_unit as string | undefined,
        fixed_currency: args?.fixed_currency as string | undefined,
        package: args?.package as string | undefined,
        transport: args?.transport as string | undefined,
      });

    case 'bw_create_infoarea':
      return bwCreateInfoArea(client, {
        name: args?.name as string,
        parent_info_area: args?.parent_info_area as string | undefined,
        description: args?.description as string | undefined,
        package: args?.package as string | undefined,
      });

    case 'bw_create_transformation':
      return bwCreateTransformation(client, {
        source_object_type: args?.source_object_type as string,
        source_object_name: args?.source_object_name as string,
        target_object_type: args?.target_object_type as string,
        target_object_name: args?.target_object_name as string,
        package: args?.package as string | undefined,
        source_system: args?.source_system as string | undefined,
        copy_from_transformation: args?.copy_from_transformation as string | undefined,
      });

    case 'bw_move_object':
      return bwMoveObject(client, {
        objectType: args?.object_type as string,
        objectName: args?.object_name as string,
        targetInfoArea: args?.target_info_area as string,
      });

    case 'bw_get_infoobject':
      return bwGetInfoObject(client, args?.infoobject_name as string);

    case 'bw_update_infoobject': {
      const rawAttrs = (args?.attributes as Array<Record<string, unknown>> | undefined) ?? [];
      const attrDefs: AttributeDef[] = rawAttrs.map((a) => ({
        name: a['name'] as string,
        type: a['type'] as 'DIS' | 'NAV',
        timeDependent: a['time_dependent'] as boolean | undefined,
        displayInQuery: a['display_in_query'] as boolean | undefined,
        useTextOfOriginalCharacteristic: a['use_text_of_original_characteristic'] as boolean | undefined,
      }));
      return bwUpdateInfoObject(client, {
        name: args?.name as string,
        attributes: attrDefs,
        description: args?.description as string | undefined,
        fixed_unit: args?.fixed_unit as string | undefined,
        fixed_currency: args?.fixed_currency as string | undefined,
        transport: args?.transport as string | undefined,
      });
    }

    case 'bw_get_transformation':
      return bwGetTransformation(
        client,
        args?.transformation_name as string,
        args?.format as 'text' | 'raw' | undefined ?? 'text',
      );

    case 'bw_update_transformation':
      return bwUpdateTransformation(
        client,
        args?.transformation_name as string,
        args?.source_field as string | undefined,
        args?.target_infoobject as string,
        (args?.rule_type as 'direct' | 'routine' | 'formula' | 'constant' | 'lookup' | 'no_update' | undefined) ?? 'direct',
        args?.formula as string | undefined,
        args?.constant_value as string | undefined,
        args?.lookup_object as string | undefined,
        args?.lookup_object_type as string | undefined,
        args?.transport as string | undefined,
        args?.additional_source_fields as string[] | undefined,
      );

    case 'bw_delete_transformation_routine':
      return bwDeleteTransformationRoutine(
        client,
        args?.transformation_name as string,
        args?.routine_type as 'start' | 'end' | 'expert'
      );

    case 'bw_set_transformation_routine':
      return bwSetTransformationRoutine(
        client,
        args?.transformation_name as string,
        args?.routine_type as 'start' | 'end' | 'expert',
        args?.transport as string | undefined
      );

    case 'bw_set_transformation_runtime':
      return bwSetTransformationRuntime(
        client,
        args?.transformation_name as string,
        args?.runtime as 'hana' | 'abap',
        args?.transport as string | undefined
      );

    case 'bw_activate':
      return bwActivate(
        client,
        args?.object_type as string,
        args?.object_name as string,
        args?.lock_handle as string,
        args?.transport as string | undefined
      );

    case 'bw_delete':
      return bwDelete(
        client,
        args?.object_type as string,
        args?.object_name as string
      );

    case 'bw_unlock':
      await client.unlock(
        args?.object_type as string,
        args?.object_name as string
      );
      return JSON.stringify({ success: true, message: `Lock on ${(args?.object_type as string).toUpperCase()} '${args?.object_name}' released.` });

    case 'bw_get_infosource':
      return bwGetInfosource(client, args?.name as string);

    case 'bw_get_infoarea':
      return bwGetInfoarea(client, args?.name as string);

    case 'bw_create_infosource':
      return bwCreateInfosource(
        client,
        args?.name as string,
        args?.description as string,
        args?.info_area as string,
        (args?.package as string) ?? '$TMP',
        args?.copy_from_object_name as string | undefined,
        args?.copy_from_object_type as string | undefined,
        args?.copy_from_object_sub_type as string | undefined,
        args?.copy_from_source_system as string | undefined
      );

    case 'bw_update_infosource': {
      const rawFields = args?.fields as Array<Record<string, unknown>> | undefined;
      const fieldDefs: InfosourceField[] | undefined = rawFields?.map((f) => ({
        name: f['name'] as string,
        infoObjectName: f['infoobject_name'] as string | undefined,
        type: f['type'] as string,
        length: f['length'] as number,
        label: f['label'] as string,
        isKey: f['is_key'] as boolean | undefined,
        aggregationBehavior: f['aggregation_behavior'] as string | undefined,
      }));
      return bwUpdateInfosource(
        client,
        args?.name as string,
        args?.description as string | undefined,
        fieldDefs,
        args?.transport as string | undefined
      );
    }

    case 'bw_get_dtps':
      return bwGetDtps(
        client,
        args?.object_type as string,
        args?.object_name as string
      );

    case 'bw_get_dtp':
      return bwGetDtp(client, args?.dtp_name as string);

    case 'bw_get_process_chain':
      return bwGetProcessChain(
        client,
        args?.chain_name as string,
        args?.format as 'text' | 'raw' | undefined ?? 'text',
        args?.include_variant_details !== false,
      );

    case 'bw_get_process_variant':
      return bwGetProcessVariant(
        client,
        args?.process_type as string,
        args?.variant_name as string,
        args?.format as 'text' | 'raw' | undefined ?? 'text',
      );

    case 'bw_create_dtp':
      return bwCreateDtp(client, {
        trfn_name: args?.trfn_name as string,
        trfn_name_2: args?.trfn_name_2 as string | undefined,
        source_name: args?.source_name as string,
        source_type: args?.source_type as string,
        target_name: args?.target_name as string,
        target_type: args?.target_type as string,
        description: args?.description as string | undefined,
        package: args?.package as string | undefined,
        filter_field: args?.filter_field as string | undefined,
        filter_dta_name: args?.filter_dta_name as string | undefined,
        filter_value: args?.filter_value as string | undefined,
      });

    case 'bw_set_dtp_filter_routine':
      return bwSetDtpFilterRoutine(client, {
        dtp_name: args?.dtp_name as string,
        field_name: args?.field_name as string,
        routine_code: args?.routine_code as string,
        global_code: args?.global_code as string | undefined,
      });

    case 'bw_update_dtp':
      return bwUpdateDtp(client, {
        dtp_name: args?.dtp_name as string,
        description: args?.description as string | undefined,
        filter_field: args?.filter_field as string | undefined,
        filter_dta_name: args?.filter_dta_name as string | undefined,
        filter_value: args?.filter_value as string | undefined,
        filter_excluding: args?.filter_excluding as boolean | undefined,
        filter_clear_fields: args?.filter_clear_fields as string | undefined,
        transport: args?.transport as string | undefined,
        transport_lock_holder: args?.transport_lock_holder as string | undefined,
      });

    case 'bw_get_push_schema':
      return bwGetPushSchema(args?.adso_name as string);

    case 'bw_push_data':
      return bwPushData(
        args?.adso_name as string,
        args?.records as object[],
        (args?.mode as string) ?? 'one_step'
      );

    case 'bw_get_query':
      return bwGetQuery(
        args?.query_name as string,
        (args?.format as 'text' | 'raw') ?? 'text'
      );

    case 'bw_list_contents':
      return bwListContents(client, args?.path as string);

    case 'bw_list_source_systems':
      return bwListSourceSystems(client, args?.source_system_type as string | undefined);

    case 'bw_list_datasources':
      return bwListDatasources(
        client,
        args?.source_system as string,
        args?.format as 'text' | 'raw' | undefined ?? 'text',
        args?.apco_path_filter as string | undefined,
      );

    case 'bw_get_source_system':
      return bwGetSourceSystem(client, args?.source_system as string);

    case 'bw_get_datasource':
      return bwGetDatasource(
        client,
        args?.datasource_name as string,
        args?.source_system as string,
        args?.format as 'text' | 'raw' | undefined ?? 'text',
      );

    case 'bw_preview_datasource':
      return bwPreviewDatasource(
        client,
        args?.datasource_name as string,
        args?.source_system as string,
        (args?.records as number | undefined) ?? 20,
      );

    case 'bw_get_composite_provider':
      return bwGetCompositeProvider(client, args?.composite_provider_name as string);

    case 'bw_get_ckf':
      return bwGetCkf(client, args?.component_name as string);

    case 'bw_get_rkf':
      return bwGetRkf(client, args?.component_name as string);

    case 'bw_get_structure':
      return bwGetStructure(client, args?.component_name as string);

    case 'bw_query_data': {
      const rawState = args?.state as { infoObjects: Array<Record<string, unknown>> } | undefined;
      const state = rawState
        ? {
            infoObjects: rawState.infoObjects.map((io): InfoObjectState => ({
              name: io['name'] as string,
              id: io['id'] as string,
              axis: io['axis'] as string,
              hierarchy: io['hierarchy'] as InfoObjectState['hierarchy'],
              filterValues: io['filterValues'] as InfoObjectState['filterValues'],
            })),
          }
        : undefined;
      const rawVars = args?.variables as Array<Record<string, unknown>> | undefined;
      const variables = rawVars?.map((v): VariableInput => ({
        name: v['name'] as string,
        id: v['id'] as string,
        txt: v['txt'] as string | undefined,
        altName: v['altName'] as string | undefined,
        type: v['type'] as string | undefined,
        inputEnabled: v['inputEnabled'] as boolean | undefined,
        mandatory: v['mandatory'] as boolean | undefined,
        iobj: v['iobj'] as string | undefined,
        values: v['values'] as VariableInput['values'],
      }));
      const rawDrillOps = args?.drill_operations as Array<Record<string, unknown>> | undefined;
      const drillOperations = rawDrillOps?.map((op): DrillOperation => ({
        axis: op['axis'] as 'ROWS' | 'COLUMNS',
        drill_state: op['drill_state'] as 3 | 2,
        tuple_idx: op['tuple_idx'] as number,
        element_idx: op['element_idx'] as number,
      }));
      return bwQueryData(
        client,
        args?.comp_id as string,
        (args?.is_provider as boolean) ?? false,
        (args?.format as 'text' | 'raw') ?? 'text',
        state,
        variables,
        (args?.from_row as number) ?? 0,
        (args?.to_row as number) ?? 1000,
        drillOperations
      );
    }

    case 'bw_get_filter_values':
      return bwGetFilterValues(
        client,
        args?.characteristic_name as string,
        args?.search_string as string,
        args?.info_provider as string | undefined,
        (args?.max_rows as number) ?? 201
      );

    case 'bw_get_roles':
      return bwGetRoles(
        client,
        args?.role_filter as string | undefined
      );

    case 'bw_get_query_roles':
      return bwGetQueryRoles(
        client,
        args?.query_name as string
      );

    case 'bw_set_query_roles':
      return bwSetQueryRoles(
        client,
        args?.query_name as string,
        args?.action as 'add' | 'remove',
        args?.target_name as string,
        args?.target_type as 'role' | 'folder',
        args?.parent_role_name as string | undefined
      );

    case 'bw_get_role_queries':
      return bwGetRoleQueries(
        client,
        args?.role_name as string | undefined
      );

    case 'bw_get_dataflow':
      return bwGetDataflow(
        client,
        args?.object_name as string,
        args?.object_type as string,
        args?.source_system as string | undefined,
        (args?.direction as 'upwards' | 'downwards' | 'both') ?? 'both',
        (args?.levels as number) ?? -1,
        (args?.format as 'text' | 'raw') ?? 'text',
      );

    case 'bw_run_dtp':
      return bwRunDtp(args?.dtp_name as string);

    case 'bw_list_requests':
      return bwListRequests(
        client,
        args?.target as string,
        args?.target_type as string | undefined ?? 'ADSO',
        args?.storage as string | undefined ?? 'AQ,AX,AT',
        args?.status as string | undefined ?? 'N,GG,GR,YG,RR,YR,RG,U,Y,X',
        args?.top as number | undefined ?? 3,
        args?.created_from as string | undefined,
      );

    case 'bw_get_request':
      return bwGetRequest(
        client,
        args?.request_tsn as string,
        args?.storage as string | undefined ?? 'AQ',
        args?.format as 'text' | 'raw' | undefined ?? 'text',
      );

    case 'bw_activate_request':
      return bwActivateRequest(
        args?.request_tsn as string,
        args?.storage as string | undefined ?? 'AQ',
      );

    default:
      throw new UnknownToolError(name);
  }
}
