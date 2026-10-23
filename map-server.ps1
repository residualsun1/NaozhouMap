param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$mapFile = Join-Path $PSScriptRoot 'index.html'
$pointFile = Join-Path $PSScriptRoot 'data\field-points.geojson'
$migrationFile = Join-Path $PSScriptRoot 'data\survey-reference-migrations.json'
$seedFile = Join-Path $PSScriptRoot '硇洲岛调查点位-2026-10-11.geojson'
$maxPointBytes = 10 * 1024 * 1024
$utf8 = New-Object System.Text.UTF8Encoding($false)

function Parse-Json([string]$Text) {
    if ((Get-Command ConvertFrom-Json).Parameters.ContainsKey('DateKind')) {
        return (ConvertFrom-Json -InputObject $Text -DateKind String)
    }
    return (ConvertFrom-Json -InputObject $Text)
}

function Test-JsonNumber($Value) {
    return ($Value -is [byte] -or $Value -is [sbyte] -or $Value -is [int16] -or $Value -is [uint16] -or $Value -is [int32] -or $Value -is [uint32] -or $Value -is [int64] -or $Value -is [uint64] -or $Value -is [single] -or $Value -is [double] -or $Value -is [decimal])
}

function Test-Revision($Value) {
    return ((Test-JsonNumber $Value) -and [double]$Value -ge 0 -and [double]$Value -le 2147483646 -and [Math]::Floor([double]$Value) -eq [double]$Value)
}

function Normalize-Points($Items) {
    if ($null -eq $Items -or $Items -isnot [array] -or $Items.Count -gt 10000) { throw 'Invalid points array.' }
    $normalized = New-Object 'System.Collections.Generic.List[object]'
    $ids = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
    foreach ($point in $Items) {
        if ($null -eq $point -or $point.id -isnot [string] -or $point.id.Length -eq 0 -or $point.id.Length -gt 120 -or -not $ids.Add($point.id)) { throw 'Invalid or duplicate point ID.' }
        if ($point.name -isnot [string] -or $point.name.Trim().Length -eq 0 -or $point.name.Length -gt 100) { throw 'Invalid point name.' }
        if (-not (Test-JsonNumber $point.lat) -or -not (Test-JsonNumber $point.lng)) { throw 'Invalid point coordinates.' }
        $lat = [double]$point.lat
        $lng = [double]$point.lng
        if ([double]::IsNaN($lat) -or [double]::IsInfinity($lat) -or $lat -lt -90 -or $lat -gt 90 -or [double]::IsNaN($lng) -or [double]::IsInfinity($lng) -or $lng -lt -180 -or $lng -gt 180) { throw 'Invalid point coordinates.' }
        if ($null -ne $point.source -and ($point.source -isnot [string] -or $point.source.Length -gt 200)) { throw 'Invalid point source.' }
        if ($null -ne $point.note -and ($point.note -isnot [string] -or $point.note.Length -gt 5000)) { throw 'Invalid point note.' }
        if ($null -ne $point.createdAt -and ($point.createdAt -isnot [string] -or $point.createdAt.Length -gt 100)) { throw 'Invalid creation time.' }
        if ($null -ne $point.updatedAt -and ($point.updatedAt -isnot [string] -or $point.updatedAt.Length -gt 100)) { throw 'Invalid update time.' }
        $now = [DateTime]::UtcNow.ToString('o')
        $normalized.Add([ordered]@{
            id = $point.id
            name = $point.name.Trim()
            lat = $lat
            lng = $lng
            source = $(if ($null -ne $point.source) { $point.source } else { '' })
            note = $(if ($null -ne $point.note) { $point.note } else { '' })
            createdAt = $(if ($point.createdAt -is [string]) { $point.createdAt } else { $now })
            updatedAt = $(if ($point.updatedAt -is [string]) { $point.updatedAt } else { $now })
        })
    }
    return ,($normalized.ToArray())
}

