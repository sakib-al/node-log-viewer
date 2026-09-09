import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    nest: 'src/nest.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: false, // dist/ui is produced by the UI build first; never wipe it
  shims: true, // provides __dirname / import.meta.url in both formats
  target: 'node18',
  platform: 'node',
  splitting: false,
  treeshake: true,
  external: ['@nestjs/common', '@nestjs/core', 'reflect-metadata', 'rxjs'],
});
