# Agent API — request & response schemas

Supporting reference for the `sitecoreai-agent` skill, regenerated from the OpenAPI spec named in `SKILL.md` frontmatter (`metadata.source_spec`). Moved out of `SKILL.md` on 2026-09-16 so the entry file stays under the spec's 5,000-token guidance; loaded on demand.

## Request & response schemas

Field names below are from `components.schemas`. **Required** fields are marked; everything else is optional. Large nested trees are summarized — see the OpenAPI bundle for full detail.

### Create page — `POST /pages/create` → `CreatePageRequest`
- `templateId` (uuid, **required**), `name` (string, **required**), `parentId` (uuid, **required**)
- `language` (default `en`), `fields` (array of `{name,value}` objects or null)
- Response `CreatePageResponse`: `{ itemId (uuid), name }`.

### Create content item — `POST /content/create` → `CreateContentItemRequest`
- `templateId` (uuid, **required**), `name` (string, **required**), `parentId` (uuid, **required**)
- `language` (default `en`), `fields` (key→value map or null)
- Response `CreateContentItemResponse`: `{ itemId, name, path, templateId, version }`.

### Add component to page — `POST /pages/{pageId}/components` → `AddComponentRequest`
- `componentRenderingId` (uuid, **required**), `placeholderPath` (string, **required**), `componentItemName` (string, **required**)
- `language` (default `en`), `fields` (map or null), `insertBeforeComponentId` / `insertAfterComponentId` (uuid or null)
- Response `AddComponentResponse`: `{ componentId, pageId, placeholderId, datasourceId }`.

### Create component datasource — `POST /components/{componentId}/datasources` → `CreateComponentDatasourceRequest`
- `siteName` (string, **required**), `dataFields` (key→value map, **required**)
- `children` (array of objects or null), `language` (default `en`)
- Response `CreateComponentDatasourceResponse`: `{ datasourceId, datasourceLocation }`.

### Set component datasource — `POST /pages/{pageId}/components/{componentId}/datasource` → `SetComponentDatasourceRequest`
- `datasourceId` (uuid, **required**), `language` (default `en`)
- Response `SetComponentDatasourceResponse`: `{ success, message, componentId, pageId, datasourceId }`.

### Update content — `PUT /content/{itemId}` → `UpdateContentRequest`
- `fields` (map or null), `language` (default `en`), `createNewVersion` (bool, default false), `siteName` (string or null)
- Response `UpdateContentResponse`: `{ itemId, name, path, updatedFields }`.

### Update asset — `PUT /assets/{assetId}` → `UpdateAssetRequest`
- `fields` (map, **required**), `language` (string, **required**), `name` (string or null), `altText` (string or null)

### Upload asset — `POST /assets/upload` → `Body_assets-upload_asset` (multipart)
- `file` (binary, **required**), `upload_request` (JSON string, **required**) carrying `{ name, itemPath, language, extension, siteName }`.

### Create experiment — `POST /experiments/flows` → `CreateExperimentRequest`
- `site_id` (**required**), `page_id` (**required**), `component_id` (**required**), `name` (**required**), `goal_type` (**required**, `GoalType` enum), `variants` (**required**, array of `Variant`)
- `language` (default `en`), `targeted_pages` (string array)
- `GoalType` enum: `pageViewGoal` | `bouncesGoal` | `exitsGoal`. Variant traffic splits must sum to 100 with exactly one control.
- Response `ExperimentFlowResponse`.

### Update experiment — `PUT /experiments/{flowId}` → `UpdateExperimentRequest`
- All optional: `name`, `archived` (default false), `goal_type`, `targeted_pages`, `variants`.

### Create personalization variant (v2) — `POST /api/v2/personalization/{pageId}/versions` → `CreatePersonalizationRequestV2`
- `name` (**required**), `variant_name` (**required**), `audience_name` (**required**), `condition_groups` (**required**, array of `ConditionGroupInput`)
- `language` (default `en`)
- Response `ExperienceFlowResponseV2`.
- *(v1 `CreatePersonalizationRequestV1` differs: a single `condition_template_id` + flat `condition_params` map instead of `condition_groups`. v1 is deprecated.)*

