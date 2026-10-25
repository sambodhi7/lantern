import pg from 'pg';
import { readFileSync } from 'node:fs';

// One locked ledger snapshot preserves the existing accounting invariants across
// processes. Relational payment/evidence tables enforce unique external references.
export class Database {
  constructor(url) { this.pool = new pg.Pool({ connectionString: url, max: 5, connectionTimeoutMillis: 5000 }); }
  async init(trust, intents) {
    await this.pool.query(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
    await this.pool.query('INSERT INTO lantern_state (id, trust, intents) VALUES (1, $1, $2) ON CONFLICT DO NOTHING', [JSON.stringify(trust.data), JSON.stringify([...intents.values()])]);
  }
  async run(trust, intents, action) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: [row] } = await client.query('SELECT trust, intents FROM lantern_state WHERE id=1 FOR UPDATE');
      trust.data = row.trust;
      intents.clear(); for (const intent of row.intents) intents.set(intent.id, intent);
      const result = await action(client);
      await client.query('UPDATE lantern_state SET trust=$1, intents=$2, updated_at=now() WHERE id=1', [JSON.stringify(trust.data), JSON.stringify([...intents.values()])]);
      for (const intent of intents.values()) await client.query(`INSERT INTO payment_intents(id, campaign_id, amount_inr, status, provider_order_id, conversion_tx, escrow_tx, record)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO UPDATE SET status=excluded.status, provider_order_id=excluded.provider_order_id, conversion_tx=excluded.conversion_tx, escrow_tx=excluded.escrow_tx, record=excluded.record`,
      [intent.id, String(intent.campaignId), intent.amountInr, intent.status, intent.orderId || null, intent.conversionTx?.toLowerCase() || null, intent.escrowTx?.toLowerCase() || null, JSON.stringify(intent)]);
      await client.query('COMMIT');
      return result;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  async close() { await this.pool.end(); }
}
