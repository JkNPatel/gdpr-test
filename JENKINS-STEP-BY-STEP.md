# Jenkins Setup - Step by Step Guide

## Prerequisites
- Access to Jenkins with admin/job creation permissions
- Git repository with your code (push the code first)
- Database credentials ready

---

## Part 1: Push Code to Git (If not done yet)

```bash
cd /Users/jaykumar/Desktop/gdpr-demo

# Initialize git if needed
git init

# Add all files
git add .

# Commit
git commit -m "GDPR deletion service - Jenkins only"

# Add your remote repository
git remote add origin https://github.com/your-org/gdpr-deletion.git
# OR for internal git:
# git remote add origin https://git.company.com/your-team/gdpr-deletion.git

# Push to main branch
git push -u origin main
```

---

## Part 2: Create Jenkins Job

### Step 1: Open Jenkins

Go to your Jenkins URL: `https://your-jenkins.company.com`

### Step 2: Create New Item

1. Click **"New Item"** (top left)
2. Enter item name: `gdpr-user-deletion`
3. Select **"Pipeline"**
4. Click **"OK"**

---

## Part 3: Configure Job Settings

### Step 1: General Configuration

In the job configuration page:

**✅ Description:**
```
GDPR user deletion service - Deletes users from Product B database and Amplitude
Triggered by Product A on demand
```

**✅ Check these options:**
- ☑ "Discard old builds"
  - Days to keep builds: `365`
  - Max # of builds to keep: `100`

**✅ Parameters:**
- ☑ "This project is parameterized"

Click **"Add Parameter"** → **"String Parameter"** for each:

| Name | Default Value | Description |
|------|---------------|-------------|
| `PUBLIC_IDS` | *(leave empty)* | Comma-separated list of user IDs to delete |
| `REQUESTED_BY` | *(leave empty)* | Who requested the deletion (e.g., product-a) |
| `REQUEST_ID` | *(leave empty)* | UUID for this deletion request |
| `REASON` | *(leave empty)* | Optional reason for deletion |

Click **"Add Parameter"** → **"Boolean Parameter"**:

| Name | Default Value | Description |
|------|---------------|-------------|
| `DRY_RUN` | `false` | If true, simulates deletion without deleting |

### Step 2: Pipeline Configuration

Scroll down to **"Pipeline"** section:

**Definition:** Select **"Pipeline script from SCM"**

**SCM:** Select **"Git"**

**Repository URL:** 
```
https://github.com/your-org/gdpr-deletion.git
```
*(Or your internal git URL)*

**Credentials:** 
- If public repo: leave as "- none -"
- If private repo: Click **"Add"** → **"Jenkins"** → Add your Git credentials

