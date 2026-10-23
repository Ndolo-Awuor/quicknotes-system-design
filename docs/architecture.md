# QuickNotes architecture

## 1. Scope and requirements

This is a design for the **real online QuickNotes service** used by 1 million
registered people. The submitted browser client demonstrates HTTP with
JSONPlaceholder; it does not implement or deploy this production architecture.

### Functional requirements

- Sign in and access only notes and tags owned by the authenticated user.
- Create, list, read, edit and delete notes; require a title of 1–100 characters
  and allow an optional body up to 10,000 characters.
- Create and delete personal tags, associate several tags with one note, and
  filter a paginated note list by a tag.
- Preserve committed changes across browser refreshes and app-server restarts.
- Process nonessential jobs, such as aggregate usage counts, in the background.
- Return clear validation, authorization and service errors without exposing
  internal details or another user's information.

### Non-functional requirements

These are **proposed targets to validate**, not measured guarantees.

- Availability: target 99.9% monthly API availability with a defined monitoring
  window and incident process.
- Latency: under normal load, target server-side p95 below 300 ms for cached
  lists and below 500 ms for a note create, excluding the user's network delay.
- Capacity: test the estimated 5x peak, keep headroom, and scale using latency,
  CPU, connection counts, queue age and database metrics.
- Security: use TLS, validate token issuer/audience/expiry, check ownership on
  every request, use parameterized SQL, limit requests and protect secrets.
- Durability and recovery: use managed database redundancy, encrypted backups
  and point-in-time recovery; test an initial regional-disaster RPO target of
  5 minutes and RTO target of 1 hour within permitted data-residency locations.
- Consistency: writes commit on the primary; ordinary cached/replica lists may
  be briefly stale, while reads requiring the latest write use the primary.
- Operability: collect request IDs, error rates, latency, cache hit rate,
  replica lag and oldest queue-job age, without logging private note bodies.

RPO is how much recent data a disaster might lose; RTO is how long recovery
may take. Backups and an asynchronously copied disaster-recovery dataset need
regular restore tests; they do not automatically deliver these targets.

## 2. Assumptions and load estimate

The assignment gives 1 million users but no activity rate, so assume:

| Assumption | Value |
| --- | --- |
| Registered users | 1,000,000 |
| Daily active proportion | 10%, giving 100,000 daily active users |
| Reads per active user per day | 50 note-list requests |
| Writes per active user per day | 10 new-note requests |
| Average stored note record | 1 KB, including its normal title, body and row metadata, excluding indexes and replicas |
| Retention | Keep all new notes for the year; ignore deletions and compression |
| Time and peak multiplier | 86,400 seconds/day, 365 days/year, peak = 5x average |
| Units | Decimal: 1 KB = 1,000 bytes, 1 GB = 1,000,000 KB |

These are workload assumptions, not limits on the average person's behavior.
An average 1 KB record is smaller than the permitted maximum note. Edits,
deletes, tag operations, authentication and background work add traffic and
storage overhead beyond this initial estimate.

| Operation | Daily requests | Average requests/second | Peak requests/second |
| --- | ---: | ---: | ---: |
| Reads | 100,000 x 50 = 5,000,000 | 5,000,000 / 86,400 = 57.87 | 25,000,000 / 86,400 = 289.35 |
| Writes | 100,000 x 10 = 1,000,000 | 1,000,000 / 86,400 = 11.57 | 5,000,000 / 86,400 = 57.87 |

Provision based on at least **290 read requests/second and 58 write
requests/second at the assumed peak**, plus headroom. These are API requests;
one POST can execute several SQL statements, update the cache and create an
outbox event. Do not equate requests/second with database operations/second.
Using the classroom 100,000-second shortcut gives rough averages of 50 reads
and 10 writes per second.

The system is **read-heavy**, with 5 list reads for every new-note write.
The estimates support caching and read scaling, but do not justify immediate
database sharding; benchmark a managed SQL primary before adding complexity.

### Storage added per year

```text
1,000,000 new notes/day x 1 KB = 1 GB/day
1 GB/day x 365 days = 365 GB/year of logical note records
```

