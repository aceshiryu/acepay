const { composePlugins, withNx } = require('@nx/webpack');

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
    assets: ['./src/assets'],
    optimization: false,
    outputHashing: 'none',
    generatePackageJson: true,
    sourceMap: true,
  }),
  (config) => config,
);
