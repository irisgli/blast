# Reporting Security Issues

If you believe you have found a security vulnerability, please let us know right away.

Report vulnerabilities privately through
[GitHub Security Advisories](https://github.com/irisgli/blast/security/advisories/new)
rather than opening a public issue. We will investigate all legitimate reports and do
our best to fix the problem quickly.

## Scope note

`blast` reads pull request diffs and telemetry, and writes only when `--comment` is
passed explicitly. Reports about the agent being induced to write somewhere it was not
asked to, or to leak adapter credentials into a brief, are in scope and are treated as
high severity.