As a planning allowance, assume indexes and row overhead beyond that average
require up to another 100%: **730 GB for the primary dataset plus indexes**.
A full read replica then brings those two copies to about **1.46 TB**. This is
an allowance, not an exact storage measurement. The HA standby, backups,
user/tag/link rows, outbox, logs and temporary space are extra. Retaining notes
for additional years increases the baseline; measure actual note sizes and
index growth. If all 1 million users become active daily, these traffic and
logical annual-storage estimates become 10 times larger.

## 3. Architecture diagram

```text
                         [Client: browser / phone]
                                     |
                              resolves hostnames
                                     v
                          [Managed redundant DNS]
                       /                         \
             web hostname                     API hostname
                  |                                |
                  v                                v
          [CDN: static assets]           [Redundant load balancer]
                  |                         /                 \
             cache miss                    v                   v
                  v                [App server A]       [App server B]
      [Replicated static origin]       [Zone A]             [Zone B]
                                        |                     |
                                        +----------+----------+
                                                   |
                          +------------------------+------------------+
                          |                        |                  |
                          v                        v                  v
               [Redis cache with HA]    [Primary SQL database]  [SQL read replica]
                                         |               |       (feed/list reads)
                                  synchronous HA    async read        ^
                                         |          replication ------+
                                         v
                                 [Standby in Zone B]

       App background publisher reads committed outbox events from primary
                                    |
                                    v
                      [Replicated durable job queue]
                              /             \
                             v               v
                     [Worker A]         [Worker B]
                        Zone A             Zone B
                              \             /
                      [Background aggregate processing]
```

The diagram shows logical connections, not literal cable routes. DNS resolves
names and then the client makes HTTPS requests directly to the returned
destinations; DNS is not a proxy for every API call. The CDN serves HTML, CSS
and JavaScript from the static origin. **Do not publicly cache private note
responses at the CDN**; API traffic goes to the load balancer. Redis stores
user-specific application results on the private network.

### Component responsibilities

| Component | Problem it solves |
| --- | --- |
| Client | Displays notes and sends authenticated HTTP requests while showing loading, empty and error states. |
| DNS | Maps the web and API hostnames to the appropriate service destinations. |
| CDN | Delivers cached public static assets close to users to reduce page-load latency and origin traffic. |
| Replicated static origin | Keeps the web files available when a CDN edge must fetch a file it does not have. |
| Load balancer | Routes requests to healthy app servers and removes unhealthy instances from rotation. |
| App servers A and B | Run the stateless API in separate zones so requests can continue if one instance or zone fails. |
| Redis cache | Reuses per-user note-list results to reduce repeated SQL reads and improve latency. |
| Primary SQL database | Authoritatively stores users, notes, tags and links, committing writes and outbox events transactionally. |
| HA standby | Provides a failover target if the primary host or its zone fails. |
| SQL read replica | Offloads suitable note-list reads while accepting that replication can lag. |
| Durable queue | Buffers background events so slow processing does not delay ordinary API responses. |
| Workers A and B | Consume queued work independently so one failed worker does not stop background processing. |

## 4. GET /notes flow

1. The client resolves the API hostname through DNS and sends
   `GET /v1/notes?limit=20` with its bearer token over HTTPS.
2. The load balancer chooses a healthy app server. The server validates the
   token, derives the user ID, applies rate limits and validates query inputs.
3. The server looks in Redis using a key containing the **user ID, cursor,
   page size and tag filter**, so one person's cached notes are never returned
   to someone else.
4. On a cache hit, return the cached owned-note page with 200. On a miss, query
   the read replica with the ownership predicate and pagination index, fetch
   the page's tags in a batch, and cache the result with a short TTL such as
   30 seconds. Do not issue a separate tag query for every note.
5. If the caller requires fresh data after a write, honor
   `Cache-Control: no-cache` by bypassing Redis and the replica and reading the
   primary. Also read the primary if replica health or lag is unacceptable.
6. Return JSON with `data` and pagination information; an empty list is 200
   with `data: []`. The client renders text safely and shows the appropriate
   state rather than treating an empty list as an error.

Redis and replica failures must not create an uncontrolled surge on the primary:
use connection limits, request coalescing for identical cache misses, timeouts
and rate limits. Reject excess traffic cleanly rather than exhausting SQL
connections. Private note data is never placed in a shared public CDN cache.

