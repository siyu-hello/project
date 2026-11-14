const qrcode = require('../vendor/qrcode');
const CODE = /^[A-F0-9]{12}$/;
const PREFIX = 'CAMPUS|GIFT|';

function parseCode(value) {
  const text = String(value || '').trim().toUpperCase();
  const code = text.startsWith(PREFIX) ? text.slice(PREFIX.length) : text.replace(/\s/g, '');
  return CODE.test(code) ? code : '';
}

function drawCode(context, code, size) {
  const qr = qrcode(0, 'M');
  qr.addData(PREFIX + code);
  qr.make();
  const count = qr.getModuleCount();
  const cell = Math.floor(size / (count + 8));
  const offset = Math.floor((size - count * cell) / 2);
  context.setFillStyle('#ffffff');
  context.fillRect(0, 0, size, size);
  context.setFillStyle('#000000');
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (qr.isDark(row, col)) context.fillRect(offset + col * cell, offset + row * cell, cell, cell);
    }
  }
  context.draw();
}

module.exports = { parseCode, drawCode };
