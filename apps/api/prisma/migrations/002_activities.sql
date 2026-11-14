-- 002: 活动、报名、签到、缺席、礼品与兑换订单
-- 新表使用 IF NOT EXISTS；activity/account 的列由 migrate.mjs 按 information_schema 幂等补齐。
CREATE TABLE IF NOT EXISTS activity_review (
  id VARCHAR(36) PRIMARY KEY,
  activityId VARCHAR(36) NOT NULL,
  reviewerId VARCHAR(36) NOT NULL,
  decision ENUM('APPROVED','REJECTED') NOT NULL,
  reason VARCHAR(500) NULL,
  snapshot JSON NOT NULL,
  decidedAt DATETIME(3) NOT NULL,
  FOREIGN KEY (activityId) REFERENCES activity(id),
  FOREIGN KEY (reviewerId) REFERENCES account(id),
  INDEX review_activity (activityId, decidedAt)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS registration (
  id VARCHAR(36) PRIMARY KEY,
  activityId VARCHAR(36) NOT NULL,
  studentId VARCHAR(36) NOT NULL,
  status ENUM('REGISTERED','CANCELLED','CHECKED_IN','COMPLETED') NOT NULL,
  registeredAt DATETIME(3) NOT NULL,
  cancelledAt DATETIME(3) NULL,
  checkedInAt DATETIME(3) NULL,
  checkedOutAt DATETIME(3) NULL,
  UNIQUE KEY registration_once (activityId, studentId),
  FOREIGN KEY (activityId) REFERENCES activity(id),
  FOREIGN KEY (studentId) REFERENCES account(id),
  INDEX registration_student (studentId, status)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS no_show (
  id VARCHAR(36) PRIMARY KEY,
  activityId VARCHAR(36) NOT NULL,
  studentId VARCHAR(36) NOT NULL,
  registrationId VARCHAR(36) NOT NULL,
  occurredAt DATETIME(3) NOT NULL,
  UNIQUE KEY no_show_once (activityId, studentId),
  FOREIGN KEY (activityId) REFERENCES activity(id),
  FOREIGN KEY (studentId) REFERENCES account(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS gift (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  description VARCHAR(500) NULL,
  points INT NOT NULL,
  stock INT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  createdAt DATETIME(3) NOT NULL,
  updatedAt DATETIME(3) NOT NULL,
  CHECK (points BETWEEN 1 AND 9999),
  CHECK (stock >= 0)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS gift_order (
  id VARCHAR(36) PRIMARY KEY,
  studentId VARCHAR(36) NOT NULL,
  giftId VARCHAR(36) NOT NULL,
  requestId VARCHAR(64) NOT NULL,
  code CHAR(12) NOT NULL,
  pointsCost INT NOT NULL,
  status ENUM('RESERVED','REDEEMED','EXPIRED','CANCELLED') NOT NULL,
  createdAt DATETIME(3) NOT NULL,
  expiresAt DATETIME(3) NOT NULL,
  redeemedAt DATETIME(3) NULL,
  redeemedBy VARCHAR(36) NULL,
  UNIQUE KEY order_request (studentId, giftId, requestId),
  UNIQUE KEY order_code (code),
  FOREIGN KEY (studentId) REFERENCES account(id),
  FOREIGN KEY (giftId) REFERENCES gift(id),
  INDEX order_expiry (status, expiresAt)
) ENGINE=InnoDB;