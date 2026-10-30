ALTER TABLE `user` ADD COLUMN `role` text DEFAULT 'user';
DELETE FROM `session`;
UPDATE `user` SET `isApproved` = 0, `role` = 'user' WHERE lower(`email`) != 'admin@vedgupta.in';
UPDATE `user` SET `isApproved` = 1, `role` = 'admin' WHERE lower(`email`) = 'admin@vedgupta.in';
