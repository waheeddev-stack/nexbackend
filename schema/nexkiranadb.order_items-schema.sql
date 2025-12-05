/*!40014 SET FOREIGN_KEY_CHECKS=0*/;
SET AUTOCOMMIT=0;
SET SQL_MODE="NO_AUTO_VALUE_ON_ZERO";

/*!40101 SET NAMES binary*/;

DROP TABLE IF EXISTS `order_items`;

CREATE TABLE `order_items` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `order_id` int(11) NOT NULL,
  `product_id` int(11) NOT NULL,
  `quantity` int(11) NOT NULL,
  `price` decimal(10,2) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `fk_1` (`order_id`),
  KEY `fk_2` (`product_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin AUTO_INCREMENT=1770001;

COMMIT;
SET FOREIGN_KEY_CHECKS=1;
