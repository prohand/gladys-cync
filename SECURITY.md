# Security policy

## Supported versions

Only the latest release of the Cync integration receives security fixes.
Update the integration from the Gladys store before reporting an issue.

| Version      | Supported |
| ------------ | --------- |
| 1.x (latest) | Yes       |
| older        | No        |

## Reporting a vulnerability

Please do **not** open a public issue, pull request or forum post for a
security problem.

Report it privately through GitHub: open the **Security** tab of
[prohand/gladys-cync](https://github.com/prohand/gladys-cync/security), then
**Report a vulnerability**.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- any log line that helps (remove tokens, passwords, email addresses and IP
  addresses first — the detailed logs contain raw Cync frames).

You should get a first answer within 7 days. A fix is released as a new version
of the integration, and the advisory is published once users can update.

## Scope

In scope: the code of this repository and the Docker image it publishes, in
particular how it handles the Cync password, the session tokens stored in
`/data`, and the frames received from the Cync cloud.

Out of scope: Gladys Assistant itself (report to
[GladysAssistant/Gladys](https://github.com/GladysAssistant/Gladys/security)),
the Cync cloud and the Cync devices.

## Known limitation: the Cync server certificate

The Cync TCP server (`cm-sec.gelighting.com:23779`) presents an expired
certificate whose name does not match. The integration tries a strict TLS
check first and, when it fails, connects with relaxed verification — the only
way to reach the service, and what the Cync app does. The traffic stays
encrypted, but a machine able to intercept the connection could impersonate
the server. The session secret sent on that connection only drives the Cync
devices of the account; it is not the account password.

## Good practices for users

- Keep the Cync password only in the integration's secret field.
- Prefer a password used for Cync only.
- Keep Gladys and the integration up to date.