function Read-PointFile([string]$Path, [switch]$Seed) {
    if (-not [System.IO.File]::Exists($Path)) { throw 'Survey data file is missing.' }
    if ((Get-Item -LiteralPath $Path).Length -gt $maxPointBytes) { throw 'Survey data file exceeds 10 MB.' }
    $document = Parse-Json ([System.IO.File]::ReadAllText($Path, $utf8))
    if ($document.type -ne 'FeatureCollection' -or $document.schemaVersion -ne 1 -or $document.coordinateSystem -ne 'WGS84' -or $document.features -isnot [array]) { throw 'Invalid survey GeoJSON file.' }
    $rawPoints = New-Object 'System.Collections.Generic.List[object]'
    foreach ($feature in $document.features) {
        if ($feature.type -ne 'Feature' -or $feature.geometry.type -ne 'Point' -or $feature.geometry.coordinates -isnot [array] -or $feature.geometry.coordinates.Count -ne 2) { throw 'Invalid GeoJSON point.' }
        $rawPoints.Add(@{
            id = $feature.id
            name = $feature.properties.name
            lat = $feature.geometry.coordinates[1]
            lng = $feature.geometry.coordinates[0]
            source = $feature.properties.source
            note = $feature.properties.note
            createdAt = $feature.properties.createdAt
            updatedAt = $feature.properties.updatedAt
        })
    }
    $points = Normalize-Points $rawPoints.ToArray()
    $revision = 1
    $deleted = New-Object 'System.Collections.Generic.List[string]'
    if (-not $Seed) {
        if (-not (Test-Revision $document.revision) -or $document.deletedIds -isnot [array]) { throw 'Invalid survey revision or deletion history.' }
        $revision = [int]$document.revision
        $seen = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
        foreach ($id in $document.deletedIds) {
            if ($id -isnot [string] -or $id.Length -eq 0 -or $id.Length -gt 120 -or -not $seen.Add($id)) { throw 'Invalid deleted point ID.' }
            if ($points.id -ccontains $id) { throw 'Active point appears in deletion history.' }
            $deleted.Add($id)
        }
    }
    return @{ version = 1; revision = $revision; points = $points; deletedIds = $deleted.ToArray() }
}

function Write-PointFile($State) {
    $features = @($State.points | ForEach-Object {
        [ordered]@{
            type = 'Feature'
            id = $_.id
            geometry = [ordered]@{ type = 'Point'; coordinates = @($_.lng, $_.lat) }
            properties = [ordered]@{ name = $_.name; source = $_.source; note = $_.note; createdAt = $_.createdAt; updatedAt = $_.updatedAt }
        }
    })
    $document = [ordered]@{
        type = 'FeatureCollection'
        name = 'Naozhou field survey points'
        schemaVersion = 1
        coordinateSystem = 'WGS84'
        exportedAt = [DateTime]::UtcNow.ToString('o')
        revision = $State.revision
        deletedIds = @($State.deletedIds)
        features = $features
    }
    $json = ConvertTo-Json -InputObject $document -Depth 12
    if ($utf8.GetByteCount($json) -gt $maxPointBytes) { throw 'Survey data exceeds 10 MB.' }
    [System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($pointFile)) | Out-Null
    $temporary = $pointFile + '.' + [Guid]::NewGuid().ToString('N') + '.tmp'
    try {
        [System.IO.File]::WriteAllText($temporary, $json, $utf8)
        if ([System.IO.File]::Exists($pointFile)) {
            [System.IO.File]::Replace($temporary, $pointFile, $pointFile + '.bak', $true)
        } else {
            [System.IO.File]::Move($temporary, $pointFile)
        }
    } finally {
        if ([System.IO.File]::Exists($temporary)) { [System.IO.File]::Delete($temporary) }
    }
}

function Send-Json($Context, [int]$Status, $Value) {
    $bytes = $utf8.GetBytes((ConvertTo-Json -InputObject $Value -Depth 12 -Compress))
    $Context.Response.StatusCode = $Status
    $Context.Response.ContentType = 'application/json; charset=utf-8'
    $Context.Response.ContentLength64 = $bytes.Length
    $Context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
}

function Read-JsonBody($Request) {
    if ($Request.ContentLength64 -gt $maxPointBytes) { throw 'Request exceeds 10 MB.' }
    $stream = New-Object System.IO.MemoryStream
    $buffer = New-Object byte[] 8192
    try {
        while (($length = $Request.InputStream.Read($buffer, 0, $buffer.Length)) -gt 0) {
            if ($stream.Length + $length -gt $maxPointBytes) { throw 'Request exceeds 10 MB.' }
            $stream.Write($buffer, 0, $length)
        }
        return (Parse-Json ($utf8.GetString($stream.ToArray())))
    } finally { $stream.Dispose() }
}

