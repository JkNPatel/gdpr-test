import { Pool, ClientConfig } from "pg";
import { readFile } from "node:fs/promises";

export type RunSqlOptions = {
  sqlPath: string;
  ids: string[];
  chunkSize?: number;          // Users per transaction (for very large sets)
  statementTimeoutMs?: number; // Safety guard
};

/**
 * Executes GDPR deletion SQL using a temporary table pattern for scalability.
 * This avoids giant IN(...) clauses and works efficiently with any number of IDs.
 */
export async function runGdprSqlWithTempTable(
  pgConfig: ClientConfig,
  options: RunSqlOptions
): Promise<void> {
  const {
    sqlPath,
    ids,
    chunkSize = Infinity, // Default: all IDs in one transaction
    statementTimeoutMs = 300_000, // 5 minutes
  } = options;

  const pool = new Pool({
    ...pgConfig,
    max: 2, // Keep small; Jenkins job is single-tenant
    statement_timeout: statementTimeoutMs,
  });

  try {
    // Process IDs in chunks if needed (for very large sets)
    for (let start = 0; start < ids.length; start += chunkSize) {
      const slice = ids.slice(start, start + chunkSize);
      const client = await pool.connect();
      
      try {
        await client.query("BEGIN");
        
        // Create temp table (session-scoped, auto-dropped on commit)
        await client.query(`
          CREATE TEMP TABLE ids_to_delete (
            user_id text PRIMARY KEY
          ) ON COMMIT DROP
        `);

        // Bulk load IDs using UNNEST (efficient for up to ~50k IDs)
        await client.query(
          `INSERT INTO ids_to_delete (user_id)
           SELECT * FROM UNNEST($1::text[])`,
          [slice]
        );

        // Execute the reviewed GDPR deletion SQL
        const sql = await readFile(sqlPath, "utf8");
        await client.query(sql);

        await client.query("COMMIT");
        
        console.log(`✓ Processed chunk: ${slice.length} users (offset ${start})`);
      } catch (err) {
        // Rollback on any error
        await safeRollback(client);
        throw err;
      } finally {
        client.release();
      }
    }
  } finally {
    await pool.end();
  }
}

async function safeRollback(client: any) {
  try {
    await client.query("ROLLBACK");
  } catch {
    // Ignore rollback errors
  }
}
