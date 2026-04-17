"use client";

import { E2eTestId } from "@shared";
import { AlertTriangle, Building2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useHasPermissions } from "@/lib/auth/auth.query";
import { authClient } from "@/lib/clients/auth/auth-client";
import { useMcpServers } from "@/lib/mcp/mcp-server.query";
import { useTeams } from "@/lib/teams/team.query";

const PERSONAL_VALUE = "personal";
const ORG_VALUE = "organization";

/**
 * Credential / scope type emitted by this selector.
 * - "personal" → server visible only to the current user
 * - "team"     → server visible to a specific team's members
 * - "org"      → server visible org-wide (admin-only)
 */
export type McpServerCredentialType = "personal" | "team" | "org";

interface SelectMcpServerCredentialTypeAndTeamsProps {
  onTeamChange: (teamId: string | null) => void;
  /** Catalog ID to filter existing installations - if provided, disables already-used options */
  catalogId?: string;
  /** Callback when credential type changes (personal / team / org) */
  onCredentialTypeChange?: (type: McpServerCredentialType) => void;
  /** When true, this is a reinstall - credential type is locked to existing value */
  isReinstall?: boolean;
  /** The team ID of the existing server being reinstalled (null/undefined = personal) */
  existingTeamId?: string | null;
  /** When true, only personal installation is allowed (teams are disabled) */
  personalOnly?: boolean;
  /** When true, only team installation is allowed (personal is disabled) */
  teamOnly?: boolean;
  /** Callback when install availability changes (false when user lacks all options) */
  onCanInstallChange?: (canInstall: boolean) => void;
  /** Pre-select a specific team (used when adding shared connection from manage dialog) */
  preselectedTeamId?: string | null;
}

