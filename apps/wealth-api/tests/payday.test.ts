import { ValidationError } from "@niven/shared";
import { describe, expect, it, vi } from "vitest";

import { parseSandboxPaydayCliArgs, runSandboxPayday } from "../src/payday.js";

function createService(
  overrides: Partial<{
    depositCash: ReturnType<typeof vi.fn>;
    listAccounts: ReturnType<typeof vi.fn>;
  }> = {},
) {
  return {
    depositCash: vi.fn(async () => ({ mode: "live" })),
    listAccounts: vi.fn(async () => ({
      accounts: [
        {
          accountId: "checking_6671",
          mask: "6671",
          name: "Checking",
          subtype: "checking",
          type: "depository",
        },
        {
          accountId: "checking_0000",
          mask: "0000",
          name: "Plaid Checking",
          subtype: "checking",
          type: "depository",
        },
      ],
    })),
    ...overrides,
  };
}

describe("parseSandboxPaydayCliArgs", () => {
  it("parses required arguments and fills defaults", () => {
    const result = parseSandboxPaydayCliArgs(["--", "--amount", "2400"], () => {
      return "2026-04-14T12:00:00.000Z";
    });

    expect(result).toEqual({
      amount: "2400.00",
      date: "2026-04-14",
      description: "Payday",
    });
  });

  it("rejects invalid amounts", () => {
    expect(() => parseSandboxPaydayCliArgs(["--amount", "-1"])).toThrow(ValidationError);
    expect(() => parseSandboxPaydayCliArgs(["--amount", "1.999"])).toThrow(ValidationError);
  });
});

describe("runSandboxPayday", () => {
  it("defaults to the local Plaid Checking account when present", async () => {
    const service = createService();

    await runSandboxPayday(service, {
      amount: "2400.00",
      date: "2026-04-14",
      description: "Payday",
    });

    expect(service.depositCash).toHaveBeenCalledWith({
      accountId: "checking_0000",
      amount: "2400.00",
      control: {
        approval: {
          approved: true,
        },
        idempotencyKey: "payday-checking-2026-04-14-240000",
      },
      date: "2026-04-14",
      description: "Payday",
    });
  });

  it("accepts an explicit account override", async () => {
    const service = createService();

    await runSandboxPayday(service, {
      accountId: "checking_6671",
      amount: "2400.00",
      date: "2026-04-14",
      description: "Payday",
      idempotencyKey: "manual-key",
    });

    expect(service.depositCash).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: "checking_6671",
        control: expect.objectContaining({
          idempotencyKey: "manual-key",
        }),
      }),
    );
  });

  it("fails when multiple checking accounts exist and no default match is available", async () => {
    const service = createService({
      listAccounts: vi.fn(async () => ({
        accounts: [
          {
            accountId: "checking_1",
            name: "Main Checking",
            subtype: "checking",
            type: "depository",
          },
          {
            accountId: "checking_2",
            name: "Secondary Checking",
            subtype: "checking",
            type: "depository",
          },
        ],
      })),
    });

    await expect(
      runSandboxPayday(service, {
        amount: "2400.00",
        date: "2026-04-14",
        description: "Payday",
      }),
    ).rejects.toThrow("Multiple checking accounts are available");
  });
});
