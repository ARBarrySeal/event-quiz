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
  "questions": [
    { "q": "Question text?", "answers": ["A", "B", "C", "D"], "correct": 0, "time": 15 }
  ]
}
```

`correct` is the zero-based index of the right answer. `time` (in seconds) is optional and overrides the default for that question.
Only `events/sample-*.json` files are committed. Keep live question sets private so players can't look up the answers.

## Deploy (Cloud Run)

Game state is held in memory, so run a single instance:

```bash
gcloud run deploy event-quiz --source . --region us-west1 --allow-unauthenticated \
  --max-instances 1 --session-affinity --timeout 3600 \
  --set-env-vars HOST_KEY=your-long-secret
```

## Status

- [x] Game server and 120-player simulation
- [ ] Host screen
- [ ] Player check-in and answer screen
- [ ] Question editor / spreadsheet import
- [ ] Durable lead storage and deploy
