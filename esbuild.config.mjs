// esbuild bundle script. Run with --watch for development.
import { build, context } from 'esbuild';

const watch = process.argv.includes('--watch');

const options = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  sourcemap: true,
  minify: false,
  logLevel: 'info',
};

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
  console.log('Watching for changes...');
} else {
  await build(options);
}
