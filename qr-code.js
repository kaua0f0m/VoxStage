// Small, dependency-free QR encoder for short local URLs (QR version 5-L).
(() => {
  const SIZE = 37;
  const mul = (x, y) => {
    let z = 0;
    for (let i = 7; i >= 0; i--) {
      z = ((z << 1) & 0xff) ^ ((z & 0x80) ? 0x1d : 0);
      z ^= ((y >>> i) & 1) * x;
    }
    return z;
  };
  const divisor = degree => {
    const result = Array(degree).fill(0); result[degree - 1] = 1;
    let root = 1;
    for (let i = 0; i < degree; i++) {
      for (let j = 0; j < degree; j++) {
        result[j] = mul(result[j], root);
        if (j + 1 < degree) result[j] ^= result[j + 1];
      }
      root = mul(root, 2);
    }
    return result;
  };
  const remainder = (data, degree) => {
    const poly = divisor(degree), result = Array(degree).fill(0);
    data.forEach(byte => {
      const factor = byte ^ result.shift(); result.push(0);
      for (let i = 0; i < degree; i++) result[i] ^= mul(poly[i], factor);
    });
    return result;
  };
  function encode(value) {
    const bytes = Array.from(new TextEncoder().encode(value));
    if (!bytes.length || bytes.length > 106) throw new Error('QR URL exceeds the local code capacity.');
    const bits = [];
    const push = (value, count) => { for (let i = count - 1; i >= 0; i--) bits.push((value >>> i) & 1); };
    push(4, 4); push(bytes.length, 8); bytes.forEach(byte => push(byte, 8));
    for (let i = 0; i < 4 && bits.length < 864; i++) bits.push(0);
    while (bits.length % 8) bits.push(0);
    const data = [];
    for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((n, bit) => (n << 1) | bit, 0));
    for (let pad = 0; data.length < 108; pad++) data.push(pad % 2 ? 0x11 : 0xec);
    return data.concat(remainder(data, 26));
  }
  function matrixFor(value) {
    const matrix = Array.from({length: SIZE}, () => Array(SIZE).fill(false));
    const fixed = Array.from({length: SIZE}, () => Array(SIZE).fill(false));
    const set = (x, y, dark) => { if (x >= 0 && y >= 0 && x < SIZE && y < SIZE) { matrix[y][x] = Boolean(dark); fixed[y][x] = true; } };
    const finder = (cx, cy) => {
      for (let dy = -1; dy <= 7; dy++) for (let dx = -1; dx <= 7; dx++) {
        const x = cx + dx, y = cy + dy;
        const inside = dx >= 0 && dx <= 6 && dy >= 0 && dy <= 6;
        const ring = Math.max(Math.abs(dx - 3), Math.abs(dy - 3));
        set(x, y, inside && ring !== 2);
      }
    };
    finder(0, 0); finder(SIZE - 7, 0); finder(0, SIZE - 7);
    for (let i = 8; i < SIZE - 8; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(30 + dx, 30 + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    const format = mask => {
      const data = (1 << 3) | mask; // Error correction level L.
      let rem = data;
      for (let i = 0; i < 10; i++) rem = (rem << 1) ^ (((rem >>> 9) & 1) * 0x537);
      const bits = ((data << 10) | rem) ^ 0x5412;
      for (let i = 0; i <= 5; i++) set(8, i, ((bits >>> i) & 1) !== 0);
      set(8, 7, ((bits >>> 6) & 1) !== 0); set(8, 8, ((bits >>> 7) & 1) !== 0); set(7, 8, ((bits >>> 8) & 1) !== 0);
      for (let i = 9; i < 15; i++) set(14 - i, 8, ((bits >>> i) & 1) !== 0);
      for (let i = 0; i < 8; i++) set(SIZE - 1 - i, 8, ((bits >>> i) & 1) !== 0);
      for (let i = 8; i < 15; i++) set(8, SIZE - 15 + i, ((bits >>> i) & 1) !== 0);
      set(8, SIZE - 8, true);
    };
    format(0);
    const codewords = encode(value), stream = codewords.flatMap(byte => Array.from({length: 8}, (_, i) => (byte >>> (7 - i)) & 1));
    let bitIndex = 0, upward = true;
    for (let right = SIZE - 1; right >= 1; right -= 2) {
      if (right === 6) right--;
      for (let vert = 0; vert < SIZE; vert++) {
        const y = upward ? SIZE - 1 - vert : vert;
        for (let offset = 0; offset < 2; offset++) {
          const x = right - offset;
          if (fixed[y][x]) continue;
          let dark = bitIndex < stream.length ? stream[bitIndex++] !== 0 : false;
          if ((x + y) % 2 === 0) dark = !dark;
          matrix[y][x] = dark;
        }
      }
      upward = !upward;
    }
    format(0);
    return matrix;
  }
  window.drawVoxstageQr = (canvas, value) => {
    const matrix = matrixFor(value), quiet = 4, total = SIZE + quiet * 2;
    const context = canvas.getContext('2d');
    canvas.width = canvas.height = total * 6;
    context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#101012';
    matrix.forEach((row, y) => row.forEach((dark, x) => { if (dark) context.fillRect((x + quiet) * 6, (y + quiet) * 6, 6, 6); }));
  };
})();
