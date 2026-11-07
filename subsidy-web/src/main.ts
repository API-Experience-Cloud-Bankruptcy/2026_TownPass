import { createApp } from 'vue'
import './tokens.css'
import './style.css'
import App from './App.vue'
import { installLinkHandler } from './townpass/links'

installLinkHandler()
createApp(App).mount('#app')
