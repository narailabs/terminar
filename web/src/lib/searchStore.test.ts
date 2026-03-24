import { describe, it, expect, beforeEach } from 'vitest';
import { searchStore } from './searchStore.svelte';

describe('searchStore', () => {
  beforeEach(() => {
    searchStore.close();
  });

  describe('Search state management', () => {
    it('should start with search closed', () => {
      const state = searchStore.get();
      expect(state.isOpen).toBe(false);
      expect(state.query).toBe('');
      expect(state.currentMatch).toBe(0);
      expect(state.totalMatches).toBe(0);
    });

    it('should open search bar', () => {
      searchStore.open();
      expect(searchStore.get().isOpen).toBe(true);
    });

    it('should open search bar with paneId', () => {
      searchStore.open('pane-1');
      const state = searchStore.get();
      expect(state.isOpen).toBe(true);
      expect(state.paneId).toBe('pane-1');
    });

    it('should close search bar and clear state', () => {
      searchStore.open();
      searchStore.setQuery('hello');
      searchStore.close();
      const state = searchStore.get();
      expect(state.isOpen).toBe(false);
      expect(state.query).toBe('');
      expect(state.currentMatch).toBe(0);
      expect(state.totalMatches).toBe(0);
    });

    it('should update query', () => {
      searchStore.open();
      searchStore.setQuery('test');
      expect(searchStore.get().query).toBe('test');
    });

    it('should update match count', () => {
      searchStore.open();
      searchStore.setQuery('test');
      searchStore.setMatchInfo(3, 17);
      const state = searchStore.get();
      expect(state.currentMatch).toBe(3);
      expect(state.totalMatches).toBe(17);
    });

    it('should toggle case sensitivity', () => {
      expect(searchStore.get().caseSensitive).toBe(false);
      searchStore.toggleCaseSensitive();
      expect(searchStore.get().caseSensitive).toBe(true);
      searchStore.toggleCaseSensitive();
      expect(searchStore.get().caseSensitive).toBe(false);
    });

    it('should toggle regex mode', () => {
      expect(searchStore.get().useRegex).toBe(false);
      searchStore.toggleRegex();
      expect(searchStore.get().useRegex).toBe(true);
      searchStore.toggleRegex();
      expect(searchStore.get().useRegex).toBe(false);
    });

    it('should reset match info when query changes', () => {
      searchStore.open();
      searchStore.setQuery('test');
      searchStore.setMatchInfo(3, 17);
      searchStore.setQuery('different');
      const state = searchStore.get();
      expect(state.currentMatch).toBe(0);
      expect(state.totalMatches).toBe(0);
    });

    it('should expose state via .state getter', () => {
      searchStore.open('pane-x');
      searchStore.setQuery('hello');
      const s = searchStore.state;
      expect(s.isOpen).toBe(true);
      expect(s.paneId).toBe('pane-x');
      expect(s.query).toBe('hello');
    });
  });
});
