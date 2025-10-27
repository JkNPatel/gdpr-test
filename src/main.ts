#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import crypto from "node:crypto";
import { runGdprSqlWithTempTable } from "./db.js";
import { deleteUsersAmplitude } from "./amplitude.js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

type GdprReport = {
  requestId: string;
  requestedBy: string;
  dryRun: boolean;
  startedAt: string;
  finishedAt?: string;
  input: {
    totalIds: number;
    uniqueIds: number;
  };
  database: {
    status: "success" | "failed";
    error?: string;
  };
  amplitude: {
    successful: number;
    failed: number;
    results: any[];
  };
};

async function main() {
  const startTime = Date.now();
  
  // Read configuration from environment
  const idsPath = process.env.IDS_JSON || "ids.json";
  const sqlPath = process.env.SQL_PATH || "sql/gdpr-deletion.sql";
  const dbUrl = requireEnv("DB_URL");
  const amplitudeKey = requireEnv("AMPLITUDE_KEY");
  const requestId = process.env.REQUEST_ID || crypto.randomUUID();
  const requestedBy = process.env.REQUESTED_BY || "unknown";
  const dryRun = process.env.DRY_RUN === "true";

  console.log("=".repeat(60));
  console.log("GDPR User Deletion Job Started");
  console.log("=".repeat(60));
  console.log(`Request ID: ${requestId}`);
  console.log(`Requested By: ${requestedBy}`);
  console.log(`Dry Run: ${dryRun}`);
  console.log(`Started At: ${new Date().toISOString()}`);
  console.log("=".repeat(60));

  // Initialize report
  const report: GdprReport = {
    requestId,
    requestedBy,
    dryRun,
    startedAt: new Date().toISOString(),
    input: { totalIds: 0, uniqueIds: 0 },
    database: { status: "success" },
    amplitude: { successful: 0, failed: 0, results: [] },
  };

  // Handle graceful shutdown
  let aborted = false;
  process.on("SIGTERM", () => {
    console.warn("⚠ Received SIGTERM, shutting down gracefully...");
    aborted = true;
  });
  process.on("SIGINT", () => {
    console.warn("⚠ Received SIGINT, shutting down gracefully...");
    aborted = true;
  });

  try {
    // Read and validate input IDs
    console.log(`\n[1/3] Reading input from ${idsPath}...`);
    const rawContent = await readFile(idsPath, "utf8");
    const parsedIds = JSON.parse(rawContent);

    if (!Array.isArray(parsedIds)) {
      throw new Error("Input must be a JSON array of user IDs");
    }

    if (parsedIds.length === 0) {
      throw new Error("Input array is empty");
    }

    // Deduplicate IDs
    const allIds = [...new Set(parsedIds.map(String))];
    report.input.totalIds = parsedIds.length;
    report.input.uniqueIds = allIds.length;

    console.log(`✓ Loaded ${report.input.uniqueIds} unique IDs (${report.input.totalIds} total)`);

    if (aborted) {
      throw new Error("Job aborted before database step");
    }

    // Step 1: Database deletions
    console.log(`\n[2/3] Executing database deletions...`);
    console.log(`SQL File: ${sqlPath}`);
    
    try {
      await runGdprSqlWithTempTable(
        { connectionString: dbUrl },
        {
          sqlPath,
          ids: allIds,
          chunkSize: Number(process.env.DB_CHUNK_SIZE || Infinity),
          statementTimeoutMs: Number(process.env.DB_STMT_TIMEOUT_MS || 300_000),
        }
      );
      report.database.status = "success";
      console.log("✓ Database deletions completed successfully");
    } catch (err: any) {
      report.database.status = "failed";
      report.database.error = err.message;
      throw new Error(`Database deletion failed: ${err.message}`);
    }

    if (aborted) {
      throw new Error("Job aborted after database step");
    }

    // Step 2: Amplitude deletions
    console.log(`\n[3/3] Executing Amplitude deletions...`);
    
    const amplitudeResults = await deleteUsersAmplitude(allIds, amplitudeKey, {
      batchSize: Number(process.env.AMP_BATCH_SIZE || 300),
      concurrentBatches: Number(process.env.AMP_CONCURRENCY || 4),
      maxAttempts: Number(process.env.AMP_MAX_ATTEMPTS || 5),
    });

    report.amplitude.results = amplitudeResults;
    report.amplitude.successful = amplitudeResults.filter((r) => r.ok).length;
    report.amplitude.failed = amplitudeResults.filter((r) => !r.ok).length;

    console.log(`✓ Amplitude deletions completed`);
    console.log(`  - Successful: ${report.amplitude.successful}`);
    console.log(`  - Failed: ${report.amplitude.failed}`);

  } catch (err: any) {
    console.error(`\n❌ Fatal error: ${err.message}`);
    report.finishedAt = new Date().toISOString();
    
    // Write error report
    await writeFile("report.json", JSON.stringify(report, null, 2));
    await writeFile(
      "summary.txt",
      `GDPR Deletion FAILED\n` +
      `Request ID: ${requestId}\n` +
      `Error: ${err.message}\n` +
      `Duration: ${((Date.now() - startTime) / 1000).toFixed(1)}s\n`
    );
    
    process.exit(1);
  }

  // Success: finalize report
  report.finishedAt = new Date().toISOString();
  
  await writeFile("report.json", JSON.stringify(report, null, 2));
  await writeFile(
    "summary.txt",
    `GDPR Deletion Summary\n` +
    `${"=".repeat(60)}\n` +
    `Request ID: ${requestId}\n` +
    `Requested By: ${requestedBy}\n` +
    `Dry Run: ${dryRun}\n` +
    `Total IDs: ${report.input.uniqueIds}\n` +
    `Database: ${report.database.status}\n` +
    `Amplitude Success: ${report.amplitude.successful}\n` +
    `Amplitude Failed: ${report.amplitude.failed}\n` +
    `Duration: ${((Date.now() - startTime) / 1000).toFixed(1)}s\n` +
    `${"=".repeat(60)}\n`
  );

  console.log("\n" + "=".repeat(60));
  console.log("✅ GDPR Deletion Job Completed Successfully");
  console.log("=".repeat(60));
  console.log(`Duration: ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
  console.log("=".repeat(60));

  // Exit with code 2 if there were any Amplitude failures
  if (report.amplitude.failed > 0) {
    console.warn(`⚠ Warning: ${report.amplitude.failed} Amplitude deletions failed`);
    process.exit(2);
  }

  process.exit(0);
}

// Run the main function
main().catch(async (err) => {
  console.error("Unexpected error:", err);
  await writeFile("summary.txt", `FATAL ERROR: ${err.message || err}`);
  process.exit(1);
});
