// Compatibility launcher; all environments use the same TypeScript seed source.
require('ts-node').register({ transpileOnly: true, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
require('./seed.ts');
