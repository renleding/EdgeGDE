# Capability: MITM Proxy Daemon

## ADDED Requirements

### Requirement: APA-M01: The system SHALL run a mitmproxy daemon alongside the CDP connection

The State Engine SHALL start a mitmproxy daemon on a configurable port (default 8080) when the CDP connection starts, and stop it when the CDP connection closes.

#### Scenario: Daemon starts with CDP
- Given: the State Engine starts with `STATE_ENGINE_PORT=9110`
- When: `StateEngineMCP.start()` initializes the CDP connection
- Then: the system SHALL start a mitmproxy daemon on port 8080
- And: the daemon SHALL be reachable via HTTP on port 8080

#### Scenario: Daemon stops with CDP
- Given: the mitmproxy daemon is running
- When: the State Engine shuts down
- Then: the system SHALL stop the mitmproxy daemon within 5 seconds

### Requirement: APA-M02: The mitmproxy daemon SHALL generate and trust its own CA certificate

The daemon SHALL generate a TLS CA certificate on first run, store it at `~/.mitmproxy/mitmproxy-ca.pem`, and configure the CfT profile to ignore certificate errors for proxied connections.

#### Scenario: First run generates CA cert
- Given: no `~/.mitmproxy/mitmproxy-ca.pem` exists
- When: the mitmproxy daemon starts
- Then: the system SHALL create the CA certificate file
- And: the CfT browser profile SHALL launch with `--ignore-certificate-errors`

#### Scenario: Subsequent runs reuse CA cert
- Given: a valid `~/.mitmproxy/mitmproxy-ca.pem` exists
- When: the mitmproxy daemon starts
- Then: the system SHALL NOT regenerate the CA certificate

### Requirement: APA-M03: The system SHALL capture HAR entries correlated to CDP frame IDs

Every HAR entry SHALL carry a custom `_cdp_frame_id` field linking it to the CDP `Page.frameId` that initiated the request. The system SHALL expose a `correlate(cdp_frame_id)` method returning matching HAR entries.

#### Scenario: Correlate request to frame
- Given: a CDP frame with ID `F123` issues an HTTP GET
- When: the mitmproxy captures the request
- Then: the HAR entry SHALL contain `_cdp_frame_id: "F123"`
- And: `correlate("F123")` SHALL return that entry

#### Scenario: Correlate returns empty on no match
- Given: no requests from frame `F999`
- When: the caller invokes `correlate("F999")`
- Then: the result SHALL be an empty list

### Requirement: APA-M04: The system SHALL restart the daemon once on crash

If the mitmproxy daemon exits unexpectedly, the system SHALL restart it exactly once. A second failure SHALL surface a `FailureEnvelope` with the partial HAR collected so far.

#### Scenario: Daemon crash triggers single restart
- Given: the mitmproxy daemon crashes
- When: the system detects the exit
- Then: the system SHALL restart the daemon once
- And: if the restart succeeds, capture SHALL resume

#### Scenario: Second crash surfaces FailureEnvelope
- Given: the daemon has already restarted once
- When: the daemon crashes again
- Then: the system SHALL emit a FailureEnvelope containing the partial HAR
- And: the system SHALL NOT attempt a third restart