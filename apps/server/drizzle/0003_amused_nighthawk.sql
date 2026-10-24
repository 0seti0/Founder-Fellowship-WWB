ALTER TABLE `events` MODIFY COLUMN `type` enum('PROJECT_CREATED','INITIAL_GENERATED','GENERATION_FAILED','SLATE_DISPLAYED','NODE_OPENED','NODE_EXPANDED','NODE_PINNED','NODE_UNPINNED','NODE_REJECTED','NODE_ARCHIVED','NODE_EDITED','ACTIVE_NODE_CHANGED') NOT NULL;--> statement-breakpoint
ALTER TABLE `generation_runs` MODIFY COLUMN `kind` enum('INITIAL','EXPANSION') NOT NULL;--> statement-breakpoint
ALTER TABLE `nodes` MODIFY COLUMN `origin` enum('PROMPT','INITIAL_FRAME','OPERATOR_EXPANSION') NOT NULL;--> statement-breakpoint
ALTER TABLE `candidates` ADD `operator` varchar(64);--> statement-breakpoint
ALTER TABLE `candidates` ADD `operator_registry_version` varchar(64);--> statement-breakpoint
ALTER TABLE `candidates` ADD `suitability_score` double;--> statement-breakpoint
ALTER TABLE `candidates` ADD `planning_metadata` json;--> statement-breakpoint
ALTER TABLE `generation_runs` ADD `operator` varchar(64);--> statement-breakpoint
ALTER TABLE `generation_runs` ADD `parent_node_id` varchar(36);--> statement-breakpoint
ALTER TABLE `generation_runs` ADD `operator_registry_version` varchar(64);--> statement-breakpoint
ALTER TABLE `generation_runs` ADD `planning_features` json;--> statement-breakpoint
ALTER TABLE `nodes` ADD `status` enum('VISIBLE','PINNED','REJECTED','ARCHIVED') DEFAULT 'VISIBLE' NOT NULL;--> statement-breakpoint
ALTER TABLE `nodes` ADD `user_edited` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `nodes` ADD `updated_at` timestamp DEFAULT (now()) NOT NULL ON UPDATE CURRENT_TIMESTAMP;--> statement-breakpoint
ALTER TABLE `projects` ADD `active_node_id` varchar(36);