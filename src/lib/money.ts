export interface RateCurrency {
  code: string;
  rate: number;
}

export interface VatConfig {
  vatEnabled: boolean;
  vatRate: number;
  vatPricesIncludeVat?: boolean;
}

const JOHANNESBURG = "Africa/Johannesburg";

export function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

export function rateOf(currencies: RateCurrency[] | undefined, code: string) {
  const found = (currencies ?? []).find((currency) => currency.code === code);
  const rate = Number(found?.rate);
  return Number.isFinite(rate) && rate > 0 ? rate : 1;
}

/** Menu prices are stored in their own currency. Rates mean `1 ZAR = rate`. */
export function toBase(amount: number, currencyCode: string | undefined, currencies: RateCurrency[] | undefined) {
  const code = currencyCode || "ZAR";
  return amount / rateOf(currencies, code);
}

export function fromBase(amount: number, currencyCode: string | undefined, currencies: RateCurrency[] | undefined) {
  const code = currencyCode || "ZAR";
  return amount * rateOf(currencies, code);
}

export function splitVat(grossBase: number, config: VatConfig) {
  const gross = roundMoney(grossBase);
  if (!config.vatEnabled) return { subtotal: gross, tax: 0, total: gross };
  const rate = Number(config.vatRate) || 0;
  if (config.vatPricesIncludeVat) {
    const tax = roundMoney(gross * rate / (100 + rate));
    return { subtotal: roundMoney(gross - tax), tax, total: gross };
  }
  const tax = roundMoney(gross * rate / 100);
  return { subtotal: gross, tax, total: roundMoney(gross + tax) };
}

export type AccountAction = "purchase" | "on-account" | "settlement" | "deposit" | undefined;

/** Credit ledger stays in base currency. Purchases that were paid do not move it. */
export function customerCreditDelta(action: AccountAction, baseTotal: number, accountAmountBase: number) {
  if (action === "on-account") return -roundMoney(baseTotal);
  if (action === "settlement" || action === "deposit") return roundMoney(accountAmountBase);
  return 0;
}

export function businessDateKey(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: JOHANNESBURG,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value ?? "0000";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
}

export function businessMonthKey(date: Date) {
  return businessDateKey(date).slice(0, 7);
}
