#!/usr/bin/env ts-node
/**
 * GDPR User Deletion Script
 * Triggered by Jenkins - No server required
 */

import { Pool } from 'pg';
import axios from 'axios';
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import * as winston from 'winston';

// ==================== Configuration ====================

interface Config {
  database: {
    host: string;
    port: number;
    name: string;
    user: string;
    password: string;
    ssl: boolean;
  };
  amplitude: {
    apiKey: string;
    secretKey: string;
  };
  logDir: string;
  maxRetries: number;
}

function loadConfig(): Config {
  return {
    database: {
      host: process.env.PRODUCT_B_DB_HOST || 'localhost',
      port: parseInt(process.env.PRODUCT_B_DB_PORT || '5432', 10),
      name: process.env.PRODUCT_B_DB_NAME || 'product_b',
      user: process.env.PRODUCT_B_DB_USER || 'postgres',
      password: process.env.PRODUCT_B_DB_PASSWORD || '',
      ssl: process.env.PRODUCT_B_DB_SSL === 'true',
    },
    amplitude: {
      apiKey: process.env.AMPLITUDE_API_KEY || '',
      secretKey: process.env.AMPLITUDE_SECRET_KEY || '',
    },
    logDir: process.env.LOG_DIR || path.join(process.cwd(), 'logs'),
    maxRetries: parseInt(process.env.MAX_RETRIES || '3', 10),
  };
}

// ==================== Logger Setup ====================

function setupLogger(logDir: string, requestId: string): winston.Logger {
  // Ensure log directory exists
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.json()
    ),
    defaultMeta: { requestId },
    transports: [
      new winston.transports.File({
        filename: path.join(logDir, 'error.log'),
        level: 'error',
      }),
      new winston.transports.File({
        filename: path.join(logDir, 'combined.log'),
      }),
      new winston.transports.File({
        filename: path.join(logDir, 'audit.log'),
        level: 'info',
      }),
      new winston.transports.Console({
        format: winston.format.simple(),
      }),
    ],
  });

  return logger;
}

// ==================== Validation Schema ====================

const argsSchema = z.object({
  publicIds: z.array(z.string().min(1).max(255)),
  requestedBy: z.string().min(1).max(255),
  requestId: z.string().uuid(),
  dryRun: z.boolean(),
  reason: z.string().optional(),
});

type DeletionArgs = z.infer<typeof argsSchema>;

// ==================== Database Service ====================

class DatabaseService {
  private pool: Pool;
  private logger: winston.Logger;

  constructor(config: Config['database'], logger: winston.Logger) {
    this.logger = logger;
    this.pool = new Pool({
      host: config.host,
      port: config.port,
      database: config.name,
      user: config.user,
      password: config.password,
      ssl: config.ssl ? { rejectUnauthorized: false } : false,
      max: 10,
    });
  }

