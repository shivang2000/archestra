import {
  createInsertSchema,
  createSelectSchema,
  createUpdateSchema,
} from "drizzle-zod";
import { z } from "zod";
import { schema } from "@/database";
import { InternalMcpCatalogServerTypeSchema } from "./mcp-catalog";
import { ResourceVisibilityScopeSchema } from "./visibility";

export const LocalMcpServerInstallationStatusSchema = z.enum([
  "idle",
  "pending",
  "discovering-tools",
  "success",
  "error",
]);

export const SecretStorageTypeSchema = z.enum([
  "vault",
  "external_vault",
  "database",
  "none",
]);

export type SecretStorageType = z.infer<typeof SecretStorageTypeSchema>;

/**
 * MCP server visibility scope.
 * Reuses the cross-resource ResourceVisibilityScope enum so it stays in sync
 * with virtual_api_keys, agents, and other scoped resources.
 *
 * Semantics:
 * - 'personal': only ownerId can see/use the server (legacy default)
 * - 'team':     teamId required; team members can see/use it
 * - 'org':      visible to every member of the catalog's organization,
 *               irrespective of team membership. Creating an org-wide server
 *               requires `mcpServerInstallation: ['admin']` permission.
 */
export const McpServerScopeSchema = ResourceVisibilityScopeSchema;
export type McpServerScope = z.infer<typeof McpServerScopeSchema>;

export const SelectMcpServerSchema = createSelectSchema(
  schema.mcpServersTable,
).extend({
  serverType: InternalMcpCatalogServerTypeSchema,
  scope: McpServerScopeSchema,
  ownerEmail: z.string().nullable().optional(),
  catalogName: z.string().nullable().optional(),
  users: z.array(z.string()).optional(),
  userDetails: z
    .array(
      z.object({
        userId: z.string(),
        email: z.string(),
        createdAt: z.coerce.date(),
      }),
    )
    .optional(),
  teamDetails: z
    .object({
      teamId: z.string(),
      name: z.string(),
      createdAt: z.coerce.date(),
    })
    .nullable()
    .optional(),
  localInstallationStatus: LocalMcpServerInstallationStatusSchema,
  secretStorageType: SecretStorageTypeSchema.optional(),
});

const InsertMcpServerBaseSchema = createInsertSchema(schema.mcpServersTable)
  .extend({
    serverType: InternalMcpCatalogServerTypeSchema,
    scope: McpServerScopeSchema.optional(),
    userId: z.string().optional(), // For personal auth
    localInstallationStatus: LocalMcpServerInstallationStatusSchema.optional(),
    userConfigValues: z.record(z.string(), z.string()).optional(),
    environmentValues: z.record(z.string(), z.string()).optional(),
  })
  .omit({
    id: true,
    createdAt: true,
    updatedAt: true,
  });

/**
 * Refinement: scope must be consistent with team_id / owner_id presence.
 * - scope='org': team_id and owner_id should both be null (org-wide servers
 *   are not tied to a single user/team)
 * - scope='team': team_id required
 * - scope='personal' (default): allow either owner_id or no team_id
 */
export const InsertMcpServerSchema = InsertMcpServerBaseSchema.refine(
  (data) => {
    if (data.scope === "org") {
      return !data.teamId;
    }
    if (data.scope === "team") {
      return Boolean(data.teamId);
    }
    return true;
  },
  {
    message:
      "scope='org' must not have teamId; scope='team' requires teamId",
    path: ["scope"],
  },
);

export const UpdateMcpServerSchema = createUpdateSchema(schema.mcpServersTable)
  .omit({
    serverType: true, // serverType should not be updated after creation
  })
  .extend({
    localInstallationStatus: LocalMcpServerInstallationStatusSchema.optional(),
    scope: McpServerScopeSchema.optional(),
  });

export type LocalMcpServerInstallationStatus = z.infer<
  typeof LocalMcpServerInstallationStatusSchema
>;

export type McpServer = z.infer<typeof SelectMcpServerSchema>;
export type InsertMcpServer = z.infer<typeof InsertMcpServerSchema>;
export type UpdateMcpServer = z.infer<typeof UpdateMcpServerSchema>;
