# Content blocks reference

Every custom block available in the content editor. Use the `/` slash menu while editing to insert them.

Blocks are stored as part of the page body and render identically whether the page was authored with the editor or migrated from an older MDX file.

---

## Person card

**Slash menu:** Club content > Person card

Displays a profile card for a single club member, including their photo, name, and a link to their full profile page.

| Prop | Type   | Required | Default | Notes                                                     |
| ---- | ------ | -------- | ------- | --------------------------------------------------------- |
| slug | string | Yes      |         | The person's URL slug (e.g. `alex-slaven`)                |
| role | string | No       |         | Optional label shown beneath the name (e.g. "Head Coach") |

**Typical usage:** Introduce a committee member or coach on a team page.

---

## Person grid

**Slash menu:** Club content > Person grid

Displays a responsive grid of person cards. Choose one or more people using the multi-select control inside the editor (hold Ctrl or Cmd to pick more than one).

| Prop  | Type   | Required | Default | Notes                                                                                         |
| ----- | ------ | -------- | ------- | --------------------------------------------------------------------------------------------- |
| slugs | string | Yes      |         | Comma-separated list of person slugs (stored and managed automatically by the editor control) |

**Typical usage:** Show the full committee, a coaching team, or the playing squad on an "About" page.

---

## Game preview

**Slash menu:** Club content > Game preview

Shows a live fixture or result card, pulling data from Play-Cricket. Displays the teams, date, competition, home/away indicator, and the final score where available.

| Prop          | Type   | Required | Default | Notes                                                                      |
| ------------- | ------ | -------- | ------- | -------------------------------------------------------------------------- |
| playCricketId | string | Yes      |         | The Play-Cricket match identifier (choose from the dropdown in the editor) |

**Typical usage:** Highlight a recent result or upcoming fixture inside a news article or report.

---

## Wagon wheel

**Slash menu:** Club content > Wagon wheel

Embeds the interactive ball-by-ball shot chart for a match (the same viewer as the "Ball by ball" button on a match page), inside a self-contained dark panel. Plots every scoring shot's direction and length from the wicket, with a cumulative-runs chart, an over-by-over filter, and a ball list.

Pick a match (a season selector lets you reach historical fixtures), then choose the batting team. Optionally pre-filter to a single batter or bowler to spotlight a performance. Readers can still switch innings and change the filters - the configuration only sets the initial view.

The block only renders for matches with recorded shot directions (live-scored Play-Cricket fixtures where the scorer logged shot data); otherwise it shows a short "no data" message.

| Prop          | Type   | Required | Default       | Notes                                                              |
| ------------- | ------ | -------- | ------------- | ------------------------------------------------------------------ |
| matchId       | string | Yes      |               | Play-Cricket match identifier (chosen via the season/match picker) |
| inningsNumber | string | No       | First innings | The batting team to show (1 or 2)                                  |
| batterRvId    | string | No       | All batters   | Pre-select a single batter's shots                                 |
| bowlerRvId    | string | No       | All bowlers   | Pre-select shots played off a single bowler                        |

**Typical usage:** Illustrate a match report with a batter's scoring zones or a bowler's wicket-taking spell.

---

## Worm chart

**Slash menu:** Club content > Worm chart

Plots cumulative runs through the innings (the "worm") for both teams on one chart, with wicket markers you can hover for the dismissal. Only needs runs per ball, so it works for any live-scored match, not just those with shot data.

Pick a match and the team whose line should be highlighted (drawn solid; the other team is faded). Readers can flip the highlight between teams.

| Prop          | Type   | Required | Default       | Notes                                                              |
| ------------- | ------ | -------- | ------------- | ------------------------------------------------------------------ |
| matchId       | string | Yes      |               | Play-Cricket match identifier (chosen via the season/match picker) |
| inningsNumber | string | No       | First innings | The batting team to highlight (1 or 2)                             |

**Typical usage:** Show how a run chase unfolded, or compare two innings in a match report.

