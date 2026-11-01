# 项目进度助手 —— 傻瓜菜单
# 由「开始.cmd」打开，不需要记任何命令。

$ErrorActionPreference = 'Continue'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

$root = Split-Path -Parent $PSScriptRoot
$engine = Join-Path $PSScriptRoot 'status.ps1'
$statusFile = Join-Path $root '_bmad-output/implementation-artifacts/sprint-status.yaml'

function Pause-Here {
    Write-Host ''
    Read-Host '按回车继续（直接关窗口也可以）' | Out-Null
}

function Test-Git {
    if (Get-Command git -ErrorAction SilentlyContinue) { return $true }
    Write-Host ''
    Write-Host '  没有找到 git。' -ForegroundColor Yellow
    Write-Host '  它用来记录“什么时候做完了什么”，答辩时要看这个记录。' -ForegroundColor Gray
    Write-Host ''
    Write-Host '  安装方法：打开 https://git-scm.com/download/win' -ForegroundColor White
    Write-Host '  下载后一路点“下一步”装完，然后关掉这个窗口重新双击 开始.cmd。' -ForegroundColor White
    Write-Host ''
    Write-Host '  不想装也可以：先不用记录，只在这个窗口里看进度、推状态。' -ForegroundColor Gray
    return $false
}

function Initialize-Repo {
    if (Test-Path -LiteralPath (Join-Path $root '.git')) { return }
    Write-Host ''
    Write-Host '  这是第一次使用，需要把项目放进版本管理（只做一次）。' -ForegroundColor Cyan
    $answer = Read-Host '  现在初始化吗？直接回车 = 是（输入 n 跳过）'
    if ($answer -eq 'n') { return }

    Push-Location $root
    try {
        git init -b main 2>$null | Out-Null
        if ($LASTEXITCODE -ne 0) { git init | Out-Null }

        $name = $null
        $email = $null
        try { $name = (git config user.name) } catch { }
        try { $email = (git config user.email) } catch { }
        if ([string]::IsNullOrWhiteSpace($name)) {
            $name = Read-Host '  你的名字（只写进提交记录，用拼音或中文都行）'
            git config --local user.name $name | Out-Null
        }
        if ([string]::IsNullOrWhiteSpace($email)) {
            $email = Read-Host '  你的邮箱（随便一个，不会发邮件）'
            git config --local user.email $email | Out-Null
        }

        git add -A | Out-Null
        git commit -m 'chore: 初始化项目与规划文档' | Out-Null
        Write-Host '  初始化完成。' -ForegroundColor Green
    }
    finally { Pop-Location }
}

function Show-Progress {
    & $engine show
}

function Advance-Step {
    & $engine next
}

function Set-Manual {
    Write-Host ''
    Write-Host '  可填的例子：1.1   2.3   7.4（看进度时左边那列的前两段数字）' -ForegroundColor Gray
    $key = Read-Host '  哪一条故事'
    if ([string]::IsNullOrWhiteSpace($key)) { return }
    Write-Host '  可选状态：backlog（没开始）  ready-for-dev（准备做）  in-progress（在做）  review（做完了待检查）  done（完成）' -ForegroundColor Gray
    $st = Read-Host '  改成什么状态'
    if ([string]::IsNullOrWhiteSpace($st)) { return }
    & $engine set $key $st
}

function Commit-Now {
    if (-not (Test-Path -LiteralPath (Join-Path $root '.git'))) {
        Write-Host '  还没有初始化版本管理，先重新双击本文件并选择初始化。' -ForegroundColor Yellow
        return
    }
    Push-Location $root
    try {
        $dirty = git status --porcelain
        if ([string]::IsNullOrWhiteSpace($dirty)) {
            Write-Host '  没有新改动，不用提交。' -ForegroundColor Gray
            return
        }
        $msg = Read-Host '  这次改了什么（直接回车 = 记作“更新进度”）'
        if ([string]::IsNullOrWhiteSpace($msg)) { $msg = '更新进度' }
        git add -A | Out-Null
        git commit -m $msg | Out-Null
        Write-Host '  已记录。' -ForegroundColor Green
    }
    finally { Pop-Location }
}

# ---------- 启动检查 ----------
Clear-Host
Write-Host ''
Write-Host '  校园活动积分平台 —— 项目进度助手' -ForegroundColor Cyan
Write-Host '  ───────────────────────────────' -ForegroundColor DarkGray

$hasGit = Test-Git
if ($hasGit) { Initialize-Repo }

if (-not (Test-Path -LiteralPath $statusFile)) {
    Write-Host ''
    Write-Host "  找不到进度文件：$statusFile" -ForegroundColor Red
    Pause-Here
    exit 1
}

# ---------- 菜单 ----------
while ($true) {
    Write-Host ''
    Write-Host '  1  看现在做到哪了'
    Write-Host '  2  把当前故事推进一步'
    Write-Host '  3  手动改某一条的状态'
    Write-Host '  4  把改动记录进历史'
    Write-Host '  0  退出'
    Write-Host ''
    $choice = Read-Host '  输入数字后回车'

    switch ($choice) {
        '1' { Show-Progress }
        '2' { Advance-Step }
        '3' { Set-Manual }
        '4' { Commit-Now }
        '0' { return }
        default { Write-Host '  请输入 0 到 4 之间的数字。' -ForegroundColor Yellow }
    }
}
