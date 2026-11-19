CREATE TABLE IF NOT EXISTS charmsg.activity (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  actor_uid text NOT NULL,
  action text NOT NULL,
  document_path text NOT NULL,
  old_value jsonb NOT NULL,
  new_value jsonb NOT NULL
);
ALTER TABLE charmsg.activity ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON charmsg.activity FROM PUBLIC;
CREATE INDEX IF NOT EXISTS activity_actor ON charmsg.activity(actor_uid, id DESC);
CREATE INDEX IF NOT EXISTS activity_path ON charmsg.activity(document_path, id DESC);

CREATE OR REPLACE FUNCTION charmsg.audit_document() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  actor text := current_setting('charmsg.actor',true);
  operation text := current_setting('charmsg.action',true);
  previous jsonb := '{}'::jsonb;
  following jsonb := '{}'::jsonb;
  document text;
  names text[] := ARRAY['coins','chr','ownerUid','ownerNick','rank','banned','banReason','banUntil','forSale','price','status','name','title'];
BEGIN
  IF TG_OP <> 'INSERT' THEN
    document := OLD.path;
    SELECT coalesce(jsonb_object_agg(key,value),'{}'::jsonb) INTO previous
      FROM jsonb_each(OLD.data) WHERE key = ANY(names);
  END IF;
  IF TG_OP <> 'DELETE' THEN
    document := NEW.path;
    SELECT coalesce(jsonb_object_agg(key,value),'{}'::jsonb) INTO following
      FROM jsonb_each(NEW.data) WHERE key = ANY(names);
  END IF;
  IF actor IS NOT NULL AND actor <> '' AND previous IS DISTINCT FROM following
    AND document !~ '^users/[^/]+/' THEN
    INSERT INTO charmsg.activity(actor_uid,action,document_path,old_value,new_value)
      VALUES(actor,operation,document,previous,following);
  END IF;
  RETURN NULL;
END
$$;
REVOKE ALL ON FUNCTION charmsg.audit_document() FROM PUBLIC;
DROP TRIGGER IF EXISTS audit_document ON charmsg.documents;
CREATE TRIGGER audit_document AFTER INSERT OR UPDATE OR DELETE ON charmsg.documents
  FOR EACH ROW EXECUTE FUNCTION charmsg.audit_document();

CREATE OR REPLACE FUNCTION charmsg.guard_reserved_nft() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.parent = 'users' AND EXISTS (
    SELECT 1 FROM charmsg.documents WHERE parent = 'offers'
      AND data->>'creatorUid' = split_part(OLD.path,'/',2) AND data->>'status' = 'open'
  ) THEN
    RAISE EXCEPTION 'Сначала отмените открытые офферы игрока.';
  END IF;
  IF OLD.parent = 'nfts' AND coalesce(OLD.data->>'tradeOfferId','') <> ''
    AND coalesce(current_setting('charmsg.action',true),'') NOT IN ('acceptOffer','cancelOffer') THEN
    RAISE EXCEPTION 'NFT зарезервирован в оффере. Сначала отмените оффер.';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION charmsg.guard_reserved_nft() FROM PUBLIC;
DROP TRIGGER IF EXISTS guard_reserved_nft ON charmsg.documents;
CREATE TRIGGER guard_reserved_nft BEFORE UPDATE OR DELETE ON charmsg.documents
  FOR EACH ROW EXECUTE FUNCTION charmsg.guard_reserved_nft();
