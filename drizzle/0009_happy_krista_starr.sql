CREATE TABLE `graph_edges` (
	`id` text PRIMARY KEY NOT NULL,
	`project_path` text NOT NULL,
	`source` text NOT NULL,
	`target` text NOT NULL,
	`kind` text NOT NULL,
	`inferred` integer NOT NULL,
	`origin` text NOT NULL,
	`meta` text
);
--> statement-breakpoint
CREATE INDEX `idx_graph_edges_project` ON `graph_edges` (`project_path`);--> statement-breakpoint
CREATE INDEX `idx_graph_edges_source` ON `graph_edges` (`source`);--> statement-breakpoint
CREATE INDEX `idx_graph_edges_target` ON `graph_edges` (`target`);--> statement-breakpoint
CREATE TABLE `graph_nodes` (
	`id` text PRIMARY KEY NOT NULL,
	`project_path` text NOT NULL,
	`kind` text NOT NULL,
	`label` text NOT NULL,
	`rel_path` text,
	`meta` text,
	`community` integer,
	`origin` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_graph_nodes_project` ON `graph_nodes` (`project_path`);--> statement-breakpoint
CREATE INDEX `idx_graph_nodes_kind` ON `graph_nodes` (`kind`);