-- `saved_note`: legacy shape (userId, body, createdAt, tag). IF NOT EXISTS keeps remote + fresh DBs safe.

CREATE TABLE IF NOT EXISTS `saved_note` (
  `id` text PRIMARY KEY NOT NULL,
  `userId` text NOT NULL REFERENCES `user`(`id`) ON DELETE CASCADE,
  `createdAt` integer NOT NULL,
  `tag` text NOT NULL DEFAULT 'Copilot',
  `body` text NOT NULL
);

CREATE INDEX IF NOT EXISTS `saved_note_user_created_idx` ON `saved_note` (`userId`,`createdAt`);
CREATE INDEX IF NOT EXISTS `saved_note_user_tag_idx` ON `saved_note` (`userId`,`tag`);

CREATE TABLE IF NOT EXISTS `interview_preset` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `category` text NOT NULL,
  `context` text NOT NULL,
  `description` text,
  `icon` text,
  `isBuiltIn` integer DEFAULT 1,
  `userId` text REFERENCES `user`(`id`) ON DELETE CASCADE,
  `createdAt` integer NOT NULL
);

INSERT OR IGNORE INTO `interview_preset` (`id`, `name`, `category`, `context`, `description`, `icon`, `isBuiltIn`, `userId`, `createdAt`) VALUES
  ('preset-swe', 'Software Engineer', 'SWE', 'You are interviewing for a Software Engineer role. Focus on data structures, algorithms, system design, coding patterns, and technical problem-solving. When answering, demonstrate strong CS fundamentals, clean code practices, and scalable thinking. Use STAR method for behavioral sub-questions. Reference technologies like distributed systems, databases, API design, and cloud infrastructure where relevant.', 'Technical SWE interview with DSA, system design, and coding focus', 'code', 1, NULL, unixepoch()),
  ('preset-pm', 'Product Manager', 'PM', 'You are interviewing for a Product Manager role. Focus on product sense, metrics-driven thinking, user empathy, prioritization frameworks (RICE, ICE), and stakeholder management. Structure answers using frameworks like CIRCLES for product design, and demonstrate ability to define success metrics, create roadmaps, and make data-informed decisions. Show understanding of A/B testing, user research, and go-to-market strategy.', 'Product management interview with strategy and metrics focus', 'layout', 1, NULL, unixepoch()),
  ('preset-behavioral', 'Behavioral', 'Behavioral', 'You are in a behavioral interview. Use the STAR method (Situation, Task, Action, Result) for every answer. Focus on leadership, teamwork, conflict resolution, ownership, and delivering results. Provide specific examples with quantifiable outcomes. Show self-awareness, growth mindset, and alignment with company values. Be concise but detailed enough to demonstrate depth of experience.', 'Behavioral interview using STAR method with leadership examples', 'users', 1, NULL, unixepoch()),
  ('preset-frontend', 'Frontend Engineer', 'SWE', 'You are interviewing for a Frontend Engineer role. Focus on React/Next.js, TypeScript, CSS architecture, performance optimization, accessibility (a11y), and modern web APIs. Demonstrate knowledge of component patterns, state management, testing strategies, bundle optimization, and responsive design. Reference tools like Webpack/Vite, testing libraries, and browser DevTools.', 'Frontend engineering with React, performance, and a11y focus', 'monitor', 1, NULL, unixepoch()),
  ('preset-system-design', 'System Design', 'SWE', 'You are in a system design interview. Structure answers with: Requirements gathering, High-level architecture, Deep dive into components, Scaling considerations, and Trade-offs. Cover load balancing, caching strategies, database choices (SQL vs NoSQL), message queues, CDNs, and microservices. Use back-of-the-envelope calculations and discuss CAP theorem, consistency models, and failure handling.', 'System design interview with architecture and scaling focus', 'server', 1, NULL, unixepoch());
