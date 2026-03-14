import "dotenv/config";

// Ensure test environment
process.env.NODE_ENV = "test";
process.env.EMAIL_PROVIDER = "dev";
process.env.DATABASE_URL ??=
  "postgres://percy:percy@localhost:5433/percy_main_test";