---

## Event preview

**Slash menu:** Club content > Event preview

Shows a compact event card with the date, name, and a link to the full calendar entry.

| Prop    | Type   | Required | Default | Notes                                 |
| ------- | ------ | -------- | ------- | ------------------------------------- |
| eventId | string | Yes      |         | The internal event identifier         |
| name    | string | Yes      |         | The event display name                |
| when    | string | Yes      |         | The event date (ISO date or datetime) |

**Typical usage:** Promote an upcoming club event from within a page or news post.

---

## Upload photo

**Slash menu:** Club content > Upload photo

Uploads an image through the consent and processing pipeline and inserts a responsive photo block. You must tick the photo consent box in the left panel before uploading.

| Prop    | Type   | Required | Default | Notes                                                             |
| ------- | ------ | -------- | ------- | ----------------------------------------------------------------- |
| src     | string | Yes      |         | Set automatically after upload                                    |
| alt     | string | No       |         | Describe the photo for screen readers                             |
| caption | string | No       |         | Short caption shown beneath the image                             |
| picture | string | No       |         | JSON descriptor used for responsive rendering (set automatically) |

**Typical usage:** Add match photos, venue images, or team photos to a page or article.

---

## League table

**Slash menu:** Page widgets > League table

Fetches and displays a live standings table from Play-Cricket for a given division.

If `divisionId` is not set the block renders nothing (degrades silently). No division listing is currently available through the API, so you need to look up the division ID from Play-Cricket directly.

| Prop       | Type   | Required | Default | Notes                                |
| ---------- | ------ | -------- | ------- | ------------------------------------ |
| divisionId | string | Yes      |         | The Play-Cricket division identifier |
| name       | string | No       |         | Heading shown above the table        |

**Typical usage:** Embed the current season standings on a teams or results page.

---

## Leaderboard

**Slash menu:** Page widgets > Leaderboard

Displays the club's batting and bowling leaderboard for the current season. No configuration required.

| Prop   | Type | Required | Default | Notes |
| ------ | ---- | -------- | ------- | ----- |
| (none) |      |          |         |       |

**Typical usage:** Add to a stats or season summary page.

---

## Records wall

**Slash menu:** Page widgets > Records wall

Displays the club's all-time batting and bowling records. No configuration required.

| Prop   | Type | Required | Default | Notes |
| ------ | ---- | -------- | ------- | ----- |
| (none) |      |          |         |       |

**Typical usage:** Add to a history or honours page.

---

## Contact form

**Slash menu:** Page widgets > Contact form

Embeds a contact message form. Submissions are sent by email to the club. The form cannot be submitted from inside the editor canvas (it is read-only there).

| Prop        | Type   | Required | Default | Notes                                 |
| ----------- | ------ | -------- | ------- | ------------------------------------- |
| title       | string | No       |         | Heading shown above the form fields   |
| description | string | No       |         | Short paragraph shown below the title |

**Typical usage:** Add to a "Contact us" page or any page where you want people to be able to send the club a message.

---

## Cookie settings link

**Slash menu:** Page widgets > Cookie settings link

Renders an inline link that, when clicked, reopens the cookie consent banner so the visitor can change their preferences.

| Prop | Type   | Required | Default         | Notes                 |
| ---- | ------ | -------- | --------------- | --------------------- |
| text | string | No       | Cookie settings | The visible link text |

**Typical usage:** Add to a Privacy Policy or Cookie Policy page so readers can update their preferences without hunting for a button.

---

## Consent version

**Slash menu:** Page widgets > Consent version

Displays the current cookie consent policy version string inline in the text. Useful on policy pages where you want to reference which version of the policy is currently active.

| Prop   | Type | Required | Default | Notes |
| ------ | ---- | -------- | ------- | ----- |
| (none) |      |          |         |       |

**Typical usage:** Include in the cookie or privacy policy page body so the version number stays accurate without manual editing.
