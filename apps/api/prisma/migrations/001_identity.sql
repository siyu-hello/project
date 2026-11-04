CREATE TABLE IF NOT EXISTS capacity (
  id INT PRIMARY KEY,
  students INT NOT NULL DEFAULT 0,
  staff INT NOT NULL DEFAULT 0,
  CHECK (students BETWEEN 0 AND 20), CHECK (staff BETWEEN 0 AND 10)
) ENGINE=InnoDB;
INSERT IGNORE INTO capacity (id) VALUES (1);
CREATE TABLE IF NOT EXISTS account (
  id VARCHAR(36) PRIMARY KEY,
  identifier VARCHAR(40) COLLATE utf8mb4_bin NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL,
  college VARCHAR(100) NULL,
  grade VARCHAR(100) NULL,
  role ENUM('ADMIN','STUDENT','PUBLISHER','REDEEMER','REVOKED') NOT NULL,
  pool ENUM('admin','students','staff') NOT NULL,
  passwordHash VARCHAR(200) NOT NULL,
  wechatOpenid VARCHAR(128) COLLATE utf8mb4_bin NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  mustChangePassword BOOLEAN NOT NULL DEFAULT FALSE,
  failedAttempts INT NOT NULL DEFAULT 0,
  lockedUntil DATETIME(3) NULL,
  authorizationExpiresAt DATETIME(3) NULL,
  activityId VARCHAR(36) NULL,
  createdAt DATETIME(3) NOT NULL,
  UNIQUE KEY wechat_account (wechatOpenid, identifier),
  INDEX wechat_lookup (wechatOpenid)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS session (
  hash CHAR(64) PRIMARY KEY,
  accountId VARCHAR(36) NOT NULL,
  expiresAt DATETIME(3) NOT NULL,
  FOREIGN KEY (accountId) REFERENCES account(id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS login_failure (
  id VARCHAR(36) PRIMARY KEY,
  accountId VARCHAR(36) NULL,
  identifier VARCHAR(40) NOT NULL,
  ip VARCHAR(64) NOT NULL,
  reason VARCHAR(40) NOT NULL,
  occurredAt DATETIME(3) NOT NULL,
  FOREIGN KEY (accountId) REFERENCES account(id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS audit (
  id VARCHAR(36) PRIMARY KEY,
  actorId VARCHAR(36) NOT NULL,
  targetId VARCHAR(36) NOT NULL,
  action VARCHAR(40) NOT NULL,
  reason VARCHAR(500) NOT NULL,
  beforeValue JSON NULL,
  afterValue JSON NULL,
  occurredAt DATETIME(3) NOT NULL,
  FOREIGN KEY (actorId) REFERENCES account(id),
  FOREIGN KEY (targetId) REFERENCES account(id)
) ENGINE=InnoDB;
-- Query-side boundary for later epics. No business write endpoints or seed data.
CREATE TABLE IF NOT EXISTS activity (
  id VARCHAR(36) PRIMARY KEY,
  publisherId VARCHAR(36) NOT NULL,
  title VARCHAR(200) NOT NULL,
  college VARCHAR(100) NOT NULL,
  grade VARCHAR(100) NOT NULL,
  status ENUM('PENDING','PUBLISHED','CANCELLED') NOT NULL,
  startsAt DATETIME(3) NOT NULL,
  endsAt DATETIME(3) NOT NULL,
  capacity INT NOT NULL,
  enrolled INT NOT NULL DEFAULT 0,
  FOREIGN KEY (publisherId) REFERENCES account(id),
  CHECK (capacity BETWEEN 1 AND 20), CHECK (enrolled BETWEEN 0 AND capacity)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS ledger_entry (
  id VARCHAR(36) PRIMARY KEY,
  studentId VARCHAR(36) NOT NULL,
  unit ENUM('POINT','MINUTE') NOT NULL,
  amount INT NOT NULL,
  kind ENUM('CREDIT','REDEEM','REFUND','REVERSAL') NOT NULL,
  sourceId VARCHAR(36) NOT NULL,
  reversesId VARCHAR(36) NULL,
  ruleSnapshot JSON NOT NULL,
  occurredAt DATETIME(3) NOT NULL,
  FOREIGN KEY (studentId) REFERENCES account(id),
  FOREIGN KEY (reversesId) REFERENCES ledger_entry(id),
  INDEX ledger_student (studentId, unit)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS schema_migration (name VARCHAR(100) PRIMARY KEY, appliedAt DATETIME(3) NOT NULL) ENGINE=InnoDB;
