FROM node:22-alpine3.21

RUN apk update && \
    apk add \
        git \
        zip \
        jq \
        bash \
        curl \
        make \
        g++ \
        python3

# Install pnpm
RUN npm install -g pnpm@latest-10

# Create and configure a Python virtual environment
RUN python3 -m venv /venv && \
    . /venv/bin/activate && \
    pip install --upgrade pip && \
    pip install --no-cache-dir awscli

# Set the virtual environment's Python and pip as default
ENV PATH="/venv/bin:/usr/local/bin:$PATH"

RUN addgroup jenkins && adduser -D -s /bin/ash -G jenkins jenkins

USER jenkins