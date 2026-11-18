# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Permission, cascade and conflict regression tests for Recently Deleted."""

from datetime import timedelta
from unittest.mock import patch

from crum import impersonate
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from plane.db.models import (
    Cycle,
    DeletionRecord,
    Issue,
    IssueSequence,
    IssueView,
    Label,
    Module,
    ModuleIssue,
    Page,
    Project,
    ProjectMember,
    ProjectPage,
    User,
    Workspace,
    WorkspaceMember,
)


class RecentlyDeletedTests(TestCase):
    def setUp(self):
        self.delay = patch("celery.app.task.Task.delay", return_value=None)
        self.delay.start()
        self.addCleanup(self.delay.stop)
        self.admin = User.objects.create(email="admin@recycle.test", username="recycle-admin")
        self.member = User.objects.create(email="member@recycle.test", username="recycle-member")
        self.other = User.objects.create(email="other@recycle.test", username="recycle-other")
        self.workspace = Workspace.objects.create(name="Recycle", slug="recycle", owner=self.admin)
        for user, role in [(self.admin, 20), (self.member, 15), (self.other, 15)]:
            WorkspaceMember.objects.create(workspace=self.workspace, member=user, role=role)
        self.project = Project.objects.create(workspace=self.workspace, name="Secret", identifier="SEC", network=0)
        for user in [self.admin, self.member, self.other]:
            ProjectMember.objects.create(workspace=self.workspace, project=self.project, member=user, role=20)
        self.module = Module.objects.create(workspace=self.workspace, project=self.project, name="Template")
        self.url = "/api/workspaces/recycle/recently-deleted/"
        self.client = APIClient()

    def delete(self, obj, actor=None):
        with impersonate(actor or self.member):
            obj.delete()

    def restore(self, obj, user=None, kind="module", slug="recycle"):
        self.client.force_authenticate(user=user or self.member)
        return self.client.post(f"/api/workspaces/{slug}/recently-deleted/{kind}/{obj.pk}/restore/")

    def test_owner_can_restore_but_other_member_cannot(self):
        self.delete(self.module)
        self.assertEqual(self.restore(self.module, self.other).status_code, 404)
        self.client.force_authenticate(user=self.other)
        self.assertEqual(self.client.get(self.url).data["results"], [])
        self.assertEqual(self.restore(self.module).status_code, 200)
        self.assertTrue(Module.objects.filter(pk=self.module.pk).exists())
        self.assertEqual(self.restore(self.module).status_code, 404)

    def test_admin_can_restore_another_users_deletion(self):
        self.delete(self.module)
        self.client.force_authenticate(user=self.admin)
        data = self.client.get(self.url).data
        self.assertTrue(data["is_admin"])
        self.assertEqual(data["results"][0]["id"], str(self.module.pk))
        self.assertEqual(self.restore(self.module, self.admin).status_code, 200)

    def test_creator_and_last_editor_do_not_count_as_deleter(self):
        Module.objects.filter(pk=self.module.pk).update(created_by=self.other, updated_by=self.other)
        self.delete(self.module)
        self.assertEqual(self.restore(self.module, self.other).status_code, 404)
        self.assertEqual(DeletionRecord.objects.get(object_id=self.module.pk).actor_id, self.member.pk)

    def test_cascade_restores_links_but_not_previously_removed_links(self):
        issues = [
            Issue.objects.create(workspace=self.workspace, project=self.project, name=name)
            for name in ["Planning", "Old"]
        ]
        active = ModuleIssue.objects.create(
            workspace=self.workspace, project=self.project, module=self.module, issue=issues[0]
        )
        removed = ModuleIssue.objects.create(
            workspace=self.workspace, project=self.project, module=self.module, issue=issues[1]
        )
        ModuleIssue.objects.filter(pk=removed.pk).delete()
        self.delete(self.module)
        self.assertFalse(ModuleIssue.objects.filter(pk=active.pk).exists())
        self.assertEqual(self.restore(self.module).status_code, 200)
        self.assertTrue(ModuleIssue.objects.filter(pk=active.pk).exists())
        self.assertFalse(ModuleIssue.objects.filter(pk=removed.pk).exists())

    def test_name_conflict_rolls_back_entire_restore(self):
        self.delete(self.module)
        Module.objects.create(workspace=self.workspace, project=self.project, name=self.module.name)
        self.assertEqual(self.restore(self.module).status_code, 409)
        self.assertFalse(Module.objects.filter(pk=self.module.pk).exists())
        self.assertIsNone(DeletionRecord.objects.get(object_id=self.module.pk).restored_at)

    def test_no_access_after_project_membership_removed(self):
        self.delete(self.module)
        ProjectMember.objects.filter(project=self.project, member=self.member).update(is_active=False)
        self.assertEqual(self.restore(self.module).status_code, 404)

    def test_cross_workspace_and_inactive_member_denied(self):
        self.delete(self.module)
        workspace = Workspace.objects.create(name="Elsewhere", slug="elsewhere", owner=self.member)
        WorkspaceMember.objects.create(workspace=workspace, member=self.member, role=20)
        self.assertEqual(self.restore(self.module, slug="elsewhere").status_code, 404)
        WorkspaceMember.objects.filter(workspace=self.workspace, member=self.member).update(is_active=False)
        self.assertEqual(self.restore(self.module).status_code, 403)

    def test_legacy_deletions_are_admin_only_and_not_guessed(self):
        Module.all_objects.filter(pk=self.module.pk).update(deleted_at=timezone.now())
        self.client.force_authenticate(user=self.member)
        self.assertEqual(self.client.get(self.url).data["results"], [])
        self.client.force_authenticate(user=self.admin)
        self.assertTrue(self.client.get(self.url).data["results"][0]["legacy"])
        self.assertEqual(self.restore(self.module, self.admin).status_code, 400)

    def test_expired_items_are_hidden(self):
        self.delete(self.module)
        Module.all_objects.filter(pk=self.module.pk).update(deleted_at=timezone.now() - timedelta(days=61))
        self.client.force_authenticate(user=self.admin)
        self.assertEqual(self.client.get(self.url).data["results"], [])
        self.assertEqual(self.restore(self.module, self.admin).status_code, 404)

    def test_private_page_is_hidden_even_from_original_deleter_after_ownership_changes(self):
        page = Page.objects.create(workspace=self.workspace, name="Private", owned_by=self.member, access=1)
        self.delete(page)
        Page.all_objects.filter(pk=page.pk).update(owned_by=self.other)
        self.assertEqual(self.restore(page, kind="page").status_code, 404)

    def test_project_page_requires_current_project_membership(self):
        page = Page.objects.create(workspace=self.workspace, name="Project page", owned_by=self.member)
        ProjectPage.objects.create(workspace=self.workspace, project=self.project, page=page)
        self.delete(page)
        ProjectMember.objects.filter(project=self.project, member=self.member).update(is_active=False)
        self.assertEqual(self.restore(page, kind="page").status_code, 404)

    def test_project_restore_includes_memberships_and_children(self):
        self.delete(self.project)
        response = self.restore(self.project, kind="project")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(Module.objects.filter(pk=self.module.pk).exists())
        self.assertTrue(ProjectMember.objects.filter(project=self.project, member=self.member).exists())

    def test_queryset_delete_records_each_root(self):
        with impersonate(self.member):
            Module.objects.filter(pk=self.module.pk).delete()
        self.assertEqual(self.restore(self.module).status_code, 200)

    def test_actual_delete_endpoint_records_authenticated_deleter(self):
        self.client.force_authenticate(user=self.member)
        response = self.client.delete(f"/api/workspaces/recycle/projects/{self.project.pk}/modules/{self.module.pk}/")
        self.assertEqual(response.status_code, 204, response.data)
        self.assertEqual(DeletionRecord.objects.get(object_id=self.module.pk).actor_id, self.member.pk)
        self.assertEqual(self.restore(self.module).status_code, 200)

    def test_bulk_issue_delete_preserves_module_associations_for_restore(self):
        issue = Issue.objects.create(workspace=self.workspace, project=self.project, name="Bulk")
        link = ModuleIssue.objects.create(
            workspace=self.workspace, project=self.project, module=self.module, issue=issue
        )
        self.client.force_authenticate(user=self.member)
        response = self.client.delete(
            f"/api/workspaces/recycle/projects/{self.project.pk}/bulk-delete-issues/",
            {"issue_ids": [str(issue.pk)]},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(self.restore(issue, kind="issue").status_code, 200)
        self.assertTrue(ModuleIssue.objects.filter(pk=link.pk).exists())

    def test_cascaded_items_are_listed_under_their_parent_deletion(self):
        self.delete(self.project)
        self.client.force_authenticate(user=self.admin)
        data = self.client.get(self.url).data
        self.assertEqual([(row["type"], row["id"]) for row in data["results"]], [("project", str(self.project.pk))])

    def test_work_item_restore_reattaches_subitems_and_sequence(self):
        parent = Issue.objects.create(workspace=self.workspace, project=self.project, name="Parent")
        child = Issue.objects.create(workspace=self.workspace, project=self.project, name="Child", parent=parent)
        self.delete(parent)
        child.refresh_from_db()
        self.assertIsNotNone(child.deleted_at)
        self.assertFalse(IssueSequence.objects.filter(issue=parent).exists())
        response = self.restore(parent, kind="issue")
        self.assertEqual(response.status_code, 200, response.data)
        child.refresh_from_db()
        self.assertEqual(child.parent_id, parent.pk)
        self.assertIsNone(child.deleted_at)
        self.assertTrue(IssueSequence.objects.filter(issue=parent).exists())

    def test_anonymous_access_denied(self):
        self.assertIn(self.client.get(self.url).status_code, [401, 403])

    def test_cycle_page_view_and_label_round_trips(self):
        cases = [
            (
                "cycle",
                Cycle.objects.create(
                    workspace=self.workspace,
                    project=self.project,
                    name="Cycle",
                    owned_by=self.member,
                ),
            ),
            ("page", Page.objects.create(workspace=self.workspace, name="Page", owned_by=self.member)),
            (
                "issueview",
                IssueView.objects.create(
                    workspace=self.workspace,
                    project=self.project,
                    name="View",
                    owned_by=self.member,
                ),
            ),
            ("label", Label.objects.create(workspace=self.workspace, project=self.project, name="Label")),
        ]
        for kind, item in cases:
            with self.subTest(kind=kind):
                self.delete(item)
                response = self.restore(item, kind=kind)
                self.assertEqual(response.status_code, 200, response.data)
                item.refresh_from_db()
                self.assertIsNone(item.deleted_at)

    def test_deleted_parent_blocks_child_restore_without_partial_changes(self):
        self.delete(self.module)
        self.delete(self.project)
        response = self.restore(self.module, self.admin)
        self.assertEqual(response.status_code, 400, response.data)
        self.assertFalse(Module.objects.filter(pk=self.module.pk).exists())
        self.assertEqual(self.restore(self.project, self.admin, kind="project").status_code, 200)
        # The module was already deleted when the project was removed.
        self.assertFalse(Module.objects.filter(pk=self.module.pk).exists())
        self.assertEqual(self.restore(self.module).status_code, 200)

    def test_legacy_delayed_cascade_does_not_redelete_restored_module(self):
        from plane.bgtasks.deletion_task import soft_delete_related_objects

        self.delete(self.module)
        self.assertEqual(self.restore(self.module).status_code, 200)
        soft_delete_related_objects("db", "module", self.module.pk)
        self.assertTrue(Module.objects.filter(pk=self.module.pk).exists())

    def test_stable_pagination_with_identical_deletion_timestamps(self):
        modules = [Module(workspace=self.workspace, project=self.project, name=f"Legacy {i}") for i in range(53)]
        Module.objects.bulk_create(modules)
        Module.all_objects.filter(pk__in=[module.pk for module in modules]).update(deleted_at=timezone.now())
        self.client.force_authenticate(user=self.admin)
        first = self.client.get(self.url).data
        second = self.client.get(self.url, {"offset": 50}).data
        self.assertEqual(len(first["results"]), 50)
        self.assertEqual(len(second["results"]), 3)
        self.assertTrue(first["has_more"])
        self.assertFalse(second["has_more"])
        ids = [row["id"] for row in first["results"] + second["results"]]
        self.assertEqual(len(set(ids)), 53)
