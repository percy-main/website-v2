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

awslocal s3 mb s3://percy-main-scout-attachment-uploads-local
# CORS for browser-direct PUT of chat attachments (LocalStack)
awslocal s3api put-bucket-cors --bucket percy-main-scout-attachment-uploads-local --cors-configuration '{"CORSRules":[{"AllowedHeaders":["*"],"AllowedMethods":["PUT"],"AllowedOrigins":["*"],"ExposeHeaders":["ETag"],"MaxAgeSeconds":3600}]}'
echo "LocalStack S3 bucket created: percy-main-scout-attachment-uploads-local"

awslocal s3 mb s3://percy-main-scout-attachments-local
echo "LocalStack S3 bucket created: percy-main-scout-attachments-local"

awslocal s3 mb s3://percy-main-scout-kb-uploads-local
# CORS for browser-direct PUT of admin-supplied KB documents (LocalStack)
awslocal s3api put-bucket-cors --bucket percy-main-scout-kb-uploads-local --cors-configuration '{"CORSRules":[{"AllowedHeaders":["*"],"AllowedMethods":["PUT"],"AllowedOrigins":["*"],"ExposeHeaders":["ETag"],"MaxAgeSeconds":3600}]}'
echo "LocalStack S3 bucket created: percy-main-scout-kb-uploads-local"

awslocal s3 mb s3://percy-main-scout-kb-local
echo "LocalStack S3 bucket created: percy-main-scout-kb-local"
