const nodeExternals = require('webpack-node-externals');
const { resolve } = require('path');

module.exports = function (options) {
  return {
    ...options,
    externals: [
      nodeExternals({
        modulesDir: resolve(__dirname, '../../node_modules'),
        allowlist: [/^@auditswarm\//],
      }),
      nodeExternals({
        modulesDir: resolve(__dirname, 'node_modules'),
        allowlist: [/^@auditswarm\//],
      }),
    ],
  };
};
