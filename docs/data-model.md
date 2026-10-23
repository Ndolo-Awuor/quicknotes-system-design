# QuickNotes data model

## Choice of database

Choose **SQL** because users, notes and tags have clear relationships, ownership
rules and uniqueness requirements. Foreign keys prevent broken references, and
transactions let a note and its tag links succeed or fail together. Joins and
indexes directly support note lists and tag filters. NoSQL could store flexible
documents, but maintaining these cross-record rules would require additional
application logic. The executable teaching schema below uses **SQLite**; the
production design uses a managed PostgreSQL database with equivalent migrations,
native timestamps and replication, rather than sharing a SQLite file between
app servers.

## Entities and columns

| Entity | Column | Type | Key or rule |
| --- | --- | --- | --- |
| users | id | INTEGER | Primary key, generated. |
| users | identity_subject | TEXT | Required and unique; account identifier from one trusted identity provider. |
| users | name | TEXT | Required; names need not be unique. |
| users | email | TEXT | Required and unique, ignoring ASCII case. |
| users | created_at | TEXT (UTC timestamp) | Required; generated on creation. |
| notes | id | INTEGER | Primary key, generated. |
| notes | user_id | INTEGER | Required foreign key to users.id. |
| notes | title | TEXT | Required, 1–100 characters after API trimming. |
| notes | body | TEXT | Required, defaults to an empty string, at most 10,000 characters. |
| notes | created_at | TEXT (UTC timestamp) | Required; generated on creation. |
| notes | updated_at | TEXT (UTC timestamp) | Required; the API updates it on every edit. |
| tags | id | INTEGER | Primary key, generated. |
| tags | user_id | INTEGER | Required foreign key to users.id. |
| tags | name | TEXT | Required, 1–30 characters; unique per user ignoring ASCII case. |
| note_tags | note_id | INTEGER | Part of the primary key; part of a foreign key to notes. |
| note_tags | tag_id | INTEGER | Part of the primary key; part of a foreign key to tags. |
| note_tags | user_id | INTEGER | Required ownership column shared by both composite foreign keys. |

API fields `userId`, `createdAt` and `updatedAt` map to SQL columns `user_id`,
`created_at` and `updated_at`. A note's `tags` array comes from joins; it is not
stored as a comma-separated string. The API derives ownership from the token.
Do not store access tokens or plaintext passwords in these tables; authenticate
through the trusted identity provider and map its subject to `users`.

## Relationships

- **users → notes is one-to-many:** one user owns many notes, and each note
  belongs to exactly one user.
- **users → tags is one-to-many:** tags are private to their owner; two users
  can each have a tag named `work`.
- **notes → note_tags and tags → note_tags are one-to-many:** each link names
  one note and one tag.
- **notes ↔ tags is many-to-many:** one note can have several tags, and a tag
  can label several notes, so the `note_tags` join table stores those pairs.

The composite primary key `(note_id, tag_id)` prevents duplicate links. Including
`user_id` in both foreign keys also prevents attaching another user's tag even
if application validation is accidentally missed. The parent `UNIQUE (id,
user_id)` constraints make those composite foreign keys valid in SQLite.

## CREATE TABLE statements

Run once in a new SQLite database. Foreign-key enforcement must be enabled for
**each connection**. API validation handles Unicode whitespace and request types;
database checks provide an additional constraint layer.

```sql
PRAGMA foreign_keys = ON;

CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    identity_subject TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    email TEXT NOT NULL COLLATE NOCASE UNIQUE,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 100),
    body TEXT NOT NULL DEFAULT '' CHECK (length(body) <= 10000),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE (id, user_id)
);

CREATE TABLE tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL COLLATE NOCASE CHECK (length(trim(name)) BETWEEN 1 AND 30),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE (user_id, name),
    UNIQUE (id, user_id)
);

CREATE TABLE note_tags (
    note_id INTEGER NOT NULL,
    tag_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    PRIMARY KEY (note_id, tag_id),
    FOREIGN KEY (note_id, user_id) REFERENCES notes(id, user_id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id, user_id) REFERENCES tags(id, user_id) ON DELETE CASCADE
);

CREATE INDEX idx_notes_user_id_id ON notes(user_id, id DESC);
CREATE INDEX idx_note_tags_tag_note ON note_tags(tag_id, note_id);
```

