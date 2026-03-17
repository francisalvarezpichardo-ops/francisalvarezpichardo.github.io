-- ============================================================
--  FJAP Préstamos Personales — Base de Datos MySQL
--  Importar en phpMyAdmin: selecciona la BD y ve a "Importar"
-- ============================================================

CREATE DATABASE IF NOT EXISTS `fjap_prestamos`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE `fjap_prestamos`;

-- ── TABLA: USUARIOS ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `users` (
  `id`           INT          NOT NULL AUTO_INCREMENT,
  `full_name`    VARCHAR(120) NOT NULL,
  `email`        VARCHAR(180) NOT NULL,
  `phone`        VARCHAR(11)  NOT NULL,
  `cedula`       VARCHAR(11)  NOT NULL,
  `pass_hash`    VARCHAR(255) NOT NULL,
  `pass_salt`    VARCHAR(100) NOT NULL,
  `credit_score` INT          DEFAULT NULL,
  `created_at`   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_email`  (`email`),
  UNIQUE KEY `uq_cedula` (`cedula`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── TABLA: SESIONES ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `sessions` (
  `token`      VARCHAR(120) NOT NULL,
  `user_id`    INT          NOT NULL,
  `created_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `expires_at` DATETIME     NOT NULL,
  PRIMARY KEY (`token`),
  KEY `idx_sessions_user` (`user_id`),
  CONSTRAINT `fk_sessions_user`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── EVENTO: Limpiar sesiones expiradas cada hora ─────────────
-- (requiere que el Event Scheduler esté activo en MySQL)
-- SET GLOBAL event_scheduler = ON;
-- CREATE EVENT IF NOT EXISTS `clean_expired_sessions`
--   ON SCHEDULE EVERY 1 HOUR
--   DO DELETE FROM `sessions` WHERE `expires_at` < NOW();
