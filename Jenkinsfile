// GDPR Assessment User Deletion - Jenkins Pipeline

pipeline {
    agent any
    
    parameters {
        text(
            name: 'PUBLIC_IDS_JSON',
            description: 'JSON array of user public IDs to delete, e.g., ["public_id_1", "public_id_2"]',
            defaultValue: '[]'
        )
        string(
            name: 'REQUESTED_BY',
            description: 'Identity of requester (e.g., product-a, admin)',
            defaultValue: ''
        )
        string(
            name: 'REQUEST_ID',
            description: 'UUID for this deletion request (auto-generated if empty)',
            defaultValue: ''
        )
        booleanParam(
            name: 'DRY_RUN',
            description: 'If true, simulates deletion without actually deleting',
            defaultValue: false
        )
        string(
            name: 'DB_CHUNK_SIZE',
            description: 'Users per DB transaction (leave empty for no chunking)',
            defaultValue: ''
        )
        string(
            name: 'AMP_BATCH_SIZE',
            description: 'Amplitude batch size',
            defaultValue: '300'
        )
        string(
            name: 'AMP_CONCURRENCY',
            description: 'Concurrent Amplitude batches',
            defaultValue: '4'
        )
    }
    
    environment {
        // Load from Jenkins credentials store
        PRODUCT_B_DB_HOST = credentials('product-b-db-host')
        PRODUCT_B_DB_PORT = credentials('product-b-db-port')
        PRODUCT_B_DB_NAME = credentials('product-b-db-name')
        PRODUCT_B_DB_USER = credentials('product-b-db-user')
        PRODUCT_B_DB_PASSWORD = credentials('product-b-db-password')
        PRODUCT_B_DB_SSL = 'false'
        
        AMPLITUDE_API_KEY = credentials('amplitude-api-key')
        AMPLITUDE_SECRET_KEY = credentials('amplitude-secret-key')
        
        LOG_DIR = './logs'
        MAX_RETRIES = '3'
        NODE_ENV = 'production'
    }
    
    options {
        timeout(time: 1, unit: 'HOURS')
        timestamps()
        buildDiscarder(logRotator(
            numToKeepStr: '100',
            daysToKeepStr: '365',
            artifactDaysToKeepStr: '365'
        ))
    }
    
    stages {
        stage('Validate Input') {
            steps {
                script {
                    echo '========================================='
                    echo 'GDPR User Deletion Job'
                    echo '========================================='
                    echo "Requested By: ${params.REQUESTED_BY}"
                    echo "Public IDs: ${params.PUBLIC_IDS_JSON}"
                    echo "Request ID: ${params.REQUEST_ID ?: 'auto-generated'}"
                    echo "Dry Run: ${params.DRY_RUN}"
                    echo '========================================='
                    
                    // Validate required parameters
                    if (!params.REQUESTED_BY) {
                        error('REQUESTED_BY parameter is required')
                    }
                    
                    def idsText = params.PUBLIC_IDS_JSON.trim()
                    if (!idsText || idsText == '[]') {
                        error('PUBLIC_IDS_JSON parameter is required and must be a non-empty array')
                    }
                    
                    // Write IDs to file for validation
                    writeFile file: 'ids.json', text: idsText
                    
                    // Validate JSON format
                    sh '''
                        node -e "const ids = JSON.parse(require('fs').readFileSync('ids.json', 'utf8')); \
                                if (!Array.isArray(ids) || ids.length === 0) \
                                throw new Error('ids.json must be a non-empty array');"
                    '''
                    
                    // Set build description
                    def reqId = params.REQUEST_ID ?: 'auto'
                    currentBuild.description = "${params.DRY_RUN ? '[DRY RUN] ' : ''}${reqId}"
                }
            }
        }
        
        stage('Build') {
            steps {
                script {
                    echo 'Installing dependencies and building...'
                    // Use npm ci for deterministic installs (like pnpm --frozen-lockfile)
                    sh 'npm ci --include=dev'
                    // Compile TypeScript to JavaScript
                    // Use --package=typescript to avoid the fake 'tsc' package
                    sh 'npx --package=typescript tsc'
                }
            }
        }
        
        stage('Execute GDPR Deletion') {
            steps {
                script {
                    echo 'Running GDPR deletion job...'
                    
                    // Run the production-grade CLI
                    def exitCode = sh(
                        script: """
                            IDS_JSON=ids.json \
                            SQL_PATH="sql/gdpr-deletion.sql" \
                            REQUESTED_BY="${params.REQUESTED_BY}" \
                            REQUEST_ID="${params.REQUEST_ID}" \
                            DRY_RUN="${params.DRY_RUN}" \
                            DB_CHUNK_SIZE="${params.DB_CHUNK_SIZE}" \
                            AMP_BATCH_SIZE="${params.AMP_BATCH_SIZE}" \
                            AMP_CONCURRENCY="${params.AMP_CONCURRENCY}" \
                            node dist/main.js
                        """,
                        returnStatus: true
                    )
                    
                    if (exitCode == 2) {
                        unstable('Some Amplitude deletions failed - see report.json')
                    } else if (exitCode != 0) {
                        error("GDPR deletion job failed with exit code: ${exitCode}")
                    }
                    
                    echo '✅ GDPR deletion job completed'
                }
            }
        }
        
        stage('Archive Artifacts') {
            steps {
                script {
                    echo 'Archiving deletion reports and artifacts...'
                    
                    archiveArtifacts(
                        artifacts: 'report.json,summary.txt,ids.json,sql/gdpr-deletion.sql,logs/**/*.log',
                        allowEmptyArchive: true,
                        fingerprint: true
                    )
                    
                    echo 'Artifacts archived successfully'
                }
            }
        }
    }
    
    post {
        success {
            script {
                echo '✅ ========================================='
                echo '✅ GDPR DELETION JOB SUCCEEDED'
                echo '✅ ========================================='
                echo "Request ID: ${params.REQUEST_ID}"
                echo "Public IDs processed: ${params.PUBLIC_IDS}"
                echo "View logs in Jenkins artifacts"
                echo '✅ ========================================='
                
                // Optional: Send success notification
                // emailext subject: "✅ GDPR Deletion Success: ${params.REQUEST_ID}",
                //          body: "Request ${params.REQUEST_ID} completed successfully",
                //          to: "${env.NOTIFICATION_EMAIL}"
            }
        }
        
        failure {
            script {
                echo '❌ ========================================='
                echo '❌ GDPR DELETION JOB FAILED'
                echo '❌ ========================================='
                echo "Request ID: ${params.REQUEST_ID}"
                echo "Public IDs processed: ${params.PUBLIC_IDS}"
                echo "Check console output for errors"
                echo '❌ ========================================='
                
                // Send failure notification
                emailext(
                    subject: "⚠️ GDPR Deletion Failed: ${params.REQUEST_ID}",
                    body: """
                        <h2>GDPR Deletion Job Failed</h2>
                        <p><strong>Request ID:</strong> ${params.REQUEST_ID}</p>
                        <p><strong>Requested By:</strong> ${params.REQUESTED_BY}</p>
                        <p><strong>Public IDs:</strong> ${params.PUBLIC_IDS}</p>
                        <p><strong>Build URL:</strong> <a href="${env.BUILD_URL}">${env.BUILD_URL}</a></p>
                        <p><strong>Console Output:</strong> <a href="${env.BUILD_URL}console">${env.BUILD_URL}console</a></p>
                        
                        <h3>Action Required</h3>
                        <p>Please review the logs and retry if necessary.</p>
                    """,
                    to: '${NOTIFICATION_EMAIL}',
                    mimeType: 'text/html'
                )
            }
        }
        
        always {
            script {
                echo "Job completed at: ${new Date()}"
                echo "Duration: ${currentBuild.durationString}"
            }
        }
    }
}
