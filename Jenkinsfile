// GDPR User Deletion - Jenkins Pipeline
// No server/hosting required - runs on-demand only

pipeline {
    agent {
        dockerfile {
            filename 'Dockerfile.Jenkinsfile'
        }
    }
    
    tools {
        docker 'DefaultDocker'
    }
    
    parameters {
        string(
            name: 'PUBLIC_IDS',
            description: 'Comma-separated list of user public IDs to delete',
            defaultValue: ''
        )
        string(
            name: 'REQUESTED_BY',
            description: 'Identity of requester (e.g., product-a, admin)',
            defaultValue: ''
        )
        string(
            name: 'REQUEST_ID',
            description: 'UUID for this deletion request',
            defaultValue: ''
        )
        booleanParam(
            name: 'DRY_RUN',
            description: 'If true, simulates deletion without actually deleting',
            defaultValue: false
        )
        string(
            name: 'REASON',
            description: 'Optional reason for deletion',
            defaultValue: ''
        )
    }
    
    environment {
        // Load from Jenkins credentials store
        PRODUCT_B_DB_HOST = credentials('product-b-db-host')
        PRODUCT_B_DB_PORT = credentials('product-b-db-port')
        PRODUCT_B_DB_NAME = credentials('product-b-db-name')
        PRODUCT_B_DB_USER = credentials('product-b-db-user')
        PRODUCT_B_DB_PASSWORD = credentials('product-b-db-password')
        PRODUCT_B_DB_SSL = 'true'
        
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
        stage('Validate Parameters') {
            steps {
                script {
                    echo '========================================='
                    echo 'GDPR User Deletion Job'
                    echo '========================================='
                    echo "Request ID: ${params.REQUEST_ID}"
                    echo "Requested By: ${params.REQUESTED_BY}"
                    echo "Public IDs: ${params.PUBLIC_IDS}"
                    echo "Dry Run: ${params.DRY_RUN}"
                    echo '========================================='
                    
                    // Validate required parameters
                    if (!params.REQUEST_ID) {
                        error('REQUEST_ID parameter is required')
                    }
                    if (!params.PUBLIC_IDS) {
                        error('PUBLIC_IDS parameter is required')
                    }
                    if (!params.REQUESTED_BY) {
                        error('REQUESTED_BY parameter is required')
                    }
                    
                    // Validate UUID format
                    if (!params.REQUEST_ID.matches(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)) {
                        error('REQUEST_ID must be a valid UUID')
                    }
                    
                    currentBuild.description = "${params.DRY_RUN ? '[DRY RUN] ' : ''}${params.REQUEST_ID}"
                }
            }
        }
        
        stage('Build') {
            steps {
                script {
                    echo 'Installing dependencies and building...'
                    // Use npm ci for deterministic installs (like pnpm --frozen-lockfile)
                    sh 'npm ci'
                    // Compile TypeScript to JavaScript
                    // Use --package=typescript to avoid the fake 'tsc' package
                    sh 'npx --package=typescript tsc'
                }
            }
        }
        
        stage('Execute Deletion Script') {
            steps {
                script {
                    echo 'Running GDPR deletion script...'
                    
                    // Run the COMPILED JavaScript (not TypeScript)
                    def exitCode = sh(
                        script: """
                            node dist/scripts/delete-users.js \
                                --publicIds="${params.PUBLIC_IDS}" \
                                --requestId="${params.REQUEST_ID}" \
                                --requestedBy="${params.REQUESTED_BY}" \
                                --dryRun=${params.DRY_RUN}
                        """,
                        returnStatus: true
                    )
                    
                    if (exitCode != 0) {
                        error("Deletion script failed with exit code: ${exitCode}")
                    }
                    
                    echo '✅ Deletion script completed successfully'
                }
            }
        }
        
        stage('Archive Logs') {
            steps {
                script {
                    echo 'Archiving audit logs...'
                    
                    archiveArtifacts(
                        artifacts: 'logs/**/*.log',
                        allowEmptyArchive: true,
                        fingerprint: true
                    )
                    
                    echo 'Logs archived successfully'
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
