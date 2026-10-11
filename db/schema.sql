/*
  Commander Deck Builder — initial schema (DRAFT, Phase 0)
  Target: SQL Server 2025 Express. Run in SSMS against an empty database, e.g.:
      CREATE DATABASE CommanderDeckBuilder;
  Later changes go in db/migrations/NNN_description.sql — never edit this file after Phase 0.
  Verify field shapes against real Scryfall/EDHREC data before finalising (see docs/EDHREC.md).
*/
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

/* ---------- Cards (Scryfall) ---------- */

CREATE TABLE dbo.card (
    oracle_id         UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    name              NVARCHAR(200)    NOT NULL,
    mana_cost         NVARCHAR(100)    NULL,
    cmc               DECIMAL(5,1)     NOT NULL DEFAULT 0,
    type_line         NVARCHAR(200)    NOT NULL,
    oracle_text       NVARCHAR(MAX)    NULL,
    colors            VARCHAR(5)       NOT NULL DEFAULT '',   -- e.g. 'WUG'
    color_identity    VARCHAR(5)       NOT NULL DEFAULT '',
    power             NVARCHAR(10)     NULL,
    toughness         NVARCHAR(10)     NULL,
    keywords_json     NVARCHAR(MAX)    NULL,
    legal_commander   BIT              NOT NULL,              -- legalities.commander = 'legal'
    can_be_commander  BIT              NOT NULL DEFAULT 0,    -- legendary creature / "can be your commander"
    is_game_changer   BIT              NOT NULL DEFAULT 0,    -- from Scryfall data, never hardcoded
    edhrec_rank       INT              NULL,
    layout            VARCHAR(40)      NULL,
    faces_json        NVARCHAR(MAX)    NULL,                  -- card_faces for MDFC/split/adventure
    updated_at        DATETIME2(0)     NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE INDEX ix_card_name ON dbo.card(name);   -- not unique: a few oracle names repeat (e.g. playtest/Alchemy variants)
CREATE INDEX ix_card_identity ON dbo.card(color_identity) INCLUDE (cmc, legal_commander, is_game_changer);
GO

CREATE TABLE dbo.card_printing (
    scryfall_id       UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    oracle_id         UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.card(oracle_id),
    set_code          VARCHAR(10)      NOT NULL,
    collector_number  VARCHAR(20)      NOT NULL,
    rarity            VARCHAR(20)      NULL,
    released_at       DATE             NULL,
    image_normal      NVARCHAR(400)    NULL,
    image_art_crop    NVARCHAR(400)    NULL,
    artist            NVARCHAR(200)    NULL,
    price_eur         DECIMAL(10,2)    NULL,                  -- Cardmarket via Scryfall
    price_eur_foil    DECIMAL(10,2)    NULL,
    price_usd         DECIMAL(10,2)    NULL,
    updated_at        DATETIME2(0)     NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE INDEX ix_printing_oracle ON dbo.card_printing(oracle_id) INCLUDE (price_eur, price_eur_foil, price_usd);
GO

CREATE TABLE dbo.card_price_history (
    oracle_id   UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.card(oracle_id),
    price_date  DATE             NOT NULL,
    min_eur     DECIMAL(10,2)    NULL,
    PRIMARY KEY (oracle_id, price_date)
);
GO

/* Cheapest € per card; falls back to foil, then USD * rate (flagged). */
CREATE VIEW dbo.v_card_price AS
SELECT  c.oracle_id,
        COALESCE(MIN(p.price_eur), MIN(p.price_eur_foil)) AS min_eur,
        MIN(p.price_usd)                                  AS min_usd,
        CASE WHEN MIN(p.price_eur) IS NULL AND MIN(p.price_eur_foil) IS NULL THEN 1 ELSE 0 END AS eur_missing
FROM dbo.card c
LEFT JOIN dbo.card_printing p ON p.oracle_id = c.oracle_id
GROUP BY c.oracle_id;
GO

CREATE TABLE dbo.card_role (
    oracle_id  UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.card(oracle_id),
    role       VARCHAR(40)      NOT NULL,          -- ramp, card-draw, removal, board-wipe, tutor, ...
    source     VARCHAR(20)      NOT NULL,          -- scryfall_otag | parser | llm | manual
    PRIMARY KEY (oracle_id, role)
);
CREATE INDEX ix_card_role_role ON dbo.card_role(role);
GO

/* Embedding dimension depends on the chosen model (e.g. 384 for all-MiniLM-L6-v2). Adjust before first run. */
CREATE TABLE dbo.card_embedding (
    oracle_id   UNIQUEIDENTIFIER NOT NULL PRIMARY KEY REFERENCES dbo.card(oracle_id),
    model       VARCHAR(100)     NOT NULL,
    embedding   VECTOR(384)      NOT NULL,
    updated_at  DATETIME2(0)     NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

/* ---------- EDHREC ---------- */

CREATE TABLE dbo.edhrec_page (
    path        NVARCHAR(400)  NOT NULL PRIMARY KEY,   -- e.g. 'commanders/the-ur-dragon/upgraded'
    fetched_at  DATETIME2(0)   NOT NULL,
    http_status INT            NOT NULL,
    raw_json    NVARCHAR(MAX)  NULL
);
GO

CREATE TABLE dbo.commander (
    slug            VARCHAR(200)     NOT NULL PRIMARY KEY,   -- EDHREC slug
    name            NVARCHAR(400)    NOT NULL,
    oracle_id       UNIQUEIDENTIFIER NULL REFERENCES dbo.card(oracle_id),
    partner_oracle_id UNIQUEIDENTIFIER NULL REFERENCES dbo.card(oracle_id),
    num_decks       INT              NULL,
    edhrec_rank     INT              NULL,
    fetched_at      DATETIME2(0)     NOT NULL
);
GO

CREATE TABLE dbo.edhrec_bracket_count (
    commander_slug VARCHAR(200) NOT NULL REFERENCES dbo.commander(slug),
    bracket        TINYINT      NOT NULL,     -- 1..5
    deck_count     INT          NOT NULL,
    fetched_at     DATETIME2(0) NOT NULL,
    PRIMARY KEY (commander_slug, bracket)
);
GO

CREATE TABLE dbo.edhrec_theme (
    commander_slug VARCHAR(200)  NOT NULL REFERENCES dbo.commander(slug),
    theme_slug     VARCHAR(100)  NOT NULL,
    theme_name     NVARCHAR(200) NOT NULL,
    deck_count     INT           NOT NULL,
    fetched_at     DATETIME2(0)  NOT NULL,
    PRIMARY KEY (commander_slug, theme_slug)
);
GO

/* One row per commander x bracket x theme x budget x card x list. '' = unfiltered. */
CREATE TABLE dbo.edhrec_card_stat (
    commander_slug  VARCHAR(200)     NOT NULL REFERENCES dbo.commander(slug),
    bracket         VARCHAR(12)      NOT NULL DEFAULT '',   -- '', exhibition, core, upgraded, optimized, cedh
    theme_slug      VARCHAR(100)     NOT NULL DEFAULT '',
    budget          VARCHAR(10)      NOT NULL DEFAULT '',   -- '', budget, expensive
    list_tag        VARCHAR(40)      NOT NULL,              -- topcards, highliftcards, creatures, ...
    card_name       NVARCHAR(200)    NOT NULL,
    edhrec_card_id  UNIQUEIDENTIFIER NULL,                  -- looks like a Scryfall id: confirm
    oracle_id       UNIQUEIDENTIFIER NULL REFERENCES dbo.card(oracle_id),
    num_decks       INT              NOT NULL,
    potential_decks INT              NOT NULL,
    inclusion       AS (CAST(num_decks AS FLOAT) / NULLIF(potential_decks, 0)) PERSISTED,
    synergy         FLOAT            NULL,
    lift            FLOAT            NULL,
    trend_z         FLOAT            NULL,
    fetched_at      DATETIME2(0)     NOT NULL,
    PRIMARY KEY (commander_slug, bracket, theme_slug, budget, list_tag, card_name)
);
CREATE INDEX ix_edhrec_stat_lookup ON dbo.edhrec_card_stat(commander_slug, bracket, theme_slug, budget)
    INCLUDE (oracle_id, num_decks, potential_decks, lift);
GO

/* ---------- Combos (Commander Spellbook) ---------- */

CREATE TABLE dbo.combo (
    combo_id       VARCHAR(64)    NOT NULL PRIMARY KEY,   -- Spellbook variant id
    color_identity VARCHAR(5)     NOT NULL DEFAULT '',
    produces_json  NVARCHAR(MAX)  NULL,
    bracket_tag    VARCHAR(20)    NULL,                   -- Spellbook's bracket classification
    popularity     INT            NULL,
    fetched_at     DATETIME2(0)   NOT NULL
);
CREATE TABLE dbo.combo_card (
    combo_id   VARCHAR(64)      NOT NULL REFERENCES dbo.combo(combo_id),
    oracle_id  UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.card(oracle_id),
    PRIMARY KEY (combo_id, oracle_id)
);
CREATE INDEX ix_combo_card_oracle ON dbo.combo_card(oracle_id);
GO

/* ---------- Decks ---------- */

CREATE TABLE dbo.deck (
    deck_id           INT IDENTITY(1,1) PRIMARY KEY,
    name              NVARCHAR(200)    NOT NULL,
    commander_id      UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.card(oracle_id),
    partner_id        UNIQUEIDENTIFIER NULL REFERENCES dbo.card(oracle_id),
    bracket_target    TINYINT          NOT NULL,
    budget_eur        DECIMAL(10,2)    NULL,
    mode              VARCHAR(10)      NOT NULL DEFAULT 'normal',   -- normal | meme
    brief_json        NVARCHAR(MAX)    NULL,                         -- see docs/PLAN.md §5
    primer_md         NVARCHAR(MAX)    NULL,
    version           INT              NOT NULL DEFAULT 1,
    parent_deck_id    INT              NULL REFERENCES dbo.deck(deck_id),   -- versions / variants
    created_at        DATETIME2(0)     NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_at        DATETIME2(0)     NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE TABLE dbo.deck_card (
    deck_id      INT              NOT NULL REFERENCES dbo.deck(deck_id),
    oracle_id    UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.card(oracle_id),
    qty          TINYINT          NOT NULL DEFAULT 1,
    role         VARCHAR(40)      NULL,
    reason       NVARCHAR(400)    NULL,
    is_discovery BIT              NOT NULL DEFAULT 0,
    PRIMARY KEY (deck_id, oracle_id)
);
GO

CREATE TABLE dbo.collection_card (
    oracle_id    UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.card(oracle_id),
    scryfall_id  UNIQUEIDENTIFIER NULL,
    qty          INT              NOT NULL DEFAULT 1,
    foil         BIT              NOT NULL DEFAULT 0,
    source       VARCHAR(20)      NULL,     -- manabox | moxfield | archidekt | manual
    imported_at  DATETIME2(0)     NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE INDEX ix_collection_oracle ON dbo.collection_card(oracle_id);
GO

CREATE TABLE dbo.play_log (
    play_id         INT IDENTITY(1,1) PRIMARY KEY,
    deck_id         INT           NOT NULL REFERENCES dbo.deck(deck_id),
    played_at       DATE          NOT NULL,
    result          VARCHAR(10)   NOT NULL,     -- win | loss | draw
    win_turn        TINYINT       NULL,
    rating          TINYINT       NULL,         -- 1..5
    dead_cards_json NVARCHAR(MAX) NULL,
    notes           NVARCHAR(MAX) NULL
);
GO

/* ---------- Simulation (docs/SIMULATION.md) ---------- */

CREATE TABLE dbo.sim_profile (
    oracle_id     UNIQUEIDENTIFIER NOT NULL PRIMARY KEY REFERENCES dbo.card(oracle_id),
    profile_json  NVARCHAR(MAX)    NOT NULL,      -- kind, produces, ramp, draw, tutor, reduces, power, wincon...
    source        VARCHAR(20)      NOT NULL,      -- auto_tags | oracle_parser | llm
    version       INT              NOT NULL DEFAULT 1,
    updated_at    DATETIME2(0)     NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE TABLE dbo.sim_profile_override (
    oracle_id     UNIQUEIDENTIFIER NOT NULL PRIMARY KEY REFERENCES dbo.card(oracle_id),
    profile_json  NVARCHAR(MAX)    NOT NULL,
    note          NVARCHAR(400)    NULL,
    updated_at    DATETIME2(0)     NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

CREATE TABLE dbo.sim_run (
    run_id       INT IDENTITY(1,1) PRIMARY KEY,
    deck_id      INT            NOT NULL REFERENCES dbo.deck(deck_id),
    engine       VARCHAR(10)    NOT NULL,      -- goldfish | forge
    params_json  NVARCHAR(MAX)  NOT NULL,      -- policies, maxTurns, seat, gauntlet, ...
    seed         BIGINT         NULL,
    games        INT            NOT NULL,
    profile_coverage FLOAT      NULL,          -- share of cards with a real sim profile
    started_at   DATETIME2(0)   NOT NULL DEFAULT SYSUTCDATETIME(),
    finished_at  DATETIME2(0)   NULL
);
CREATE TABLE dbo.sim_metric (
    run_id   INT          NOT NULL REFERENCES dbo.sim_run(run_id),
    metric   VARCHAR(60)  NOT NULL,           -- wincon_turn, commander_turn, mana_t3, screw_rate, ...
    p10 FLOAT NULL, p50 FLOAT NULL, p90 FLOAT NULL, mean FLOAT NULL,
    ci_low FLOAT NULL, ci_high FLOAT NULL,
    histogram_json NVARCHAR(MAX) NULL,
    PRIMARY KEY (run_id, metric)
);
CREATE TABLE dbo.sim_card_stat (
    run_id        INT              NOT NULL REFERENCES dbo.sim_run(run_id),
    oracle_id     UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.card(oracle_id),
    drawn_rate    FLOAT NULL,
    cast_rate     FLOAT NULL,
    dead_rate     FLOAT NULL,
    impact_delta  FLOAT NULL,                  -- leave-one-out Δ consistency score
    PRIMARY KEY (run_id, oracle_id)
);
GO

CREATE TABLE dbo.sim_job (
    job_id       INT IDENTITY(1,1) PRIMARY KEY,
    run_id       INT            NOT NULL REFERENCES dbo.sim_run(run_id),
    status       VARCHAR(10)    NOT NULL DEFAULT 'queued',   -- queued | running | done | failed
    pod_json     NVARCHAR(MAX)  NOT NULL,                     -- deck files + seat order
    attempts     INT            NOT NULL DEFAULT 0,
    error        NVARCHAR(MAX)  NULL,
    created_at   DATETIME2(0)   NOT NULL DEFAULT SYSUTCDATETIME(),
    finished_at  DATETIME2(0)   NULL
);
CREATE TABLE dbo.sim_game (
    game_id      BIGINT IDENTITY(1,1) PRIMARY KEY,
    run_id       INT            NOT NULL REFERENCES dbo.sim_run(run_id),
    job_id       INT            NULL REFERENCES dbo.sim_job(job_id),
    our_seat     TINYINT        NOT NULL,
    opponents_json NVARCHAR(MAX) NOT NULL,
    winner_seat  TINYINT        NULL,                         -- NULL = draw/timeout
    turns        SMALLINT       NULL,
    end_reason   VARCHAR(30)    NULL,                         -- combat | commander_damage | combo | poison | timeout ...
    log_excerpt  NVARCHAR(MAX)  NULL
);
CREATE INDEX ix_sim_game_run ON dbo.sim_game(run_id);
GO
