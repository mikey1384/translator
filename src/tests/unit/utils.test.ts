import fs from "fs";
import path from "path";

// Simple test to validate Jest is working
describe("Basic test setup", () => {
  it("should pass a simple test", () => {
    expect(1 + 1).toBe(2);
  });

  it("should have access to Node.js APIs", () => {
    expect(typeof fs.readFileSync).toBe("function");
    expect(typeof path.join).toBe("function");
  });
});
