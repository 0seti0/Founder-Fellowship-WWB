CREATE TABLE `candidates` (
	`id` varchar(36) NOT NULL,
	`project_id` varchar(36) NOT NULL,
	`run_id` varchar(36) NOT NULL,
	`ordinal` int NOT NULL,
	`model_key` varchar(191) NOT NULL,
	`content` json NOT NULL,
	`constraint_evaluations` json NOT NULL,
	`quality` json NOT NULL,
	`completeness` json NOT NULL,
	`generic_first_test` boolean NOT NULL,
	`eligibility` enum('ELIGIBLE','REJECTED') NOT NULL,
	`rejection_reasons` json NOT NULL,
	`quality_score` double NOT NULL,
	`duplicate_of_candidate_id` varchar(36),
	`dedup_similarity` double,
	`selection_state` enum('SELECTED','NOT_SELECTED','REJECTED','DUPLICATE'),
	`selection_score` double,
	`display_position` int,
	`selection_probability` double,
	`selection_metadata` json NOT NULL,
	`prompt_version` varchar(64) NOT NULL,
	`schema_version` varchar(64) NOT NULL,
	`policy_version` varchar(64) NOT NULL,
	`node_id` varchar(36),
	CONSTRAINT `candidates_id` PRIMARY KEY(`id`),
	CONSTRAINT `candidates_run_ordinal_uq` UNIQUE(`run_id`,`ordinal`),
	CONSTRAINT `candidates_run_model_key_uq` UNIQUE(`run_id`,`model_key`)
);
--> statement-breakpoint
CREATE TABLE `edges` (
	`id` varchar(36) NOT NULL,
	`project_id` varchar(36) NOT NULL,
	`parent_id` varchar(36) NOT NULL,
	`child_id` varchar(36) NOT NULL,
	`run_id` varchar(36) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `edges_id` PRIMARY KEY(`id`),
	CONSTRAINT `edges_parent_child_uq` UNIQUE(`parent_id`,`child_id`)
);
--> statement-breakpoint
CREATE TABLE `events` (
	`seq` bigint AUTO_INCREMENT NOT NULL,
	`id` varchar(36) NOT NULL,
	`project_id` varchar(36) NOT NULL,
	`run_id` varchar(36),
	`node_id` varchar(36),
	`type` enum('PROJECT_CREATED','INITIAL_GENERATED','GENERATION_FAILED','SLATE_DISPLAYED','NODE_OPENED') NOT NULL,
	`payload` json NOT NULL,
	`dedupe_key` varchar(191),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `events_seq` PRIMARY KEY(`seq`),
	CONSTRAINT `events_id_unique` UNIQUE(`id`),
	CONSTRAINT `events_dedupe_key_unique` UNIQUE(`dedupe_key`)
);
--> statement-breakpoint
CREATE TABLE `generation_runs` (
	`id` varchar(36) NOT NULL,
	`project_id` varchar(36) NOT NULL,
	`kind` enum('INITIAL') NOT NULL,
	`status` enum('PENDING','RUNNING','SUCCEEDED','FAILED') NOT NULL,
	`model_provider` varchar(191) NOT NULL,
	`model_name` varchar(191) NOT NULL,
	`prompt_versions` json NOT NULL,
	`schema_version` varchar(64) NOT NULL,
	`selection_policy_version` varchar(64) NOT NULL,
	`dedup_mode` enum('EMBEDDING','TEXT_FALLBACK'),
	`degraded` boolean NOT NULL DEFAULT false,
	`attempts` json NOT NULL,
	`error_code` varchar(64),
	`error_message` text,
	`mock_scenario` varchar(64),
	`started_at` timestamp,
	`finished_at` timestamp,
	CONSTRAINT `generation_runs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `hypotheses` (
	`id` varchar(36) NOT NULL,
	`project_id` varchar(36) NOT NULL,
	`run_id` varchar(36) NOT NULL,
	`candidate_id` varchar(36) NOT NULL,
	`statement` text NOT NULL,
	`axes` json NOT NULL,
	`assumptions` json NOT NULL,
	`supporting_fact_ids` json NOT NULL,
	`counterevidence` json NOT NULL,
	`falsifiers` json NOT NULL,
	CONSTRAINT `hypotheses_id` PRIMARY KEY(`id`),
	CONSTRAINT `hypotheses_candidate_id_uq` UNIQUE(`candidate_id`)
);
--> statement-breakpoint
CREATE TABLE `nodes` (
	`id` varchar(36) NOT NULL,
	`project_id` varchar(36) NOT NULL,
	`type` enum('ROOT_PROMPT','IDEA') NOT NULL,
	`origin` enum('PROMPT','INITIAL_FRAME') NOT NULL,
	`operator` varchar(64),
	`run_id` varchar(36),
	`candidate_id` varchar(36),
	`title` varchar(120) NOT NULL,
	`summary` varchar(600) NOT NULL,
	`content` json NOT NULL,
	`display_position` int,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `nodes_id` PRIMARY KEY(`id`),
	CONSTRAINT `nodes_candidate_id_unique` UNIQUE(`candidate_id`)
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` varchar(36) NOT NULL,
	`title` varchar(191) NOT NULL,
	`original_prompt` text NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `projects_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `prompt_analyses` (
	`id` varchar(36) NOT NULL,
	`project_id` varchar(36) NOT NULL,
	`run_id` varchar(36) NOT NULL,
	`prompt_version` varchar(64) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `prompt_analyses_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `prompt_items` (
	`id` varchar(36) NOT NULL,
	`analysis_id` varchar(36) NOT NULL,
	`project_id` varchar(36) NOT NULL,
	`ref` varchar(32) NOT NULL,
	`kind` enum('FACT','CONSTRAINT') NOT NULL,
	`text` text NOT NULL,
	`evidence_text` text NOT NULL,
	`evidence_start` int NOT NULL,
	`evidence_end` int NOT NULL,
	`strength` enum('hard','soft'),
	`basis` enum('explicit','inferred'),
	CONSTRAINT `prompt_items_id` PRIMARY KEY(`id`),
	CONSTRAINT `prompt_items_analysis_ref_uq` UNIQUE(`analysis_id`,`ref`)
);
--> statement-breakpoint
ALTER TABLE `candidates` ADD CONSTRAINT `candidates_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `candidates` ADD CONSTRAINT `candidates_run_id_generation_runs_id_fk` FOREIGN KEY (`run_id`) REFERENCES `generation_runs`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `candidates` ADD CONSTRAINT `candidates_node_id_nodes_id_fk` FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `edges` ADD CONSTRAINT `edges_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `edges` ADD CONSTRAINT `edges_parent_id_nodes_id_fk` FOREIGN KEY (`parent_id`) REFERENCES `nodes`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `edges` ADD CONSTRAINT `edges_child_id_nodes_id_fk` FOREIGN KEY (`child_id`) REFERENCES `nodes`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `edges` ADD CONSTRAINT `edges_run_id_generation_runs_id_fk` FOREIGN KEY (`run_id`) REFERENCES `generation_runs`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `events` ADD CONSTRAINT `events_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `events` ADD CONSTRAINT `events_run_id_generation_runs_id_fk` FOREIGN KEY (`run_id`) REFERENCES `generation_runs`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `events` ADD CONSTRAINT `events_node_id_nodes_id_fk` FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `generation_runs` ADD CONSTRAINT `generation_runs_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `hypotheses` ADD CONSTRAINT `hypotheses_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `hypotheses` ADD CONSTRAINT `hypotheses_run_id_generation_runs_id_fk` FOREIGN KEY (`run_id`) REFERENCES `generation_runs`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `hypotheses` ADD CONSTRAINT `hypotheses_candidate_id_candidates_id_fk` FOREIGN KEY (`candidate_id`) REFERENCES `candidates`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `nodes` ADD CONSTRAINT `nodes_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `nodes` ADD CONSTRAINT `nodes_run_id_generation_runs_id_fk` FOREIGN KEY (`run_id`) REFERENCES `generation_runs`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `prompt_analyses` ADD CONSTRAINT `prompt_analyses_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `prompt_analyses` ADD CONSTRAINT `prompt_analyses_run_id_generation_runs_id_fk` FOREIGN KEY (`run_id`) REFERENCES `generation_runs`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `prompt_items` ADD CONSTRAINT `prompt_items_analysis_id_prompt_analyses_id_fk` FOREIGN KEY (`analysis_id`) REFERENCES `prompt_analyses`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `prompt_items` ADD CONSTRAINT `prompt_items_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `candidates_project_id_idx` ON `candidates` (`project_id`);--> statement-breakpoint
CREATE INDEX `edges_project_id_idx` ON `edges` (`project_id`);--> statement-breakpoint
CREATE INDEX `events_project_id_seq_idx` ON `events` (`project_id`,`seq`);--> statement-breakpoint
CREATE INDEX `events_run_id_idx` ON `events` (`run_id`);--> statement-breakpoint
CREATE INDEX `generation_runs_project_id_idx` ON `generation_runs` (`project_id`);--> statement-breakpoint
CREATE INDEX `hypotheses_project_id_idx` ON `hypotheses` (`project_id`);--> statement-breakpoint
CREATE INDEX `nodes_project_id_idx` ON `nodes` (`project_id`);--> statement-breakpoint
CREATE INDEX `prompt_analyses_project_id_idx` ON `prompt_analyses` (`project_id`);--> statement-breakpoint
CREATE INDEX `prompt_items_project_id_idx` ON `prompt_items` (`project_id`);