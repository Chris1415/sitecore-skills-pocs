# Security

## Reporting a vulnerability

Report privately through GitHub's security advisories: on this repository, open **Security**, then **Report a vulnerability**. Please do not open a public issue.

This is a personal project with one maintainer, so there is no response-time commitment. Reports are read and taken seriously.

Report a vulnerability in Sitecore's own products to Sitecore, not here.

## What to look out for

Skills are instructions and scripts that an agent runs with your access.

- **Scripts handle OAuth credentials.** Several scripts read automation client credentials and tokens to call SitecoreAI APIs. Read a script before you run it, and give the client only the access it needs.
- **Some skills can change a tenant.** Try them on a non-production environment first, and review what your agent is about to write.
- **Never commit credentials.** Keep client secrets, tokens, Edge context ids and `.env` files out of the repository and out of issues and pull requests. Redact them from logs before you paste them.

CI scans the full history for secrets with gitleaks and scans tracked files for private names.
