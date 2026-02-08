#!/bin/bash

# Lambda Build Script
# Builds all lambda functions with their dependencies

set -e  # Exit on any error

# Color codes for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Store the root directory
ROOT_DIR=$(pwd)
LAMBDA_DIR="$ROOT_DIR/cdk/lambda"

echo -e "${BLUE}Starting lambda builds...${NC}"

# Lambda configurations: "directory:has_build:npm_flags"
# has_build: 1 if npm run build is needed, 0 if only npm install
# npm_flags: additional flags for npm install (like --legacy-peer-deps)
LAMBDAS=(
  "importusersworker:1:"
  "brandings:1:"
  "brandingslist:1:"
  "samlslist:1:"
  "serviceproviderslist:1:"
  "amfaconfig:1:"
  "samls:1:"
  "smtpconfig:1:--legacy-peer-deps"
  "multi-tenant-authorizer:0:"
  "organizationslist:0:"
  "tenantslist:0:"
  "totptoken:1"
)

# Counter for progress
TOTAL=${#LAMBDAS[@]}
CURRENT=0

# Build each lambda
for lambda_config in "${LAMBDAS[@]}"; do
  CURRENT=$((CURRENT + 1))
  
  # Parse configuration
  IFS=':' read -r lambda_dir has_build npm_flags <<< "$lambda_config"
  
  echo -e "\n${BLUE}[$CURRENT/$TOTAL] Processing: $lambda_dir${NC}"
  
  # Navigate to lambda directory
  cd "$LAMBDA_DIR/$lambda_dir"
  
  # Install dependencies
  if [ -n "$npm_flags" ]; then
    echo "  Installing dependencies with flags: $npm_flags"
    npm i $npm_flags
  else
    echo "  Installing dependencies..."
    npm i
  fi
  
  # Build if needed
  if [ "$has_build" = "1" ]; then
    echo "  Building..."
    npm run build
  fi
  
  echo -e "${GREEN}  ✓ Complete${NC}"
done

# Return to root directory
cd "$ROOT_DIR"

echo -e "\n${GREEN}All lambda builds completed successfully!${NC}"
