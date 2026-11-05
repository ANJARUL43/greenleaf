CREATE TABLE plants (
  id INTEGER PRIMARY KEY,
  symbol TEXT NOT NULL,
  synonym_symbol TEXT NOT NULL DEFAULT '',
  scientific_name TEXT NOT NULL,
  common_name TEXT NOT NULL DEFAULT '',
  family TEXT NOT NULL DEFAULT '',
  accepted INTEGER NOT NULL DEFAULT 1 CHECK (accepted IN (0, 1))
);
CREATE INDEX idx_plants_scientific_name ON plants (scientific_name COLLATE NOCASE);
CREATE INDEX idx_plants_common_name ON plants (common_name COLLATE NOCASE);
CREATE INDEX idx_plants_family ON plants (family COLLATE NOCASE);
