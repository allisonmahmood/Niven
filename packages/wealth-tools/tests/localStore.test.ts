import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { LocalWealthStore } from "../src/store/localStore.js";

const tempDirs: string[] = [];

async function createTempDir(prefix: string) {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

describe("LocalWealthStore", () => {
  it("reloads externally updated store state without restarting the process", async () => {
    const dir = await createTempDir("niven-wealth-store-");
    const storePath = path.join(dir, "wealth-store.json");
    const reader = new LocalWealthStore(storePath);
    const writer = new LocalWealthStore(storePath);

    expect(await reader.listItems()).toHaveLength(0);

    await writer.saveItem({
      accessToken: "access-token",
      countryCodes: ["US"],
      createdAt: "2026-04-14T00:00:00.000Z",
      initialProducts: ["transactions"],
      institutionId: "ins_109508",
      itemId: "item_bootstrapped",
      lastTransactionsRefreshAt: null,
      lastTransactionsSyncAt: null,
      transactionsCursor: null,
    });

    const items = await reader.listItems();

    expect(items).toHaveLength(1);
    expect(items[0]?.itemId).toBe("item_bootstrapped");
    expect(items[0]?.institutionId).toBe("ins_109508");
  });
});
