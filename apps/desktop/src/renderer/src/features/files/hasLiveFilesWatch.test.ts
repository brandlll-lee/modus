import { describe, expect, it } from "vitest";
import { hasLiveFilesWatch } from "./hasLiveFilesWatch";

describe("hasLiveFilesWatch", () => {
  it("returns false when preload only exposes list/read/write (stale bridge)", () => {
    expect(
      hasLiveFilesWatch({
        // matches out/preload before files:watch landed
      }),
    ).toBe(false);
    expect(
      hasLiveFilesWatch({
        watch: undefined,
        unwatch: undefined,
        onChanged: undefined,
      }),
    ).toBe(false);
  });

  it("returns true when watch / unwatch / onChanged are functions", () => {
    expect(
      hasLiveFilesWatch({
        watch: async () => "",
        unwatch: async () => {},
        onChanged: () => () => {},
      }),
    ).toBe(true);
  });
});
