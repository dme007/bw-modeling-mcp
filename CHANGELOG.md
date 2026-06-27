# Changelog

## [0.9.1] — 2026-06-27

### Fixed

- `bw_search` / `bw_get_process_chain` — corrected the TLOGO codes in the tool and `object_type` descriptions: InfoSource is `TRCS` (not `ISFS`) and Process Chain is `RSPC` (not `PRCH`); the wrong codes were passed straight to the search endpoint and caused an HTTP 500. Verified against the `RSTLOGO` domain (`DD07T`) and live `bw_search` calls

---

## [0.9.0] — 2026-06-27

### Added

- `bw_get_aggregation_level` — reads an Aggregation Level (ALVL): the planning-enabled view on top of an InfoProvider, with the complete element list — characteristics including type, length, conversion routine, base InfoObject, compounding, and dimension group; key figures including aggregation behavior, semantics (AMO/QUA/NUM), and unit/currency reference (unit characteristic, fixed unit, or fixed currency)
- `bw_get_planning_function` — reads a Planning Function (PLSE): function type, aggregation level, documentation, characteristic usage roles, conditions, and the full parameter tree with nested structure and values; for FORMULA functions the FOX code surfaces as the value of the FLINE parameter
- `bw_get_planning_sequence` — reads a Planning Sequence (PLSQ): ordered step list with type code, aggregation level, planning function, and filter name per step
- `bw_get_planning_properties` — reads the Planning Properties (PLCR) of a plan-enabled InfoProvider (real-time aDSO or CompositeProvider): key-date mode, maximum characteristic combinations, and save strategy (planning sequence and delta-read flag); data slices not yet included
- `bw_create_process_chain` — creates a Process Chain (RSPC) via the BW/4HANA Cockpit REST API; builds the chain model from a step and edge list, creates a trigger-only skeleton, then updates it with the full model in one operation; optionally activates after creation; supported step types: `DTP_LOAD`, `ADSOACT`, `CHAIN` (local sub-chain start, verified), and collectors `AND` / `OR` / `XOR`; inline-configured process types (ABAP programs, OS commands, attribute change runs, etc.) are not yet supported
- `bw_update_process_chain` — replaces the step model (nodes and edges) of an existing Process Chain; preserves the existing trigger node and scheduling configuration; optionally overrides description and InfoArea
- `bw_activate_process_chain` — activates an existing Process Chain; returns the top-level activation message, severity, and full log
- `bw_list_process_chain_runs` — lists execution runs of one or all process chains from the monitoring log; filterable by chain name, start date range, and status; ordered by start time descending; default limit 20
- `bw_get_process_chain_run_detail` — reads step-level and message-level detail of a single chain run, including error messages; chain_id and log_id come from `bw_list_process_chain_runs` or `bw_list_process_chain_last_status`
- `bw_list_process_chain_last_status` — last execution status and scheduling state for every chain in the system; one row per chain; includes log ID of the most recent run
- `bw_get_open_hub` — reads an Open Hub Destination (DEST): destination type, source object, DB table, InfoArea, package, status, the complete output field list with type/length, InfoObject binding, conversion routine, compounding, and key flag; file properties for FILE-type destinations
- `bw_list_remote_entities` — lists the remote entities (HANA views / virtual tables) a source system exposes as a DataSource basis; read-only discovery matching the Eclipse DataSource proposal page; the returned `technical_name` is exactly what binds into `bw_create_datasource`
- `bw_create_datasource` — creates a DataSource (RSDS) on top of a remote entity from the server's field proposal, leaving it inactive; the server derives the full segment and field structure from the remote entity; local objects only (`$TMP` in v1); activation is a separate step via `bw_activate` (object_type `rsds`)
- `bw_set_transformation_routine_fields` — edits the list of target fields a global END routine writes ("Felder setzen" in SAP GUI); accepts an explicit field list (`fields`) or an exclusion list (`exclude_fields`); requires an existing END routine; does not activate; returns lock_handle for `bw_activate`

### Improved

