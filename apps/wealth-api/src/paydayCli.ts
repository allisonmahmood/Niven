import { ValidationError } from "@niven/shared";
import { createSandboxService } from "@niven/wealth-sandbox";

import { getSandboxPaydayUsage, parseSandboxPaydayCliArgs, runSandboxPayday } from "./payday.js";

async function main(argv: readonly string[]): Promise<number> {
  if (argv.length === 0) {
    console.error(getSandboxPaydayUsage());
    return 1;
  }

  try {
    const input = parseSandboxPaydayCliArgs(argv);
    const result = await runSandboxPayday(createSandboxService(), input);

    console.log("Sandbox payday deposited.");
    console.log(
      `Account: ${result.account.name}${result.account.mask ? ` (...${result.account.mask})` : ""}`,
    );
    console.log(`Amount: ${result.amount}`);
    console.log(`Date: ${result.date}`);
    return 0;
  } catch (error) {
    if (error instanceof ValidationError) {
      console.error(error.message);

      if (Array.isArray(error.details)) {
        for (const detail of error.details) {
          if (
            typeof detail === "object" &&
            detail !== null &&
            "path" in detail &&
            "message" in detail &&
            typeof detail.path === "string" &&
            typeof detail.message === "string"
          ) {
            console.error(`${detail.path}: ${detail.message}`);
          }
        }
      }

      return 1;
    }

    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

main(process.argv.slice(2))
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
