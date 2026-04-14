import { ValidationError } from "@niven/shared";

export const MONEY_SCALE = 1_000_000n;
export const QUANTITY_SCALE = 100_000_000n;

function parseDecimalParts(value: string): {
  readonly negative: boolean;
  readonly normalized: string;
} {
  const trimmed = value.trim();

  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
    throw new ValidationError(`Invalid decimal value: ${value}`);
  }

  return {
    negative: trimmed.startsWith("-"),
    normalized: trimmed.startsWith("-") ? trimmed.slice(1) : trimmed,
  };
}

function parseScaledDecimal(value: string | number, scale: bigint): bigint {
  const { negative, normalized } = parseDecimalParts(String(value));
  const [whole = "0", fraction = ""] = normalized.split(".");
  const scaleDigits = scale.toString().length - 1;
  const paddedFraction = `${fraction}${"0".repeat(scaleDigits)}`.slice(0, scaleDigits);
  const units = BigInt(whole) * scale + BigInt(paddedFraction || "0");

  return negative ? -units : units;
}

function formatScaledDecimal(units: bigint, scale: bigint, minimumFractionDigits: number): string {
  const negative = units < 0n;
  const absolute = negative ? -units : units;
  const whole = absolute / scale;
  const fraction = (absolute % scale).toString().padStart(scale.toString().length - 1, "0");
  const trimmedFraction = fraction.replace(/0+$/, "");
  const renderedFraction =
    trimmedFraction.length >= minimumFractionDigits
      ? trimmedFraction
      : fraction.slice(0, minimumFractionDigits);

  if (renderedFraction.length === 0) {
    return `${negative ? "-" : ""}${whole.toString()}`;
  }

  return `${negative ? "-" : ""}${whole.toString()}.${renderedFraction}`;
}

export function parseMoney(value: string | number): bigint {
  return parseScaledDecimal(value, MONEY_SCALE);
}

export function parseQuantity(value: string | number): bigint {
  return parseScaledDecimal(value, QUANTITY_SCALE);
}

export function formatMoney(units: bigint): string {
  return formatScaledDecimal(units, MONEY_SCALE, 2);
}

export function formatPrice(units: bigint): string {
  return formatScaledDecimal(units, MONEY_SCALE, 2);
}

export function formatQuantity(units: bigint): string {
  return formatScaledDecimal(units, QUANTITY_SCALE, 0);
}

export function parseStoredBigInt(value: string | null | undefined): bigint | null {
  if (value === null || value === undefined) {
    return null;
  }

  return BigInt(value);
}

export function toStoredBigInt(value: bigint | null): string | null {
  return value === null ? null : value.toString();
}

export function multiplyPriceByQuantity(priceMicros: bigint, quantityAtoms: bigint): bigint {
  const numerator = priceMicros * quantityAtoms;
  const quotient = numerator / QUANTITY_SCALE;
  const remainder = numerator % QUANTITY_SCALE;
  const threshold = QUANTITY_SCALE / 2n;

  if (remainder === 0n) {
    return quotient;
  }

  if (numerator >= 0n) {
    return remainder >= threshold ? quotient + 1n : quotient;
  }

  return -(-remainder >= threshold ? -quotient + 1n : -quotient);
}

export function microsFromNullable(value: number | null | undefined): bigint | null {
  if (value === null || value === undefined) {
    return null;
  }

  return parseMoney(value);
}

export function maxBigInt(left: bigint, right: bigint): bigint {
  return left > right ? left : right;
}
