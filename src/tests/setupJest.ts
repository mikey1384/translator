// Global Jest setup for tests

// Import jest
import { jest } from "@jest/globals";

// We don't need explicit mocks for modules that are in __mocks__ directory,
// but we can add additional setup here as needed.

beforeAll(() => {
  // You could add additional global test setup here
  console.log("Jest tests initialized");
});

afterAll(() => {
  // Clean up after all tests
  jest.clearAllMocks();
});