function Handle-PointsRequest($Context) {
    $request = $Context.Request
    if ($request.HttpMethod -ne 'GET' -and $request.HttpMethod -ne 'POST') {
        $Context.Response.Headers.Add('Allow', 'GET, POST')
        Send-Json $Context 405 @{ error = 'Method not allowed.' }
        return
    }
    if ($request.HttpMethod -eq 'POST') {
        $origin = $request.Headers['Origin']
        if ($origin -and $origin -ne $serverUrl.TrimEnd('/')) {
            Send-Json $Context 403 @{ error = 'Only the local map page can save survey data.' }
            return
        }
        if (-not $request.ContentType -or $request.ContentType.Split(';')[0].Trim() -ne 'application/json') {
            Send-Json $Context 415 @{ error = 'Use application/json.' }
            return
        }
    }
    try { $current = Read-PointFile $pointFile } catch {
        Send-Json $Context 500 @{ error = 'Survey data could not be read. Existing files have not been changed.' }
        return
    }
    if ($request.HttpMethod -eq 'GET') {
        Send-Json $Context 200 $current
        return
    }
    try {
        $body = Read-JsonBody $request
        if (-not (Test-Revision $body.revision)) { throw 'Invalid revision.' }
        $nextPoints = Normalize-Points $body.points
    } catch {
        Send-Json $Context 400 @{ error = $_.Exception.Message }
        return
    }
    if ([int]$body.revision -ne $current.revision) {
        $current.error = 'Survey data changed in another page. Reload the latest records before saving.'
        Send-Json $Context 409 $current
        return
    }
    # Reference transfers retire only their original survey IDs. Ordinary
    # deletion undo keeps its existing behavior.
    if ([System.IO.File]::Exists($migrationFile)) {
        try {
            if ((Get-Item -LiteralPath $migrationFile).Length -gt $maxPointBytes) { throw 'Migration audit is too large.' }
            $migration = Parse-Json ([System.IO.File]::ReadAllText($migrationFile, $utf8))
            if ($migration.version -ne 1 -or $migration.migratedSurveyIds -isnot [array]) { throw 'Invalid migration audit.' }
            $retired = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
            foreach ($id in $migration.migratedSurveyIds) {
                if ($id -isnot [string] -or $id.Length -eq 0 -or $id.Length -gt 120 -or -not $retired.Add($id)) { throw 'Invalid migrated survey ID.' }
            }
        } catch {
            Send-Json $Context 500 @{ error = 'Reference transfer history could not be read. Existing survey data has not been changed.' }
            return
        }
        foreach ($point in $nextPoints) {
            if ($retired.Contains($point.id)) {
                Send-Json $Context 422 @{ error = '这些点位已转为参考地点。请刷新地图后继续编辑调查点位。' }
                return
            }
        }
    }
    $present = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
    foreach ($point in $nextPoints) { $present.Add($point.id) | Out-Null }
    $deleted = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
    foreach ($id in $current.deletedIds) { if (-not $present.Contains($id)) { $deleted.Add($id) | Out-Null } }
    foreach ($point in $current.points) { if (-not $present.Contains($point.id)) { $deleted.Add($point.id) | Out-Null } }
    $next = @{ version = 1; revision = $current.revision + 1; points = $nextPoints; deletedIds = @($deleted | Sort-Object -CaseSensitive) }
    try { Write-PointFile $next } catch {
        Send-Json $Context 500 @{ error = 'Survey data could not be saved. Please retain this page and export a backup.' }
        return
    }
    Send-Json $Context 200 $next
}

. (Join-Path $PSScriptRoot 'deity-storage.ps1')
. (Join-Path $PSScriptRoot 'faith-storage.ps1')
. (Join-Path $PSScriptRoot 'archive-storage.ps1')
. (Join-Path $PSScriptRoot 'journal-storage.ps1')

