# QuickNotes REST API design

## Scope and conventions

This is the **proposed real backend**, not the JSONPlaceholder API used by the
practice client. Example base URL: `https://api.quicknotes.example/v1`.
The `.example` address is illustrative; this project does not deploy a backend.

- Send and receive JSON using `Content-Type: application/json`.
- Use HTTPS and `Authorization: Bearer <access-token>` on every endpoint below.
  Validate the token and derive the user ID from it; never trust a client-supplied
  `userId` to decide ownership. The practice client's fixed `userId: 1` is only
  for JSONPlaceholder and must not be copied into the real authorization design.
- Users own their notes and tags. All queries and mutations check ownership.
  Another user's note or tag returns 404 to avoid revealing its existence.
- Titles are trimmed, required, and 1–100 Unicode characters. Body is optional,
  defaults to `""`, and is limited to 10,000 characters. Reject incorrect types,
  unknown fields and invalid JSON with 400.
- IDs are positive integers. Timestamps are UTC ISO 8601 strings. The backend
  generates IDs and timestamps; callers cannot set them.
- List notes newest ID first using cursor pagination: `limit` defaults to 20
  (allowed range 1–100), and optional `before_id` must be a positive integer.
  Return `next_before_id: null` when there is no next page. Fetch one extra row
  internally to determine whether more results exist.
- An optional `tag_id` filters the note list to a tag owned by the caller.
  Rate-limit requests per user and document a `Retry-After` header for 429.

## Endpoints

Paths below are relative to `/v1`.

| Method | Path | Description | Request body | Success |
| --- | --- | --- | --- | --- |
| GET | `/notes?limit=20&before_id=43` | List the caller's notes, newest first, optionally before a cursor. | None | 200 OK |
| GET | `/notes/{id}` | Read one note owned by the caller, including its tags. | None | 200 OK |
| POST | `/notes` | Create a note and attach any supplied owned tags atomically. | `{ "title": "Plan", "body": "Review", "tagIds": [3] }` | 201 Created |
| PATCH | `/notes/{id}` | Update the title and/or body, requiring at least one field. | `{ "title": "Updated plan" }` | 200 OK |
| DELETE | `/notes/{id}` | Delete an owned note and its note/tag links. | None | 204 No Content |
| GET | `/tags` | List the caller's tags alphabetically. | None | 200 OK |
| POST | `/tags` | Create a tag with a trimmed name of 1–30 characters, unique per user ignoring ASCII case. | `{ "name": "work" }` | 201 Created |
| PUT | `/notes/{id}/tags` | Replace all tags on an owned note in one transaction; an empty array clears them. | `{ "tagIds": [3, 5] }` | 200 OK |
| DELETE | `/tags/{id}` | Delete an owned tag and its links while keeping the notes. | None | 204 No Content |
| GET | `/notes?tag_id=3&limit=20` | List the caller's notes with one owned tag, using the same pagination rules. | None | 200 OK |

The last row is a filtered use of the list endpoint, not a separate resource.
`tagIds` is optional on POST and defaults to an empty array; each tag must exist,
belong to the caller and appear only once. PATCH returns the complete updated
note; PUT returns the note's updated `tags` array in `{ "data": [...] }`.
GET `/tags` also uses `{ "data": [...] }`. A 204 response has no JSON body.

## Create a note: request and response

Assume the authenticated user is **Judith Kerubo**, user ID 1, and she already
owns tag 3, named `work`.

```http
POST /v1/notes
Authorization: Bearer <access-token>
Content-Type: application/json
```

Request JSON:

```json
{
  "title": "Review the project with Peter Onyango",
  "body": "Check the API design and data model before Day 8.",
  "tagIds": [3]
}
```

Response: **201 Created**, with `Location: /v1/notes/42`.

```json
{
  "data": {
    "id": 42,
    "userId": 1,
    "title": "Review the project with Peter Onyango",
    "body": "Check the API design and data model before Day 8.",
    "tags": [{ "id": 3, "name": "work" }],
    "createdAt": "2026-10-23T09:00:00.000Z",
    "updatedAt": "2026-10-23T09:00:00.000Z"
  }
}
```

Save the note and note/tag links in one database transaction. Commit an outbox
event in the same transaction for background work, then invalidate the user's
cached note lists before reporting success. If cache invalidation fails, bypass
that user's cached lists until invalidation succeeds; expiry remains a fallback.
The note stays saved if background processing is delayed.

## List notes: request and response

GET does **not** have a request JSON body: its inputs are the token and query
parameters. This is the request:

```http
GET /v1/notes?limit=2
Authorization: Bearer <access-token>
```

Response: **200 OK**. In this example exactly two notes exist, so there is no
next page; a longer list would return the last displayed ID as `next_before_id`.

```json
{
  "data": [
    {
      "id": 42,
      "userId": 1,
      "title": "Review the project with Peter Onyango",
      "body": "Check the API design and data model before Day 8.",
      "tags": [{ "id": 3, "name": "work" }],
      "createdAt": "2026-10-23T09:00:00.000Z",
      "updatedAt": "2026-10-23T09:00:00.000Z"
    },
    {
      "id": 41,
      "userId": 1,
      "title": "Prepare the presentation",
      "body": "Ask Mike Ndolo to review the architecture diagram.",
      "tags": [],
      "createdAt": "2026-10-22T16:30:00.000Z",
      "updatedAt": "2026-10-22T16:30:00.000Z"
    }
  ],
  "page": { "limit": 2, "next_before_id": null }
}
```

An empty result is **200**, with `"data": []`, not 404. GET `/notes/{id}` uses
the same single-note `data` shape as POST. Production responses never expose
password hashes, tokens or internal database details.

## Errors

| Status | When it happens |
| --- | --- |
| 400 Bad Request | Invalid JSON, a blank or overlong title, an invalid cursor, duplicate tag IDs, or a body longer than 10,000 characters. |
| 401 Unauthorized | The bearer token is absent, invalid or expired; include `WWW-Authenticate: Bearer`. |
| 403 Forbidden | A valid user has a read-only account policy that prohibits the requested write. |
| 404 Not Found | The note or tag does not exist, is already deleted, or is not owned by the caller. |
| 409 Conflict | The caller tries to create a tag name they already own. |
| 429 Too Many Requests | The caller exceeds the request limit; include `Retry-After`. |
| 500 Internal Server Error | An unexpected server fault prevents completion; log details privately and return a generic message. |

Use one consistent error envelope. Example **400** response:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Title is required and must be 100 characters or fewer.",
    "details": { "field": "title" },
    "requestId": "req-20261023-001"
  }
}
```

Other errors use the same envelope with a suitable code and message; `details`
may be empty. A failed create must not leave a partially written note/tag set.
Clients should not automatically retry an uncertain POST: it might already have
committed. A production extension can use a stored, per-user idempotency key to
make intentional POST retries safe.
