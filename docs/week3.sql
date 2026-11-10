-- Week 3: run in the Neon SQL editor if `npm run db:push` fails.
ALTER TABLE countries ADD COLUMN IF NOT EXISTS capital_move_province_id uuid;
ALTER TABLE countries ADD COLUMN IF NOT EXISTS capital_move_at timestamptz;

CREATE TABLE IF NOT EXISTS production_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  country_id uuid NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
  province_id uuid NOT NULL REFERENCES provinces(id) ON DELETE CASCADE,
  unit_type text NOT NULL,
  position integer NOT NULL,
  completes_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS production_orders_province_idx ON production_orders (province_id, position);
CREATE INDEX IF NOT EXISTS production_orders_due_idx ON production_orders (completes_at);
