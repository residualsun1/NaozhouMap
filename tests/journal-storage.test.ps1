$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$maxPointBytes = 10 * 1024 * 1024
$utf8 = New-Object System.Text.UTF8Encoding($false)
function Parse-Json([string]$Text) {
    if ((Get-Command ConvertFrom-Json).Parameters.ContainsKey('DateKind')) { return (ConvertFrom-Json -InputObject $Text -DateKind String) }
    return (ConvertFrom-Json -InputObject $Text)
}
function Test-Revision($Value) { return ($null -ne $Value -and $Value -ge 0 -and [Math]::Floor([double]$Value) -eq $Value) }
. (Join-Path $projectRoot 'journal-storage.ps1')
$testRoot = Join-Path $projectRoot ('work\journal-storage-test-' + [Guid]::NewGuid().ToString('N'))
$journalFile = Join-Path $testRoot 'field-entries.json'
try {
    $records = @()
    foreach ($number in 1..3) {
        $item = @{ id = "isolated-$number"; placeId = 'test-village'; placeKind = 'reference'; title = "Test $number"; content = "Paragraph one`n`nParagraph two"; observedAt = "2026-10-0$number"; datePrecision = 'day'; tags = @() }
        $records += @(Normalize-JournalEntry $item $null)
    }
    Write-Journal @{ version = 1; revision = 1; records = $records }
    $loaded = Read-Journal
    if ($loaded.records.Count -ne 3 -or $loaded.records[0].visibility -cne 'editors' -or $loaded.records[0].deityIds.Count -ne 0) { throw 'Initial journal persistence failed.' }
    $changed = $loaded.records[1]; $changed.title = 'Edited only second'
    $records[1] = Normalize-JournalEntry $changed $loaded.records[1]
    Write-Journal @{ version = 1; revision = 2; records = $records }
    $records = @((Read-Journal).records | Where-Object { $_.id -cne 'isolated-1' })
    Write-Journal @{ version = 1; revision = 3; records = $records }
    $loaded = Read-Journal
    if ($loaded.records.Count -ne 2 -or $loaded.records[0].title -cne 'Edited only second' -or $loaded.records[1].title -cne 'Test 3') { throw 'Edit or deletion affected other entries.' }
    $unknown = Normalize-JournalEntry @{ id = 'unknown'; placeId = 'test-village'; placeKind = 'reference'; title = 'No date'; content = 'Historical note'; originalDateText = 'A winter of unknown year' } $null
    if ($unknown.observedAt -or $unknown.datePrecision -cne 'unknown') { throw 'Unknown date was invented.' }
    Write-Output 'PASS: isolated local journal create, edit, delete, reload and unknown-date compatibility.'
} finally {
    $resolvedRoot = [IO.Path]::GetFullPath($testRoot)
    $workspaceWork = [IO.Path]::GetFullPath((Join-Path $projectRoot 'work')) + [IO.Path]::DirectorySeparatorChar
    if ($resolvedRoot.StartsWith($workspaceWork,[StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $resolvedRoot)) { Remove-Item -LiteralPath $resolvedRoot -Recurse -Force }
}
