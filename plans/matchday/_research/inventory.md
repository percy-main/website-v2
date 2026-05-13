# Matchday App API Inventory & Architecture

## 1. API Endpoints to be Consumed

### Matchday Feature (`apps/api/src/features/matchday/`)

#### Listing & Viewing

- **GET /matchday** (line 75–89, routes.ts)
  - Role: `official` | `admin`
  - Purpose: List matchdays with filtering by team, status (all/pending/confirmed/finished)
  - Response: `ListMatchesResponseSchema` (line 172, schemas.ts) — array of matchday items with full metadata
  - Behavior: Non-admin officials see only their assigned teams (service.ts:131–164)

- **GET /matchday/:matchId** (line 91–105, routes.ts)
  - Role: `official` | `admin`
  - Purpose: Fetch detailed matchday with players, charges, expenses
  - Response: Matchday item + team + all matchday_players + matchday_expenses (service.ts:166–234)
  - Behavior: Access control via team_official join; returns player statuses, captain/wicketkeeper flags, charge IDs, paid status

#### Team Selection & Management

- **GET /matchday/teams** (line 317–330, routes.ts)
  - Role: `official` | `admin`
  - Purpose: List teams an official can manage (or all teams if admin)
  - Response: Array of `{id, name, is_junior}` (service.ts:360–376)

- **GET /matchday/teams/:teamId/upcoming** (line 332–348, routes.ts)
  - Role: `official` | `admin`
  - Purpose: Fetch upcoming fixtures from Play-Cricket API for a team
  - Response: Array with matchId, matchDate, opposition, isHome, competition, existing matchday status (service.ts:379–456)
  - Behavior: Searches Play-Cricket for 2+ seasons (Jan–Mar logic); filters to senior teams only; matches existing matchdays by date

- **POST /matchday** (line 350–364, routes.ts)
  - Role: `official` | `admin`
  - Body: `{teamId, matchDate (YYYY-MM-DD), opposition, competitionType?, playCricketMatchId?}`
  - Purpose: Create a new matchday record
  - Response: `{id}` (service.ts:458–493)
  - Behavior: Prevents duplicate date+team; inserts with status="pending"

#### Player Management

- **GET /matchday/members/search** (line 366–378, routes.ts)
  - Role: `official` | `admin`
  - Query: `{query: string}`
  - Purpose: Search members by name (ilike, limit 20)
  - Response: Array of `{id, name, email, member_category}`

- **POST /matchday/:matchId/players** (line 380–395, routes.ts)
  - Role: `official` | `admin`
  - Body: `{memberId?, playerName}`
  - Purpose: Add a player to matchday squad; creates guest member if no memberId
  - Response: `{id}` (service.ts:512–591)
  - Behavior: Creates member record with category="guest" if ad-hoc player; prevents duplicates in selected/playing status

- **DELETE /matchday/:matchId/players/:playerId** (line 397–416, routes.ts)
  - Role: `official` | `admin`
  - Purpose: Remove player from squad
  - Behavior: Fails if matchday is finished (service.ts:593–627)

#### Team Confirmation & Match Roles

- **POST /matchday/:matchId/confirm** (line 418–433, routes.ts)
  - Role: `official` | `admin`
  - Body: `{playerStatuses: [{matchdayPlayerId, status: "playing"|"dropped_out"|"no_show"}]}`
  - Purpose: Lock team selection and create match-fee charges for playing players
  - Response: `{success: true}` (service.ts:629–761)
  - Behavior: Transactional; updates matchday status to "confirmed", creates charge records via `findFeeRate` (priority: team+comp+cat → team+cat → comp+cat → any+cat); bursary members exempt

- **PUT /matchday/:matchId/roles** (line 435–455, routes.ts)
  - Role: `official` | `admin`
  - Body: `{captainPlayerId?, wicketkeeperPlayerId?}`
  - Purpose: Set captain and wicketkeeper for match
  - Response: `{success: true}` (service.ts:763–844)
  - Behavior: Clears previous role assignments within transaction