$staticFiles = @{
    '/map.css' = @{ Path = 'map.css'; Type = 'text/css; charset=utf-8' }
    '/map-app.js' = @{ Path = 'map-app.js'; Type = 'text/javascript; charset=utf-8' }
    '/sea-texture.svg' = @{ Path = 'sea-texture.svg'; Type = 'image/svg+xml; charset=utf-8' }
    '/cloud-access.js' = @{ Path = 'cloud-access.js'; Type = 'text/javascript; charset=utf-8' }
    '/faith-records.js' = @{ Path = 'faith-records.js'; Type = 'text/javascript; charset=utf-8' }
    '/place-archives.js' = @{ Path = 'place-archives.js'; Type = 'text/javascript; charset=utf-8' }
    '/field-journal.js' = @{ Path = 'field-journal.js'; Type = 'text/javascript; charset=utf-8' }
    '/field-journal.css' = @{ Path = 'field-journal.css'; Type = 'text/css; charset=utf-8' }
    '/deities' = @{ Path = 'deities.html'; Type = 'text/html; charset=utf-8' }
    '/deities/' = @{ Path = 'deities.html'; Type = 'text/html; charset=utf-8' }
    '/deities.html' = @{ Path = 'deities.html'; Type = 'text/html; charset=utf-8' }
    '/deity-catalog.js' = @{ Path = 'deity-catalog.js'; Type = 'text/javascript; charset=utf-8' }
    '/deity-atlas.js' = @{ Path = 'deity-atlas.js'; Type = 'text/javascript; charset=utf-8' }
    '/deity-atlas.css' = @{ Path = 'deity-atlas.css'; Type = 'text/css; charset=utf-8' }
    '/deity-explorer.js' = @{ Path = 'deity-explorer.js'; Type = 'text/javascript; charset=utf-8' }
    '/deity-explorer.css' = @{ Path = 'deity-explorer.css'; Type = 'text/css; charset=utf-8' }
    '/map-data.js' = @{ Path = 'map-data.js'; Type = 'text/javascript; charset=utf-8' }
    '/assets/vector-map-data.json' = @{ Path = 'assets/vector-map-data.json'; Type = 'application/json; charset=utf-8' }
}
$serverUrl = 'http://127.0.0.1:8765/'
if (-not (Test-Path -LiteralPath $mapFile -PathType Leaf)) { throw 'The map HTML file is missing.' }
try {
    $existing = Invoke-WebRequest -Uri $serverUrl -TimeoutSec 2 -UseBasicParsing
    if ($existing.Headers['X-Naozhou-Map'] -eq '1') {
        if (-not $NoBrowser) { Start-Process $serverUrl }
        Write-Host 'The map is already open at http://127.0.0.1:8765/'
        exit 0
    }
    throw 'Port 8765 is in use by another application.'
} catch {
    if ($_.Exception.Message -eq 'Port 8765 is in use by another application.') { throw }
}
if (-not [System.IO.File]::Exists($pointFile)) { Write-PointFile (Read-PointFile $seedFile -Seed) }
# Validate the persisted survey before accepting any requests; never replace unreadable data.
$null = Read-PointFile $pointFile
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($serverUrl)
try {
    $listener.Start()
    Write-Host 'Naozhou field map: http://127.0.0.1:8765/'
    Write-Host 'Keep this window open while using the map. Close it to stop the local server.'
    if (-not $NoBrowser) { Start-Process $serverUrl }
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        try {
            $requestPath = $context.Request.Url.AbsolutePath
            $context.Response.Headers.Add('X-Naozhou-Map','1')
            $context.Response.Headers.Add('Cache-Control','no-store')
            $context.Response.Headers.Add('Referrer-Policy','strict-origin-when-cross-origin')
            if ($requestPath -eq '/api/points') {
                Handle-PointsRequest $context
            } elseif ($requestPath -eq '/api/faith') {
                Handle-FaithRequest $context
            } elseif ($requestPath -eq '/api/archives') {
                Handle-ArchivesRequest $context
            } elseif ($requestPath -eq '/api/field-entries') {
                Handle-JournalRequest $context
            } elseif ($requestPath -eq '/api/deities') {
                Handle-DeitiesRequest $context
            } elseif (($requestPath -eq '/' -or $requestPath -eq '/index.html' -or $staticFiles.ContainsKey($requestPath)) -and ($context.Request.HttpMethod -eq 'GET' -or $context.Request.HttpMethod -eq 'HEAD')) {
                if ($requestPath -eq '/' -or $requestPath -eq '/index.html') {
                    $filePath = $mapFile
                    $contentType = 'text/html; charset=utf-8'
                } else {
                    $filePath = Join-Path $PSScriptRoot $staticFiles[$requestPath].Path
                    $contentType = $staticFiles[$requestPath].Type
                }
                $bytes = [System.IO.File]::ReadAllBytes($filePath)
                $context.Response.ContentType = $contentType
                $context.Response.ContentLength64 = $bytes.Length
                if ($context.Request.HttpMethod -eq 'GET') { $context.Response.OutputStream.Write($bytes,0,$bytes.Length) }
            } else {
                $context.Response.StatusCode = 404
            }
        } catch {
            Write-Warning ('Map request failed: ' + $_.Exception.Message)
            try { Send-Json $context 500 @{ error = 'The local map request failed. Existing survey data has been retained.' } } catch { }
        } finally { $context.Response.Close() }
    }
} finally {
    $listener.Stop()
    $listener.Close()
}
