$archiveFile = Join-Path $PSScriptRoot 'data\place-archives.json'

function Normalize-Archives($Items) {
    if ($Items -isnot [array] -or $Items.Count -gt 10000) { throw 'Invalid archive records.' }
    $records = New-Object 'System.Collections.Generic.List[object]'
    $ids = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
    $places = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
    foreach ($item in $Items) {
        if ($item.id -isnot [string] -or -not $item.id -or $item.id.Length -gt 120 -or -not $ids.Add($item.id)) { throw 'Invalid archive ID.' }
        if ($item.villageId -isnot [string] -or -not $item.villageId -or $item.villageId.Length -gt 120 -or $item.villageKind -cnotin @('reference','survey')) { throw 'Invalid village reference.' }
        if ($item.villageName -isnot [string] -or -not $item.villageName.Trim() -or $item.villageName.Length -gt 100) { throw 'Invalid village name.' }
        if (-not $places.Add($item.villageKind + ':' + $item.villageId)) { throw 'Duplicate village archive.' }
        $record = [ordered]@{ id = $item.id; villageId = $item.villageId; villageKind = $item.villageKind; villageName = $item.villageName.Trim() }
        foreach ($field in @('introduction','note','createdAt','updatedAt')) {
            $limit = if ($field -in @('createdAt','updatedAt')) { 100 } else { 20000 }
            $value = $item.$field
            if ($null -ne $value -and ($value -isnot [string] -or $value.Length -gt $limit)) { throw 'Invalid archive text.' }
            $record[$field] = if ($null -eq $value) { '' } else { $value.Trim() }
        }
        foreach ($field in @('createdAt','updatedAt')) { if (-not $record[$field]) { $record[$field] = [DateTime]::UtcNow.ToString('o') } }
        $records.Add($record)
    }
    return ,($records.ToArray())
}

function Read-Archives {
    if (-not [IO.File]::Exists($archiveFile)) { return @{ version = 1; revision = 0; records = @() } }
    if ((Get-Item -LiteralPath $archiveFile).Length -gt $maxPointBytes) { throw 'Archive file is too large.' }
    $state = Parse-Json ([IO.File]::ReadAllText($archiveFile, $utf8))
    if ($state.version -ne 1 -or -not (Test-Revision $state.revision)) { throw 'Invalid archive version.' }
    return @{ version = 1; revision = [int]$state.revision; records = (Normalize-Archives $state.records) }
}

function Write-Archives($State) {
    $json = ConvertTo-Json -InputObject $State -Depth 12
    if ($utf8.GetByteCount($json) -gt $maxPointBytes) { throw 'Archive data exceeds 10 MB.' }
    $temporary = $archiveFile + '.' + [Guid]::NewGuid().ToString('N') + '.tmp'
    try {
        [IO.File]::WriteAllText($temporary, $json, $utf8)
        if ([IO.File]::Exists($archiveFile)) { [IO.File]::Replace($temporary, $archiveFile, $archiveFile + '.bak', $true) }
        else { [IO.File]::Move($temporary, $archiveFile) }
    } finally { if ([IO.File]::Exists($temporary)) { [IO.File]::Delete($temporary) } }
}

function Handle-ArchivesRequest($Context) {
    $request = $Context.Request
    if ($request.HttpMethod -notin @('GET','POST')) {
        $Context.Response.Headers.Add('Allow','GET, POST')
        Send-Json $Context 405 @{ error = 'Method not allowed.' }; return
    }
    if ($request.HttpMethod -eq 'POST') {
        $origin = $request.Headers['Origin']
        if ($origin -and $origin -ne $serverUrl.TrimEnd('/')) { Send-Json $Context 403 @{ error = 'Only the local map can save archives.' }; return }
        if (-not $request.ContentType -or $request.ContentType.Split(';')[0].Trim() -ne 'application/json') { Send-Json $Context 415 @{ error = 'Use application/json.' }; return }
    }
    try { $current = Read-Archives } catch { Send-Json $Context 500 @{ error = 'Archive data could not be read. Existing records have been retained.' }; return }
    if ($request.HttpMethod -eq 'GET') { Send-Json $Context 200 $current; return }
    try {
        $body = Read-JsonBody $request
        if ($body.version -ne 1 -or -not (Test-Revision $body.revision)) { throw 'Invalid archive version.' }
        $records = Normalize-Archives $body.records
    } catch { Send-Json $Context 400 @{ error = $_.Exception.Message }; return }
    if ([int]$body.revision -ne $current.revision) { Send-Json $Context 409 $current; return }
    $next = [ordered]@{ version = 1; revision = $current.revision + 1; records = $records }
    try { Write-Archives $next } catch { Send-Json $Context 500 @{ error = 'Archive data could not be saved.' }; return }
    Send-Json $Context 200 $next
}
