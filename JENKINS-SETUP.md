# Jenkins-Only GDPR Deletion Setup

## ✅ **$0 Extra Cost - No Server/Hosting Required**

This solution uses **only Jenkins** to run GDPR deletions on-demand. No 24/7 API server needed!

---

## Architecture

```
Product A → Jenkins API (trigger job) → Script runs → Database + Amplitude → Job completes
              ↑
         Already exists!
         NO extra hosting cost
```

**How it works:**
1. Product A makes HTTP request to Jenkins API
2. Jenkins receives trigger and starts job
3. Job runs Node.js script (`scripts/delete-users.ts`)
4. Script deletes from DB + Amplitude
5. Script exits, Jenkins returns results
6. **No persistent server - only runs when triggered**

---

## Setup Steps

### 1. Create Jenkins Job

1. Go to Jenkins: `https://your-jenkins.company.com`
2. Click "New Item"
3. Name: `gdpr-user-deletion`
4. Type: **Pipeline**
5. Click "OK"

### 2. Configure Jenkins Job

**General Settings:**
- ✅ Check "This project is parameterized"
- Add these **String Parameters**:
  - `PUBLIC_IDS` (required)
  - `REQUESTED_BY` (required)
  - `REQUEST_ID` (required)
  - `REASON` (optional)
- Add **Boolean Parameter**:
  - `DRY_RUN` (default: false)

**Pipeline Settings:**
- Definition: **Pipeline script from SCM**
- SCM: **Git**
- Repository URL: Your repo URL
- Script Path: `Jenkinsfile`

### 3. Store Credentials in Jenkins

Go to Jenkins → Credentials → Add Credentials:

```
ID: product-b-db-host
Type: Secret text
Secret: your-database-host

ID: product-b-db-name
Type: Secret text
Secret: product_b

ID: product-b-db-user
Type: Secret text
Secret: gdpr_deletion_user

ID: product-b-db-password
Type: Secret text
Secret: your-secure-password

ID: amplitude-api-key
Type: Secret text
Secret: your-amplitude-key

ID: amplitude-secret-key
Type: Secret text
Secret: your-amplitude-secret
```

### 4. Deploy Code to Jenkins

**Option A: Git Repository (Recommended)**
```bash
# Commit code to your repo
git add .
git commit -m "Add GDPR deletion script"
git push origin main
```

**Option B: Direct Copy**
```bash
# Copy files to Jenkins workspace
scp -r gdpr-demo jenkins-server:/var/lib/jenkins/workspace/gdpr-user-deletion/
```

---

## How Product A Triggers Jenkins

### Authentication

Create Jenkins API token:
1. Jenkins → User → Configure
2. API Token → Generate New Token
3. Copy token (use as password)

### Trigger Job from Product A

**Method 1: Using fetch/axios (Recommended)**

```javascript
// In Product A code
const { v4: uuidv4 } = require('uuid');

async function triggerGDPRDeletion(publicIds, requestedBy, reason = '') {
  const requestId = uuidv4();
  
  // Jenkins credentials
  const jenkinsUrl = 'https://jenkins.company.com';
  const jenkinsUser = 'api-user';
  const jenkinsToken = 'your-jenkins-api-token';
  
  // Create Basic Auth header
  const auth = Buffer.from(`${jenkinsUser}:${jenkinsToken}`).toString('base64');
  
  try {
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
          REQUESTED_BY: requestedBy,
          REQUEST_ID: requestId,
          DRY_RUN: 'false',
          REASON: reason,
        }),
      }
    );
    
    if (response.status === 201) {
      console.log(`✅ GDPR deletion job triggered: ${requestId}`);
      
      // Get queue item location
      const queueUrl = response.headers.get('Location');
      
      return {
        success: true,
        requestId,
        queueUrl,
        message: 'Job queued successfully',
      };
    } else {
      throw new Error(`Jenkins returned ${response.status}`);
    }
  } catch (error) {
    console.error('Failed to trigger GDPR deletion:', error);
    return {
      success: false,
      error: error.message,
    };
  }
}

// Usage
const result = await triggerGDPRDeletion(
  ['user123', 'user456'],
  'product-a',
  'User requested deletion'
);

console.log(result);
```

**Method 2: Using curl**

```bash
curl -X POST \
  "https://jenkins.company.com/job/gdpr-user-deletion/buildWithParameters" \
  -u "api-user:jenkins-api-token" \
  --data-urlencode "PUBLIC_IDS=user123,user456" \
  --data-urlencode "REQUESTED_BY=product-a" \
  --data-urlencode "REQUEST_ID=550e8400-e29b-41d4-a716-446655440000" \
  --data-urlencode "DRY_RUN=false" \
  --data-urlencode "REASON=User GDPR request"
```

