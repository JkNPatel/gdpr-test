# Use the official Jenkins LTS image as a base
FROM jenkins/jenkins:lts

# Switch to the root user to install packages
USER root

# Install dependencies: Node.js, npm, and other build tools
RUN apt-get update && apt-get install -y \
    curl \
    gnupg \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs

# Install pnpm globally using npm
RUN npm install -g pnpm

# Switch back to the jenkins user
USER jenkins
