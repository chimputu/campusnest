-- Payments (Phase 2: MTN MoMo sandbox)
CREATE TABLE payments (
  id           SERIAL PRIMARY KEY,
  request_id   INT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  payer_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_zmw   INT NOT NULL CHECK (amount_zmw > 0),
  currency     TEXT NOT NULL DEFAULT 'ZMW',
  provider     TEXT NOT NULL DEFAULT 'MTN_MOMO',
  reference_id TEXT UNIQUE NOT NULL,
  external_id  TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'PENDING',
  phone        TEXT NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX payments_request_idx ON payments(request_id);
CREATE INDEX payments_payer_idx ON payments(payer_id);
CREATE TRIGGER payments_set_updated_at BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION set_updated_at();
