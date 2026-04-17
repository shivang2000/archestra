/**
 * Tests for org-wide MCP server scope (#3790).
 *
 * The visibility model:
 * - scope='personal' → only ownerId / mcp_server_user assignments can see
 * - scope='team'     → team_id required; team members can see
 * - scope='org'      → every member of the catalog's organization can see
 *
 * Permission model:
 * - Creating scope='org' requires `mcpServerInstallation: ['admin']`
 * - At most one org-wide install per catalog item per organization
 */
import { vi } from "vitest";
import McpServerModel from "@/models/mcp-server";
import type { FastifyInstanceWithZod } from "@/server";
import { createFastifyInstance } from "@/server";
import { afterEach, beforeEach, describe, expect, test } from "@/test";
import type { User } from "@/types";

const { hasPermissionMock } = vi.hoisted(() => ({
  hasPermissionMock: vi.fn(),
}));

vi.mock("@/auth/utils", () => ({
  hasPermission: hasPermissionMock,
}));

vi.mock("@/clients/mcp-client", () => ({
  default: {
    connectAndGetTools: vi.fn(),
    invalidateConnectionsForServer: vi.fn(),
    inspectServer: vi.fn(),
  },
  McpServerNotReadyError: class extends Error {},
  McpServerConnectionTimeoutError: class extends Error {},
}));

vi.mock("@/k8s/mcp-server-runtime", () => ({
  McpServerRuntimeManager: {
    isEnabled: false,
    startServer: vi.fn(),
    restartServer: vi.fn(),
    stopServer: vi.fn(),
    getOrLoadDeployment: vi.fn(),
  },
}));

describe("McpServerModel — org-wide visibility", () => {
  let user: User;

  beforeEach(async ({ makeUser }) => {
    user = await makeUser();
  });

  test("an org member can see an org-wide server installed in their org", async ({
    makeUser,
    makeOrganization,
    makeMember,
    makeInternalMcpCatalog,
    makeMcpServer,
  }) => {
    const org = await makeOrganization();
    await makeMember(user.id, org.id);

    const otherInstaller = await makeUser({ email: "installer@example.com" });
    await makeMember(otherInstaller.id, org.id);

    const catalog = await makeInternalMcpCatalog({
      serverType: "remote",
      organizationId: org.id,
    });
    const orgServer = await makeMcpServer({
      catalogId: catalog.id,
      ownerId: otherInstaller.id,
      scope: "org",
    });

    const visible = await McpServerModel.findAll(user.id, false);
    expect(visible.map((s) => s.id)).toContain(orgServer.id);
  });

  test("a user in a different org cannot see an org-wide server", async ({
    makeUser,
    makeOrganization,
    makeMember,
    makeInternalMcpCatalog,
    makeMcpServer,
  }) => {
    const ownerOrg = await makeOrganization();
    const owner = await makeUser({ email: "owner@example.com" });
    await makeMember(owner.id, ownerOrg.id);

    const outsiderOrg = await makeOrganization();
    const outsider = await makeUser({ email: "outsider@example.com" });
    await makeMember(outsider.id, outsiderOrg.id);

    const catalog = await makeInternalMcpCatalog({
      serverType: "remote",
      organizationId: ownerOrg.id,
    });
    const orgServer = await makeMcpServer({
      catalogId: catalog.id,
      ownerId: owner.id,
      scope: "org",
    });

    const outsiderVisible = await McpServerModel.findAll(outsider.id, false);
    expect(outsiderVisible.map((s) => s.id)).not.toContain(orgServer.id);
  });

  test("findById returns the org-wide server for an org member", async ({
    makeUser,
    makeOrganization,
    makeMember,
    makeInternalMcpCatalog,
    makeMcpServer,
  }) => {
    const org = await makeOrganization();
    await makeMember(user.id, org.id);

    const installer = await makeUser({ email: "installer@example.com" });
    await makeMember(installer.id, org.id);

    const catalog = await makeInternalMcpCatalog({
      serverType: "remote",
      organizationId: org.id,
    });
    const orgServer = await makeMcpServer({
      catalogId: catalog.id,
      ownerId: installer.id,
      scope: "org",
    });

    const result = await McpServerModel.findById(orgServer.id, user.id, false);
    expect(result?.id).toBe(orgServer.id);
  });

  test("findById returns null for an org-wide server when user is not in the org", async ({
    makeUser,
    makeOrganization,
    makeMember,
    makeInternalMcpCatalog,
    makeMcpServer,
  }) => {
    const ownerOrg = await makeOrganization();
    const owner = await makeUser({ email: "owner@example.com" });
    await makeMember(owner.id, ownerOrg.id);

    const outsiderOrg = await makeOrganization();
    const outsider = await makeUser({ email: "outsider@example.com" });
    await makeMember(outsider.id, outsiderOrg.id);

    const catalog = await makeInternalMcpCatalog({
      serverType: "remote",
      organizationId: ownerOrg.id,
    });
    const orgServer = await makeMcpServer({
      catalogId: catalog.id,
      ownerId: owner.id,
      scope: "org",
    });

    const result = await McpServerModel.findById(orgServer.id, outsider.id, false);
    expect(result).toBeNull();
  });
});

describe("POST /api/mcp_server — scope='org' permission gating", () => {
  let app: FastifyInstanceWithZod;
  let user: User;

  beforeEach(async ({ makeUser }) => {
    user = await makeUser();
    app = createFastifyInstance();
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  test("non-admin user gets 403 when creating scope='org' MCP server", async ({
    makeOrganization,
    makeMember,
    makeInternalMcpCatalog,
  }) => {
    const org = await makeOrganization();
    await makeMember(user.id, org.id);
    const catalog = await makeInternalMcpCatalog({
      serverType: "remote",
      organizationId: org.id,
    });

    // Default permission denies admin
    hasPermissionMock.mockResolvedValue({ success: false });

    const response = await app.inject({
      method: "POST",
      url: "/api/mcp_server",
      payload: {
        name: catalog.name,
        catalogId: catalog.id,
        scope: "org",
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.message).toMatch(/org-wide/i);
  });

  test("scope='org' with a teamId is rejected at the route layer", async ({
    makeOrganization,
    makeMember,
    makeTeam,
    makeTeamMember,
    makeInternalMcpCatalog,
  }) => {
    const org = await makeOrganization();
    await makeMember(user.id, org.id);
    const team = await makeTeam(org.id, user.id, { name: "Eng" });
    await makeTeamMember(team.id, user.id);
    const catalog = await makeInternalMcpCatalog({
      serverType: "remote",
      organizationId: org.id,
    });

    // Even an admin should be rejected by the explicit teamId guard,
    // because scope='org' with teamId is incoherent.
    hasPermissionMock.mockResolvedValue({ success: true });

    const response = await app.inject({
      method: "POST",
      url: "/api/mcp_server",
      payload: {
        name: catalog.name,
        catalogId: catalog.id,
        scope: "org",
        teamId: team.id,
      },
    });

    // Either the zod refinement (400) or the runtime guard (400) — both are
    // valid; we just want it to be rejected before any DB write.
    expect(response.statusCode).toBe(400);
  });
});