---

## Check Job Status

### Get Build Number from Queue

```javascript
async function getBuildNumber(queueUrl, jenkinsUser, jenkinsToken) {
  const auth = Buffer.from(`${jenkinsUser}:${jenkinsToken}`).toString('base64');
  
  // Poll queue until build starts
  for (let i = 0; i < 30; i++) {
    const response = await fetch(`${queueUrl}api/json`, {
      headers: { 'Authorization': `Basic ${auth}` },
    });
    
    const data = await response.json();
    
    if (data.executable) {
      return data.executable.number; // Build number
    }
    
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  
  throw new Error('Build did not start in time');
}
```

### Check Build Status

```javascript
async function checkBuildStatus(buildNumber, jenkinsUser, jenkinsToken) {
  const auth = Buffer.from(`${jenkinsUser}:${jenkinsToken}`).toString('base64');
  
  const response = await fetch(
    `https://jenkins.company.com/job/gdpr-user-deletion/${buildNumber}/api/json`,
    {
      headers: { 'Authorization': `Basic ${auth}` },
    }
  );
  
  const data = await response.json();
  
  return {
    building: data.building,
    result: data.result, // SUCCESS, FAILURE, ABORTED, etc.
    duration: data.duration,
    description: data.description,
    url: data.url,
  };
}
```

### Get Console Output (Results)

```javascript
async function getConsoleOutput(buildNumber, jenkinsUser, jenkinsToken) {
  const auth = Buffer.from(`${jenkinsUser}:${jenkinsToken}`).toString('base64');
  
  const response = await fetch(
    `https://jenkins.company.com/job/gdpr-user-deletion/${buildNumber}/consoleText`,
    {
      headers: { 'Authorization': `Basic ${auth}` },
    }
  );
  
  const output = await response.text();
  
  // Parse the summary section
  const summaryMatch = output.match(/========================================\n(.*?\n)*?========================================/s);
  
  return {
    fullOutput: output,
    summary: summaryMatch ? summaryMatch[0] : 'Summary not found',
  };
}
```

---

## Complete Product A Integration Example

```javascript
// product-a/services/gdpr-deletion.service.js

const { v4: uuidv4 } = require('uuid');

class GDPRDeletionService {
  constructor() {
    this.jenkinsUrl = process.env.JENKINS_URL;
    this.jenkinsUser = process.env.JENKINS_USER;
    this.jenkinsToken = process.env.JENKINS_API_TOKEN;
  }

  async deleteUsers(publicIds, requestedBy, reason = '') {
    const requestId = uuidv4();
    
    console.log(`Triggering GDPR deletion for ${publicIds.length} users`);
    
    // 1. Trigger Jenkins job
    const trigger = await this.triggerJob(publicIds, requestedBy, requestId, reason);
    
    if (!trigger.success) {
      throw new Error(`Failed to trigger deletion: ${trigger.error}`);
    }
    
    // 2. Wait for build to start
    const buildNumber = await this.waitForBuild(trigger.queueUrl);
    
    console.log(`Job started: Build #${buildNumber}`);
    
    // 3. Poll for completion
    const status = await this.waitForCompletion(buildNumber);
    
    // 4. Get results
    const results = await this.getResults(buildNumber);
    
    return {
      requestId,
      buildNumber,
      status: status.result,
      summary: results.summary,
      logsUrl: `${this.jenkinsUrl}/job/gdpr-user-deletion/${buildNumber}`,
    };
  }

