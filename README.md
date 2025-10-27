# GDPR Deletion Service - Jenkins Only

## ✅ **NO Server Required - $0 Extra Cost**

This solution uses **ONLY your existing Jenkins** infrastructure. No API server, no hosting, no extra costs!

---

## Quick Answer: Do I Need Hosting?

### ❌ **NO!** You don't need:
- ❌ Web server running 24/7
- ❌ AWS EC2 instance
- ❌ Docker hosting
- ❌ Heroku/Netlify/any hosting service
- ❌ Database (except Product B's existing one)
- ❌ Redis or any cache
- ❌ Load balancer
- ❌ Domain name

### ✅ **YES!** You only need:
- ✅ Jenkins (which you already have)
- ✅ Product B database access (already exists)
- ✅ Amplitude API credentials (optional)

---

## How It Works

```
┌─────────────┐
│  Product A  │  Sends GDPR deletion request
└──────┬──────┘
       │ HTTP POST with publicIds
       │ (using Jenkins API token)
       ↓
┌─────────────────────────────────────────┐
│         Jenkins (Already exists!)       │
│  • Receives trigger                     │
│  • Validates parameters                 │
│  • Runs script on-demand                │
└──────┬──────────────────────────────────┘
       │
       │ Executes: scripts/delete-users.ts
       │
       ↓
┌──────────────────┐    ┌─────────────────┐
│  Product B DB    │───→│  Amplitude API  │
│  (delete users)  │    │  (delete events)│
└──────────────────┘    └─────────────────┘
       │
       │ Script completes and exits
       ↓
┌─────────────────────────────────────────┐
│  Jenkins job finishes                   │
│  • Logs archived                        │
│  • Results in console output            │
│  • NO persistent process running        │
└─────────────────────────────────────────┘
```

**Key Point:** The script only runs when triggered. When finished, it exits. Nothing runs 24/7!

---

## Setup (One-Time, 15 minutes)

### 1. Push Code to Git Repository

```bash
cd /Users/jaykumar/Desktop/gdpr-demo
git init
git add .
git commit -m "GDPR deletion script for Jenkins"
git remote add origin https://your-git-repo.git
git push -u origin main
```

### 2. Create Jenkins Job

1. Open Jenkins: `https://your-jenkins.company.com`
2. Click **"New Item"**
3. Name: `gdpr-user-deletion`
4. Type: **Pipeline**
5. Click **"OK"**

In Pipeline configuration:
- **Definition:** Pipeline script from SCM
- **SCM:** Git
- **Repository URL:** (your git repo URL)
- **Script Path:** `Jenkinsfile`

Click **"Save"**

### 3. Add Credentials to Jenkins

Jenkins → Manage Jenkins → Credentials → Add Credentials:

| Credential ID | Type | Value |
|---------------|------|-------|
| `product-b-db-host` | Secret text | Your DB host |
| `product-b-db-name` | Secret text | `product_b` |
| `product-b-db-user` | Secret text | `gdpr_deletion_user` |
| `product-b-db-password` | Secret text | Your DB password |
| `product-b-db-port` | Secret text | `5432` |
| `amplitude-api-key` | Secret text | Your Amplitude key |
| `amplitude-secret-key` | Secret text | Your Amplitude secret |

### 4. Create Jenkins API Token

1. Jenkins → Your Username → Configure
2. **API Token** → Click "Add new Token"
3. Copy the token (you'll use this in Product A)

**Done!** ✅ No server to set up, no hosting to configure.

---

## How Product A Triggers It

### Simple Example (Node.js)

```javascript
const fetch = require('node-fetch');
const { v4: uuidv4 } = require('uuid');

async function deleteUsersViaJenkins(publicIds) {
  const jenkinsUrl = 'https://jenkins.company.com';
  const jenkinsUser = 'api-user';
  const jenkinsToken = 'your-jenkins-api-token';
  const requestId = uuidv4();
  
  // Create Basic Auth
  const auth = Buffer.from(`${jenkinsUser}:${jenkinsToken}`).toString('base64');
  
  // Trigger Jenkins job
  const response = await fetch(
    `${jenkinsUrl}/job/gdpr-user-deletion/buildWithParameters`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        PUBLIC_IDS: publicIds.join(','),
        REQUESTED_BY: 'product-a',
        REQUEST_ID: requestId,
        DRY_RUN: 'false',
      }),
    }
  );
  
  if (response.status === 201) {
    console.log(`✅ Deletion job queued: ${requestId}`);
    return { success: true, requestId };
  } else {
    console.error('❌ Failed to trigger job');
    return { success: false };
  }
}

// Usage
await deleteUsersViaJenkins(['user123', 'user456']);
```

### Using curl

```bash
curl -X POST \
  "https://jenkins.company.com/job/gdpr-user-deletion/buildWithParameters" \
  -u "api-user:jenkins-token" \
  --data-urlencode "PUBLIC_IDS=user123,user456" \
  --data-urlencode "REQUESTED_BY=product-a" \
  --data-urlencode "REQUEST_ID=$(uuidgen)" \
  --data-urlencode "DRY_RUN=false"
```

---

## What Happens When Job Runs

1. **Jenkins starts the job** (takes ~2 seconds)
2. **Script installs dependencies** (first run only, ~10 seconds)
3. **Script connects to database** (~1 second)
4. **For each user:**
   - Deletes from database in transaction
   - Calls Amplitude API
   - Logs results
5. **Script prints summary:**
   ```
   ========================================
   GDPR DELETION SUMMARY
   ========================================
   Request ID: a1b2c3d4-...
   Total Requested: 2
   DB Rows Deleted: 156
   Amplitude Deleted: 2
   Successful: 2
   Failed: 0
   ========================================
   ```
6. **Script exits** (job finishes)
7. **Logs archived** in Jenkins
8. **Nothing left running** ✅

**Total time:** Usually 5-30 seconds depending on number of users.

---

## Testing

### 1. Test Manually in Jenkins

1. Go to Jenkins job: `gdpr-user-deletion`
2. Click **"Build with Parameters"**
3. Fill in:
   - PUBLIC_IDS: `test-user-123`
   - REQUESTED_BY: `manual-test`
   - REQUEST_ID: (generate UUID)
   - DRY_RUN: ✅ **true**
4. Click **"Build"**
5. Watch console output

You should see:
```
✅ GDPR DELETION JOB SUCCEEDED
DB Rows Deleted: X
Successful: 1
```

### 2. Test from Product A

```javascript
// Test with dry run first
const result = await fetch(
  'https://jenkins.company.com/job/gdpr-user-deletion/buildWithParameters',
  {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + Buffer.from('user:token').toString('base64'),
    },
    body: new URLSearchParams({
      PUBLIC_IDS: 'test-user',
      REQUESTED_BY: 'product-a-test',
      REQUEST_ID: uuidv4(),
      DRY_RUN: 'true',
    }),
  }
);

console.log(result.status); // Should be 201
```

---

## Monitoring

### Check Job Status

**In Jenkins UI:**
- Go to `https://jenkins.company.com/job/gdpr-user-deletion`
- Click on build number (e.g., #42)
- Click **"Console Output"**
- See full logs and summary

**Via API:**
```javascript
const buildNumber = 42;
const response = await fetch(
  `https://jenkins.company.com/job/gdpr-user-deletion/${buildNumber}/api/json`,
  {
    headers: {
      'Authorization': 'Basic ' + Buffer.from('user:token').toString('base64'),
    },
  }
);

const data = await response.json();
console.log(data.result); // SUCCESS, FAILURE, etc.
```

### View Logs

Logs are archived in Jenkins for 365 days:
- Combined logs: Build Artifacts → `logs/combined.log`
- Audit logs: Build Artifacts → `logs/audit.log`
- Error logs: Build Artifacts → `logs/error.log`

---

## Cost Breakdown

| Item | Cost |
|------|------|
| Jenkins | **$0** (already have it) |
| Node.js runtime | **$0** (runs on Jenkins agent) |
| Script execution | **$0** (uses existing compute) |
| Database | **$0** (Product B DB already exists) |
| Amplitude API | **$0** (already have it) |
| Hosting/Server | **$0** (no server needed!) |
| Domain/SSL | **$0** (not needed) |
| Load balancer | **$0** (not needed) |
| **TOTAL** | **$0** ✅ |

Compare to alternatives:
- AWS EC2 t3.micro: ~$10/month
- AWS ECS Fargate: ~$20/month
- Heroku Basic: $25/month
- DigitalOcean Droplet: $12/month

**Savings: $120-300/year!** 💰

---

## Security

### How is this secure?

1. **Authentication:** Jenkins API token required
2. **Authorization:** Only users with Jenkins permissions can trigger
3. **Network:** Jenkins already behind your firewall
4. **Credentials:** Stored in Jenkins Credential Store (encrypted)
5. **Audit:** All triggers logged in Jenkins
6. **IP Restrictions:** Configure Jenkins to only accept from Product A's IP

### Jenkins Security Checklist

- ✅ Enable authentication
- ✅ Use API tokens (not passwords)
- ✅ Limit who can build jobs
- ✅ Use HTTPS for Jenkins
- ✅ Store credentials securely
- ✅ Archive logs for compliance

---

## FAQ

### Q: Does this scale?

**A:** Yes! Jenkins can handle:
- Multiple concurrent deletion requests (queues them)
- Large batches (100 users per request)
- Thousands of requests per day

If you need more throughput, add more Jenkins executors.

### Q: What if Jenkins is down?

**A:** Product A should:
1. Retry after 30 seconds
2. Log failed trigger attempts
3. Alert ops team
4. Queue deletions for later

### Q: Can I see real-time progress?

**A:** Yes! Poll Jenkins API:
```javascript
// Check if job is still running
const response = await fetch(
  `https://jenkins.company.com/job/gdpr-user-deletion/${buildNumber}/api/json`
);
const data = await response.json();
console.log(data.building); // true = still running
```

### Q: What about idempotency?

**A:** Use the `REQUEST_ID` parameter:
- Generate UUID in Product A
- Pass same UUID if retrying
- Check Jenkins job history by description to avoid duplicates

### Q: Can I run multiple deletions at once?

**A:** Yes! Jenkins queues them and processes in order. Or configure multiple executors to run in parallel.

---

## Files You Need

```
gdpr-demo/
├── scripts/
│   └── delete-users.ts        # Main deletion script
├── sql/
│   └── schema.sql             # Database schema
├── Jenkinsfile                # Jenkins pipeline config
├── package.json               # Node dependencies
├── tsconfig.json              # TypeScript config
└── JENKINS-SETUP.md           # This file

NO server files!
NO Dockerfile needed!
NO docker-compose.yml!
NO API routes!
```

---

## Next Steps

1. ✅ Push code to Git
2. ✅ Create Jenkins job
3. ✅ Add credentials
4. ✅ Test with dry run
5. ✅ Integrate into Product A
6. ✅ Monitor first few deletions
7. ✅ Celebrate saving $120-300/year! 🎉

---

## Summary

**You asked:** "Do I need to host this anywhere or require a server?"

**Answer:** 🎉 **NO!** 🎉

- ✅ Use only Jenkins (which you already have)
- ✅ Script runs on-demand when triggered
- ✅ Nothing runs 24/7
- ✅ $0 extra infrastructure cost
- ✅ Production-ready and secure

**This is the simplest, most cost-effective solution!**

For detailed setup instructions, see `JENKINS-SETUP.md`.