`AUTOINCREMENT` avoids reusing deleted IDs in this SQLite example, which keeps
ID-based pagination less surprising. PostgreSQL would use an identity column.
Keep the index ordering compatible with the API's newest-ID-first order.
SQLite's `NOCASE` is ASCII-oriented; if full Unicode tag-name matching is needed,
define and consistently apply a normalized name key in the production backend.

## Sample records

These are fictional example accounts using the preferred names and reserved
`example.com` email addresses. The identity subjects are illustrative identifiers.

```sql
INSERT INTO users (id, identity_subject, name, email) VALUES
    (1, 'demo-subject-judith', 'Judith Kerubo', 'judith.kerubo@example.com'),
    (2, 'demo-subject-peter', 'Peter Onyango', 'peter.onyango@example.com'),
    (3, 'demo-subject-mike', 'Mike Ndolo', 'mike.ndolo@example.com');

INSERT INTO notes (id, user_id, title, body) VALUES
    (41, 1, 'Prepare the presentation', 'Ask Mike Ndolo to review the diagram.'),
    (42, 1, 'Review the project with Peter Onyango', 'Check the API and data model.'),
    (43, 2, 'Study SQL joins', 'Revise the notes and tags relationship.');

INSERT INTO tags (id, user_id, name) VALUES
    (3, 1, 'work'), (5, 1, 'study'), (6, 2, 'work');

INSERT INTO note_tags (note_id, tag_id, user_id) VALUES
    (41, 5, 1), (42, 3, 1), (42, 5, 1), (43, 6, 2);
```

## Example queries

The examples use literal user ID 1 so they run in a playground. In server code,
bind the authenticated user ID, cursor and tag ID through prepared-statement
placeholders; never concatenate user input into SQL.

### 1. List one user's notes before a cursor

This returns Judith's notes 42 and 41. For the first page, omit the cursor
condition; fetch `limit + 1` rows to calculate the next cursor.

```sql
SELECT id, title, body, created_at, updated_at
FROM notes
WHERE user_id = 1 AND id < 43
ORDER BY id DESC
LIMIT 21;
```

### 2. JOIN: find a user's notes with the work tag

This returns only note 42, not Peter's note 43 with his separate `work` tag.

```sql
SELECT n.id, n.title, t.name AS tag
FROM notes AS n
JOIN note_tags AS nt ON nt.note_id = n.id AND nt.user_id = n.user_id
JOIN tags AS t ON t.id = nt.tag_id AND t.user_id = nt.user_id
WHERE n.user_id = 1 AND t.id = 3
ORDER BY n.id DESC;
```

### 3. Count notes per user, including users with none

Expected counts: Judith Kerubo = 2, Peter Onyango = 1, Mike Ndolo = 0.

```sql
SELECT u.name, COUNT(n.id) AS note_count
FROM users AS u
LEFT JOIN notes AS n ON n.user_id = u.id
GROUP BY u.id, u.name
ORDER BY u.id;
```

This aggregate is an administrative/reporting query, not a public endpoint that
allows one user to inspect other users' data.

### 4. Edit an owned note and update its timestamp

```sql
UPDATE notes
SET title = 'Presentation ready',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = 41 AND user_id = 1;
```

The API must check the affected-row count: zero means no owned note was updated.

## Index rationale and integrity

- `idx_notes_user_id_id` supports the common query that selects one user's
  notes and walks them in newest-ID-first order, avoiding a scan of all users.
- `idx_note_tags_tag_note` speeds up finding note IDs for a tag; the join table's
  primary key already supports lookups starting with a note ID.
- Indexes use disk and slow writes slightly, so add further indexes based on
  measured queries rather than indexing every column.
- Deleting a note cascades to its links, not to its tags; deleting a tag removes
  its links, not its notes. Account deletion cascades to owned notes and tags.
  The service must authorize and confirm destructive account operations.

The architecture also proposes a transactional **outbox** for reliable queue
publication. It is an operational table beyond the four required domain entities:
store an event ID, event type, user ID, note ID, payload, creation time and publish
state in the same database transaction as a note write. Workers use the event ID
to deduplicate deliveries. The production migration must add that table before
enabling background jobs; the four-table example above is the domain model.
