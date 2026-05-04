#!/bin/bash
# Creates the local S3 buckets for receipt uploads and policy documents
awslocal s3 mb s3://percy-main-receipts-local
echo "LocalStack S3 bucket created: percy-main-receipts-local"

awslocal s3 mb s3://percy-main-documents-local
echo "LocalStack S3 bucket created: percy-main-documents-local"

awslocal s3 mb s3://percy-main-document-uploads-local
# CORS for browser-direct PUT uploads (LocalStack)
awslocal s3api put-bucket-cors --bucket percy-main-document-uploads-local --cors-configuration '{"CORSRules":[{"AllowedHeaders":["Content-Type"],"AllowedMethods":["PUT"],"AllowedOrigins":["*"],"MaxAgeSeconds":3600}]}'
echo "LocalStack S3 bucket created: percy-main-document-uploads-local"

awslocal s3 mb s3://percy-main-scout-reports-local
echo "LocalStack S3 bucket created: percy-main-scout-reports-local"
