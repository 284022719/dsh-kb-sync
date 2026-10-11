# Publish dsh-kb-sync to GitHub and add the dsh-plugin topic.
#
# ASCII-only on purpose: Windows PowerShell 5.1 reads a BOM-less .ps1 as the OEM
# code page, which turns non-ASCII text into mojibake and can break parsing.
#
# Two paths, because the machine may have no GitHub CLI:
#   * gh mode (default when `gh` exists): creates the repo and adds topics via API.
#   * git-only mode (-NoGh, or gh missing): sets the remote and pushes; the push
#     authenticates through Git Credential Manager (a browser window opens), and
#     topics are added from the repository's About panel.
#
# Neither path asks for or stores a token here; this script never handles one.
#
# Usage:
#   pwsh -File tools/publish.ps1                                  # public repo, gh mode
#   pwsh -File tools/publish.ps1 -NoGh -RemoteUrl https://github.com/<you>/dsh-kb-sync.git
#   pwsh -File tools/publish.ps1 -NoGh -RemoteUrl <url> -SkipPush  # prepare only (no network)
#   pwsh -File tools/publish.ps1 -RepoName other-name -Private     # private (NOT on the topic page)

[CmdletBinding()]
param(
  [string]$RepoName = 'dsh-kb-sync',
  [string]$RemoteUrl = '',
  [string]$Description = 'DeepSeek Harness plugin: orchestrate a user-owned DeepSeek web history -> local knowledge base sync pipeline. No credentials, no network of its own.',
  [string[]]$Topics = @('dsh-plugin', 'deepseek-harness', 'dsh', 'knowledge-base'),
  [string]$Message = 'chore: publish preparation (repository field, remote, topic)',
  [switch]$Private,
  [switch]$NoGh,
  [switch]$SkipPush,
  [switch]$SkipChecks
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Push-Location $repoRoot

function Get-OwnerFromUrl([string]$url) {
  if ($url -match 'github\.com[/:](?<owner>[^/]+)/(?<repo>[^/]+?)(\.git)?$') { return $Matches['owner'] }
  return ''
}

try {
  $hasGh = [bool](Get-Command gh -ErrorAction SilentlyContinue)
  $useGh = $hasGh -and -not $NoGh

  if (-not $SkipChecks -and $useGh) {
    gh auth status | Write-Output
    if ($LASTEXITCODE -ne 0) { throw 'gh is not authenticated. Run: gh auth login (or use -NoGh with -RemoteUrl)' }
  }

  # Resolve the owner/repo URL used for package.json and the remote.
  $owner = ''
  if ($RemoteUrl -ne '') { $owner = Get-OwnerFromUrl $RemoteUrl }
  elseif ($useGh) { $owner = (gh api user --jq .login) }
  if ($RemoteUrl -eq '' -and $owner -ne '') { $RemoteUrl = "https://github.com/$owner/$RepoName.git" }
  if ($RemoteUrl -ne '' -and $owner -eq '') { throw "cannot read owner/repo from -RemoteUrl '$RemoteUrl'" }
  if (-not $useGh -and $RemoteUrl -eq '') {
    throw 'no gh and no -RemoteUrl: create an empty repo on GitHub first, then pass -RemoteUrl https://github.com/<you>/<repo>.git'
  }

  # 1. Fill package.json's repository field so the published package has a
  #    checkable source instead of "unpinned | no repository".
  if ($RemoteUrl -ne '') {
    $pkgPath = Join-Path $repoRoot 'package.json'
    $pkg = Get-Content $pkgPath -Raw | ConvertFrom-Json
    $repoUrl = 'git+' + $RemoteUrl
    if (-not $pkg.repository -or $pkg.repository.url -ne $repoUrl) {
      if ($pkg.PSObject.Properties['repository']) { $pkg.repository.url = $repoUrl }
      else { $pkg | Add-Member -NotePropertyName repository -NotePropertyValue ([pscustomobject]@{ type = 'git'; url = $repoUrl }) }
      $json = ($pkg | ConvertTo-Json -Depth 10).TrimEnd() + "`n"
      [IO.File]::WriteAllText($pkgPath, $json, (New-Object Text.UTF8Encoding $false))
      Write-Output "package.json repository -> $repoUrl"
    } else {
      Write-Output 'package.json repository already correct'
    }
  }

  # 2. Commit whatever is pending (including the field above).
  if (-not (Test-Path (Join-Path $repoRoot '.git'))) { git init -b main | Write-Output }
  git add -A
  if ((git diff --cached --name-only | Measure-Object).Count -gt 0) {
    git commit -m $Message | Write-Output
  } else {
    Write-Output 'nothing to commit'
  }

  # 3. Make sure a remote exists.
  git remote get-url origin 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) {
    if ($RemoteUrl -eq '') { throw 'no origin remote and no -RemoteUrl' }
    git remote add origin $RemoteUrl
    Write-Output "origin -> $RemoteUrl"
  } else {
    Write-Output ("origin already set: " + (git remote get-url origin))
  }

  if ($SkipPush) {
    Write-Output ''
    Write-Output 'SkipPush: local preparation done. Next (run this yourself, it opens a browser for auth):'
    Write-Output "  git push -u origin main"
    Write-Output "then add topics in the repo's About panel: $($Topics -join ', ')"
    return
  }

  # 4. Create (gh) or push (both paths).
  if ($useGh) {
    gh repo view $RepoName --json name 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) {
      Write-Output "remote repo $RepoName already exists; pushing"
      git push -u origin main
    } else {
      $visibility = if ($Private) { '--private' } else { '--public' }
      gh repo create $RepoName $visibility --source . --remote origin --push --description $Description | Write-Output
    }
    gh repo edit --add-topic ($Topics -join ',') | Write-Output
  } else {
    git push -u origin main
    Write-Output ''
    Write-Output 'Pushed. Now add the topics in the repository About panel (Settings -> About, or the'
    Write-Output "repo header's gear icon): $($Topics -join ', ')"
  }

  if ($owner -ne '') { Write-Output ''; Write-Output "repo:  $RemoteUrl" }
  if (-not $Private) { Write-Output "topic: https://github.com/topics/dsh-plugin" }
  else { Write-Output 'private repo: it will NOT appear on the topic page' }
}
finally {
  Pop-Location
}
