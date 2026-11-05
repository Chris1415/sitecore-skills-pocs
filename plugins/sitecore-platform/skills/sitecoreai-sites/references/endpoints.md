# Sites API — endpoints

Supporting reference for the `sitecoreai-sites` skill, regenerated from the OpenAPI spec named in `SKILL.md` frontmatter (`metadata.source_spec`). Moved out of `SKILL.md` on 2026-09-16 so the entry file stays under the spec's 5,000-token guidance; loaded on demand.

## Endpoints

Every endpoint accepts an `environmentId` query parameter (string, optional, e.g. `main`). Hierarchy endpoints also accept a `language` query parameter (ISO country-region code, e.g. `en-US`). Operation IDs from the spec are noted for traceability.

### Sites
| Method | Path | Op | Purpose |
|---|---|---|---|
| GET | `/api/v1/sites` | ListSites | List all sites with details. |
| POST | `/api/v1/sites` | CreateSite | Create a site (`siteName` + `templateId` + collection). Returns a `JobResponse` handle. |
| GET | `/api/v1/sites/{siteId}` | RetrieveSite | Site details. |
| PATCH | `/api/v1/sites/{siteId}` | UpdateSite | Update site properties. |
| DELETE | `/api/v1/sites/{siteId}` | DeleteSite | Delete site + all contents. Optional `force` query to delete even when published to Edge. Returns a job handle. |
| POST | `/api/v1/sites/{siteId}/copy` | CopySite | Duplicate a site. Returns a job handle. |
| POST | `/api/v1/sites/{siteId}/rename` | RenameSite | Change system name. Returns a job handle. |
| POST | `/api/v1/sites/sort` | SortSites | Reorder sites in the UI (`{ sites: { id: order } }`). |
| POST | `/api/v1/sites/name/validate` | ValidateSiteName | Validate a site-name candidate. |
| GET | `/api/v1/sites/analytics-identifiers/{analyticsIdentifier}` | ListTrackedSites | Sites using a given analytics identifier. |
| POST | `/api/v1/sites/analytics-identifiers/{analyticsIdentifier}/detach` | DetachAnalyticsIdentifier | Unassign an analytics identifier from one or more sites. |
| POST | `/api/v1/sites/{siteId}/upload-thumbnail` | UploadSiteThumbnail | Upload a site thumbnail (`multipart/form-data`, field `File`). |
| GET | `/api/v1/sites/templates` | ListSiteTemplates | Available site templates. |
| GET | `/api/v1/sites/{siteId}/statistics/localization` | RetrieveLocalizationStatistics | Per-locale page counts. |
| GET | `/api/v1/sites/{siteId}/statistics/workflow` | RetrieveWorkflowStatistics | Workflows, states, page counts per state. |
| GET | `/api/v1/sites/{siteId}/configuration/sitemap` | RetrieveSitemapConfiguration | Sitemap configuration. |
| PATCH | `/api/v1/sites/{siteId}/configuration/sitemap` | UpdateSitemapConfiguration | Update sitemap configuration. |
| POST | `/api/v1/sites/{siteId}/translate` | TranslateSite | Create translated versions of the whole site (via the Stream API). |

### Hierarchy (page tree)
| Method | Path | Op | Purpose |
|---|---|---|---|
| GET | `/api/v1/sites/{siteId}/hierarchy` | RetrieveSiteHierarchy | Root-page hierarchy (page + children + ancestors + siblings). |
| GET | `/api/v1/sites/{siteId}/hierarchy/{pageId}` | RetrievePageHierarchy | Hierarchy rooted at `pageId`. |
| GET | `/api/v1/sites/{siteId}/hierarchy/{pageId}/ancestors` | ListPageAncestors | Ancestors of `pageId`. |
| GET | `/api/v1/sites/{siteId}/hierarchy/{pageId}/children` | ListPageChildren | Direct children of `pageId`. |

### Hosts
| Method | Path | Op | Purpose |
|---|---|---|---|
| GET | `/api/v1/sites/{siteId}/hosts` | ListHosts | List hosts. |
| POST | `/api/v1/sites/{siteId}/hosts` | CreateHost | Create host (201 returns the `Host`). |
| GET | `/api/v1/sites/{siteId}/hosts/{hostId}` | RetrieveHost | Host details. |
| PATCH | `/api/v1/sites/{siteId}/hosts/{hostId}` | UpdateHost | Update host (204). |
| DELETE | `/api/v1/sites/{siteId}/hosts/{hostId}` | DeleteHost | Delete the site via a host ID (202). Optional `force` query for Edge-published. |
| GET | `/api/v1/sites/{siteId}/editinghosts` | GetEditingHosts | Editing hosts for the site. |
| GET | `/api/v1/sites/{siteId}/renderinghosts` | GetRenderingHosts | **Deprecated.** Use `editinghosts` instead. |

