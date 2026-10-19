param(
    [string]$DesktopPath
)

$ErrorActionPreference = 'Stop'
$nexusRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$nexusToggle = Join-Path $PSScriptRoot 'toggle-nexus.ps1'
$nexusIcon = Join-Path $nexusRoot 'public\assets\nexus.ico'
if (-not $DesktopPath) { $DesktopPath = [Environment]::GetFolderPath([Environment+SpecialFolder]::Desktop) }
if (-not $DesktopPath) { throw 'O Windows nao informou a pasta real da Area de Trabalho.' }
$DesktopPath = [IO.Path]::GetFullPath($DesktopPath)
$shortcutPath = Join-Path $DesktopPath 'Nexus.lnk'

if (-not (Test-Path -LiteralPath $nexusToggle -PathType Leaf)) { throw "Script do atalho nao encontrado: $nexusToggle" }
if (-not (Test-Path -LiteralPath $nexusIcon -PathType Leaf)) { throw "Icone Nexus nao encontrado: $nexusIcon" }
if (-not (Test-Path -LiteralPath $DesktopPath -PathType Container)) { throw "A pasta da Area de Trabalho nao existe: $DesktopPath" }

$shell = New-Object -ComObject WScript.Shell
if (Test-Path -LiteralPath $shortcutPath) {
    $existing = $shell.CreateShortcut($shortcutPath)
    $existingDirectory = [IO.Path]::GetFullPath([string]$existing.WorkingDirectory).TrimEnd('\')
    if (-not [string]::Equals($existingDirectory, $nexusRoot.TrimEnd('\'), [StringComparison]::OrdinalIgnoreCase)) {
        throw "Ja existe Nexus.lnk apontando para outro destino: $($existing.TargetPath)"
    }
}

$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$nexusToggle`""
$shortcut.WorkingDirectory = $nexusRoot
$shortcut.IconLocation = "$nexusIcon,0"
$shortcut.Description = 'Iniciar ou encerrar o Nexus Desk'
$shortcut.WindowStyle = 1
$shortcut.Save()
Write-Output "Atalho criado: $shortcutPath"
