import { beforeEach, describe, expect, it } from "vitest";
import { getRegistry } from "../engine/registry";
import { clearSave, createInitialState, loadGame, saveGame } from "../engine/save";

const storage = new Map<string, string>();

Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  },
});

describe("save/load roundtrip", () => {
  const registry = getRegistry();

  beforeEach(() => {
    storage.clear();
  });

  it("roundtrips deterministic state", () => {
    const state = createInitialState("save-seed", registry);
    saveGame({ ...state, time: { turn: 7, day: 1 } });

    const loaded = loadGame(registry);
    expect(loaded).not.toBeNull();
    expect(loaded?.time.turn).toBe(7);

    clearSave();
    expect(loadGame(registry)).toBeNull();
  });
});

