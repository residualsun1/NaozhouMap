# Loopback-only storage. The public deployment uses the authenticated Netlify handler.
$journalFile = Join-Path $PSScriptRoot 'data\field-entries.json'

function Journal-Text($Value, [int]$Limit, [bool]$Required = $false) {
    if ($null -eq $Value -and -not $Required) { return '' }
    if ($Value -isnot [string] -or $Value.Length -gt $Limit -or ($Required -and -not $Value.Trim())) { throw 'Invalid or empty journal field.' }
    return $Value.Trim()
}
function Normalize-JournalEntry($Item, $Previous) {
    $record = [ordered]@{
        id = (Journal-Text $Item.id 120 $true)
        placeId = (Journal-Text $Item.placeId 120 $true)
        placeKind = $Item.placeKind
        title = (Journal-Text $Item.title 200 $true)
        content = (Journal-Text $Item.content 100000 $true)
        observedAt = (Journal-Text $Item.observedAt 10)
        datePrecision = $(if ($Item.datePrecision) { $Item.datePrecision } else { 'unknown' })
        originalDateText = (Journal-Text $Item.originalDateText 300)
        recordType = $(if ($Item.recordType) { $Item.recordType } else { 'other' })
        source = (Journal-Text $Item.source 3000)
        visibility = $(if ($Item.visibility) { $Item.visibility } elseif ($Previous.visibility) { $Previous.visibility } else { 'editors' })
    }
    if ($record.placeKind -cnotin @('reference','survey') -or $record.recordType -cnotin @('observation','interview','ritual','research','other') -or $record.visibility -cnotin @('editors','public')) { throw 'Invalid journal type, place or visibility.' }
    if ($record.datePrecision -ceq 'unknown') {
        if ($record.observedAt) { throw 'Unknown dates must use the original date description, not an inferred date.' }
    } else {
        $patterns = @{ day = '^\d{4}-\d{2}-\d{2}$'; month = '^\d{4}-\d{2}$'; year = '^\d{4}$' }
        if (-not $patterns.ContainsKey($record.datePrecision) -or $record.observedAt -cnotmatch $patterns[$record.datePrecision]) { throw 'Date precision and observation date do not match.' }
        $full = $record.observedAt + $(if ($record.datePrecision -ceq 'year') { '-01-01' } elseif ($record.datePrecision -ceq 'month') { '-01' } else { '' })
        $parsed = [DateTime]::MinValue
        if (-not [DateTime]::TryParseExact($full,'yyyy-MM-dd',[Globalization.CultureInfo]::InvariantCulture,[Globalization.DateTimeStyles]::None,[ref]$parsed)) { throw 'Invalid observation date.' }
    }
    $tags = New-Object 'System.Collections.Generic.List[string]'
    if ($null -ne $Item.tags -and ($Item.tags -isnot [array] -or $Item.tags.Count -gt 30)) { throw 'Invalid journal tags.' }
    foreach ($tag in $Item.tags) { $value = Journal-Text $tag 50 $true; if ($tags -cnotcontains $value) { $tags.Add($value) } }
    $record.tags = @($tags.ToArray())
    $deities = @()
    if ($null -ne $Item.deityIds) { $deities = $Item.deityIds }
    elseif ($null -ne $Previous.deityIds) { $deities = $Previous.deityIds }
    if ($deities -isnot [array] -or $deities.Count -gt 100) { throw 'Invalid deity references.' }
    $deityIds = New-Object 'System.Collections.Generic.List[string]'
    foreach ($id in $deities) { $value = Journal-Text $id 120 $true; if ($deityIds -cnotcontains $value) { $deityIds.Add($value) } }
    $record.deityIds = @($deityIds.ToArray())
    $record.legacyKey = Journal-Text $(if ($null -ne $Item.legacyKey) { $Item.legacyKey } else { $Previous.legacyKey }) 300
    if ($null -ne $Previous -and ($Previous.placeId -cne $record.placeId -or $Previous.placeKind -cne $record.placeKind -or [string]$Previous.legacyKey -cne $record.legacyKey)) { throw 'Cannot change the place or legacy source of an existing entry.' }
    $now = [DateTimeOffset]::UtcNow
    if ($Previous.updatedAt -and $now -le [DateTimeOffset]::Parse($Previous.updatedAt)) { $now = [DateTimeOffset]::Parse($Previous.updatedAt).AddMilliseconds(1) }
    $record.createdAt = if ($Previous.createdAt) { $Previous.createdAt } else { $now.ToString('o') }
    $record.updatedAt = $now.ToString('o')
    return $record
}
function Read-Journal {
    if (-not [IO.File]::Exists($journalFile)) { return @{ version = 1; revision = 0; records = @() } }
    if ((Get-Item -LiteralPath $journalFile).Length -gt $maxPointBytes) { throw 'Journal file is too large.' }
    $state = Parse-Json ([IO.File]::ReadAllText($journalFile, $utf8))
    if ($state.version -ne 1 -or -not (Test-Revision $state.revision) -or $state.records -isnot [array]) { throw 'Invalid journal file.' }
    $ids = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
    foreach ($entry in $state.records) { if ($entry.id -isnot [string] -or -not $ids.Add($entry.id)) { throw 'Duplicate or invalid journal ID.' } }
    return @{ version = 1; revision = [int]$state.revision; records = @($state.records) }
}
function Write-Journal($State) {
    $json = ConvertTo-Json -InputObject $State -Depth 12
    if ($utf8.GetByteCount($json) -gt $maxPointBytes) { throw 'Journal data exceeds 10 MB.' }
    [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($journalFile)) | Out-Null
    $temporary = $journalFile + '.' + [Guid]::NewGuid().ToString('N') + '.tmp'
    try {
        [IO.File]::WriteAllText($temporary, $json, $utf8)
        if ([IO.File]::Exists($journalFile)) { [IO.File]::Replace($temporary, $journalFile, $journalFile + '.bak', $true) }
        else { [IO.File]::Move($temporary, $journalFile) }
    } finally { if ([IO.File]::Exists($temporary)) { [IO.File]::Delete($temporary) } }
}
function Journal-Response($State, $Request) {
    $placeId = $Request.QueryString['placeId']; $placeKind = $Request.QueryString['placeKind']
    return @{ version = 1; revision = $State.revision; editable = $true; records = @($State.records | Where-Object { (-not $placeId -or $_.placeId -ceq $placeId) -and (-not $placeKind -or $_.placeKind -ceq $placeKind) }) }
}
function Handle-JournalRequest($Context) {
    $request = $Context.Request
    if ($request.HttpMethod -notin @('GET','POST')) { $Context.Response.Headers.Add('Allow','GET, POST'); Send-Json $Context 405 @{ error = 'Method not allowed.' }; return }
    $origin = $request.Headers['Origin']
    if ($origin -and $origin -ne $serverUrl.TrimEnd('/')) { Send-Json $Context 403 @{ error = 'Only the loopback map can access local journals.' }; return }
    try { $current = Read-Journal } catch { Send-Json $Context 503 @{ error = 'Journal file could not be read. Existing data has been retained.' }; return }
    if ($request.HttpMethod -eq 'GET') { Send-Json $Context 200 (Journal-Response $current $request); return }
    if (-not $request.ContentType -or $request.ContentType.Split(';')[0].Trim() -ne 'application/json') { Send-Json $Context 415 @{ error = 'Use application/json.' }; return }
    try {
        $body = Read-JsonBody $request
        if ($body.version -ne 1 -or -not (Test-Revision $body.revision) -or $body.action -cnotin @('save','delete')) { throw 'Invalid journal version or action.' }
    } catch { Send-Json $Context 400 @{ error = $_.Exception.Message }; return }
    if ($body.revision -ne $current.revision) { $result = Journal-Response $current $request; $result.error = 'Journal changed in another page. Your text has been retained; please save again.'; Send-Json $Context 409 $result; return }
    $id = if ($body.action -ceq 'save') { $body.record.id } else { $body.id }
    $previous = $current.records | Where-Object { $_.id -ceq $id } | Select-Object -First 1
    if (($previous -and $body.baseUpdatedAt -cne $previous.updatedAt) -or (-not $previous -and $body.baseUpdatedAt)) { $result = Journal-Response $current $request; $result.recordConflict = $true; $result.error = 'This entry changed or was deleted. Your text is retained; reopen the latest entry.'; Send-Json $Context 409 $result; return }
    if ($body.action -ceq 'delete') {
        if (-not $previous) { Send-Json $Context 404 @{ error = 'Entry not found.' }; return }
        if ($body.confirmDelete -isnot [bool] -or -not $body.confirmDelete) { Send-Json $Context 400 @{ error = 'Deletion needs confirmation.' }; return }
        $records = @($current.records | Where-Object { $_.id -cne $id })
    } else {
        try { $record = Normalize-JournalEntry $body.record $previous } catch { Send-Json $Context 400 @{ error = $_.Exception.Message }; return }
        if ($record.visibility -ceq 'public' -and $previous.visibility -cne 'public' -and ($body.confirmPublic -isnot [bool] -or -not $body.confirmPublic)) { Send-Json $Context 400 @{ error = 'Please confirm before publishing this entry.' }; return }
        if ($record.legacyKey -and @($current.records | Where-Object { $_.id -cne $record.id -and $_.placeId -ceq $record.placeId -and $_.placeKind -ceq $record.placeKind -and $_.legacyKey -ceq $record.legacyKey }).Count) { $result = Journal-Response $current $request; $result.recordConflict = $true; $result.error = 'This legacy note already has a journal entry.'; Send-Json $Context 409 $result; return }
        $records = @($current.records | Where-Object { $_.id -cne $id }) + @($record)
        if ($records.Count -gt 50000) { Send-Json $Context 400 @{ error = 'Journal capacity limit reached.' }; return }
    }
    $next = @{ version = 1; revision = $current.revision + 1; records = $records }
    try { Write-Journal $next } catch { Send-Json $Context 503 @{ error = 'Journal could not be saved. Your text has been retained.' }; return }
    Send-Json $Context 200 (Journal-Response $next $request)
}