  async triggerJob(publicIds, requestedBy, requestId, reason) {
    const auth = Buffer.from(`${this.jenkinsUser}:${this.jenkinsToken}`).toString('base64');
    
    try {
      const response = await fetch(
        `${this.jenkinsUrl}/job/gdpr-user-deletion/buildWithParameters`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            PUBLIC_IDS: publicIds.join(','),
            REQUESTED_BY: requestedBy,
            REQUEST_ID: requestId,
            DRY_RUN: 'false',
            REASON: reason,
          }),
        }
      );
      
      if (response.status === 201) {
        return {
          success: true,
          queueUrl: response.headers.get('Location'),
        };
      }
      
      throw new Error(`Jenkins returned ${response.status}`);
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async waitForBuild(queueUrl, timeoutSeconds = 30) {
    const auth = Buffer.from(`${this.jenkinsUser}:${this.jenkinsToken}`).toString('base64');
    
    for (let i = 0; i < timeoutSeconds; i++) {
      const response = await fetch(`${queueUrl}api/json`, {
        headers: { 'Authorization': `Basic ${auth}` },
      });
      
      const data = await response.json();
      
      if (data.executable) {
        return data.executable.number;
      }
      
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    
    throw new Error('Build did not start within timeout');
  }

  async waitForCompletion(buildNumber, timeoutMinutes = 10) {
    const auth = Buffer.from(`${this.jenkinsUser}:${this.jenkinsToken}`).toString('base64');
    const timeoutMs = timeoutMinutes * 60 * 1000;
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeoutMs) {
      const response = await fetch(
        `${this.jenkinsUrl}/job/gdpr-user-deletion/${buildNumber}/api/json`,
        {
          headers: { 'Authorization': `Basic ${auth}` },
        }
      );
      
      const data = await response.json();
      
      if (!data.building) {
        return data;
      }
      
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    
    throw new Error('Build did not complete within timeout');
  }

  async getResults(buildNumber) {
    const auth = Buffer.from(`${this.jenkinsUser}:${this.jenkinsToken}`).toString('base64');
    
    const response = await fetch(
      `${this.jenkinsUrl}/job/gdpr-user-deletion/${buildNumber}/consoleText`,
      {
        headers: { 'Authorization': `Basic ${auth}` },
      }
    );
    
    const output = await response.text();
    const summaryMatch = output.match(/========================================\n(.*?\n)*?========================================/s);
    
    return {
      summary: summaryMatch ? summaryMatch[0] : output,
      fullOutput: output,
    };
  }
}

module.exports = new GDPRDeletionService();

// Usage in Product A:
// const gdprService = require('./services/gdpr-deletion.service');
// 
// const result = await gdprService.deleteUsers(
//   ['user123', 'user456'],
//   'product-a',
//   'User requested GDPR deletion'
// );
// 
// console.log(result);
```

---

## Testing

### 1. Test with Dry Run

```bash
curl -X POST \
  "https://jenkins.company.com/job/gdpr-user-deletion/buildWithParameters" \
  -u "api-user:token" \
  --data-urlencode "PUBLIC_IDS=test-user-123" \
  --data-urlencode "REQUESTED_BY=test" \
  --data-urlencode "REQUEST_ID=$(uuidgen)" \
  --data-urlencode "DRY_RUN=true"
```

### 2. Check Jenkins Console

Go to: `https://jenkins.company.com/job/gdpr-user-deletion/lastBuild/console`

Look for:
```
========================================
GDPR DELETION SUMMARY
========================================
Request ID: ...
DB Rows Deleted: 156
Successful: 2
Failed: 0
========================================
```

---

## Security

### Jenkins Security Best Practices

1. **Use API Tokens** (not passwords)
2. **Restrict Job Permissions**:
   - Only specific users can trigger job
   - Use Jenkins Role-Based Access Control

3. **Network Security**:
   - Jenkins accessible only from Product A IP
   - Use HTTPS for Jenkins

4. **Credential Management**:
   - Store all credentials in Jenkins Credential Store
   - Never hardcode credentials

5. **Audit Logging**:
   - Jenkins logs all job triggers
   - Archive logs for 365 days

---

## Cost Comparison

| Solution | Monthly Cost |
|----------|--------------|
| **Jenkins-only (this)** | **$0** |
| Hosted API (AWS EC2 t3.micro) | $10-15 |
| Hosted API (AWS ECS Fargate) | $15-30 |
| Serverless (AWS Lambda + API Gateway) | $5-20 |
| Managed service (Heroku) | $25-50 |

**Winner: Jenkins-only = $0** ✅

---

## Troubleshooting

### "Failed to trigger job"
- ✅ Check Jenkins URL is correct
- ✅ Verify API token is valid
- ✅ Ensure user has "Build" permission

### "Job queued but never starts"
- ✅ Check Jenkins executor availability
- ✅ Verify Jenkins agent is online

### "Database connection failed"
- ✅ Check credentials in Jenkins Credential Store
- ✅ Verify network connectivity from Jenkins to DB

### "Build takes too long"
- ✅ Check console output for which user is slow
- ✅ Verify database performance
- ✅ Check Amplitude API rate limits

---

## Next Steps

1. ✅ Create Jenkins job with Jenkinsfile
2. ✅ Store credentials in Jenkins
3. ✅ Test with dry run
4. ✅ Integrate into Product A
5. ✅ Monitor first few real deletions
6. ✅ Document runbook for ops team

**You're done! No servers to maintain, no extra costs!** 🎉
