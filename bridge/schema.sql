CREATE TABLE IF NOT EXISTS lantern_state (
  id smallint PRIMARY KEY CHECK(id=1),
  trust jsonb NOT NULL,
  intents jsonb NOT NULL DEFAULT '[]',
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS payment_intents (
  id uuid PRIMARY KEY,
  campaign_id text NOT NULL,
  amount_inr bigint NOT NULL CHECK(amount_inr>0),
  status text NOT NULL CHECK(status IN ('checkout_open','converted_to_account','escrowed')),
  provider_order_id text UNIQUE,
  conversion_tx text UNIQUE,
  escrow_tx text UNIQUE,
  record jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS evidence (
  id uuid PRIMARY KEY,
  ngo_id text NOT NULL,
  document_hash text NOT NULL,
  encrypted_original bytea NOT NULL,
  encrypted_analysis bytea NOT NULL,
  public_record jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS evidence_document_hash ON evidence(document_hash);
