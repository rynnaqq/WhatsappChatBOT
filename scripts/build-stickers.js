// Original, font-free vector artwork. Run only when rebuilding the shipped assets.
import { mkdir, writeFile } from 'node:fs/promises';
import { createCanvas } from '@napi-rs/canvas';

const output = new URL('../assets/stickers/', import.meta.url);
await mkdir(output, { recursive: true });
const ink = '#79536b';
const cream = '#fff6f1';
const pink = '#f2a9c6';
const darkPink = '#d674a0';

function drawSticker(mood) {
  const canvas = createCanvas(512, 512);
  const c = canvas.getContext('2d');
  c.lineCap = 'round';
  c.lineJoin = 'round';
  function shape(draw, fill, outline = ink, width = 6) {
    c.beginPath(); draw();
    c.fillStyle = fill; c.fill();
    c.strokeStyle = '#ffffff'; c.lineWidth = width + 16; c.stroke();
    c.strokeStyle = outline; c.lineWidth = width; c.stroke();
  }
  function ellipse(x, y, rx, ry, fill, outline = ink, width = 6) {
    shape(() => c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2), fill, outline, width);
  }
  function line(draw, color = ink, width = 8) {
    c.beginPath(); draw(); c.strokeStyle = color; c.lineWidth = width; c.stroke();
  }
  function heart(x, y, size, fill = '#ef8faf') {
    shape(() => {
      c.moveTo(x, y + size * 0.7);
      c.bezierCurveTo(x - size * 1.5, y - size * 0.2, x - size * 0.6, y - size * 1.2, x, y - size * 0.4);
      c.bezierCurveTo(x + size * 0.6, y - size * 1.2, x + size * 1.5, y - size * 0.2, x, y + size * 0.7);
    }, fill, darkPink, 4);
  }
  function star(x, y, radius, fill = '#f9d675') {
    shape(() => {
      for (let i = 0; i < 8; i += 1) {
        const a = i * Math.PI / 4 - Math.PI / 2;
        const r = i % 2 ? radius * 0.38 : radius;
        const px = x + Math.cos(a) * r;
        const py = y + Math.sin(a) * r;
        if (i === 0) c.moveTo(px, py); else c.lineTo(px, py);
      }
      c.closePath();
    }, fill, '#c5a151', 4);
  }
  // Body and raised paws sit behind the head.
  ellipse(257, 352, 105, 104, '#fbe0eb');
  ellipse(202, 435, 47, 24, cream);
  ellipse(312, 435, 47, 24, cream);
  if (mood === 'hello') ellipse(396, 239, 36, 47, cream);
  if (mood === 'cheer') {
    ellipse(115, 269, 33, 48, cream);
    ellipse(396, 269, 33, 48, cream);
  }
  // Soft cat silhouette with a generous white sticker border.
  shape(() => {
    c.moveTo(129, 185);
    c.bezierCurveTo(105, 113, 125, 67, 142, 73);
    c.lineTo(209, 124);
    c.quadraticCurveTo(253, 111, 299, 124);
    c.lineTo(364, 73);
    c.bezierCurveTo(383, 65, 401, 117, 380, 183);
    c.bezierCurveTo(414, 286, 366, 338, 257, 342);
    c.bezierCurveTo(145, 343, 95, 287, 129, 185);
    c.closePath();
  }, cream);
  c.fillStyle = '#f4c0d3';
  c.beginPath(); c.moveTo(142, 101); c.lineTo(190, 135); c.lineTo(140, 159); c.closePath(); c.fill();
  c.beginPath(); c.moveTo(363, 101); c.lineTo(319, 135); c.lineTo(372, 158); c.closePath(); c.fill();
  // A little ribbon keeps the pack visually consistent.
  shape(() => { c.moveTo(169, 130); c.bezierCurveTo(111, 90, 104, 152, 162, 159); c.closePath(); }, pink, darkPink, 4);
  shape(() => { c.moveTo(176, 130); c.bezierCurveTo(214, 84, 242, 142, 184, 159); c.closePath(); }, pink, darkPink, 4);
  ellipse(174, 143, 14, 15, '#ed92b7', darkPink, 4);
  // Blush has no outline, to keep the expression soft.
  c.fillStyle = mood === 'shy' ? '#f19ab5' : '#f8c0ce';
  for (const x of [163, 348]) { c.beginPath(); c.ellipse(x, 265, mood === 'shy' ? 32 : 25, 15, 0, 0, Math.PI * 2); c.fill(); }
  if (mood === 'love') {
    heart(204, 230, 20); heart(307, 230, 20);
  } else if (mood === 'shy') {
    line(() => { c.moveTo(183, 221); c.lineTo(212, 235); c.lineTo(183, 248); });
    line(() => { c.moveTo(329, 221); c.lineTo(300, 235); c.lineTo(329, 248); });
  } else if (mood === 'happy' || mood === 'cheer') {
    line(() => { c.moveTo(181, 240); c.quadraticCurveTo(202, 212, 223, 240); });
    line(() => { c.moveTo(289, 240); c.quadraticCurveTo(310, 212, 331, 240); });
  } else {
    c.fillStyle = ink;
    for (const x of [204, 308]) { c.beginPath(); c.ellipse(x, 231, 9, 16, 0, 0, Math.PI * 2); c.fill(); }
  }
  if (mood === 'sad') {
    line(() => { c.moveTo(192, 204); c.lineTo(216, 193); });
    line(() => { c.moveTo(297, 193); c.lineTo(321, 204); });
    shape(() => { c.moveTo(329, 250); c.quadraticCurveTo(302, 291, 329, 294); c.quadraticCurveTo(356, 291, 329, 250); }, '#b3ddf1', '#78adcd', 4);
    line(() => { c.moveTo(239, 283); c.quadraticCurveTo(256, 268, 272, 283); }, ink, 6);
  } else {
    c.fillStyle = darkPink;
    c.beginPath(); c.moveTo(250, 262); c.quadraticCurveTo(256, 270, 263, 262); c.closePath(); c.fill();
    line(() => { c.moveTo(236, 275); c.quadraticCurveTo(246, 291, 256, 277); c.quadraticCurveTo(266, 291, 277, 275); }, ink, 6);
  }
  if (mood === 'shy') {
    ellipse(222, 326, 24, 29, cream); ellipse(290, 326, 24, 29, cream);
    heart(412, 148, 22);
  } else if (mood === 'love') {
    heart(256, 365, 48); ellipse(207, 369, 22, 27, cream); ellipse(305, 369, 22, 27, cream);
    heart(88, 189, 25); heart(414, 156, 31);
  } else if (mood === 'hello') {
    star(418, 106, 26, '#bedfed');
    line(() => { c.moveTo(437, 221); c.lineTo(460, 207); }, '#b796bb', 7);
    line(() => { c.moveTo(440, 246); c.lineTo(466, 244); }, '#b796bb', 7);
  } else if (mood === 'happy') {
    star(82, 182, 26); star(419, 159, 32); star(426, 353, 20, '#dfc9ee');
    ellipse(182, 362, 25, 33, cream); ellipse(331, 362, 25, 33, cream);
  } else if (mood === 'cheer') {
    star(79, 162, 31); star(430, 159, 31); star(257, 376, 26);
  } else {
    ellipse(184, 354, 25, 32, cream); ellipse(329, 354, 25, 32, cream);
    heart(421, 137, 20, '#d7bfdf');
  }
  return canvas;
}

for (const mood of ['hello', 'happy', 'shy', 'love', 'sad', 'cheer']) {
  const encoded = await drawSticker(mood).encode('webp', 90);
  if (encoded.length >= 100_000) throw new Error(`Sticker ${mood} exceeds its asset budget.`);
  await writeFile(new URL(`${mood}.webp`, output), encoded);
  console.log(`${mood}.webp: ${encoded.length} bytes`);
}
