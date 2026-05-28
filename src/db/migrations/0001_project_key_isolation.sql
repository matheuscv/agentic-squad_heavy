ALTER TABLE "stories" ADD COLUMN "project_key" text NOT NULL DEFAULT 'SCRUM';--> statement-breakpoint
CREATE INDEX "stories_project_key_idx" ON "stories" USING btree ("project_key");
