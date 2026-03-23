#!/bin/bash
# Creates the local S3 bucket for receipt uploads
awslocal s3 mb s3://percy-main-receipts-local
echo "LocalStack S3 bucket created: percy-main-receipts-local"
