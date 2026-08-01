CREATE TABLE `projects` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`github_id` integer NOT NULL,
	`owner` text NOT NULL,
	`name` text NOT NULL,
	`full_name` text NOT NULL,
	`default_branch` text NOT NULL,
	`private` integer DEFAULT false NOT NULL,
	`clone_url` text NOT NULL,
	`env_example` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_github_id_unique` ON `projects` (`github_id`);--> statement-breakpoint
CREATE TABLE `runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`branch` text NOT NULL,
	`start_command` text,
	`env_vars` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`env_state` text DEFAULT 'down' NOT NULL,
	`preview_ready` integer DEFAULT false NOT NULL,
	`preview_hosts` text DEFAULT '[]' NOT NULL,
	`preview_last_seen` integer,
	`log` text DEFAULT '' NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `runs_project_id_idx` ON `runs` (`project_id`);--> statement-breakpoint
CREATE INDEX `runs_status_idx` ON `runs` (`status`);--> statement-breakpoint
CREATE TABLE `settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`max_concurrent_runs` integer DEFAULT 2 NOT NULL,
	`idle_stop_minutes` integer DEFAULT 1440 NOT NULL,
	`preview_retention_days` integer DEFAULT 7 NOT NULL,
	`archive_retention_days` integer DEFAULT 30 NOT NULL
);