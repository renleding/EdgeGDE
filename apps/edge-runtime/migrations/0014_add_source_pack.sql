ALTER TABLE rules ADD COLUMN source_pack TEXT DEFAULT '';
REINDEX idx_rules_tenant;
REINDEX idx_rules_priority;