# Event Quiz

A live quiz game for events: players check in on their phones and race to answer on a shared screen, Kahoot-style. Made for 100+ players.

- Players scan a QR code and check in (name, email, phone, LinkedIn, consent). No app to install.
- Each question has a timer, and faster correct answers score more, with a bonus for answer streaks.
- A leaderboard shows after each question, and a final podium at the end.
- The host can download every check-in as a CSV file.
- Reusable: each event is one JSON file in `events/`.

## Run locally

```bash
npm install
HOST_KEY=your-long-secret npm start     # http://localhost:8080
npm run sim                              # simulate 120 players (needs the server running)
```

## Event file format (`events/<id>.json`)

```json
{
  "title": "My Event",
  "timePerQuestion": 20,
  "doubleLast": 3,
  "questions": [
    { "q": "Question text?", "answers": ["A", "B", "C", "D"], "correct": 0, "time": 15, "fact": "Shown after the answer" }
  ]
}
```

`correct` is the zero-based index of the right answer. `time` (in seconds) is optional and overrides the default for that question.
Optional `"logo": "/logos/file.png"` shows an image from `public/logos/` on the lobby, scoreboard, podium and player check-in screens.
Optional `doubleLast` (0-10) gives double points on the last N questions. Optional `fact` (200 chars) is shown on the big screen after the answer is revealed.
Only `events/sample-*.json` files are committed. Keep live question sets private so players can't look up the answers.

## Game features

- **Host screen sound**: lobby music, question music, countdown ticks, reveal sting, drumroll + fanfare for the podium. All synthesized in the browser (`public/sfx.js`), no audio files. 🔊 button or the M key mutes.
- **Remove a player**: click a name twice in the lobby, or ✕ twice on the scoreboard. Their email can't rejoin that game.
- **Name filter** (`names.js`) blocks common profanity and slurs, including leetspeak. Players can tap 🎲 for a random hacker name.
- **Reconnects**: a refreshed host screen returns to the current question, reveal or results. A phone that rejoins (or checks in again with the same email) keeps its score. Late joiners get the current question.
- **Engagement**: % who got it right, fun facts, rank arrows on the scoreboard, "X pts behind NAME" on phones, double-points questions, and bonus prizes for players outside the top 3 (longest streak, biggest climber, fastest correct answer).

## Deploy (Cloud Run)

Game state is held in memory, so run a single instance. A Cloud Storage bucket is mounted so question edits and
check-ins survive restarts. Passwords come from Secret Manager.

```bash
gcloud run deploy event-quiz --source . --region us-central1 --allow-unauthenticated   --max-instances 1 --concurrency 1000 --session-affinity --timeout 3600 --execution-environment gen2   --add-volume name=quiz,type=cloud-storage,bucket=YOUR-BUCKET   --add-volume-mount volume=quiz,mount-path=/mnt/quiz   --set-env-vars EVENTS_DIR=/mnt/quiz/events,DATA_DIR=/mnt/quiz/data,SHEET_WEBHOOK_URL=https://script.google.com/macros/s/.../exec   --set-secrets HOST_KEY=event-quiz-host-key:latest,SHEET_SECRET=event-quiz-sheet-secret:latest
```

Then set `PUBLIC_URL` to the service URL (`gcloud run services update event-quiz --update-env-vars PUBLIC_URL=...`).
On Windows Git Bash, prefix the deploy with `MSYS2_ARG_CONV_EXCL="volume=;EVENTS_DIR="` so `/mnt/...` paths aren't rewritten.
Upload live question sets to `gs://YOUR-BUCKET/events/`.

## Leads

Every check-in goes to a Google Sheet through `sheet-webhook.gs` (an Apps Script web app; see the comments in that file).
A second tab, **HubSpot Import**, reshapes consenting players into HubSpot's import columns with one formula in A1:

```
=ARRAYFORMULA({"First Name","Last Name","Email","Phone Number","LinkedIn URL","Lead Status","Event";IFERROR(UNIQUE(FILTER({IFERROR(REGEXEXTRACT(Sheet1!E2:E,"^\S+"),""),TRIM(REGEXREPLACE(Sheet1!E2:E&"","^\S+","")),Sheet1!F2:F,Sheet1!G2:G&"",Sheet1!H2:H,IF(Sheet1!F2:F<>"","New",""),Sheet1!B2:B},Sheet1!I2:I=TRUE,Sheet1!F2:F<>"")),{"","","","","","",""})})
```

After the event: open that tab, File > Download > CSV, then HubSpot > Contacts > Import.
Direct HubSpot push (`HUBSPOT_TOKEN`) is still supported in `leads.js` but is off in production.

## Status

- [x] Game server and 120-player simulation
- [x] Host screen
- [x] Player check-in and answer screen
- [x] Question editor / spreadsheet import
- [x] Durable lead storage and deploy
- [x] Load test: 150 players on the live server, 0 errors, answer p95 67ms (needs `--concurrency 1000`; the default 80 refuses player 81+)