- **POST /matchday/:matchId/players/:playerId/mark-paid** (line 457–478, routes.ts)
  - Role: `official` | `admin`
  - Body: `{paymentMethod: "cash"|"bank_transfer"|"card"}`
  - Purpose: Mark a player's match fee as paid
  - Response: `{success: true}` (service.ts:847–890)
  - Behavior: Updates charge.paid_at and payment_method; requires charge to exist

#### Match Completion

- **POST /matchday/:matchId/finish** (line 480–495, routes.ts)
  - Role: `official` | `admin`
  - Body: `{resultType: "W"|"L"|"D"|"T"|"A"|"C"|"N"}`
  - Purpose: Finalize match, create/submit expenses, generate charges, send emails
  - Response: `{success, emailsSent: number, emailErrors: string[]}`
  - Behavior: **First finish only**: submits draft expenses as "submitted", creates missing charges, sends ChargeNotification emails to unpaid players (service.ts:892–1089); idempotent result resubmission allowed

#### Team News Image Generation

- **GET /matchday/:matchId/team-news-image** (line 109–145, routes.ts)
  - Role: `official` | `admin`
  - Query: `{isHome: "true"|"false" (default), matchTime?: string}`
  - Purpose: Generate PNG team-news image (via satori/sharp on opentype.js, line 1–80 of team-news-image.ts)
  - Response: PNG binary with Content-Disposition attachment
  - Behavior: Fails with 400 if no players selected; uses match sponsor & player sponsorships from DB

#### Expense Management (Official)

- **POST /matchday/:matchId/expenses** (line 147–165, routes.ts)
  - Role: `official` | `admin`
  - Body: `{type: expenseTypeSchema, description?, amountPence, receiptImage?}`
  - Expense types: "umpire_fee", "scorer_fee", "match_ball", "teas", "miscellaneous"
  - Purpose: Record draft expense for a confirmed matchday
  - Response: `{expenseId}`
  - Behavior: Uploads base64 receipt image to S3 if provided; status="draft" (service.ts:236–285)

