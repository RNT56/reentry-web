// Additive module migrations intentionally leave the core PRAGMA user_version unchanged.
// Portfolio-only rollback images can ignore these tables. Append steps; do not rewrite them.
export const platformMigrations = [
  {
    version: 1,
    sql: `
      CREATE TABLE ai_credentials(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, provider TEXT NOT NULL, encrypted TEXT NOT NULL, fingerprint TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(user_id,provider));
      CREATE TABLE ai_preferences(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, enabled INTEGER NOT NULL DEFAULT 0, provider TEXT NOT NULL DEFAULT 'gemini', model TEXT NOT NULL DEFAULT 'gemini-3.5-flash-lite', monthly_limit INTEGER NOT NULL DEFAULT 5000000, run_limit INTEGER NOT NULL DEFAULT 250000, consent_at INTEGER, updated_at INTEGER NOT NULL);
      CREATE TABLE research_assets(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, symbol TEXT NOT NULL, name TEXT NOT NULL, automatic INTEGER NOT NULL DEFAULT 0, interval_hours INTEGER NOT NULL DEFAULT 24, next_run INTEGER NOT NULL DEFAULT 0, last_check INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(user_id,symbol));
      CREATE TABLE research_sources(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,symbol TEXT NOT NULL,kind TEXT NOT NULL,title TEXT NOT NULL,url TEXT,content TEXT NOT NULL,hash TEXT NOT NULL,published_at INTEGER,fetched_at INTEGER NOT NULL,connector TEXT NOT NULL, UNIQUE(user_id,symbol,hash));
      CREATE INDEX research_sources_owner ON research_sources(user_id,symbol,fetched_at);
      CREATE TABLE ai_jobs(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,kind TEXT NOT NULL,symbol TEXT NOT NULL,provider TEXT NOT NULL,model TEXT NOT NULL,status TEXT NOT NULL,input TEXT NOT NULL,result TEXT,error TEXT,request_key TEXT NOT NULL,created_at INTEGER NOT NULL,started_at INTEGER,finished_at INTEGER,dispatched_at INTEGER,lease_until INTEGER, UNIQUE(user_id,request_key));
      CREATE INDEX ai_jobs_queue ON ai_jobs(status,created_at);
      CREATE INDEX ai_jobs_owner ON ai_jobs(user_id,created_at);
      CREATE TABLE ai_ledger(id TEXT PRIMARY KEY,job_id TEXT NOT NULL UNIQUE REFERENCES ai_jobs(id) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,provider TEXT NOT NULL,model TEXT NOT NULL,state TEXT NOT NULL,reserved INTEGER NOT NULL,cost INTEGER,pricing TEXT NOT NULL,usage TEXT,request_id TEXT,response_model TEXT,created_at INTEGER NOT NULL,settled_at INTEGER);
      CREATE INDEX ai_ledger_owner ON ai_ledger(user_id,created_at);
      CREATE TABLE ai_audit(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,action TEXT NOT NULL,details TEXT NOT NULL,created_at INTEGER NOT NULL);
      CREATE TABLE scenario_sets(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,symbol TEXT NOT NULL,title TEXT NOT NULL,branches TEXT NOT NULL,provenance TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,last_check INTEGER NOT NULL DEFAULT 0);
      CREATE INDEX scenario_owner ON scenario_sets(user_id,symbol);
      CREATE TABLE scenario_observations(id TEXT PRIMARY KEY,set_id TEXT NOT NULL REFERENCES scenario_sets(id) ON DELETE CASCADE,kind TEXT NOT NULL,event_key TEXT,value REAL,currency TEXT,verified INTEGER NOT NULL,source_title TEXT NOT NULL,source_url TEXT,occurred_at INTEGER NOT NULL,recorded_at INTEGER NOT NULL, UNIQUE(set_id,kind,event_key,occurred_at));
      CREATE INDEX scenario_observed ON scenario_observations(set_id,recorded_at);
      CREATE TABLE articles(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,slug TEXT NOT NULL UNIQUE,symbol TEXT NOT NULL,title TEXT NOT NULL,body TEXT NOT NULL,branches TEXT NOT NULL DEFAULT '[]',sources TEXT NOT NULL DEFAULT '[]',revision INTEGER NOT NULL DEFAULT 1,published_revision INTEGER,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
      CREATE TABLE article_revisions(id TEXT PRIMARY KEY,article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,revision INTEGER NOT NULL,author TEXT NOT NULL,symbol TEXT NOT NULL,title TEXT NOT NULL,body TEXT NOT NULL,branches TEXT NOT NULL,sources TEXT NOT NULL,set_id TEXT NOT NULL REFERENCES scenario_sets(id),published_at INTEGER NOT NULL, UNIQUE(article_id,revision));

    `,
  },
  {
    version: 2,
    sql: `
   ALTER TABLE research_assets ADD COLUMN metadata TEXT NOT NULL DEFAULT '{}';
   CREATE INDEX scenario_price_lookup ON scenario_observations(set_id,kind,currency,occurred_at);
   CREATE INDEX ai_audit_owner_action ON ai_audit(user_id,action,created_at);
 `,
  },
  {
    version: 3,
    sql: `
      CREATE TABLE chart_workspaces(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, symbol TEXT NOT NULL, slot INTEGER NOT NULL CHECK(slot BETWEEN 1 AND 3), revision INTEGER NOT NULL CHECK(revision > 0), state TEXT, updated_at INTEGER NOT NULL, PRIMARY KEY(user_id,symbol,slot));
    `,
  },
  {
    version: 4,
    sql: `CREATE TABLE chart_views(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, symbol TEXT NOT NULL, surface TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>0), state TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(user_id,symbol,surface));`,
  },
  {
    version: 5,
    sql: `
    CREATE TABLE watchlists(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,name TEXT NOT NULL,symbols TEXT NOT NULL DEFAULT '[]',revision INTEGER NOT NULL DEFAULT 1,created_at INTEGER NOT NULL);
    CREATE UNIQUE INDEX watchlists_owner_name ON watchlists(user_id,name COLLATE NOCASE);
    CREATE TABLE watchlist_preferences(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,selected_id TEXT);
    CREATE TABLE political_feed(id TEXT PRIMARY KEY,payload TEXT NOT NULL,fetched_at INTEGER NOT NULL,version TEXT NOT NULL);
  `,
  },
  {
    version: 6,
    sql: `CREATE TABLE political_sync(id TEXT PRIMARY KEY,checked_at INTEGER,attempted_at INTEGER,next_check_at INTEGER NOT NULL DEFAULT 0,etag TEXT,failures INTEGER NOT NULL DEFAULT 0,last_error TEXT);`,
  },
  {
    version: 7,
    sql: `CREATE TABLE political_archives(id TEXT PRIMARY KEY,revision TEXT NOT NULL,payload BLOB NOT NULL,updated_at INTEGER NOT NULL);`,
  },
  {
    version: 8,
    sql: `
      CREATE TABLE political_return_prices(symbol TEXT PRIMARY KEY,payload BLOB NOT NULL,checked_at INTEGER NOT NULL,next_check INTEGER NOT NULL);
      CREATE TABLE political_return_estimates(member TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,payload BLOB NOT NULL,updated_at INTEGER NOT NULL,next_check INTEGER NOT NULL,failed INTEGER NOT NULL DEFAULT 0);
    `,
  },
  {
    version: 9,
    sql: `
      CREATE TABLE article_assets(article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,symbol TEXT NOT NULL,position INTEGER NOT NULL,metadata TEXT NOT NULL,PRIMARY KEY(article_id,symbol));
      CREATE TABLE article_revision_assets(revision_id TEXT NOT NULL REFERENCES article_revisions(id) ON DELETE CASCADE,symbol TEXT NOT NULL,position INTEGER NOT NULL,metadata TEXT NOT NULL,PRIMARY KEY(revision_id,symbol));
      CREATE INDEX article_revision_asset_symbol ON article_revision_assets(symbol,revision_id);
    `,
  },
  {
    version: 10,
    sql: `
      CREATE TABLE journal_media(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,symbol TEXT NOT NULL,name TEXT NOT NULL,mime TEXT NOT NULL,width INTEGER NOT NULL,height INTEGER NOT NULL,bytes INTEGER NOT NULL,content BLOB NOT NULL,provenance TEXT NOT NULL,created_at INTEGER NOT NULL,archived INTEGER NOT NULL DEFAULT 0);
      CREATE INDEX journal_media_owner ON journal_media(user_id,created_at);
      CREATE TABLE article_revision_media(revision_id TEXT NOT NULL REFERENCES article_revisions(id) ON DELETE CASCADE,media_id TEXT NOT NULL REFERENCES journal_media(id),PRIMARY KEY(revision_id,media_id));
      CREATE TABLE ai_media_preferences(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,image_model TEXT NOT NULL DEFAULT 'gemini-3.1-flash-image',run_limit INTEGER NOT NULL DEFAULT 500000);
    `,
  },
];
export function migratePlatform(db) {
  db.exec(
    "CREATE TABLE IF NOT EXISTS module_migrations(module TEXT PRIMARY KEY,version INTEGER NOT NULL)",
  );
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(
      "CREATE TABLE IF NOT EXISTS module_compatibility(module TEXT PRIMARY KEY,minimum_schema INTEGER NOT NULL)",
    );
    const version =
      db
        .prepare(
          "SELECT version FROM module_migrations WHERE module='intelligence'",
        )
        .get()?.version || 0;
    const minimum = db
      .prepare(
        "SELECT minimum_schema FROM module_compatibility WHERE module='intelligence'",
      )
      .get()?.minimum_schema;
    if (
      version > platformMigrations.at(-1).version &&
      (!minimum || minimum > platformMigrations.at(-1).version)
    )
      throw Error("Intelligence schema is incompatible with this release.");
    db.prepare(
      "INSERT OR IGNORE INTO module_compatibility VALUES('intelligence',1)",
    ).run();
    for (const step of platformMigrations.filter((s) => s.version > version)) {
      db.exec(step.sql);
      db.prepare(
        "INSERT INTO module_migrations VALUES('intelligence',?) ON CONFLICT(module) DO UPDATE SET version=excluded.version",
      ).run(step.version);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
