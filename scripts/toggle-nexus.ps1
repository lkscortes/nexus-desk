param(
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'

$nexusRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$nexusServer = Join-Path $nexusRoot 'server.mjs'
$nexusLauncher = Join-Path $PSScriptRoot 'start.mjs'
$nexusPort = if ($env:NEXUS_PORT) { [int]$env:NEXUS_PORT } else { 4318 }
$nexusOrigin = "http://127.0.0.1:$nexusPort"
$host.UI.RawUI.WindowTitle = 'Nexus'
$nexusListener = Get-NetTCPConnection -LocalPort $nexusPort -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1

if ($nexusListener) {
    try { $nexusHealth = Invoke-RestMethod "$nexusOrigin/api/health" -TimeoutSec 3 } catch { $nexusHealth = $null }
    $nexusProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $($nexusListener.OwningProcess)" -ErrorAction SilentlyContinue
    $nexusCommand = [string]$nexusProcess.CommandLine
    $nexusNormalizedCommand = $nexusCommand.Replace('/', '\')
    $nexusAbsoluteMatch = $nexusNormalizedCommand.Contains($nexusServer) -or $nexusNormalizedCommand.Contains($nexusLauncher)
    $nexusRelativeMatch = $nexusCommand -match '(?:^|\s|")(?:server\.mjs|start\.mjs|scripts[\\/]start\.mjs)(?:$|\s|")'
    if (-not $nexusHealth -or $nexusHealth.name -ne 'nexus-desk' -or $nexusHealth.integrationVersion -ne 2 -or $nexusHealth.cardProtocolVersion -ne 1 -or $nexusHealth.reconnectVersion -ne 1 -or $nexusProcess.Name -ne 'node.exe' -or -not ($nexusAbsoluteMatch -or $nexusRelativeMatch)) {
        throw "A porta $nexusPort pertence a um processo que nao foi confirmado como servidor Nexus. Nenhum processo foi encerrado."
    }

    $nexusConfirmedPid = $nexusListener.OwningProcess
    $nexusCurrentListener = Get-NetTCPConnection -LocalPort $nexusPort -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $nexusCurrentListener -or $nexusCurrentListener.OwningProcess -ne $nexusConfirmedPid) {
        throw 'O processo que ocupava a porta mudou durante a verificacao. Nada foi encerrado.'
    }

    Stop-Process -Id $nexusConfirmedPid
    for ($nexusAttempt = 0; $nexusAttempt -lt 30; $nexusAttempt++) {
        if (-not (Get-NetTCPConnection -LocalPort $nexusPort -State Listen -ErrorAction SilentlyContinue)) { break }
        Start-Sleep -Milliseconds 200
    }
    if (Get-NetTCPConnection -LocalPort $nexusPort -State Listen -ErrorAction SilentlyContinue) {
        throw 'O servidor ainda ocupa a porta. A janela do servidor pode continuar aberta.'
    }
    Write-Host 'Nexus encerrado.' -ForegroundColor Yellow
    exit 0
}

try { $nexusUnexpected = Invoke-RestMethod "$nexusOrigin/api/health" -TimeoutSec 1 } catch { $nexusUnexpected = $null }
if ($nexusUnexpected) { throw 'O servidor responde, mas o Windows nao permitiu identificar seu processo. Nada foi encerrado.' }

$nexusNode = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
if (-not $nexusNode) { throw 'Instale Node.js 24 LTS ou execute Instalar Nexus.cmd.' }
if (-not (Test-Path -LiteralPath $nexusNode)) { throw 'Node.js nao encontrado.' }

Write-Host "Iniciando Nexus em primeiro plano na porta $nexusPort. Feche esta janela ou pressione Ctrl+C para encerrar." -ForegroundColor Green
Push-Location $nexusRoot
try {
    $nexusArguments = @($nexusLauncher)
    if ($NoBrowser) { $nexusArguments += '--no-browser' }
    & $nexusNode @nexusArguments
    exit $LASTEXITCODE
} finally {
    Pop-Location
}
