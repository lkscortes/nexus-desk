param([switch]$Start, [Parameter(ValueFromRemainingArguments = $true)][string[]]$SetupArgs)
$ErrorActionPreference = 'Stop'

function Find-NexusNode {
  $candidate = Get-Command node -ErrorAction SilentlyContinue
  if ($candidate) {
    $major = & $candidate.Source -p "Number(process.versions.node.split('.')[0])"
    if ($LASTEXITCODE -eq 0 -and [int]$major -ge 24) { return $candidate.Source }
  }
  return $null
}

try {
  $nodePath = Find-NexusNode
  if (-not $nodePath) {
    Write-Host 'Nexus requer Node.js 24 ou superior.'
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if (-not $winget) { throw 'Instale Node.js LTS em https://nodejs.org/en/download e execute este instalador novamente.' }
    $accepted = $SetupArgs -contains '--yes' -or $SetupArgs -contains '-y'
    if (-not $accepted) {
      $answer = Read-Host 'Instalar Node.js LTS pelo pacote oficial OpenJS.NodeJS.LTS via winget? [s/N]'
      $accepted = $answer -match '^(s|sim|y|yes)$'
    }
    if (-not $accepted) { throw 'Instalacao cancelada. Instale Node.js 24+ e execute novamente.' }
    & $winget.Source install --id OpenJS.NodeJS.LTS --exact --source winget --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0) { throw "winget retornou $LASTEXITCODE. Instale Node.js 24+ em https://nodejs.org/en/download." }
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User') + ';' + $env:Path
    $nodePath = Find-NexusNode
    if (-not $nodePath) { throw 'Node.js 24+ ainda nao esta disponivel. Abra outro terminal e execute este instalador novamente.' }
  }
  & $nodePath (Join-Path $PSScriptRoot 'scripts/setup.mjs') @SetupArgs
  $setupExit = $LASTEXITCODE
  if ($setupExit -ne 0) { exit $setupExit }
  if ($Start) {
    Push-Location -LiteralPath $PSScriptRoot
    try {
      $dataScript = "import { parseSetupArgs, resolveSetupOptions } from './lib/setup.mjs'; console.log(resolveSetupOptions(parseSetupArgs(process.argv.slice(1))).dataDir)"
      $dataDir = & $nodePath --input-type=module --eval $dataScript -- @SetupArgs
      if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel localizar os dados da instalacao.' }
      & $nodePath (Join-Path $PSScriptRoot 'scripts/start.mjs') --data-dir $dataDir
      exit $LASTEXITCODE
    } finally { Pop-Location }
  }
  exit $setupExit
} catch { Write-Error $_.Exception.Message -ErrorAction Continue; exit 1 }
