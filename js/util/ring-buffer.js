function validateCapacity(capacity) {
  if (!Number.isInteger(capacity) || capacity < 1) {
    throw new RangeError("Ring-buffer capacity must be a positive integer.");
  }
}

export function createRingBuffer(capacity) {
  validateCapacity(capacity);
  const values = new Array(capacity);
  let startIndex = 0;
  let size = 0;

  const physicalIndex = (logicalIndex) => (startIndex + logicalIndex) % capacity;

  const first = () => (size === 0 ? undefined : values[startIndex]);

  const shift = () => {
    if (size === 0) {
      return undefined;
    }
    const value = values[startIndex];
    values[startIndex] = undefined;
    startIndex = (startIndex + 1) % capacity;
    size -= 1;
    if (size === 0) {
      startIndex = 0;
    }
    return value;
  };

  return Object.freeze({
    capacity,

    clear() {
      values.fill(undefined);
      startIndex = 0;
      size = 0;
    },

    evictWhile(predicate) {
      if (typeof predicate !== "function") {
        throw new TypeError("Ring-buffer eviction requires a predicate.");
      }
      let evicted = 0;
      while (size > 0 && predicate(first())) {
        shift();
        evicted += 1;
      }
      return evicted;
    },

    first,

    forEach(callback) {
      if (typeof callback !== "function") {
        throw new TypeError("Ring-buffer iteration requires a callback.");
      }
      for (let index = 0; index < size; index += 1) {
        callback(values[physicalIndex(index)], index);
      }
    },

    get size() {
      return size;
    },

    last() {
      return size === 0 ? undefined : values[physicalIndex(size - 1)];
    },

    push(value) {
      if (size < capacity) {
        values[physicalIndex(size)] = value;
        size += 1;
      } else {
        values[startIndex] = value;
        startIndex = (startIndex + 1) % capacity;
      }
      return value;
    },

    shift,

    toArray() {
      const result = new Array(size);
      for (let index = 0; index < size; index += 1) {
        result[index] = values[physicalIndex(index)];
      }
      return result;
    },
  });
}
