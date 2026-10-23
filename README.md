# QuickNotes System Design

QuickNotes System Design combines a working browser API client with a proposed
backend design for a note-taking service with 1 million registered users. The
client practices GET, POST and DELETE against JSONPlaceholder, while the three
design documents describe the real API, relational data model and architecture
that a backend team could build. No production backend is deployed by this
project.

## Run the API client locally

1. Clone or download this repository and open the **quicknotes-system-design**
   folder in VS Code.
2. Open `index.html`, right-click and select **Open with Live Server**.
3. Keep an internet connection available so the client can reach JSONPlaceholder.

There is no build step, package installation, API key or backend server to set
up. Live Server supplies the local web server. If cloning in Git Bash:

```bash
git clone https://github.com/Ndolo-Awuor/quicknotes-system-design.git
cd quicknotes-system-design
```

## Try it

- Click **Load notes** to request 10 notes and display their titles and bodies.
  By default, cards for server IDs 1–10 show realistic English demo examples
  about shopping, meetings, bills, study and other everyday tasks, using the
  preferred sample names. These are fictional examples, not translations.
  Check **Show original API placeholder text** to inspect the fetched title
  and body without making another request. Notes you create always show your
  own text.
- Enter a title and an optional body, then click **Create note**; the returned
  note appears first, with its server ID and HTTP success status in the message.
- Click a note's **Delete** button to request deletion and remove that card.
- Submit a blank title or a title over 100 characters to see validation; the
  live title counter warns near the limit. Whitespace around titles is trimmed.
- Watch the status message for loading, success and error feedback. Buttons
  and form fields are disabled while a request is running.
- Delete the displayed notes to see the empty state, then load again to restore
  the practice server's records.

### Practice API limitations

[JSONPlaceholder](https://jsonplaceholder.typicode.com/) simulates writes:
created notes and deletions are **not persisted**. Loading again replaces the
display with server fixtures, and refreshing clears the current page state.
Every POST may return the same ID, such as 101; a separate local key prevents
deleting one simulated note from removing all cards with that ID. DELETE is
still requested for the returned server ID. If a newly created practice note
gets a 404, it is removed locally as already absent; other errors keep the card
and show an error. A comment in `api.js` explains this behavior.

The API client's fixed `userId: 1` is practice data, **not authentication**.
The proposed real service derives the user from a validated access token and
persists notes in SQL. Original JSONPlaceholder records are retained in memory
and can be displayed with the checkbox; English demo examples only change the
presentation of the ten loaded cards, not server data, IDs or DELETE requests.

## Design documents

- [API design](docs/api-design.md): owned-note and tag endpoints, status codes,
  JSON examples, pagination, validation and error responses.
- [Data model](docs/data-model.md): users, notes, tags and note_tags, ownership
  constraints, executable SQLite schema, sample data, queries and indexes.
- [Architecture](docs/architecture.md): requirements, explicit workload
  assumptions, traffic/storage calculations, architecture diagram, request
  flows, trade-offs and failure handling.

## Repository structure

```text
quicknotes-system-design/
├── index.html
├── api.js
├── style.css
├── README.md
└── docs/
    ├── api-design.md
    ├── data-model.md
    └── architecture.md
```

## Verification

The client was checked in Chromium at 1280, 600, 390 and 320 pixels wide, with
no horizontal page overflow. Live JSONPlaceholder requests returned 10 notes,
created a note with status 201 and ID 101, and deleted it with status 200.
Controlled response tests covered loading/disabled controls, empty lists, blank
and 101-character titles, an accepted 100-character title, duplicate simulated
IDs, HTTP errors, network failure, invalid JSON, a 204 DELETE response and safe
display of HTML-looking text. Failed creates preserve the draft; failed loads
and deletes preserve previously displayed notes.

All six SQL blocks in the data-model document ran in SQLite. Query results,
foreign keys, cross-user tag protection, uniqueness, length constraints,
deletion cascades and index use were checked. JSON examples and workload
calculations were also checked. These checks validate the submitted client and
teaching schema; production capacity and recovery targets still require the
load and failover tests described in the architecture document.

For a manual error check, open browser DevTools, switch the Network panel to
**Offline**, and click Load notes after the page has loaded; restore network
access afterwards. To run the SQL examples, use a new SQLite database, then
execute the schema, sample data and query blocks in document order.

## What I learned

- `fetch()` needs an explicit `response.ok` check because HTTP errors such as
  404 and 500 do not automatically reject the request promise.
- Reusing a request helper and restoring controls in `finally` makes loading
  and failure behavior consistent across GET, POST and DELETE.
- `createElement` and `textContent` display user text without treating it as HTML.
- A join table represents many-to-many note/tag relationships, while keys,
  transactions and ownership checks protect data integrity.
- Scaling estimates need stated assumptions; caches and read replicas improve
  read capacity but introduce freshness and failure-handling trade-offs.
- A working practice API client is different from a persistent production
  service, and the interface must explain simulated writes honestly.

## Git milestones

1. Add API client with GET
2. Add create note with POST
3. Add delete with DELETE
4. Add API design doc
5. Add data model doc
6. Add architecture doc
7. Add README

Submission repository:
[Ndolo-Awuor/quicknotes-system-design](https://github.com/Ndolo-Awuor/quicknotes-system-design).
