import { describe, expect, test } from "bun:test";
import fixtures from "./buddy-priming.fixtures.json";
import { buildBuddyPriming, type BuddyPrimingInput, type BuddyPrimingOutput } from "./lib";

type Fixture = { name: string; input: BuddyPrimingInput; expected: BuddyPrimingOutput };

describe("buildBuddyPriming portable fixtures (#94)", () => {
  for (const fixture of fixtures as Fixture[]) {
    test(fixture.name, () => {
      expect(buildBuddyPriming(fixture.input)).toEqual(fixture.expected);
    });
  }
});
