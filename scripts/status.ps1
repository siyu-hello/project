<#
.SYNOPSIS
  推进 sprint-status.yaml 的状态并自动提交。

.DESCRIPTION
  只改 development_status 里的一行状态 + last_updated，其余内容（注释、空行、action_items）原样保留。
  未初始化 git 时只改文件、不提交。

.EXAMPLE
  pwsh scripts/status.ps1 show
      看当前每个史诗/故事的状态，以及下一条要动的故事。

.EXAMPLE
  pwsh scripts/status.ps1 next
      按「当前故事 → 下一状态」推进一步，并提交：
        in-progress → review
        review      → done（史诗内全部 done 时同时把 epic 置 done）
        ready-for-dev / backlog → in-progress（同时把 epic 从 backlog 置 in-progress）

.EXAMPLE
  pwsh scripts/status.ps1 next -NoCommit
      只改文件，不提交。

.EXAMPLE
  pwsh scripts/status.ps1 set 1-1 done
      手动指定某条故事的状态。

.EXAMPLE
  pwsh scripts/status.ps1 init
      git init 并提交一次初始状态。

.NOTES
  需要 PowerShell 7（中文键名输出需要 UTF-8 控制台）。
  状态词表：backlog | ready-for-dev | in-progress | review | done（回顾为 optional | done）。
#>

param(
    [Parameter(Position = 0)][string]$Command = 'show',
    [Parameter(Position = 1)][string]$StoryKey,
    [Parameter(Position = 2)][string]$Status,
    [switch]$NoCommit
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

$repoRoot = Split-Path -Parent $PSScriptRoot
$statusFile = Join-Path $repoRoot '_bmad-output/implementation-artifacts/sprint-status.yaml'
$validStatus = @('backlog', 'ready-for-dev', 'in-progress', 'review', 'done')

if (-not (Test-Path -LiteralPath $statusFile)) {
    Write-Error "找不到状态文件：$statusFile"
    exit 1
}

$lines = [System.IO.File]::ReadAllLines($statusFile, [System.Text.Encoding]::UTF8)

$entryRx = '^(\s+)([^\s#][^:]*?):\s*([A-Za-z-]+)\s*$'

function Get-Entries {
    $list = @()
    for ($i = 0; $i -lt $lines.Count; $i++) {
        $m = [regex]::Match($lines[$i], $entryRx)
        if (-not $m.Success) { continue }
        $key = $m.Groups[2].Value.Trim()
        $epicNum = -1
        $storyNum = -1
        if ($key -match '^epic-(\d+)$') { $epicNum = [int]$Matches[1] }
        elseif ($key -match '^epic-(\d+)-retrospective$') { $epicNum = [int]$Matches[1] }
        elseif ($key -match '^(\d+)-(\d+)-') { $epicNum = [int]$Matches[1]; $storyNum = [int]$Matches[2] }
        else { continue }
        $list += [pscustomobject]@{
            Key    = $key
            Status = $m.Groups[3].Value
            Epic   = $epicNum
            Story  = $storyNum
        }
    }
    return $list
}

function Set-EntryStatus([string]$key, [string]$newStatus) {
    $hit = $false
    for ($i = 0; $i -lt $lines.Count; $i++) {
        $m = [regex]::Match($lines[$i], $entryRx)
        if ($m.Success -and $m.Groups[2].Value.Trim() -eq $key) {
            $lines[$i] = $m.Groups[1].Value + $key + ': ' + $newStatus
            $hit = $true
        }
    }
    if (-not $hit) { throw "状态文件里没有条目：$key" }
    return $newStatus
}

function Save-StatusFile {
    $stamp = Get-Date -Format 'MM-dd-yyyy HH:mm'
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -match '^last_updated:\s*') { $lines[$i] = "last_updated: $stamp" }
    }
    $text = ($lines -join "`n") + "`n"
    [System.IO.File]::WriteAllText($statusFile, $text, (New-Object System.Text.UTF8Encoding($false)))
}

function Invoke-Commit([string]$message, [switch]$AddAll) {
    if ($NoCommit) { Write-Host '  (跳过提交：-NoCommit)' -ForegroundColor DarkGray; return }
    if (-not (Test-Path -LiteralPath (Join-Path $repoRoot '.git'))) {
        Write-Host '  (不是 git 仓库，只改了文件；先运行 status.ps1 init)' -ForegroundColor DarkYellow
        return
    }
    Push-Location $repoRoot
    try {
        if ($AddAll) { git add -A | Out-Null } else { git add -- $statusFile | Out-Null }
        git commit -m $message | Out-Null
        if ($LASTEXITCODE -eq 0) { Write-Host "  committed: $message" -ForegroundColor DarkGray }
        else { Write-Host '  (没有可提交的改动)' -ForegroundColor DarkGray }
    }
    finally { Pop-Location }
}

function Show-Status {
    $entries = Get-Entries
    foreach ($e in ($entries | Sort-Object Epic, Story)) {
        $color = switch ($e.Status) {
            'done' { 'Green' }
            'review' { 'Cyan' }
            'in-progress' { 'Yellow' }
            'ready-for-dev' { 'Magenta' }
            default { 'Gray' }
        }
        Write-Host ('  {0,-58} {1}' -f $e.Key, $e.Status) -ForegroundColor $color
    }
    $next = Get-NextTarget
    if ($next) { Write-Host "`n下一条：$($next.Key)  $($next.From) → $($next.To)" -ForegroundColor White }
    else { Write-Host "`n全部故事已完成。" -ForegroundColor Green }
}