- `bw_activate` — now supports `hcpr` (CompositeProvider) as an activatable object type
- `bw_create_dtp` — new `IOBJ` target type for InfoObject attributes; the BW XML `type` attribute is correctly set to `IOBJA` (InfoObject Attribute DTP target role)
- `bw_update_transformation` — supports field-based direct mapping for targets without an underlying InfoObject; previously always attempted an InfoObject GET, which fails for plain aDSO/InfoSource field targets

### Notes

- `bw_get_planning_properties` reads `generalSettings` only; data slices (PLDS) are not yet included
- Process chain authoring uses the BW/4HANA Cockpit REST API (`/sap/bc/http/sap/bw4/v1/modeling/processchains`) — the same API consumed internally by the BW/4HANA Cockpit

---

## [0.8.0] — 2026-06-09

### Added

- `bw_run_dtp` — starts (executes) a DTP load via `POST /sap/bw/modeling/dtpa/executerun`; returns the new run request id from the `Location` header (an RSPM TSN usable directly with `bw_get_request`); runs in a fresh session to avoid stale-buffer and concurrency issues
- `bw_list_requests` — lists load requests for a target InfoProvider via the BW/4HANA `/sap/bc/http/sap/bw4/v1/manage/requests` API; shows status, last process status/action, record count, timestamp, user, and TSN
- `bw_get_request` — full status analysis of one load request in a single call: header, DTP information (start/finish/duration), process step chain, and message log; `format="raw"` returns the parsed JSON of all four payloads
- `bw_activate_request` — activates loaded data (DSO request activation): moves a finished load from the inbound table into the active data table + change log via `POST .../manage/requests/{tsn}/{storage}/activate`; runtime activation distinct from `bw_activate`; asynchronous
- Cookie-based authentication for SAML- or OAuth-fronted BW systems (e.g. BW Bridge on the SAP BTP ABAP stack): set `BW_COOKIE_FILE` to a browser-exported cookie file (Netscape or `name=value` format); `BW_USER` / `BW_PASSWORD` become optional; login and session handling analogous to vibing-steampunk
- `bw_create_adso` — new `template_type` (`ADSO` default / `RSDS`) and `source_system` parameters: propose aDSO fields from a DataSource, not only from another aDSO
- `bw_create_dtp` — new `source_system` parameter: use a DataSource as the DTP source (`source_type="RSDS"`)
- `bw_update_dtp` — new `extraction_mode` parameter (`full` / `delta`) to switch an existing DTP between Full (`extractionMode="F"`, `deltaSettingStatus="0"`) and Delta (`extractionMode="D"`, `deltaSettingStatus="2"`); switching modes has BW delta-init implications (a later delta load may require re-initialization)
- `bw_activate` — new object type `rsds` (with `source_system`) to activate a DataSource

### Improved

- `bw_get_request` / `bw_list_requests` — surface the last process status and last action alongside the request status, so a finished green load is no longer reported as "in process"
- Media-type handling is now fully discovery-driven: the discovery parser reads every `<app:accept>` per collection (previously only the first, so workspaces listing a `+json` variant first fell back to hardcoded media types) and selects the highest-versioned `+xml` type; the query read path leads with the discovered media type

### Fixed

