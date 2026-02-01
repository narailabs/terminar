import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createSearchStore,
  type SearchState,
} from './searchStore';

describe('searchStore', () => {
  let store: ReturnType<typeof createSearchStore>;

  beforeEach(() => {
    store = createSearchStore();
  });

  describe('F4a: Search state management', () => {
    it('should start with search closed', () => {
      const state = store.get();
      expect(state.isOpen).toBe(false);
      expect(state.query).toBe('');
      expect(state.currentMatch).toBe(0);
      expect(state.totalMatches).toBe(0);
    });

    it('should open search bar', () => {
      store.open();
      const state = store.get();
      expect(state.isOpen).toBe(true);
    });

    it('should close search bar and clear state', () => {
      store.open();
      store.setQuery('hello');
      store.close();
      const state = store.get();
      expect(state.isOpen).toBe(false);
      expect(state.query).toBe('');
      expect(state.currentMatch).toBe(0);
      expect(state.totalMatches).toBe(0);
    });

    it('should update query', () => {
      store.open();
      store.setQuery('test');
      expect(store.get().query).toBe('test');
    });

    it('should update match count', () => {
      store.open();
      store.setQuery('test');
      store.setMatchInfo(3, 17);
      const state = store.get();
      expect(state.currentMatch).toBe(3);
      expect(state.totalMatches).toBe(17);
    });

    it('should toggle case sensitivity', () => {
      expect(store.get().caseSensitive).toBe(false);
      store.toggleCaseSensitive();
      expect(store.get().caseSensitive).toBe(true);
      store.toggleCaseSensitive();
      expect(store.get().caseSensitive).toBe(false);
    });

    it('should toggle regex mode', () => {
      expect(store.get().useRegex).toBe(false);
      store.toggleRegex();
      expect(store.get().useRegex).toBe(true);
      store.toggleRegex();
      expect(store.get().useRegex).toBe(false);
    });

    it('should reset match info when query changes', () => {
      store.open();
      store.setQuery('test');
      store.setMatchInfo(3, 17);
      store.setQuery('different');
      const state = store.get();
      expect(state.currentMatch).toBe(0);
      expect(state.totalMatches).toBe(0);
    });
  });

  describe('F4a: Subscribability', () => {
    it('should notify subscribers on state change', () => {
      const callback = vi.fn();
      const unsub = store.subscribe(callback);

      // Initial call
      expect(callback).toHaveBeenCalledTimes(1);

      store.open();
      expect(callback).toHaveBeenCalledTimes(2);

      unsub();
    });
  });
});