  async deleteUser(
    publicId: string,
    requestId: string,
    requestedBy: string,
    dryRun: boolean
  ): Promise<{ success: boolean; rowsDeleted: number; error?: string }> {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      // Check if user exists
      const checkResult = await client.query(
        'SELECT id FROM users WHERE public_id = $1',
        [publicId]
      );

      if (checkResult.rowCount === 0) {
        await client.query('ROLLBACK');
        return { success: false, rowsDeleted: 0, error: 'User not found' };
      }

      const userId = checkResult.rows[0].id;
      let totalRowsDeleted = 0;

      if (dryRun) {
        // Count what would be deleted
        const eventCount = await client.query(
          'SELECT COUNT(*) FROM user_events WHERE user_id = $1',
          [userId]
        );
        const prefCount = await client.query(
          'SELECT COUNT(*) FROM user_preferences WHERE user_id = $1',
          [userId]
        );
        const sessCount = await client.query(
          'SELECT COUNT(*) FROM user_sessions WHERE user_id = $1',
          [userId]
        );

        totalRowsDeleted =
          parseInt(eventCount.rows[0].count) +
          parseInt(prefCount.rows[0].count) +
          parseInt(sessCount.rows[0].count) +
          1; // user row

        this.logger.info(`[DRY RUN] Would delete ${totalRowsDeleted} rows for ${publicId}`);
        await client.query('ROLLBACK');
        return { success: true, rowsDeleted: totalRowsDeleted };
      }

      // Delete related records
      const eventsResult = await client.query(
        'DELETE FROM user_events WHERE user_id = $1',
        [userId]
      );
      totalRowsDeleted += eventsResult.rowCount || 0;

      const prefsResult = await client.query(
        'DELETE FROM user_preferences WHERE user_id = $1',
        [userId]
      );
      totalRowsDeleted += prefsResult.rowCount || 0;

      const sessResult = await client.query(
        'DELETE FROM user_sessions WHERE user_id = $1',
        [userId]
      );
      totalRowsDeleted += sessResult.rowCount || 0;

      // Delete user
      const userResult = await client.query(
        'DELETE FROM users WHERE id = $1',
        [userId]
      );
      totalRowsDeleted += userResult.rowCount || 0;

      // Insert audit record
      await client.query(
        `INSERT INTO gdpr_deletion_audit 
         (public_id, request_id, deleted_by, rows_affected, notes)
         VALUES ($1, $2, $3, $4, $5)`,
        [publicId, requestId, requestedBy, totalRowsDeleted, `Deleted ${totalRowsDeleted} rows`]
      );

      await client.query('COMMIT');

      this.logger.info(`Deleted ${totalRowsDeleted} rows for user ${publicId}`, {
        publicId,
        rowsDeleted: totalRowsDeleted,
      });

      return { success: true, rowsDeleted: totalRowsDeleted };
    } catch (error: any) {
      await client.query('ROLLBACK');
      this.logger.error(`Database deletion failed for ${publicId}`, {
        error: error.message,
      });
      return { success: false, rowsDeleted: 0, error: error.message };
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

// ==================== Amplitude Service ====================

class AmplitudeService {
  private apiKey: string;
  private secretKey: string;
  private logger: winston.Logger;
  private maxRetries: number;

  constructor(
    apiKey: string,
    secretKey: string,
    maxRetries: number,
    logger: winston.Logger
  ) {
    this.apiKey = apiKey;
    this.secretKey = secretKey;
    this.maxRetries = maxRetries;
    this.logger = logger;
  }

  async deleteUser(
    publicId: string,
    dryRun: boolean
  ): Promise<{ success: boolean; error?: string }> {
    if (!this.apiKey || !this.secretKey) {
      this.logger.warn('Amplitude credentials not configured, skipping');
      return { success: true }; // Not an error if not configured
    }

    if (dryRun) {
      this.logger.info(`[DRY RUN] Would delete user ${publicId} from Amplitude`);
      return { success: true };
    }

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await axios.post(
          'https://amplitude.com/api/2/deletions/users',
          {
            user_ids: [publicId],
            requester: 'gdpr-deletion-script',
          },
          {
            auth: {
              username: this.apiKey,
              password: this.secretKey,
            },
            headers: {
              'Content-Type': 'application/json',
            },
          }
        );

        if (response.status === 200) {
          this.logger.info(`Amplitude deletion successful for ${publicId}`);
          return { success: true };
        }
      } catch (error: any) {
        this.logger.warn(`Amplitude deletion attempt ${attempt} failed for ${publicId}`, {
          error: error.message,
        });

        if (attempt < this.maxRetries) {
          // Exponential backoff
          await new Promise((resolve) => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
        }
      }
    }

    return { success: false, error: 'Max retries exceeded' };
  }
}

// ==================== Main Deletion Logic ====================

async function executeDeleteions(args: DeletionArgs): Promise<void> {
  const config = loadConfig();
  const logger = setupLogger(config.logDir, args.requestId);

  logger.info('GDPR Deletion Script Started', {
    requestId: args.requestId,
    publicIdsCount: args.publicIds.length,
    requestedBy: args.requestedBy,
    dryRun: args.dryRun,
  });

  const dbService = new DatabaseService(config.database, logger);
  const amplitudeService = new AmplitudeService(
    config.amplitude.apiKey,
    config.amplitude.secretKey,
    config.maxRetries,
    logger
  );

  const results = {
    successful: [] as string[],
    failed: [] as Array<{ publicId: string; error: string }>,
  };

  let totalDbRowsDeleted = 0;
  let totalAmplitudeDeleted = 0;

  try {
    for (const publicId of args.publicIds) {
      logger.info(`Processing user: ${publicId}`);

      // Step 1: Delete from database
      const dbResult = await dbService.deleteUser(
        publicId,
        args.requestId,
        args.requestedBy,
        args.dryRun
      );

      if (!dbResult.success) {
        results.failed.push({
          publicId,
          error: dbResult.error || 'Database deletion failed',
        });
        continue;
      }

      totalDbRowsDeleted += dbResult.rowsDeleted;

      // Step 2: Delete from Amplitude (only if DB succeeded)
      const ampResult = await amplitudeService.deleteUser(publicId, args.dryRun);

      if (ampResult.success) {
        totalAmplitudeDeleted++;
      } else {
        logger.warn(`Amplitude deletion failed for ${publicId} but DB deletion succeeded`);
      }

      results.successful.push(publicId);
    }

    // Summary
    const summary = {
      totalRequested: args.publicIds.length,
      dbRowsDeleted: totalDbRowsDeleted,
      amplitudeDeleted: totalAmplitudeDeleted,
      successful: results.successful.length,
      failed: results.failed.length,
    };

    logger.info('GDPR Deletion Completed', summary);

    // Print summary to console (Jenkins will capture this)
    console.log('\n========================================');
    console.log('GDPR DELETION SUMMARY');
    console.log('========================================');
    console.log(`Request ID: ${args.requestId}`);
    console.log(`Requested By: ${args.requestedBy}`);
    console.log(`Dry Run: ${args.dryRun}`);
    console.log(`Total Requested: ${summary.totalRequested}`);
    console.log(`DB Rows Deleted: ${summary.dbRowsDeleted}`);
    console.log(`Amplitude Deleted: ${summary.amplitudeDeleted}`);
    console.log(`Successful: ${summary.successful}`);
    console.log(`Failed: ${summary.failed}`);
    console.log('========================================\n');

    if (results.successful.length > 0) {
      console.log('✅ Successfully deleted:', results.successful.join(', '));
    }

    if (results.failed.length > 0) {
      console.log('❌ Failed:', results.failed.map((f) => `${f.publicId}: ${f.error}`).join(', '));
    }

    // Exit with appropriate code
    const exitCode = results.failed.length > 0 ? 1 : 0;
    process.exit(exitCode);
  } catch (error: any) {
    logger.error('Fatal error during deletion', {
      error: error.message,
      stack: error.stack,
    });
    console.error('❌ Fatal error:', error.message);
    process.exit(1);
  } finally {
    await dbService.close();
  }
}

// ==================== CLI Argument Parsing ====================

function parseArgs(): DeletionArgs {
  const args: any = {
    publicIds: [],
    requestedBy: '',
    requestId: '',
    dryRun: false,
  };

  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];

    if (arg.startsWith('--publicIds=')) {
      args.publicIds = arg.split('=')[1].split(',').map((id) => id.trim());
    } else if (arg.startsWith('--requestedBy=')) {
      args.requestedBy = arg.split('=')[1];
    } else if (arg.startsWith('--requestId=')) {
      args.requestId = arg.split('=')[1];
    } else if (arg.startsWith('--dryRun=')) {
      args.dryRun = arg.split('=')[1] === 'true';
    } else if (arg.startsWith('--reason=')) {
      args.reason = arg.split('=')[1];
    }
  }

  // Validate args
  const result = argsSchema.safeParse(args);

  if (!result.success) {
    console.error('❌ Invalid arguments:');
    console.error(result.error.errors);
    console.error('\nUsage:');
    console.error('  ts-node delete-users.ts \\');
    console.error('    --publicIds=user1,user2,user3 \\');
    console.error('    --requestId=<uuid> \\');
    console.error('    --requestedBy=<requester> \\');
    console.error('    --dryRun=<true|false>');
    process.exit(1);
  }

  return result.data;
}

// ==================== Entry Point ====================

if (require.main === module) {
  const args = parseArgs();
  executeDeleteions(args);
}
