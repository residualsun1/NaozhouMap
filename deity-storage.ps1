$deityFile = Join-Path $PSScriptRoot 'data\deities.json'
$initialDeityTitles = @(
    @{id='hui-zhu';name='会主'}, @{id='jing-zhu';name='境主'}, @{id='jun-zhu';name='军主'}, @{id='ying-zhu';name='营主'},
    @{id='bu-zhu';name='埠主'}, @{id='fu-zhu';name='福主'}, @{id='he-zhu';name='褐主'}, @{id='an-zhu';name='案主'}
)
function Get-DeityText($Value, [int]$Limit) {
    if ($null -eq $Value) { return '' }
    if ($Value -isnot [string] -or $Value.Length -gt $Limit) { throw 'Invalid deity text.' }
    return $Value.Trim()
}
function Test-DeityId($Value, [int]$Limit=120) { return ($Value -is [string] -and $Value.Trim().Length -gt 0 -and $Value.Length -le $Limit) }
function Normalize-DeityCatalog($Body, $Previous=$null) {
    if ($Body.titles -isnot [array] -or $Body.titles.Count -gt 200 -or $Body.records -isnot [array] -or $Body.records.Count -gt 10000) { throw 'Invalid deity catalog.' }
    $titleIds = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
    $titleNames = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
    $titles = New-Object 'System.Collections.Generic.List[object]'
    foreach ($title in $Body.titles) {
        if (-not (Test-DeityId $title.id) -or -not (Test-DeityId $title.name 80) -or -not $titleIds.Add($title.id) -or -not $titleNames.Add($title.name.Trim())) { throw 'Invalid or duplicate title.' }
        $titles.Add(@{id=$title.id;name=$title.name.Trim()})
    }
    foreach ($original in $initialDeityTitles) { if (-not ($titles | Where-Object { $_.id -ceq $original.id -and $_.name -ceq $original.name })) { throw 'Retain the eight original local titles.' } }
    foreach ($original in $Previous.titles) { if (-not $titleIds.Contains($original.id)) { throw 'Retain existing title IDs.' } }
    $ids = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
    $records = New-Object 'System.Collections.Generic.List[object]'
    foreach ($item in $Body.records) {
        if (-not (Test-DeityId $item.id) -or -not $ids.Add($item.id) -or -not (Test-DeityId $item.name 100)) { throw 'Invalid deity ID or name.' }
        if ($item.aliases -isnot [array] -or $item.aliases.Count -gt 100 -or $item.titleIds -isnot [array]) { throw 'Invalid deity aliases or titles.' }
        $aliases = New-Object 'System.Collections.Generic.List[string]'
        foreach ($alias in $item.aliases) { if (-not (Test-DeityId $alias 100)) { throw 'Invalid alias.' }; $aliases.Add($alias.Trim()) }
        $chosen = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
        foreach ($title in $item.titleIds) { if ($title -isnot [string] -or -not $titleIds.Contains($title) -or -not $chosen.Add($title)) { throw 'Invalid title reference.' } }
        $record = [ordered]@{ id=$item.id;name=$item.name.Trim();aliases=$aliases.ToArray();titleIds=@($item.titleIds) }
        foreach ($field in @('description','identityNote','source','createdAt','updatedAt','archivedAt')) {
            $limit = switch ($field) { 'description' {20000} 'identityNote' {10000} 'source' {2000} default {100} }
            $record[$field] = Get-DeityText $item.$field $limit
        }
        foreach ($field in @('createdAt','updatedAt')) { if (-not $record[$field]) { $record[$field] = [DateTime]::UtcNow.ToString('o') } }
        $records.Add($record)
    }
    foreach ($old in $Previous.records) { if (-not $ids.Contains($old.id)) { throw 'Archive deity records instead of removing existing IDs.' } }
    return @{titles=$titles.ToArray();records=$records.ToArray()}
}
function Read-Deities {
    if (-not [IO.File]::Exists($deityFile)) { return @{version=1;revision=0;titles=$initialDeityTitles;records=@()} }
    if ((Get-Item -LiteralPath $deityFile).Length -gt $maxPointBytes) { throw 'Deity file is too large.' }
    $state = Parse-Json ([IO.File]::ReadAllText($deityFile,$utf8))
    if ($state.version -ne 1 -or -not (Test-Revision $state.revision)) { throw 'Invalid deity revision.' }
    $normalized = Normalize-DeityCatalog $state
    return @{version=1;revision=[int]$state.revision;titles=$normalized.titles;records=$normalized.records}
}
function Normalize-DeityLinks($Items, $Names, $Catalog) {
    if ($Items -isnot [array] -or $Items.Count -gt 100) { throw 'Invalid deity links.' }
    $ids = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
    $slots = New-Object 'System.Collections.Generic.HashSet[int]'
    $links = New-Object 'System.Collections.Generic.List[object]'
    foreach ($item in $Items) {
        if (-not (Test-DeityId $item.id) -or -not $ids.Add($item.id) -or $Catalog.records.id -cnotcontains $item.deityId) { throw 'Invalid deity reference.' }
        if (-not (Test-JsonNumber $item.nameIndex) -or [Math]::Floor($item.nameIndex) -ne $item.nameIndex -or $item.nameIndex -lt 0 -or $item.nameIndex -ge $Names.Count -or -not $slots.Add([int]$item.nameIndex)) { throw 'Invalid deity name slot.' }
        $links.Add(@{id=$item.id;deityId=$item.deityId;nameIndex=[int]$item.nameIndex;localName=(Get-DeityText $item.localName 100);localTitle=(Get-DeityText $item.localTitle 200)})
    }
    return ,($links.ToArray())
}
function Handle-DeitiesRequest($Context) {
    $request=$Context.Request
    if ($request.HttpMethod -notin @('GET','POST')) { $Context.Response.Headers.Add('Allow','GET, POST'); Send-Json $Context 405 @{error='Method not allowed.'}; return }
    if ($request.HttpMethod -eq 'POST') {
        if ($request.Headers['Origin'] -and $request.Headers['Origin'] -ne $serverUrl.TrimEnd('/')) { Send-Json $Context 403 @{error='Only the local map can save records.'}; return }
        if (-not $request.ContentType -or $request.ContentType.Split(';')[0].Trim() -ne 'application/json') { Send-Json $Context 415 @{error='Use application/json.'}; return }
    }
    try { $current=Read-Deities } catch { Send-Json $Context 500 @{error='Deity catalog could not be read. Existing data is retained.'}; return }
    if ($request.HttpMethod -eq 'GET') { Send-Json $Context 200 $current; return }
    try {
        $body=Read-JsonBody $request
        if ($body.version -ne 1 -or -not (Test-Revision $body.revision)) { throw 'Invalid deity revision.' }
        $next=Normalize-DeityCatalog $body $current
    } catch { Send-Json $Context 400 @{error=$_.Exception.Message}; return }
    if ([int]$body.revision -ne $current.revision) { Send-Json $Context 409 $current; return }
    $next.version=1; $next.revision=$current.revision+1
    $temporary=$deityFile+'.'+[Guid]::NewGuid().ToString('N')+'.tmp'
    try {
        $json=ConvertTo-Json -InputObject $next -Depth 16
        if ($utf8.GetByteCount($json) -gt $maxPointBytes) { throw 'Deity data exceeds size limit.' }
        [IO.File]::WriteAllText($temporary,$json,$utf8)
        if ([IO.File]::Exists($deityFile)) { [IO.File]::Replace($temporary,$deityFile,$deityFile+'.bak',$true) } else { [IO.File]::Move($temporary,$deityFile) }
    } catch { Send-Json $Context 500 @{error='Deity data could not be saved.'}; return }
    finally { if ([IO.File]::Exists($temporary)) { [IO.File]::Delete($temporary) } }
    Send-Json $Context 200 $next
}
