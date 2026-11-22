export function cartAddedMessage(name: string | undefined, qty: number) {
  const count = Math.max(0, Math.trunc(Number.isFinite(qty) ? qty : 0));
  const label = name?.trim() || "Product";
  if (count === 1) return `1 ${label} has been added to the cart.`;
  return `${count} ${label} have been added to the cart.`;
}
