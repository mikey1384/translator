/**
 * While a checkout is open or its payment is still being checked, the pack
 * cards can't start another one: that would open a second Stripe session for
 * someone who may already have paid. "Choose another pack" ends the wait and
 * frees the cards, so starting over is always one explicit click.
 */
export function isPackCheckoutLocked({
  checkoutPending,
  checkoutUnresolved,
}: {
  checkoutPending: boolean;
  checkoutUnresolved: boolean;
}): boolean {
  return checkoutPending || checkoutUnresolved;
}
