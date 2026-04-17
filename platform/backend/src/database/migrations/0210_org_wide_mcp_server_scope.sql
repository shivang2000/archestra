ALTER TABLE "mcp_server" ADD COLUMN "scope" text DEFAULT 'personal' NOT NULL;--> statement-breakpoint
UPDATE "mcp_server" SET "scope" = CASE WHEN "team_id" IS NOT NULL THEN 'team' ELSE 'personal' END;--> statement-breakpoint
CREATE INDEX "idx_mcp_server_scope" ON "mcp_server" USING btree ("scope");
