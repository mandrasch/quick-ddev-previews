ALTER TABLE `runs` ADD `slug` text;--> statement-breakpoint
-- Backfill legacy Phase 3 runs (no slug existed): give each one a valid slug
-- derived from its id, so its preview keeps working at run-<id>.preview.<base>.
-- New runs always carry a slug (the launch endpoint requires it).
UPDATE `runs` SET `slug` = 'run-' || id WHERE `slug` IS NULL;--> statement-breakpoint
ALTER TABLE `runs` ADD `visibility` text DEFAULT 'private' NOT NULL;--> statement-breakpoint
ALTER TABLE `runs` ADD `preview_password_hash` text;--> statement-breakpoint
ALTER TABLE `runs` ADD `preview_password_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `runs_slug_unique` ON `runs` (`slug`);
