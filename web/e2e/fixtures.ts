import { test as base, Page } from '@playwright/test';

// Use local-echo mode when LOCAL_ECHO env var is set
const useLocalEcho = process.env.LOCAL_ECHO === '1';

/**
 * Extended test fixture that automatically adds ?local-echo=1 to URLs
 * when LOCAL_ECHO=1 environment variable is set.
 */
export const test = base.extend<{ localEchoPage: Page }>({
  page: async ({ page }, use) => {
    if (useLocalEcho) {
      // Override goto to always add local-echo param
      const originalGoto = page.goto.bind(page);
      page.goto = async (url: string, options?: any) => {
        // Parse the URL and add local-echo param
        const urlObj = new URL(url, 'http://localhost:3001');
        if (!urlObj.searchParams.has('local-echo')) {
          urlObj.searchParams.set('local-echo', '1');
        }
        // Use path with query string for relative URLs
        const finalUrl = url.startsWith('http')
          ? urlObj.toString()
          : urlObj.pathname + urlObj.search;
        return originalGoto(finalUrl, options);
      };
    }
    await use(page);
  },
});

export { expect } from '@playwright/test';
