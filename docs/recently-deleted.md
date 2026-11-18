# Recently Deleted

Open **Workspace → Recently Deleted** in the main sidebar. It is also available
alongside Archives in the sidebar's **More** panel. Or visit
`/<workspace>/recently-deleted`.

Supported items: projects, work items, modules, cycles, pages, views, and labels.
The screen uses the server's `HARD_DELETE_AFTER_DAYS` retention (60 days by default).
There is no permanent-delete action in this screen.

Workspace admins can see and restore everyone's tracked deletions. Other active
workspace members can only see and restore deletions attributed to their own user
ID, subject to current project membership and private-page/view access. Creating
or editing an item does not grant restore permission. Project admins who deleted
a project can restore their own deletion while still in the workspace.

Deletion records capture the root, the authenticated deleting user, and the exact
rows and SET_NULL relationships changed by that operation. Supported deletes run
their existing cascade synchronously in a transaction, including queryset/bulk
deletes. A restore uses that snapshot in another transaction. Previously deleted
children stay deleted; children deleted with a project are restored through the
project rather than listed as independent deletions. Both the deleting and
restoring users are retained on the deletion record.

Restore refuses missing parents, purged related rows, a newer deletion of a
captured row, and uniqueness conflicts. It never overwrites an existing item to
make a restore succeed. Archived items keep their previous archived state.

## Earlier deletions

Items deleted before this feature have no trustworthy deletion-actor or cascade
record. They appear to workspace admins as **Needs recovery**, with no automatic
restore. They are hidden from regular users. Recover those with an administrator's
database/backup review; do not backfill ownership from `created_by` or `updated_by`
or infer cascade membership from a time window. The Template Module recovery on
November 17, 2026 was completed separately before this feature was added.

## Validation

Run the recovery and authorization regression suite against an isolated database:

```sh
cd apps/api
DJANGO_SETTINGS_MODULE=plane.settings.test \
DATABASE_URL=postgresql://plane:plane@127.0.0.1:55439/plane \
python manage.py test plane.tests.contract.app.test_recently_deleted --noinput
```

The normal Docker test stack can run the same file with pytest. The tests mock
Celery's outbound `delay` calls; the tracked cascade itself executes normally.

Frontend checks:

```sh
pnpm turbo run build --filter=web
pnpm --filter=web check:types
```

## Production rollout

Build the frontend and backend from the same commit using the existing
`Publish PokeBedrock Images` workflow. Preserve the existing compose override,
proxy settings, environment, secrets, and all unrelated image tags.

On the Plane host:

1. Take and verify a current database backup.
2. Stop API/worker/beat-worker while changing backend versions, so no old process
   can create an untracked deletion during rollout.
3. Update the API/worker/beat-worker/migrator backend and web image references to
   the tested commit's tags. Pull those services.
4. Apply the additive `db.0124_deletionrecord` migration using the new backend:
   `docker compose run --rm api python manage.py migrate --noinput` (include the
   existing production compose override and `--env-file plane.env` arguments).
5. Recreate API/worker/beat-worker/web with the existing production compose files:
   `docker compose up -d --no-deps api worker beat-worker web`.
6. Verify a disposable module's delete/restore round trip with an admin and a
   regular project member. Check that a second member cannot see or restore it.

The migration adds one table and does not rewrite existing content. Roll back
images together if needed; retain the additive table and its deletion audit data.
Deletion records expire with the same retention window as the underlying data.
