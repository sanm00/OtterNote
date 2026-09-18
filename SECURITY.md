# Security Policy

## Supported versions

OtterNote is pre-1.0 software. Security fixes are applied to the latest release and the `main` branch. Older releases are not maintained.

## Reporting a vulnerability

Please report suspected vulnerabilities privately instead of opening a public issue.

1. Use GitHub's private vulnerability reporting: open the **Security** tab of this repository and select **Report a vulnerability**.
2. Include the affected version or commit, your operating system, reproduction steps, and the impact you observed.
3. If you can, include a minimal proof of concept and any suggested fix.

Maintainers should enable private vulnerability reporting in the repository settings so this channel stays available.

We aim to acknowledge reports within a few days and will keep you updated on the assessment and the fix. Please allow time for a fix to be released before disclosing the issue publicly.

## Scope

Areas that are especially relevant to OtterNote:

- Path handling in Tauri commands: escaping the storage root, writing to unexpected locations, or deleting files outside the data directory.
- Attachment handling: file name validation, preview generation, and cleanup.
- Content rendering: markdown links and images that could load or execute unexpected content.
- Data integrity: corruption or data loss caused by a crash, a failed write, or a storage root change.

## Out of scope

- Issues that require an attacker to already control the user's operating system account or local files with the same privileges.
- Vulnerabilities in dependencies that have no practical impact on OtterNote. Report those upstream as well.
- Missing hardening of the local development setup that does not affect release builds.

## Local data and privacy

OtterNote is local-first. It does not send note content, attachments, or usage data to a server. Notes are stored on disk in the folder described in the README. If you believe a release build performs unexpected network activity, treat it as a security report.
