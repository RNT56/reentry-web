# Owner control room

Owner privileges come from the existing server-side author allowlist. Registration never grants this role. The public author name remains RNT; the login username never appears in the public journal.

The control room provides account, portfolio, passkey, research and publishing counts; aggregate job states and API usage; runtime memory, uptime and available disk; current model rates; publishing shortcuts; and control history. It never returns another account's portfolio, credentials, research prompt, API usage detail or research result.

Owner actions include opening or closing registration, pausing or resuming AI dispatch globally, and cancelling queued requests. Running requests remain subject to their original usage accounting. Cancellation never retries a dispatched or ambiguous request.

`createAdminControls(db,{registration})` creates an additive `admin_controls` table without inserting or modifying settings during startup. The initial registration flag follows deployment configuration. Explicit owner writes are transactional and append an audit event. Persisted choices survive app updates.

Integration: create controls before authentication; expose `config.registration` as a getter for `controls.get().registrationOpen`. Pass `paused: () => controls.get().aiPaused` to the AI engine, and gate enqueue, scheduler/dispatch before billing. Register `registerAdminRoutes(app, services)` with controls and existing `isAuthor`, db, vault, engine and connectors. Mount `mountAdmin(root,{navigate,onStudio})` only when authenticated capabilities identify the owner. Server routes independently enforce the role.
