# ADR 040: Monitoring SNS topic — no KMS encryption-at-rest

## Status

Accepted

## Context

`infra/modules/monitoring/main.tf` provisions an SNS topic (`alarms`) that all CloudWatch metric alarms in the module publish to (CPU/memory/storage on ECS, ALB, RDS — and the new alarms added in #205, #206, #207, #208). The topic was originally created with `kms_master_key_id = "alias/aws/sns"` (the AWS-managed SNS KMS key) for encryption-at-rest.

Two problems with that configuration:

1. **CloudWatch can't publish to it.** SNS topics encrypted with `alias/aws/sns` reject publishes from CloudWatch alarms because CloudWatch needs `kms:GenerateDataKey` against the topic's CMK, and the AWS-managed key's policy cannot be edited to grant that permission. As written, every monitoring-module alarm was silently failing to deliver.
2. **Same problem for EventBridge.** The new ECS deployment-failed event rule (#205) targets the same topic; EventBridge has the same KMS access requirement.

Two options:

- **A. Customer-managed KMS key (CMK)** with a policy allowing `cloudwatch.amazonaws.com` and `events.amazonaws.com` to use it.
- **B. Drop encryption-at-rest** on this specific topic.

## Decision

**Drop encryption-at-rest** on the monitoring module's `alarms` topic (#208 commit). The alarms-feed payload is CloudWatch alarm-state metadata (alarm name, threshold, dimensions, timestamps) — no secrets, no PII, no business data. The marginal value of encryption-at-rest on SNS for this payload is low. The cost of operating a CMK (key policy maintenance, key-rotation handling, key-grant management for new services) is non-trivial.

A separate SNS topic policy is added that explicitly allows both `cloudwatch.amazonaws.com` and `events.amazonaws.com` as publishers (#205 commit) — required for the EventBridge target to deliver, and good explicit hygiene for CloudWatch even though the default-allow on alarm publish would also work.

## Why not option A

- **Operational tax.** A CMK requires policy management every time a new AWS service needs to publish — and we expect to add more (RDS event sub, anything that lands later under #200 / #201). Wrong key-policy = silent delivery failure that's painful to debug.
- **Transport encryption is already in place.** SNS-to-subscriber traffic is HTTPS / TLS regardless. The encryption-at-rest gap only matters if an attacker reaches SNS storage directly, by which point a much bigger problem exists.
- **Other ops topics in this repo already follow this pattern.** Both `shared_reliability_alarms` (#211) and `security_events` (#219 fixup) topics are unencrypted for the same reason. Adopting the same pattern here is consistent.

## Consequences

- The `alarms` topic appears as "Encryption: None" in the SNS console.
- If the threat model later requires encryption-at-rest (e.g. compliance auditor flag), provision a CMK and update the topic to use it; document in a follow-up ADR.
- Keep the SNS topic policy explicit about allowed publishers; new services that should publish to this topic must be added to the policy.
