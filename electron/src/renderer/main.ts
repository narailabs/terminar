import { mount } from 'svelte';
import App from '../../../web/src/App.svelte';

const target = document.getElementById('app')!;
mount(App, { target });
