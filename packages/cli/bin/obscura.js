#!/usr/bin/env node
// Shim — delegates to the compiled TypeScript entry point
import('../dist/cli.js').catch(e => {
  console.error('Error loading Obscura CLI:', e.message);
  process.exit(1);
});
