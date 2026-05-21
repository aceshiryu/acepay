const { composePlugins, withNx } = require('@nx/webpack');
const { join } = require('path');

// Nx plugins for webpack.
// generatePackageJson: true → writes dist/package.json listing all externalized
// runtime deps (axios, @nestjs/*, etc.) so the npm-install step in cloudbuild
// actually installs them. Without it the deploy bundle has no node_modules and
// App Engine boots with MODULE_NOT_FOUND.
module.exports = composePlugins(
  withNx({
    target: 'node',
    compiler: 'tsc',
    main: './src/main.ts',
    tsConfig: './tsconfig.app.json',
    optimization: false,
    outputHashing: 'none',
    generatePackageJson: true,
    sourceMap: true,
  }),
  (config) => {
    // Resolve all relative paths (tsConfig, main, output) from THIS file's
    // directory. Without this, webpack uses process.cwd() which on Cloud
    // Build is /workspace, breaking ForkTsCheckerWebpackPlugin's tsconfig lookup.
    config.context = __dirname;
    config.output = { ...config.output, path: join(__dirname, 'dist') };
    return config;
  },
);
