CREATE TABLE `app_meta` (
	`key` varchar(191) NOT NULL,
	`value` text NOT NULL,
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `app_meta_key` PRIMARY KEY(`key`)
);