- Query reads negotiate the backend content-type version correctly instead of failing with HTTP 415 when the backend returns a version outside the previously hardcoded Accept range (#11)
- DTP activation no longer fails with a false "transformation inactive" error — the pre-activation priming GET and the activation POST now share one fresh session
- Adding fields to staging / inbound aDSOs (which have no key elements) no longer produces an invalid element position that was rejected on activation
- Date (DATS) constants in transformation rules are written in the external date format so they survive activation
- Transformation rule editing selects the field's own rule (not the global start/end routine rule) on transformations that have a start/end routine

### Notes

- The runtime tools (`bw_run_dtp`, `bw_list_requests`, `bw_get_request`, `bw_activate_request`) use the BW/4HANA `/sap/bc/http/sap/bw4/v1/manage` API — the same API the BW/4HANA Cockpit uses — rather than the `/sap/bw/modeling` tool API
- `bw_activate_request` only applies to aDSOs that have an activation step (not inbound-only staging aDSOs)

---

## [0.7.0] — 2026-05-21

### Added

- `bw_get_process_chain` — reads a Process Chain (RSPC) definition via the BW/4HANA-specific endpoint (`/sap/bw/modeling/rspc/{name}/m`, Accept: `application/vnd.sap.bw4.modeling.processchain-v1_0_0+json`); returns header metadata (description, InfoArea, status, version), scheduling attributes (job priority, owner, server, streaming mode), monitoring settings (auto-monitored, error notification, keep-alive, auto-reset), all steps (nodes) with process type, variant, description, last execution status, DECISION branch labels with socket resolution, OR join annotations, and sub-chain references; edges with full conditional flow semantics (positive/negative/neutral, DECISION branch names resolved from socket descriptions); inline variant section; by default (`include_variant_details=true`) automatically fetches and embeds variant configuration for each step via internal calls to `/sap/bw4/v1/modeling/processtypes/{type}/variants/{name}/m` — deterministic, not prompt-driven; types with no variant schema (DTP_LOAD, CHAIN, OR, AND, EXOR, DTP_ADSO) are skipped; set `include_variant_details=false` for structural overview without variant detail; `format="raw"` returns full parsed JSON; use `bw_search` with `object_type=RSPC` to find chain names
- `bw_get_process_variant` — reads the detail configuration of a single Process Chain step variant from `/sap/bw4/v1/modeling/processtypes/{type}/variants/{name}/m`; generic across all 93 BW/4HANA process types; `oDetail` returned as indented JSON regardless of type — covers ABAP (program + selection variant), ADSOACT (aDSO + NOCONDENSE), ADSOREM (cleanup: days/requests), PLSWITCHL/PLSWITCHP (target aDSO), TRIGGER (full scheduling payload), DECISION (branch formula expressions), and any unknown type; `format="raw"` returns full parsed JSON; process_type and variant_name come from `bw_get_process_chain` output
- `bw_preview_datasource` — fetches a live data preview from a DataSource (RSDS) via the internal `rsdsint/dataprev` endpoint (`POST /sap/bw/modeling/rsdsint/dataprev/{source_system}/{datasource}?records={n}&external=true`); field names resolved automatically from a prior GET on the DataSource structure; renders a padded plain-text table with proper column alignment; `records` parameter configurable (default 20); handles field/column count mismatch with fallback to `COL_N` headers and warning

### Notes

- Process chain support uses the BW/4HANA-specific `/sap/bw4/` API namespace — the same API consumed internally by the BW/4HANA Cockpit (Fiori); `Accept: */*` is used to negotiate the correct media type automatically
- `bw_get_process_chain` with recursive sub-chain expansion: call the tool again on any CHAIN-type step's variant name to drill into the sub-chain

---

## [0.6.0] — 2026-05-10

### Added

- `bw_get_roles` _(Read only)_ — reads the complete BW role hierarchy as shown in the Eclipse BWMT "Publish to Role" dialog; returns ROLE and FOLDER nodes with technical names, descriptions, and nodeids; optional `role_filter` parameter limits output to roles whose name starts with the given prefix (e.g. `"BW:"`); endpoint: `GET /sap/bw/modeling/comp/roles?level=10&requestchk=true&readleaves=false`
- `bw_get_role_queries` _(Read only)_ — lists all BW Queries published in the role hierarchy, grouped by role and folder; only `SAP_BW_QUERY` objects are returned — PFCG menu entries of other types (e.g. AFO workbooks added as transactions) are not included; uses `readleaves=true` on the same endpoint to retrieve `<leaf>` elements
- `bw_get_query_roles` _(Read only)_ — returns all roles and folders where a specific BW Query is currently published; uses the `ancof` (ancestor-of) parameter: `GET /sap/bw/modeling/comp/roles?type=SAP_BW_QUERY&ancof=<QUERYNAME>`
- `bw_set_query_roles` — publishes or removes a BW Query from a role or folder; supports `action="add"` and `action="remove"`, `target_type="role"` or `target_type="folder"`; for role-level add operations the full role subtree (folders + nodeids) is fetched from `bw_get_roles` and sent as `state="unchanged"` children in the PUT body; uses `PUT /sap/bw/modeling/comp/roles?type=SAP_BW_QUERY&ancof=<QUERYNAME>`
- `BwClient.rawPut()` — new HTTP PUT helper on the shared BW client; sends a raw request body with caller-controlled headers using a fresh axios instance and the current session cookie; used by `bw_set_query_roles`

---

## [0.5.0] — 2026-05-03

### Added

- `bw_query_data` _(Read only)_ — executes a BEx Query or previews data from an InfoProvider (aDSO, CompositeProvider) via the BICS reporting endpoint (`/sap/bw/modeling/comp/reporting`); parameters: `comp_id`, `is_provider` (adds `!` prefix for direct provider access), `state` (axis layout — ROWS/COLUMNS/FREE — plus per-characteristic filters supporting EQ/BT/GT/LT/GE/LE operators, include/exclude, external key, internal GUID key with `presentationMode="INT"`, and hierarchy-node filters via `nodeId=1`), `variables` (fills query variables; name and id must be copied verbatim from the GET response as they are session-specific and may contain trailing spaces), `from_row`/`to_row` (pagination), `drill_operations` (expand or collapse hierarchy and structure nodes by 1-based tuple index: `drill_state=3` expands, `drill_state=2` collapses), `format` (`text` default — formatted table with hierarchy indentation; `raw` — XML); all reporting calls use `X-sap-adt-sessiontype: stateless`; CSRF retry: on HTTP 403 the cached token is cleared and the request is retried once automatically
- `bw_get_filter_values` _(Read only)_ — looks up valid characteristic values before setting filters or variables; returns both `CHAVL_EXT` (use for state filters, `presentationMode="EXT"`) and `CHAVL_INT` (use for variable inputs); supports wildcard search (`*` for all, prefix match e.g. `2022*`); parameters: `characteristic_name`, `search_string`, `info_provider` (optional, scopes values to a specific provider), `max_rows` (default 201)

### Improved

- `bw_get_query` — added `format` parameter: `text` (new default) renders a compact human-readable summary covering settings, variables, filter, layout (rows/columns/free characteristics), CKFs, RKFs, exceptions, and cell definitions; `raw` returns the full parsed JSON (previous behaviour)
- `BwClient` — added `rawGet()` helper (shared session GET with caller-controlled headers, used by all reporting calls); CSRF token TTL of 4 minutes so that `ensureCsrf()` proactively re-fetches the token before SAP's ~5-minute session idle timeout expires (prevents "CSRF token has expired" failures in environments with slow tool-call approval); `clearCsrfToken()` public method exposed for use by retry logic

---

## [0.4.0] — 2026-04-26

### Added

- `bw_get_dataflow` _(Read only)_ — reads the complete structural data flow of any BW object (ADSO, RSDS, HCPR, TRFN, DTPA, IOBJ, TRCS, LSYS) using the same transient dataflow graph that Eclipse BWMT renders; supports direction (upwards / downwards / both), configurable depth levels, and format "text" | "raw"; text output uses tree rendering for ≤ 30 nodes and flat table for larger graphs
- `bw_list_source_systems` — lists all logical source systems (LSYS) registered in BW, optionally filtered by type (ODP_BW, ODP_SAP, ODP_CDS, ODP, FILE); returns name, description, type, status, and `children_path`
- `bw_list_datasources` — recursively traverses the full APCO hierarchy under a source system and lists all DataSources with name, description, status, and APCO path; format: `text` (default table) or `raw` (XML feed bodies)
- `bw_get_source_system` — reads full metadata of a single LSYS including type, description, connection details (ODP context/destination, HANA remote source/schema/SDI adapter)
- `bw_get_datasource` — reads complete DataSource structure: all fields with type, length, precision/scale, transfer flag, key flag, position, selection options, conversion exit, unit/currency reference, and active adapter config; format: `text` (default) or `raw` (XML)

### Improved

- `bw_xref` — new optional `source_system` parameter; required when `object_type=RSDS`; correct space-padded 40-character objectName (datasource padded to 30 + source system) is built automatically; explicit error thrown if omitted for RSDS
- `bw_get_transformation` — `raw` boolean replaced by `format: "text" | "raw"` parameter; `format="raw"` returns clean XML without wrapper header lines
- `bw_get_datasource`, `bw_list_datasources`, `bw_get_transformation` — unified `format: "text" | "raw"` parameter pattern across all three tools
- `bw_xref` tool description — documents that `object_type=DTPA` returns the process chain(s) a DTP belongs to, preferred over `bw_get_dtp` when only the process chain is needed
- `bw_get_dtp` tool description — documents that `bw_xref` with `object_type=DTPA` is the faster alternative when only process chain membership is needed

---

## [0.3.0] — 2026-04-24

### Added

- `bw_get_composite_provider` _(Read only)_ — reads a CompositeProvider (HCPR) structure: view node type (Union/Join), source providers with input mapping counts, all fields with dimension classification, join conditions, and temporal join details (extended from v0.2.0: field-level detail and join conditions fully parsed)
- `bw_get_ckf` _(Read only)_ — reads a global Calculated Key Figure with recursively resolved human-readable formula and full dependency graph of all referenced CKF/RKF sub-components
- `bw_get_rkf` _(Read only)_ — reads a global Restricted Key Figure: base measure resolved by name, all characteristic restriction groups with field and value details, and metadata
- `bw_get_structure` _(Read only)_ — reads a global Structure: all members with Formula/Selection breakdown, referenced components, characteristic filters, optional child members, and metadata
- `bw_list_contents` _(Read only)_ — navigates the full BW repository tree (InfoArea → type folder → object → sub-folder), mirroring the Eclipse BWMT Project Explorer; each entry includes `children_path` for seamless drill-down

---

## [0.2.0] — 2026-04-19

### Added

- `bw_get_query` — new read-only tool for BW Queries
  - Reads active version (`/A`) with automatic fallback to inactive (`/M`)
  - Parses all subComponents: Variables, Calculated Key Figures (CKFs), Restricted Key Figures (RKFs)
  - CKF formulas recursively resolved to human-readable strings: InfoObject names, cross-references between CKFs/RKFs, variable references, `IF` / `NOERR` / `NODIM` operators
  - RKF selection conditions fully parsed: key figure restrictions, characteristic restrictions, component references
  - Full layout parsing: columns, rows, free characteristics — both simple Dimensions and CustomDimensions (reusable structures)
  - CustomDimension members fully parsed including nested `childMembers` — inline RKFs with selection conditions and inline formulas with local member name resolution
  - Filter area: fixed values, variable references, mixed selections (variable + fixed value on same InfoObject)
  - Exceptions with alert levels, thresholds, cell coordinates, and evaluation flags
  - Grid cells and help cells fully parsed (cross-table layout queries)
  - Query-level settings: zero suppression, planning mode, result position, RFC/OData/easyQuery flags, sign presentation

---

## [0.1.0] — 2026-04-17

### Added

- Initial public release as pre-release (v0.1.0)
- aDSO: create, update (fields, settings, keys, field properties), delete — including write-interface (`pushMode`)
- InfoObject: create CHA + KYF, update attributes (DIS/NAV), delete
- InfoArea: create, move objects
- InfoSource (TRCS): create with/without template, update fields, delete
- Transformation: create (all source/target types), update (direct mapping, formula, field routines ABAP+AMDP, start/end routines), activate
- DTP: create, update (description + value filter), set filter routine
- Push API: `bw_push_data`, `bw_get_push_schema`
- General: search (`bw_search`), activate (`bw_activate`), where-used/xref (`bw_xref`), release locks (`bw_unlock`), delete (`bw_delete`)
