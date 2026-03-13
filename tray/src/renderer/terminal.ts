import { mount } from 'svelte';
import TerminalApp from './TerminalApp.svelte';

const target = document.getElementById('app')!;
mount(TerminalApp, { target });
