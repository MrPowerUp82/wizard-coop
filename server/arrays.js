/**
 * Retains matching entries without allocating a replacement array.
 * When `limit` is finite, keeps the newest matching entries (same semantics as filter(...).slice(-limit)).
 * Returning the same array is useful in the console ports where frequent short-lived arrays put pressure on GC.
 */
export function retainTail(array, keep, limit = Infinity) {
  let write = 0;
  for (let read = 0; read < array.length; read++) {
    const value = array[read];
    if (keep(value)) array[write++] = value;
  }
  array.length = write;
  if (write <= limit) return array;
  const drop = write - limit;
  array.copyWithin(0, drop, write);
  array.length = limit;
  return array;
}
