SET FOREIGN_KEY_CHECKS = 0;
SET AUTOCOMMIT = 0;
SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";

/*!40101 SET NAMES binary*/;

-- Drop and recreate orders table WITHOUT foreign keys
DROP TABLE IF EXISTS `orders`;

CREATE TABLE `orders` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `shopkeeper_id` int(11) NOT NULL,
  `status` enum('Pending','Processing','Delivered','Cancelled') DEFAULT 'Pending',
  `payment_method` enum('cod','upi') NOT NULL DEFAULT 'cod',
  `total_amount` decimal(10,2) NOT NULL,
  `credits_earned` decimal(10,2) DEFAULT '0',
  `credits_used` int(11) NOT NULL DEFAULT '0',
  `credits_granted` tinyint(1) NOT NULL DEFAULT '0',
  `latitude` decimal(9,6) DEFAULT NULL,
  `longitude` decimal(9,6) DEFAULT NULL,
  `delivery_address` varchar(255) DEFAULT NULL,
  `created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fk_1` (`user_id`),
  KEY `fk_2` (`shopkeeper_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin AUTO_INCREMENT=2220001;

-- NOW import your data file safely
-- Go to Import tab → nexkiranadb.orders.0000000010000.sql → GO

COMMIT;
SET FOREIGN_KEY_CHECKS = 1;
SET AUTOCOMMIT = 1;
