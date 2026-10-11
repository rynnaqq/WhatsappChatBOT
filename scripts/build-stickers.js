// Original, font-free vector artwork. Run only when rebuilding the shipped assets.
import { mkdir, writeFile } from 'node:fs/promises';
import { createCanvas } from '@napi-rs/canvas';
import { STICKER_IDS } from '../src/services/expressionCatalog.js';

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
  function roundedBox(x, y, w, h, fill, outline = ink, radius = 14) {
    shape(() => c.roundRect(x, y, w, h, radius), fill, outline, 5);
  }
  function closedEyes() {
    line(() => { c.moveTo(181, 240); c.quadraticCurveTo(202, 212, 223, 240); });
    line(() => { c.moveTo(289, 240); c.quadraticCurveTo(310, 212, 331, 240); });
  }
  function flower(x, y, color) {
    for (let i = 0; i < 5; i += 1) {
      const angle = i * Math.PI * 2 / 5;
      ellipse(x + Math.cos(angle) * 16, y + Math.sin(angle) * 16, 13, 13, color, '#c986a7', 3);
    }
    ellipse(x, y, 10, 10, '#f9d675', '#c5a151', 3);
  }
  function question(x, y, color = '#ae8ac4') {
    line(() => {
      c.moveTo(x - 15, y - 20); c.bezierCurveTo(x - 12, y - 48, x + 34, y - 38, x + 17, y - 14);
      c.quadraticCurveTo(x, y - 1, x + 1, y + 10);
    }, color, 10);
    ellipse(x + 1, y + 28, 5, 5, color, color, 2);
  }
  function moon(x, y) {
    shape(() => {
      c.moveTo(x + 14, y - 34);
      c.bezierCurveTo(x - 51, y - 47, x - 45, y + 44, x + 16, y + 33);
      c.bezierCurveTo(x - 13, y + 17, x - 17, y - 18, x + 14, y - 34);
    }, '#f9db8e', '#c5a151', 4);
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
  if (mood === 'hug') {
    ellipse(126, 337, 42, 61, cream); ellipse(387, 337, 42, 61, cream);
  }
  if (mood === 'bye') ellipse(108, 239, 36, 47, cream);
  if (mood === 'celebrate') {
    ellipse(114, 301, 30, 42, cream); ellipse(399, 301, 30, 42, cream);
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
  } else if (['hug', 'thanks', 'celebrate', 'hungry', 'coffee'].includes(mood)) {
    closedEyes();
  } else if (mood === 'laugh') {
    line(() => { c.moveTo(183, 220); c.lineTo(213, 235); c.lineTo(183, 250); });
    line(() => { c.moveTo(330, 220); c.lineTo(300, 235); c.lineTo(330, 250); });
  } else if (mood === 'wink') {
    ellipse(204, 231, 8, 15, ink, ink, 2);
    line(() => { c.moveTo(289, 235); c.quadraticCurveTo(310, 214, 331, 235); });
  } else if (mood === 'sleepy' || mood === 'goodnight') {
    line(() => { c.moveTo(181, 233); c.quadraticCurveTo(202, 251, 223, 233); });
    line(() => { c.moveTo(289, 233); c.quadraticCurveTo(310, 251, 331, 233); });
  } else if (mood === 'surprised' || mood === 'sorry') {
    for (const x of [204, 308]) {
      ellipse(x, 234, 21, 26, ink, ink, 3);
      c.fillStyle = '#ffffff'; c.beginPath(); c.ellipse(x - 6, 225, 6, 8, 0, 0, Math.PI * 2); c.fill();
    }
  } else if (mood === 'confused') {
    for (const x of [204, 308]) {
      line(() => {
        for (let i = 0; i < 60; i += 1) {
          const a = i * 0.18; const r = i * 0.3;
          const px = x + Math.cos(a) * r; const py = 233 + Math.sin(a) * r;
          if (i === 0) c.moveTo(px, py); else c.lineTo(px, py);
        }
      }, ink, 5);
    }
  } else if (mood === 'thinking') {
    for (const x of [210, 314]) ellipse(x, 231, 7, 13, ink, ink, 2);
    line(() => { c.moveTo(184, 205); c.lineTo(218, 201); }, ink, 5);
  } else {
    c.fillStyle = ink;
    for (const x of [204, 308]) { c.beginPath(); c.ellipse(x, 231, 9, 16, 0, 0, Math.PI * 2); c.fill(); }
  }
  if (mood === 'sad') {
    line(() => { c.moveTo(192, 204); c.lineTo(216, 193); });
    line(() => { c.moveTo(297, 193); c.lineTo(321, 204); });
    shape(() => { c.moveTo(329, 250); c.quadraticCurveTo(302, 291, 329, 294); c.quadraticCurveTo(356, 291, 329, 250); }, '#b3ddf1', '#78adcd', 4);
    line(() => { c.moveTo(239, 283); c.quadraticCurveTo(256, 268, 272, 283); }, ink, 6);
  } else if (mood === 'laugh') {
    shape(() => {
      c.moveTo(229, 272); c.lineTo(283, 272); c.quadraticCurveTo(278, 315, 256, 315);
      c.quadraticCurveTo(234, 315, 229, 272);
    }, ink, ink, 3);
    c.fillStyle = pink; c.beginPath(); c.ellipse(256, 304, 15, 8, 0, 0, Math.PI * 2); c.fill();
  } else if (mood === 'surprised' || mood === 'sleepy') {
    ellipse(256, 283, mood === 'sleepy' ? 16 : 13, 19, '#d99cb1', ink, 4);
  } else if (mood === 'angry' || mood === 'no') {
    line(() => { c.moveTo(237, 286); c.quadraticCurveTo(256, 274, 275, 286); }, ink, 6);
    if (mood === 'angry') {
      line(() => { c.moveTo(183, 198); c.lineTo(218, 211); });
      line(() => { c.moveTo(294, 211); c.lineTo(329, 198); });
    }
  } else if (mood === 'sorry' || mood === 'thinking' || mood === 'confused') {
    line(() => { c.moveTo(243, 284); c.quadraticCurveTo(256, 279, 269, 284); }, ink, 5);
    if (mood === 'sorry') {
      line(() => { c.moveTo(183, 207); c.lineTo(216, 193); }, ink, 5);
      line(() => { c.moveTo(296, 193); c.lineTo(329, 207); }, ink, 5);
    }
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
  } else if (mood === 'laugh') {
    ellipse(183, 364, 24, 33, cream); ellipse(329, 364, 24, 33, cream);
    for (const x of [87, 423]) {
      line(() => { c.moveTo(x - 8, 162); c.lineTo(x + 7, 185); }, '#b69ac9', 7);
      line(() => { c.moveTo(x - 11, 205); c.lineTo(x + 11, 212); }, '#b69ac9', 7);
    }
  } else if (mood === 'wink') {
    ellipse(309, 323, 25, 29, cream); heart(420, 165, 28);
    star(88, 183, 22, '#d9c6ed');
  } else if (mood === 'hug') {
    heart(256, 370, 55, '#f3aac5');
    ellipse(187, 370, 28, 32, cream); ellipse(326, 370, 28, 32, cream);
    heart(85, 163, 19); heart(430, 171, 19);
  } else if (mood === 'thanks') {
    line(() => { c.moveTo(244, 420); c.lineTo(215, 352); c.moveTo(257, 420); c.lineTo(270, 347); c.moveTo(270, 420); c.lineTo(305, 355); }, '#82ab8c', 7);
    flower(211, 348, '#f3acc8'); flower(267, 340, '#d8c4ec'); flower(309, 355, '#f6d58c');
    shape(() => { c.moveTo(217, 390); c.lineTo(295, 390); c.lineTo(270, 433); c.lineTo(248, 433); c.closePath(); }, '#e8c6dc', '#ba8daa', 4);
    ellipse(188, 393, 24, 29, cream); ellipse(327, 393, 24, 29, cream);
    star(422, 139, 21, '#d8c4ec');
  } else if (mood === 'sorry') {
    ellipse(239, 369, 22, 35, cream); ellipse(274, 369, 22, 35, cream);
    for (const x of [89, 423]) line(() => { c.moveTo(x, 158); c.lineTo(x, 183); }, '#b69ac9', 7);
    heart(425, 219, 17, '#d7bfdf');
  } else if (mood === 'thinking') {
    ellipse(281, 307, 24, 27, cream); ellipse(182, 366, 25, 33, cream);
    ellipse(407, 204, 7, 7, '#ede3f8', '#ae8ac4', 3);
    ellipse(425, 181, 11, 11, '#ede3f8', '#ae8ac4', 3);
    ellipse(434, 130, 39, 35, '#ede3f8', '#ae8ac4', 4);
    for (const x of [417, 434, 451]) ellipse(x, 130, 3, 3, '#ae8ac4', '#ae8ac4', 1);
  } else if (mood === 'confused') {
    ellipse(182, 365, 25, 33, cream); ellipse(331, 365, 25, 33, cream);
    question(80, 179); question(424, 134);
  } else if (mood === 'surprised') {
    ellipse(168, 291, 25, 32, cream); ellipse(345, 291, 25, 32, cream);
    for (const x of [87, 424]) {
      roundedBox(x - 4, 125, 8, 45, '#f3c783', '#c5a151', 4);
      ellipse(x, 190, 6, 6, '#f3c783', '#c5a151', 3);
    }
  } else if (mood === 'sleepy') {
    ellipse(273, 293, 25, 30, cream); ellipse(181, 366, 25, 33, cream);
    for (const [x, y, size] of [[419, 180, 16], [438, 139, 22]]) {
      line(() => { c.moveTo(x - size, y - size); c.lineTo(x + size, y - size); c.lineTo(x - size, y + size); c.lineTo(x + size, y + size); }, '#ae8ac4', 6);
    }
  } else if (mood === 'goodnight') {
    roundedBox(166, 344, 183, 68, '#dfd1f0', '#ac8dbf', 27);
    ellipse(183, 373, 24, 25, cream); ellipse(332, 373, 24, 25, cream);
    moon(431, 127); star(84, 181, 20); star(420, 258, 15);
  } else if (mood === 'coffee') {
    // Handle behind the mug; steam is part of the prebuilt drawing.
    ellipse(317, 374, 25, 22, cream, '#b492a1', 5);
    roundedBox(217, 339, 96, 74, '#f8d9c7', '#b492a1');
    ellipse(265, 342, 43, 10, '#a67f76', '#b492a1', 4);
    ellipse(191, 376, 23, 27, cream); ellipse(339, 382, 21, 26, cream);
    for (const x of [249, 276]) line(() => { c.moveTo(x, 326); c.bezierCurveTo(x - 11, 313, x + 11, 307, x, 296); }, '#cab4c0', 5);
    star(423, 145, 20, '#d9c6ed');
  } else if (mood === 'hungry') {
    ellipse(256, 378, 52, 45, '#e9be82', '#bb8c62', 5);
    for (const [x, y] of [[234, 362], [270, 355], [283, 388], [251, 399], [227, 384]]) ellipse(x, y, 5, 5, '#a17562', '#a17562', 2);
    ellipse(196, 377, 24, 28, cream); ellipse(318, 377, 24, 28, cream);
    c.fillStyle = pink; c.beginPath(); c.ellipse(268, 288, 7, 12, 0.4, 0, Math.PI * 2); c.fill();
    heart(422, 155, 23, '#f5cd9d');
  } else if (mood === 'celebrate') {
    shape(() => { c.moveTo(225, 137); c.lineTo(277, 38); c.lineTo(328, 140); c.closePath(); }, '#d9c6ed', '#ae8ac4', 4);
    ellipse(277, 42, 14, 14, '#f9d675', '#c5a151', 3);
    line(() => { c.moveTo(248, 93); c.lineTo(307, 111); }, '#f4aac8', 10);
    for (const [x, y, color] of [[77, 170, pink], [424, 168, '#b5dcd1'], [88, 348, '#d9c6ed'], [423, 358, '#f9d675']]) {
      line(() => { c.moveTo(x - 6, y - 10); c.lineTo(x + 6, y + 10); }, color, 9);
    }
    star(256, 375, 31); star(437, 98, 19);
  } else if (mood === 'yes' || mood === 'no') {
    const color = mood === 'yes' ? '#86bba5' : '#df94ab';
    roundedBox(206, 339, 102, 84, mood === 'yes' ? '#d3eee1' : '#f6dae3', color, 20);
    if (mood === 'yes') {
      line(() => { c.moveTo(228, 380); c.lineTo(248, 397); c.lineTo(282, 363); }, color, 10);
      star(419, 152, 24, '#cce3b6');
    } else {
      line(() => { c.moveTo(235, 360); c.lineTo(280, 402); c.moveTo(280, 360); c.lineTo(235, 402); }, color, 10);
      line(() => { c.moveTo(80, 175); c.lineTo(99, 168); c.moveTo(422, 175); c.lineTo(441, 168); }, color, 6);
    }
    ellipse(181, 383, 23, 28, cream); ellipse(334, 383, 23, 28, cream);
  } else if (mood === 'waiting') {
    shape(() => {
      c.moveTo(228, 345); c.lineTo(282, 345); c.quadraticCurveTo(282, 367, 257, 380);
      c.quadraticCurveTo(282, 395, 282, 417); c.lineTo(228, 417);
      c.quadraticCurveTo(228, 395, 253, 380); c.quadraticCurveTo(228, 367, 228, 345);
    }, '#e3eff5', '#95b6c8', 4);
    shape(() => { c.moveTo(237, 355); c.lineTo(273, 355); c.lineTo(255, 373); c.closePath(); }, '#f9d675', '#c5a151', 3);
    shape(() => { c.moveTo(235, 410); c.lineTo(255, 390); c.lineTo(276, 410); c.closePath(); }, '#f9d675', '#c5a151', 3);
    ellipse(188, 379, 22, 28, cream); ellipse(324, 379, 22, 28, cream);
    for (const x of [411, 433, 455]) ellipse(x, 143, 5, 5, '#ae8ac4', '#ae8ac4', 2);
  } else if (mood === 'angry') {
    ellipse(183, 357, 25, 30, cream); ellipse(330, 357, 25, 30, cream);
    line(() => { c.moveTo(409, 119); c.lineTo(426, 119); c.lineTo(426, 101); c.moveTo(442, 101); c.lineTo(442, 119); c.lineTo(459, 119); c.moveTo(409, 136); c.lineTo(426, 136); c.lineTo(426, 153); c.moveTo(442, 153); c.lineTo(442, 136); c.lineTo(459, 136); }, darkPink, 6);
    ellipse(81, 213, 18, 11, '#e5d7ef', '#ae8ac4', 3);
  } else if (mood === 'bye') {
    star(419, 128, 24, '#d9c6ed'); heart(425, 232, 20);
    line(() => { c.moveTo(63, 212); c.lineTo(43, 198); c.moveTo(64, 238); c.lineTo(39, 236); }, '#b796bb', 7);
    ellipse(329, 363, 25, 33, cream);
  } else {
    ellipse(184, 354, 25, 32, cream); ellipse(329, 354, 25, 32, cream);
    heart(421, 137, 20, '#d7bfdf');
  }
  return canvas;
}

for (const mood of STICKER_IDS) {
  const encoded = await drawSticker(mood).encode('webp', 90);
  if (encoded.length >= 100_000) throw new Error(`Sticker ${mood} exceeds its asset budget.`);
  await writeFile(new URL(`${mood}.webp`, output), encoded);
  console.log(`${mood}.webp: ${encoded.length} bytes`);
}
