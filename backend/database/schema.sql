-- MySQL Schema for F1 Podium Predictor

CREATE DATABASE IF NOT EXISTS f1_predict;
USE f1_predict;

-- Races Table: Caches race information from Ergast API
CREATE TABLE IF NOT EXISTS Races (
    id INT AUTO_INCREMENT PRIMARY KEY,
    season VARCHAR(4) NOT NULL,
    round INT NOT NULL,
    raceName VARCHAR(100) NOT NULL,
    circuitId VARCHAR(50) NOT NULL,
    circuitName VARCHAR(100) NOT NULL,
    date DATE NOT NULL,
    time TIME NOT NULL,
    status ENUM('PENDING', 'ACTIVE', 'ENDED') DEFAULT 'PENDING',
    UNIQUE KEY (season, round)
);

-- Drivers Table: Caches driver information
CREATE TABLE IF NOT EXISTS Drivers (
    driverId VARCHAR(50) PRIMARY KEY,
    permanentNumber VARCHAR(3),
    code VARCHAR(3),
    givenName VARCHAR(50),
    familyName VARCHAR(50),
    nationality VARCHAR(50),
    teamName VARCHAR(50),
    imageUrl VARCHAR(255)
);

-- UserPicks Table: Stores user predictions synced from blockchain or submitted via API
CREATE TABLE IF NOT EXISTS UserPicks (
    id INT AUTO_INCREMENT PRIMARY KEY,
    walletAddress VARCHAR(42) NOT NULL,
    raceId INT NOT NULL,
    firstPlaceId VARCHAR(50) NOT NULL,
    secondPlaceId VARCHAR(50) NOT NULL,
    thirdPlaceId VARCHAR(50) NOT NULL,
    score INT DEFAULT 0,
    hasClaimed BOOLEAN DEFAULT FALSE,
    txHash VARCHAR(66),
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (raceId) REFERENCES Races(id),
    FOREIGN KEY (firstPlaceId) REFERENCES Drivers(driverId),
    FOREIGN KEY (secondPlaceId) REFERENCES Drivers(driverId),
    FOREIGN KEY (thirdPlaceId) REFERENCES Drivers(driverId),
    UNIQUE KEY (walletAddress, raceId)
);
