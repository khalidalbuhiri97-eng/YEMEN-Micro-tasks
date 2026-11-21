CREATE OR REPLACE FUNCTION yt_coin.reject_immutable_record_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = ''
AS $function$
BEGIN
  RAISE EXCEPTION 'YT Coin audit records are append-only and cannot be changed or deleted.';
END;
$function$;

DROP TRIGGER IF EXISTS yt_coin_ledger_immutable ON yt_coin.ledger;
CREATE TRIGGER yt_coin_ledger_immutable
BEFORE UPDATE OR DELETE ON yt_coin.ledger
FOR EACH ROW EXECUTE FUNCTION yt_coin.reject_immutable_record_mutation();

DROP TRIGGER IF EXISTS yt_coin_mining_claims_immutable ON yt_coin.mining_claims;
CREATE TRIGGER yt_coin_mining_claims_immutable
BEFORE UPDATE OR DELETE ON yt_coin.mining_claims
FOR EACH ROW EXECUTE FUNCTION yt_coin.reject_immutable_record_mutation();

DROP TRIGGER IF EXISTS yt_coin_audit_log_immutable ON yt_coin.audit_log;
CREATE TRIGGER yt_coin_audit_log_immutable
BEFORE UPDATE OR DELETE ON yt_coin.audit_log
FOR EACH ROW EXECUTE FUNCTION yt_coin.reject_immutable_record_mutation();

REVOKE ALL ON FUNCTION yt_coin.reject_immutable_record_mutation() FROM PUBLIC, anon, authenticated;
