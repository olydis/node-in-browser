const assert = require('assert');
const { readdirSync } = require("fs");
const { join } = require("path");
const { compare } = require("./fixtureRunner");

RegExp.escape = function (string) {
  return string.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')
};

function assertEqualModuloPlatformSpecifics(actual, expected, message) {
  // sanitize electron's real paths
  expected = expected.replace(new RegExp(RegExp.escape(__dirname), "g"), "").replace(/\\/g, "/");

  assert.equal(actual, expected, message);
}

describe('fixtures', () => {
  const fixtureDir = join(__dirname, "fixtures");
  for (const fixture of readdirSync(fixtureDir))
    it(fixture, async () => {
      const result = await compare(fixture);
      assertEqualModuloPlatformSpecifics(result.actual.stdout, result.expected.stdout, "stdout should match");
      assertEqualModuloPlatformSpecifics(result.actual.stderr, result.expected.stderr, "stderr should match");
    });
});