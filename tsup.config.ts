import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    'mod': 'mod.ts',
    'llm': 'src/llm/llm.ts',
    'fetch-content': 'src/fetchers/local-fetcher/fetch-content.ts',
    'cost-tracker': 'src/cost-tracker/cost-tracker.ts',
    'logger': 'src/logger/logger.ts',
    'llm-session-compactor': 'src/llm-session-compactor/compactor.ts',
    'run-context': 'src/run-context/run-context.ts',
    'jina-scraper': 'src/fetchers/jina-fetcher/jina-scraper.ts',
    'brave-search': 'src/fetchers/brave-fetcher/brave-search.ts',
  },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
  outDir: 'dist',
  splitting: false,
})
