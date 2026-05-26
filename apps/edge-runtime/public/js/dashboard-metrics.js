document.addEventListener("DOMContentLoaded", async () => {
  setInterval(async () => {
    const response = await fetch("/api/dashboard/metrics");
    const metrics = await response.json();
    const rpmElement = document.getElementById("rpm");
    const topRoutesElement = document.getElementById("top-routes");
    const topTenantsElement = document.getElementById("top-tenants");
    const latencyElement = document.getElementById("latency");
    const errorsElement = document.getElementById("errors");
    const rateLimitElement = document.getElementById("rate-limit");
    const tenantMonitorElement = document.getElementById("tenant-monitor");
    const toolUsageElement = document.getElementById("tool-usage");
    const agentHumanFlowElement = document.getElementById("agent-human-flow");

    if (rpmElement) rpmElement.textContent = `${metrics.requests_per_minute.toFixed(2)} RPM`;
    if (topRoutesElement) topRoutesElement.textContent = JSON.stringify(metrics.top_routes);
    if (topTenantsElement) topTenantsElement.textContent = JSON.stringify(metrics.top_tenants);
    if (latencyElement) latencyElement.textContent = `${metrics.avg_latency_ms.toFixed(2)} ms AVG, ${metrics.p95_latency_ms.toFixed(2)} ms P95`;
    if (errorsElement) errorsElement.textContent = `${metrics.error_rate_percent.toFixed(2)}% Errors, ${metrics.total_429_responses} 429s`;
    if (rateLimitElement) rateLimitElement.textContent = `${metrics.agent_request_ratio.toFixed(2)}% Agents`;
    if (tenantMonitorElement) tenantMonitorElement.textContent = JSON.stringify(metrics.top_tenants);
    if (toolUsageElement) toolUsageElement.textContent = JSON.stringify(metrics.tool_usage_counts);
    if (agentHumanFlowElement) agentHumanFlowElement.textContent = JSON.stringify(metrics.agent_request_ratio);
  }, 5000);
});
