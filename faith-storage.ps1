$faithFile = Join-Path $PSScriptRoot 'data\village-faith.json'

function Normalize-FaithRecords($Items) {
    if ($Items -isnot [array] -or $Items.Count -gt 10000) { throw 'Invalid faith records.' }
    $records = New-Object 'System.Collections.Generic.List[object]'
    $ids = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
    foreach ($item in $Items) {
        if ($item.id -isnot [string] -or $item.id.Length -eq 0 -or $item.id.Length -gt 120 -or -not $ids.Add($item.id)) { throw 'Invalid record ID.' }
        if ($item.villageId -isnot [string] -or $item.villageId.Length -eq 0 -or $item.villageId.Length -gt 120 -or $item.villageKind -cnotin @('reference','survey')) { throw 'Invalid village reference.' }
        if ($item.villageName -isnot [string] -or $item.villageName.Trim().Length -eq 0 -or $item.villageName.Length -gt 100) { throw 'Invalid village name.' }
        if ($item.deities -isnot [array] -or $item.deities.Count -lt 1 -or $item.deities.Count -gt 100) { throw 'Enter at least one deity.' }
        $deities = New-Object 'System.Collections.Generic.List[string]'
        $names = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
        foreach ($name in $item.deities) {
            if ($name -isnot [string] -or $name.Trim().Length -eq 0 -or $name.Length -gt 100) { throw 'Invalid deity name.' }
            if ($names.Add($name.Trim())) { $deities.Add($name.Trim()) }
        }
        $record = [ordered]@{ id = $item.id; villageId = $item.villageId; villageKind = $item.villageKind; villageName = $item.villageName.Trim(); deities = $deities.ToArray() }
        foreach ($field in @('temple','festival','source','visitedOn','note','createdAt','updatedAt')) {
            $limit = switch ($field) { 'festival' { 500 } 'note' { 5000 } 'visitedOn' { 10 } 'createdAt' { 100 } 'updatedAt' { 100 } default { 200 } }
            $value = $item.$field
            if ($null -ne $value -and ($value -isnot [string] -or $value.Length -gt $limit)) { throw ('Invalid record field: ' + $field) }
            $record[$field] = if ($null -eq $value) { '' } else { $value.Trim() }
        }
        if ($record.visitedOn) {
            $parsedDate = [datetime]::MinValue
            if (-not [datetime]::TryParseExact($record.visitedOn, 'yyyy-MM-dd', [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::None, [ref]$parsedDate)) { throw 'Invalid visit date.' }
        }
        foreach ($field in @('createdAt','updatedAt')) { if (-not $record[$field]) { $record[$field] = [DateTime]::UtcNow.ToString('o') } }
        $records.Add($record)
    }
    return ,($records.ToArray())
}

function Read-FaithFile {
    if (-not [IO.File]::Exists($faithFile) -or (Get-Item -LiteralPath $faithFile).Length -gt $maxPointBytes) { throw 'Faith data file is missing or too large.' }
    $state = Parse-Json ([IO.File]::ReadAllText($faithFile, $utf8))
    if ($state.version -ne 1 -or -not (Test-Revision $state.revision)) { throw 'Invalid faith data version.' }
    return @{ version = 1; revision = [int]$state.revision; records = (Normalize-FaithRecords $state.records) }
}

function Write-FaithFile($State) {
    $json = ConvertTo-Json -InputObject $State -Depth 12
    if ($utf8.GetByteCount($json) -gt $maxPointBytes) { throw 'Faith data exceeds 10 MB.' }
    $temporary = $faithFile + '.' + [Guid]::NewGuid().ToString('N') + '.tmp'
    try {
        [IO.File]::WriteAllText($temporary, $json, $utf8)
        if ([IO.File]::Exists($faithFile)) { [IO.File]::Replace($temporary, $faithFile, $faithFile + '.bak', $true) }
        else { [IO.File]::Move($temporary, $faithFile) }
    } finally { if ([IO.File]::Exists($temporary)) { [IO.File]::Delete($temporary) } }
}

function Handle-FaithRequest($Context) {
    $request = $Context.Request
    if ($request.HttpMethod -notin @('GET','POST')) {
        $Context.Response.Headers.Add('Allow','GET, POST')
        Send-Json $Context 405 @{ error = 'Method not allowed.' }
        return
    }
    if ($request.HttpMethod -eq 'POST') {
        $origin = $request.Headers['Origin']
        if ($origin -and $origin -ne $serverUrl.TrimEnd('/')) { Send-Json $Context 403 @{ error = 'Only the local map can save records.' }; return }
        if (-not $request.ContentType -or $request.ContentType.Split(';')[0].Trim() -ne 'application/json') { Send-Json $Context 415 @{ error = 'Use application/json.' }; return }
    }
    try { $current = Read-FaithFile } catch { Send-Json $Context 500 @{ error = 'Faith data could not be read. Existing records have been retained.' }; return }
    if ($request.HttpMethod -eq 'GET') { Send-Json $Context 200 $current; return }
    try {
        $body = Read-JsonBody $request
        if ($body.version -ne 1 -or -not (Test-Revision $body.revision)) { throw 'Invalid faith data version.' }
        $records = Normalize-FaithRecords $body.records
    } catch { Send-Json $Context 400 @{ error = $_.Exception.Message }; return }
    if ([int]$body.revision -ne $current.revision) {
        $current.error = 'Records changed in another page.'
        Send-Json $Context 409 $current
        return
    }
    $next = [ordered]@{ version = 1; revision = $current.revision + 1; records = $records }
    try { Write-FaithFile $next } catch { Send-Json $Context 500 @{ error = 'Faith data could not be saved.' }; return }
    Send-Json $Context 200 $next
}
