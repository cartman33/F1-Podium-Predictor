-- SQLite Schema for Cloudflare D1 (F1 Podium Predictor)

-- Races Table: Caches race information from Ergast API
CREATE TABLE IF NOT EXISTS Races (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    season TEXT NOT NULL,
    round INTEGER NOT NULL,
    raceName TEXT NOT NULL,
    circuitId TEXT NOT NULL,
    circuitName TEXT NOT NULL,
    date TEXT NOT NULL,
    time TEXT NOT NULL,
    status TEXT CHECK( status IN ('PENDING', 'ACTIVE', 'ENDED') ) DEFAULT 'PENDING',
    UNIQUE (season, round)
);

-- Drivers Table: Caches driver information
CREATE TABLE IF NOT EXISTS Drivers (
    driverId TEXT PRIMARY KEY,
    permanentNumber TEXT,
    code TEXT,
    givenName TEXT,
    familyName TEXT,
    nationality TEXT,
    teamName TEXT,
    imageUrl TEXT
);

-- UserPicks Table: Stores user predictions synced from blockchain or submitted via API
CREATE TABLE IF NOT EXISTS UserPicks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    walletAddress TEXT NOT NULL,
    raceId INTEGER NOT NULL,
    firstPlaceId TEXT NOT NULL,
    secondPlaceId TEXT NOT NULL,
    thirdPlaceId TEXT NOT NULL,
    score INTEGER DEFAULT 0,
    hasClaimed BOOLEAN DEFAULT FALSE,
    txHash TEXT,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (raceId) REFERENCES Races(id),
    FOREIGN KEY (firstPlaceId) REFERENCES Drivers(driverId),
    FOREIGN KEY (secondPlaceId) REFERENCES Drivers(driverId),
    FOREIGN KEY (thirdPlaceId) REFERENCES Drivers(driverId),
    UNIQUE (walletAddress, raceId)
);