**Branches to build:**
```
*/main
```
*(or */master if that's your branch)*

**Script Path:**
```
Jenkinsfile
```

**✅ Click "Save"**

---

## Part 4: Add Database Credentials

### Step 1: Go to Credentials

From Jenkins home:
1. Click **"Manage Jenkins"** (left sidebar)
2. Click **"Credentials"**
3. Click **"System"**
4. Click **"Global credentials (unrestricted)"**

### Step 2: Add Each Credential

Click **"Add Credentials"** and fill in:

#### Credential 1: Database Host
- **Kind:** Secret text
- **Scope:** Global
- **Secret:** `your-database-host.com` *(e.g., db.company.com or localhost)*
- **ID:** `product-b-db-host`
- **Description:** Product B Database Host
- Click **"OK"**

#### Credential 2: Database Port
- **Kind:** Secret text
- **Scope:** Global
- **Secret:** `5432` *(or your port)*
- **ID:** `product-b-db-port`
- **Description:** Product B Database Port
- Click **"OK"**

#### Credential 3: Database Name
- **Kind:** Secret text
- **Scope:** Global
- **Secret:** `product_b` *(your actual database name)*
- **ID:** `product-b-db-name`
- **Description:** Product B Database Name
- Click **"OK"**

#### Credential 4: Database User
- **Kind:** Secret text
- **Scope:** Global
- **Secret:** `gdpr_deletion_user` *(your DB user)*
- **ID:** `product-b-db-user`
- **Description:** Product B Database User
- Click **"OK"**

#### Credential 5: Database Password
- **Kind:** Secret text
- **Scope:** Global
- **Secret:** `your-secure-password` *(actual password)*
- **ID:** `product-b-db-password`
- **Description:** Product B Database Password
- Click **"OK"**

#### Credential 6: Amplitude API Key (Optional)
- **Kind:** Secret text
- **Scope:** Global
- **Secret:** `your-amplitude-api-key` *(or leave empty for testing)*
- **ID:** `amplitude-api-key`
- **Description:** Amplitude API Key
- Click **"OK"**

#### Credential 7: Amplitude Secret Key (Optional)
- **Kind:** Secret text
- **Scope:** Global
- **Secret:** `your-amplitude-secret-key` *(or leave empty for testing)*
- **ID:** `amplitude-secret-key`
- **Description:** Amplitude Secret Key
- Click **"OK"**

**✅ You should now have 7 credentials added**

---

## Part 5: Test the Pipeline

### Step 1: Manual Test with Parameters

1. Go back to your job: `gdpr-user-deletion`
2. Click **"Build with Parameters"** (left sidebar)
3. Fill in the parameters:

```
PUBLIC_IDS: test-user-123
REQUESTED_BY: manual-test
REQUEST_ID: (click "Generate UUID" or use: a1b2c3d4-5678-90ab-cdef-123456789012)
DRY_RUN: ✅ (check this box for safety)
REASON: Testing Jenkins pipeline
```

4. Click **"Build"**

### Step 2: Watch the Build

1. Build will appear in **"Build History"** (bottom left)
2. Click on the build number (e.g., #1)
3. Click **"Console Output"** to see logs

**Expected output:**
```
========================================
GDPR DELETION SUMMARY
========================================
Request ID: ...
Total Requested: 1
DB Rows Deleted: X
Successful: 1
Failed: 0
========================================
```

### Step 3: Check for Success

Build should show:
- **Blue ball** or **Green checkmark** = ✅ Success
- **Red ball** = ❌ Failed (check console output for errors)

---

## Part 6: Generate Jenkins API Token

For Product A to trigger this job, you need an API token.

### Step 1: Create API Token

1. Click your **username** (top right)
2. Click **"Configure"**
3. Scroll to **"API Token"** section
4. Click **"Add new Token"**
5. Enter name: `product-a-gdpr-trigger`
6. Click **"Generate"**
7. **COPY THE TOKEN** (you won't see it again!)
   - Example: `11e8f3b4a5c2d1234567890abcdef123`

### Step 2: Save Token Securely

Store this in Product A's environment variables:
```env
JENKINS_URL=https://jenkins.company.com
JENKINS_USER=your-jenkins-username
JENKINS_API_TOKEN=11e8f3b4a5c2d1234567890abcdef123
```

---

## Part 7: Test from Product A (or Command Line)

### Test with curl:

```bash
curl -X POST \
  "https://jenkins.company.com/job/gdpr-user-deletion/buildWithParameters" \
  -u "your-username:your-api-token" \
  --data-urlencode "PUBLIC_IDS=test-user-456" \
  --data-urlencode "REQUESTED_BY=product-a" \
  --data-urlencode "REQUEST_ID=$(uuidgen)" \
  --data-urlencode "DRY_RUN=true" \
  --data-urlencode "REASON=Testing API trigger"
```

**Expected response:**
- HTTP Status: `201 Created`
- Location header with queue URL

---

## Troubleshooting

### Issue: "Build fails immediately"

**Check:**
1. Git repository URL is correct
2. Jenkinsfile exists in repo root
3. Branch name is correct (main vs master)

### Issue: "Cannot connect to database"

**Check:**
1. All 5 database credentials are added correctly
2. Credential IDs match exactly (case-sensitive):
   - `product-b-db-host`
   - `product-b-db-port`
   - `product-b-db-name`
   - `product-b-db-user`
   - `product-b-db-password`
3. Jenkins can reach database (network/firewall)

### Issue: "npm install fails"

**Check:**
1. Jenkins agent has Node.js installed
2. Jenkins agent has internet access (for npm packages)

### Issue: "Permission denied"

**Check:**
1. Database user has DELETE permissions:
   ```sql
   GRANT DELETE ON ALL TABLES IN SCHEMA public TO gdpr_deletion_user;
   ```

---

## Quick Reference Card

### Job Details
- **Job Name:** `gdpr-user-deletion`
- **Type:** Pipeline
- **Git Script:** `Jenkinsfile`

### Required Parameters
1. `PUBLIC_IDS` - User IDs to delete (comma-separated)
2. `REQUESTED_BY` - Requester identifier
3. `REQUEST_ID` - UUID (must be unique)
4. `DRY_RUN` - true/false
5. `REASON` - Optional description

### Required Credentials (7 total)
1. `product-b-db-host`
2. `product-b-db-port`
3. `product-b-db-name`
4. `product-b-db-user`
5. `product-b-db-password`
6. `amplitude-api-key`
7. `amplitude-secret-key`

### API Trigger URL
```
POST https://jenkins.company.com/job/gdpr-user-deletion/buildWithParameters
Authorization: Basic base64(username:api-token)
```

---

## Next Steps After Setup

1. ✅ Test with DRY_RUN=true first
2. ✅ Run actual deletion test
3. ✅ Verify deletion in database
4. ✅ Check audit logs
5. ✅ Share API token with Product A team
6. ✅ Document runbook for ops team

---

## Need Help?

- **Jenkins logs:** Click build → Console Output
- **Database verification:** Use the SQL queries in LOCAL-SETUP.md
- **Audit trail:** Check `logs/audit.log` in Jenkins artifacts

**You're all set!** 🎉
