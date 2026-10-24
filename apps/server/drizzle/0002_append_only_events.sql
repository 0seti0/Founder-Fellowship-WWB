CREATE TRIGGER `events_append_only_before_update`
BEFORE UPDATE ON `events`
FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'events are append-only';
--> statement-breakpoint
CREATE TRIGGER `events_append_only_before_delete`
BEFORE DELETE ON `events`
FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'events are append-only';
-- Custom SQL migration file, put your code below! --