// Dummy file with a bug to be fixed
function calculateTotal(price, tax) {
  // BUG: This should be price * (1 + tax)
  return price + tax;
}
console.log(calculateTotal(100, 0.1)); // Expected 110, actually 100.1
