param(
  [string]$BaseUrl = "http://127.0.0.1:4000",
  [string]$AdminToken = ""
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Net.Http

if ([string]::IsNullOrWhiteSpace($AdminToken)) {
  $envPath = Join-Path $PSScriptRoot "..\.env"
  if (-not (Test-Path -LiteralPath $envPath)) {
    throw "Set -AdminToken or create backend/.env with API_ADMIN_TOKEN."
  }
  $tokenLine = Get-Content -LiteralPath $envPath | Where-Object { $_ -match '^\s*API_ADMIN_TOKEN\s*=' } | Select-Object -First 1
  if (-not $tokenLine) { throw "API_ADMIN_TOKEN is missing from backend/.env." }
  $AdminToken = ($tokenLine -split "=", 2)[1].Trim()
}

$script:ApiRoot = $BaseUrl.TrimEnd("/")
$script:HttpClient = [System.Net.Http.HttpClient]::new()
$script:Assertions = 0

function Invoke-Api {
  param(
    [Parameter(Mandatory)][string]$Method,
    [Parameter(Mandatory)][string]$Path,
    [AllowNull()][object]$Body = $null,
    [string]$Token = ""
  )

  $request = [System.Net.Http.HttpRequestMessage]::new(
    [System.Net.Http.HttpMethod]::new($Method),
    "$script:ApiRoot$Path"
  )
  if ($Token) {
    $request.Headers.Authorization = [System.Net.Http.Headers.AuthenticationHeaderValue]::new("Bearer", $Token)
  }
  if ($null -ne $Body) {
    $json = ConvertTo-Json -InputObject $Body -Depth 8 -Compress
    $request.Content = [System.Net.Http.StringContent]::new($json, [System.Text.Encoding]::UTF8, "application/json")
  }

  $response = $script:HttpClient.SendAsync($request).GetAwaiter().GetResult()
  $raw = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
  $payload = $null
  try { $payload = $raw | ConvertFrom-Json } catch { }
  return @{
    Status = [int]$response.StatusCode
    Data = if ($payload) { $payload.data } else { $null }
    Error = if ($payload) { $payload.error } else { $null }
  }
}

function Assert-Status {
  param([hashtable]$Result, [int]$Expected, [string]$Name)
  if ($Result.Status -ne $Expected) {
    throw "$Name expected HTTP $Expected; received HTTP $($Result.Status). $($Result.Error)"
  }
  $script:Assertions++
}

function Invoke-ExpectedSuccess {
  param([string]$Method, [string]$Path, [AllowNull()][object]$Body, [string]$Token, [int]$Expected, [string]$Name)
  $result = Invoke-Api -Method $Method -Path $Path -Body $Body -Token $Token
  Assert-Status -Result $result -Expected $Expected -Name $Name
  return $result.Data
}

try {
  Invoke-ExpectedSuccess GET "/health" $null "" 200 "Health check" | Out-Null
  Assert-Status (Invoke-Api GET "/api/users") 401 "Reject unauthenticated user list"
  Assert-Status (Invoke-Api GET "/api/users" $null $AdminToken) 401 "Admin token is not a user session"
  Assert-Status (Invoke-Api GET "/api/bootstrap/status" $null "not-the-admin-token") 401 "Reject invalid admin token"

  $bootstrap = Invoke-ExpectedSuccess GET "/api/bootstrap/status" $null $AdminToken 200 "Bootstrap status"
  if (-not $bootstrap.financeAccountRequired) {
    throw "This script requires an empty test database. Set MONGODB_DATABASE to a fresh disposable database and restart the API."
  }

  $stamp = [DateTime]::UtcNow.ToString("yyyyMMddHHmmss") + "-" + [Guid]::NewGuid().ToString("N").Substring(0, 8)
  $facilityName = "Identity E2E $stamp"
  $facility = Invoke-ExpectedSuccess POST "/api/facilities" @{ name = $facilityName } $AdminToken 201 "Provision facility"
  Assert-Status (Invoke-Api POST "/api/facilities" @{ name = $facilityName.ToLowerInvariant() } $AdminToken) 409 "Reject case-insensitive duplicate facility"
  $assignedFacility = Invoke-ExpectedSuccess POST "/api/facilities" @{ name = "Identity E2E Assigned $stamp" } $AdminToken 201 "Provision second Finance facility"
  $otherFacility = Invoke-ExpectedSuccess POST "/api/facilities" @{ name = "Identity E2E Other $stamp" } $AdminToken 201 "Provision out-of-scope facility"

  $password = "Identity-E2E!2026"
  $financeEmail = "finance.$stamp@example.test"
  $managerEmail = "manager.$stamp@example.test"
  $cashierEmail = "cashier.$stamp@example.test"
  $assignments = @($facility.id, $assignedFacility.id)

  $finance = Invoke-ExpectedSuccess POST "/api/bootstrap/finance" @{
    name = "E2E Finance"; phone = "08070000001"; email = $financeEmail; password = $password
    role = "finance"; facilityIds = $assignments
  } $AdminToken 201 "Create first Finance account"
  if ($finance.PSObject.Properties.Name -contains "passwordHash") { throw "Password hash leaked in Finance response." }
  $script:Assertions++

  Assert-Status (Invoke-Api POST "/api/bootstrap/finance" @{
    name = "Duplicate Finance"; phone = "08070000009"; email = "duplicate.$stamp@example.test"
    password = $password; role = "finance"; facilityIds = $assignments
  } $AdminToken) 409 "Reject repeat Finance bootstrap"

  $financeSession = Invoke-ExpectedSuccess POST "/api/auth/login" @{ email = $financeEmail.ToUpperInvariant(); password = $password } "" 200 "Finance sign-in with normalized email"
  Assert-Status (Invoke-Api POST "/api/auth/login" @{ email = $financeEmail; password = "wrong-password" }) 401 "Reject incorrect password"
  $financeToken = $financeSession.accessToken

  $manager = Invoke-ExpectedSuccess POST "/api/users" @{
    name = "E2E Manager"; phone = "08070000002"; email = $managerEmail; password = $password
    role = "facility_manager"; facilityIds = $assignments
  } $financeToken 201 "Finance creates Manager"
  Assert-Status (Invoke-Api POST "/api/users" @{
    name = "Duplicate Manager"; phone = "08070000008"; email = $managerEmail; password = $password
    role = "facility_manager"; facilityIds = $assignments
  } $financeToken) 409 "Reject duplicate email"

  $cashier = Invoke-ExpectedSuccess POST "/api/cashiers" @{
    name = "E2E Cashier"; phone = "08070000003"; email = $cashierEmail; password = $password
    facilityIds = $assignments
  } $financeToken 201 "Finance creates Cashier"
  if ($cashier.role -ne "cashier") { throw "The cashier route did not force the cashier role." }
  if ($cashier.PSObject.Properties.Name -contains "passwordHash") { throw "Password hash leaked in cashier response." }
  $script:Assertions++
  Assert-Status (Invoke-Api POST "/api/cashiers" @{
    name = "Role Override"; phone = "08070000004"; email = "override.$stamp@example.test"
    password = $password; facilityIds = $assignments; role = "finance"
  } $financeToken) 400 "Reject caller-selected cashier role"
  Assert-Status (Invoke-Api PUT "/api/users/$($cashier.id)/facilities" @{ facilityIds = @($otherFacility.id) } $financeToken) 403 "Reject out-of-scope assignment update"
  $assignmentUpdate = Invoke-ExpectedSuccess PUT "/api/users/$($cashier.id)/facilities" @{ facilityIds = @($assignedFacility.id) } $financeToken 200 "Finance replaces Cashier facility assignment"
  if (@($assignmentUpdate.facilityIds).Count -ne 1 -or $assignmentUpdate.facilityIds[0] -ne $assignedFacility.id) {
    throw "Cashier facility assignment was not replaced as requested."
  }
  $script:Assertions++
  Assert-Status (Invoke-Api POST "/api/users" @{
    name = "Out of scope"; phone = "08070000005"; email = "out.$stamp@example.test"
    password = $password; role = "cashier"; facilityIds = @($otherFacility.id)
  } $financeToken) 403 "Reject assignment outside Finance scope"

  $managerSession = Invoke-ExpectedSuccess POST "/api/auth/login" @{ email = $managerEmail; password = $password } "" 200 "Manager sign-in"
  $cashierSession = Invoke-ExpectedSuccess POST "/api/auth/login" @{ email = $cashierEmail; password = $password } "" 200 "Cashier sign-in"
  $managerToken = $managerSession.accessToken
  $cashierToken = $cashierSession.accessToken

  $me = Invoke-ExpectedSuccess GET "/api/auth/me" $null $cashierToken 200 "Read Cashier session identity"
  if ($me.user.id -ne $cashier.id) { throw "Session resolved to the wrong user." }
  $script:Assertions++

  $users = Invoke-ExpectedSuccess GET "/api/users" $null $financeToken 200 "Finance lists assigned users"
  if (@($users).Count -ne 3) { throw "Expected three users in Finance scope; got $(@($users).Count)." }
  if (@($users | Where-Object { $_.PSObject.Properties.Name -contains "passwordHash" }).Count -gt 0) {
    throw "A password hash appeared in the user list."
  }
  $script:Assertions += 2

  $visibleFacilities = Invoke-ExpectedSuccess GET "/api/facilities" $null $financeToken 200 "List assigned facilities"
  if (@($visibleFacilities).Count -ne 2 -or @($visibleFacilities | Where-Object { $_.id -in $assignments }).Count -ne 2) {
    throw "Facility list includes an unassigned facility or omits an assigned one."
  }
  if ($visibleFacilities[0].PSObject.Properties.Name -contains "_id") { throw "MongoDB _id leaked in the facility API response." }
  $script:Assertions += 2

  Assert-Status (Invoke-Api GET "/api/users/$($manager.id)" $null $cashierToken) 403 "Cashier cannot read another account"
  Assert-Status (Invoke-Api POST "/api/users" @{ name = "Denied"; phone = "08070000006"; email = "denied.$stamp@example.test"; password = $password; role = "cashier"; facilityIds = $assignments } $cashierToken) 403 "Cashier cannot create users"
  Assert-Status (Invoke-Api POST "/api/cashiers" @{ name = "Denied"; phone = "08070000007"; email = "denied2.$stamp@example.test"; password = $password; facilityIds = $assignments } $managerToken) 403 "Manager cannot create Cashier"
  Assert-Status (Invoke-Api GET "/api/users?facilityId=$($otherFacility.id)" $null $financeToken) 403 "Finance cannot filter outside assigned facilities"
  Assert-Status (Invoke-Api PATCH "/api/users/$($cashier.id)/status" @{ status = "inactive" } $managerToken) 403 "Manager cannot deactivate accounts"
  Assert-Status (Invoke-Api PATCH "/api/users/$($finance.id)/status" @{ status = "inactive" } $financeToken) 409 "Protect last active Finance account"

  Invoke-ExpectedSuccess PATCH "/api/users/$($cashier.id)/status" @{ status = "inactive" } $financeToken 200 "Finance deactivates Cashier" | Out-Null
  Assert-Status (Invoke-Api GET "/api/auth/me" $null $cashierToken) 401 "Deactivation revokes existing session"
  Assert-Status (Invoke-Api POST "/api/auth/login" @{ email = $cashierEmail; password = $password }) 401 "Inactive account cannot sign in"
  $inactive = Invoke-ExpectedSuccess GET "/api/users?status=inactive" $null $financeToken 200 "List inactive accounts"
  if (@($inactive | Where-Object { $_.id -eq $cashier.id }).Count -ne 1) { throw "Inactive Cashier is missing from inactive filter." }
  $script:Assertions++

  Invoke-ExpectedSuccess PATCH "/api/users/$($cashier.id)/status" @{ status = "active" } $financeToken 200 "Finance reactivates Cashier" | Out-Null
  $newSession = Invoke-ExpectedSuccess POST "/api/auth/login" @{ email = $cashierEmail; password = $password } "" 200 "Reactivated Cashier can sign in"
  Invoke-ExpectedSuccess POST "/api/auth/logout" $null $newSession.accessToken 200 "Cashier signs out" | Out-Null
  Assert-Status (Invoke-Api GET "/api/auth/me" $null $newSession.accessToken) 401 "Logout revokes session"

  Write-Output "PASS: $script:Assertions Identity assertions passed against $script:ApiRoot."
} finally {
  $script:HttpClient.Dispose()
}
