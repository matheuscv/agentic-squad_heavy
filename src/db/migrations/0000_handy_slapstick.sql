CREATE TYPE "public"."agent_run_status" AS ENUM('pending', 'running', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."agent_type" AS ENUM('orchestrator', 'po', 'lt', 'dev', 'qa');--> statement-breakpoint
CREATE TYPE "public"."artifact_type" AS ENUM('prd', 'execution_plan', 'code', 'test_report', 'coverage_report');--> statement-breakpoint
CREATE TYPE "public"."story_status" AS ENUM('backlog', 'a_refinar', 'em_refinamento', 'aguardando_aceite_prd', 'prd_aceito', 'aguardando_aceite_plano', 'plano_validado', 'em_desenvolvimento', 'aguardando_aceite_dev', 'em_qa', 'aguardando_aceite_qa', 'validacao_final', 'concluido');--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"story_id" uuid NOT NULL,
	"agent_type" "agent_type" NOT NULL,
	"status" "agent_run_status" DEFAULT 'pending' NOT NULL,
	"iteration" integer DEFAULT 1 NOT NULL,
	"input" jsonb,
	"output" jsonb,
	"input_tokens" integer,
	"output_tokens" integer,
	"cost_usd" real,
	"duration_ms" integer,
	"error_message" text,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"story_id" uuid NOT NULL,
	"agent_run_id" uuid,
	"artifact_type" "artifact_type" NOT NULL,
	"file_path" text NOT NULL,
	"github_commit_sha" text,
	"content" text,
	"storage_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"jira_key" text NOT NULL,
	"jira_summary" text NOT NULL,
	"jira_description" text,
	"status" "story_status" DEFAULT 'backlog' NOT NULL,
	"jira_status" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "stories_jira_key_unique" UNIQUE("jira_key")
);
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_runs_story_id_idx" ON "agent_runs" USING btree ("story_id");--> statement-breakpoint
CREATE INDEX "agent_runs_agent_type_idx" ON "agent_runs" USING btree ("agent_type");--> statement-breakpoint
CREATE INDEX "agent_runs_status_idx" ON "agent_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "artifacts_story_id_idx" ON "artifacts" USING btree ("story_id");--> statement-breakpoint
CREATE INDEX "artifacts_agent_run_id_idx" ON "artifacts" USING btree ("agent_run_id");--> statement-breakpoint
CREATE INDEX "stories_jira_key_idx" ON "stories" USING btree ("jira_key");--> statement-breakpoint
CREATE INDEX "stories_status_idx" ON "stories" USING btree ("status");