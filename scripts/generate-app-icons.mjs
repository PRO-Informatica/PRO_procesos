import { mkdir } from "node:fs/promises";
import sharp from "sharp";

// Keep the shared logo untouched; only home-screen icons receive a background.
await mkdir("public/app-icons", { recursive: true });
for (const size of [180, 192, 512]) {
  // Keep the entire logo inside Android's circular mask safe area.
  const logo = await sharp("public/pro-logo.png")
    .trim()
    .resize({ width: Math.round(size * 0.72) })
    .toBuffer();

  await sharp({
    create: { width: size, height: size, channels: 3, background: "#000000" },
  })
    .composite([{ input: logo, gravity: "centre" }])
    .removeAlpha()
    .png()
    .toFile(`public/app-icons/pro-app-black-${size}.png`);
}
