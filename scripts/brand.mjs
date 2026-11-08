import { createRequire } from 'node:module';
import { mkdir, copyFile } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const dest = new URL('../public/brand/', import.meta.url);
await mkdir(dest, { recursive: true });
for (const file of ['sierra-mark.png', 'sierra-logo-full.png']) {
  await copyFile(require.resolve(`@sierragridteam/design-system/assets/${file}`), new URL(file, dest));
}
