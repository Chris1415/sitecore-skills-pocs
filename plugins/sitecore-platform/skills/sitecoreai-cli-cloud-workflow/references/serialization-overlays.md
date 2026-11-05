# Items as resources, DB overlays and `ser push` (measured 2026-10-06)

A CM deployed from a serialization repo serves those items as **items as resources (IAR)**: `.dat` files built from
the yml at deploy time, immutable, merged into the tree at runtime. In `xmcloud.build.json`, omitting `deployItems`
makes **every** module in `sitecore.json` IAR. `postActions.actions.scsModules` instead pushes named modules into the
DB after each deploy. Measured on six brand modules (650–1,026 items each) pushed from git into a second CM that
builds from the same repo.

## Five facts that change what a push or pull means

1. **`ser push` does not write IAR-only items.** It compares against the merged tree, sees them as present and
   skips them. On a 1,026-item module only 90 were written to the DB. Turning IAR off without first materializing
   those items makes them disappear from the CM.
2. **The overlay trap.** Editing an IAR item in the CM, including automatic thumbnail generation, copies it into
   the DB with the same id. The DB copy wins from then on: later git changes to that item never apply, and a CM
   rebuild never clears it. Only deleting the DB copy (or pushing over it) brings git back.
3. **Measure overlays by `__Revision` AND by values.** A value-only compare missed 9 of 11 real overlays (stale
   copies with identical values); one blob overlay showed only in the CLI trace. Compare item presence by id too:
   a DB-only item at a git item's path hides the git item.
4. **`NonUniquePathException` aborts push and pull before any change is evaluated** when a DB-only item sits at the
   same path as a git item. Seen twice: a site thumbnail the CM generated (`System/thumbnail_<site-guid>`, same
   name as git's) and a duplicate template folder the templates had been re-parented under. Fix, in order, reading
   back each step:
   - thumbnail: point the site `__Thumbnail` at git's item (copy the yml value verbatim), then delete the DB copy;
   - duplicate folder: `moveItem` every child back under git's folder (ids are kept), assert every git item sits at
     its git path, then delete the empty duplicate; compare preview route structure before and after;
   - re-run the what-if; it must evaluate without the exception.
   A template moved back this way is re-stamped by `moveItem`; the CLI reports it equal to git (even with
   `--force`), so the revision drift is a recorded residual, not a defect.
5. **`--trace` prints long values capped at 299,992 characters.** A media `Blob` "update" whose printed old and new
   values match may be a prefix compare: also check that `Size` is unchanged. Most media `[U]` lines in a what-if
   are this false positive (79 of 81 in one module); pushing them writes the blobs into the DB, the same shape a
   CM that was authored directly has.

## Pushing to a CM other than the one you pulled from

- Every op names both `-n <endpoint>` and `-i "<module>"`. Assert the endpoint host before each op:
  `user.json`'s `defaultEndpoint` is whatever the last login wrote.
- `--what-if --trace` first. Reconcile every `[D]`: a delete is acceptable only for a DB-only dev item (template,
  rendering, folder) that is not in git and that nothing references. Any delete of content or media → stop.
- After the real push, a second what-if must report 0 changes. A non-zero remainder is either a value Sitecore
  will not store (a field git still carries but the template no longer defines, which re-reports on every push)
  or something to explain before going on.
- Content includes are normally `CreateAndUpdate`: a push overwrites author edits that were never pulled. Push
  only when the source of truth is git, or the target has no authoring yet.
