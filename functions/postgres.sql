CREATE SCHEMA IF NOT EXISTS charmsg;
REVOKE ALL ON SCHEMA charmsg FROM PUBLIC;
CREATE TABLE IF NOT EXISTS charmsg.documents (
  path text PRIMARY KEY,
  parent text NOT NULL,
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object')
);
ALTER TABLE charmsg.documents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON charmsg.documents FROM PUBLIC;
CREATE INDEX IF NOT EXISTS documents_parent ON charmsg.documents(parent);
CREATE INDEX IF NOT EXISTS documents_data ON charmsg.documents USING gin(data);
CREATE OR REPLACE FUNCTION charmsg.merge_json(original jsonb, patch jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT coalesce(jsonb_object_agg(key,
    CASE WHEN jsonb_typeof(original -> key) = 'object' AND jsonb_typeof(patch -> key) = 'object'
      THEN charmsg.merge_json(original -> key, patch -> key)
      ELSE coalesce(patch -> key, original -> key) END
  ), '{}'::jsonb)
  FROM (SELECT jsonb_object_keys(original || patch) AS key) keys
$$;
REVOKE ALL ON FUNCTION charmsg.merge_json(jsonb,jsonb) FROM PUBLIC;
