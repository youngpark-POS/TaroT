# Administrator monitoring

Open `/monitoring` on the deployed CloudFront origin. Cognito hosted login uses
authorization code + PKCE with a five-minute encrypted state cookie. The API verifies
the ID token signature, issuer, audience, expiry, token use, and `monitoring-admins`
group. Session cookies are HttpOnly, Secure in production, and expire after 15 minutes.
Self-registration is disabled. Authentication tokens and OAuth query strings are
excluded from application request logs. CloudFront API caching remains disabled.

The deployment workflow invites the existing `BUDGET_NOTIFICATION_EMAIL` once and
adds that account to the administrator group. The invitation contains a temporary
password; change it on first login. Do not store invitation credentials in GitHub or
Git. Administrators can enroll software-token MFA in Cognito. To revoke access,
disable the Cognito account, revoke sessions, and remove group membership. Existing
signed ID tokens remain valid for at most 15 minutes.

## Data displayed

- Live/ready probes through CloudFront, including response latency.
- API, worker, cleanup Lambda invocations/errors/throttles over the last hour. Duration
  p95 is from the latest available five-minute bucket; `—` means no data.
- SQS visible/in-flight/delayed messages and latest available oldest-message age.
- CloudWatch alarms (including insufficient-data status).
- TaroT OpenAI agent runs, model requests, failures, input/output/total tokens, daily
  trend, and agent/model breakdown for 1/7/30 UTC calendar days.

The browser refreshes every minute while visible. The API caches each selected range
for at most one minute after authorization. A failed data source returns 503 rather
than showing a healthy zero. AWS metrics themselves can be delayed.

## Usage collection

Only real OpenAI runs are counted. SDK `result.state.usage` includes every model
request in the agent loop. Failed runs with available SDK state retain their partial
usage; failures without usage increment `unreportedRuns` and cannot contribute known
tokens. Retries count as additional runs. Usage includes calls even if the user does
not finish revealing their cards. Agent run success is not a completed-reading rate.
Mock runs and static fallback do not add OpenAI tokens.

A dedicated DynamoDB telemetry table holds daily aggregate counters and opaque run
deduplication IDs, retained for 90 days with TTL. Deduplication and increments use one
atomic transaction. The data contains no reading IDs, prompts, card draws, answers,
email addresses, or API keys. Telemetry write failures never retry the paid model call;
they emit only a safe `telemetry_write_failed` event. Such write failures can make this
application-level usage incomplete. It is not an OpenAI invoice and has no historical
backfill before deployment or data from other applications.

## Infrastructure and deployment

The temporary stack adds one on-demand DynamoDB table and one Cognito Lite pool with
an OAuth client, hosted domain, and admin group. It reuses the SPA, API Lambda, and
CloudFront behaviors. CloudWatch reads use the existing standard AWS metrics; no
new paid custom metrics or continuous log scans are needed. GetMetricData requests
and Cognito/DynamoDB usage may incur charges under the account's current pricing.

Bootstrap IAM must be updated from `bootstrap/main.tf` to allow the new Cognito
resources before the first monitoring deployment.
This includes `GetUserPoolMfaConfig` and `SetUserPoolMfaConfig` for Terraform's
optional software-token MFA configuration, restricted to the tagged monitoring pool.
The workflow passes the previously deployed CloudFront origin as `monitoring_site_origin`, avoiding a dependency cycle
between CloudFront, Lambda environment, and Cognito callback URLs. A fresh stack needs
a second deployment after CloudFront has an origin before login becomes enabled.

Normal CI uses mocks. Tests cover fail-closed authorization, range bounds, PKCE state,
aggregate privacy, failure usage, and telemetry isolation. Browser tests cover desktop,
mobile, accessibility, login, charts, and refresh controls. The protected `aws-temp`
deployment workflow remains the delivery path; no deployment credentials are sent to
the browser. Existing teardown also removes the new table and Cognito resources.