function Get-Stories {
    return (Get-Entries | Where-Object { $_.Story -ge 0 } | Sort-Object Epic, Story)
}

function Get-NextTarget {
    $stories = Get-Stories
    $inProgress = $stories | Where-Object { $_.Status -eq 'in-progress' } | Select-Object -First 1
    if ($inProgress) { return [pscustomobject]@{ Key = $inProgress.Key; From = 'in-progress'; To = 'review'; Epic = $inProgress.Epic } }

    $inReview = $stories | Where-Object { $_.Status -eq 'review' } | Select-Object -First 1
    if ($inReview) { return [pscustomobject]@{ Key = $inReview.Key; From = 'review'; To = 'done'; Epic = $inReview.Epic } }

    $ready = $stories | Where-Object { $_.Status -eq 'ready-for-dev' } | Select-Object -First 1
    if ($ready) { return [pscustomobject]@{ Key = $ready.Key; From = 'ready-for-dev'; To = 'in-progress'; Epic = $ready.Epic } }

    $backlog = $stories | Where-Object { $_.Status -eq 'backlog' } | Select-Object -First 1
    if ($backlog) { return [pscustomobject]@{ Key = $backlog.Key; From = 'backlog'; To = 'in-progress'; Epic = $backlog.Epic } }

    return $null
}

function Sync-EpicOnStart([int]$epicNum) {
    $epicKey = "epic-$epicNum"
    $epic = Get-Entries | Where-Object { $_.Key -eq $epicKey } | Select-Object -First 1
    if ($epic -and $epic.Status -eq 'backlog') { Set-EntryStatus $epicKey 'in-progress' | Out-Null }
}

function Sync-EpicOnDone([int]$epicNum) {
    $all = Get-Stories | Where-Object { $_.Epic -eq $epicNum }
    if (-not $all) { return }
    $open = $all | Where-Object { $_.Status -ne 'done' }
    if (-not $open) {
        $epicKey = "epic-$epicNum"
        $epic = Get-Entries | Where-Object { $_.Key -eq $epicKey } | Select-Object -First 1
        if ($epic -and $epic.Status -ne 'done') {
            Set-EntryStatus $epicKey 'done' | Out-Null
            Write-Host "  epic-$epicNum 全部故事完成 → done" -ForegroundColor Green
        }
    }
}

function Run-Next {
    $target = Get-NextTarget
    if (-not $target) { Write-Host '全部故事已完成，没有可推进的条目。' -ForegroundColor Green; return }
    Set-EntryStatus $target.Key $target.To | Out-Null
    if ($target.To -eq 'in-progress') { Sync-EpicOnStart $target.Epic }
    if ($target.To -eq 'done') { Sync-EpicOnDone $target.Epic }
    Save-StatusFile
    Write-Host ("{0}  {1} → {2}" -f $target.Key, $target.From, $target.To) -ForegroundColor Yellow
    Invoke-Commit ("status: {0} {1}" -f (Get-StoryLabel $target.Key), $target.To)
}

function Get-StoryLabel([string]$key) {
    if ($key -match '^(\d+)-(\d+)-') { return "$($Matches[1]).$($Matches[2])" }
    return $key
}

function Run-Set {
    if (-not $StoryKey -or -not $Status) {
        Write-Host '用法：status.ps1 set <故事键或 N.M> <状态>' -ForegroundColor Yellow
        exit 1
    }
    if ($validStatus -notcontains $Status) {
        Write-Host "状态必须是：$($validStatus -join ' | ')" -ForegroundColor Yellow
        exit 1
    }
    $entries = Get-Entries
    $found = $entries | Where-Object { $_.Key -eq $StoryKey }
    if (-not $found -and $StoryKey -match '^\d+\.\d+$') {
        $num = $StoryKey -replace '\.', '-'
        $found = $entries | Where-Object { $_.Key -like "$num-*" } | Select-Object -First 1
    }
    if (-not $found) { Write-Host "找不到条目：$StoryKey" -ForegroundColor Red; exit 1 }
    $target = @($found)[0]
    Set-EntryStatus $target.Key $Status | Out-Null
    if ($Status -eq 'in-progress') { Sync-EpicOnStart $target.Epic }
    if ($Status -eq 'done') { Sync-EpicOnDone $target.Epic }
    Save-StatusFile
    Write-Host ("{0}  → {1}" -f $target.Key, $Status) -ForegroundColor Yellow
    Invoke-Commit ("status: {0} {1}" -f (Get-StoryLabel $target.Key), $Status)
}

function Run-Init {
    $gitDir = Join-Path $repoRoot '.git'
    if (Test-Path -LiteralPath $gitDir) { Write-Host '已经是 git 仓库。' -ForegroundColor Gray }
    else {
        Push-Location $repoRoot
        try {
            git init -b main | Out-Null
            if ($LASTEXITCODE -ne 0) { git init | Out-Null }
        }
        finally { Pop-Location }
        Write-Host 'git 仓库已初始化（main 分支）。' -ForegroundColor Green
    }
    Invoke-Commit 'chore: 初始化规划产物与冲刺状态' -AddAll
}

switch ($Command.ToLower()) {
    'show' { Show-Status }
    'next' { Run-Next }
    'set' { Run-Set }
    'init' { Run-Init }
    default {
        Write-Host @'
用法：
  status.ps1 show              查看状态与下一条要推进的故事
  status.ps1 next             推进一步（in-progress→review→done；backlog→in-progress）
  status.ps1 next -NoCommit   只改文件，不提交
  status.ps1 set 1.1 done     手动设置状态
  status.ps1 init             git init 并提交初始状态
'@ -ForegroundColor White
    }
}
