# What's New — Release Archive

The **latest** release highlights live in the [README](README.md#-whats-new).
This file archives the "What's New" notes of all **earlier** releases, newest first,
so the README stays focused on the current version.

For the complete, structured change history see [CHANGELOG.md](CHANGELOG.md).

---

## What's New — v0.9.0

**Integrated Planning — complete read-only coverage**

All four core object types of BW Integrated Planning (IP / embedded BPC) are now readable:

- `bw_get_aggregation_level` — reads an Aggregation Level (ALVL): the planning-enabled view on top of an InfoProvider, with the complete element list — characteristics including compounding, key figures including aggregation behavior, semantics, and unit/currency reference
- `bw_get_planning_function` — reads a Planning Function (PLSE): function type, aggregation level, characteristic usage roles, and the full parameter tree; for FORMULA functions the FOX code is surfaced directly as a parameter value
- `bw_get_planning_sequence` — reads a Planning Sequence (PLSQ): ordered step list with aggregation level, planning function, and filter name per step
- `bw_get_planning_properties` — reads the Planning Properties (PLCR) of a plan-enabled InfoProvider: key-date mode, maximum characteristic combinations, and save strategy

**Process chain authoring and monitoring**

Building on the existing `bw_get_process_chain` (structural read), three authoring and three monitoring tools are now available:

- `bw_create_process_chain` / `bw_update_process_chain` / `bw_activate_process_chain` — create, replace the step model of, and activate a Process Chain (RSPC); supported step types: `DTP_LOAD`, `ADSOACT`, `CHAIN` (local sub-chain start, verified), and collectors `AND` / `OR` / `XOR`; inline-configured process types (ABAP programs, OS commands, attribute change runs, etc.) are not yet supported
- `bw_list_process_chain_runs` — execution history of one or all chains: status, timestamps, duration, and log ID
- `bw_get_process_chain_run_detail` — step-level and message-level detail of a single run, including error messages
- `bw_list_process_chain_last_status` — last execution status and scheduling state for every chain in the system

**Further new tools**

- `bw_get_open_hub` — reads an Open Hub Destination (DEST): destination type, source object, DB table, InfoArea, and the complete output field list with types, InfoObject binding, conversion routine, and key flag
- `bw_list_remote_entities` / `bw_create_datasource` — discover HANA views and virtual tables exposed by a source system, then create a DataSource from the server's field proposal; activation is a separate step via `bw_activate`
- `bw_set_transformation_routine_fields` — sets the target fields an END routine writes; accepts an explicit field list or an exclusion list

**Improvements**

`bw_activate` now supports `hcpr` (CompositeProvider); `bw_create_dtp` accepts InfoObject attribute targets (`IOBJ`, mapped to `IOBJA`); `bw_update_transformation` supports field-based direct mappings for targets without an underlying InfoObject.

---

## What's New — v0.8.0

**Runtime tools & request monitoring** — the first tools driven by the BW/4HANA `/sap/bc/.../bw4` manage API (the same operations you'd otherwise perform in the BW/4HANA Cockpit), not the `/sap/bw/modeling` tool API:

- `bw_run_dtp` — start (execute) a DTP load; returns the run request id (RSPM TSN) usable directly with `bw_get_request`
- `bw_list_requests` / `bw_get_request` — monitor load requests: status, records, DTP info, process steps, message log
- `bw_activate_request` — activate loaded data (move a finished load from the inbound table into the active data table + change log)

**BW Bridge connectivity** — authenticate against BW systems running on the SAP BTP ABAP stack (BW Bridge) via a browser-exported cookie file (`BW_COOKIE_FILE`), in addition to Basic Auth; login/session approach analogous to [vibing-steampunk](https://github.com/oisee/vibing-steampunk).

**DataSource (RSDS) across the modeling lifecycle** — create an aDSO from a DataSource template (`bw_create_adso`), use a DataSource as DTP source (`bw_create_dtp`), and activate a DataSource (`bw_activate`).

**Fixes** — query reads negotiate the backend content-type version via discovery (fixes HTTP 415 on higher SP levels, #11); DTP activation no longer reports a false "transformation inactive"; field-add works on staging/inbound aDSOs without key elements; DATS date constants survive activation; transformation rule editing picks the correct rule when a start/end routine exists.

---

## What's New — v0.7.0

Process Chain support and DataSource data preview:

- `bw_get_process_chain` — reads a complete Process Chain definition including all steps, conditional dependencies, DECISION branch labels, and inline variant configuration; automatically fetches and embeds variant detail (ABAP program + selection variant, TRIGGER scheduling, ADSOACT target aDSO, ADSOREM cleanup settings, PLSWITCHL/P target, DECISION branching formulas) for each step in a single call — deterministic, no additional prompting needed; supports recursive sub-chain expansion by calling the tool again on any referenced chain name
- `bw_get_process_variant` — reads the configuration detail of any individual process step variant; generic across all 93 BW/4HANA process types; oDetail returned as structured JSON
- `bw_preview_datasource` — fetches a live data preview from any DataSource; resolves field names automatically from the DataSource structure and renders a formatted table; record count configurable (default 20)

---

## What's New — v0.6.0

BW Role Management — four new tools for reading and managing query-to-role assignments: `bw_get_roles` (full role hierarchy), `bw_get_role_queries` (all published queries per role), `bw_get_query_roles` (which roles a query is published in), `bw_set_query_roles` (publish or remove a query from a role or folder, including support for nested menu folders).

---

## What's New — v0.5.0

Live data querying:

- `bw_query_data` — executes a BEx Query or previews data from any InfoProvider (aDSO, CompositeProvider) via the BICS reporting endpoint; supports variable input, axis layout control (ROWS/COLUMNS/FREE), characteristic filters with include/exclude and range operators, hierarchy drill-down (expand/collapse nodes), pagination, and structure member selection; renders a formatted table with hierarchy indentation
- `bw_get_filter_values` — looks up valid characteristic values before setting filters or variables; supports wildcard search and optional InfoProvider scoping
- `bw_get_query` — now returns a compact human-readable summary by default; use `format="raw"` to get the previous full JSON output

---

## What's New — v0.4.0

DataSource and source system navigation:

- `bw_get_dataflow` — traces the complete structural data flow graph of any BW object in any direction (upwards / downwards / both); mirrors the Eclipse BWMT Transient Data Flow view
- `bw_list_source_systems` — lists all logical source systems (LSYS) registered in BW, filterable by type (ODP_SAP, ODP_CDS, ODP_BW, ODP, FILE, HANA_SDA, HANA_LOCAL)
- `bw_list_datasources` — recursively lists all DataSources under a source system with full APCO hierarchy path
- `bw_get_source_system` — reads full source system metadata: type, description, connection details (ODP context/destination, HANA remote source, schema)
- `bw_get_datasource` — reads complete DataSource structure: all fields with types, lengths, transfer flags, key flags, conversion exits, unit/currency references, and adapter configuration
- `bw_xref` — new `source_system` parameter for `object_type=RSDS`; the correct space-padded objectName is built automatically

---

## What's New — v0.3.0

CompositeProvider read support and BW repository navigation:

- `bw_get_composite_provider` — reads a CompositeProvider structure: view node type (Union/Join), source providers with mapping counts, all fields with dimension classification, join conditions, and temporal join details
- `bw_get_ckf` — reads a global Calculated Key Figure with recursively resolved human-readable formula and full dependency graph of referenced sub-components
- `bw_get_rkf` — reads a global Restricted Key Figure: base measure and all characteristic restriction groups
- `bw_get_structure` — reads a global Structure: all members with Formula/Selection breakdown, characteristic filters, and optional child members
- `bw_list_contents` — navigates the full BW repository tree (InfoAreas → type folders → objects → sub-folders), mirroring the Eclipse BWMT Project Explorer
