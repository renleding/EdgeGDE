<# 
.SYNOPSIS
    Start all Rhino MCP servers on pc2 (100.110.105.101)

.DESCRIPTION
    Starts the 5 Rhino MCP servers configured in Hermes config.yaml:
    - rhino           : port 8765
    - rhino-mcp-main  : port 4242
    - rhino-mcp-mod   : port 1999
    - rhino-gh-mcp    : port 9876
    - rhino-ai        : port 10500

.NOTES
    Edit the $ServerCommands hashtable with the actual commands to start each server.
    Servers must bind to 0.0.0.0 (not 127.0.0.1) to accept Tailscale connections.
#>

param(
    [switch]$All,
    [string[]]$Only,
    [switch]$Stop,
    [switch]$Status,
    [switch]$Restart
)

$ErrorActionPreference = 'Stop'

# ============================================================
# CUSTOMIZE THESE COMMANDS FOR YOUR ACTUAL SERVER IMPLEMENTATIONS
# ============================================================
$ServerCommands = @{
    "rhino"          = @{ Port = 8765;  Command = "node C:\path\to\rhino-mcp-server.js";           WorkingDir = "C:\path\to\rhino" }
    "rhino-mcp-main" = @{ Port = 4242;  Command = "python C:\path\to\rhino_mcp_main.py";           WorkingDir = "C:\path\to\rhino-mcp-main" }
    "rhino-mcp-mod"  = @{ Port = 1999;  Command = "dotnet run --project C:\path\to\RhinoMcpMod.csproj"; WorkingDir = "C:\path\to\rhino-mcp-mod" }
    "rhino-gh-mcp"   = @{ Port = 9876;  Command = "npx -y @some/rhino-gh-mcp";                    WorkingDir = "C:\path\to\rhino-gh-mcp" }
    "rhino-ai"       = @{ Port = 10500; Command = "python -m rhino_ai_mcp";                       WorkingDir = "C:\path\to\rhino-ai" }
}

$ServiceNames = @{
    "rhino"          = "RhinoMCP-Rhino"
    "rhino-mcp-main" = "RhinoMCP-Main"
    "rhino-mcp-mod"  = "RhinoMCP-Mod"
    "rhino-gh-mcp"   = "RhinoMCP-GH"
    "rhino-ai"       = "RhinoMCP-AI"
}

# ============================================================
# Helper functions
# ============================================================
function Test-Port($port) {
    try {
        $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Any, $port)
        $listener.Start()
        $listener.Stop()
        return $true
    } catch {
        return $false
    }
}

function Get-ProcessOnPort($port) {
    $proc = Get-Process -Id (Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue).OwningProcess -ErrorAction SilentlyContinue
    return $proc
}

function Start-Server($name, $config) {
    Write-Host "Starting $name on port $($config.Port)..." -ForegroundColor Cyan
    
    if (Test-Port $config.Port) {
        $existing = Get-ProcessOnPort $config.Port
        if ($existing) {
            Write-Warning "Port $($config.Port) already in use by $($existing.ProcessName) (PID: $($existing.Id))"
            return $false
        }
    }
    
    $proc = Start-Process -FilePath "cmd.exe" -ArgumentList "/c", $config.Command -WorkingDirectory $config.WorkingDir -PassThru -WindowStyle Hidden
    if ($proc) {
        Write-Host "  Started $name (PID: $($proc.Id))" -ForegroundColor Green
        Start-Sleep -Seconds 2
        if (Test-Port $config.Port) {
            Write-Host "  [$name] Listening on 0.0.0.0:$($config.Port)" -ForegroundColor Green
            return $true
        } else {
            Write-Warning "  [$name] Started but not listening on port $($config.Port) yet"
            return $false
        }
    } else {
        Write-Error "  Failed to start $name"
        return $false
    }
}

function Stop-Server($name, $port) {
    $proc = Get-ProcessOnPort $port
    if ($proc) {
        Write-Host "Stopping $name (PID: $($proc.Id)) on port $port..." -ForegroundColor Yellow
        Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 1
        if (-not (Test-Port $port)) {
            Write-Host "  [$name] Stopped" -ForegroundColor Green
        } else {
            Write-Warning "  [$name] May still be running"
        }
    } else {
        Write-Host "  [$name] Not running on port $port" -ForegroundColor Gray
    }
}

function Show-Status() {
    Write-Host "`n=== Rhino MCP Server Status ===" -ForegroundColor Cyan
    foreach ($name in $ServerCommands.Keys) {
        $config = $ServerCommands[$name]
        $proc = Get-ProcessOnPort $config.Port
        if ($proc) {
            Write-Host "  [$name] RUNNING  - Port $($config.Port) - PID: $($proc.Id) - $($proc.ProcessName)" -ForegroundColor Green
        } else {
            Write-Host "  [$name] STOPPED  - Port $($config.Port)" -ForegroundColor Red
        }
    }
    Write-Host ""
}

# ============================================================
# Main logic
# ============================================================
$serversToProcess = @($ServerCommands.Keys)

if ($Only) {
    $serversToProcess = $Only
}

if ($Stop) {
    foreach ($name in $serversToProcess) {
        Stop-Server $name $ServerCommands[$name].Port
    }
    exit
}

if ($Status) {
    Show-Status
    exit
}

if ($Restart) {
    foreach ($name in $serversToProcess) {
        Stop-Server $name $ServerCommands[$name].Port
    }
    Start-Sleep -Seconds 2
}

$success = 0
$failed = 0

foreach ($name in $serversToProcess) {
    if (Start-Server $name $ServerCommands[$name]) {
        $success++
    } else {
        $failed++
    }
}

Write-Host "`n=== Summary ===" -ForegroundColor Cyan
Write-Host "Started: $success" -ForegroundColor Green
Write-Host "Failed:  $failed" -ForegroundColor Red

if ($failed -gt 0) {
    Write-Host "`nEdit the \$ServerCommands hashtable in this script with correct paths/commands." -ForegroundColor Yellow
    exit 1
}

Show-Status