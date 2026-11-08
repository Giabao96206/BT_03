# Zero-miss search

1. Validate and normalize the English description.
2. In a PostgreSQL transaction take an advisory lock on its normalized text.
3. Return an existing image, reuse an active job, or create a new job.
4. Enqueue a high-priority BullMQ job with the database job UUID as the queue job ID.
5. Respond with HTTP 202 immediately, then stream job state changes via SSE.
6. A worker obtains the global inference lease, runs local FastSD, saves the PNG, inserts metadata and marks the job completed.
7. The browser opens the new image without a page reload. Future identical searches reuse its indexed record.

BullMQ retries failures three times with exponential backoff. The Python child has a 30-minute timeout by default, raised after a measured 15-minute float16 attempt timed out. The queue and database are separate systems, so a crash between database insertion and queue insertion may leave a queued database row; another identical search repairs the handoff by calling BullMQ `add` with the same job ID. A scheduled reconciliation task would harden this further.
