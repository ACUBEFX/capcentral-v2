
-- Add configurable sizes to categories.
-- Existing categories receive an empty size list.

ALTER TABLE categories
ADD COLUMN sizes JSON NOT NULL DEFAULT (JSON_ARRAY());
