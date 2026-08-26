param(
  [string]$MobileConfigRoot = "$HOME\.config\mobile-coder"
)

$ErrorActionPreference = "Stop"
$pluginRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$mobileRoot = [System.IO.Path]::GetFullPath($MobileConfigRoot)
$skillsRoot = [System.IO.Path]::GetFullPath((Join-Path $mobileRoot "skills"))

if (-not (Test-Path -LiteralPath $mobileRoot -PathType Container)) {
  throw "Mobile Coder config root does not exist: $mobileRoot"
}

New-Item -ItemType Directory -Force -Path $skillsRoot, (Join-Path $mobileRoot "commands"), (Join-Path $mobileRoot "plugins") | Out-Null

foreach ($sourceSkill in Get-ChildItem -LiteralPath (Join-Path $pluginRoot "skills") -Directory) {
  $target = [System.IO.Path]::GetFullPath((Join-Path $skillsRoot $sourceSkill.Name))
  if (-not $target.StartsWith($skillsRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to replace a skill outside Mobile skills root: $target"
  }
  if (Test-Path -LiteralPath $target) {
    Remove-Item -LiteralPath $target -Recurse -Force
  }
  Copy-Item -LiteralPath $sourceSkill.FullName -Destination $target -Recurse -Force
}

Copy-Item -LiteralPath (Join-Path $pluginRoot "opencode\commands\ddd.md") -Destination (Join-Path $mobileRoot "commands\ddd.md") -Force
Copy-Item -LiteralPath (Join-Path $pluginRoot "opencode\commands\ddd-code.md") -Destination (Join-Path $mobileRoot "commands\ddd-code.md") -Force

$adapter = Join-Path $mobileRoot "plugins\ddd-workflow.js"
$entryUrl = ([System.Uri](Join-Path $pluginRoot "dist\index.js")).AbsoluteUri
$adapterSource = @"
import { DddWorkflowPlugin } from "$entryUrl"
export default (input) => DddWorkflowPlugin(input, { host: "mobile" })
"@
[System.IO.File]::WriteAllText($adapter, $adapterSource, [System.Text.UTF8Encoding]::new($false))

$configPath = Join-Path $mobileRoot "mobile-coder.json"
if (Test-Path -LiteralPath $configPath -PathType Leaf) {
  $config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
  if ($config.PSObject.Properties["mcp"] -and $config.mcp.PSObject.Properties["ddd"]) {
    $managedCommand = @($config.mcp.ddd.command) -join " "
    if ($managedCommand -like "*opencode-ddd-plugin-v2*dist*mcp-server.js*") {
      $config.mcp.PSObject.Properties.Remove("ddd")
      [System.IO.File]::WriteAllText($configPath, ($config | ConvertTo-Json -Depth 100), [System.Text.UTF8Encoding]::new($false))
    }
  }
}

$legacyTool = Join-Path $mobileRoot "tools\mcp.js"
if (Test-Path -LiteralPath $legacyTool) {
  Remove-Item -LiteralPath $legacyTool -Force
}

Write-Output "Installed DDD plugin adapter, commands, and clean skill directories into $mobileRoot"
Write-Output "Installed one native Mobile SDK ddd_lifecycle tool; no MCP server is configured."
