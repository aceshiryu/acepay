import baseConfig from '../../eslint.config.mjs';

export default [
  ...baseConfig,
  {
    // The worker deliberately reuses the gateway's code (DatabaseModule,
    // CommonServicesModule, entities, adapters, queue services) via relative
    // imports — see CLAUDE.md. That's an intentional architecture choice for
    // this two-app monorepo, so the cross-project boundary rule doesn't apply.
    files: ['**/*.ts'],
    rules: {
      '@nx/enforce-module-boundaries': 'off',
    },
  },
];
