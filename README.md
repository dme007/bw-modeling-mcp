# bw-modeling-mcp

A Model Context Protocol (MCP) server that enables AI assistants like Claude to work directly inside SAP BW/4HANA systems — reading, creating and modifying BW modeling objects via the internal REST API used by Eclipse BWMT.

**This is not a simulation.** Every tool call connects to a live BW system — write operations produce real changes.

---

## 📖 Featured Blog Post

**Agentic AI meets SAP BW** — the full story behind this project: why I built it, what's inside, what happens when Claude walks through a complete BW data lineage on its own.

Read the blog (DE + EN): https://www.nextlytics.com/blog/agentic-ai-meets-sap-bw

![Agentic AI meets SAP BW](docs/blog-cover.png)

---

## 🆕 What's New — v0.8.0

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

> **Work in Progress** — bw-modeling-mcp already covers many typical BW development and analysis scenarios, but not everything yet. More is coming. The server has so far only been tested on our own demo systems — if you are running it against your own BW/4HANA system, feedback and bug reports are very welcome. Please use the [Issue templates](https://github.com/dnic-dev/bw-modeling-mcp/issues/new/choose) — you will be helping shape what gets built next.

---

## What it can do

### Search & Discovery
- Search BW objects by name or description (wildcards supported), filtered by type
- Where-used / dependency analysis (xref) for any BW object

### aDSO
- Read aDSO structure (fields, settings, version state)
- Create a new aDSO — from an aDSO template, from a DataSource (RSDS) template, or empty
- Add InfoObject-backed fields or pure (field-based) fields
- Remove fields
- Manage key fields
- Update field properties (aggregation, data type, length, etc.)
- Update aDSO settings (type preset, flags, description)
- Write-interface aDSO support (`pushMode`)

### InfoObject
- Read InfoObject definition
- Create Characteristic — all data types (CHAR, NUMC, DATS, TIMS, SNUMC), with or without master data and texts, with referenced InfoObject, with compounding parents
- Create Key Figure — all types (NUM, AMT, QTY, DAT, INT), all aggregations (SUM, MAX, MIN)
- Add and remove display and navigation attributes

### InfoArea
- Read InfoArea definition (name, label, parent area, status)
- Create a new InfoArea (immediately active, no activation step needed)
- Move any BW object to a different InfoArea

### InfoSource
- Read InfoSource structure (fields, key fields, label, InfoArea)
- Create InfoSource with full field definitions

### Transformation
- Read Transformation structure (all sources, all targets)
- Map source fields to target InfoObjects (StepDirect)
- Set formula rules (StepFormula)
- Set field routines — ABAP and AMDP (StepRoutine)
- Set start routines — ABAP and AMDP
- Set end routines — ABAP and AMDP
- Switch runtime between ABAP and AMDP

### DTP (Data Transfer Process)
- Read DTP structure and settings
- Create DTPs — including DataSource (RSDS) sources
- Run (execute) a DTP load — returns the run request id for monitoring
- Update DTP settings and description
- Switch extraction mode between Full and Delta
- Set value filters on fields
- Set routine filters (ABAP code)

### BW Query (Read)
- Read a BW Query — metadata, variables, filter, layout, measures, exceptions, and settings
- Variables: type, processing type (UserEntry, Authorization, CustomerExit), input behavior
- Filter: fixed values and variable references fully resolved, including mixed selections
- Layout: rows, columns, free characteristics with full member lists and nested members
- Calculated key figures: recursively resolved human-readable formulas
- Restricted key figures: selection conditions (key figure + characteristic restrictions)
- Inline local measures inside structures: both formulas and selections
- Exceptions with alert levels and thresholds, cell definitions for grid layout queries
- Active version with automatic fallback to inactive

### Live Data Querying
- Execute a BEx Query or preview data from any InfoProvider (aDSO, CompositeProvider) — returns a formatted result table
- Fill query variables, control axis layout (rows / columns / free), apply characteristic filters with include/exclude and range operators
- Drill into hierarchy nodes and structure members (expand / collapse by tuple index)
- Look up valid characteristic values before setting filters or variables — returns both internal and external key formats

### CompositeProvider (Read)
- Read CompositeProvider structure — view node type (Union/Join), source providers (inputs) with mapping count, all fields with dimension classification, join conditions, and temporal join details

### Global CP Components (Read)
- Read global Calculated Key Figure (CKF) — formula recursively resolved to a human-readable string, full dependency graph of all referenced sub-components
- Read global Restricted Key Figure (RKF) — base measure, all characteristic restriction groups with field and value details
- Read global Structure — all members with Formula/Selection breakdown, referenced components, characteristic filters, optional child members

### Repository Navigation
- Navigate the full BW repository tree — drill from InfoArea to type folder to object to sub-folder, mirroring the Eclipse BWMT Project Explorer; each entry returns a `children_path` for seamless drill-down

### Data Flow Navigation
- Traverse the complete structural data flow graph of any BW object — all connected sources and targets resolved recursively through Transformations, DTPs, InfoSources, aDSOs, DataSources, CompositeProviders, and InfoObjects; mirrors the Eclipse BWMT Transient Data Flow view

### DataSource Navigation
- List all source systems connected to the BW system (ODP_SAP, ODP_CDS, ODP_BW, ODP, FILE, HANA_SDA, HANA_LOCAL)
- Recursively list all DataSources in a source system with full APCO hierarchy path
- Read full source system metadata including connection details (ODP context/destination, HANA remote source and schema)
- Read complete DataSource structure: fields with types, lengths, transfer flags, adapter configuration

### BW Role Management
- Read the full role hierarchy (ROLE + FOLDER structure)
- List all queries published per role
- Check which roles a specific query is assigned to
- Publish a query into a role or a specific sub-folder
- Remove a query from a role or folder
- Move a query between roles (remove from old, add to new)

### Push API
- Get JSON push schema for a write-interface aDSO
- Push JSON record arrays directly into an aDSO

### Process Chain Navigation
- Read complete Process Chain definitions — all steps with type, variant, description, and last execution status
- Conditional flow semantics fully resolved: DECISION branch labels (including ABAP formula expressions), OR/AND join nodes, positive/negative/neutral edge conditions
- Automatic variant detail per step: ABAP program and selection variant, TRIGGER scheduling parameters, ADSOACT/ADSOREM aDSO targets and cleanup settings, PLSWITCHL/P target aDSO, DECISION branching formulas — all embedded inline in a single tool call
- Recursive sub-chain expansion: CHAIN-type steps reference other Process Chains — call `bw_get_process_chain` again on any referenced chain name to expand the full hierarchy
- Generic process variant reader: covers all 93 BW/4HANA process types including custom Z-types; unknown types return oDetail as raw JSON

### DataSource Data Preview
- Fetch a live data preview from any DataSource (RSDS) directly from the source system
- Field names resolved automatically from the DataSource structure; configurable record count (default 20)
- Rendered as a padded plain-text table with column alignment

### Request Monitor & Runtime
- List load requests for a target InfoProvider — status, last process status/action, record count, timestamp, user, TSN
- Full status analysis of a single load request — header, DTP information (start/finish/duration), process step chain, and message log in one call
- Activate loaded data (DSO request activation) — move a finished load from the inbound table into the active data table + change log
- Uses the BW/4HANA `/sap/bc/.../bw4` manage API (the same operations as the BW/4HANA Cockpit)

### General
- Search & Where-Used (xref)
- Activate BW objects (aDSO, InfoObject, Transformation, DTP, DataSource)
- Release locks without activating (discard changes)
- Delete BW objects
- Transport request assignment

---

## Combining with an ADT MCP Server

For tasks involving ABAP or SQLScript (AMDP) logic inside Transformations, **bw-modeling-mcp works best alongside an ADT MCP server** such as [vibing-steampunk](https://github.com/oisee/vibing-steampunk).

The BW MCP server handles the BW modeling structure — creating the Transformation, setting up routines, activating objects. The ADT MCP server handles reading and writing the actual ABAP class source code that backs the routine. Together, they cover the full development cycle from BW object creation to ABAP logic implementation.

---

## System Compatibility

| System | Support |
|---|---|
| SAP BW/4HANA (all versions) | ✅ Full support |
| SAP BW Bridge (SAP BTP ABAP stack) | ✅ Via cookie authentication (`BW_COOKIE_FILE`) |

<p><em><sub>SAP BW on HANA (7.5) is not supported. While individual tools may work, most HTTP communications cannot reliably pass through the server-side version negotiation in BW 7.5, causing most tools to fail with HTTP 406 errors.</sub></em></p>

---

## Requirements

- SAP BW/4HANA system with REST API access (`/sap/bw/modeling/`)
- Node.js 18 or later
- An MCP-compatible AI client (Claude Desktop, Claude Code, etc.)

---

## Installation

```bash
# Option 1: Install via npm (recommended)
npm install -g bw-modeling-mcp

# Option 2: Clone and build
git clone https://github.com/dnic-dev/bw-modeling-mcp.git
cd bw-modeling-mcp
npm install
npm run build
```

---

## Configuration

The server is configured via environment variables:

| Variable | Description | Required |
|---|---|---|
| `BW_URL` | BW system URL (e.g. `https://myhost:50001`) | yes |
| `BW_USER` | SAP user name | yes (or `BW_COOKIE_FILE`) |
| `BW_PASSWORD` | SAP password | yes (or `BW_COOKIE_FILE`) |
| `BW_CLIENT` | SAP client (e.g. `001`) | yes |
| `BW_LANGUAGE` | Language for object texts (e.g. `EN`, `DE`). Default: `DE` | no |
| `BW_COOKIE_FILE` | Path to a browser-exported cookie file for SAML-/OAuth-fronted systems (e.g. BW Bridge). Netscape or `name=value` format. When set, `BW_USER` / `BW_PASSWORD` are optional. | no |

**Cookie authentication (BW Bridge / SAP BTP):** For BW systems that sit behind a SAML or OAuth login (such as BW Bridge on the SAP BTP ABAP stack), Basic Auth is not available. Export the authenticated session cookies from your browser into a file and point `BW_COOKIE_FILE` at it. The login/session approach is analogous to [vibing-steampunk](https://github.com/oisee/vibing-steampunk). When the session expires, refresh the cookie file and restart the server.

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "bw-modeling-mcp": {
      "command": "node",
      "args": ["/path/to/bw-modeling-mcp/dist/index.js"],
      "env": {
        "BW_URL": "https://your-bw-host:50001",
        "BW_USER": "YOUR_USER",
        "BW_PASSWORD": "YOUR_PASSWORD",
        "BW_CLIENT": "001",
        "BW_LANGUAGE": "EN"
      }
    }
  }
}
```

### Claude Code

Add `.mcp.json` to your project root:

```json
{
  "mcpServers": {
    "bw-modeling-mcp": {
      "command": "node",
      "args": ["/path/to/bw-modeling-mcp/dist/index.js"],
      "env": {
        "BW_URL": "https://your-bw-host:50001",
        "BW_USER": "YOUR_USER",
        "BW_PASSWORD": "YOUR_PASSWORD",
        "BW_CLIENT": "001",
        "BW_LANGUAGE": "EN"
      }
    }
  }
}
```

---

## Tools Reference

### `bw_search`
Search BW objects by name or description. Supports wildcards (`*`). Optionally filter by object type (`ADSO`, `IOBJ`, `TRFN`, `DTPA`, etc.).

### `bw_xref`
Find all objects that reference a given BW object (where-used analysis). Use this to find Transformations and DTPs connected to an aDSO, or to find the process chain(s) a DTP belongs to (`object_type=DTPA`).

For DataSources (`object_type=RSDS`): pass `source_system` — the correctly space-padded objectName is built automatically.

### `bw_get_adso`
Read the full structure of an aDSO — fields, key fields, settings, version state.

### `bw_create_adso`
Create a new aDSO. Supports two modes: `from_template` (copies structure from an existing aDSO) or `empty`. Supports all aDSO type presets including write-interface (`pushMode`).

### `bw_update_adso`
Modify an existing aDSO. Actions:
- `add_field` — add an InfoObject-backed field
- `add_pure_field` — add a field-based (pure) field without an InfoObject
- `remove_field` — remove a field
- `manage_keys` — set or update key fields
- `update_field_properties` — change aggregation, data type, length, etc.
- `update_settings` — change aDSO type preset, flags, or description

### `bw_get_infoobject`
Read an InfoObject definition (Characteristic or Key Figure).

### `bw_create_infoobject`
Create a new InfoObject. Supports:
- **Characteristic (CHA):** all data types (CHAR, NUMC, DATS, TIMS, SNUMC), with or without master data and texts, with compound parent InfoObjects, with referenced InfoObject
- **Key Figure (KYF):** all types (NUM, AMT, QTY, DAT, INT), all aggregations (SUM, MAX, MIN)

Created as inactive — activate with `bw_activate`.

### `bw_update_infoobject`
Add or remove display (`DIS`) and navigation (`NAV`) attributes on an existing Characteristic.

### `bw_get_infoarea`
Read an InfoArea definition — name, label, parent area, object status.

### `bw_create_infoarea`
Create a new InfoArea. Immediately active after creation, no activation step needed.

### `bw_move_object`
Move any BW object (aDSO, InfoObject, InfoArea, etc.) to a different InfoArea.

### `bw_get_infosource`
Read an InfoSource (TRCS) structure — fields, key fields, label, InfoArea, version status.

### `bw_create_infosource`
Create a new InfoSource with full field definitions.

### `bw_update_infosource`
Update an existing InfoSource — fields and description.

### `bw_get_transformation`
Read a Transformation structure including all field mapping rules, routines, source, and target. Transformation names are UUID-like keys — use `bw_xref` on the target aDSO to find them.

### `bw_create_transformation`
Create a new Transformation. Supports all source types (aDSO, InfoSource, DataSource/RSDS) and all target types (aDSO). Can copy structure from an existing Transformation.

### `bw_update_transformation`
Modify field mappings in an existing Transformation:
- Map source field to target InfoObject (StepDirect)
- Set formula rule for a target field (StepFormula)

### `bw_set_transformation_routine`
Set a field routine, start routine, or end routine on a Transformation. Supports both ABAP and AMDP (SQLScript). The routine code is written in combination with an ADT MCP server.

### `bw_delete_transformation_routine`
Remove an existing routine from a Transformation field.

### `bw_set_transformation_runtime`
Switch the Transformation runtime between ABAP and AMDP.

### `bw_get_dtp`
Read the full definition of a single DTP — source, target, transformation reference, extraction settings (mode, package size), and all filter fields including value selections and routine code. DTP names are UUID-like keys — use `bw_xref` or `bw_get_dtps` to find them.

### `bw_get_dtps`
List all DTPs that depend on a given BW object or Transformation.

### `bw_create_dtp`
Create a new DTP on a Transformation. Source and target are derived from the Transformation automatically. For a DataSource source, set `source_type="RSDS"` and pass `source_system`.

### `bw_run_dtp`
Start (execute) a run of an existing, active DTP. Returns the new run request id (an RSPM TSN) that can be passed directly to `bw_get_request` for monitoring.

### `bw_update_dtp`
Update a DTP — description, value filters on fields, and extraction mode (`extraction_mode` = `full` / `delta`). Note: switching between Delta and Full has BW delta-init implications — a later delta load may require re-initialization.

### `bw_set_dtp_filter_routine`
Set an ABAP routine filter on a DTP field.

### `bw_get_push_schema`
Get the expected JSON schema for pushing data into a write-interface aDSO.

### `bw_push_data`
Push a JSON record array directly into a write-interface aDSO via the BW Push API (`/sap/bw4/v1/push/`).

### `bw_get_query` _(Read only)_
Read a BW Query definition — variables, filter logic (fixed values and variable references resolved), layout with full member lists, calculated key figures with recursively resolved formulas, restricted key figures with selection conditions, exceptions, and query settings. Output format: `text` (default, compact human-readable summary) or `raw` (full parsed JSON).

### `bw_query_data` _(Read only)_
Execute a BEx Query or preview data from an InfoProvider (aDSO, CompositeProvider) via the BICS reporting endpoint. Returns a formatted result table with hierarchy indentation.

Parameters: `comp_id` (query or provider name), `is_provider` (set `true` for direct aDSO/HCPR access), `state` (axis placement — ROWS/COLUMNS/FREE — and per-characteristic filters supporting EQ/BT/GT/LT/GE/LE, include/exclude, external key, internal GUID key, and hierarchy-node filters), `variables` (fill query variables; name and id must be copied verbatim from the GET response), `from_row`/`to_row` (pagination), `drill_operations` (expand or collapse hierarchy and structure nodes by 1-based tuple index: `drill_state=3` expands, `drill_state=2` collapses), `format` (`text` default — formatted table; `raw` — XML).

Always call `bw_get_query` or `bw_get_adso` first to discover the axis layout and characteristic IDs, and call `bw_get_filter_values` before setting any filter or variable value.

### `bw_get_filter_values` _(Read only)_
Look up valid values for a characteristic — required before setting any filter or variable. Returns `CHAVL_EXT` (use for state filters) and `CHAVL_INT` (use for variable inputs); formats differ for date-type characteristics. Supports wildcard search (`*` for all values, prefix match e.g. `2022*`). Optionally scope results to a specific InfoProvider.

### `bw_get_process_chain` _(Read only)_
Read a Process Chain (RSPC) definition — header metadata, scheduling and monitoring settings, all steps with type, variant, last execution status, conditional dependencies with DECISION branch labels, and automatically embedded variant configuration per step. Set `include_variant_details=false` for a fast structural overview. Output format: `text` (default) or `raw` (full JSON).

### `bw_get_process_variant` _(Read only)_
Read the detail configuration of a single Process Chain step variant. Generic across all process types — oDetail rendered as indented JSON. Use process_type and variant_name from `bw_get_process_chain` output.

### `bw_preview_datasource` _(Read only)_
Fetch a live data preview from a DataSource. Resolves field names automatically and renders a formatted table. Parameters: `datasource_name`, `source_system`, `records` (default 20).

### `bw_get_roles` _(Read only)_
Read the complete BW role hierarchy as displayed in the Eclipse BWMT "Publish to Role" dialog. Returns all ROLE and FOLDER nodes with technical names, descriptions, and nodeids. Optional `role_filter` parameter limits output to roles whose name starts with the given prefix (e.g. `"BW:"`).

### `bw_get_role_queries` _(Read only)_
List all BW Queries published in the role hierarchy, grouped by role and folder. Only `SAP_BW_QUERY` objects are returned — PFCG menu entries of other types (e.g. AFO workbooks added as transactions) are not included. Optional `role_name` to scope to a specific role.

### `bw_get_query_roles` _(Read only)_
Return all roles and folders where a specific BW Query is currently published. Returns a clear "not published" message if the query has no role assignments.

### `bw_set_query_roles`
Publish or remove a BW Query from a role or folder. Parameters: `query_name`, `action` (`"add"` or `"remove"`), `target_type` (`"role"` or `"folder"`), `target_name` (role name attribute for role-level, folder txt for folder-level), `parent_role_name` (required when `target_type="folder"`). For add operations, the full role subtree is fetched automatically from `bw_get_roles` — no manual lookup needed.

### `bw_get_composite_provider` _(Read only)_
Read a CompositeProvider (HCPR) — view node type (Union/Join), source providers with input mapping counts, all fields with dimension classification, join conditions, and temporal join details.

### `bw_get_ckf` _(Read only)_
Read a global Calculated Key Figure — formula recursively resolved to a human-readable string, metadata (package, InfoArea, author), and full dependency graph of all referenced sub-components.

### `bw_get_rkf` _(Read only)_
Read a global Restricted Key Figure — base measure, all characteristic restriction groups (field and value), and metadata.

### `bw_get_structure` _(Read only)_
Read a global Structure — all members with type (Formula/Selection), referenced components, characteristic filters, optional child members, and metadata.

### `bw_list_contents` _(Read only)_
Navigate the BW repository tree. Pass a path such as `""` (all InfoAreas), `"area/MYAREA"` (InfoArea contents), `"hcpr/CP_NAME"` (CP sub-folders), or `"adso/ADSO_NAME/trfn"` (Transformations on an aDSO). Each entry includes `children_path` to drill down further.

### `bw_list_source_systems` _(Read only)_
List all logical source systems (LSYS) registered in the BW DataSource structure. Optionally filter by type (`ODP_BW`, `ODP_SAP`, `ODP_CDS`, `ODP`, `FILE`). Each entry includes `children_path` — pass it directly to `bw_list_datasources` as `source_system`.

### `bw_list_datasources` _(Read only)_
List all DataSources available under a logical source system. Recursively traverses the full APCO hierarchy. Each DataSource entry includes name, description, status, and the full `apco_path` (ordered list of application component titles from root to the DataSource). Output format: `text` (default table) or `raw` (XML feed bodies).

### `bw_get_source_system` _(Read only)_
Read the metadata of a single logical source system — type, description, and connection details. For ODP systems: context, destination, validity flags. For HANA systems: remote source, database, schema, SDI adapter.

### `bw_get_datasource` _(Read only)_
Read the complete structure of a DataSource (RSDS): metadata (status, delta type, direct access, application component, package, timestamps), all fields with type, length, transfer flag, key flag, position, selection options, conversion exit, and unit/currency reference, plus active adapter configuration (ODP, HANA, File, CSV). Output format: `text` (default human-readable summary) or `raw` (XML from BW).

### `bw_get_dataflow` _(Read only)_
Read the complete structural data flow of a BW object — all connected sources and targets resolved recursively through Transformations, DTPs, InfoSources, aDSOs, DataSources, CompositeProviders, and InfoObjects. Mirrors the Eclipse BWMT Transient Data Flow view. Supports direction (`upwards` / `downwards` / `both`) and configurable depth. Note: routine-based lookups (ABAP/SQLScript) are not reflected — only structural BW dependencies.

### `bw_list_requests` _(Read only)_
List load requests for a target InfoProvider via the BW/4HANA manage API — status, last process status and last action, record count, timestamp, user, and TSN. The TSN feeds `bw_get_request`.

### `bw_get_request` _(Read only)_
Full status analysis of one load request in a single call — request header, DTP information (start/finish/duration), process step chain, and message log. Output format: `text` (default) or `raw` (parsed JSON of all four payloads).

### `bw_activate_request`
Activate loaded data (DSO request activation) — move a finished load from the inbound table into the active data table and change log. This is the runtime request activation (BW/4HANA manage API), distinct from the modeling-object activation done by `bw_activate`; it applies only to aDSOs that have an activation step and runs asynchronously.

### `bw_activate`
Activate one or more BW objects. Handles impact analysis and automatically deactivated DTPs. Supports: `adso`, `iobj`, `trfn`, `dtp`, `rsds` (DataSource).

### `bw_unlock`
Release a lock on a BW object without activating (discard changes).

### `bw_delete`
Delete a BW object. Works for aDSO, InfoObject, InfoArea, and other types.

---

## Example Prompts

> **Fun starter** — this one was actually run by a colleague :-)
```
Create a write-interface aDSO to store all match results of the Bundesliga 2024/2025 season.
Include all relevant fields: matchday, home team, away team, home goals, away goals, match date.
Suggest a technical name that fits the existing objects in InfoArea MCPBW.
Then load the aDSO with real data from the completed 2024/2025 season using the Push API.
```

### Modify — working in the BW system

**Setting up a new BW area for a CRM integration:**
```
We are setting up a new BW area for our CRM integration project.
Create the InfoArea "ZCRM" with description "CRM Integration" below InfoArea "ZSALES".
Inside it, create a field-based aDSO to store sales order data loaded from the OpenCRX REST API.
The aDSO should contain the following fields: order_id (key, CHAR 20), customer_id (CHAR 10),
order_date (DATS), amount (DEC 15,2), currency (CUKY 5), status (CHAR 4).
Name the aDSO starting with "Z".
```

**Building a full data flow from field-based to InfoObject-based:**
```
Create a second aDSO in InfoArea "ZCRM" — this time InfoObject-based, same business content
as ZCRM_ORDERS. Create all required InfoObjects for this aDSO. Decide independently on type
(Characteristic/Key Figure), master data, and texts based on the field semantics.
Then create a Transformation from ZCRM_ORDERS to the new aDSO and map all fields 1:1.
Activate the Transformation. Finally, create a DTP on the Transformation and activate it.
```

**Adding derived logic with an AMDP routine and DTP filter:** — In Combination with an ADT MCP Server
```
Create a new InfoObject to flag high-value orders above $10,000.
Choose an appropriate technical name and description.
Add the InfoObject to aDSO ZCRM_ORDERS.
Create an AMDP field routine for this field in the Transformation and derive the logic
in SQLScript: set the flag if the calculated order total (quantity × unit price) exceeds 10,000.
Adjust the DTP filter: load only orders with status "CONFIRMED" (value filter)
and only orders from the current calendar year (routine filter).
```

---

### Read-Only — understanding existing models

**Full data lineage analysis:**
```
Analyze the complete data lineage of aDSO ZSLS_ORDSUM down to all connected DataSources
from source system OCRXCLNT100.
Include all intermediate objects: aDSOs, Transformations, InfoSources, and DataSources.
Also trace any objects referenced inside transformation routines (e.g. via AMDP or ABAP logic)
and follow their lineage as well.
Present the result as a structured table with columns:
Level (1 = closest to ZSLS_ORDSUM), Object Type, Technical Name, Description, Source System.
Use full object type names — no abbreviations.
```

---

## How it works

The server connects to the SAP BW Modeling REST API (`/sap/bw/modeling/`) — the same internal API used by Eclipse BWMT. All write operations follow the BW locking protocol:

1. **Lock** — acquires an exclusive lock and returns a `lockHandle`
2. **Read** — fetches the current complete XML of the object
3. **Modify** — applies changes to the XML
4. **PUT** — sends the full modified XML back (never partial updates)
5. **Activate** — promotes the inactive version to active
6. **Unlock** — releases the lock

Session cookies and CSRF tokens are managed automatically.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full technical architecture and complete API reference.

---

## CLI (`bw-cli`)

A standalone command-line interface ships alongside the MCP server. It calls the exact same tool implementations as the MCP server, but lets you trigger them directly from a shell — useful for debugging authentication issues (403s, CSRF, session problems), validating credentials against a new system, or scripting one-off operations without an MCP client.

### Installation

After `npm run build` (or `npm install -g bw-modeling-mcp`), the `bw-cli` binary is available alongside `bw-modeling-mcp`.

### Quick start

```bash
# Test the connection — fetches CSRF token + loads media types
bw-cli ping

# Run any MCP tool as a subcommand
bw-cli bw_get_adso --adso_name ZADSO_DEMO
bw-cli bw_search --search_term 'Z*' --object_type ADSO

# Verbose HTTP logging on stderr — one line per request
bw-cli bw_get_adso --adso_name ZADSO_DEMO -v

# Full request + response headers and bodies
bw-cli bw_get_adso --adso_name ZADSO_DEMO -vv

# List all available tool names
bw-cli list-tools
```

### Configuration

Sources, applied in this priority (most specific wins): **CLI flags > shell env > `.env` file > JSON config file**.

| Flag | Env var | Config key | Required |
|---|---|---|---|
| `--url <url>` | `BW_URL` | `url` | yes |
| `--user <user>` | `BW_USER` | `user` | yes |
| `--password <pw>` | `BW_PASSWORD` | `password` | yes |
| `--client <n>` | `BW_CLIENT` | `client` | no (default `001`) |
| `--language <code>` | `BW_LANGUAGE` | `language` | no |
| `--config <path>` | — | — | no |

### `.env` file support

If a `.env` (or `.env.local`) file exists in the current directory, the `BW_*` variables defined there are loaded into the environment automatically — no `export` needed. Existing shell variables are never overwritten by the file.

```env
# .env
BW_URL=https://your-bw-host:50001
BW_USER=YOUR_USER
BW_PASSWORD="password with spaces"
BW_CLIENT=001
BW_LANGUAGE=EN
```

Override the auto-discovered path with `--env-file <path>`. The same `.env` file is also picked up by the MCP server (`bw-modeling-mcp`) when started directly without an MCP client.

> ⚠️ Add `.env` to `.gitignore` — it's already in this repo's `.gitignore` by default.

### Config file auto-discovery

If `--config` is omitted, the first existing file from this list is loaded automatically:

1. `./.bwc.json` (project-local, recommended — add to `.gitignore`)
2. `./bw-cli.json` (project-local, longer name)
3. `~/.config/bw-cli.json`
4. `~/.bwc.json`
5. `~/.bw-cli.json`

Example `./.bwc.json`:

```json
{
  "url": "https://your-bw-host:50001",
  "user": "YOUR_USER",
  "password": "YOUR_PASSWORD",
  "client": "001",
  "language": "EN"
}
```

> ⚠️ **Never commit a config file with real credentials.** Add `.bwc.json` and `bw-cli.json` to your `.gitignore`.

### Passing tool arguments

For flat arguments, use `--key value` (strings, numbers, and `true`/`false` are parsed automatically):

```bash
bw-cli bw_get_adso --adso_name ZADSO --format raw
bw-cli bw_preview_datasource --datasource_name ZDS_X --source_system LSYS_X --records 50
```

For tools with nested arguments (e.g. `bw_query_data`, `bw_update_adso`), pass the full args object as JSON:

```bash
bw-cli bw_query_data --args-json '{
  "comp_id": "ADSO_X",
  "is_provider": true,
  "state": { "infoObjects": [{ "name": "0CALMONTH", "id": "...", "axis": "ROWS" }] }
}' -v
```

### Debugging 403 / auth errors

The compact verbose mode (`-v`) is purpose-built for this:

- One line per HTTP request: `→ METHOD URL STATUS (duration)`.
- On any `4xx`/`5xx` the response body is automatically printed — that's where SAP puts the actual error reason (CSRF validation failed, missing authorization, expired session, …).
- Use `-vv` if you also need to see the request headers (e.g. to confirm which CSRF token / session cookie was actually sent).

```bash
bw-cli bw_get_adso --adso_name ZADSO -v
# → GET https://host:50001/sap/bw/modeling/repo/is/systeminfo 200 (143ms)
# → GET https://host:50001/sap/bw/modeling/discovery 200 (89ms)
# → GET https://host:50001/sap/bw/modeling/adso/zadso/m 403 (45ms)
# <error>...full SAP error message here...</error>
```

---

## Roadmap

- **CompositeProvider** — Read: `bw_get_composite_provider` ✅, global components (`bw_get_ckf` / `bw_get_rkf` / `bw_get_structure`) ✅ — Create and modify: planned
- **BW Queries** — Read: `bw_get_query` ✅ — Create and modify: planned
- **Process Chains** — build and manage Process Chains
- **Open ODS View** — create Open ODS Views
- **BW/4HANA Cockpit functions** — runtime request monitor and data activation ✅ (`bw_run_dtp`, `bw_list_requests`, `bw_get_request`, `bw_activate_request`) — further runtime operations planned
- **Further BW/4HANA objects** — additional modeling objects

---

## Contributing

Issues and feature requests are welcome — please use the [Issue templates](https://github.com/dnic-dev/bw-modeling-mcp/issues/new/choose).

If you have access to a BW/4HANA system and want to help expand coverage, I am happy to hear from you. The best way to contribute is to try it out and report what works, what doesn't, and what's missing.

---

## License

MIT