### Site Collections
| Method | Path | Op | Purpose |
|---|---|---|---|
| GET | `/api/v1/collections` | ListCollections | List collections. |
| POST | `/api/v1/collections` | CreateCollection | Create a collection. Returns a job handle. |
| GET | `/api/v1/collections/{collectionId}` | RetrieveCollection | Collection details. |
| PATCH | `/api/v1/collections/{collectionId}` | UpdateCollection | Update display name / description / sort order. |
| DELETE | `/api/v1/collections/{collectionId}` | DeleteCollection | Delete collection **and all sites in it**. Returns a job handle. |
| POST | `/api/v1/collections/{collectionId}/rename` | RenameCollection | Change system name. Returns a job handle. |
| POST | `/api/v1/collections/sort` | SortCollections | Reorder collections (`{ collections: { id: order } }`). |
| POST | `/api/v1/collections/name/validate` | ValidateCollectionName | Validate a collection-name candidate. |
| GET | `/api/v1/collections/{collectionId}/sites` | ListCollectionSites | Sites in a collection. |

### Languages
| Method | Path | Op | Purpose |
|---|---|---|---|
| GET | `/api/v1/languages` | ListLanguages | Languages added to the environment. |
| POST | `/api/v1/languages` | CreateLanguage | Add a language to the environment. |
| GET | `/api/v1/languages/supported` | ListSupportedLanguages | All SitecoreAI-supported languages (the add-list). |
| PATCH | `/api/v1/languages/{isoCode}` | UpdateLanguage | Update language settings (204). |
| DELETE | `/api/v1/languages/{isoCode}` | DeleteLanguage | Remove a language from the environment (returns boolean). |

### Favorites
| Method | Path | Op | Purpose |
|---|---|---|---|
| GET | `/api/v1/favorites/sites` | GetFavoriteSites | Favorite sites for current user. |
| POST | `/api/v1/favorites/sites` | AddFavoriteSite | Favorite a site (returns id string). |
| DELETE | `/api/v1/favorites/sites/{siteId}` | RemoveFavoriteSite | Unfavorite a site (204). |
| GET | `/api/v1/favorites/sitetemplates` | GetFavoriteSiteTemplates | Favorite site templates. |
| POST | `/api/v1/favorites/sitetemplates` | AddFavoriteSiteTemplate | Favorite a template (201 returns `FavoriteDto`). |
| DELETE | `/api/v1/favorites/sitetemplates/{siteTemplateId}` | RemoveFavoriteSiteTemplate | Unfavorite a template (204). |

### Editor Profiles
| Method | Path | Op | Purpose |
|---|---|---|---|
| GET | `/api/ui/v1/editorprofiles` | ListProfiles | List profiles. |
| POST | `/api/ui/v1/editorprofiles` | CreateProfile | Create a profile (201). |
| GET | `/api/ui/v1/editorprofiles/{id}` | GetProfile | Profile details. |
| PATCH | `/api/ui/v1/editorprofiles/{id}` | UpdateProfile | Update profile. |
| DELETE | `/api/ui/v1/editorprofiles/{id}` | DeleteProfile | Delete profile + its toolbar config. |

### Background Jobs
| Method | Path | Op | Purpose |
|---|---|---|---|
| GET | `/api/v1/jobs` | ListJobs | List background jobs (empty array if none running). |
| GET | `/api/v1/jobs/{jobHandle}/status` | RetrieveJob | Job status by handle. |

> Scope: these are **Sites API background jobs** (e.g. site create / copy / rename / delete, collection create / rename / delete, site translate). Distinct from Publishing API jobs and Agent API jobs.

> Note: there is **no aggregation endpoint group in this spec.** Earlier skill revisions documented `/api/v1/aggregation/pages` and `/api/v1/aggregation/pages/live/variants`; neither appears in `v1` (sha `a26e933…`). See the curated **Batch live-variant check** pitfall below.
