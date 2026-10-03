import { cleanup, configure } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// The default wait of 1 s is too short when every package is tested at once.
configure({ asyncUtilTimeout: 5_000 });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
