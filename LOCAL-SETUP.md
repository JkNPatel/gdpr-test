# Local Setup & Testing Guide

## Prerequisites

- Node.js >= 18.x
- PostgreSQL installed locally
- Terminal access

## Step 1: Install PostgreSQL (if not installed)

### macOS (using Homebrew):
```bash
brew install postgresql@14
brew services start postgresql@14
```

### Verify PostgreSQL is running:
```bash
psql --version
# Should show: psql (PostgreSQL) 14.x
```

## Step 2: Create Test Database

```bash
# Connect to PostgreSQL as default user
psql postgres

# In PostgreSQL shell, run:
CREATE DATABASE product_b_test;
CREATE USER gdpr_test_user WITH PASSWORD 'test_password';
GRANT ALL PRIVILEGES ON DATABASE product_b_test TO gdpr_test_user;
\q
```

## Step 3: Setup Database Schema

```bash
# Run the schema SQL
psql -U gdpr_test_user -d product_b_test -f sql/schema.sql

# Enter password when prompted: test_password
```

## Step 4: Add Test Data

```bash
# Connect to database
psql -U gdpr_test_user -d product_b_test

# Add test users
INSERT INTO users (public_id, email, name) VALUES 
  ('test-user-123', 'test1@example.com', 'Test User 1'),
  ('test-user-456', 'test2@example.com', 'Test User 2');

-- Add related data
INSERT INTO user_events (user_id, event_type, event_data) 
SELECT id, 'login', '{"ip": "127.0.0.1"}'::jsonb FROM users WHERE public_id = 'test-user-123';

INSERT INTO user_events (user_id, event_type, event_data) 
SELECT id, 'page_view', '{"page": "/home"}'::jsonb FROM users WHERE public_id = 'test-user-123';

INSERT INTO user_preferences (user_id, preference_key, preference_value)
SELECT id, 'theme', 'dark' FROM users WHERE public_id = 'test-user-123';

-- Verify data
SELECT u.public_id, u.email, COUNT(e.id) as event_count 
FROM users u 
LEFT JOIN user_events e ON u.id = e.user_id 
GROUP BY u.public_id, u.email;

\q
```

## Step 5: Configure Environment

```bash
# Create local environment file
cp .env.example .env.local

# Edit .env.local with your actual credentials
# Required variables:
# - DB_URL: Full PostgreSQL connection string
# - AMPLITUDE_KEY: Your Amplitude API key
```

**Example `.env.local`:**
```bash
DB_URL=postgres://gdpr_test_user:test_password@localhost:5432/product_b_test?sslmode=disable
AMPLITUDE_KEY=your-amplitude-api-key
REQUESTED_BY=local-dev
DRY_RUN=true
IDS_JSON=ids.json
SQL_PATH=sql/gdpr-deletion.sql
```

Edit `.env` with your local settings:

```env
# Database (LOCAL)
PRODUCT_B_DB_HOST=localhost
PRODUCT_B_DB_PORT=5432
PRODUCT_B_DB_NAME=product_b_test
PRODUCT_B_DB_USER=gdpr_test_user
PRODUCT_B_DB_PASSWORD=test_password
PRODUCT_B_DB_SSL=false

# Amplitude (OPTIONAL - leave empty for testing)
AMPLITUDE_API_KEY=
AMPLITUDE_SECRET_KEY=

# Logging
LOG_LEVEL=info
LOG_DIR=./logs

# Worker
MAX_RETRIES=3
```

## Step 6: Install Dependencies

```bash
npm install
```

## Step 7: Run a Test Deletion (Dry Run)

```bash
# 1. Build the TypeScript code
npm install
npm run build

# 2. Create a test input file with user IDs
echo '["36797400", "36797401"]' > ids.json

========================================
GDPR DELETION SUMMARY
========================================
Request ID: a1b2c3d4-...
Requested By: local-test
Dry Run: true
Total Requested: 1
DB Rows Deleted: 4
Amplitude Deleted: 0
Successful: 1
Failed: 0
========================================

✅ Successfully deleted: test-user-123
```

### Test 2: Actual Deletion (Single User)

```bash
npx ts-node scripts/delete-users.ts \
  --publicIds=test-user-123 \
  --requestId=$(uuidgen) \
  --requestedBy=local-test \
  --dryRun=false
```

**Expected output:**
```
Deleted 4 rows for user test-user-123

========================================
GDPR DELETION SUMMARY
========================================
Request ID: ...
Total Requested: 1
DB Rows Deleted: 4
Successful: 1
Failed: 0
========================================

✅ Successfully deleted: test-user-123
```

### Test 3: Verify Deletion

```bash
# Connect to database
psql -U gdpr_test_user -d product_b_test

# Should return 0 rows
SELECT * FROM users WHERE public_id = 'test-user-123';

# Check audit log
SELECT * FROM gdpr_deletion_audit ORDER BY created_at DESC LIMIT 5;

\q
```

### Test 4: Multiple Users

```bash
npx ts-node scripts/delete-users.ts \
  --publicIds=test-user-123,test-user-456 \
  --requestId=$(uuidgen) \
  --requestedBy=local-test \
  --dryRun=false
```

