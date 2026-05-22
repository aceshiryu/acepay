const { NxAppWebpackPlugin } = require('@nx/webpack/app-plugin');
const { join } = require('path');

// Direct NxAppWebpackPlugin (not composePlugins/withNx) because our build
// target invokes raw `webpack-cli build`, not @nx/webpack:webpack — so options
// passed to withNx({...}) get ignored. generatePackageJson=true writes
// dist/package.json listing all externalized deps so the cloudbuild
// npm-install step installs them; without it the deploy bundle has no
// node_modules and App Engine boots with MODULE_NOT_FOUND.
module.exports = {
  context: __dirname,
  output: {
    path: join(__dirname, 'dist'),
    clean: true,
    ...(process.env.NODE_ENV !== 'production' && {
      devtoolModuleFilenameTemplate: '[absolute-resource-path]',
    }),
  },
  plugins: [
    new NxAppWebpackPlugin({
      target: 'node',
      compiler: 'tsc',
      main: './src/main.ts',
      tsConfig: './tsconfig.app.json',
      optimization: false,
      outputHashing: 'none',
      generatePackageJson: true,
      sourceMap: true,
    }),
  ],
};
