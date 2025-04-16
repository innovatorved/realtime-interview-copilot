/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // Automatically clear mock calls, instances, contexts and results before every test
  clearMocks: true,
  // Indicates whether the coverage information should be collected while executing the test
  collectCoverage: true,
  // The directory where Jest should output its coverage files
  coverageDirectory: "coverage",
  // An array of glob patterns indicating a set of files for which coverage information should be collected
  // collectCoverageFrom: undefined,
  // A list of reporter names that Jest uses when writing coverage reports
  coverageReporters: [
    "json",
    "text",
    "lcov",
    "clover"
  ],
  // An object that configures minimum threshold enforcement for coverage results
  // coverageThreshold: undefined,
  // Make calling deprecated APIs throw helpful error messages
  errorOnDeprecated: true,
  // The default configuration for fake timers
  // fakeTimers: {
  //   "enableGlobally": false
  // },
  // A set of global variables that need to be available in all test environments
  // globals: {},
  // The maximum amount of workers used to run your tests. Can be specified as % or a number. E.g. maxWorkers: 10% will use 10% of your CPU amount + 1 as the maximum worker number. maxWorkers: 2 will use a maximum of 2 workers.
  // maxWorkers: "50%",
  // An array of directory names to be searched recursively up from the requiring module's location
  moduleDirectories: [
    "node_modules"
  ],
  // An array of file extensions your modules use
  moduleFileExtensions: [
    "js",
    "mjs",
    "cjs",
    "jsx",
    "ts",
    "tsx",
    "json",
    "node"
  ],
  // A map from regular expressions to module names or to arrays of module names that allow to stub out resources with a single module
  moduleNameMapper: {
    // Handle module aliases (this will be automatically configured via tsconfig paths)
    '^@/lib/(.*)$': '<rootDir>/lib/$1',
    '^@/components/(.*)$': '<rootDir>/components/$1',
    // Handle CSS imports (optional)
    // '\\.(css|less|scss|sass)$': 'identity-obj-proxy'
  },
  // Remove setupFiles as we load dotenv explicitly in test files
  // setupFiles: ['dotenv/config'],
}; 