### Test 5: Non-existent User (Error Handling)

```bash
npx ts-node scripts/delete-users.ts \
  --publicIds=nonexistent-user \
  --requestId=$(uuidgen) \
  --requestedBy=local-test \
  --dryRun=false
```

**Expected output:**
```
Failed: 1
❌ Failed: nonexistent-user: User not found
```

## Step 8: Check Logs

```bash
# View combined logs
cat logs/combined.log | tail -20

# View audit logs (for compliance)
cat logs/audit.log | tail -20

# View error logs
cat logs/error.log
```

## Troubleshooting

### "Connection refused" or "database does not exist"

**Solution:**
```bash
# Check if PostgreSQL is running
brew services list | grep postgresql

# Restart PostgreSQL
brew services restart postgresql@14

# Verify database exists
psql -U gdpr_test_user -d product_b_test -c "SELECT 1"
```

### "Permission denied" or "role does not exist"

**Solution:**
```bash
# Recreate user
psql postgres

DROP USER IF EXISTS gdpr_test_user;
CREATE USER gdpr_test_user WITH PASSWORD 'test_password';
GRANT ALL PRIVILEGES ON DATABASE product_b_test TO gdpr_test_user;

# Grant schema permissions
\c product_b_test
GRANT ALL ON SCHEMA public TO gdpr_test_user;
GRANT ALL ON ALL TABLES IN SCHEMA public TO gdpr_test_user;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO gdpr_test_user;

\q
```

### "Table does not exist"

**Solution:**
```bash
# Recreate tables
psql -U gdpr_test_user -d product_b_test -f sql/schema.sql
```

### "Invalid UUID" or validation errors

**Solution:**
```bash
# Generate valid UUID
uuidgen
# Use the output as requestId

# Or use the full command
npx ts-node scripts/delete-users.ts \
  --publicIds=test-user-123 \
  --requestId=$(uuidgen) \
  --requestedBy=local-test \
  --dryRun=true
```

## Quick Testing Script

Create a test script for convenience:

```bash
# Create test.sh
cat > test.sh << 'EOF'
#!/bin/bash

echo "🧪 Testing GDPR Deletion Script Locally"
echo "========================================"

# Generate UUID
REQUEST_ID=$(uuidgen)

echo "Request ID: $REQUEST_ID"
echo ""

# Run dry run first
echo "Running DRY RUN..."
npx ts-node scripts/delete-users.ts \
  --publicIds=test-user-123 \
  --requestId=$REQUEST_ID \
  --requestedBy=local-test \
  --dryRun=true

echo ""
read -p "Proceed with actual deletion? (y/n) " -n 1 -r
echo

if [[ $REPLY =~ ^[Yy]$ ]]
then
    echo "Running ACTUAL deletion..."
    npx ts-node scripts/delete-users.ts \
      --publicIds=test-user-123 \
      --requestId=$(uuidgen) \
      --requestedBy=local-test \
      --dryRun=false
fi
EOF

chmod +x test.sh
```

Run it:
```bash
./test.sh
```

## Re-populate Test Data

After testing, re-add test users:

```bash
psql -U gdpr_test_user -d product_b_test << 'EOF'
INSERT INTO users (public_id, email, name) VALUES 
  ('test-user-123', 'test1@example.com', 'Test User 1'),
  ('test-user-456', 'test2@example.com', 'Test User 2');

INSERT INTO user_events (user_id, event_type, event_data) 
SELECT id, 'login', '{"ip": "127.0.0.1"}'::jsonb FROM users WHERE public_id = 'test-user-123';

INSERT INTO user_preferences (user_id, preference_key, preference_value)
SELECT id, 'theme', 'dark' FROM users WHERE public_id = 'test-user-123';

SELECT 'Test data added!' as status;
EOF
```

## Testing with Amplitude (Optional)

If you want to test Amplitude integration:

1. Get Amplitude API credentials from: https://analytics.amplitude.com
2. Add to `.env`:
   ```env
   AMPLITUDE_API_KEY=your-api-key
   AMPLITUDE_SECRET_KEY=your-secret-key
   ```
3. Run deletion (it will call Amplitude API)

**Note:** In dry run mode, Amplitude is not called.

## Next Steps

Once local testing works:
1. ✅ Commit code to Git
2. ✅ Set up Jenkins job (see JENKINS-SETUP.md)
3. ✅ Test via Jenkins
4. ✅ Integrate into Product A

## Summary

**Quick test command:**
```bash
# 1. Setup database (one-time)
psql -U gdpr_test_user -d product_b_test -f sql/schema.sql

# 2. Add test data
psql -U gdpr_test_user -d product_b_test -c "INSERT INTO users (public_id, email, name) VALUES ('test-user-123', 'test@example.com', 'Test User');"

# 3. Test dry run
npx ts-node scripts/delete-users.ts \
  --publicIds=test-user-123 \
  --requestId=$(uuidgen) \
  --requestedBy=local-test \
  --dryRun=true

# 4. Test actual deletion
npx ts-node scripts/delete-users.ts \
  --publicIds=test-user-123 \
  --requestId=$(uuidgen) \
  --requestedBy=local-test \
  --dryRun=false
```

You're all set! 🎉
