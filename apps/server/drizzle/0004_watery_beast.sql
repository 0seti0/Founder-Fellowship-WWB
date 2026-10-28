ALTER TABLE `hypotheses` MODIFY COLUMN `axes` json;--> statement-breakpoint
ALTER TABLE `candidates` ADD `generation_meta` json;--> statement-breakpoint
ALTER TABLE `generation_runs` ADD `generation_strategy` varchar(64);--> statement-breakpoint
ALTER TABLE `generation_runs` ADD `rubric_version` varchar(64);