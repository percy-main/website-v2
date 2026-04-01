#!/bin/bash
# Creates the local S3 buckets for receipt uploads and policy documents
awslocal s3 mb s3://percy-main-receipts-local
echo "LocalStack S3 bucket created: percy-main-receipts-local"

awslocal s3 mb s3://percy-main-documents-local
echo "LocalStack S3 bucket created: percy-main-documents-local"