### Update personalization variant — `PUT /personalization/{pageId}/versions/{variantId}` → `UpdatePersonalizationRequest`
- `variant_name` (**required**), `audience_name` (**required**), `language` (default `en`), plus targeting rules / condition groups.

### Set up flow variant — `POST /flows/{flowId}/variants/{variantId}` → `SetupVariantRequest`
- `page_id` (uuid, **required**), `component_id` (**required**), `variant_strategy` (**required**, `VariantStrategy`)
- `language` (default `en`), `page_version` (int or null), `swapped_component` (`SwappedComponentModel`, required only when strategy is `SWAP`)
- `VariantStrategy` enum: `HIDE` | `SWAP` | `COPY`.

### Hide component on default variant — `POST /personalization/{pageId}/components/{componentId}/hide` → `HideComponentRequest`
- All optional: `language` (string or null), `page_version` (int or null = latest).
- Response `HideComponentResponse`: `{ pageId, componentId, language }` (201).

### Reset component variant — `POST /flows/{flowId}/variants/reset` → `ResetComponentRequest`
- `page_id` (**required**), `component_id` (**required**), `variant_id` (string or null), `language`, `page_version` (int or null).
- `variant_id` set → that variant is reset; omitted → (personalization only) the default-variant component is reset.
- Response `ResetComponentResponse`: `{ pageId, componentId, language }` (201).

### Generate brief — `POST /brief/generate` → `GenerateBriefRequest`
- `briefTypeId` (**required**), `brandId` (**required**), `prompt` (**required**)
- Response `GenerateBriefResponse`: a dynamic map of field-name → `BriefFieldValue` (`{ label, type, value }`). Does not persist — feed it into Create a brief to save.

### Create brief — `POST /brief` → `CreateBriefRequestModel`
- `name` (**required**), `locale` (**required**, pattern `^[a-z]{2}-[a-z]{2}$`, e.g. `en-us`), `briefTypeId` (**required**)
- `fields` (map of name → typed field value, discriminated by `type`: `SimpleText` | `RichText` | `DateTime` | `Budget` | `Boolean` | `Timeline`)

### Update brief — `PUT /brief/{brief_id}` → `UpdateBriefRequestModel`
- All optional: `name`, `fields` (same discriminated-union field-value map). Partial update — omitted fields are untouched.

### Common GET response shapes
- **Sites**: `ListSitesResponse` (list) / `SiteInformationResponse` (detail) / `SiteIdFromItemResponse`.
- **Pages**: `GetPageResponse`, `GetPageComponentsResponse`, `PageSearchItemModel[]`, `PageHtmlResponse`, `GetPagePreviewUrlResponse`, `PageTemplateResponse`, `ComponentShortInfo[]` (allowed components).
- **Content**: `ContentItemResponse` (fields, language, workflow), `InsertOptionModel[]`.
- **Components**: `ComponentsResponse` (list), `ComponentResponse` (detail), `SearchResponse` (datasource search).
- **Flows**: `ExperimentFlowResponse` ∪ `ExperienceFlowResponseV2` discriminated on `subtype` (`EXPERIMENT` / `EXPERIENCE`); `VariantInfoResponse`.
- **Briefs**: `ListBriefTypesResponse`, `ListBriefsResponse`, `GetBriefResponse`, `GetBriefTypeResponse`.
- **Brand kits**: `ListBrandKitResponse[]`, `GetBrandKitResponse`.
- **Brand contexts**: `ListBrandContextResponse[]` (`brandContextId, displayName, sourceRef, runStatus, createdDateTime, updatedDateTime`), `GetBrandContextResponse` (same + `children` tree), `BrandContextBatchGetResponse` (`requested, succeeded, failed, data[]` in request order).
- **Jobs**: `GET /jobs/{jobId}` and `/operations` return untyped JSON objects in the spec (no fixed schema) — treat defensively.
