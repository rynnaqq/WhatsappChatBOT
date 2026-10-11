// Mood palettes guide expression variety without making every reply decorative.
const groups = [
  {
    id: 'friendly', label: 'Greetings and warm smiles',
    emojis: ['👋', '😊', '🙂', '😄', '🌸', '🌷', '🌼', '✨', '🫶', '🤗'],
    kaomoji: ['(｡•ᴗ•｡)', '(´｡• ᵕ •｡`)', '(^▽^)', '^.^', '(˶ᵔ ᵕ ᵔ˶)', '(｡･ω･｡)ﾉ', 'ヾ(・ω・*)'],
  },
  {
    id: 'happy', label: 'Playful joy and celebration',
    emojis: ['😆', '😂', '🤣', '😹', '😸', '🥳', '🎉', '🎊', '⭐', '💫'],
    kaomoji: ['>.<', '(≧▽≦)', '(๑˃ᴗ˂)ﻭ', 'o(≧▽≦)o', '(ﾉ◕ヮ◕)ﾉ*:･ﾟ✧', '(＾▽＾)', '(☆▽☆)'],
  },
  {
    id: 'affection', label: 'Shy and affectionate moments',
    emojis: ['🥰', '😍', '😘', '😚', '😳', '🙈', '💕', '💗', '💖', '🎀'],
    kaomoji: ['(⁄ ⁄>⁄ ▽ ⁄<⁄ ⁄)', '(〃ω〃)', '(´♡‿♡`)', '(づ｡◕‿‿◕｡)づ', '(♡˙︶˙♡)', '(´,,•ω•,,)♡', '(｡♥‿♥｡)'],
  },
  {
    id: 'comfort', label: 'Gentle comfort and encouragement',
    emojis: ['🥺', '😢', '😔', '💐', '🌻', '🤍', '💛', '💪', '🍀', '🫂'],
    kaomoji: ['(っ´ω`)ﾉ(╥ω╥)', '(๑•̀ㅂ•́)و✧', '(ง •̀_•́)ง', '(つ≧▽≦)つ', '(´･ᴗ･`)', '(｡•́︿•̀｡)', '(´•̥ ω •̥`)'],
  },
  {
    id: 'reaction', label: 'Thinking, surprise, and light teasing',
    emojis: ['🤔', '🧐', '😮', '😲', '😵‍💫', '😅', '😉', '😌', '👍', '👌'],
    kaomoji: ['(・・?)', '(・_・ヾ)', '(・・;)', '(⊙_⊙)', '(¬‿¬)', '(￣ω￣)'],
  },
  {
    id: 'calm', label: 'Sleepy and cozy everyday chat',
    emojis: ['😴', '🥱', '🌙', '🌟', '☁️', '☕', '🍵', '🍰', '🍪', '😋'],
    kaomoji: ['(－ω－) zzZ', '(￣▽￣)ノ', '(´～`)', '( ˘ω˘ )', '(っ˘ڡ˘ς)', '(´｡• ω •｡`)'],
  },
];

export const EXPRESSION_GROUPS = Object.freeze(groups.map((group) => Object.freeze({
  ...group,
  emojis: Object.freeze(group.emojis),
  kaomoji: Object.freeze(group.kaomoji),
})));

const stickers = [
  { id: 'hello', label: 'Friendly greeting', fallback: 'Hai! 👋' },
  { id: 'happy', label: 'Happy smile', fallback: 'Senang banget! 😊' },
  { id: 'shy', label: 'Bashful blush', fallback: '>.<' },
  { id: 'love', label: 'Affection', fallback: '💗' },
  { id: 'sad', label: 'Sadness', fallback: '😢' },
  { id: 'cheer', label: 'Encouragement', fallback: 'Semangat! ✨' },
  { id: 'laugh', label: 'Laughter', fallback: '😆' },
  { id: 'wink', label: 'Playful wink', fallback: '😉' },
  { id: 'hug', label: 'Warm hug', fallback: '🫂' },
  { id: 'thanks', label: 'Gratitude', fallback: 'Makasih! 🥰' },
  { id: 'sorry', label: 'Gentle apology', fallback: 'Maaf ya 🥺' },
  { id: 'thinking', label: 'Thoughtful pause', fallback: 'Hmm... 🤔' },
  { id: 'confused', label: 'Lighthearted confusion', fallback: '😵‍💫' },
  { id: 'surprised', label: 'Surprise', fallback: '😮' },
  { id: 'sleepy', label: 'Feeling sleepy', fallback: '😴' },
  { id: 'goodnight', label: 'Goodnight wishes', fallback: 'Selamat tidur 🌙' },
  { id: 'coffee', label: 'Cozy coffee break', fallback: '☕' },
  { id: 'hungry', label: 'Snack time', fallback: '😋' },
  { id: 'celebrate', label: 'Celebration', fallback: 'Yay! 🎉' },
  { id: 'yes', label: 'Cheerful agreement', fallback: 'Oke! 👍' },
  { id: 'no', label: 'Playful disagreement', fallback: '🙅‍♀️' },
  { id: 'waiting', label: 'Patient waiting', fallback: '⏳' },
  { id: 'angry', label: 'Playful pout', fallback: '😤' },
  { id: 'bye', label: 'Friendly farewell', fallback: 'Dadah! 👋' },
];

export const STICKER_CATALOG = Object.freeze(stickers.map((sticker) => Object.freeze(sticker)));
export const STICKER_IDS = Object.freeze(STICKER_CATALOG.map(({ id }) => id));
const fallbacks = new Map(STICKER_CATALOG.map(({ id, fallback }) => [id, fallback]));

export function stickerFallback(id) {
  return fallbacks.get(id) ?? '😊';
}
