24 original static reaction stickers, with distinct expressions, poses, and props:

| Mood | Filenames (each ends in `.webp`) |
| --- | --- |
| Greetings and smiles | `hello`, `happy`, `laugh`, `wink`, `bye` |
| Warmth and support | `shy`, `love`, `hug`, `thanks`, `sorry`, `sad`, `cheer` |
| Thinking and reactions | `thinking`, `confused`, `surprised`, `yes`, `no`, `waiting`, `angry` |
| Cozy chat and celebration | `sleepy`, `goodnight`, `coffee`, `hungry`, `celebrate` |

The pink ribbon cat illustrations were drawn for this project. They contain no third-party artwork or fonts. Each shipped asset is a transparent 512 × 512 WebP below 100 KB. Runtime sends the prebuilt bytes directly; no image converter or external sticker service is required.

To customize a reaction, replace its file in this directory using the same filename and mood. Use a static, transparent 512 × 512 WebP below 100 KB, then restart the bot to clear its sticker cache. All 24 filenames are supported; arbitrary new filenames are not selected by the bot. On Pterodactyl this directory is `/home/container/assets/stickers/`. Keep your custom images separately when updating, since the source ZIP includes the built-in artwork.

To rebuild the original artwork using the already installed canvas dependency, run `node scripts/build-stickers.js`. This development step overwrites the 24 reaction files, including any customized copies. Keep all 24 `.webp` files when packaging or uploading the bot.
