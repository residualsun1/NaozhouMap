# Loopback-only editor storage. Public deployment uses server-side field allowlists.
$peopleFile = Join-Path $PSScriptRoot 'data\people.json'

function People-Text($Value, [int]$Limit, [bool]$Required = $false) {
    if ($null -eq $Value -and -not $Required) { return '' }
    if ($Value -isnot [string] -or $Value.Length -gt $Limit -or ($Required -and -not $Value.Trim())) { throw 'Invalid or empty person field.' }
    return $Value.Trim()
}
function People-Flag($Value) {
    if ($null -eq $Value) { return $false }
    if ($Value -isnot [bool]) { throw 'Public settings must be boolean.' }
    return $Value
}
function People-Value($Item, $Previous, [string]$Key) {
    $has = if ($Item -is [System.Collections.IDictionary]) { $Item.Contains($Key) } else { $null -ne $Item.PSObject.Properties[$Key] }
    if ($has) { return ,$Item.$Key }
    return ,$Previous.$Key
}
function People-Strings($Values, [int]$Maximum = 100, [int]$Length = 120) {
    if ($null -eq $Values) { return ,@() }
    if ($Values -isnot [array] -or $Values.Count -gt $Maximum) { throw 'Invalid person tags or references.' }
    $result = New-Object 'System.Collections.Generic.List[string]'
    foreach ($item in $Values) { $value = People-Text $item $Length $true; if ($result -cnotcontains $value) { $result.Add($value) } }
    return ,($result.ToArray())
}
function Normalize-PeopleLinks($Values) {
    if ($null -eq $Values) { return ,@() }
    if ($Values -isnot [array] -or $Values.Count -gt 100) { throw 'Invalid journal people links.' }
    $result = New-Object 'System.Collections.Generic.List[object]'
    $seen = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
    foreach ($item in $Values) {
        if ($null -eq $item) { throw 'Invalid journal people link.' }
        $personId = People-Text $item.personId 120 $true
        $role = People-Text $(if ($item.roleInEntry) { $item.roleInEntry } else { 'mentioned' }) 100 $true
        $key = ConvertTo-Json -InputObject @($personId,$role) -Compress
        if (-not $seen.Add($key)) { throw 'Duplicate person and role in the same journal.' }
        $result.Add([ordered]@{ personId = $personId; roleInEntry = $role; notes = (People-Text $item.notes 5000); narratedAt = (People-Text $item.narratedAt 100); eventDateText = (People-Text $item.eventDateText 300); narrativeSource = (People-Text $item.narrativeSource 3000); public = (People-Flag $item.public) })
    }
    return ,($result.ToArray())
}
function Normalize-Person($Item, $Previous) {
    if ($null -eq $Item -or $Item -is [array]) { throw 'Invalid person record.' }
    $record = [ordered]@{ id = (People-Text $Item.id 120 $true); displayName = (People-Text (People-Value $Item $Previous 'displayName') 200 $true) }
    if ($Previous -and $Previous.id -cne $record.id) { throw 'Cannot change person ID.' }
    $lengths = @{ surname = 100; realName = 200; religiousName = 200; biography = 100000; ritualQualificationNote = 20000; oralHistory = 100000; narratedAt = 100; eventDateText = 300; narrativeSource = 3000; researchNotes = 100000; source = 3000; publicSummary = 3000 }
    foreach ($key in $lengths.Keys) { $record[$key] = People-Text (People-Value $Item $Previous $key) $lengths[$key] }
    $record.aliases = People-Strings (People-Value $Item $Previous 'aliases') 100 200
    $record.roles = People-Strings (People-Value $Item $Previous 'roles') 50 100
    $record.deityIds = People-Strings (People-Value $Item $Previous 'deityIds')
    $record.visibility = People-Value $Item $Previous 'visibility'; if (-not $record.visibility) { $record.visibility = 'editors' }
    $record.narratorRole = People-Value $Item $Previous 'narratorRole'; if (-not $record.narratorRole) { $record.narratorRole = 'unknown' }
    if ($record.visibility -cnotin @('editors','summary','public') -or $record.narratorRole -cnotin @('participant','eyewitness','reteller','mentioned','unknown')) { throw 'Invalid visibility or narrator role.' }
    $record.publishIdentity = People-Flag (People-Value $Item $Previous 'publishIdentity')
    $record.publishOralHistory = People-Flag (People-Value $Item $Previous 'publishOralHistory')
    $links = People-Value $Item $Previous 'placeLinks'
    if ($null -eq $links) { $links = @() }
    if ($links -isnot [array] -or $links.Count -gt 100) { throw 'Invalid place links.' }
    $placeLinks = New-Object 'System.Collections.Generic.List[object]'
    $ids = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
    foreach ($link in $links) {
        $id = People-Text $link.id 120 $true
        if (-not $ids.Add($id) -or $link.placeKind -cnotin @('reference','survey')) { throw 'Duplicate link ID or invalid place kind.' }
        $placeLinks.Add([ordered]@{ id = $id; placeId = (People-Text $link.placeId 120 $true); placeKind = $link.placeKind; relationType = (People-Text $(if ($link.relationType) { $link.relationType } else { 'visit' }) 100 $true); notes = (People-Text $link.notes 5000); source = (People-Text $link.source 3000); public = (People-Flag $link.public) })
    }
    $record.placeLinks = @($placeLinks.ToArray())
    $now = [DateTimeOffset]::UtcNow
    if ($Previous.updatedAt -and $now -le [DateTimeOffset]::Parse($Previous.updatedAt)) { $now = [DateTimeOffset]::Parse($Previous.updatedAt).AddMilliseconds(1) }
    $record.createdAt = if ($Previous.createdAt) { $Previous.createdAt } else { $now.ToString('o') }
    $record.updatedAt = $now.ToString('o')
    return $record
}
function People-WiderPublication($Record, $Previous) {
    $rank = @{ editors = 0; summary = 1; public = 2 }
    $oldVisibility = if ($Previous.visibility) { $Previous.visibility } else { 'editors' }
    if ($rank[$Record.visibility] -gt $rank[$oldVisibility]) { return $true }
    if ($Record.visibility -cne 'editors') { foreach ($link in $Record.placeLinks) { if ($link.public -and -not @($Previous.placeLinks | Where-Object { $_.id -ceq $link.id -and $_.public }).Count) { return $true } } }
    if ($Record.visibility -cne 'editors' -and $Record.publishIdentity -and -not $Previous.publishIdentity) { return $true }
    if ($Record.visibility -cne 'public') { return $false }
    if ($Record.publishOralHistory -and -not $Previous.publishOralHistory) { return $true }
    return $false
}
function Read-People {
    if (-not [IO.File]::Exists($peopleFile)) { return @{ version = 1; revision = 0; records = @() } }
    if ((Get-Item -LiteralPath $peopleFile).Length -gt $maxPointBytes) { throw 'People file is too large.' }
    $state = Parse-Json ([IO.File]::ReadAllText($peopleFile, $utf8))
    if ($state.version -ne 1 -or -not (Test-Revision $state.revision) -or $state.records -isnot [array]) { throw 'Invalid people file.' }
    $ids = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
    foreach ($entry in $state.records) { if ($entry.id -isnot [string] -or -not $ids.Add($entry.id)) { throw 'Duplicate or invalid person ID.' } }
    return @{ version = 1; revision = [int]$state.revision; records = @($state.records) }
}
function Write-People($State) {
    $json = ConvertTo-Json -InputObject $State -Depth 15
    if ($utf8.GetByteCount($json) -gt $maxPointBytes) { throw 'People data exceeds 10 MB.' }
    [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($peopleFile)) | Out-Null
    $temporary = $peopleFile + '.' + [Guid]::NewGuid().ToString('N') + '.tmp'
    try {
        [IO.File]::WriteAllText($temporary, $json, $utf8)
        if ([IO.File]::Exists($peopleFile)) { [IO.File]::Replace($temporary, $peopleFile, $peopleFile + '.bak', $true) }
        else { [IO.File]::Move($temporary, $peopleFile) }
    } finally { if ([IO.File]::Exists($temporary)) { [IO.File]::Delete($temporary) } }
}
function People-Response($State, $Request) {
    $id = $Request.QueryString['id']; $placeId = $Request.QueryString['placeId']; $placeKind = $Request.QueryString['placeKind']
    $records = @($State.records | Where-Object { (-not $id -or $_.id -ceq $id) -and (-not $placeId -or @($_.placeLinks | Where-Object { $_.placeId -ceq $placeId -and (-not $placeKind -or $_.placeKind -ceq $placeKind) }).Count) })
    return @{ version = 1; revision = $State.revision; editable = $true; records = $records }
}
function Handle-PeopleRequest($Context) {
    $request = $Context.Request
    if ($request.HttpMethod -notin @('GET','POST')) { $Context.Response.Headers.Add('Allow','GET, POST'); Send-Json $Context 405 @{ error = 'Method not allowed.' }; return }
    $origin = $request.Headers['Origin']
    if ($origin -and $origin -ne $serverUrl.TrimEnd('/')) { Send-Json $Context 403 @{ error = 'Only the loopback map can access local people records.' }; return }
    try { $current = Read-People } catch { Send-Json $Context 503 @{ error = 'People file could not be read. Existing data has been retained.' }; return }
    if ($request.HttpMethod -eq 'GET') { Send-Json $Context 200 (People-Response $current $request); return }
    if (-not $request.ContentType -or $request.ContentType.Split(';')[0].Trim() -ne 'application/json') { Send-Json $Context 415 @{ error = 'Use application/json.' }; return }
    try { $body = Read-JsonBody $request; if ($body.version -ne 1 -or -not (Test-Revision $body.revision) -or $body.action -cne 'save') { throw 'Invalid people version or action.' } }
    catch { Send-Json $Context 400 @{ error = $_.Exception.Message }; return }
    if ($body.revision -ne $current.revision) { $result = People-Response $current $request; $result.error = 'People changed in another page. Your input is retained; please save again.'; Send-Json $Context 409 $result; return }
    $previous = $current.records | Where-Object { $_.id -ceq $body.record.id } | Select-Object -First 1
    if (($previous -and $body.baseUpdatedAt -cne $previous.updatedAt) -or (-not $previous -and $body.baseUpdatedAt)) { $result = People-Response $current $request; $result.recordConflict = $true; $result.error = 'This person changed. Your input is retained; reopen the latest record.'; Send-Json $Context 409 $result; return }
    try { $record = Normalize-Person $body.record $previous } catch { Send-Json $Context 400 @{ error = $_.Exception.Message }; return }
    if ((People-WiderPublication $record $previous) -and ($body.confirmPublic -isnot [bool] -or -not $body.confirmPublic)) { Send-Json $Context 400 @{ error = 'Confirm the person public visibility explicitly.' }; return }
    $records = @($current.records | Where-Object { $_.id -cne $record.id }) + @($record)
    if ($records.Count -gt 20000) { Send-Json $Context 400 @{ error = 'People capacity limit reached.' }; return }
    $next = @{ version = 1; revision = $current.revision + 1; records = $records }
    try { Write-People $next } catch { Send-Json $Context 503 @{ error = 'Person could not be saved. Your input is retained.' }; return }
    Send-Json $Context 200 (People-Response $next $request)
}