## 5. POST /notes flow

1. The client sends `POST /v1/notes` with a bearer token and JSON containing
   `title`, optional `body` and optional `tagIds`; the load balancer routes it
   to a healthy app server.
2. The app validates authentication, account write permission and all fields,
   then checks that the referenced tags belong to the authenticated user.
3. In **one primary-database transaction**, insert the note, its tag links and
   a minimal outbox event with a unique event ID. Commit all or none of them.
4. Invalidate the affected user's cached list pages and any relevant individual
   note entry before reporting success. Use per-user cache versions to prevent
   an older in-flight request from filling the current cache namespace; bound
   ordinary cache staleness with a short TTL. If invalidation fails, bypass that
   user's cached lists until it is safe to resume caching.
5. Return **201 Created**, a `Location` header and the new note from the primary.
   The client displays the returned note immediately; a subsequent explicit
   freshness request follows the primary-read path described above.
6. An app background publisher reads committed outbox events, sends them to
   the durable queue and marks them published only after queue acknowledgement;
   it retries if the queue is unavailable.
7. A worker performs optional aggregate-count processing, deduplicates by event
   ID, and acknowledges successful work. Retry transient failures and move
   repeatedly failing jobs to a dead-letter queue with an alert.

Only IDs and necessary event metadata go into the queue, not full private note
bodies. Queue delivery can happen more than once, so workers must be idempotent.
Failure after publishing but before marking the outbox event published must not
cause a repeated business action. Keep the essential note write independent
of worker availability. See the data-model document for the operational outbox
extension beyond the four required domain tables.

The API must not blindly retry a POST after an ambiguous timeout; a committed
write could otherwise be duplicated. Add a stored, user-scoped idempotency key
if automatic create retries are introduced.

## 6. Trade-offs and single points of failure

| Decision | Benefit | Cost or limitation | Mitigation |
| --- | --- | --- | --- |
| Cache and read replica | Faster repeated reads and reduced primary pressure. | Cached data or asynchronous replicas may be stale. | Invalidate/version cache entries, use short TTLs, monitor lag and use primary reads for required freshness. |
| Queue and workers | Shorter write responses and independent scaling of background tasks. | Background results are delayed, and deliveries may be duplicated. | Transactional outbox, retry policy, event deduplication and a dead-letter queue. |
| SQL transactions and one logical write primary | Strong ownership constraints and atomic note/tag changes. | The primary is a write-capacity bottleneck; standby failover can briefly interrupt service. | Index and benchmark first, use managed HA, retry safe operations and consider partitioning only when measurements justify it. |
| Multiple zones and redundant components | A host or zone failure need not stop the service. | More cost and operational complexity; it does not solve an entire-region outage. | Test failover, monitor dependencies and maintain a tested regional disaster-recovery plan. |

Avoid a single physical failure point in each layer:

- Use managed redundant authoritative DNS, a CDN with multiple edge locations
  and a replicated origin. A complete provider outage is still a residual risk.
- Use a redundant managed load balancer and at least two stateless app servers
  in separate availability zones with health checks. Share no required session
  state in one app server's memory; verify tokens on any instance.
- Use Redis replication/managed failover; if it fails, degrade to limited SQL
  reads rather than treating the cache as the source of truth.
- Use a managed SQL primary with a **synchronous HA standby in another zone**
  and automatic failover, plus a **separate asynchronous read replica**. A read
  replica alone is not a complete HA or backup strategy. Retry safe reads after
  failover and re-establish connections; writes can briefly pause.
- Use a replicated durable queue and workers in at least two zones. The outbox
  prevents a queue outage from losing the fact that a committed note needs work.
- Keep encrypted backups and point-in-time recovery separate from live replicas;
  accidental deletion can replicate too. Test restore and regional failover
  against the stated RPO/RTO targets, subject to residency requirements.
- Test identity-provider and secrets-service outages as dependencies as well;
  token verification may use cached signing keys within safe validity rules,
  but do not bypass authentication just to keep requests succeeding.

No design removes every possible outage. This plan removes single-instance
dependencies, names the remaining consistency and regional risks, and requires
load, failure and restore tests before claiming the proposed targets are met.