- **PUT /matchday/expenses/:expenseId** (line 167–185, routes.ts)
  - Role: `official` | `admin`
  - Body: `{type?, description?, amountPence?}`
  - Purpose: Update draft expense (can't update finished matchday)

- **DELETE /matchday/expenses/:expenseId** (line 187–201, routes.ts)
  - Role: `official` | `admin`
  - Purpose: Delete draft expense

- **POST /matchday/:matchId/expenses/submit** (line 226–244, routes.ts)
  - Role: `official` | `admin`
  - Body: `{type, description?, amountPence, receiptImage?}`
  - Purpose: Submit expense claim directly (creates with status="submitted", submitted_at set)
  - Response: `{expenseId}` (service.ts:1093–1144)
  - Behavior: Can submit from pending or confirmed matchday

#### Expense Approval (Admin Only)

- **GET /matchday/expenses/pending** (line 212–224, routes.ts)
  - Role: `admin` only
  - Query: `{status?: "submitted"|"approved", teamId?, limit, offset}`
  - Purpose: List expenses awaiting/approved for reimbursement
  - Response: Paginated with expenses, opposition, match_date, team_id, creator name (service.ts:1242–1287)
  - Behavior: **Static route must be before** :expenseId routes (line 211 comment)

- **POST /matchday/expenses/:expenseId/approve** (line 246–259, routes.ts)
  - Role: `admin` only
  - Purpose: Approve a submitted expense
  - Response: `{success: true}` (service.ts:1146–1175)
  - Behavior: Sets status="approved", approved_at, approved_by

- **POST /matchday/expenses/:expenseId/reject** (line 261–275, routes.ts)
  - Role: `admin` only
  - Body: `{reason: string}`
  - Purpose: Reject a submitted expense
  - Response: `{success: true}` (service.ts:1177–1209)

- **POST /matchday/expenses/:expenseId/reimburse** (line 277–290, routes.ts)
  - Role: `admin` only
  - Purpose: Mark approved expense as reimbursed
  - Response: `{success: true}` (service.ts:1211–1240)
  - Behavior: Sets status="reimbursed", reimbursed_at, reimbursed_by

---

### Availability Feature (`apps/api/src/features/availability/`)

#### Official Routes

- **POST /availability/requests** (line 72–90, routes.ts)
  - Role: `official` | `admin`
  - Body: `{dateFrom, dateTo (YYYY-MM-DD)}`
  - Purpose: Create availability request for senior-team fixtures in date range
  - Response: `{id, fixtureCount}` (service.ts:35–148)
  - Behavior: Fetches Play-Cricket matches, filters to senior teams, creates request + availability_fixtures in transaction; fails if overlapping request exists

- **GET /availability/requests** (line 92–105, routes.ts)
  - Role: `official` | `admin`
  - Query: `{limit, offset}`
  - Purpose: List all availability requests with fixture & respondent counts
  - Response: Array of requests with fixtureCount, respondentCount (service.ts:150–216)

- **GET /availability/requests/:requestId** (line 107–120, routes.ts)
  - Role: `official` | `admin`
  - Purpose: Fetch request details grouped by date with response/assignment counts
  - Response: request + array of dates with fixture details, response/assignment counts (service.ts:218–312)

- **GET /availability/requests/:requestId/dates/:date** (line 122–135, routes.ts)
  - Role: `official` | `admin`
  - Purpose: Get fixtures, assignments, and responses for a specific date
  - Response: fixtures grouped, assignments per fixture, available/unavailable/no-response member lists (service.ts:314–~450)

- **POST /availability/requests/:requestId/dates/:date/assign** (line 137–155, routes.ts)
  - Role: `official` | `admin`
  - Body: `{memberId, position: number}`
  - Purpose: Assign a player to a specific fixture
  - Response: `{assignmentId}`

- **DELETE /availability/assignments/:assignmentId** (line 157–170, routes.ts)
  - Role: `official` | `admin`
  - Purpose: Remove an assignment

- **PUT /availability/responses/:responseId/override** (line 172–187, routes.ts)
  - Role: `official` | `admin`
  - Body: `{status: "available"|"unavailable", note?}`
  - Purpose: Override a member's availability response
  - Response: `{success: true}`

- **POST /availability/requests/:requestId/dates/:date/confirm** (line 189–207, routes.ts)
  - Role: `official` | `admin`
  - Purpose: Finalize availability for a date (creates matchday fixtures?)
  - Response: `{fixtureIds: string[]}`

- **PATCH /availability/requests/:requestId** (line 209–223, routes.ts)
  - Role: `official` | `admin`
  - Body: `{status: string}`
  - Purpose: Update request status (e.g., "closed")

- **GET /availability/preview** (line 229–246, routes.ts)
  - Role: `official` | `admin`
  - Query: `{dateFrom, dateTo}`
  - Purpose: Preview fixtures before creating request
  - Response: Array of potential fixture objects

- **POST /availability/requests/:requestId/notify/preview** (line 251–264, routes.ts)
  - Role: `official` | `admin`
  - Body: `{memberIds?}`
  - Purpose: Preview who will be notified
  - Response: `{recipients: [{email, name}]}`

- **POST /availability/requests/:requestId/notify/send** (line 271–284, routes.ts)
  - Role: `official` | `admin`
  - Body: `{memberIds?, emailTemplate?}`
  - Purpose: Send availability request notifications
  - Response: `{sent: number, failed: number}`

#### Public Routes

- **GET /availability/requests/:requestId/public** (line 289–300, routes.ts)
  - No auth required
  - Purpose: View request details without logging in
  - Response: Public request data

#### Member Routes

- **GET /availability/active** (line 304–317, routes.ts)
  - Role: `user` (requireAuth)
  - Purpose: Fetch active availability requests for logged-in member
  - Response: Array of active requests with my responses per fixture

- **POST /availability/requests/:requestId/respond** (line 319–338, routes.ts)
  - Role: `user` (requireAuth)
  - Body: `{dates: [{date, status: "available"|"unavailable", note?}]}`
  - Purpose: Respond to availability request
  - Response: `{success: true}`

---

### Games Feature (`apps/api/src/features/games/`)

#### Public Routes (No Auth)

- **GET /games** (line 32–45, routes.ts)
  - Query: `{season?: number}` (defaults to current year)
  - Purpose: List all matches from Play-Cricket for a season (public view)
  - Response: Array of match summaries

- **GET /games/:matchId** (line 47–67, routes.ts)
  - Purpose: Fetch detailed match data including scores
  - Response: Full match detail or 404
  - Behavior: Uses Play-Cricket API client; no DB filtering (public data)

---

### Charges Feature (`apps/api/src/features/charges/`)

#### Player Routes (requireAuth)

- **GET /charges** (line 25–38, routes.ts)
  - Role: Any authenticated user
  - Purpose: Fetch player's own outstanding and paid charges
  - Response: `{charges: [{id, amount_pence, description, type, charge_date, paid_at?, source}]}`
  - Behavior: Looks up member by email; returns all non-deleted charges (service.ts:5–27)

- **POST /charges/pay-outstanding** (line 40–52, routes.ts)
  - Role: Any authenticated user
  - Purpose: Initiate Stripe payment for all unpaid charges
  - Response: `{clientSecret, totalAmountPence, chargeIds}`
  - Behavior: Creates Stripe PaymentIntent, links charges in transaction (service.ts:29–131); handles stale PIs

- **POST /charges/confirm-payment** (line 54–68, routes.ts)
  - Role: Any authenticated user
  - Body: `{paymentIntentId}`
  - Purpose: Confirm payment succeeded
  - Response: `{success: true}`
  - Behavior: Updates charge.payment_confirmed_at

---

## 2. Existing Main-Site Pages This Replaces

### Matchday Pages

- **`apps/web/src/pages/matchday/matchday-hub.tsx`** (7.8 KB, line 15–70)
  - Purpose: Hub for matchday features; shows quick links to team management & availability
  - Who: All members (availability section), officials (team management links)
  - Components: AvailabilitySection (responds to active requests)

### Official Panel Pages

- **`apps/web/src/pages/official/official.tsx`** (54.6 KB)
  - Purpose: Main official dashboard; team management, match setup, player selection, expenses
  - Who: Officials + admins
  - Key sections (grep results):
    - TeamsDashboard() (line 236)
    - TeamMatchesView() (line 313)
    - DownloadTeamNewsButton() (line 62)
    - RoleSelectors() (line 113) — captain/wicketkeeper assignment
    - Expense recording, team confirmation, match finish flow

- **`apps/web/src/pages/official/availability.tsx`** (40.4 KB)
  - Purpose: Availability request creation, management, member responses
  - Who: Officials + admins
  - Components: Request list, date details, response UI, assignment UI, notification preview/send

### Admin Tabs (Matchday-Related)

- **`apps/web/src/pages/admin/expense-history-tab.tsx`**
  - Purpose: View historical expenses (approved/reimbursed)
  - Tab in admin panel

- **`apps/web/src/pages/admin/match-fees-tab.tsx`**
  - Purpose: Manage match fee rates by team/competition/category
  - Tab in admin panel

- **`apps/web/src/pages/admin/charges-tab.tsx`**
  - Purpose: Admin view of member charges (pending/paid/disputed)
  - Tab in admin panel

- **`apps/web/src/pages/admin/treasurer-tab.tsx`**
  - Purpose: Expense approval/rejection workflow (pending expenses list)
  - Tab in admin panel

---

## 3. Auth + Roles in Use

### Role Definition

- Roles: `"user"` (default) | `"member"` | `"official"` | `"admin"`
- Defined in: `better-auth` library (auth.ts plugins); user.role field from session
- Client usage: `apps/web/src/lib/auth-client.ts` (line 1–16) — configures `adminClient` plugin, passkeyClient, twoFactorClient

### requireRole Pattern

- Location: `apps/api/src/features/auth/middleware.ts` (line 63–74)
- Implementation: Returns preHandler that calls `requireAuth`, then checks `user.role` in session
- Usage: Curried as `requireRole("official", "admin")` → accepts either role
- Example: `matchdayRoutes` (line 63) uses `officialRole = requireRole("official", "admin")`

### getAuthSession Pattern

- Location: middleware.ts (line 81–87)
- Used in route handlers to extract authenticated session
- Throws 401 if missing (after preHandler validates)

### Authentication Flow

- **better-auth session retrieval** (middleware.ts:29–42)
  - Validates session via better-auth API using Web Headers conversion
  - Populates `request.authSession = {user, session}`
  - Returns 401 if invalid

- **User role casting** (routes.ts line 86, 102, 159, etc.)
  - Pattern: `const role = (user as { role?: string | null }).role ?? "user"`
  - Defaults to "user" if no role or null

### Auth Client Configuration

- `apps/web/src/lib/auth-client.ts`
  - Base URL: `VITE_API_URL` env var (e.g., "https://api.v2.percymain.org/api")
  - Plugins: Passkey (passwordless), Two-factor, Admin (role-based checks)
  - Exports: `authClient`, `useSession` hook

---

## 4. Data Model (Summary)

### Core Tables

| Table                     | Primary Key Fields              | Fields Referenced in Matchday/Availability Routes                                                                                                                                                                           |
| ------------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `matchday`                | `id`                            | id, play_cricket_team_id, match_date, opposition, status (pending/confirmed/finished), competition_type, play_cricket_match_id, confirmed_at/by, finished_at/by, result_type, result_confirmed_at/by                        |
| `matchday_player`         | `id`                            | id, matchday_id, member_id, player_name, status (selected/playing/dropped_out/no_show/replaced), charge_id, is_captain, is_wicketkeeper, replaced_by_matchday_player_id                                                     |
| `matchday_expense`        | `id`                            | id, matchday_id, expense_type, description, amount_pence, created_by, receipt_image_url, status (draft/submitted/approved/rejected/reimbursed), created_at, submitted_at, approved_at/by, rejected_reason, reimbursed_at/by |
| `availability_request`    | `id`                            | id, created_by, date_from, date_to, status (open/closed)                                                                                                                                                                    |
| `availability_fixture`    | `id`                            | id, availability_request_id, match_date, play_cricket_match_id, play_cricket_team_id, opposition, is_home, competition_name, competition_type, match_time                                                                   |
| `availability_response`   | `id`                            | id, availability_request_id, match_date, member_id, status (available/unavailable), note, overridden_by                                                                                                                     |
| `availability_assignment` | `id`                            | id, availability_fixture_id, member_id, player_name, position                                                                                                                                                               |
| `charge`                  | `id`                            | id, member_id, amount_pence, type (match_fee), source (matchday), description, charge_date, paid_at, payment_method, deleted_at, stripe_payment_intent_id, payment_confirmed_at                                             |
| `match_fee_rate`          | `id`                            | id, play_cricket_team_id (nullable), competition_type (nullable), member_category, amount_pence                                                                                                                             |
| `member`                  | `id`                            | id, name, email, member_category, slug (for sponsorship lookup)                                                                                                                                                             |
| `play_cricket_team`       | `id`                            | id, name, is_junior                                                                                                                                                                                                         |
| `team_official`           | (user_id, play_cricket_team_id) | user_id, play_cricket_team_id                                                                                                                                                                                               |
| `player_sponsorship`      | `id`                            | slug, sponsor_name, display_name, season, approved, paid_at                                                                                                                                                                 |
| `game_sponsorship`        | `id`                            | game_id, sponsor_name, display_name, sponsor_logo_url, approved, paid_at                                                                                                                                                    |
| `user`                    | `id`                            | id, name, role (enum: user/member/official/admin), email                                                                                                                                                                    |

See `packages/db/src/__generated__/db.ts` for full Kysely-generated types (line 289–347 for matchday-related).

---

## 5. Flow Walkthroughs

### (a) Availability Request Lifecycle

**1. Create Request**

- Official calls `POST /availability/requests` with dateFrom, dateTo
- Service fetches Play-Cricket API (getMatchesSummary) for 1–3 seasons (handles Jan–Mar year boundary)
- Filters to senior teams (is_junior=false) matching site_id
- Creates availability_request (status="open") + availability_fixture per match in transaction
- Response: {id, fixtureCount}

**2. Member Responds**

- Member: `GET /availability/active` → fetch open requests (requires email lookup)
- Member: `POST /availability/requests/:id/respond` with dates array
- Service creates/updates availability_response per date (status: available | unavailable, optional note)

**3. Official Views Responses**

- Official: `GET /availability/requests/:id` → see all dates with response counts
- Official: `GET /availability/requests/:id/dates/:date` → see fixtures, list available/unavailable/no-response members, existing assignments

**4. Official Assigns Players**

- Official: `POST /availability/requests/:id/dates/:date/assign` with memberId, position
- Creates availability_assignment record per fixture

**5. Close Request**

- Official: `PATCH /availability/requests/:id` with status="closed"

### (b) Team Selection Flow

**1. List Upcoming Matches**

- Official: `GET /matchday/teams/:teamId/upcoming`
- Service fetches Play-Cricket (filters by siteId + teamId, date range is today onwards)
- Returns match info + existing matchday_id & status (if already created)

**2. Create Matchday**

- Official: `POST /matchday` with teamId, matchDate, opposition, competitionType?, playCricketMatchId?
- Service validates no duplicate (team+date), creates matchday with status="pending"
- Response: {id}

**3. Search & Add Players**

- Official: `GET /matchday/members/search?query=...` → member list (name, email, category)
- Official: `POST /matchday/:id/players` with memberId or playerName (guest)
- Service creates guest member if needed (category="guest", minimal fields); creates matchday_player (status="selected")

**4. Remove Players**

- Official: `DELETE /matchday/:id/players/:playerId`

**5. Confirm Team**

- Official: `POST /matchday/:id/confirm` with playerStatuses array
- Service:
  - Updates matchday.status="confirmed", confirmed_at, confirmed_by
  - Updates each matchday_player.status per request (playing/dropped_out/no_show)
  - **Charge Generation**: For each playing player with member_id (not bursary):
    - Looks up match_fee_rate (priority: team+comp+cat → team+cat → comp+cat → any+cat)
    - Creates charge (type="match_fee", source="matchday", description includes opposition/date)
    - Links charge_id to matchday_player

### (c) Pre-Match: Team News & Roles

**1. Team News Image Generation**

- Official: `GET /matchday/:id/team-news-image?isHome=true|false&matchTime=...`
- Service (team-news-image.ts):
  - Calls getTeamNewsData to fetch matchday, players (status != replaced), team name
  - Fetches player_sponsorship records (season=current year, approved, paid_at not null)
  - Fetches game_sponsorship if play_cricket_match_id exists
  - Renders PNG with team roster, sponsors (using satori/sharp, opentype.js for text paths)
- Response: PNG binary

**2. Set Captain & Wicketkeeper**

- Official: `PUT /matchday/:id/roles` with captainPlayerId, wicketkeeperPlayerId
- Service clears previous role assignments, sets new ones in transaction

### (d) Post-Match: Fees & Finish

**1. Mark Fee Paid (Optional, Before Finish)**

- Official: `POST /matchday/:id/players/:playerId/mark-paid` with paymentMethod
- Service updates charge.paid_at, payment_method

**2. Finish Match**

- Official: `POST /matchday/:id/finish` with resultType (W|L|D|T|A|C|N)
- **First finish (matchday.status="confirmed"):**
  - Sets matchday.status="finished", finished_at, finished_by, result fields
  - Submits all draft expenses: status="submitted", submitted_at
  - Creates missing charges for playing players (same fee rate logic as confirm step)
  - **Email Notification**: For each unpaid playing player:
    - Renders ChargeNotification template (from @percy-main/email)
    - Sends to member.email with amount, description, charge_date, login URL
  - Response: {success, emailsSent, emailErrors}
- **Result resubmission (already finished):**
  - Updates result fields only; no charge creation, no emails
  - Idempotent response: {success, emailsSent: 0, emailErrors: []}

### (e) Expenses: Record → Approve → Reimburse

**1. Record Expense (Draft)**

- Official: `POST /matchday/:id/expenses` with type, description?, amountPence, receiptImage?
- Service:
  - Validates matchday.status="confirmed" (not pending, not finished)
  - Uploads base64 receiptImage to S3 (via s3.uploadReceipt) if provided
  - Creates matchday_expense (status="draft", created_by=userId, created_at)
- Response: {expenseId}

**2. Update/Delete Draft**

- Official: `PUT /matchday/expenses/:id` to update type/description/amount
- Official: `DELETE /matchday/expenses/:id` to remove

**3. Submit Expense Claim**

- Official: `POST /matchday/:id/expenses/submit` (can be done while confirmed or after finish)
- Service: Creates matchday_expense (status="submitted", submitted_at=now)
- OR: Finish match → auto-submits all draft expenses

**4. Admin Reviews Pending**

- Admin: `GET /matchday/expenses/pending?status=submitted|approved&teamId=...&limit&offset`
- Response: Paginated list with opposition, match_date, team_id, creator_name, receipt_image_url

**5. Approve/Reject**

- Admin: `POST /matchday/expenses/:id/approve` → status="approved", approved_at, approved_by
- Admin: `POST /matchday/expenses/:id/reject` with reason → status="rejected", rejected_reason
- Only submitted expenses can be approved/rejected

**6. Reimburse**

- Admin: `POST /matchday/expenses/:id/reimburse`
- Service: Sets status="reimbursed", reimbursed_at, reimbursed_by
- Only approved expenses can be reimbursed

---

## 6. Integrations + Side Effects

### Play-Cricket API Client

**Location**: `apps/api/src/features/play-cricket/api-client.ts` (line 44–87)
**Endpoint**: `https://www.play-cricket.com/api/v2`

**Methods**:

- `getMatchesSummary(season: number)` — used by matchday.getUpcomingMatches & availability.createRequest
- `getMatchDetail(matchId: string)` — detailed match data (scores, performance)
- `getPlayers()` — site player list
- `getTeams()` — site team list
- `getLeagueTable(divisionId: string)` — league standings

**Used by**:

- Matchday: upcoming match list (getUpcomingMatches), team-news image (game_sponsorship lookup)
- Availability: fixture creation (createRequest, previewFixtures)
- Games: match list and detail (public routes)

### Email Notifications

**Library**: `@percy-main/email` (React Email templates)

**On finishMatch (first finish only)**:

- **ChargeNotification** template (service.ts:1055–1070)
  - To: unpaid playing players' member.email
  - Content: Amount, description (opposition/date), charge_date, login URL
  - Rendering: Uses @react-email/render to convert React component → HTML
  - Sent via: `app.send` (Fastify plugin, injected at route registration)
  - Error handling: Catches per-email failures, collects in emailErrors array

**On availability request notification** (routes.ts:271–284):

- Can send custom emails to selected members
- Returns {sent, failed}

### S3 Expense Receipt Upload

**Location**: `apps/api/src/lib/s3-upload.ts`
**Called by**: recordExpense (line 71), submitExpenseClaim (line 205)

**Process**:

- Parses base64 data URL: `/^data:(image\/(?:jpeg|png|webp|heic));base64,(.+)$/`
- Decodes to bytes, uploads via `s3.uploadReceipt({imageBytes, contentType, expenseId})`
- Returns S3 URL or null (optional, 400 error if invalid format provided)

### Image Generation (Team News)

**Library**: `sharp` (image processing), `opentype.js` (font parsing)
**Location**: `apps/api/src/features/matchday/team-news-image.ts` (line 1–80)

**Assets** (relative to dist):

- `pitch.jpg` — background image
- `club_logo.png` — Percy Main logo
- `club_sponsor.png` — main sponsor logo
- `Anton-Regular.ttf` — display font (parsed at module load)

**Output**: 1080×1080 PNG with:

- Hero image (pitch), red panel, player names (formatted short names), captain/keeper markers, sponsorship text

---

## 7. Gotchas & Tech Debt

### 1. Role-Check Logic Baked into Services

**Issue**: Access control is scattered—`getAccessibleTeamIds` (service.ts:33–53) is called in many services but logic is duplicated with requireRole middleware.
**Impact**: Risk of auth bypass if a service is called without the middleware check.
**Recommendation**: Centralize role/team access validation in a shared service or custom preHandler.

### 2. Static Route Registration Order

**Issue**: `GET /matchday/expenses/pending` **must** be registered before parameterized `:expenseId` routes (routes.ts:211 comment) or it will be treated as a variable param.
**Impact**: Easy to break if route order is accidentally changed during refactoring.
**Recommendation**: Use explicit route prefixes or group related routes.

### 3. Idempotent finishMatch with Conditional Side Effects

**Issue**: finishMatch (service.ts:920–1088) is idempotent on result resubmission but only runs charge/email logic on first finish (`isFirstFinish = matchday.status === "confirmed"`).
**Impact**: Easy to assume result updates are always idempotent, but this is a subtle state-check in the middle of the handler. Silent no-op on retry.
**Recommendation**: Document behavior or split into separate endpoints (finish vs. update-result).

### 4. Fee Rate Lookup Logic Complexity

**Issue**: `findFeeRate` (service.ts:90–127) uses 4-level priority; bursary category is hard-coded exempt (line 725). Matching is by exact category string.
**Impact**: If category naming changes or new categories added, fee logic breaks silently (no matching rate = no charge).
**Recommendation**: Store a canonical category enum, add validation at member creation.

### 5. Guest Member Creation in addPlayer

**Issue**: Guest members created on-the-fly with minimal fields (empty email, title, address, etc.) just to represent ad-hoc players. No cleanup of unused guests.
**Impact**: DB pollution; difficult to query "real" members vs. one-off players.
**Recommendation**: Use a dedicated guest/pseudo-member flag or separate table for ad-hoc registrations.

### 6. Email Sending Error Handling

**Issue**: finishMatch email loop (service.ts:1047–1081) catches errors per player but doesn't retry; errors are just logged and collected in response.
**Impact**: Player doesn't know payment is due if email fails; no alert to admin.
**Recommendation**: Add retry queue (bull/BullMQ) or send admin alert on email failure.

### 7. Play-Cricket API Date Parsing

**Issue**: Play-Cricket returns dates as "dd/MM/yyyy"; conversion to ISO (YYYY-MM-DD) done via string manipulation (service.ts:29–31) to avoid timezone issues.
**Impact**: Fragile if Play-Cricket format changes; assumes exactly 10 chars.
**Recommendation**: Add date validation or use a date parsing library with format specification.

### 8. Season Year Heuristic in getUpcomingMatches

**Issue**: Jan–Mar logic (service.ts:393–394) assumes Feb/Mar transitions may span seasons. Hard-coded year boundary.
**Impact**: Breaks in edge cases (e.g., new year, daylight saving shifts).
**Recommendation**: Make date range configurable by officials (allow selecting season explicitly).

### 9. No Pagination on availability_fixture Fetches

**Issue**: getRequest (service.ts:237–242) fetches all fixtures for a request with no limit.
**Impact**: Large requests (100+ matches) will be slow and memory-heavy.
**Recommendation**: Implement cursor-based or limit-based pagination.

### 10. Stripe Payment Intent Linkage Under Lock

**Issue**: payOutstandingCharges uses `forUpdate()` (service.ts:55–56) to prevent concurrent payment requests, but the lock is released after creating the PI.
**Impact**: If two requests race and both create a PI before seeing the other's PI, charges get double-linked.
**Recommendation**: Consider holding the lock until successful payment confirmation or use a unique charge batch ID.

### 11. Type Casting for user.role

**Issue**: Throughout routes (line 86, 102, 159, etc.), user.role is cast as `{ role?: string | null }` because TypeScript doesn't narrow the session type.
**Impact**: Repetitive; risk of typo in cast.
**Recommendation**: Extend better-auth User type globally or create a typed helper.

### 12. No Validation of Overlapping Availability Requests

**Issue**: createRequest checks for overlap (service.ts:46–59), but does not prevent re-opening a previously closed request.
**Impact**: Could accidentally create duplicate fixture records if close/reopen pattern used.
**Recommendation**: Enforce request status strict state machine (open → closed → archived).

---

**Generated**: 2026-04-23  
**Scope**: Matchday, Availability, Games (public), Charges (player-facing) API routes + services + schemas + selected web pages  
**Word Count**: ~1650