export function SelectMcpServerCredentialTypeAndTeams({
  onTeamChange,
  catalogId,
  onCredentialTypeChange,
  isReinstall = false,
  existingTeamId,
  personalOnly = false,
  teamOnly = false,
  onCanInstallChange,
  preselectedTeamId,
}: SelectMcpServerCredentialTypeAndTeamsProps) {
  const { data: teams, isLoading: isLoadingTeams } = useTeams();
  const { data: installedServers } = useMcpServers();
  const { data: session } = authClient.useSession();
  const currentUserId = session?.user?.id;

  // WHY: Check mcpServer:update permission to determine if user can create team installations
  // Editors have this permission, members don't. This prevents members from installing
  // MCP servers that affect the whole team - only editors and admins can do that.
  const { data: hasMcpServerUpdate } = useHasPermissions({
    mcpServerInstallation: ["update"],
  });

  // WHY: mcpServer:admin permission gates org-wide installations.
  // An org-wide MCP server exposes its credentials to every member of the
  // organization, so we hold creation behind the same admin permission used
  // elsewhere for cross-team policy decisions.
  const { data: hasMcpServerAdmin } = useHasPermissions({
    mcpServerInstallation: ["admin"],
  });

  // Compute existing installations for this catalog item
  const { hasPersonalInstallation, hasOrgInstallation, teamsWithInstallation } =
    useMemo(() => {
      if (!catalogId || !installedServers) {
        return {
          hasPersonalInstallation: false,
          hasOrgInstallation: false,
          teamsWithInstallation: [] as string[],
        };
      }

      const serversForCatalog = installedServers.filter(
        (s) => s.catalogId === catalogId,
      );

      const hasPersonal = serversForCatalog.some(
        (s) => s.ownerId === currentUserId && !s.teamId && s.scope !== "org",
      );

      const hasOrg = serversForCatalog.some((s) => s.scope === "org");

      const teamsWithInstall = serversForCatalog
        .filter((s): s is typeof s & { teamId: string } => !!s.teamId)
        .map((s) => s.teamId);

      return {
        hasPersonalInstallation: hasPersonal,
        hasOrgInstallation: hasOrg,
        teamsWithInstallation: teamsWithInstall,
      };
    }, [catalogId, installedServers, currentUserId]);

  // Filter available teams to exclude those that already have this server installed
  // For reinstall: include ALL teams (no filtering needed since we're updating, not creating)
  const availableTeams = useMemo(() => {
    if (!teams) return [];
    if (isReinstall) return teams; // No filtering for reinstall
    if (!catalogId) return teams; // No filtering if no catalogId provided
    return teams.filter((t) => !teamsWithInstallation.includes(t.id));
  }, [teams, catalogId, teamsWithInstallation, isReinstall]);

  // WHY: During reinstall, lock credential type to existing value (can't change ownership)
  // Personal is disabled if: reinstalling a team server, or (for new install) already has personal or BYOS enabled
  const isPersonalDisabled = teamOnly
    ? true
    : personalOnly
      ? false
      : isReinstall
        ? !!existingTeamId // Reinstalling team server - can't switch to personal
        : hasPersonalInstallation;

  // WHY: Team options are disabled if:
  // 1. personalOnly mode (e.g. Playwright - only personal installs allowed)
  // 2. Reinstalling a personal server (can't switch to team)
  // 3. User lacks mcpServer:update permission (members can never create team installations)
  const areTeamsDisabled = personalOnly
    ? true
    : isReinstall
      ? !existingTeamId // Reinstalling personal server - can't switch to team
      : !hasMcpServerUpdate;

  // WHY: Org-wide is disabled when:
  // - reinstall flow (we're rewiring an existing server, not changing scope)
  // - personalOnly or teamOnly mode (catalog-level constraint)
  // - one already exists for this catalog (at most one org-wide install per catalog)
  // - user lacks mcpServer:admin permission
  const isOrgDisabled =
    personalOnly ||
    teamOnly ||
    isReinstall ||
    hasOrgInstallation ||
    !hasMcpServerAdmin;

  // When all options are unavailable, user cannot install at all
  const canInstall = !isPersonalDisabled || !areTeamsDisabled || !isOrgDisabled;

  useEffect(() => {
    onCanInstallChange?.(canInstall);
  }, [canInstall, onCanInstallChange]);

  // Compute the initial dropdown value
  const initialValue = useMemo(() => {
    if (personalOnly) {
      return PERSONAL_VALUE;
    }
    if (preselectedTeamId) {
      return preselectedTeamId;
    }
    if (teamOnly && availableTeams.length > 0) {
      return availableTeams[0].id;
    }
    if (isReinstall) {
      return existingTeamId || PERSONAL_VALUE;
    }
    // Force team selection when personal is already installed
    if (hasPersonalInstallation && availableTeams.length > 0) {
      return availableTeams[0].id;
    }
    return PERSONAL_VALUE;
  }, [
    personalOnly,
    preselectedTeamId,
    teamOnly,
    hasPersonalInstallation,
    availableTeams,
    isReinstall,
    existingTeamId,
  ]);

  const [selectedValue, setSelectedValue] = useState<string>(initialValue);

  /** Translate the dropdown value into (credentialType, teamId) for the parent. */
  const dispatchSelection = (value: string) => {
    if (value === ORG_VALUE) {
      onCredentialTypeChange?.("org");
      onTeamChange(null);
      return;
    }
    if (value === PERSONAL_VALUE) {
      onCredentialTypeChange?.("personal");
      onTeamChange(null);
      return;
    }
    onCredentialTypeChange?.("team");
    onTeamChange(value);
  };

  // Sync when constraints change (e.g., data loads asynchronously)
  // Also notifies parent of the current credential type and team
  useEffect(() => {
    // For reinstall, don't auto-switch - keep the existing value
    if (isReinstall) {
      dispatchSelection(selectedValue);
      return;
    }

    // Force away from personal when personal already installed
    if (hasPersonalInstallation && selectedValue === PERSONAL_VALUE) {
      if (availableTeams.length > 0) {
        setSelectedValue(availableTeams[0].id);
        onCredentialTypeChange?.("team");
        onTeamChange(availableTeams[0].id);
        return;
      }
    }

    // Always notify parent of current state when dependencies change
    dispatchSelection(selectedValue);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dispatchSelection is stable for our purposes
  }, [
    hasPersonalInstallation,
    availableTeams,
    selectedValue,
    onCredentialTypeChange,
    onTeamChange,
    isReinstall,
  ]);

  const handleValueChange = (value: string) => {
    setSelectedValue(value);
    dispatchSelection(value);
  };

  if (!canInstall) {
    return (
      <Alert>
        <AlertTriangle className="!text-amber-500 h-4 w-4" />
        <AlertDescription>
          <span className="font-semibold">Already installed</span>
          <p className="mt-1">
            You have already installed this MCP server for yourself. To install
            for a team, you need the{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono">
              mcpServer:update
            </code>{" "}
            permission. To install org-wide, you need{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono">
              mcpServer:admin
            </code>
            .
          </p>
        </AlertDescription>
      </Alert>
    );
  }

  // When personalOnly or preselectedTeamId, hide the selector entirely — already determined
  if (personalOnly || preselectedTeamId) {
    return null;
  }

  return (
    <div className="space-y-2">
      <Label>{teamOnly ? "Select team" : "Connect MCP Server for"}</Label>
      <Select
        value={selectedValue}
        onValueChange={handleValueChange}
        disabled={isLoadingTeams || isReinstall}
      >
        <SelectTrigger data-testid={E2eTestId.SelectCredentialTypeTeamDropdown}>
          <SelectValue
            placeholder={
              isLoadingTeams ? "Loading..." : "Select installation type"
            }
          />
        </SelectTrigger>
        <SelectContent>
          {!teamOnly && (
            <SelectItem
              value={PERSONAL_VALUE}
              disabled={isPersonalDisabled}
              data-testid={E2eTestId.SelectCredentialTypePersonal}
            >
              Myself
              {hasPersonalInstallation && !isReinstall && (
                <span className="text-muted-foreground ml-1">
                  (already installed)
                </span>
              )}
            </SelectItem>
          )}
          {!teamOnly && (
            <SelectItem value={ORG_VALUE} disabled={isOrgDisabled}>
              <span className="inline-flex items-center gap-1.5">
                <Building2 className="h-3.5 w-3.5" />
                Entire organization
              </span>
              {hasOrgInstallation && (
                <span className="text-muted-foreground ml-1">
                  (already installed)
                </span>
              )}
            </SelectItem>
          )}
          {(isReinstall ? availableTeams : (teams ?? [])).length > 0 && (
            <SelectGroup>
              {!teamOnly && <SelectLabel>Teams</SelectLabel>}
              {(isReinstall ? availableTeams : (teams ?? [])).map((team) => {
                const isAlreadyInstalled =
                  !isReinstall && teamsWithInstallation.includes(team.id);
                return (
                  <SelectItem
                    key={team.id}
                    value={team.id}
                    disabled={areTeamsDisabled || isAlreadyInstalled}
                  >
                    {team.name}
                    {isAlreadyInstalled && (
                      <span className="text-muted-foreground ml-1">
                        (already installed)
                      </span>
                    )}
                  </SelectItem>
                );
              })}
            </SelectGroup>
          )}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">
        {selectedValue === ORG_VALUE
          ? "All members of your organization will be able to use this connection — its credentials will be shared with everyone in the org. Only org admins can create this."
          : selectedValue === PERSONAL_VALUE
            ? "Only admins can select this connection when assigning tools to agents and MCP gateways - other users will not see it."
            : "Any team member can select this connection when assigning tools to agents and MCP gateways."}
      </p>
    </div>
  );
}
