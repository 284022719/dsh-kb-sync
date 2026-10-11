# Publish dsh-kb-sync to GitHub and add the dsh-plugin topic.
#
# ASCII-only on purpose: Windows PowerShell 5.1 reads a BOM-less .ps1 as the OEM
# code page, which turns non-ASCII text into mojibake and can break parsing.
#
# Prerequisites (both are the user's to provide; this script never handles a token):
#   1. GitHub CLI installed and authenticated:  gh auth login
#   2. Network egress to github.com allowed for this session's .dsh/rules.yaml
#
# Usage:
#   pwsh -File tools/publish.ps1                       # public repo named dsh-kb-sync
#   pwsh -File tools/publish.ps1 -RepoName other-name
#   pwsh -File tools/publish.ps1 -Private              # private repo (NOT listed on the topic page)

[CmdletBinding()]
param(
  [string]$RepoName = 'dsh-kb-sync',
  [string]$Description = 'DeepSeek Harness plugin: orchestrate a user-owned DeepSeek web history -> local knowledge base sync pipeline. No credentials, no network of its own.',
  [string[]]$Topics = @('dsh-plugin', 'deepseek-harness', 'dsh', 'knowledge-base'),
  [switch]$Private,
  [switch]$SkipChecks
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Push-Location $repoRoot
try {
  if (-not $SkipChecks) {
    if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
      throw 'gh (GitHub CLI) not found. Install it, then run: gh auth login'
    }
    gh auth status | Write-Output
    if ($LASTEXITCODE -ne 0) { throw 'gh is not authenticated. Run: gh auth login' }
  }

  if (-not (Test-Path (Join-Path $repoRoot '.git'))) {
    git init -b main | Write-Output
  }
  git add -A
  $staged = (git diff --cached --name-only | Measure-Object).Count
  if ($staged -gt 0) {
    git commit -m "dsh-kb-sync 0.1.0: host-only orchestrator for a user-owned sync pipeline" | Write-Output
  } else {
    Write-Output 'nothing to commit'
  }

  $visibility = if ($Private) { '--private' } else { '--public' }
  gh repo view $RepoName --json name 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) {
    Write-Output "remote repo $RepoName already exists; pushing to it"
    git remote get-url origin 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) {
      $login = gh api user --jq .login
      git remote add origin "https://github.com/$login/$RepoName.git"
    }
    git push -u origin main
  } else {
    gh repo create $RepoName $visibility --source . --remote origin --push --description $Description | Write-Output
  }

  gh repo edit --add-topic ($Topics -join ',') | Write-Output

  $login = gh api user --jq .login
  Write-Output ''
  Write-Output "repo:  https://github.com/$login/$RepoName"
  if (-not $Private) { Write-Output "topic: https://github.com/topics/dsh-plugin" }
  else { Write-Output 'private repo: it will NOT appear on the topic page' }
}
finally {
  Pop-Location
}
